// All visual styling for <ena-chat>. Lives inside Shadow DOM, so nothing
// from the host page leaks in. Every visual property is driven by a CSS
// custom property — that's the plug-and-play surface for theming.

export const styles = /* css */ `
  :host {
    /* ─── Token defaults — themes override these ─── */
    --ena-z: 2147483000;

    --ena-bg: #ffffff;
    --ena-bg-image: none;
    --ena-bg-blend: normal;
    --ena-surface: #f7fafc;
    --ena-text: #2A2E32;
    --ena-text-muted: #808080;

    --ena-primary: #019875;
    --ena-primary-contrast: #ffffff;
    --ena-accent: #1EE280;

    --ena-bubble-user-bg: #019875;
    --ena-bubble-user-text: #ffffff;
    --ena-bubble-bot-bg: #E8EEF2;
    --ena-bubble-bot-text: #2A2E32;

    --ena-border-color: #E8EEF2;
    --ena-border-width: 1px;
    --ena-border-style: solid;
    --ena-border-radius: 16px;
    --ena-bubble-radius: 14px;

    --ena-shadow: 0 16px 48px rgba(20, 30, 40, 0.18);
    --ena-backdrop: none;
    --ena-launcher-bg: #019875;
    --ena-launcher-icon: #ffffff;

    --ena-font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    --ena-font-size: 14px;

    /* ─── Layout primitives (rarely overridden) ─── */
    position: fixed;
    inset: auto 24px 24px auto;
    z-index: var(--ena-z);
    font-family: var(--ena-font);
    font-size: var(--ena-font-size);
    color: var(--ena-text);

    /* Defensive: host pages often have global rules (* { border: ... },
       button outlines, body * resets) that paint onto our host element.
       Shadow DOM isolates the inside of the widget but not the element
       itself, so we neutralize the common offenders here. */
    display: block !important;
    border: 0 !important;
    outline: 0 !important;
    background: transparent !important;
    background-image: none !important;
    box-shadow: none !important;
    padding: 0 !important;
    margin: 0 !important;
    filter: none !important;
    transform: none !important;
  }

  :host::before, :host::after {
    content: none !important;
    display: none !important;
  }

  *, *::before, *::after { box-sizing: border-box; }

  /* ─── Launcher button ─── */
  .launcher {
    width: 56px;
    height: 56px;
    border-radius: 50%;
    border: none;
    background: var(--ena-launcher-bg);
    color: var(--ena-launcher-icon);
    cursor: pointer;
    box-shadow: var(--ena-shadow);
    display: grid;
    place-items: center;
    transition: transform 0.18s ease, box-shadow 0.18s ease;
  }
  .launcher:hover { transform: translateY(-2px) scale(1.04); }
  .launcher:focus-visible {
    outline: 2px solid var(--ena-accent);
    outline-offset: 3px;
  }
  .launcher svg { width: 26px; height: 26px; }

  /* ─── Panel ─── */
  .panel {
    position: absolute;
    bottom: 72px;
    right: 0;
    width: min(380px, calc(100vw - 32px));
    height: min(580px, calc(100vh - 120px));
    background: var(--ena-bg);
    background-image: var(--ena-bg-image);
    background-size: cover;
    background-blend-mode: var(--ena-bg-blend);
    border: var(--ena-border-width) var(--ena-border-style) var(--ena-border-color);
    border-radius: var(--ena-border-radius);
    box-shadow: var(--ena-shadow);
    backdrop-filter: var(--ena-backdrop);
    -webkit-backdrop-filter: var(--ena-backdrop);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    transform-origin: bottom right;
    animation: pop 0.22s cubic-bezier(0.2, 0.9, 0.3, 1.2);
  }
  @keyframes pop {
    from { opacity: 0; transform: scale(0.92) translateY(8px); }
    to { opacity: 1; transform: scale(1) translateY(0); }
  }

  /* ─── Header ─── */
  header {
    padding: 14px 16px;
    border-bottom: var(--ena-border-width) var(--ena-border-style) var(--ena-border-color);
    display: flex;
    align-items: center;
    gap: 12px;
    background: var(--ena-surface);
  }
  .avatar {
    width: 32px; height: 32px; border-radius: 50%;
    background: var(--ena-primary);
    color: var(--ena-primary-contrast);
    display: grid; place-items: center;
    font-weight: 700; font-size: 13px;
  }
  .title { flex: 1; font-weight: 600; font-size: 15px; }
  .close {
    background: transparent; border: none; cursor: pointer;
    color: var(--ena-text-muted);
    width: 28px; height: 28px; border-radius: 6px;
    display: grid; place-items: center;
  }
  .close:hover { background: var(--ena-border-color); color: var(--ena-text); }

  /* ─── Messages ─── */
  .messages {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    scrollbar-width: thin;
    scrollbar-color: var(--ena-border-color) transparent;
  }
  .messages::-webkit-scrollbar { width: 6px; }
  .messages::-webkit-scrollbar-thumb { background: var(--ena-border-color); border-radius: 3px; }

  .empty {
    margin: auto 0;
    text-align: center;
    color: var(--ena-text-muted);
    font-size: 13px;
    line-height: 1.6;
    padding: 24px 12px;
  }
  .empty strong { color: var(--ena-text); display: block; margin-bottom: 6px; font-size: 15px; }

  .bubble {
    max-width: 85%;
    padding: 10px 14px;
    border-radius: var(--ena-bubble-radius);
    line-height: 1.5;
    word-wrap: break-word;
    white-space: pre-wrap;
    animation: fade 0.2s ease;
  }
  @keyframes fade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; } }

  .bubble.user {
    align-self: flex-end;
    background: var(--ena-bubble-user-bg);
    color: var(--ena-bubble-user-text);
    border-bottom-right-radius: 4px;
  }
  .bubble.bot {
    align-self: flex-start;
    background: var(--ena-bubble-bot-bg);
    color: var(--ena-bubble-bot-text);
    border-bottom-left-radius: 4px;
  }
  .bubble.error {
    align-self: stretch;
    background: rgba(255, 85, 0, 0.1);
    color: #FF5500;
    font-size: 12px;
    text-align: center;
    border-radius: 8px;
  }

  .typing {
    display: inline-flex; gap: 4px; align-items: center; padding: 2px 0;
  }
  .typing span {
    width: 6px; height: 6px; border-radius: 50%;
    background: currentColor; opacity: 0.5;
    animation: blink 1.2s infinite;
  }
  .typing span:nth-child(2) { animation-delay: 0.15s; }
  .typing span:nth-child(3) { animation-delay: 0.3s; }
  @keyframes blink { 0%, 80%, 100% { opacity: 0.2; } 40% { opacity: 1; } }

  /* ─── Composer ─── */
  .composer {
    padding: 12px;
    border-top: var(--ena-border-width) var(--ena-border-style) var(--ena-border-color);
    display: flex;
    gap: 8px;
    align-items: flex-end;
    background: var(--ena-surface);
  }
  textarea {
    flex: 1;
    resize: none;
    border: var(--ena-border-width) var(--ena-border-style) var(--ena-border-color);
    border-radius: 10px;
    padding: 10px 12px;
    font: inherit;
    color: var(--ena-text);
    background: var(--ena-bg);
    max-height: 120px;
    min-height: 40px;
  }
  textarea:focus { outline: none; border-color: var(--ena-primary); }

  .send {
    border: none;
    background: var(--ena-primary);
    color: var(--ena-primary-contrast);
    border-radius: 10px;
    width: 40px; height: 40px;
    cursor: pointer;
    flex-shrink: 0;
    display: grid; place-items: center;
    transition: filter 0.15s, background 0.15s;
  }
  .send:hover:not(:disabled) { filter: brightness(1.08); }
  .send:disabled { opacity: 0.4; cursor: not-allowed; }
  .send.busy {
    background: var(--ena-text-muted);
    animation: pulse 1.4s ease-in-out infinite;
  }
  .send svg { width: 18px; height: 18px; }
  @keyframes pulse {
    0%, 100% { box-shadow: 0 0 0 0 rgba(0, 0, 0, 0); }
    50% { box-shadow: 0 0 0 4px rgba(128, 128, 128, 0.18); }
  }

  [hidden] { display: none !important; }
`;
