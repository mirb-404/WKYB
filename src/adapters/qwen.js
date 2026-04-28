// Qwen adapter — uses the OpenAI-compatible endpoint exposed by DashScope,
// Ollama, vLLM, LM Studio's /v1, or any custom backend proxy. Streaming via SSE.
//
// Adapter contract:
//   send(messages, { signal, onToken }): Promise<void>
// Swap this file for a different provider without touching engine or UI.

const DEFAULT_BASE_URL = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';

export class QwenAdapter {
  constructor({ apiKey, baseUrl, model, extra } = {}) {
    this.apiKey = apiKey || '';
    this.baseUrl = stripTrailingSlash(baseUrl || DEFAULT_BASE_URL);
    this.model = model || 'qwen-plus';
    this.extra = extra || {};
  }

  // Selectively assign so unset values don't clobber defaults.
  update(config = {}) {
    if (config.apiKey !== undefined) this.apiKey = config.apiKey || '';
    if (config.baseUrl) this.baseUrl = stripTrailingSlash(String(config.baseUrl));
    if (config.model) this.model = config.model;
    if (config.extra && typeof config.extra === 'object') this.extra = config.extra;
  }

  async send(messages, { signal, onToken } = {}) {
    if (!this.apiKey) throw new Error('Missing API key');
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error('No messages to send');
    }
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    let res;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          stream: true,
          ...this.extra,
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
    if (!res.body) {
      // Server didn't stream — fall back to one-shot JSON parse.
      const data = await res.json().catch(() => null);
      const out = data?.choices?.[0]?.message?.content;
      if (typeof out === 'string' && out) onToken?.(out);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (parseSSELine(line, onToken)) return; // [DONE]
        }
      }
      // Flush any remaining buffered line at stream end.
      buffer += decoder.decode();
      if (buffer.trim()) parseSSELine(buffer, onToken);
    } finally {
      try { reader.releaseLock(); } catch { /* already released */ }
    }
  }
}

// Returns true if the line was a `[DONE]` sentinel — caller should stop reading.
function parseSSELine(line, onToken) {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith('data:')) return false;
  const payload = trimmed.slice(5).trim();
  if (payload === '[DONE]') return true;
  try {
    const json = JSON.parse(payload);
    const delta = json.choices?.[0]?.delta?.content;
    if (typeof delta === 'string' && delta) onToken?.(delta);
  } catch {
    // ignore malformed chunk
  }
  return false;
}

function stripTrailingSlash(url) {
  return String(url).replace(/\/+$/, '');
}
