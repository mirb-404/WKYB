# Per-Client Onboarding Workflow

How to take a new client from "intake form complete" to "snippet on their live site". Each client gets their own customer JSON; the same widget code serves all of them.

Companion to [Client Data Intake](260429_Client-Data-Intake.md) — that doc covers *what* to collect; this one covers *what to do with it*.

---

## How "different per client" works under the hood

When a visitor loads a client's site, the widget pipeline runs:

1. The widget script loads from your Railway URL (one URL, all clients).
2. It reads the `customer="<slug>"` attribute on the `<ena-chat>` element.
3. It fetches `https://wkyb-production.up.railway.app/src/customers/<slug>.json`.
4. From that JSON it applies the client-specific configuration in [`chat-element.js`](../src/ui/chat-element.js):
   - **Theme tokens** (`theme.tokens`) → CSS custom properties → colors, fonts, radii, shadows.
   - **Header** (`header.title`, `header.greeting`, `header.avatar_text`) → panel header and empty-state message.
   - **System prompt** built from `business`, `tone`, `services`, `faq`, `guardrails`, `lead_capture` via [`prompt-builder.js`](../src/core/prompt-builder.js) → drives every reply.
   - **LLM sampling** (`llm.temperature`, `llm.max_tokens`) → injected into the adapter's request body.

Net effect: changing **one JSON file** changes the bot's appearance, voice, knowledge, and behavior for that client. No code changes, no redeploy logic — just data.

---

## Slug naming rules

The slug is the unique identifier per client. It appears in three places:
1. The customer JSON filename: `src/customers/<slug>.json`
2. The `customer="<slug>"` attribute on the embed snippet
3. URLs in logs and Network tab

Rules — enforced by the regex `[a-z0-9_-]+` at [`chat-element.js:293`](../src/ui/chat-element.js#L293):

- Lowercase ASCII letters
- Numbers
- Hyphens (`-`) and underscores (`_`)
- Nothing else — no spaces, dots, capitals, umlauts, or special characters

| Good | Bad | Reason |
|---|---|---|
| `acme-dental` | `Acme Dental` | Spaces, capitals |
| `mueller_zahnarzt` | `müller-zahnarzt` | Umlaut |
| `pizzeria-sole-2` | `pizzeria.sole` | Dot |
| `stadt-fitness-bremen` | `stadt fitness` | Space |

**Recommended pattern:** `<business-name>-<city>` for disambiguation. e.g. `mueller-zahnarzt-bremen`. Cities collide less than business names.

---

## Step-by-step workflow

### Step 1 — Pick the slug

Use the rules above. Write it down somewhere — once you commit a customer JSON with this slug to git, changing it later means renaming the file *and* notifying the client to update their snippet.

### Step 2 — Copy the template

The starter file is at [`src/customers/_template.json`](../src/customers/_template.json). Underscore prefix so it doesn't get loaded as a real customer.

```powershell
Copy-Item src/customers/_template.json src/customers/<your-slug>.json
```

### Step 3 — Fill in the template

Open the new file in VS Code. Every field has a `TODO` placeholder. Replace each with the real value from the [intake form output](260429_Client-Data-Intake.md).

Field reference (high-impact fields ordered by visibility):

| Field | Drives |
|---|---|
| `business.name` | Used in every system prompt section. |
| `business.type` | Defines what counts as on-topic for refusals. |
| `tone` | Personality. Be specific, not generic. |
| `theme.tokens` | All visual rebranding. |
| `header.title` | Panel header text. |
| `header.greeting` | Empty-state welcome message. |
| `services[]` | What prices the bot can quote. |
| `faq[]` | Approved knowledge base. |
| `guardrails[]` | Hard "never" rules. |
| `lead_capture` | Booking flow definition. |
| `llm.temperature` | Response creativity (lower = more conservative). |
| `llm.max_tokens` | Response length cap. |

Mechanical work, ~20 minutes per client once intake is back.

### Step 4 — Test locally before deploying

Avoid pushing every iteration to Railway — use a local FastAPI server for fast feedback.

#### Option A — Local server (recommended for iteration)

Start the FastAPI server:

```powershell
uv run python main.py
```

It runs at `http://localhost:8000`. Make a per-client mock by copying the existing one:

```powershell
Copy-Item demo/acme-dental-mock.html demo/<your-slug>-mock.html
```

Edit two things in the new HTML:

```html
<!-- Point the script and proxy at localhost instead of Railway -->
<script type="module" src="http://localhost:8000/src/ui/chat-element.js"></script>
<ena-chat
  customer="<your-slug>"
  base-url="http://localhost:8000/llm"
  model="gemma2-9b-it">
</ena-chat>
```

Open the mock in Chrome (double-click). The widget loads your local customer JSON instantly — no deploy needed. Iterate on JSON changes by saving and refreshing the browser tab.

#### Option B — Push and test against Railway

Slower (~1-min redeploy per change) but always-on and works from any machine. Use this for final sign-off, not active iteration.

```powershell
git add src/customers/<your-slug>.json
git commit -m "Add customer: <Client Name>"
git push
```

Then open the mock with the Railway base URL and confirm the bot behaves correctly.

### Step 5 — Send the client a staging mock for review

Use a `-preview` suffix on the slug for staging so you don't risk breaking a live deployment:

```powershell
Copy-Item src/customers/<your-slug>.json src/customers/<your-slug>-preview.json
```

Adjust the preview file as needed. Push.

Build a mock at `demo/<your-slug>-preview-mock.html` pointing at the preview slug. Send the client this URL (or just the file as an attachment). They poke at it for 24–48h, send feedback.

When the client signs off:
1. Copy `<your-slug>-preview.json` over `<your-slug>.json`.
2. Delete `<your-slug>-preview.json` (don't leave stale staging files in the repo).
3. Push.

### Step 6 — Send the client their embed snippet

```html
<script type="module" src="https://wkyb-production.up.railway.app/src/ui/chat-element.js"></script>
<ena-chat
  customer="<your-slug>"
  base-url="https://wkyb-production.up.railway.app/llm"
  model="gemma2-9b-it">
</ena-chat>
```

The only thing that differs across clients is `customer="..."`. Everything else — theme, voice, prices, FAQs — flows automatically from their JSON.

Tell the client where to paste the snippet on their site. Cheat sheet by platform:

| Platform | Where |
|---|---|
| WordPress | Plugin "Insert Headers and Footers" → Footer. Or `footer.php` before `</body>`. |
| Squarespace | Settings → Advanced → Code Injection → Footer. |
| Wix | Settings → Custom Code → Add code → Body—end → All pages. |
| Webflow | Project Settings → Custom Code → Footer Code. |
| Shopify | Online Store → Themes → Edit code → `theme.liquid` → before `</body>`. |
| Plain HTML | Paste before `</body>` in every page (or shared template). |

### Step 7 — Verify the live install

Open the client's live site in Chrome. F12 → Console + Network tabs. Confirm:

- **Console:** no red errors mentioning `chat-element.js`, `customer "<slug>" failed to load`, or CSP violations.
- **Network:** GET `/src/customers/<slug>.json` returns **200**.
- **Network:** GET `/src/ui/chat-element.js` returns **200**.
- **Visual:** launcher button appears bottom-right with the client's primary color.
- **Test message:** click launcher → send "test" → response streams in under 2 seconds.

If any of those fail, the troubleshooting tree is in [Per-Client Install Troubleshooting](#troubleshooting) below.

---

## Reference: what lives where

| You want to change… | Edit this | Effect |
|---|---|---|
| Brand colors, fonts | `theme.tokens` in customer JSON | Visual rebrand |
| Bot personality / tone | `tone` field | How it speaks |
| Prices the bot can quote | `services[]` | What it'll commit to |
| Approved Q&A | `faq[]` | What it knows |
| Hard rules | `guardrails[]` | What it'll refuse |
| Booking flow | `lead_capture` | Lead capture format |
| Greeting / header | `header.*` | First impression |
| Response length / creativity | `llm.temperature`, `llm.max_tokens` | Bot's style at LLM level |
| Which model is used | `model` attribute on snippet | Per-client model choice |
| Different LLM provider | `main.py` proxy upstream | Affects all clients at once |

For 95% of client onboarding, you only edit the JSON. Code changes are reserved for schema additions (rare) or new theme tokens (rare).

---

## Common scenarios

### Scenario A — A client asks for a tone change after launch

1. Edit `tone` in their JSON.
2. Push to Railway.
3. The change is live in ~1 minute. No client action needed.

### Scenario B — A client adds a new service

1. Append to `services[]` in their JSON.
2. Push.
3. The bot can quote the new service immediately.

### Scenario C — Two clients in the same vertical

Copy one's JSON as a base, change the business-specific fields. Tone, FAQ, services usually need adapting; theme and guardrails often transfer with minor tweaks.

Pattern: keep one well-tuned JSON per vertical (e.g. `_template-dental.json`, `_template-restaurant.json`) as your starting point for new clients in that space.

### Scenario D — Client wants a one-off feature you don't support

E.g. "Can the bot show today's lunch menu pulled from our PDF?" That's a code change, not a JSON change. Two paths:

1. **Build it generically** — add a new field to the schema (e.g. `dynamic_content.menu_url`) that any client can use. Slow but reusable.
2. **Build it client-specific** — add custom logic in the prompt-builder gated by the slug. Fast but creates bespoke clients that resist later refactoring.

Pick (1) unless the deal is large enough to justify bespoke work, and even then think hard about whether the next client will want the same thing.

---

## <a name="troubleshooting"></a>Per-client install troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Launcher doesn't appear at all | Script blocked by CSP | Ask client's web team to add your Railway origin to their `script-src`. |
| Launcher appears with default styling, not their brand | Customer JSON 404'ing | Check that you actually pushed the JSON file to Railway. Network tab will show the 404. |
| Launcher appears but messages error out | Proxy / Groq misconfigured | Hit `/llm/chat/completions` from a `file://` page directly to isolate. |
| Bot answers but ignores their FAQ | JSON parsed but FAQ malformed | Check `faq[]` entries all have both `q` and `a` fields. Empty entries are silently skipped. |
| Bot too verbose | `max_tokens` not set or too high | Set `llm.max_tokens` to ~400–600. |
| Bot too creative (makes up prices) | `temperature` too high | Set `llm.temperature` to 0.3 or below for clinical/professional businesses. |
| Theme colors look slightly off | Missing tokens fall back to defaults | Check that `theme.tokens` includes all the required `--ena-*` properties. Reference the full list in [`src/ui/styles.js`](../src/ui/styles.js) under `:host`. |
| Lead-capture line appears in chat instead of being captured | Webhook posting not implemented yet | Known limitation — only the prompt-side instruction exists today. POST-to-webhook needs to be added in `chat-element.js` `_finalizeMessage`. |

---

## File-system layout for clients

After onboarding multiple clients, your `src/customers/` directory looks like this:

```
src/customers/
├── _template.json              ← starter, never loaded
├── _template-dental.json       ← optional vertical-specific starter
├── _template-restaurant.json
├── acme-dental.json            ← live
├── mueller-zahnarzt-bremen.json ← live
├── pizzeria-sole.json          ← live
└── stadt-fitness-koeln-preview.json ← in client review
```

Underscore prefix = don't load. Hyphenated kebab-case = real client. `-preview` suffix = staging.

---

## Checklist per new client

Use this as the kickoff checklist when starting a new client:

- [ ] Slug picked and noted
- [ ] Customer JSON created from template
- [ ] All `TODO` placeholders replaced
- [ ] FAQ approved by client
- [ ] Theme matches client's brand (colors verified against their website)
- [ ] Tested locally with mock site (Option A)
- [ ] Preview slug deployed and link sent to client
- [ ] Client sign-off received
- [ ] Preview slug promoted to live, preview file deleted
- [ ] Snippet sent to client with platform-specific install instructions
- [ ] Live install verified (console clean, JSON loads, message round-trips)
- [ ] Client added to monitoring / billing
