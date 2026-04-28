// LM Studio native REST adapter — POSTs to /api/v1/chat with the
// { model, system_prompt, input } shape (different from the OpenAI-compat
// /v1/chat/completions endpoint). Same Adapter contract as Qwen, so it
// drops into the engine without UI changes:
//   send(messages, { signal, onToken }): Promise<void>
//
// Native endpoint is non-streaming, so we emit the full response as a
// single onToken() call to keep the UI behavior consistent.

export class LMStudioAdapter {
  constructor({ baseUrl, model } = {}) {
    this.baseUrl = (baseUrl || 'http://127.0.0.1:1234').replace(/\/+$/, '');
    this.model = model || 'google/gemma-3-1b';
  }

  update(config = {}) {
    if (config.baseUrl) this.baseUrl = String(config.baseUrl).replace(/\/+$/, '');
    if (config.model) this.model = config.model;
    // apiKey is intentionally ignored — LM Studio's local server is open.
  }

  async send(messages, { signal, onToken } = {}) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (!Array.isArray(messages)) throw new Error('Messages must be an array');

    const { systemPrompt, input } = flatten(messages);
    if (!input) throw new Error('Empty input — nothing to send');

    let res;
    try {
      res = await fetch(`${this.baseUrl}/api/v1/chat`, {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          ...(systemPrompt ? { system_prompt: systemPrompt } : {}),
          input,
        }),
      });
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      throw new Error(`Network error — ${err?.message || 'unreachable'}`);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} — ${text.slice(0, 200) || res.statusText}`);
    }

    const data = await res.json();
    const out = extractText(data);
    if (!out) {
      // Only log the raw shape when extraction fails — keeps the console
      // clean during normal operation while preserving debuggability.
      console.warn('[lmstudio] could not extract text from response:', data);
      const keys = Object.keys(data || {}).join(', ') || 'none';
      throw new Error(`Unrecognized response shape (top-level keys: ${keys}). See console.`);
    }
    onToken?.(out);
  }
}

// Engine sends the full message history; this endpoint takes a single
// `input` string. Strategy:
//   - System messages collapse into `system_prompt`.
//   - Single fresh turn → send raw user content as `input`.
//   - Multi-turn → concatenate with role markers so the model has context.
function flatten(messages) {
  const systemPrompt = messages
    .filter(m => m.role === 'system')
    .map(m => m.content)
    .join('\n')
    .trim() || null;

  const turns = messages.filter(m => m.role !== 'system');

  const input = turns.length === 1 && turns[0].role === 'user'
    ? turns[0].content
    : turns
        .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
        .join('\n');

  return { systemPrompt, input };
}

// LM Studio's native response shape varies across versions and may nest
// the text inside arrays of content blocks. We walk known content-bearing
// keys recursively, ignoring metadata branches (stats, ids, etc.) and
// stop at the first non-trivial string we find.
const META_KEYS = new Set([
  'model_instance_id', 'response_id', 'stats', 'usage', 'id', 'created',
  'model', 'finish_reason', 'index', 'logprobs', 'role', 'type',
]);
const TEXT_KEYS = ['content', 'text', 'output', 'message', 'response', 'delta', 'result'];

function extractText(data) {
  if (typeof data === 'string') return data;
  return walk(data);
}

function walk(node) {
  if (typeof node === 'string') return node.trim() ? node : null;
  if (Array.isArray(node)) {
    const parts = node.map(walk).filter(Boolean);
    return parts.length ? parts.join('') : null;
  }
  if (!node || typeof node !== 'object') return null;

  // Prefer assistant messages if this looks like a chat-message object.
  if (node.role && node.role !== 'assistant' && typeof node.content === 'string') {
    return null;
  }
  for (const key of TEXT_KEYS) {
    if (key in node) {
      const found = walk(node[key]);
      if (found) return found;
    }
  }
  // Fall back to scanning remaining keys (skip metadata).
  for (const [k, v] of Object.entries(node)) {
    if (META_KEYS.has(k) || TEXT_KEYS.includes(k)) continue;
    const found = walk(v);
    if (found) return found;
  }
  return null;
}
