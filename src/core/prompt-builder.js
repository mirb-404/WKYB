// Composes a system prompt string from a customer config object.
// Pure function — no DOM, no fetch. Easy to test, easy to reason about.
//
// Each section returns a string or null. `null` sections are skipped so
// that partial configs (e.g. no FAQ yet) still produce a clean prompt.

export function buildSystemPrompt(config) {
  if (!config || typeof config !== 'object') return '';
  const sections = [
    identity(config),
    scopeBlock(config),
    languageBlock(config),
    tone(config),
    contactBlock(config),
    hoursBlock(config),
    servicesBlock(config),
    faqBlock(config),
    guardrailsBlock(config),
    leadCaptureBlock(config),
    styleClosing(config),
  ];
  return sections.filter(Boolean).join('\n\n');
}

// Language-matching directive. Placed early (after scope) so it sits in the
// model's primacy zone, AND repeated in styleClosing for recency. Without
// this, content-heavy prompts (e.g. FAQs all in German) overwhelm the
// "match user's language" rule and the bot answers in the dominant language
// regardless of what the user types.
function languageBlock(c) {
  const langs = c.business?.languages_spoken;
  const list = Array.isArray(langs) && langs.length
    ? langs.join(', ')
    : 'the languages your team speaks';
  return [
    '# LANGUAGE — STRICT',
    `ALWAYS reply in the SAME language the user is currently writing in.`,
    `If they write in English, reply in English. If they write in German, reply in German.`,
    `Switch immediately when they switch — do not stick with the previous language.`,
    `The instructions in this prompt may be written in one language, but you are not bound to that language. Match the user's language, even if it differs from the language of these instructions.`,
    '',
    `Supported languages: ${list}. If the user writes in a language not in this list, politely answer in English and offer to connect them with a team member.`,
  ].join('\n');
}

function identity(c) {
  const b = c.business || {};
  if (!b.name) return null;
  const where = b.address ? ` located at ${b.address}` : '';
  const what  = b.type ? `, a ${b.type}` : '';
  return `You are the assistant for **${b.name}**${what}${where}. Answer questions for visitors to the website on behalf of this business only.`;
}

function scopeBlock(c) {
  const b = c.business || {};
  const name = b.name || 'this business';
  const type = b.type || 'business';
  return [
    '# SCOPE — STRICT',
    `You ONLY answer questions about ${name}.`,
    `Refuse anything unrelated to ${type} — including politics, news, history, sports, celebrities, other companies, weather, coding, or general-knowledge questions. Do not answer them even briefly.`,
    '',
    'When the user asks something off-topic, reply with one short sentence like:',
    `"I can only help with questions about ${name}. Did you have a question about our services?"`,
    '',
    'Then stop. Do not provide any off-topic information, even as a partial answer.',
  ].join('\n');
}

function tone(c) {
  return c.tone ? `# Tone\n${c.tone}` : null;
}

function contactBlock(c) {
  const b = c.business || {};
  const lines = [];
  if (b.phone)            lines.push(`- Phone: ${b.phone}`);
  if (b.emergency_line)   lines.push(`- Emergency line: ${b.emergency_line}`);
  if (b.email)            lines.push(`- Email: ${b.email}`);
  if (b.website)          lines.push(`- Website: ${b.website}`);
  if (Array.isArray(b.languages_spoken) && b.languages_spoken.length) {
    lines.push(`- Languages spoken: ${b.languages_spoken.join(', ')}`);
  }
  return lines.length ? `# Contact\n${lines.join('\n')}` : null;
}

function hoursBlock(c) {
  const h = c.business?.hours;
  if (!h || typeof h !== 'object') return null;
  const lines = Object.entries(h)
    .filter(([_, time]) => time != null && String(time).trim())
    .map(([day, time]) => `- ${cap(day)}: ${time}`);
  return lines.length ? `# Hours\n${lines.join('\n')}` : null;
}

function servicesBlock(c) {
  if (!Array.isArray(c.services) || !c.services.length) return null;
  const lines = c.services.map(s => {
    const parts = [s.name];
    if (s.price)    parts.push(s.price);
    if (s.duration) parts.push(s.duration);
    const tail = s.notes ? ` (${s.notes})` : '';
    return `- ${parts.join(' — ')}${tail}`;
  });
  return [
    '# Services and prices',
    'You may ONLY quote the prices listed below. For services or prices not listed, do not invent a number — say the practice will provide a quote.',
    lines.join('\n'),
  ].join('\n');
}

function faqBlock(c) {
  if (!Array.isArray(c.faq) || !c.faq.length) return null;
  const blocks = c.faq
    .filter(item => item && item.q && item.a)
    .map(({ q, a }) => `Q: ${q}\nA: ${a}`);
  if (!blocks.length) return null;
  return [
    '# Reference answers',
    'These are the most common questions and the answers we have approved. Adapt them to the user\'s phrasing — do not copy verbatim unless the question matches exactly.',
    '',
    blocks.join('\n\n'),
  ].join('\n');
}

function guardrailsBlock(c) {
  if (!Array.isArray(c.guardrails) || !c.guardrails.length) return null;
  return `# Strict rules — never violate\n${c.guardrails.map(g => `- ${g}`).join('\n')}`;
}

function leadCaptureBlock(c) {
  const lc = c.lead_capture;
  if (!lc) return null;

  const intents = Array.isArray(lc.trigger_intents) && lc.trigger_intents.length
    ? lc.trigger_intents.join(', ')
    : 'booking, appointment, callback, quote';

  const fieldLines = Array.isArray(lc.fields) && lc.fields.length
    ? lc.fields.map(f => {
        const label = f.label || f.key;
        const tag = f.required ? '(required)' : '(optional)';
        return `- ${label} ${tag}`;
      }).join('\n')
    : '- Name (required)\n- Phone (required)';

  const fieldKeys = (Array.isArray(lc.fields) ? lc.fields : [])
    .map(f => f.key)
    .filter(Boolean);
  const leadFormat = fieldKeys.length
    ? fieldKeys.map(k => `${k}="..."`).join(', ')
    : 'name="...", phone="..."';

  const confirm = lc.confirmation_message
    || 'Thanks — I\'ve sent your details. The team will be in touch shortly.';

  return [
    '# Booking and lead capture',
    `When the user signals any of these intents — ${intents} — politely collect:`,
    fieldLines,
    '',
    'Ask for one or two fields at a time, not all at once. Once you have all required fields, do TWO things in order:',
    '',
    `1. Output a single line in this exact format on its own line:`,
    `   [LEAD: ${leadFormat}]`,
    `2. Then reply with this confirmation, exactly:`,
    `   "${confirm}"`,
    '',
    'Do not output the [LEAD: ...] line before all required fields are collected.',
  ].join('\n');
}

function styleClosing(c) {
  const name = c.business?.name || 'the business';
  return [
    '# General style',
    '- Keep replies short — 2–3 sentences when possible.',
    '- Plain language. No jargon.',
    '- If you don\'t know something, say so and offer to have the team follow up.',
    `- Reminder: refuse any question that isn't about ${name}. (See SCOPE rule above.)`,
    '',
    '# FINAL REMINDER — LANGUAGE',
    'Match the user\'s language on EVERY reply. Re-check the user\'s most recent message before responding: if it is in English, reply in English; if in German, reply in German. Do NOT default to the language of this prompt.',
  ].join('\n');
}

function cap(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
