function attachRestRetryAction(card, retryId) {
  if (!card || !retryId) return;
  const body = card.querySelector('.card-body');
  if (!body) return;
  const prior = card.querySelector('.rest-retry-action');
  if (prior) prior.remove();
  const action = document.createElement('div');
  action.className = 'rest-retry-action';
  const button = document.createElement('button');
  button.type = 'button';
  // Paper 1IG3-0 — 중단 카드의 행동 문구는 상태 모델이 정한다(결과가 남아 있으면
  // 「결과 유지 · 다시 검색」). 나머지 상태는 지금까지의 「다시 시도」 그대로다.
  button.textContent = card.dataset.restActionLabel || '다시 시도';
  const status = document.createElement('span');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const finishConsumed = (message) => {
    button.remove();
    action.dataset.consumed = 'true';
    status.textContent = message;
  };
  button.addEventListener('click', async () => {
    button.disabled = true;
    button.textContent = '다시 시도 중…';
    status.textContent = '';
    try {
      const result = await window.athena.invoke('athena__render_canvas', {
        source: 'rest-retry',
        retryId,
      });
      if (!result || !result.ok) {
        finishConsumed((result && result.error) || '다시 조회하지 못했습니다.');
        return;
      }
      status.textContent = '다시 조회했습니다.';
      if (card.isConnected) destroyCard(card);
      else button.remove();
    } catch {
      finishConsumed('다시 조회하지 못했습니다.');
    }
  });
  action.appendChild(button);
  action.appendChild(status);
  body.appendChild(action);
}


function paintedDataCardsFor(datasetId) {
  if (!datasetId) return [];
  return Array.from(grid.querySelectorAll('.card[data-dataset-id]'))
    .filter((candidate) => candidate.dataset.datasetId === datasetId && !candidate.dataset.screenState);
}

function renderRestStateCard(envelope) {
  const type = envelope.canvas_type === 'table' ? 'mcp-table' : envelope.canvas_type;
  const labels = {
    timeout: ['조회 시간 초과', '제한 시간 안에 데이터를 받지 못했습니다. 다시 시도해 주세요.'],
    error: ['조회 오류', '데이터를 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.'],
  };
  // Paper 1IG3-0 — 사용자 취소는 이미 확인한 값을 지우지 않는다. 남은 카드 수로
  // 문구와 행동을 가른다(빈 취소 카드는 정말 아무것도 못 받았을 때만 쓴다).
  const cancelled = envelope.state === 'cancelled'
    ? integratedCardSurface.buildCancelledState({
      partial: paintedDataCardsFor((envelope.correlation && envelope.correlation.dataset_id) || activeDatasetId),
    })
    : null;
  const [title, message] = cancelled
    ? [cancelled.title, cancelled.message]
    : (labels[envelope.state] || labels.error);
  const { card, body } = makeCard(type, title, envelope.layout, envelope.correlation);
  card.dataset.screenState = envelope.state;
  card.dataset.renderState = envelope.state === 'timeout' ? 'timeout' : 'error';
  if (cancelled) {
    card.dataset.restActionLabel = cancelled.action;
    card.dataset.keepResults = String(cancelled.keepResults);
  }
  if (envelope.screen_id) card.dataset.screenId = envelope.screen_id;
  body.appendChild(errorNote(message));
  return card;
}

// 카드를 못 그릴 상황(거부/에러/해석불가)을 조용히 삼키지 않는다 — 모자이크에
// 안내 카드를 하나 띄운다. 'free'가 아니라 별도 타입('notice')을 쓴다 — 같은
// 세션에서 정상 free 카드가 이미 떠 있는데 이후 호출이 실패하면, makeCard가
// 같은 타입 카드를 갈아치우는 규칙(재요청 시 새로 갱신) 때문에 실제 데이터
// 카드가 에러 배너로 덮일 수 있어서다. ui-kit.errorNote는 role="alert"다.

function makeCard(type, title, layoutHint, correlation, subtitle, stkCd, screenId) {
  const isDatasetCard = isValidCorrelation(correlation);
  if (isDatasetCard && activeDatasetId !== correlation.dataset_id) {
    for (const prior of grid.querySelectorAll('.card[data-dataset-id]')) {
      destroyCard(prior);
    }
    activeDatasetId = correlation.dataset_id;
  }
  const existing = isDatasetCard
    ? Array.from(grid.querySelectorAll('.card[data-dataset-id]')).find((candidate) => (
      candidate.dataset.datasetId === correlation.dataset_id
      && candidate.dataset.itemId === correlation.item_id
      && Number(candidate.dataset.ordinal) === correlation.ordinal
    ))
    : Array.from(grid.querySelectorAll(`.card.${type}`)).find((candidate) => {
      if (candidate.classList.contains('integrated-card')) return false;
      if (candidate.dataset.datasetId) return false;
      // stk_cd 없는 요청(종목코드 자리가 없는 카드종·구버전 envelope)은 기존
      // 동작 그대로 — 동일 타입이면 무조건 교체(하위 호환).
      if (!stkCd) return true;
      // stk_cd 있는 요청은 같은 종목 + 같은 화면(screen_id)만 교체 대상 —
      // 다른 종목은 물론, 같은 종목의 다른 화면(호가 매도/매수/총잔량처럼
      // ka10004 detail 5장이 연달아 오는 경우)도 공존한다(2026-08-27 장중
      // QA 실측: screen_id 없이 종목만 보면 5장이 서로를 지워 1장만 남았다).
      return candidate.dataset.stkCd === stkCd
        && (candidate.dataset.screenId || '') === (screenId || '');
    });
  const activeDatasetCardCount = Array.from(grid.querySelectorAll('.card[data-dataset-id]'))
    .filter((candidate) => candidate.dataset.datasetId === correlation.dataset_id).length;
  if (isDatasetCard && !existing && activeDatasetCardCount >= 6) {
    throw new Error('REST 데이터셋 카드는 최대 6개다');
  }
  if (existing) destroyCard(existing); // 재요청 시 새로 갱신 — renderer/session도 함께 폐기
  const card = document.createElement('div');
  // 폭은 형상이 정하고(w-half/w-full), AI layout 힌트는 등급 승격·강등만 한다.
  // 순서는 도착순(appendChild) — canvas-taxonomy "배치·생애주기 규칙 (2026-08-18)".
  card.className = `card ${type} w-${widthGradeFor(type, layoutHint)}`;
  if (['stream', 'reader', 'table', 'mcp-table', 'free', 'notice', 'facts', 'compound', 'event', 'action', 'status', 'timeline'].includes(type)) {
    card.classList.add('common-card');
  }
  if (isDatasetCard) {
    card.dataset.datasetId = correlation.dataset_id;
    card.dataset.itemId = correlation.item_id;
    card.dataset.ordinal = String(correlation.ordinal);
  } else if (stkCd) {
    card.dataset.stkCd = stkCd;
    if (screenId) card.dataset.screenId = String(screenId);
  }
  const head = document.createElement('div');
  head.className = 'card-head';
  // .card-head는 space-between 2-child 배선이다(title↔head-right) — 서브타이틀은
  // 세 번째 flex item으로 흩뿌리지 않고 title과 함께 .card-titles에 묶는다.
  const titles = document.createElement('div');
  titles.className = 'card-titles';
  const h = document.createElement('div');
  h.className = 'card-title';
  h.textContent = title;
  titles.appendChild(h);
  if (subtitle) {
    const sub = document.createElement('div');
    sub.className = 'card-subtitle';
    sub.textContent = subtitle;
    titles.appendChild(sub);
  }
  const fresh = document.createElement('div');
  fresh.className = 'card-fresh';
  fresh.textContent = freshLabel();
  const rightGroup = document.createElement('div');
  rightGroup.className = 'card-head-right';
  rightGroup.appendChild(fresh);
  rightGroup.appendChild(cardCloseButton(card));
  head.appendChild(titles);
  head.appendChild(rightGroup);
  const body = document.createElement('div');
  body.className = 'card-body';
  card.appendChild(head);
  card.appendChild(body);
  grid.appendChild(card);
  enforceHeightBudget();
  // 2026-08-19 QA 결함 #2 실제 원인 — .grid는 overflow-y:auto라 카드가 쌓여
  // 뷰포트를 넘기면, 새/갱신 카드가 스크롤 위치 밖(화면 아래)에 조용히 붙는다.
  // scrollTop을 아무도 옮기지 않으니 사용자는 새 카드가 도착한 줄도 모른다 —
  // capturePage() 캡처가 "안 바뀐 것처럼" 보인 진짜 이유였다(19-chart-card.png /
  // 20-live-chart-card.png가 MD5까지 같았던 것 — 캔버스 자체는 매번 옳게 갱신됐고,
  // 화면에 안 보이는 위치에 있었을 뿐). 캡처 버그가 아니라 실사용에서도 새 카드가
  // 안 보일 수 있는 결함이라 여기(카드 생성 지점)에서 고친다.
  card.scrollIntoView({ block: 'nearest' });
  // 2026-08-19 QA 결함 #5 — 하단 경계에서 반쯤 잘린 글리프가 다른 글자로 읽힌다
  // (픽스처 원문 "주주균등처분(주)"이 03-mosaic-expanded.png에서 "조조규등처부(조)"로
  // 보였다 — 인코딩이 아니라 descender 절단). 스크롤이 실제로 생겼을 때만
  // .is-clipped를 붙여 CSS 페이드(잘림의 정직한 표시)를 켠다. 내용이 다 보이면
  // 페이드도 없다 — 정보 정직성 우선.
  const syncClipped = () => {
    body.classList.toggle('is-clipped', body.scrollHeight > body.clientHeight + 1);
  };
  new ResizeObserver(syncClipped).observe(body);
  new MutationObserver(syncClipped).observe(body, { childList: true, subtree: true });
  return { card, body };
}

