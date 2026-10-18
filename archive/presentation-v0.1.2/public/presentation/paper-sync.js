(() => {
  'use strict';

  const PROTOCOL = 'athena-paper-sync';
  const VERSION = 1;
  const SESSION_KEY = 'athena-paper-sync:last-session';
  const role = 'deck';
  const params = new URLSearchParams(window.location.search);
  const makeId = () => globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const sanitizeSession = value => String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
  const storedSession = (() => {
    try { return window.sessionStorage.getItem(SESSION_KEY); }
    catch { return ''; }
  })();
  const sessionId = sanitizeSession(params.get('session') || storedSession) || makeId();
  const channelName = `${PROTOCOL}:${sessionId}`;
  const storageKey = `${channelName}:message`;
  let channel = null;
  let popup = null;
  let sequence = 0;
  let lastState = null;

  try {
    window.sessionStorage.setItem(SESSION_KEY, sessionId);
  } catch { /* The BroadcastChannel path still works when storage is unavailable. */ }

  const envelope = (type, payload = {}) => ({
    protocol: PROTOCOL,
    version: VERSION,
    sessionId,
    role,
    type,
    payload,
    messageId: `${role}-${Date.now().toString(36)}-${++sequence}`,
    sentAt: Date.now()
  });

  const send = (type, payload) => {
    const message = envelope(type, payload);
    if (channel) {
      channel.postMessage(message);
      return;
    }
    try { window.localStorage.setItem(storageKey, JSON.stringify(message)); }
    catch { /* Connection state remains visibly unavailable in the prompter. */ }
  };

  const normalizeState = raw => {
    const state = raw && typeof raw === 'object' ? raw : {};
    const content = Array.isArray(window.PAPER_FINAL_CONTENT)
      ? window.PAPER_FINAL_CONTENT
      : (Array.isArray(window.PAPER_FINAL_CONTENT?.slides) ? window.PAPER_FINAL_CONTENT.slides : []);
    const total = Number.isFinite(Number(state.total)) ? Number(state.total) : content.length;
    const index = Math.max(0, Math.min(Math.max(0, total - 1), Number(state.index) || 0));
    const slide = content[index] || {};
    const next = content[index + 1] || null;
    return {
      index,
      total,
      sceneId: state.sceneId || slide.sceneId || '',
      sourceNumber: slide.sourceNumber || '',
      title: state.title || slide.title || `슬라이드 ${index + 1}`,
      notes: slide.notes || '',
      nextTitle: next?.title || '',
      nextNotes: next?.notes || '',
      playing: Boolean(state.playing),
      updatedAt: Date.now()
    };
  };

  const readDeckState = () => {
    try { return normalizeState(window.ATHENA_PAPER?.getState?.() || lastState || {}); }
    catch { return normalizeState(lastState || {}); }
  };

  const publishState = raw => {
    lastState = normalizeState(raw || readDeckState());
    send('state', lastState);
    return lastState;
  };

  const executeCommand = message => {
    if (!window.ATHENA_PAPER || !message?.payload) return;
    const { command, index } = message.payload;
    if (command === 'goTo' && Number.isInteger(Number(index))) window.ATHENA_PAPER.goTo(Number(index));
    else if (command === 'next') window.ATHENA_PAPER.next();
    else if (command === 'prev') window.ATHENA_PAPER.prev();
    else if (command === 'replay') window.ATHENA_PAPER.replay();
    else return;
    window.setTimeout(() => publishState(), 0);
  };

  const receive = message => {
    if (!message || message.protocol !== PROTOCOL || message.version !== VERSION || message.sessionId !== sessionId || message.role === role) return;
    if (message.type === 'hello' || message.type === 'request-state') publishState();
    if (message.type === 'command') executeCommand(message);
  };

  if ('BroadcastChannel' in window) {
    try {
      channel = new BroadcastChannel(channelName);
      channel.addEventListener('message', event => receive(event.data));
    } catch { channel = null; }
  }
  if (!channel) {
    window.addEventListener('storage', event => {
      if (event.key !== storageKey || !event.newValue) return;
      try { receive(JSON.parse(event.newValue)); }
      catch { /* Ignore malformed messages from unrelated local scripts. */ }
    });
  }

  const ensureFallback = () => {
    let status = document.getElementById('prompter-open-status');
    if (status) return status;
    const anchor = document.getElementById('openPrompter');
    if (!anchor) return null;
    status = document.createElement('p');
    status.id = 'prompter-open-status';
    status.className = 'prompter-open-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.style.cssText = 'position:fixed;right:20px;bottom:84px;z-index:30;max-width:360px;margin:0;padding:12px 14px;border:1px solid rgba(255,255,255,.2);border-radius:12px;color:#fff;background:rgba(16,18,23,.94);box-shadow:0 16px 44px rgba(0,0,0,.38);font:600 14px/1.55 sans-serif;';
    status.hidden = true;
    anchor.insertAdjacentElement('afterend', status);
    return status;
  };

  const showOpenStatus = (blocked, url) => {
    const status = ensureFallback();
    if (!status) return;
    status.replaceChildren();
    status.hidden = false;
    if (blocked) {
      status.append('프롬프터 창이 차단되었습니다. ');
      const link = document.createElement('a');
      link.href = url;
      link.target = `athena-paper-prompter-${sessionId}`;
      link.rel = 'noopener';
      link.textContent = '프롬프터 직접 열기';
      status.append(link);
    } else {
      status.textContent = '프롬프터 창을 열었습니다.';
      window.setTimeout(() => { status.hidden = true; }, 2800);
    }
  };

  const openPrompter = () => {
    const url = new URL('paper-prompter.html', window.location.href);
    url.searchParams.set('session', sessionId);
    try {
      popup = window.open(url.href, `athena-paper-prompter-${sessionId}`, 'popup=yes,width=760,height=960,resizable=yes,scrollbars=yes');
    } catch { popup = null; }
    const blocked = !popup;
    showOpenStatus(blocked, url.href);
    if (!blocked) {
      try { popup.focus(); } catch { /* Window focus can be denied by the browser. */ }
      window.setTimeout(() => publishState(), 120);
    }
    return { ok: !blocked, blocked, sessionId, url: url.href, window: popup };
  };

  window.addEventListener('athena:paper-state', event => publishState(event.detail));
  window.addEventListener('pageshow', () => publishState());
  window.addEventListener('beforeunload', () => {
    send('deck-closing', { at: Date.now() });
    channel?.close();
  });

  window.ATHENA_PAPER_SYNC = Object.freeze({
    sessionId,
    openPrompter,
    publishState,
    getState: readDeckState
  });
  window.ATHENA_PAPER_SYNC_PROTOCOL = Object.freeze({ protocol: PROTOCOL, version: VERSION, sessionId, channelName, storageKey });

  window.setTimeout(() => publishState(), 0);
  window.setInterval(() => publishState(), 2500);
})();
