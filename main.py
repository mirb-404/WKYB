import json
import os

import httpx
import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi.util import get_remote_address
from starlette.middleware.base import BaseHTTPMiddleware

GROQ_API_KEY = os.environ.get("GROQ_API_KEY")
GROQ_BASE_URL = "https://api.groq.com/openai/v1"

# Origin allowlist for the LLM proxy. Empty set = allow any origin (don't
# ship to prod that way). Populate with client domains as you onboard them.
ALLOWED_ORIGINS: set[str] = {
    "null",
    "http://localhost:8000",
    "http://localhost:5500",
    "http://127.0.0.1:8000",
    "http://127.0.0.1:5500",
    "https://wkyb-production.up.railway.app",
    # Production client domains, e.g.:
    # "https://acme-dental.de",
    # "https://www.acme-dental.de",
}

MAX_BODY_SIZE = 50 * 1024  # 50 KB cap on incoming proxy bodies

app = FastAPI()

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


class CacheControlMiddleware(BaseHTTPMiddleware):
    """Set explicit Cache-Control on static responses.

    Customer JSONs change often during onboarding — must revalidate every
    request so client edits propagate within seconds. Other static files
    (chat-element.js, themes) get a short cache so onboarding edits still
    propagate fast without hammering Railway on every page load. LLM
    responses must never be cached.
    """

    async def dispatch(self, request, call_next):
        response = await call_next(request)
        path = request.url.path
        if path.startswith("/src/customers/"):
            response.headers["Cache-Control"] = "no-cache, must-revalidate"
        elif path.startswith("/src/"):
            response.headers["Cache-Control"] = "public, max-age=300"
        elif path.startswith("/llm/"):
            response.headers["Cache-Control"] = "no-store"
        return response


app.add_middleware(CacheControlMiddleware)

app.mount("/src", StaticFiles(directory="src"), name="src")


@app.get("/")
def root():
    return FileResponse("index.html")


@app.get("/healthz")
def healthz():
    return {"ok": True, "groq_configured": bool(GROQ_API_KEY)}


@app.post("/llm/chat/completions")
@limiter.limit("30/minute")
async def llm_proxy(request: Request):
    if not GROQ_API_KEY:
        raise HTTPException(500, "GROQ_API_KEY not configured on server")

    origin = request.headers.get("origin")
    if ALLOWED_ORIGINS and origin not in ALLOWED_ORIGINS:
        raise HTTPException(403, f"Origin {origin!r} not in allowlist")

    body = await request.body()
    if len(body) > MAX_BODY_SIZE:
        raise HTTPException(413, "Request body too large")

    # Open client manually (not via async-with) so we can validate the
    # upstream response status BEFORE committing to a streaming response.
    # If we returned StreamingResponse first and the upstream was 4xx/5xx,
    # we'd ship error JSON with text/event-stream headers and the widget
    # would render an empty bubble. Better to surface real HTTP errors.
    client = httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0))
    try:
        upstream_req = client.build_request(
            "POST",
            f"{GROQ_BASE_URL}/chat/completions",
            content=body,
            headers={
                "Authorization": f"Bearer {GROQ_API_KEY}",
                "Content-Type": "application/json",
            },
        )
        upstream = await client.send(upstream_req, stream=True)
    except httpx.RequestError as e:
        await client.aclose()
        raise HTTPException(502, f"Upstream connection failed: {e}") from e

    if upstream.status_code != 200:
        error_body = await upstream.aread()
        await upstream.aclose()
        await client.aclose()
        try:
            payload = json.loads(error_body)
            detail = (
                payload.get("error", {}).get("message")
                or error_body.decode("utf-8", errors="replace")
            )
        except (json.JSONDecodeError, UnicodeDecodeError):
            detail = error_body.decode("utf-8", errors="replace")
        raise HTTPException(upstream.status_code, detail)

    async def stream_groq():
        try:
            async for chunk in upstream.aiter_bytes():
                yield chunk
        finally:
            await upstream.aclose()
            await client.aclose()

    return StreamingResponse(stream_groq(), media_type="text/event-stream")


if __name__ == "__main__":
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=int(os.environ.get("PORT", 8000)),
    )
