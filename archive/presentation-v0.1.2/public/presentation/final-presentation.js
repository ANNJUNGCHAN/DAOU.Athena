(() => {
  'use strict';

  const content = window.ATHENA_FINAL_CONTENT;
  const data = window.ATHENA_REVIEW_DATA;
  const scenes = window.ATHENA_SCENES || (window.ATHENA_SCENES = {});
  if (!content || !Array.isArray(content.slides) || !data) {
    throw new Error('ATHENA final content must load before final-presentation.js');
  }

  const escapeHtml = value => String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  const textLines = value => Array.isArray(value) ? value : String(value ?? '').split(/\n+/).filter(Boolean);
  const columnData = value => (Array.isArray(value) ? value : []).map(item =>
    typeof item === 'string' ? { title: item, body: '' } : (item || {}));
  const renderLiveDemo = slide => {
    const columns = columnData(slide.columns);
    return `<section class="final-scene final-live-demo" data-final-id="${escapeHtml(slide.id)}">
      <header class="final-header final-animate-step"><p>${escapeHtml(slide.eyebrow || '실제 앱 시연')}</p><h1>${escapeHtml(slide.title)}</h1><h2>${escapeHtml(slide.subtitle || '')}</h2></header>
      <div class="final-live-route" aria-label="시연 기능 순서">${columns.map((column, index) => `<article class="final-live-node final-animate-step"><span>${String(index + 1).padStart(2, '0')}</span><h3>${escapeHtml(column.title || '')}</h3><p>${escapeHtml(column.text || column.body || '')}</p></article>`).join('')}</div>
      <div class="final-live-switch final-animate-step"><div><strong>실제 앱으로 전환</strong><span>03:30–07:00</span></div><p>${escapeHtml(slide.takeaway || '')}</p></div>
    </section>`;
  };

  const aiShell = (slide, heroTitle, heroSubtitle, techLine, diagram) => `<section class="final-scene final-ai final-${escapeHtml(slide.kind)}" data-final-id="${escapeHtml(slide.id)}" aria-label="${escapeHtml(slide.title)}">
    <div class="final-ai-kicker"><span>${escapeHtml(slide.eyebrow || 'AI 특장점')}</span></div>
    <header class="final-ai-hero final-animate-step"><h1>${heroTitle}</h1><h2>${heroSubtitle}</h2></header>
    <div class="final-ai-canvas">${diagram}</div>
    <footer class="final-ai-footer final-animate-step"><p>${escapeHtml(techLine)}</p><span>${escapeHtml(slide.referenceLabel || '')}</span></footer>
    <p class="final-ai-disclosure">구조 설명 · 실시간 실행 추적 아님</p>
  </section>`;

  const renderAiNetwork = slide => {
    const columns = columnData(slide.columns);
    const graphLabels = [...(Array.isArray(slide.graphLabels) ? slide.graphLabels : []), 'A1', 'A2', 'A3', 'B1', 'B2', 'B3'];
    const diagram = `<div class="io-network-stage">
      <div class="io-structure-label"><span>구조 예시</span><small>기존 관계의 탐색 · 새 관계 예측 아님</small></div>
      <svg class="io-network-lines final-animate-step" viewBox="0 0 920 610" aria-hidden="true"><path d="M150 190 L355 115 L505 250 L735 145"/><path d="M150 190 L300 365 L505 250 L790 470"/><path class="is-cross" d="M355 115 L790 470"/><circle cx="150" cy="190" r="5"/><circle cx="355" cy="115" r="5"/><circle cx="505" cy="250" r="5"/><circle cx="735" cy="145" r="5"/><circle cx="300" cy="365" r="5"/><circle cx="790" cy="470" r="5"/></svg>
      ${graphLabels.slice(0, 5).map((label, index) => `<span class="io-graph-node node-${index + 1}"><b>${escapeHtml(label)}</b></span>`).join('')}
      <aside class="io-grounded-panel final-animate-step"><small>Grounded Answer</small><b>${escapeHtml(graphLabels[5] || '원문 근거')}</b><p>${escapeHtml(columns[3]?.text || '')}</p></aside>
      <div class="io-network-caption final-animate-step"><b>${escapeHtml(slide.detailTitle || '')}</b><small>NetworkX · Greedy Modularity · 교차 관계 순위</small></div>
    </div>`;
    return aiShell(slide, 'Graph<br>Memory', '기록을 지식으로,<br>판단을 근거로.', 'Community Detection · Provenance · Grounded Answers', diagram);
  };

  const renderAiRouting = slide => {
    const columns = columnData(slide.columns);
    const diagram = `<div class="io-routing-stage">
      <section class="io-request final-animate-step"><small>Natural language financial request</small><strong>${escapeHtml(slide.inputExample || '삼성전자\n차트 보여줘')}</strong></section>
      <span class="io-route-arrow final-animate-step" aria-hidden="true">→</span>
      <section class="io-decision final-animate-step"><small>Constrained Proposal</small><code>${escapeHtml(slide.decisionExample || '{ operation_ref, arguments }')}</code><p>${escapeHtml(columns[1]?.text || '')}</p></section>
      <span class="io-route-arrow final-animate-step" aria-hidden="true">→</span>
      <section class="io-validated final-animate-step"><small>Schema Validation</small><strong>검증 후 실행</strong><p>조회 결과 → 차트 · 카드</p></section>
      <p class="io-routing-rule final-animate-step">${escapeHtml(slide.routingNote || '')}</p>
    </div>`;
    return aiShell(slide, 'Intent <i>→</i> Action', '자연어를 실행 가능한 금융 함수로', 'Intent Routing · Constrained Proposal · Schema Validation', diagram);
  };

  const renderAi = slide => {
    if (slide.kind === 'ai-network') return renderAiNetwork(slide);
    if (slide.kind === 'ai-routing') return renderAiRouting(slide);
    throw new Error(`Unsupported final AI slide kind: ${slide.kind}`);
  };

  const businessNotes = slide => {
    const lines = textLines(slide.body);
    return lines.length ? `<div class="biz-notes final-animate-step">${lines.map(line => `<p>${escapeHtml(line)}</p>`).join('')}</div>` : '';
  };

  const renderBusinessRoadmap = slide => {
    const columns = columnData(slide.columns);
    return `<div class="biz-roadmap">
      <span class="biz-diagram-caption">사업화 제안 · 확장 경로</span>
      <div class="biz-value-chain final-animate-step">${columns.map((column, index) => `<span class="biz-chain-stage${index === columns.length - 2 ? ' is-model' : ''}${index === columns.length - 1 ? ' is-destination' : ''}">${escapeHtml(column.title || '')}</span>${index < columns.length - 1 ? '<i class="biz-chain-arrow" aria-hidden="true">→</i>' : ''}`).join('')}</div>
      <div class="biz-roadmap-groups">
        ${[
          { title: '고객 접점과 작업 데이터', columns: columns.slice(0, 2), offset: 0 },
          { title: '자체 모델과 유료 서비스', columns: columns.slice(2, 4), offset: 2 }
        ].map(group => `<section class="biz-roadmap-group final-animate-step"><h3 class="biz-group-title">${group.title}</h3>${group.columns.map((column, index) => `<article class="biz-phase"><span class="biz-index">${String(group.offset + index + 1).padStart(2, '0')}</span><h3>${escapeHtml(column.title || '')}</h3><p>${escapeHtml(column.text || column.body || '')}</p></article>`).join('')}</section>`).join('')}
      </div>
    </div>`;
  };

  const renderBusinessModel = slide => {
    const columns = columnData(slide.columns);
    const rows = columns.map(column => String(column.text || column.body || '').split('\n'));
    return `<div class="biz-blueprint-domains"><span>역할 분담</span><span>개발 방향</span></div>
    <div class="biz-blueprint" role="table" aria-label="자체 모델 역할과 처리 방식">
      <div class="biz-blueprint-row biz-blueprint-head final-animate-step" role="row"><div class="biz-row-label" role="columnheader">모델 설계</div>${columns.map(column => `<h3 role="columnheader">${escapeHtml(column.title || '')}</h3>`).join('')}</div>
      <div class="biz-blueprint-row final-animate-step" role="row"><div class="biz-row-label" role="rowheader">처리 대상</div>${rows.map(lines => `<p role="cell">${escapeHtml(lines[0] || '')}</p>`).join('')}</div>
      <div class="biz-blueprint-row final-animate-step" role="row"><div class="biz-row-label" role="rowheader">처리 방식</div>${rows.map(lines => `<p role="cell">${escapeHtml(lines.slice(1).join('\n'))}</p>`).join('')}</div>
    </div>
    ${businessNotes(slide)}`;
  };

  const renderBusinessRevenue = slide => {
    const columns = columnData(slide.columns);
    const labels = [
      { income: '직접 AI 매출', cost: '반영할 비용' },
      { income: '그룹 사업 기여', cost: '검증할 기여' }
    ];
    const ledger = (column, index) => {
        const groups = String(column.text || column.body || '').split(/\n\s*\n/);
        return `<article class="biz-ledger final-animate-step"><header><span class="biz-label">${labels[index].income}</span><h3>${escapeHtml(column.title || '')}</h3></header><div class="biz-ledger-income"><p>${escapeHtml(groups[0] || '')}</p></div><div class="biz-ledger-cost"><span class="biz-label">${labels[index].cost}</span><p>${escapeHtml(groups.slice(1).join('\n\n'))}</p></div></article>`;
    };
    return `<div class="biz-revenue-columns">
      ${columns[0] ? ledger(columns[0], 0) : ''}
      <div class="biz-revenue-hub final-animate-step"><img src="assets/brand/athena.png" alt="ATHENA"></div>
      ${columns[1] ? ledger(columns[1], 1) : ''}
    </div>
    ${businessNotes(slide)}`;
  };

  const renderBusinessInfra = slide => {
    const columns = columnData(slide.columns);
    return `<div class="biz-infra-map">
      <aside class="biz-infra-references final-animate-step"><h3>사업 요소의 참고 사례</h3><div class="biz-infra-reference"><strong>Replit</strong><p>특화 모델</p></div><div class="biz-infra-reference"><strong>BloombergGPT</strong><p>금융 데이터</p></div><div class="biz-infra-reference"><strong>Together AI</strong><p>API 사업</p></div></aside>
      <div class="biz-infra-operating">
        <div class="biz-infra-sources">${columns.slice(0, 2).map(column => `<article class="biz-infra-source final-animate-step"><span class="biz-label">공식 발표</span><h3>${escapeHtml(column.title || '')}</h3><p>${escapeHtml(column.text || column.body || '')}</p></article>`).join('')}</div>
        <div class="biz-infra-connector" data-business-draw aria-hidden="true"></div>
        ${columns[2] ? `<article class="biz-infra-target final-animate-step"><span class="biz-label">ATHENA 활용 구상</span><h3>${escapeHtml(columns[2].title || '')}</h3><p>${escapeHtml(columns[2].text || columns[2].body || '')}</p></article>` : ''}
      </div>
    </div>
    ${businessNotes(slide)}`;
  };

  const renderBusiness = slide => {
    const kind = String(slide.kind || 'business').toLowerCase();
    const diagram = kind === 'roadmap' ? renderBusinessRoadmap(slide)
      : kind === 'model' ? renderBusinessModel(slide)
        : kind === 'revenue' ? renderBusinessRevenue(slide)
          : renderBusinessInfra(slide);
    return `<section class="final-scene final-business" data-final-kind="${escapeHtml(kind)}" data-final-id="${escapeHtml(slide.id)}">
      <header class="final-header final-animate-step"><h1>${escapeHtml(slide.title)}</h1><h2>${escapeHtml(slide.subtitle || '')}</h2></header>
      <div class="biz-content">${diagram}</div>
    </section>`;
  };

  const renderClosing = slide => `<section class="cc-root e4-stage e4-arrival final-scene final-closing-typing" data-fullscreen="true">
    <canvas class="e4-canvas" width="1920" height="1080" aria-hidden="true"></canvas>
    <div class="e4-brand"><h1 aria-label="ATHENA"><span class="e4-brand-measure" aria-hidden="true">ATHENA</span><span class="e4-brand-typed" aria-hidden="true"></span></h1><p>${escapeHtml(slide.subtitle || '')}</p></div>
  </section>`;

  const renderFinalSlide = slide => {
    const kind = String(slide.kind || '').toLowerCase();
    if (kind.includes('closing') || kind.includes('finish') || kind.includes('end')) return renderClosing(slide);
    if (kind === 'live-demo') return renderLiveDemo(slide);
    if (kind.startsWith('ai-')) return renderAi(slide);
    return renderBusiness(slide);
  };

  const originalCues = new Map(data.cues.map(cue => [cue.id, cue]));
  const finalCues = content.slides.map((slide, index) => {
    const original = originalCues.get(slide.id) || {};
    if (slide.kind === 'source' && scenes[slide.id] && !scenes[slide.id].finalHeaderApplied) {
      const definition = scenes[slide.id];
      const originalRender = definition.render;
      definition.title = slide.title;
      definition.render = () => {
        const host = document.createElement('div');
        host.innerHTML = originalRender();
        const header = host.querySelector('.e1-unified-header');
        if (header) {
          const title = header.querySelector('h1');
          const subtitle = header.querySelector('p');
          if (title) title.textContent = slide.title || title.textContent;
          if (subtitle) subtitle.textContent = slide.id === 's22' ? '' : (slide.subtitle || '');
        }
        return host.innerHTML;
      };
      definition.finalHeaderApplied = true;
    }
    if (slide.kind !== 'source') {
      scenes[slide.id] = {
        title: slide.title,
        ownHeader: true,
        render: () => renderFinalSlide(slide),
        play: async (root, api) => {
          if (root.querySelector('.final-closing-typing')) {
            await scenes.s12.play(root, api);
            return;
          }
          if (root.querySelector('.final-business')) {
            const header = root.querySelector('.final-header');
            const draws = [...root.querySelectorAll('[data-business-draw]')];
            const steps = [...root.querySelectorAll('.final-animate-step')].filter(element => element !== header && !header?.contains(element));
            const easing = 'cubic-bezier(.16,1,.3,1)';
            const animations = [
              api.animate(header, [{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 550, easing }),
              ...draws.map(draw => api.animate(draw, [{ opacity: 0, transform: 'scaleX(0)' }, { opacity: 1, transform: 'scaleX(1)' }], { duration: 700, easing })),
              ...steps.map((step, stepIndex) => api.animate(step, [{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 650, delay: stepIndex * 110 + 180, easing }))
            ];
            await Promise.all(animations);
            return;
          }
          if (root.querySelector('.final-ai')) {
            const hero = root.querySelector('.final-ai-hero');
            const steps = [...root.querySelectorAll('.final-ai-canvas .final-animate-step')];
            const footer = root.querySelector('.final-ai-footer');
            const easing = 'cubic-bezier(.2,.8,.2,1)';
            await Promise.all([
              api.animate(hero, [{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 520, easing }),
              ...steps.map((step, stepIndex) => api.animate(step, [{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 520, delay: 180 + stepIndex * 85, easing })),
              api.animate(footer, [{ opacity: 0 }, { opacity: 1 }], { duration: 440, delay: 760, easing })
            ]);
            return;
          }
          const header = root.querySelector('.final-header, .final-closing > div');
          const steps = [...root.querySelectorAll('.final-animate-step, .final-columns article')].filter(element => element !== header && !header?.contains(element));
          await api.animate(header, [{ opacity: 0, transform: 'translateY(22px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 520 });
          for (const step of steps) await api.animate(step, [{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 220 });
        }
      };
    }
    return {
      ...original,
      id: slide.id,
      script: `FINAL-${String(index + 1).padStart(2, '0')}`,
      sourceIds: slide.sourceId ? [slide.sourceId] : [],
      narration: slide.notes || '',
      stepNarration: slide.notes || '',
      unitNarration: slide.notes || '',
      note: `${slide.seconds}초 배정`,
      unit: index,
      hold: null,
      autoNext: false,
      title: slide.title
    };
  });
  data.cues = finalCues;
  data.units = finalCues.map((cue, index) => ({ number: index + 1, first: index, last: index, sourceIds: [...cue.sourceIds] }));
  window.ATHENA_SCRIPT = Object.fromEntries(finalCues.map(cue => [cue.script, cue.narration]));
  window.ATHENA_FINAL_BUILD = Object.freeze({ cues: finalCues, slides: content.slides, totalSeconds: content.slides.reduce((sum, slide) => sum + slide.seconds, 0) });

  if (typeof document === 'undefined') return;
  document.addEventListener('DOMContentLoaded', () => {
    if (new URL(location.href).searchParams.has('export')) document.body.classList.add('export-mode');
    const slidesById = new Map(content.slides.map(slide => [slide.id, slide]));
    const timerButton = document.getElementById('timer-toggle');
    const autoButton = document.getElementById('autoplay-toggle');
    const totalClock = document.getElementById('total-clock');
    const cueClock = document.getElementById('cue-clock');
    const notes = document.getElementById('presenter-notes');
    const notesButton = document.getElementById('notes-toggle');
    const notesClose = document.getElementById('manuscript-close');
    const notesCue = document.getElementById('manuscript-cue');
    const notesAllocation = document.getElementById('manuscript-allocation');
    const notesText = document.getElementById('manuscript-text');
    const totalSeconds = content.slides.reduce((sum, slide) => sum + slide.seconds, 0);
    let mode = 'idle';
    let auto = false;
    let elapsed = 0;
    let cueElapsed = 0;
    const wallNow = () => Date.now();
    let lastTick = wallNow();
    let cueId = document.body.dataset.cue || content.slides[0]?.id;
    let autoLatch = false;

    const format = seconds => {
      const value = Math.max(0, Math.floor(seconds));
      return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
    };
    const currentSlide = () => slidesById.get(cueId) || content.slides[0];
    const updateNotes = () => {
      const slide = currentSlide();
      notesCue.textContent = slide?.title || '현재 슬라이드 대본';
      notesAllocation.textContent = slide ? `${slide.seconds}초 배정` : '';
      notesText.textContent = slide?.notes || '';
    };
    const updateClock = () => {
      const allocation = currentSlide()?.seconds || 0;
      totalClock.textContent = `${format(elapsed)} / ${format(totalSeconds)}`;
      cueClock.textContent = `${format(cueElapsed)} / ${format(allocation)}`;
      timerButton.textContent = mode === 'idle' ? '발표 시작' : mode === 'running' ? '일시정지' : elapsed >= totalSeconds ? '처음부터' : '계속';
      timerButton.dataset.timerState = mode;
      autoButton.textContent = auto ? '자동 넘김 켬' : '자동 넘김 끔';
      autoButton.setAttribute('aria-pressed', String(auto));
    };
    const resetForCue = nextCue => {
      if (!nextCue || nextCue === cueId) return;
      cueId = nextCue;
      cueElapsed = 0;
      autoLatch = false;
      lastTick = wallNow();
      updateNotes();
      updateClock();
    };
    const startOrPause = () => {
      if (mode === 'running') mode = 'paused';
      else if (elapsed >= totalSeconds) {
        elapsed = 0; cueElapsed = 0; autoLatch = false; mode = 'running';
        window.presentation?.goTo(0);
      } else mode = 'running';
      lastTick = wallNow();
      updateClock();
    };
    const toggleAuto = () => { auto = !auto; autoLatch = false; updateClock(); };
    const tick = () => {
      const now = wallNow();
      if (mode === 'running') {
        const delta = Math.max(0, (now - lastTick) / 1000);
        elapsed = Math.min(totalSeconds, elapsed + delta);
        cueElapsed += delta;
        const allocation = currentSlide()?.seconds || 0;
        if (auto && !autoLatch && allocation > 0 && cueElapsed >= allocation && window.presentation?.sceneIndex < content.slides.length - 1) {
          autoLatch = true;
          window.presentation.next();
        }
        if (elapsed >= totalSeconds) mode = 'paused';
        updateClock();
      }
      lastTick = now;
      requestAnimationFrame(tick);
    };

    timerButton.addEventListener('click', startOrPause);
    autoButton.addEventListener('click', toggleAuto);
    notesButton.addEventListener('click', () => {
      requestAnimationFrame(() => {
        notesButton.setAttribute('aria-expanded', String(!notes.hidden));
        document.body.classList.toggle('notes-open', !notes.hidden);
        updateNotes();
      });
    });
    notesClose.addEventListener('click', () => {
      notes.hidden = true;
      notesButton.setAttribute('aria-expanded', 'false');
      document.body.classList.remove('notes-open');
    });
    new MutationObserver(() => resetForCue(document.body.dataset.cue)).observe(document.body, { attributes: true, attributeFilter: ['data-cue'] });
    document.addEventListener('keydown', event => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.repeat || event.target.closest('input,textarea,select,[contenteditable="true"]')) return;
      const key = event.key.toLowerCase();
      if (key === 't') { event.preventDefault(); startOrPause(); }
      if (key === 'a') { event.preventDefault(); toggleAuto(); }
    });
    updateNotes();
    updateClock();
    requestAnimationFrame(tick);
  });
})();
