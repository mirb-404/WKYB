# Client Data Intake — ena-chat

A reference for what to collect from a new client before building their chatbot, why each item matters, and how the data maps to the customer JSON in [`src/customers/`](../src/customers/).

Use this document as the source of truth when designing intake forms, sales scripts, and onboarding calls.

---

## How to read this document

The data is grouped into five tiers by criticality. Tier 1 is non-negotiable; Tier 5 is polish. Every field below maps to a specific path in the customer JSON — that mapping is shown inline so you (or whoever fills in the JSON) doesn't have to guess.

Reference schema: [`src/customers/acme-dental.json`](../src/customers/acme-dental.json) — every field shown there is something you must collect or have a default for.

---

## Tier 1 — Mandatory

The bot literally cannot function without these. Refuse to start a build until every Tier 1 field is in hand.

| Data point | JSON path | Why it matters |
|---|---|---|
| Business name | `business.name` | Used everywhere in the system prompt. Drives scope-locking ("you only answer for X"). |
| Business type | `business.type` | One short phrase, e.g. "dental practice", "law firm", "pizzeria". Defines what counts as on-topic for refusals. |
| Primary phone or email | `business.phone` / `business.email` | The bot's fallback when it can't help. At least one of the two is required. |
| Website URL | `business.website` | Cited in answers; signals the bot's "home base". |
| Customer slug | `slug` | Lowercase ASCII identifier for the URL, e.g. `acme-dental`. You assign this, not the client. |

**Stop signal:** if any Tier 1 field is missing, do not start the JSON build. Go back to the client.

---

## Tier 2 — High value

The bot will run without these but will feel generic. Realistically these account for ~80% of useful chat content. Get them.

| Data point | JSON path | Why it matters |
|---|---|---|
| Opening hours | `business.hours` | Most-asked question for any local business, full stop. |
| Address | `business.address` | Second most-asked. Also enables "where to park" answers. |
| Top 6–10 services with prices | `services[]` | Together with hours and address, these cover ~40% of all real chats. Don't skip prices — vague pricing kills conversion. |
| FAQ (8–15 Q&A pairs) | `faq[]` | The single highest-leverage input. Mine these from the client's actual emails / phone notes / receptionist memory, not from "what should the FAQ be?" |
| Tone description | `tone` | Specific descriptor, not adjectives. "Warm but brief, reassures nervous patients in plain German" — not "friendly and professional". |
| Languages spoken | `business.languages_spoken` | Drives multilingual response behavior and scope refusals in non-supported languages. |
| Header title | `header.title` | Shown in the chat panel header. Default is "Assistant"; clients usually want their own brand here. |
| Greeting message | `header.greeting` | First thing visitors see. Should set expectations: *"Hi! I can help you book an appointment, check our hours, or answer questions about our services."* |

---

## Tier 3 — Feature-dependent

Only required if the client wants the corresponding feature. Otherwise leave blank.

### Lead capture (booking, callbacks, quotes)

| Data point | JSON path | Notes |
|---|---|---|
| Trigger intents | `lead_capture.trigger_intents[]` | Words/phrases that open the booking flow. E.g. `["book", "appointment", "callback", "quote"]`. |
| Fields to collect | `lead_capture.fields[]` | Each field has `key`, `label`, `required`. Keep to 2–4 fields max — every extra field drops conversion. |
| Webhook URL | `lead_capture.webhook_url` | Where leads land. Zapier / Make / n8n / their CRM. **Note:** webhook posting is not yet implemented in the widget — leads currently render as `[LEAD: ...]` text. Flag this to the client. |
| Confirmation message | `lead_capture.confirmation_message` | What the bot says after capturing. Include a fallback ("If urgent, please call X"). |

### Emergency contact

Required for medical, legal, plumbing, locksmith, veterinary — any business where "user has emergency" is a real scenario.

| Data point | JSON path | Notes |
|---|---|---|
| Emergency line | `business.emergency_line` | Separate from `business.phone`. The bot redirects all emergency descriptions here. |
| Emergency triage rule | inline in `guardrails[]` | Hard rule: do not triage, redirect immediately. |

### Sampling overrides

Optional per-customer LLM tuning. Defaults apply if omitted.

| Data point | JSON path | Default | When to override |
|---|---|---|---|
| Model | `llm.model` | inherits widget attribute | Rare — only if customer wants a specific model. |
| Temperature | `llm.temperature` | provider default | Lower (0.2–0.4) for clinical/legal; higher (0.6–0.8) for marketing-led businesses. |
| Max tokens | `llm.max_tokens` | provider default | Cap around 500–700 to enforce brevity. |

---

## Tier 4 — Guardrails

These are owner-level decisions, not marketing-level. Get them in writing from someone who can be held accountable. Skip at your peril for regulated industries.

| Data point | JSON path | Examples |
|---|---|---|
| Hard "never say" rules | `guardrails[]` | "Never give medical advice." "Never quote prices not on this list." "Never speculate about insurance reimbursement." |
| Redirect-on-detection rules | `guardrails[]` | "If user describes severe pain, swelling, or knocked-out tooth, redirect to emergency line — do not triage." |
| Off-scope refusal rules | already enforced by `# SCOPE — STRICT` block in [prompt-builder.js](../src/core/prompt-builder.js) | Politics, news, other companies, weather, coding. The bot refuses these by default; no per-client config needed. |
| Privacy boundaries | `guardrails[]` | "Never collect insurance card numbers, dates of birth, or detailed medical history. Only name, phone, and preferred contact time." |

**Get the business owner's sign-off, not the marketing person's.** Marketing wants the bot to be helpful; legal/owner wants it to be safe. Guardrails are the second voice in writing.

---

## Tier 5 — Polish

Nice to have. Skip in the first iteration; add in v2 once the bot is working.

| Data point | JSON path | Notes |
|---|---|---|
| Custom theme tokens | `theme.tokens` | If provided, overrides the chosen `theme` attribute. Pull from their website's CSS — primary color, surface, text — and map to `--ena-*` tokens. |
| Avatar text/letter | `header.avatar_text` | Single character shown in the chat header. Default "A". |
| Custom font | `theme.tokens['--ena-font']` | Match their site's font stack if it's distinctive. |
| Background image | `theme.tokens['--ena-bg-image']` | Subtle pattern or gradient. Use sparingly — chat readability comes first. |

---

## Intake workflow

Three-step process. Do not compress this — clients aren't disciplined enough to give you everything in one shot.

### Step 1 — Self-serve form (asynchronous)

Send a Google Form or Typeform with the questions in the next section. Time estimate to client: **15 minutes**. They fill it at their pace; you get structured data back.

Critical question to include: *"Upload or paste your most common 8–15 customer questions"* — this is how you mine FAQs without asking the client to write FAQs (most can't write FAQs cold).

### Step 2 — Discovery call (30 minutes)

Once the form is back, schedule a call. Use it to nail Tier 3 (lead capture flow) and Tier 4 (guardrails). These are conversations, not form fields.

Record the call (with consent). The recording gives you the tone description in the client's own voice — way more authentic than what they'd write in a form.

In this call, also confirm:
- Who installs the snippet (their web dev, their marketing agency, you with FTP access)
- Where leads should land (their email, a CRM, an existing webhook)
- Who's the approval gatekeeper for FAQ answers — usually the business owner, not marketing

### Step 3 — Build → staging → review

You build the customer JSON, deploy to a staging slug (e.g. `acme-dental-preview`), send the client a link to a mock site with the widget running. They poke at it for 24–48h, send back changes. Iterate. Promote to production by changing the slug to `acme-dental`.

---

## The intake form — copy verbatim into Google Forms

### Section 1 — About your business

1. Business name
2. What kind of business is it? (one sentence)
3. Address
4. Website URL
5. Main phone number
6. Email
7. Languages your team speaks (multi-select)

### Section 2 — When you're open

8. Monday hours (or "closed")
9. Tuesday hours
10. Wednesday hours
11. Thursday hours
12. Friday hours
13. Saturday hours
14. Sunday hours

### Section 3 — Services and prices

15. List up to 10 services you offer. For each: **name**, **price** (or "from €X"), **duration** (optional), **notes** (optional).

### Section 4 — What people ask you

16. Paste your most common 8–15 customer questions, one per line. Pull from email, phone notes, walk-ins. **Don't write answers yet — we'll draft them with you.**
17. Which questions do you wish a chatbot could handle so you stop getting them on the phone?

### Section 5 — Tone

18. Pick three adjectives that describe how your team talks to customers.
19. Anything we should *not* sound like? (e.g. "too American", "salesy", "cold")

### Section 6 — Booking flow

20. When someone wants to book, what info do you need from them?
21. Where should those leads go? (email, Zapier webhook, CRM — pick one and provide the address)
22. What should the bot say after collecting their info?

### Section 7 — Compliance

23. Are there things the bot should never tell customers? (medical advice, prices not on the list, insurance specifics, etc.)
24. If a customer describes an emergency, what should the bot do?

### Section 8 — Branding

25. Primary brand colour (hex code if you know it, otherwise a link to your style guide)
26. Logo file (optional, for future use)

That's 26 fields. ~15 minutes for the client. Covers Tier 1 + Tier 2 + entry points to Tier 3/4.

---

## Common gotchas to plan for

1. **The FAQ answers are the bottleneck.** Clients send questions but rarely answers. Build a workflow where *you* draft answers from their website copy, and they only need to approve / edit. Speeds onboarding 5×.

2. **"Make it sound like us" is not a brief.** Pull tone from their existing emails or website copy. Write 3 sample bot responses and send for approval — much faster than abstract tone discussion.

3. **Pricing is contentious.** Owners want "discuss prices in person". A bot that quotes nothing is useless. Compromise: list a starting price + *"exact pricing depends on your individual case, the team will confirm at your visit."*

4. **Lead webhook is a tech-team conversation.** The marketing person doesn't know what a webhook is. Either: (a) you set up Zapier on their behalf and pass through the cost, or (b) loop in someone technical on their side.

5. **GDPR for German clients.** They must update their *Datenschutzerklärung* to mention the chatbot, name the data flow (their site → your Railway → LLM provider), and sign an *Auftragsverarbeitungsvertrag* (DPA) with you. Templatize the DPA — same one for every client.

6. **Owners who say "the bot should book directly into our calendar"** — possible (Cal.com, Calendly, Acuity webhooks) but adds 1–2 weeks of integration work per system. Default flow is collect-and-handoff, not direct booking. Set this expectation early.

7. **Industry-specific guardrails are non-obvious.** Dental: emergency triage, no diagnosis. Legal: no legal advice, no case-outcome predictions. Restaurant: no allergen guarantees, no real-time table availability. Build a checklist per vertical you target.

---

## After intake — the handoff to a JSON build

Once you have all the data, the build is mechanical:

1. Copy [`src/customers/acme-dental.json`](../src/customers/acme-dental.json) → `src/customers/<new-slug>.json`.
2. Replace every field with the intake answers.
3. Map theme colors to `--ena-*` tokens (see the schema in [`src/themes/`](../src/themes/) for the full list).
4. Commit, push, Railway redeploys.
5. Test on a mock site (`demo/<new-slug>-mock.html`) — see [`demo/acme-dental-mock.html`](../demo/acme-dental-mock.html) for the template.
6. Send the client the staging mock for review.
7. After sign-off, send them the embed snippet for their actual site.

---

## Checklist for kickoff

Use this as a one-page kickoff checklist when starting a new client:

- [ ] Intake form sent
- [ ] Intake form returned, all Tier 1 fields filled
- [ ] Discovery call scheduled
- [ ] Tier 3 features confirmed (lead capture? emergency line?)
- [ ] Tier 4 guardrails signed off by owner (in writing)
- [ ] FAQ answers drafted and approved
- [ ] Customer JSON built and committed
- [ ] Mock demo site sent to client
- [ ] Client sign-off received
- [ ] Snippet sent for installation
- [ ] Live install verified (browser DevTools, no CSP errors, widget loads)
- [ ] First test message round-trips successfully
- [ ] Client added to monitoring / billing
