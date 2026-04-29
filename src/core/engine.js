// Core chat engine — pure logic, no DOM.
// Owns conversation state and emits events. UI subscribes; adapter is injected.
//
// Session tracking: `_session` bumps on reset/cancel. Any in-flight send
// captures the session at start and ignores its own emits if the session
// has changed — prevents stale tokens or errors from leaking into a new
// conversation after reset.

export class ChatEngine extends EventTarget {
  constructor({ adapter, systemPrompt = null } = {}) {
    super();
    this.adapter = adapter;
    this.messages = [];
    if (systemPrompt) {
      this.messages.push({ role: 'system', content: systemPrompt });
    }
    this._abort = null;
    this._session = 0;
    this._busy = false;
  }

  get busy() { return this._busy; }

  setAdapter(adapter) {
    this.adapter = adapter;
  }

  reset(systemPrompt = null) {
    this._session++;
    this.cancel();
    this.messages = systemPrompt ? [{ role: 'system', content: systemPrompt }] : [];
    this._busy = false;
    this._emit('reset');
  }

  cancel() {
    if (this._abort) {
      this._abort.abort();
      this._abort = null;
    }
  }

  async send(content) {
    if (!content?.trim()) return;

    // Surface "no adapter" as an error event rather than throwing — the
    // call site (UI) doesn't await this promise, so a throw becomes an
    // unhandled rejection. Events are how the UI already learns about errors.
    if (!this.adapter) {
      this._emit('error', { id: null, error: 'No adapter configured' });
      return;
    }

    // A previous send is still streaming — cancel it. The bump-then-cancel
    // order means the old send's catch/finally see a session mismatch and
    // skip their emits (no stale "Cancelled." bubble in the new conversation).
    if (this._busy) this.cancel();

    const session = ++this._session;
    this._busy = true;

    const userMsg = { role: 'user', content: content.trim(), id: cryptoId() };
    this.messages.push(userMsg);
    this._emit('message', userMsg);

    const botMsg = { role: 'assistant', content: '', id: cryptoId(), streaming: true };
    this.messages.push(botMsg);
    this._emit('message', botMsg);

    this._abort = new AbortController();
    const signal = this._abort.signal;

    try {
      await this.adapter.send(this._payloadMessages(), {
        signal,
        onToken: (delta) => {
          if (session !== this._session) return;
          if (typeof delta !== 'string' || !delta) return;
          botMsg.content += delta;
          this._emit('token', { id: botMsg.id, delta, full: botMsg.content });
        },
      });
      if (session !== this._session) return;
      botMsg.streaming = false;
      this._emit('complete', botMsg);
    } catch (err) {
      if (session !== this._session) return;
      botMsg.streaming = false;
      botMsg.error = err?.name === 'AbortError' ? 'cancelled' : (err?.message || 'failed');
      this._emit('error', { id: botMsg.id, error: botMsg.error });
    } finally {
      if (session === this._session) {
        this._busy = false;
        this._abort = null;
      }
    }
  }

  // Send the system prompt + last N user/assistant turns to the LLM.
  // Caps cost at long conversations and keeps the system prompt close to
  // the latest user message — small models lose attention on rules that
  // sit far from the end of context. 10 turns ≈ 5 user-assistant pairs,
  // enough for natural follow-ups without the bot forgetting its scope.
  _payloadMessages() {
    const HISTORY_TURNS = 10;
    const valid = this.messages.filter(
      m => !m.error && (m.role !== 'assistant' || m.content)
    );
    const system = valid.filter(m => m.role === 'system');
    const turns  = valid.filter(m => m.role !== 'system').slice(-HISTORY_TURNS);
    // Drop any leading assistant message so the trimmed history starts
    // with a user turn — some models get confused by an "orphan" assistant
    // turn at the start of context with no preceding user message.
    while (turns.length && turns[0].role !== 'user') turns.shift();
    return [...system, ...turns].map(({ role, content }) => ({ role, content }));
  }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}

function cryptoId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return 'm-' + Math.random().toString(36).slice(2, 10);
}
