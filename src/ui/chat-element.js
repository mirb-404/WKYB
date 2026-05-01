// <ena-chat> custom element. Owns Shadow DOM, wires Engine + Adapter to UI,
// and applies themes by writing CSS custom properties to its host root.

import { ChatEngine } from '../core/engine.js';
import { QwenAdapter } from '../adapters/qwen.js';
import { buildSystemPrompt } from '../core/prompt-builder.js';
import { styles } from './styles.js';

const THEME_BASE = new URL('../themes/', import.meta.url);
const CUSTOMER_BASE = new URL('../customers/', import.meta.url);

const ICON_CHAT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
const ICON_CLOSE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
const ICON_SEND = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;
const ICON_STOP = `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`;

export class EnaChat extends HTMLElement {
  static get observedAttributes() {
    return ['theme', 'api-key', 'base-url', 'model', 'header-title', 'system-prompt', 'customer'];
  }

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = styles;
    root.appendChild(style);

    root.appendChild(this._renderLauncher());
    this._panel = this._renderPanel();
    this._panel.hidden = true;
    root.appendChild(this._panel);

    this._adapter = new QwenAdapter({});
    this._engine = new ChatEngine({ adapter: this._adapter });
    this._engine.addEventListener('message', e => {
      this._appendMessage(e.detail);
      if (e.detail.role === 'assistant') this._setBusy(true);
      // Save user messages immediately (assistant messages are partial here
      // and will be saved on 'complete' instead).
      if (e.detail.role === 'user') this._saveSession();
    });
    this._engine.addEventListener('token', e => this._updateMessage(e.detail));
    this._engine.addEventListener('complete', e => {
      this._finalizeMessage(e.detail);
      this._setBusy(false);
      this._saveSession();
    });
    this._engine.addEventListener('error', e => {
      this._showError(e.detail);
      this._setBusy(false);
    });
    this._engine.addEventListener('reset', () => {
      this._renderMessagesEmpty();
      this._setBusy(false);
      // Restore is intentionally NOT triggered here — it would mis-fire on
      // customer-unload (restoring the unrelated default session) and on
      // user-initiated reset(). Restore is triggered explicitly from
      // _applyCustomerConfig (post-load) and connectedCallback (standalone).
    });

    this._themeToken = 0;
    this._customerToken = 0;
    this._customGreeting = null;
    this._lastCustomerConfig = null;
    this._renderMessagesEmpty();
    this._updateSendButton();
  }

  connectedCallback() {
    this._applyTheme(this.getAttribute('theme') || 'enadyne');
    this._syncAdapterFromAttrs();
    // Standalone restore: if there's no customer or system-prompt that
    // would trigger a future engine.reset, restore here. Otherwise wait
    // for the 'reset' event handler to do it (so customer's system prompt
    // is in place before history is restored).
    if (!this.hasAttribute('customer') && !this.hasAttribute('system-prompt')) {
      this._restoreSession();
    }
  }

  attributeChangedCallback(name, _old, value) {
    if (name === 'theme') this._applyTheme(value);
    if (name === 'header-title' && this._titleEl) {
      this._titleEl.textContent = value || 'Assistant';
    }
    if (name === 'api-key' || name === 'base-url' || name === 'model') {
      this._syncAdapterFromAttrs();
    }
    if (name === 'system-prompt') this._engine.reset(value || null);
    if (name === 'customer') {
      if (value) {
        // Synchronously tear down any in-flight stream BEFORE the new
        // customer JSON is fetched. Without this, a bot reply finishing
        // mid-switch would call _saveSession with the new customer's
        // storage key, leaking content across customers.
        this._engine.reset(null);
        this._loadCustomer(value);
      } else {
        this._unloadCustomer();
      }
    }
  }

  // ─── Public API ────────────────────────────────────────────────
  open() {
    this._panel.hidden = false;
    this._launcher.hidden = true;
    this._textarea?.focus();
    this._saveSession();
  }
  close() {
    this._panel.hidden = true;
    this._launcher.hidden = false;
    this._saveSession();
  }
  reset() {
    // User-initiated clear: wipe storage first so the post-reset restore
    // finds nothing to bring back.
    try { sessionStorage.removeItem(this._storageKey); } catch { /* ignore */ }
    this._engine.reset(this.getAttribute('system-prompt') || null);
  }
  registerAdapter(adapter) {
    if (!adapter || typeof adapter.send !== 'function') {
      console.warn('[ena-chat] registerAdapter: adapter must expose send()');
      return;
    }
    this._adapter = adapter;
    this._engine.setAdapter(adapter);
    // Re-apply customer sampling overrides to the new adapter so they
    // survive a provider swap.
    if (this._lastCustomerConfig) this._applyAdapterExtras(this._lastCustomerConfig);
  }

  // ─── Rendering ─────────────────────────────────────────────────
  _renderLauncher() {
    const btn = document.createElement('button');
    btn.className = 'launcher';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Open chat');
    btn.innerHTML = ICON_CHAT;
    btn.addEventListener('click', () => this.open());
    this._launcher = btn;
    return btn;
  }

  _renderPanel() {
    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Chat');

    const header = document.createElement('header');
    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = 'Q';
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = this.getAttribute('header-title') || 'Assistant';
    this._titleEl = title;
    const close = document.createElement('button');
    close.className = 'close';
    close.type = 'button';
    close.setAttribute('aria-label', 'Close chat');
    close.innerHTML = ICON_CLOSE;
    close.addEventListener('click', () => this.close());
    header.append(avatar, title, close);

    const messages = document.createElement('div');
    messages.className = 'messages';
    messages.setAttribute('role', 'log');
    messages.setAttribute('aria-live', 'polite');
    this._messagesEl = messages;

    const composer = document.createElement('form');
    composer.className = 'composer';
    composer.addEventListener('submit', e => {
      e.preventDefault();
      this._handleSendOrStop();
    });

    const textarea = document.createElement('textarea');
    textarea.rows = 1;
    textarea.placeholder = 'Type a message…';
    textarea.addEventListener('input', () => {
      this._autoResize(textarea);
      this._updateSendButton();
    });
    textarea.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (this._engine.busy) return; // Enter doesn't cancel; user must click stop
        this._handleSendOrStop();
      }
    });
    this._textarea = textarea;

    const send = document.createElement('button');
    send.className = 'send';
    send.type = 'submit';
    send.setAttribute('aria-label', 'Send');
    send.innerHTML = ICON_SEND;
    this._sendBtn = send;

    composer.append(textarea, send);
    panel.append(header, messages, composer);
    return panel;
  }

  _autoResize(ta) {
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
  }

  _renderMessagesEmpty() {
    if (!this._messagesEl) return;
    this._messagesEl.replaceChildren();
    const empty = document.createElement('div');
    empty.className = 'empty';
    if (this._customGreeting) {
      empty.textContent = this._customGreeting;
    } else {
      const strong = document.createElement('strong');
      strong.textContent = 'Hi there 👋';
      empty.append(strong, document.createTextNode('Ask me anything to get started.'));
    }
    this._messagesEl.appendChild(empty);
    this._bubbles = new Map();
  }

  _appendMessage(msg) {
    if (!this._bubbles) this._bubbles = new Map();
    const empty = this._messagesEl.querySelector('.empty');
    if (empty) empty.remove();

    const bubble = document.createElement('div');
    bubble.className = `bubble ${msg.role === 'user' ? 'user' : 'bot'}`;
    if (msg.role === 'assistant' && !msg.content) {
      const typing = document.createElement('span');
      typing.className = 'typing';
      typing.append(
        document.createElement('span'),
        document.createElement('span'),
        document.createElement('span'),
      );
      bubble.appendChild(typing);
      bubble.dataset.streaming = 'true';
    } else {
      bubble.textContent = msg.content;
    }
    this._messagesEl.appendChild(bubble);
    this._bubbles.set(msg.id, bubble);
    this._scrollToBottom();
  }

  _updateMessage({ id, full }) {
    const bubble = this._bubbles?.get(id);
    if (!bubble) return;
    bubble.textContent = full;
    this._scrollToBottom();
  }

  _finalizeMessage({ id, content }) {
    const bubble = this._bubbles?.get(id);
    if (!bubble) return;
    delete bubble.dataset.streaming;
    if (!content) bubble.textContent = '(no response)';
  }

  _showError({ id, error }) {
    // id may be null for errors raised before any bubble was created
    // (e.g. "No adapter configured" — the user hasn't seen anything yet).
    const bubble = id != null ? this._bubbles?.get(id) : null;
    if (bubble) bubble.remove();
    const empty = this._messagesEl.querySelector('.empty');
    if (empty) empty.remove();
    const err = document.createElement('div');
    err.className = 'bubble error';
    err.textContent = this._friendlyError(error);
    this._messagesEl.appendChild(err);
    this._scrollToBottom();
  }

  // Map raw adapter/proxy error strings to user-facing copy. End-users
  // shouldn't see raw HTTP codes or upstream tracebacks.
  _friendlyError(error) {
    if (error === 'cancelled') return 'Cancelled.';
    const s = String(error || '');
    if (/\b429\b|rate.?limit/i.test(s)) {
      return "We're briefly busy — please try again in a few seconds.";
    }
    if (/\bHTTP 5\d\d\b|\b5\d\d\b/.test(s)) {
      return "Sorry, our assistant is briefly unavailable. Please try again, or call us if it's urgent.";
    }
    if (/network|unreachable|connection/i.test(s)) {
      return "Connection issue — please check your internet and try again.";
    }
    if (/no adapter/i.test(s)) {
      return "Chat is not configured. Please refresh the page.";
    }
    return `Error: ${s}`;
  }

  _scrollToBottom() {
    requestAnimationFrame(() => {
      if (this._messagesEl) this._messagesEl.scrollTop = this._messagesEl.scrollHeight;
    });
  }

  _handleSendOrStop() {
    if (this._engine.busy) {
      this._engine.cancel();
      return;
    }
    const text = this._textarea.value.trim();
    if (!text) return;
    this._textarea.value = '';
    this._autoResize(this._textarea);
    this._updateSendButton();
    this._engine.send(text);
  }

  _setBusy(busy) {
    if (!this._sendBtn) return;
    this._sendBtn.classList.toggle('busy', busy);
    this._sendBtn.innerHTML = busy ? ICON_STOP : ICON_SEND;
    this._sendBtn.setAttribute('aria-label', busy ? 'Stop generating' : 'Send');
    // Keep type=submit so click + Enter both route through the form submit
    // handler, which calls _handleSendOrStop and decides send vs cancel.
    this._updateSendButton();
  }

  _updateSendButton() {
    if (!this._sendBtn || !this._textarea) return;
    if (this._engine?.busy) {
      this._sendBtn.disabled = false;
    } else {
      this._sendBtn.disabled = !this._textarea.value.trim();
    }
  }

  // ─── Customer config ───────────────────────────────────────────
  // A customer JSON bundles theme + business knowledge + system prompt
  // shape. Loading a customer applies all three at once and resets the
  // conversation. Unloading restores defaults.
  async _loadCustomer(slug) {
    if (!slug) return;
    const normalized = String(slug).toLowerCase();
    if (!/^[a-z0-9_-]+$/.test(normalized)) {
      console.warn('[ena-chat] invalid customer slug:', slug);
      return;
    }
    const token = ++this._customerToken;
    try {
      const res = await fetch(new URL(`${normalized}.json`, CUSTOMER_BASE));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const config = await res.json();
      if (token !== this._customerToken) return;
      this._applyCustomerConfig(config);
    } catch (err) {
      console.warn(`[ena-chat] customer "${slug}" failed to load:`, err);
    }
  }

  _unloadCustomer() {
    this._customerToken++;
    this._customGreeting = null;
    this._lastCustomerConfig = null;
    // Wipe inline tokens so any non-overlapping properties from the customer
    // (e.g. unique --ena-bubble-radius) don't leak into the next theme.
    this._clearInlineTokens();
    this._engine.reset(null);
    this._applyTheme(this.getAttribute('theme') || 'enadyne');
  }

  _applyCustomerConfig(config) {
    if (!config || typeof config !== 'object') return;
    this._lastCustomerConfig = config;

    // Bump the theme token so any in-flight _applyTheme call resolves into
    // a no-op — otherwise a slow theme fetch could overwrite customer tokens.
    this._themeToken++;

    if (config.theme?.tokens) this._writeTokens(config.theme.tokens);
    if (config.header?.title) this.setAttribute('header-title', config.header.title);
    this._customGreeting = config.header?.greeting || null;

    // System prompt goes straight to the engine — keeps the (potentially
    // multi-KB) prompt out of the DOM, and triggers a clean conversation reset.
    const prompt = buildSystemPrompt(config);
    this._engine.reset(prompt || null);

    // Restore any persisted history for this specific customer. Triggered
    // explicitly here (not from the engine 'reset' event) so unload and
    // user-initiated resets don't accidentally restore unrelated history.
    this._restoreSession();

    this._applyAdapterExtras(config);
  }

  // Sampling overrides flow into the adapter's `extra` for OpenAI-compat
  // bodies. Model isn't applied here because it's a platform decision
  // (a customer asking for qwen-plus shouldn't break a local LM Studio test).
  _applyAdapterExtras(config) {
    if (!config?.llm || typeof this._adapter?.update !== 'function') return;
    const extra = {};
    if (typeof config.llm.temperature === 'number') extra.temperature = config.llm.temperature;
    if (typeof config.llm.max_tokens === 'number')  extra.max_tokens = config.llm.max_tokens;
    if (Object.keys(extra).length) this._adapter.update({ extra });
  }

  _clearInlineTokens() {
    // Walk the inline-style declaration in reverse (it's live — removing
    // shifts indices) and drop every --ena-* custom property.
    for (let i = this.style.length - 1; i >= 0; i--) {
      const prop = this.style[i];
      if (prop && prop.startsWith('--ena-')) this.style.removeProperty(prop);
    }
  }

  // ─── Session persistence ───────────────────────────────────────
  // sessionStorage scope: same browser tab, cleared on tab close. Survives
  // page navigations within the tab — the use case we want. Keyed by
  // customer slug so different customers' histories don't mix when the
  // demo page switches between them.
  get _storageKey() {
    const customer = this.getAttribute('customer') || '_default';
    return `ena-chat-state-${customer}`;
  }

  _saveSession() {
    if (!this._engine || !this._panel) return;
    try {
      // Only persist user/assistant messages with stable content. System
      // messages are rebuilt from customer JSON each load. Streaming
      // assistant messages (empty content) are filtered out.
      const messages = this._engine.messages
        .filter(m =>
          (m.role === 'user' || m.role === 'assistant')
          && !m.error
          && (m.role !== 'assistant' || m.content)
        )
        .map(({ role, content }) => ({ role, content }));
      const state = { messages, open: !this._panel.hidden };
      sessionStorage.setItem(this._storageKey, JSON.stringify(state));
    } catch { /* private mode / quota — ignore */ }
  }

  _restoreSession() {
    let state;
    try {
      const raw = sessionStorage.getItem(this._storageKey);
      if (!raw) return;
      state = JSON.parse(raw);
    } catch { return; }
    if (!state || typeof state !== 'object') return;

    // Replay persisted messages: push into engine state, render bubbles.
    // Generate fresh IDs since the old DOM is gone and engine.messages
    // tracks `id` via cryptoId in send(), but persisted messages don't
    // need to round-trip through send().
    if (Array.isArray(state.messages) && state.messages.length) {
      for (const m of state.messages) {
        if (m.role !== 'user' && m.role !== 'assistant') continue;
        if (typeof m.content !== 'string' || !m.content.trim()) continue;
        const restored = {
          role: m.role,
          content: m.content,
          id: globalThis.crypto?.randomUUID?.()
            ?? 'r-' + Math.random().toString(36).slice(2, 10),
        };
        this._engine.messages.push(restored);
        this._appendMessage(restored);
      }
    }

    // Restore panel open/closed state — opt-out per customer via
    // `behavior.persist_open: false` in the customer JSON. Default true
    // (more engaged UX: chat follows the user across pages within a tab).
    // Default to closed for first-time visitors who never opened the chat.
    const persistOpen = this._lastCustomerConfig?.behavior?.persist_open !== false;
    if (persistOpen && state.open) {
      this._panel.hidden = false;
      this._launcher.hidden = true;
    }
  }

  // ─── Theming ───────────────────────────────────────────────────
  // All themes (including built-ins) live as JSON in src/themes/ — single
  // source of truth. Tracks the latest call so a slow fetch from a previous
  // theme switch can't overwrite the tokens of a newer one.
  async _applyTheme(name) {
    if (!name) return;
    const normalized = String(name).toLowerCase();
    if (!/^[a-z0-9_-]+$/.test(normalized)) {
      console.warn('[ena-chat] invalid theme name:', name);
      return;
    }
    const token = ++this._themeToken;
    try {
      const theme = await this._fetchTheme(normalized);
      if (token !== this._themeToken) return; // a newer theme switch superseded us
      if (!theme) return;
      this._writeTokens(theme.tokens || {});
      if (theme.title) this.setAttribute('header-title', theme.title);
    } catch (err) {
      console.warn(`[ena-chat] theme "${name}" failed to load:`, err);
    }
  }

  async _fetchTheme(name) {
    const res = await fetch(new URL(`${name}.json`, THEME_BASE));
    if (!res.ok) return null;
    return res.json();
  }

  _writeTokens(tokens) {
    if (!tokens || typeof tokens !== 'object') return;
    for (const [key, value] of Object.entries(tokens)) {
      if (value == null) continue;
      const prop = key.startsWith('--') ? key : `--${key}`;
      this.style.setProperty(prop, String(value));
    }
  }

  _syncAdapterFromAttrs() {
    if (typeof this._adapter?.update !== 'function') return;
    const update = {};
    if (this.hasAttribute('api-key')) update.apiKey = this.getAttribute('api-key');
    if (this.hasAttribute('base-url')) update.baseUrl = this.getAttribute('base-url');
    if (this.hasAttribute('model')) update.model = this.getAttribute('model');
    this._adapter.update(update);
  }
}

if (!customElements.get('ena-chat')) {
  customElements.define('ena-chat', EnaChat);
}
