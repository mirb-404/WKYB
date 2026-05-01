# International Client Considerations

What changes — and what doesn't — when ena-chat moves beyond its initial German/EU market. Build per-real-client, not per-hypothetical-region.

Companion to [Per-Client Onboarding Workflow](260429_Per-Client-Onboarding-Workflow.md). Both apply when onboarding any client; this doc adds the dimensions that surface specifically for non-EU or non-German prospects.

---

## Where the product stands today

| Dimension | State | International-ready? |
|---|---|---|
| LLM language understanding | Multilingual via Llama / Gemma / Qwen | Yes |
| System prompt language | Per-customer JSON, freeform | Yes — write any language |
| Bot reply language | Matches user's input (enforced via [`prompt-builder.js`](../src/core/prompt-builder.js) `languageBlock`) | Yes |
| Widget UI strings (placeholder, errors) | Hardcoded English in [`chat-element.js`](../src/ui/chat-element.js) | **No** — needs translation per language |
| Currency in services | Plaintext per JSON (`"€80"`, `"$100"`) | Yes — each customer JSON sets its own |
| Hours timezone | Implicit (visitor assumes business's local TZ) | **Ambiguous** for cross-TZ visitors |
| RTL languages (Arabic, Hebrew, Persian, Urdu) | LTR-only CSS in [`styles.js`](../src/ui/styles.js) | **No** — panel layout would be wrong |
| Server location | Single region: Railway `europe-west4` (Netherlands) | EU-fine; suboptimal for US/Asia latency |
| Compliance docs (DPA, privacy notice) | German template only (planned) | **No** — need per-jurisdiction variants |

---

## The five dimensions of "international"

### 1. Multilingual widget UI

**Problem:** strings inside the chat panel — the textarea placeholder, the empty-state greeting, the error messages — are hardcoded English. A German bot saying "Type a message…" in the input field looks unfinished.

**Fix pattern:** add a `ui` block to the customer JSON that the widget reads, with English fallbacks for any missing fields:

```json
"ui": {
  "placeholder": "Schreiben Sie eine Nachricht…",
  "greeting_fallback": "Hallo! Wie kann ich helfen?",
  "errors": {
    "rate_limit": "Wir sind kurz beschäftigt — bitte versuchen Sie es in ein paar Sekunden erneut.",
    "unavailable": "Entschuldigung, der Assistent ist kurz nicht verfügbar. Bitte rufen Sie uns an, wenn es dringend ist.",
    "network": "Verbindungsproblem — bitte prüfen Sie Ihre Internetverbindung.",
    "no_adapter": "Chat ist nicht konfiguriert. Bitte aktualisieren Sie die Seite."
  }
}
```

**Implementation cost:** ~30 minutes — modify `_friendlyError` and `_renderMessagesEmpty` in [`chat-element.js`](../src/ui/chat-element.js) to read these fields with fallbacks.

**When to do it:** before the first non-English-speaking client launches. Not before.

### 2. Timezone-aware hours

**Problem:** a visitor in New York sees `Mon: 08:00–18:00` for a Bremen dental practice and may interpret it as their local time. Implicit ambiguity.

**Fix pattern:** add `business.timezone` (IANA TZ name) to customer JSON:

```json
"business": {
  "timezone": "Europe/Berlin",
  "hours": { ... }
}
```

Inject the timezone into the system prompt via [`prompt-builder.js`](../src/core/prompt-builder.js) so the bot can clarify:

> *"Hours are listed in Europe/Berlin time. If a user asks about your hours from a different timezone, mention this and offer to convert."*

**Implementation cost:** ~10 minutes — extend `hoursBlock` in `prompt-builder.js`.

**When to do it:** when a client has a meaningful share of out-of-region visitors. Most SMB clients don't — their visitors share a timezone with them. Defer.

### 3. Server location and data residency

**Problem (latency):** Railway is in `europe-west4`. US visitors add ~100ms one-way. For streaming chat, barely noticeable. For real-time voice (which you don't have), it'd matter.

**Problem (compliance):** some clients require their data to be processed in their own jurisdiction. EU clients increasingly insist on EU-hosted; US enterprise clients prefer US-hosted; financial/healthcare clients in Asia want regional hosting.

**Fix path:** deploy per-region Railway instances when a client demands it. Each region gets its own subdomain:
- `wkyb-eu.up.railway.app` (current — `europe-west4`)
- `wkyb-us.up.railway.app` (would deploy in `us-east4` or `us-west1`)
- `wkyb-asia.up.railway.app` (would deploy in `asia-southeast1`)

Client snippet points at their region:

```html
<script type="module" src="https://wkyb-us.up.railway.app/src/ui/chat-element.js"></script>
<ena-chat customer="..." base-url="https://wkyb-us.up.railway.app/llm" model="...">
</ena-chat>
```

**Implementation cost:** ~30 minutes per new region — fork the Railway service, update DNS, set env vars, push.

**When to do it:** when a paying client specifically requests it. Architecture already supports this; no code changes needed.

### 4. RTL language support

**Problem:** [`styles.js`](../src/ui/styles.js) uses LTR-anchored properties (`right`, `margin-left`, `border-bottom-right-radius`). Panel renders mirrored from a native Arabic/Hebrew/Persian/Urdu speaker's expectation: input field on wrong side, send button flipped, bubble alignment reversed.

**Fix pattern:**
1. Add `ui.direction: "rtl"` to customer JSON.
2. In [`chat-element.js`](../src/ui/chat-element.js), set `dir="rtl"` on the panel root when this is true.
3. Replace LTR-only CSS in `styles.js` with logical equivalents:
   - `right` → `inset-inline-end`
   - `left` → `inset-inline-start`
   - `margin-left` → `margin-inline-start`
   - `border-bottom-right-radius` → `border-end-end-radius`

**Implementation cost:** ~2 hours, mostly the CSS audit.

**When to do it:** when an RTL-language client signs. Don't pre-build.

### 5. Compliance per jurisdiction

| Jurisdiction | Compliance regime | Document needed |
|---|---|---|
| Germany | GDPR | Auftragsverarbeitungsvertrag (DPA), Datenschutzerklärung snippet |
| EU (other) | GDPR | Same DPA, translated as needed |
| UK | UK GDPR | UK-specific DPA (similar but separate) |
| US — California | CCPA | Privacy notice + "Do Not Sell My Personal Information" link |
| US — other states (VA, CO, CT, UT...) | State patchwork | Each state's privacy notice |
| Brazil | LGPD | LGPD-compliant data processing agreement |
| Canada | PIPEDA | Privacy notice (less strict than GDPR) |
| Australia | Privacy Act 1988 | Privacy notice with APP compliance |

**Fix pattern:** get a base DPA template from a lawyer in your home jurisdiction (~€500 in Germany). Each new jurisdiction adds an extension/markup (~€200–500 per region with the same lawyer or a local one).

**When to do it:** sign the local DPA with each client whose jurisdiction differs from your existing templates. Lawyers do this work mechanically once they have your base template.

---

## What works today for non-German EU clients

A French dental practice wanting to onboard:

- ✓ Bot speaks French (LLM handles it)
- ✓ Customer JSON in French (FAQ, tone, etc.)
- ✓ German DPA template usually translates with minor markup
- ✓ Server location (Netherlands) is GDPR-compliant
- ✗ Widget UI strings still in English
- ✗ Datenschutzerklärung snippet would need French translation

**Net work for first French client:** translate the `ui` block + Datenschutzerklärung. ~1 hour.

---

## What works today for English-speaking non-EU clients

A Boston-area dental practice wanting to onboard:

- ✓ Bot speaks English (default)
- ✓ Widget UI in English (default)
- ✓ Customer JSON in English
- ✗ German DPA doesn't apply — need US/Massachusetts-specific privacy notice
- ⚠ Server in Netherlands — adds ~100ms latency. Acceptable, not great. They might prefer US-hosted.
- ⚠ "Hours" in Europe/Berlin time — ambiguous if their site has international traffic

**Net work for first US client:** US privacy notice from a lawyer (~€500), optionally a US-region Railway deploy if they care about latency or data residency. ~1–2 days including the lawyer turnaround.

---

## What needs real work for non-Latin-script clients

A Saudi Arabian dental practice wanting to onboard:

- ✓ Bot speaks Arabic (LLM handles)
- ✓ Customer JSON in Arabic (RTL text in `tone`, `faq`, etc.)
- ✗ Widget UI in English (looks broken next to Arabic content)
- ✗ Panel rendered LTR (input on wrong side from RTL native expectation)
- ✗ DPA — Saudi Arabia has its own data protection law; need a local lawyer
- ⚠ Server in Netherlands — fine for compliance, ~150ms latency

**Net work for first Saudi client:** RTL CSS pass + Arabic UI strings + Saudi DPA. ~half-day code + €500–1000 legal.

---

## Decision tree per client

```
New client comes in
  │
  ├─ German? → German DPA + ship. Default deployment.
  │
  ├─ Other EU? → German DPA usually applies (small markup). Translate UI strings if non-English. Ship.
  │
  ├─ UK? → UK-specific DPA. English UI works. Ship.
  │
  ├─ US?
  │   ├─ Cares about US-hosting? → Spin up wkyb-us instance, US DPA. ~half-day.
  │   └─ Doesn't care? → Use existing EU instance, US DPA. ~2 hours.
  │
  ├─ Asian (English/CJK)?
  │   ├─ China-mainland? → Special case (China requires onshore hosting + ICP license). Decline or partner locally.
  │   └─ Other? → Local DPA, optionally Asia-region deploy. ~half-day code + legal.
  │
  └─ RTL language client?
      → Add RTL CSS pass + UI strings + local DPA. ~1 day code + legal.
```

---

## What NOT to pre-build

Resist the urge to build for hypothetical clients you don't have. Specifically:

| Don't build | Why |
|---|---|
| 12-language UI translation framework | The `ui` block per customer JSON scales fine for SMB. Add languages on demand. |
| Multi-region deploy automation | Manual per-region deploy is fine until you have 5+ regions. |
| Complex i18n library integration | Overkill. Customer JSONs cover localization needs. |
| Pre-emptive DPAs for 10 jurisdictions | ~€5,000 sunk cost. Get them per-paying-client instead. |
| RTL CSS until first RTL client | Adds maintenance burden. Wait. |
| Currency conversion logic | Each business has one currency. Plaintext in JSON is correct. |

---

## What to do BEFORE you go after international clients

Order matters. Don't pursue international before you've validated locally.

1. **Onboard one German client to revenue.** Validates the product, the pricing, and the German DPA. Without this, internationalization is premature.
2. **Get a French/UK/Spanish English-speaking client.** Validates that the EU-hosted setup works for non-German EU. Same DPA, minor translation work.
3. **Then consider US.** First non-EU client surfaces real US compliance + latency questions. Stand up `wkyb-us` only when this client signs.
4. **RTL/Asian markets last.** Highest engineering and legal cost; lowest near-term ROI for an SMB chat product.

---

## Schema changes that would future-proof the project

Adding these now (even unused) makes future internationalization a JSON edit, not a code change:

| Field | Purpose | Code change required |
|---|---|---|
| `ui.placeholder`, `ui.errors.*`, `ui.greeting_fallback` | Per-customer UI strings | ~30 min |
| `ui.direction: "rtl" \| "ltr"` | RTL flag | Part of RTL pass |
| `business.timezone` | TZ-aware hours | ~10 min in prompt-builder |
| `business.currency` | Cleaner price formatting (optional) | None — already plaintext |

Do these when the second non-German prospect appears. Not before.

---

## Cross-references

- For data fields and intake: see [Client Data Intake](260429_Client-Data-Intake.md). When onboarding a non-German client, expect to also collect: `ui` translations, jurisdiction (for legal), timezone, and any RTL flag.
- For the actual onboarding flow: see [Per-Client Onboarding Workflow](260429_Per-Client-Onboarding-Workflow.md). The steps are identical for international clients; only the legal docs and (sometimes) the UI strings differ.
- For pre-launch hardening: see [Production Readiness Checklist](260429_Production-Readiness-Checklist.md) — the GDPR / DPA section is the EU baseline, extend per-region as you grow.

---

## TL;DR for one-pager copy

> **ena-chat is internationalization-friendly by design.** Per-customer JSONs already let any language live in the system prompt; the LLM handles translation. The remaining gaps — widget UI strings, RTL layout, per-jurisdiction DPAs — are bounded fixes that we add when a real international client signs, not before. For most non-German EU clients, the work is ~1 hour of translation. For US clients, ~2 hours plus a local DPA. RTL/Saudi/Asian markets need ~1 day of work and local legal counsel.
