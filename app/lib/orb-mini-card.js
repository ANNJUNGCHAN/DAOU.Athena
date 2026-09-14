'use strict';

const boardFormat = (typeof module !== 'undefined' && module.exports)
  ? require('./board-format')
  : (typeof window !== 'undefined' && window.AthenaLib && window.AthenaLib.BoardFormat);

const CARD_SIZE = Object.freeze({ width: 360, height: 420 });
const GRAMMAR_TITLE = Object.freeze({
  table: '표', chart: '차트', facts: '사실', compound: '복합', event: '이벤트',
  action: '작업', status: '상태', reader: '본문', stream: '스트림',
  order_ticket: '주문 티켓',
});

// 키우미 미니 카드의 결정 로직 (Paper 키우미 보드 09 · 2026-09-01).
//
// 오브는 자기 화면을 가진다 — 360×420 고정 카드라 캔버스 카드를 그대로
// 못 들인다. 보드 09가 캔버스 9종(table·chart·facts·compound·event·action·
// status·reader·stream)을 미니 10종으로 받는 상한과 공통 규칙을 확정했고,
// 이 파일은 그중 **무엇을 보여주고 무엇을 접을지**만 정한다. DOM은 orb.js가
// 짓는다(그쪽은 createElement/textContent만 쓴다 — innerHTML 0건).
//
// 순수 함수만 둔 이유는 column-fold.js·facts-card.js와 같다: 상한과 고지 문구는
// 정직성 계약이라 회귀가 나면 안 되는데, DOM에 묻어두면 단위 테스트로 못 고정한다.
//
// 보드 09 공통 규칙 5가지가 여기 전부 들어 있다:
//   1. 값을 짓지 않는다   — hasValue로 걸러 행 자체를 안 만든다.
//   2. 접었으면 밝힌다     — 실제로 접었을 때만 개수를 낸다(0개 고지 금지).
//   3. 실행은 05 하나      — 여기에는 액션이 없다(주문 티켓은 orb.js 전용 경로).
//   4. 축소판이 아니다     — 캔버스 16종 렌더러를 참조하지 않는다.
//   5. innerHTML 0건       — 이 파일은 문자열만 돌려주고 마크업을 만들지 않는다.

/** 보드 09 상한표. 숫자를 바꾸면 보드 09의 상한표도 같이 바꿔야 한다. */
const LIMITS = Object.freeze({
  tableRows: 3,        // 표 — 헤더 제외 3행
  factsRows: 5,        // 사실 — 라벨·값 5행
  compoundScalars: 3,  // 복합 — 스칼라 밴드 3개
  compoundRows: 2,     // 복합 — 표 2행
  logRecords: 2,       // 이벤트·스트림 — 2건
  readerChars: 140,    // 본문 — 3줄 상당
});

/** 빈 값 판정. null·undefined·빈 문자열만 없는 값이다 — 0과 false는 값이다
 * (0을 지우면 "측정했는데 값이 없다"가 아니라 "0이다"라는 사실이 사라진다). */
function hasValue(value) {
  return value !== null && value !== undefined && value !== '';
}

function fieldHasValue(field) {
  return !!field && hasValue(field.value);
}

function slotValueMap(surfaceContract) {
  const raw = surfaceContract && (surfaceContract.slot_values || surfaceContract.slotValues);
  if (Array.isArray(raw)) {
    return new Map(raw.filter((entry) => entry && entry.slot_id).map((entry) => [entry.slot_id, entry]));
  }
  if (raw && typeof raw === 'object') {
    return new Map(Object.entries(raw).map(([slotId, value]) => [slotId, { slot_id: slotId, value }]));
  }
  return new Map();
}

// 차트 선(base:ka10081)과 헤더 값(detail:ka10001)은 서로 다른 조회에서 온다.
// 캔들의 마지막 종가를 현재가로 바꾸어 쓰지 않고, Kiumi가 고른 헤더 슬롯 중
// 실제로 비어 있는 것만 본체 카드와 같은 하이드레이션 경로에 요청한다.
function kiumiChartHydrationRequest(envelope) {
  const surfaceContract = envelope && (envelope.surface_contract || envelope.surfaceContract);
  const spec = surfaceContract && surfaceContract.kiumi;
  if (!spec || spec.version !== 1 || spec.fixed !== true || spec.grammar !== 'chart'
    || !Array.isArray(spec.elements) || !surfaceContract.board_id || !boardFormat) return null;
  const values = slotValueMap(surfaceContract);
  const slotIds = spec.elements.flatMap((element) => {
    const slotId = String((element && element.source_slot_id) || '').trim();
    if (!slotId) return [];
    const entry = values.get(slotId);
    const format = (element.format && typeof element.format === 'object')
      ? element.format
      : ((entry && entry.format) || {});
    return boardFormat.formatSlot(format, entry ? entry.value : undefined).missing ? [slotId] : [];
  });
  if (!slotIds.length) return null;
  const args = (envelope.operation_args || envelope.operationArgs || envelope.arguments) || {};
  const target = args && typeof args === 'object' && !Array.isArray(args) ? { ...args } : {};
  const stockCode = envelope.stk_cd || envelope.symbol || target.stk_cd || target.symbol;
  if (stockCode) target.stk_cd = stockCode;
  const account = envelope.account_id || envelope.account_no || target.account_id
    || target.account_no || target.acnt_no || '';
  return {
    boardId: String(surfaceContract.board_id),
    slotIds: [...new Set(slotIds)],
    target,
    account,
    correlation: envelope.correlation,
  };
}

// main이 현재 활성 계좌로 확인해 돌려준 슬롯만 초기 봉투에 덧댄다. 실패·빈 응답은
// 원본 봉투를 그대로 돌려 `미제공`을 보존하고, 캔들 값이나 0을 만들지 않는다.
function withKiumiHydration(envelope, reply) {
  if (!envelope || !reply || reply.ok !== true || !reply.slot_values
    || typeof reply.slot_values !== 'object' || Array.isArray(reply.slot_values)) return envelope;
  const filled = Object.entries(reply.slot_values);
  if (!filled.length) return envelope;
  const contractKey = envelope.surface_contract ? 'surface_contract' : 'surfaceContract';
  const surfaceContract = envelope[contractKey];
  if (!surfaceContract || typeof surfaceContract !== 'object') return envelope;
  const raw = surfaceContract.slot_values || surfaceContract.slotValues;
  let slotValues;
  if (Array.isArray(raw)) {
    const filledIds = new Set(filled.map(([slotId]) => slotId));
    slotValues = raw.filter((entry) => !entry || !filledIds.has(String(entry.slot_id || '')));
    slotValues.push(...filled.map(([slotId, value]) => ({ slot_id: slotId, value })));
  } else {
    slotValues = { ...((raw && typeof raw === 'object') ? raw : {}), ...reply.slot_values };
  }
  return {
    ...envelope,
    [contractKey]: {
      ...surfaceContract,
      slot_values: slotValues,
    },
  };
}

// 같은 0B 체결 프레임에서 직접 확인된 현재가(FID 10)·전일대비(FID 11)·
// 등락률(FID 12)만 Kiumi 헤더 표기로 바꾼다. 일부 필드가 없으면 기존 스냅샷과
// 섞지 않고 그 슬롯 갱신을 건너뛴다.
function kiumiChartLiveUpdates(surfaceContract, tick) {
  const spec = surfaceContract && surfaceContract.kiumi;
  if (!spec || spec.grammar !== 'chart' || String(surfaceContract.board_id || '') !== '137X-2'
    || !Array.isArray(spec.elements) || !tick || !boardFormat) return [];
  const values = slotValueMap(surfaceContract);
  const updates = [];
  for (const element of spec.elements) {
    const slotId = String((element && element.source_slot_id) || '').trim();
    if (!slotId) continue;
    let formatted = null;
    let authoritativeValue;
    if (element.role === 'primary' && Number.isFinite(tick.price) && tick.price > 0) {
      authoritativeValue = tick.price;
      formatted = boardFormat.formatSlot(element.format || {}, authoritativeValue);
    } else if (element.role === 'change' && Number.isFinite(tick.change)
      && Number.isFinite(tick.changeRate)) {
      const entry = values.get(slotId);
      const raw = entry && entry.value;
      const composite = raw && raw.composite;
      const existingParts = composite && Array.isArray(composite.parts) ? composite.parts : null;
      // s006 값이 아직 하이드레이션되지 않았어도 chart/change 요소 자체가 고정
      // 템플릿 권위다. 값은 같은 WS 프레임의 FID 11·12만 넣고, 캔들/0을 쓰지 않는다.
      const parts = existingParts
        && existingParts.some((part) => part && part.f === 'pred_pre')
        && existingParts.some((part) => part && part.f === 'flu_rt')
        ? existingParts
        : [
          { mapping_id: 'detail:ka10001:current_trading', f: 'pred_pre', format: { kind: 'number', sign: true } },
          { mapping_id: 'detail:ka10001:current_trading', f: 'flu_rt', format: {
            kind: 'percent', sign: true, precision: 2,
          } },
        ];
      authoritativeValue = {
        ...((raw && typeof raw === 'object') ? raw : {}),
        composite: {
          ...((composite && typeof composite === 'object') ? composite : {}),
          separator: (composite && typeof composite.separator === 'string') ? composite.separator : ' · ',
          parts: parts.map((part) => ({
            ...part,
            value: part.f === 'pred_pre' ? tick.change
              : (part.f === 'flu_rt' ? tick.changeRate : part.value),
          })),
        },
      };
      formatted = boardFormat.formatSlot(element.format || {}, authoritativeValue);
    }
    if (formatted && !formatted.missing) updates.push({ slotId, ...formatted, value: authoritativeValue });
  }
  return updates;
}

function applyKiumiChartLiveUpdates(card, updates) {
  if (!card || typeof card.querySelectorAll !== 'function' || !Array.isArray(updates)) return 0;
  const updatesBySlot = new Map(updates.map((update) => [String(update.slotId || ''), update]));
  let applied = 0;
  for (const node of card.querySelectorAll('[data-kiumi-slot-id]')) {
    const update = updatesBySlot.get(String(node.dataset && node.dataset.kiumiSlotId || ''));
    if (!update) continue;
    node.textContent = update.text;
    node.classList.toggle('is-missing', false);
    node.classList.toggle('is-up', update.tone === 'up');
    node.classList.toggle('is-down', update.tone === 'down');
    node.classList.toggle('is-flat', update.tone === 'flat');
    applied += 1;
  }
  return applied;
}

function applyRevisionedKiumiUpdates(card, updates) {
  const validUpdates = Array.isArray(updates) ? updates.filter((update) => !update.missing) : [];
  if (!card || typeof card.querySelectorAll !== 'function' || !validUpdates.length) return [];
  const presentSlots = new Set(Array.from(card.querySelectorAll('[data-kiumi-slot-id]'))
    .map((node) => String((node.dataset && node.dataset.kiumiSlotId) || '')));
  const appliedSlotIds = [...new Set(validUpdates
    .map((update) => String(update.slotId || ''))
    .filter((slotId) => slotId && presentSlots.has(slotId)))];
  if (!appliedSlotIds.length || !applyKiumiChartLiveUpdates(card, validUpdates)) return [];
  const revisions = card.__athenaOrbLiveSlotRevisions || new Map();
  for (const slotId of appliedSlotIds) revisions.set(slotId, (revisions.get(slotId) || 0) + 1);
  card.__athenaOrbLiveSlotRevisions = revisions;
  return appliedSlotIds;
}

function kiumiHydrationUpdates(planElements, revisionsAtStart, liveRevisions) {
  const before = revisionsAtStart instanceof Map ? revisionsAtStart : new Map();
  const current = liveRevisions instanceof Map ? liveRevisions : new Map();
  return (Array.isArray(planElements) ? planElements : []).filter((element) => {
    const slotId = String((element && element.slotId) || '');
    return (current.get(slotId) || 0) === (before.get(slotId) || 0);
  });
}

/**
 * 백엔드 표면 계약에서 카드별 고정 표시 계획을 만든다. ``paper_text``는 승인 증거일
 * 뿐 런타임 값으로 쓰지 않는다. 선택 슬롯이 이번 응답에 없으면 반드시 ``미제공``을
 * 표시해 Paper 예시값을 실제 조회값처럼 보이는 일을 막는다.
 */
function buildKiumiPlan(surfaceContract, envelope) {
  const spec = surfaceContract && surfaceContract.kiumi;
  if (!spec || spec.version !== 1 || spec.fixed !== true) return null;
  if (spec.width_px !== CARD_SIZE.width || spec.height_px !== CARD_SIZE.height) return null;
  if (!Array.isArray(spec.elements) || !spec.elements.length || !boardFormat) return null;
  const values = slotValueMap(surfaceContract);
  const elements = spec.elements.map((element) => {
    const slotId = element.source_slot_id;
    const entry = values.get(slotId);
    const format = (element.format && typeof element.format === 'object')
      ? element.format
      : ((entry && entry.format) || {});
    const formatted = boardFormat.formatSlot(format, entry ? entry.value : undefined);
    return {
      slotId,
      label: String(element.label || ''),
      role: String(element.role || 'fact'),
      band: String(element.band || 'scalar'),
      text: formatted.text,
      tone: formatted.tone || null,
      missing: formatted.missing === true,
    };
  });
  // kiumi는 Paper에서 고른 슬롯만 책임진다. 실제 응답의 카드 종류와 종목은
  // 런타임 봉투가 권위다. 둘이 다르면 이 계획을 거부해 orb.js의 일반 렌더러가
  // 실제 fields·rows로 제목과 접힘 수를 계산하게 한다.
  const runtimeCanvasType = envelope && typeof envelope.canvas_type === 'string'
    ? envelope.canvas_type
    : '';
  const runtimeGrammar = ['table', 'chart', 'facts', 'compound', 'event', 'action', 'status', 'reader', 'stream']
    .includes(runtimeCanvasType)
    ? runtimeCanvasType
    : '';
  const grammarMismatch = !!runtimeGrammar
    && spec.grammar !== 'order_ticket'
    && runtimeGrammar !== spec.grammar;
  if (grammarMismatch) return null;
  const runtimeTitle = envelope && typeof envelope.card_title === 'string'
    ? envelope.card_title.trim()
    : '';
  const runtimeCaption = envelope && typeof envelope.caption === 'string'
    ? envelope.caption.trim()
    : '';
  const runtimeCode = envelope && envelope.stk_cd != null
    ? String(envelope.stk_cd).trim()
    : '';
  const actualTitle = runtimeTitle || runtimeCaption || GRAMMAR_TITLE[spec.grammar] || '정보';
  return {
    boardId: String(surfaceContract.board_id || ''),
    cardId: String(surfaceContract.card_id || ''),
    grammar: String(spec.grammar || ''),
    title: envelope
      ? [runtimeCode, actualTitle].filter(Boolean).join(' · ')
      : String(spec.title || ''),
    eyebrow: String(spec.eyebrow || ''),
    width: CARD_SIZE.width,
    height: CARD_SIZE.height,
    elements,
    foldNote: typeof spec.fold_note === 'string' && spec.fold_note ? spec.fold_note : null,
  };
}

/** 리스트 상한 적용의 공통 형태. 접힌 개수는 **보인 뒤 남은 것**만 센다. */
function takeWithRest(items, limit) {
  const list = Array.isArray(items) ? items : [];
  const shown = list.slice(0, limit);
  return { shown, hidden: Math.max(0, list.length - shown.length), total: list.length };
}

/** 사실(facts) — 값이 있는 필드만 5행까지. 값 없는 필드는 접힌 개수에도 안 든다
 * (없는 것을 "접었다"고 하면 그것도 지어낸 수다). */
function pickFactsRows(fields) {
  const present = (Array.isArray(fields) ? fields : []).filter(fieldHasValue);
  return takeWithRest(present, LIMITS.factsRows);
}

/** 복합(compound) — 스칼라 밴드와 표를 각각 따로 접는다. */
function pickCompound(header, rows) {
  const scalars = takeWithRest((Array.isArray(header) ? header : []).filter(fieldHasValue), LIMITS.compoundScalars);
  const table = takeWithRest(rows, LIMITS.compoundRows);
  return { scalars, table };
}

/** 이벤트·스트림 — 최근 2건. */
function pickLogRecords(records) {
  return takeWithRest(records, LIMITS.logRecords);
}

/** 본문(reader) — 첫 문단만, 그것도 140자까지. 마크다운을 해석하지 않으므로
 * 줄머리 기호만 벗겨 한 줄로 잇는다(오브에는 마크다운 렌더러가 없다). */
function clampReaderBody(raw) {
  const text = typeof raw === 'string' ? raw : '';
  const total = text.length;
  const firstBlock = text.split(/\n{2,}/).find((block) => block.trim().length > 0) || '';
  const flattened = firstBlock
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[#>*\-+]+\s*|\d+\.\s+)/, '').trim())
    .filter(Boolean)
    .join(' ');
  if (!flattened) return { text: '', clipped: false, total };
  if (flattened.length <= LIMITS.readerChars && flattened.length === total) {
    return { text: flattened, clipped: false, total };
  }
  const cut = flattened.slice(0, LIMITS.readerChars);
  return {
    text: flattened.length > LIMITS.readerChars ? `${cut}…` : flattened,
    clipped: true,
    total,
  };
}

/** 이벤트 한 건을 한 줄로. 캔버스는 5쌍까지 붙이지만 360px에서는 3쌍이 상한이다. */
function recordLine(record) {
  if (typeof record === 'string') return record;
  if (!record || typeof record !== 'object') return '';
  return Object.entries(record)
    .filter(([, value]) => hasValue(value))
    .slice(0, 3)
    .map(([key, value]) => `${key} ${value}`)
    .join(' · ');
}

/** 스트림 시각 — canvas.js formatRecordTs와 같은 규칙이다. day 정밀도에서
 * 없는 시:분을 지어내지 않는다. */
function formatStreamTime(ts, precision) {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  if (precision === 'day') return `${mm}.${dd}`;
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${mm}.${dd} ${hh}:${mi}`;
}

/** 스트림 출처 — source가 없으면 url의 호스트만. 둘 다 없으면 빈 문자열이고,
 * 그 경우 orb.js가 출처 줄 자체를 만들지 않는다. */
function streamSource(record) {
  if (!record || typeof record !== 'object') return '';
  if (hasValue(record.source)) return String(record.source);
  if (!hasValue(record.url)) return '';
  try {
    return new URL(String(record.url)).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** 접힘 고지 문구 — 실제로 접었을 때만 문자열을 돌려준다. 아무것도 안 접혔으면
 * null이고, 호출부는 null이면 고지 자체를 안 만든다(보드 09 규칙 2). */
function foldNote(kind, counts = {}) {
  const { columns = 0, rows = 0, items = 0, scalars = 0, total = 0, shown = 0 } = counts;
  if (kind === 'table') {
    if (columns <= 0 && rows <= 0) return null;
    return `열 ${columns}개 · 행 ${rows}개를 접었습니다 — 전체는 캔버스에서`;
  }
  if (kind === 'facts') {
    if (items <= 0) return null;
    return `항목 ${items}개를 접었습니다 — 전체는 캔버스에서`;
  }
  if (kind === 'compound') {
    if (scalars <= 0 && rows <= 0) return null;
    return `스칼라 ${scalars}개 · 행 ${rows}개를 접었습니다 — 전체는 캔버스에서`;
  }
  if (kind === 'log') {
    if (total <= shown) return null;
    return `최근 ${shown}건 · ${total}건 중 — 전체는 캔버스에서`;
  }
  if (kind === 'reader') {
    if (total <= 0) return null;
    return `첫 문단만 · 전문 ${total}자는 캔버스에서`;
  }
  return null;
}

const __exports = {
  CARD_SIZE,
  LIMITS,
  hasValue,
  fieldHasValue,
  pickFactsRows,
  pickCompound,
  pickLogRecords,
  clampReaderBody,
  recordLine,
  formatStreamTime,
  streamSource,
  foldNote,
  buildKiumiPlan,
  kiumiChartHydrationRequest,
  withKiumiHydration,
  kiumiChartLiveUpdates,
  applyKiumiChartLiveUpdates,
  applyRevisionedKiumiUpdates,
  kiumiHydrationUpdates,
};

// UMD 각주 — facts-card.js와 같은 패턴(렌더러 격리).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.OrbMiniCard = __exports;
}
