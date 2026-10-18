(() => {
  'use strict';
  const content = window.PAPER_FINAL_CONTENT;
  if (!content?.slides?.length) throw new Error('PAPER_FINAL_CONTENT is missing');

  const deck = document.getElementById('paperDeck');
  const viewport = document.getElementById('paperViewport');
  const stage = document.getElementById('paperStage');
  const counter = document.getElementById('slideCounter');
  const toc = document.getElementById('tocDialog');
  const tocList = document.getElementById('tocList');
  const params = new URLSearchParams(location.search);
  const staticMode = params.get('static') === '1' || matchMedia('print').matches;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const legacySceneIdBySource = new Map([
    [1,'s02-question'],[2,'s02-claude'],[3,'s04-c'],[4,'s05'],[5,'s07-kis'],[6,'s08'],
    [7,'s09'],[8,'s09-dust'],[9,'s10'],[10,'s11-en'],[11,'s11-ko'],[12,'s12'],
    [14,'s16'],[15,'s18'],[16,'s20'],[17,'s21'],[18,'s22']
  ]);
  const legacySceneIds = [...legacySceneIdBySource.values()];
  const parseSlideNumber = value => {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  };
  const hashSlide = parseSlideNumber((location.hash.match(/(?:^#|&)slide=([^&]+)/) || [])[1]);
  const initialSlide = hashSlide || parseSlideNumber(params.get('slide')) || 1;
  let index = Math.min(content.slides.length - 1, Math.max(0, initialSlide - 1));
  let idleTimer = 0;
  let pointerStart = null;
  let closingTimers = [];
  let closingPlaying = false;

  const initialLegacyScene = legacySceneIdBySource.get(content.slides[index].sourceNumber) || legacySceneIds[0];
  const legacyUrl = staticMode ? 'about:blank' : `final.html?export=1&scene=${encodeURIComponent(initialLegacyScene)}`;
  stage.innerHTML = `<iframe id="paperLegacyRuntime" class="paper-legacy" title="ATHENA 기존 장면 런타임" tabindex="-1" aria-hidden="true" src="${legacyUrl}"${staticMode ? ' hidden' : ''}></iframe><div id="paperLegacyError" class="paper-legacy-error" role="alert" hidden>기존 장면을 불러오지 못했습니다.<br>새로고침한 뒤 다시 시도해 주세요.</div>` + content.slides.map((slide, position) => `
    <section class="paper-slide${slide.sourceNumber >= 20 ? ' paper-motion' : ''}${position === index ? ' is-active' : ''}" data-index="${position}" data-scene-id="${slide.sceneId}" data-source-number="${slide.sourceNumber}" aria-label="${position + 1}. ${escapeAttr(slide.title)}" aria-hidden="${position === index ? 'false' : 'true'}">
      <div class="paper-slide-inner">${slide.html}</div>
    </section>`).join('');

  tocList.innerHTML = content.slides.map((slide, position) => `<li><button type="button" data-goto="${position}"><span class="toc-index">${String(position + 1).padStart(2, '0')}</span><span>${escapeHtml(slide.title)}</span></button></li>`).join('');

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  }
  function escapeAttr(value) { return escapeHtml(value); }

  function resize() {
    const scale = Math.min(viewport.clientWidth / content.width, viewport.clientHeight / content.height);
    stage.style.transform = `scale(${scale})`;
  }

  function currentSlide() { return content.slides[index]; }
  function currentElement() { return stage.querySelector(`.paper-slide[data-index="${index}"]`); }
  const legacy = document.getElementById('paperLegacyRuntime');
  const legacyError = document.getElementById('paperLegacyError');
  const usesLegacy = () => !staticMode && legacySceneIdBySource.has(currentSlide().sourceNumber);
  function legacyPresentation() {
    try { return legacy.contentWindow?.presentation || null; } catch { return null; }
  }
  function installLegacyReadability() {
    try {
      const legacyDocument = legacy.contentDocument;
      if (!legacyDocument?.head || legacyDocument.getElementById('paper-final-readability')) return;
      const style = legacyDocument.createElement('style');
      style.id = 'paper-final-readability';
      style.textContent = `
        .e4-problem,.e4-dissolve .e4-heading{isolation:isolate}
        .e4-problem::before,.e4-dissolve .e4-heading::before{
          content:"";position:absolute;z-index:-1;left:-240px;right:-240px;top:-150px;bottom:-150px;
          background:radial-gradient(ellipse at center,rgba(5,9,17,1) 0 32%,rgba(5,9,17,.97) 47%,rgba(5,9,17,.72) 62%,rgba(5,9,17,0) 82%);
          pointer-events:none
        }`;
      legacyDocument.head.append(style);
    } catch {}
  }
  function isPlaying() {
    if (usesLegacy()) return legacyPresentation()?.state === 'playing';
    if (currentSlide().sourceNumber === 38) return closingPlaying;
    const media = currentElement()?.querySelector('video[data-paper-media]');
    return Boolean(media && !media.paused && !media.ended);
  }

  function state(source = 'deck') {
    const slide = currentSlide();
    return { index, total: content.slides.length, sceneId: slide.sceneId, title: slide.title, playing: isPlaying(), sourceNumber: slide.sourceNumber, source, version: content.version };
  }

  function publish(source) {
    const detail = state(source);
    window.dispatchEvent(new CustomEvent('athena:paper-state', { detail }));
    return detail;
  }

  function pauseAll(except) {
    stage.querySelectorAll('video[data-paper-media]').forEach((video) => {
      if (video !== except) video.pause();
    });
  }

  function closingElements() {
    const closing = content.slides.findIndex(slide => slide.sourceNumber === 38);
    const element = closing >= 0 ? stage.querySelector(`.paper-slide[data-index="${closing}"]`) : null;
    return {
      wordmark: element?.querySelector('.paper-label-closing-wordmark') || null,
      subtitle: element?.querySelector('.paper-label-closing-subtitle') || null
    };
  }

  function cancelClosing({ complete = true } = {}) {
    closingTimers.forEach(timer => clearTimeout(timer));
    closingTimers = [];
    closingPlaying = false;
    const { wordmark, subtitle } = closingElements();
    if (!wordmark || !subtitle) return;
    wordmark.classList.remove('is-typing', 'is-complete');
    if (complete) {
      wordmark.textContent = 'ATHENA';
      subtitle.style.opacity = '1';
    }
  }

  function playClosing() {
    cancelClosing({ complete: true });
    const { wordmark, subtitle } = closingElements();
    if (!wordmark || !subtitle || staticMode || reducedMotion) return;
    wordmark.textContent = '';
    wordmark.classList.add('is-typing');
    subtitle.style.opacity = '0';
    subtitle.style.transition = 'opacity .42s cubic-bezier(.2,.8,.2,1)';
    closingPlaying = true;
    const steps = ['A', 'AT', 'ATH', 'ATHE', 'ATHEN', 'ATHENA'];
    const delays = [220, 390, 560, 730, 900, 1070];
    steps.forEach((value, step) => {
      closingTimers.push(setTimeout(() => {
        wordmark.textContent = value;
        if (step === steps.length - 1) {
          wordmark.classList.remove('is-typing');
          wordmark.classList.add('is-complete');
        }
      }, delays[step]));
    });
    closingTimers.push(setTimeout(() => {
      subtitle.style.opacity = '1';
      closingPlaying = false;
      publish('closing-complete');
    }, 1320));
  }

  function playCurrent({ restart = false } = {}) {
    if (currentSlide().sourceNumber !== 38) cancelClosing({ complete: true });
    if (usesLegacy()) {
      stage.classList.add('is-legacy');
      legacy.hidden = false;
      legacyError.hidden = true;
      installLegacyReadability();
      const presentation = legacyPresentation();
      if (presentation) {
        const target = legacySceneIdBySource.get(currentSlide().sourceNumber);
        if (presentation.cue !== target) presentation.goTo(target);
        else if (restart) presentation.replay();
      }
      return;
    }
    stage.classList.remove('is-legacy');
    legacy.hidden = true;
    legacyError.hidden = true;
    try {
      legacy.contentDocument?.querySelectorAll('video,audio').forEach((media) => media.pause());
      legacy.contentDocument?.getAnimations().forEach((animation) => animation.cancel());
    } catch {}
    const active = currentElement();
    if (currentSlide().sourceNumber === 38) playClosing();
    const video = active?.querySelector('video[data-paper-media]');
    pauseAll(video);
    if (video) {
      if (restart) video.currentTime = 0;
      const result = video.play();
      if (result?.catch) result.catch(() => publish('media-blocked'));
    }
  }

  function updateChrome() {
    const slide = currentSlide();
    counter.textContent = `${index + 1} / ${content.slides.length}`;
    tocList.querySelectorAll('[data-goto]').forEach((button) => button.setAttribute('aria-current', String(Number(button.dataset.goto) === index)));
    const url = new URL(location.href);
    url.searchParams.set('slide', String(index + 1));
    url.hash = `slide=${index + 1}`;
    history.replaceState(null, '', url);
  }

  function goTo(target, source = 'api') {
    const parsedTarget = Number(target);
    if (!Number.isFinite(parsedTarget)) return state(source);
    const nextIndex = Math.min(content.slides.length - 1, Math.max(0, Math.trunc(parsedTarget)));
    const previous = currentElement();
    previous?.classList.remove('is-active', 'is-entering');
    previous?.setAttribute('aria-hidden', 'true');
    index = nextIndex;
    const active = currentElement();
    active.classList.add('is-active');
    active.setAttribute('aria-hidden', 'false');
    void active.offsetWidth;
    active.classList.add('is-entering');
    setTimeout(() => active.classList.remove('is-entering'), 760);
    updateChrome();
    playCurrent({ restart: true });
    const detail = publish(source);
    return detail;
  }

  function next(source = 'next') { return goTo(index + 1, source); }
  function prev(source = 'prev') { return goTo(index - 1, source); }
  function replay(source = 'replay') {
    const active = currentElement();
    active.classList.remove('is-entering');
    void active.offsetWidth;
    active.classList.add('is-entering');
    setTimeout(() => active.classList.remove('is-entering'), 760);
    playCurrent({ restart: true });
    return publish(source);
  }

  window.ATHENA_PAPER = { goTo, next, prev, replay, getState: () => state('getState') };

  document.getElementById('prevSlide').addEventListener('click', () => prev('control'));
  document.getElementById('nextSlide').addEventListener('click', () => next('control'));
  document.getElementById('replaySlide').addEventListener('click', () => replay('control'));
  document.getElementById('toggleFullscreen').addEventListener('click', () => document.fullscreenElement ? document.exitFullscreen() : deck.requestFullscreen());
  document.getElementById('openToc').addEventListener('click', () => toc.showModal());
  document.getElementById('openPrompter').addEventListener('click', () => {
    const result = window.ATHENA_PAPER_SYNC?.openPrompter();
    if (result?.ok) {
      deck.classList.add('has-started');
      wakeChrome();
    }
  });
  tocList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-goto]');
    if (!button) return;
    goTo(Number(button.dataset.goto), 'toc');
    toc.close();
  });

  addEventListener('keydown', (event) => {
    if (event.target.closest('button,dialog') && event.key === ' ') return;
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(event.key)) { event.preventDefault(); next('keyboard'); }
    else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(event.key)) { event.preventDefault(); prev('keyboard'); }
    else if (event.key === 'Home') { event.preventDefault(); goTo(0, 'keyboard'); }
    else if (event.key === 'End') { event.preventDefault(); goTo(content.slides.length - 1, 'keyboard'); }
    else if (event.key.toLowerCase() === 'r') replay('keyboard');
    else if (event.key.toLowerCase() === 'f') document.fullscreenElement ? document.exitFullscreen() : deck.requestFullscreen();
    else if (event.key.toLowerCase() === 't') toc.open ? toc.close() : toc.showModal();
  });

  deck.addEventListener('pointerdown', (event) => { pointerStart = { x: event.clientX, y: event.clientY, id: event.pointerId }; });
  deck.addEventListener('pointerup', (event) => {
    if (!pointerStart || pointerStart.id !== event.pointerId) return;
    const dx = event.clientX - pointerStart.x;
    const dy = event.clientY - pointerStart.y;
    pointerStart = null;
    if (Math.abs(dx) > 80 && Math.abs(dx) > Math.abs(dy) * 1.4) dx < 0 ? next('swipe') : prev('swipe');
  });

  function wakeChrome() {
    deck.classList.remove('is-idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (document.fullscreenElement || deck.classList.contains('has-started')) deck.classList.add('is-idle');
    }, 2600);
  }
  ['pointermove', 'pointerdown', 'keydown'].forEach((name) => addEventListener(name, wakeChrome, { passive: true }));
  stage.addEventListener('play', () => publish('media-play'), true);
  stage.addEventListener('pause', () => publish('media-pause'), true);
  legacy.addEventListener('load', () => {
    if (!usesLegacy()) return;
    const presentation = legacyPresentation();
    if (!presentation) {
      legacy.hidden = true;
      legacyError.hidden = false;
      publish('legacy-error');
      return;
    }
    installLegacyReadability();
    const target = legacySceneIdBySource.get(currentSlide().sourceNumber);
    if (presentation.cue !== target) presentation.goTo(target);
    stage.classList.add('is-legacy');
    publish('legacy-ready');
  });
  window.ATHENA_PAPER_LEGACY_SCENES = Object.freeze([...legacySceneIds]);
  window.ATHENA_PAPER_LEGACY_SCENE_BY_SOURCE = Object.freeze(Object.fromEntries(legacySceneIdBySource));
  addEventListener('resize', resize);
  addEventListener('beforeprint', () => {
    cancelClosing({ complete: true });
    stage.style.transform = 'none';
  });
  addEventListener('afterprint', resize);

  resize();
  updateChrome();
  playCurrent({ restart: true });
  requestAnimationFrame(() => publish('ready'));
})();
