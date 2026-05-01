# Production Readiness Checklist

What to fix, lock down, and verify **before the first paying client goes live**. Anything below this line is acceptable in dev/MVP; above the line is what separates "I'm building" from "a real business is paying me to keep this up".

Companion to [Client Data Intake](260429_Client-Data-Intake.md) and [Per-Client Onboarding Workflow](260429_Per-Client-Onboarding-Workflow.md).

---

## Hard blockers — fix all of these before signing any paid contract

These are not negotiable. Skipping any one of them creates real risk: data leaks, runaway bills, GDPR fines, or reputation damage.

- [ ] Groq API key lives only in Railway env vars, never in git
- [ ] `ALLOWED_ORIGINS` in [`main.py`](../main.py) populated with at least one client domain (not empty)
- [ ] Per-IP rate limiting on `/llm/chat/completions` (~30 req/min/IP)
- [ ] Request body size capped (~50 KB)
- [ ] Lead capture either fully implemented OR removed from system prompt (don't promise a feature that doesn't fire)
- [ ] HTTPS-only on the proxy (Railway gives this by default — verify)
- [ ] `Datenschutzerklärung` text drafted and sent to clients to add to their privacy policy
- [ ] DPA (Auftragsverarbeitungsvertrag) signed with each client before they paste the snippet on a live site
- [ ] Error monitoring in place — at minimum, you must see when the proxy 5xx's
- [ ] Manual end-to-end test on the client's actual production domain passed

Until **every box above** is checked, you are running a hobby project on someone else's website.

---

## 1. Code and infrastructure to-do list

These are concrete leftovers from the build that must be resolved before launch.

### 1.1 Lead capture webhook — implement or remove

Today the system prompt ([prompt-builder.js](../src/core/prompt-builder.js)) tells the LLM to emit `[LEAD: name="...", phone="..."]` after collecting booking info, but **no JS reads or POSTs that line**. The text just renders verbatim in the chat bubble.

Options:

1. **Implement it.** Add a post-stream parser in [`chat-element.js`](../src/ui/chat-element.js) `_finalizeMessage` that:
   - Regex-matches `\[LEAD:\s*(.+?)\]` in the assistant's content.
   - Parses the `key="value"` pairs.
   - POSTs to `config.lead_capture.webhook_url`.
   - Strips the `[LEAD: ...]` line from the bubble before display.
2. **Remove it from the prompt.** Comment out `leadCaptureBlock(config)` in [`prompt-builder.js`](../src/core/prompt-builder.js) until you ship option 1. Keep the field in the JSON for forward compat.

Pick one before launch. Option 2 is fine for a v1 client who handles bookings via phone; option 1 is required for any client who explicitly wants webhook delivery.

### 1.2 Push pending fixes

If you haven't already pushed:

- [ ] [src/adapters/qwen.js](../src/adapters/qwen.js) — optional API key
- [ ] [src/ui/styles.js](../src/ui/styles.js) — defensive `:host` CSS
- [ ] [main.py](../main.py) — Groq proxy route
- [ ] [pyproject.toml](../pyproject.toml) — `httpx` dependency

Verify with:

```powershell
git status   # should be clean
git log -5   # latest commits include the four above
```

### 1.3 Cache-busting strategy

Browsers aggressively cache JS modules. A bug fix in `chat-element.js` won't reach already-loaded clients until their cache expires.

Decide before launch:

- **Versioned URL** — change snippet to `…/src/ui/chat-element.js?v=20260429` and bump the query string with each release. Each client must update their snippet to roll forward, but they can pin a known-good version.
- **Cache headers** — add `Cache-Control: no-cache, must-revalidate` to the static-files response in [`main.py`](../main.py) so browsers always re-validate. Faster rollout, slightly more requests per visit.
- **Hybrid** — default to `no-cache`; encourage clients to use the versioned URL only if they want to pin.

Recommended: hybrid. Default no-cache, document the versioned URL pattern.

### 1.4 Customer JSON cache headers

Customer JSONs change frequently during onboarding iteration. Make sure they're served with `Cache-Control: no-cache` so client browsers pick up edits within seconds, not hours.

---

## 2. Security hardening

### 2.1 Lock down `ALLOWED_ORIGINS`

In [`main.py`](../main.py), set:

```python
ALLOWED_ORIGINS = {
    "https://acme-dental.de",
    "https://www.acme-dental.de",
    "https://mueller-zahnarzt-bremen.de",
    # ... one per onboarded client, both bare and www
}
```

Without this, anyone on the internet can use your Railway URL as a free LLM proxy and burn your Groq quota.

Add an exception for local testing: also allow `null` (file://) and `http://localhost:*` only when `os.environ.get("ENV") == "dev"`.

### 2.2 Per-IP rate limiting

Use [SlowAPI](https://slowapi.readthedocs.io/) — drop-in for FastAPI:

```powershell
uv add slowapi
```

In `main.py`:

```python
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter

@app.post("/llm/chat/completions")
@limiter.limit("30/minute")
async def llm_proxy(request: Request):
    ...
```

30 req/min/IP is sensible for a chat widget. Adjust based on real traffic patterns.

### 2.3 Request size cap

A malicious user could POST a 10 MB body to make your proxy forward it to Groq. Cap incoming bodies:

```python
MAX_BODY_SIZE = 50 * 1024  # 50 KB

body = await request.body()
if len(body) > MAX_BODY_SIZE:
    raise HTTPException(413, "Request body too large")
```

### 2.4 Input validation

Before forwarding, parse the body and verify:

- It's valid JSON.
- It has `messages` array, `model` string.
- `messages` length ≤ 50 (sanity cap on conversation length).
- Each `message.content` ≤ 10 KB (sanity cap per turn).

This protects against malformed requests that would either crash your proxy or rack up Groq tokens by sending a huge prompt.

### 2.5 Secrets rotation

- [ ] Groq API key rotated quarterly (or on any suspicion of leak)
- [ ] Railway-side env vars audit log reviewed monthly
- [ ] No keys committed to git (`grep -ri "gsk_" .` should return nothing in tracked files)

### 2.6 HTTPS everywhere

Railway gives you HTTPS by default. Verify:

- [ ] All client snippets use `https://wkyb-production.up.railway.app/...`
- [ ] No HTTP fallbacks anywhere
- [ ] `Strict-Transport-Security` header set (FastAPI doesn't add this by default; configure via reverse proxy or middleware)

---

## 3. Reliability and monitoring

### 3.1 Error monitoring

You need to know when the proxy is failing **before clients call you**. Pick one:

- **Sentry** (free tier 5K events/month) — drop in via `uv add sentry-sdk` and one-line init. Catches 5xx, unhandled exceptions, slow requests.
- **Logtail / BetterStack** — log shipping + alerting. Good if you want a single dashboard.
- **DIY** — middleware that POSTs failures to a Discord/Slack webhook. Works for low volume.

At minimum, log every `/llm/chat/completions` request with: timestamp, origin, status code, response time, error message if any. Even just a CSV file is better than nothing.

### 3.2 Uptime monitoring

Railway has internal monitoring but doesn't notify you proactively on the free tier. Use:

- **UptimeRobot** (free for 50 monitors, 5-min interval) — pings `https://wkyb-production.up.railway.app/healthz` every 5 min, emails you if it fails twice in a row.
- **BetterUptime** — similar, with status-page generation.

Set up before launch. The first time a client calls you to say "the chat is down" you've already failed.

### 3.3 Health checks

Your `/healthz` returns `{"ok": true}` blindly. Upgrade to actually verify the proxy is functional:

```python
@app.get("/healthz")
async def healthz():
    if not GROQ_API_KEY:
        raise HTTPException(500, "groq_key_missing")
    # Optionally ping Groq with a tiny request to verify upstream is reachable
    return {"ok": True, "groq_configured": True}
```

A "fake healthy" service (process running but proxy broken) is worse than a clearly down one.

### 3.4 Graceful degradation

When Groq is down or rate-limited:

- [ ] Proxy returns a clean error to the widget (HTTP 503 with friendly JSON), not a hang or 504.
- [ ] Widget shows "Sorry, our assistant is briefly unavailable — please call us at +49…" using the client's `business.phone`. Add this fallback in [`chat-element.js`](../src/ui/chat-element.js) `_showError`.
- [ ] You get a Sentry/email alert when 5xx rate exceeds 5% over 5 minutes.

### 3.5 Timeouts

Already configured in [`main.py`](../main.py) (`httpx.Timeout(60.0, connect=10.0)`). Verify these are right for your traffic — Groq usually responds in <2s for 8B models. If you see frequent 60s timeouts, lower the cap and surface a faster error.

---

## 4. Cost and quota management

### 4.1 Groq quota visibility

Groq's free tier is generous but finite. Daily token quotas reset at midnight UTC. Monitor:

- [ ] Bookmarked: https://console.groq.com/settings/limits
- [ ] Daily-glance habit: check usage % at the same time each day for the first month
- [ ] Set up an alert: when daily usage hits 70%, email yourself

If you cross 80% regularly with one free key, upgrade to Groq Developer ($0/mo to start, pay-per-use). At Developer tier, you control your own ceiling and the rate limits go up significantly.

### 4.2 Railway billing

The Hobby plan is $5/mo + usage. At your scale (a single FastAPI service, no DB), expect $5–10/month. Verify:

- [ ] Card on file
- [ ] Spend cap or budget alert configured (Railway has spending limits in account settings)
- [ ] Trial credit not silently expiring on you mid-launch

### 4.3 Per-client cost attribution

If you onboard 10+ clients, you'll want to know who's costing you what. Two cheap approaches:

1. **Log the `customer` slug** (passed via Origin or extracted from the system prompt) on every proxy request. Aggregate weekly.
2. **Tag Groq requests** with `metadata` field if Groq supports it (some providers do). Easiest if available.

Skip this until you have multiple clients. But know it'll be needed.

---

## 5. Legal and compliance — German market

You're processing personal data on behalf of clients. GDPR applies. Skipping this section is the single biggest risk item.

### 5.1 GDPR data flow map

Document, on one page:

1. **Data in:** website visitor types a message → contains potentially personal data (name, phone, free-text description of medical/legal issue).
2. **Hop 1:** message goes from visitor's browser → your Railway proxy (Netherlands, EU).
3. **Hop 2:** Railway → Groq (US).
4. **Hop 3:** Groq → Railway → visitor's browser.
5. **Storage:** none on your side (no DB), unless logging is enabled. Groq's retention policy applies to their hop.

This map needs to be in your DPA template and in the client's Datenschutzerklärung.

### 5.2 Datenschutzerklärung snippet for clients

Every client must add a paragraph to their privacy policy. Provide them this template:

> ## Chatbot
>
> Auf unserer Website nutzen wir einen Chat-Assistenten, der von [Ihre Firma] (im Folgenden "Anbieter") bereitgestellt wird. Wenn Sie den Chat nutzen, werden Ihre Eingaben (einschließlich personenbezogener Daten, die Sie freiwillig eingeben) an die Server des Anbieters in den Niederlanden (Railway, europe-west4) übertragen und von dort an Groq, Inc. (USA) zur Generierung der Antwort weitergeleitet. Es findet keine dauerhafte Speicherung Ihrer Konversation auf den Servern des Anbieters statt.
>
> Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO (Vertragserfüllung) bzw. Art. 6 Abs. 1 lit. f DSGVO (berechtigtes Interesse).
>
> Die Übermittlung in die USA erfolgt auf Basis der EU-Standardvertragsklauseln. Weitere Informationen finden Sie in der Datenschutzerklärung von Groq: https://groq.com/privacy-policy/
>
> Sie können die Nutzung des Chat-Assistenten jederzeit vermeiden, indem Sie ihn nicht öffnen.

Adjust the company name, server region, and provider names to match your stack. Have a German-speaking lawyer review once before sending to first client.

### 5.3 DPA template

The Auftragsverarbeitungsvertrag is required between you (processor) and each client (controller). At a minimum it must contain:

- Parties (your company, client business)
- Subject matter (chat-assistant data processing)
- Duration (matches the service contract)
- Categories of data subjects (website visitors)
- Categories of personal data (free-text messages, optionally name + phone)
- Sub-processors (Railway, Groq) — listed with their addresses and what they do
- Technical and organizational measures (TOMs) — describe encryption, access control, logging, retention
- Data subject rights handling (how to respond to deletion/access requests)
- Termination handling

You can templatize this — same DPA per client, only the company-specific fields change. Hire a lawyer once for €500–€1500 to draft the template; reuse forever.

### 5.4 Cookie / consent

The widget itself doesn't set cookies. Verify before claiming this:

- [ ] No `document.cookie` writes anywhere in the widget code
- [ ] No localStorage writes that contain personal data (the current code stores theme preferences and config — non-personal, low-risk, but document it)

If clean, you can tell clients **the widget itself does not require cookie consent**. They still need to mention it in their Datenschutzerklärung but they don't need to put it behind their cookie banner.

If the widget evolves to track usage (analytics, session replay), this changes — re-evaluate consent requirements.

### 5.5 Server location

Verify in Railway:

- [ ] Service region is `europe-west4` (Netherlands) or another EU region
- [ ] Not us-east, us-west, or asia regions (would create extra GDPR compliance burden)

Currently your service is at `europe-west4-drams3a` per an earlier screenshot — good.

---

## 6. Support and operations

### 6.1 Support channel

Decide and document:

- [ ] How does a client report an issue? Email? Slack? Phone?
- [ ] What's your response SLA? (For early stage: "within 24h on business days" is honest.)
- [ ] Who's on call? If it's just you, what happens when you sleep?

Put this in the contract. Vague support promises become "you broke it, fix it now" pressure later.

### 6.2 Incident runbook

Write a one-page runbook for common incidents. Suggested incidents to cover:

1. **Proxy returns 5xx for all clients** — check Railway deploy status, GROQ_API_KEY env var, Groq status page (status.groq.com).
2. **One client's bot is broken** — check their customer JSON validity, check Network tab on their live site.
3. **Groq quota exhausted** — temporary fallback message, upgrade to paid tier or rotate to backup provider (OpenRouter as warm standby).
4. **Railway region outage** — temporarily redirect to backup region or fail gracefully with explanation.

Keep this in `docs/incident-runbook.md` and update after every incident.

### 6.3 Status page

Optional but professional. Use:

- **Notion public page** — free, slow to update.
- **Statuspage.io / BetterStack** — paid, automated.
- **A subdomain on Railway** with a static HTML — free, manual.

For first 5 clients, skip this. After that, expect questions like "is the chat down or is it just me" — a status page deflects them.

### 6.4 Versioning

Tag releases in git so you can roll back:

```powershell
git tag -a v0.1.0 -m "First production release"
git push --tags
```

Document what's in each version in a `CHANGELOG.md` (follow [keepachangelog.com](https://keepachangelog.com/) format).

When a client reports a regression, you can see exactly what shipped between their last working state and now.

---

## 7. Quality and pre-launch QA

For each new client, before they paste the snippet on production:

### 7.1 Browser matrix

Test the live snippet on:

- [ ] Chrome (Windows + macOS)
- [ ] Firefox
- [ ] Safari (macOS + iOS)
- [ ] Edge
- [ ] Mobile Chrome (Android)

The widget uses standard Web Components — works everywhere modern. But verify the launcher position and panel sizing on small screens (iPhone SE, ~375px wide).

### 7.2 Conversation QA

Run through these scenarios with the client present:

- [ ] User asks 3 on-topic questions → answers match the FAQ / services
- [ ] User asks an off-topic question → bot refuses politely
- [ ] User asks for a price not on the list → bot says "we'll quote at your visit", doesn't make up a number
- [ ] User describes an emergency → bot redirects to emergency line (if applicable)
- [ ] User starts booking flow → bot collects fields, emits confirmation
- [ ] User switches language mid-conversation → bot follows
- [ ] User sends gibberish → bot doesn't break

Document the conversations and have the client sign off on the answers.

### 7.3 Lead capture end-to-end

If lead capture is enabled:

- [ ] Test message triggers the flow
- [ ] Required fields collected
- [ ] Webhook URL receives the POST (check Zapier history or equivalent)
- [ ] Client's CRM / email actually receives the lead within 1 minute
- [ ] Confirmation message displayed correctly

### 7.4 Performance

- [ ] First message response starts streaming in <2s on a normal connection
- [ ] Widget script loads in <500ms
- [ ] No layout shift on the client's site when the widget mounts
- [ ] Console clean — no errors, no warnings related to the widget

---

## 8. Go-live checklist (per client)

The day-of cutover. Run through this with the client on a screen-share:

- [ ] All sections above complete for this client
- [ ] DPA signed and filed
- [ ] Datenschutzerklärung updated on client's site
- [ ] Snippet pasted into client's site (correct platform-specific location)
- [ ] Live URL tested in incognito (verifies it works without your browser cache helping)
- [ ] Client added to monitoring
- [ ] Client added to billing
- [ ] Welcome email sent with: snippet, how-to-update-FAQ instructions, support contact, expected response time
- [ ] First-week check-in scheduled (you reach out, not them)

---

## 9. Post-launch — what to do in the first 30 days

Don't ship and forget. The first month is when problems surface.

- **Day 1:** Confirm widget is live. Send a test message yourself.
- **Day 3:** Pull the conversation log. Read every conversation. Note any answers you'd improve.
- **Day 7:** Check Groq usage. Update FAQ based on real questions visitors are asking that the bot didn't handle well.
- **Day 14:** Review error logs. Anything 5xx? Latency spikes?
- **Day 30:** Schedule a client check-in. Demonstrate value (X conversations handled, Y leads captured). Ask what to add/change.

---

## What this checklist intentionally does not cover

- **Sales process** — out of scope here, see your CRM.
- **Pricing** — depends on your business model, not technical readiness.
- **Multi-tenancy isolation** — your current architecture is shared (one proxy, one Groq key for all clients). Acceptable for SMB scale. If you onboard a healthcare or legal client demanding isolation, that's a custom enterprise tier and a separate document.
- **Self-hosted LLM migration** — only relevant once cloud cost > €500/month. Defer.
- **Multi-language UI, RTL layout, non-EU compliance, per-region deployment** — covered in [International Client Considerations](260429_International-Client-Considerations.md). These are not launch blockers for a German first client; they become relevant as you expand beyond the EU/non-English markets.

---

## Quick-glance pre-launch summary

If you only do four things before paid launch, these are the ones:

1. **Lock `ALLOWED_ORIGINS`** so your free LLM proxy isn't open to the internet.
2. **Sign DPAs** with each client and provide the Datenschutzerklärung text.
3. **Set up monitoring** (UptimeRobot + Sentry/log alert) so failures wake you up before clients call.
4. **Decide on lead capture** — either ship the webhook implementation or remove the booking-flow text from the system prompt. Don't ship a half-baked promise.

Everything else is incremental polish. These four are the structural risk items.
