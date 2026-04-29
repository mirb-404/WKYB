import os

import httpx
import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

GROQ_API_KEY = os.environ.get("GROQ_API_KEY")
GROQ_BASE_URL = "https://api.groq.com/openai/v1"

# Origin allowlist for the LLM proxy. Empty = allow any origin (dev mode).
# Populate with client domains as you onboard them, e.g.
#   {"https://acme-dental.de", "https://www.acme-dental.de"}
ALLOWED_ORIGINS: set[str] = set()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

app.mount("/src", StaticFiles(directory="src"), name="src")


@app.get("/")
def root():
    return FileResponse("index.html")


@app.get("/healthz")
def healthz():
    return {"ok": True}


@app.post("/llm/chat/completions")
async def llm_proxy(request: Request):
    if not GROQ_API_KEY:
        raise HTTPException(500, "GROQ_API_KEY not configured on server")

    origin = request.headers.get("origin")
    if ALLOWED_ORIGINS and origin not in ALLOWED_ORIGINS:
        raise HTTPException(403, f"Origin {origin!r} not in allowlist")

    body = await request.body()

    async def stream_groq():
        async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0)) as client:
            async with client.stream(
                "POST",
                f"{GROQ_BASE_URL}/chat/completions",
                content=body,
                headers={
                    "Authorization": f"Bearer {GROQ_API_KEY}",
                    "Content-Type": "application/json",
                },
            ) as upstream:
                if upstream.status_code != 200:
                    error_body = await upstream.aread()
                    yield error_body
                    return
                async for chunk in upstream.aiter_bytes():
                    yield chunk

    return StreamingResponse(stream_groq(), media_type="text/event-stream")


if __name__ == "__main__":
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=int(os.environ.get("PORT", 8000)),
    )
