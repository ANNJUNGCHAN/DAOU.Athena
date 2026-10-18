(() => {
  'use strict';

  const PROTOCOL = 'athena-paper-sync';
  const VERSION = 1;
  const params = new URLSearchParams(window.location.search);
  const sanitizeSession = value => String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
  const makeId = () => globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const sessionId = sanitizeSession(params.get('session')) || makeId();
  const channelName = `${PROTOCOL}:${sessionId}`;
  const storageKey = `${channelName}:message`;
  const timerKey = `${channelName}:timer`;
  const fontKey = 'athena-paper-prompter:font-size';
  const role = 'prompter';
  const content = Array.isArray(window.PAPER_FINAL_CONTENT)
    ? window.PAPER_FINAL_CONTENT
    : (Array.isArray(window.PAPER_FINAL_CONTENT?.slides) ? window.PAPER_FINAL_CONTENT.slides : []);
  const elements = Object.fromEntries([
    'connection', 'slidePicker', 'elapsed', 'timerToggle', 'timerReset', 'fontDown', 'fontUp', 'fontSize',
    'position', 'sourceNumber', 'currentTitle', 'script', 'nextTitle', 'nextPreview', 'previous', 'replay',
    'next', 'reconnectHelp', 'openDeck', 'announcement'
  ].map(id => [id, document.getElementById(id)]));
  let channel = null;
  let sequence = 0;
  let lastStateAt = 0;
  let currentState = null;
  let connectionState = 'waiting';
  let composing = false;
  let fontSize = 34;
  let timer = { elapsedMs: 0, running: false, startedAt: 0 };

  const readJson = key => {
    try { return JSON.parse(window.localStorage.getItem(key) || 'null'); }
    catch { return null; }
  };
  const saveJson = (key, value) => {
    try { window.localStorage.setItem(key, JSON.stringify(value)); }
    catch { /* Keep controls usable in-memory when storage is unavailable. */ }
  };

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
    if (channel) channel.postMessage(message);
    else {
      try { window.localStorage.setItem(storageKey, JSON.stringify(message)); }
      catch { setConnection('lost'); }
    }
  };

  const setConnection = state => {
    connectionState = state;
    elements.connection.dataset.state = state;
    const label = state === 'connected' ? '발표 창 연결됨' : state === 'lost' ? '발표 창 연결 끊김' : '발표 창 연결 대기';
    elements.connection.querySelector('strong').textContent = label;
    elements.reconnectHelp.hidden = state !== 'lost';
    const connected = state === 'connected';
    elements.slidePicker.disabled = !connected;
    elements.replay.disabled = !connected;
    elements.previous.disabled = !connected || !currentState || currentState.index <= 0;
    elements.next.disabled = !connected || !currentState || currentState.index >= currentState.total - 1;
  };

  const textParagraphs = value => String(value || '').split(/\n\s*\n/).map(part => part.trim()).filter(Boolean);
  const previewText = value => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 180);
  const slideAt = index => content[index] || {};

  const renderState = raw => {
    const total = Number(raw?.total) || content.length;
    const index = Math.max(0, Math.min(Math.max(0, total - 1), Number(raw?.index) || 0));
    const slide = slideAt(index);
    const next = slideAt(index + 1);
    currentState = { ...raw, index, total };
    lastStateAt = Date.now();
    setConnection('connected');
    elements.position.textContent = `${index + 1} / ${total}`;
    elements.sourceNumber.textContent = slide.sourceNumber ? `Paper ${slide.sourceNumber}` : (raw?.sceneId || slide.sceneId || '');
    elements.currentTitle.textContent = raw?.title || slide.title || `슬라이드 ${index + 1}`;
    const notes = raw?.notes || slide.notes || '';
    elements.script.replaceChildren();
    const paragraphs = textParagraphs(notes);
    (paragraphs.length ? paragraphs : ['이 슬라이드의 발표 대본이 없습니다.']).forEach(text => {
      const paragraph = document.createElement('p');
      paragraph.textContent = text;
      elements.script.append(paragraph);
    });
    elements.script.scrollTop = 0;
    elements.nextTitle.textContent = raw?.nextTitle || next?.title || '발표 종료';
    elements.nextPreview.textContent = previewText(raw?.nextNotes || next?.notes) || '마지막 슬라이드입니다.';
    if (elements.slidePicker.value !== String(index)) elements.slidePicker.value = String(index);
    elements.previous.disabled = index <= 0;
    elements.next.disabled = index >= total - 1;
    elements.announcement.textContent = `${index + 1}번 슬라이드, ${elements.currentTitle.textContent}`;
    if (raw?.playing && timer.elapsedMs === 0 && !timer.running) startTimer();
  };

  const receive = message => {
    if (!message || message.protocol !== PROTOCOL || message.version !== VERSION || message.sessionId !== sessionId || message.role === role) return;
    if (message.type === 'state') renderState(message.payload);
    if (message.type === 'deck-closing') {
      lastStateAt = 0;
      currentState = null;
      setConnection('lost');
    }
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
      catch { /* Ignore malformed local messages. */ }
    });
  }

  const command = (name, extra = {}) => {
    if (connectionState !== 'connected' || Date.now() - lastStateAt > 6500) {
      setConnection('lost');
      elements.announcement.textContent = '발표 창과 연결된 뒤 다시 시도해 주세요.';
      return;
    }
    send('command', { command: name, ...extra });
  };

  const populatePicker = () => {
    const fragment = document.createDocumentFragment();
    content.forEach((slide, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = `${String(index + 1).padStart(2, '0')} · ${slide.title || slide.sceneId || '제목 없음'}`;
      fragment.append(option);
    });
    elements.slidePicker.replaceChildren(fragment);
  };

  const formatElapsed = milliseconds => {
    const seconds = Math.max(0, Math.floor(milliseconds / 1000));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = seconds % 60;
    return `${hours ? `${String(hours).padStart(2, '0')}:` : ''}${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
  };
  const timerElapsed = () => timer.elapsedMs + (timer.running ? Date.now() - timer.startedAt : 0);
  const persistTimer = () => saveJson(timerKey, { elapsedMs: timerElapsed(), running: timer.running, savedAt: Date.now() });
  function startTimer() {
    if (timer.running) return;
    timer.startedAt = Date.now();
    timer.running = true;
    elements.timerToggle.textContent = '일시정지';
    persistTimer();
  }
  const pauseTimer = () => {
    if (!timer.running) return;
    timer.elapsedMs = timerElapsed();
    timer.running = false;
    timer.startedAt = 0;
    elements.timerToggle.textContent = '계속';
    persistTimer();
  };
  const resetTimer = () => {
    timer = { elapsedMs: 0, running: false, startedAt: 0 };
    elements.timerToggle.textContent = '타이머 시작';
    elements.elapsed.textContent = '00:00';
    persistTimer();
  };
  const restoreTimer = () => {
    const saved = readJson(timerKey);
    if (!saved) return;
    const elapsedMs = Math.max(0, Number(saved.elapsedMs) || 0);
    timer = { elapsedMs, running: false, startedAt: 0 };
    elements.timerToggle.textContent = elapsedMs ? '계속' : '타이머 시작';
  };

  const setFontSize = value => {
    fontSize = Math.max(24, Math.min(56, Number(value) || 34));
    document.documentElement.style.setProperty('--script-size', `${fontSize}px`);
    elements.fontSize.value = String(fontSize);
    elements.fontSize.textContent = String(fontSize);
    try { window.localStorage.setItem(fontKey, String(fontSize)); } catch { /* optional preference */ }
  };

  elements.previous.addEventListener('click', () => command('prev'));
  elements.next.addEventListener('click', () => command('next'));
  elements.replay.addEventListener('click', () => command('replay'));
  elements.slidePicker.addEventListener('change', () => command('goTo', { index: Number(elements.slidePicker.value) }));
  elements.timerToggle.addEventListener('click', () => timer.running ? pauseTimer() : startTimer());
  elements.timerReset.addEventListener('click', resetTimer);
  elements.fontDown.addEventListener('click', () => setFontSize(fontSize - 2));
  elements.fontUp.addEventListener('click', () => setFontSize(fontSize + 2));
  window.addEventListener('compositionstart', () => { composing = true; });
  window.addEventListener('compositionend', () => { composing = false; });
  window.addEventListener('keydown', event => {
    if (composing || event.isComposing || event.keyCode === 229) return;
    const target = event.target;
    if (target instanceof HTMLElement) {
      if (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (/^(BUTTON|A)$/.test(target.tagName) && (event.key === 'Enter' || event.key === ' ')) return;
    }
    if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') {
      event.preventDefault(); command('next');
    } else if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
      event.preventDefault(); command('prev');
    } else if (event.key === 'Home') {
      event.preventDefault(); command('goTo', { index: 0 });
    } else if (event.key === 'End') {
      event.preventDefault(); command('goTo', { index: Math.max(0, (currentState?.total || content.length) - 1) });
    } else if (event.key.toLowerCase() === 'r') {
      event.preventDefault(); command('replay');
    }
  });
  window.addEventListener('beforeunload', () => { persistTimer(); channel?.close(); });

  populatePicker();
  restoreTimer();
  let savedFont = 34;
  try { savedFont = Number(window.localStorage.getItem(fontKey)) || 34; } catch { /* default */ }
  setFontSize(savedFont);
  elements.openDeck.href = `paper-final.html?slide=1&session=${encodeURIComponent(sessionId)}`;
  setConnection('waiting');
  send('hello', { ready: true });
  window.ATHENA_PAPER_PROMPTER = Object.freeze({
    sessionId,
    sendCommand: command,
    requestState: () => send('request-state', { ready: true }),
    getState: () => ({ connection: connectionState, slide: currentState ? { ...currentState } : null })
  });
  window.setInterval(() => {
    elements.elapsed.textContent = formatElapsed(timerElapsed());
    if (timer.running && Date.now() % 5000 < 300) persistTimer();
  }, 250);
  window.setInterval(() => {
    if (Date.now() - lastStateAt > 6500) {
      setConnection(lastStateAt ? 'lost' : 'waiting');
      send('hello', { ready: true });
    }
  }, 2200);
})();
