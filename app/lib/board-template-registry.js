// IIFE 스코프 격리 — board-format.js와 같은 이유(렌더러 스크립트 스코프 공유).
(function () {
'use strict';

// 생성물 색인. scripts/build_board_registry.py가
// backend/ref/card-surface-templates/*/board.html을 카드별 청크로 묶고, 보드 id →
// 카드 id 색인 하나를 따로 낸다 — 여기서는 읽기만 한다.
//
// 셸이 동기로 싣는 것은 색인(수 KB)뿐이다. 원문 HTML은 카드 청크(수 MB)에 들어
// 있고, 마운트 직전에 필요한 청크 하나만 `<script src>` 주입으로 가져온다.
// fetch를 쓰지 않는 이유는 렌더러가 file:// 스코프이기 때문이다(fetch는 막힌다,
// script src는 된다).
const isCjs = typeof module !== 'undefined' && !!module.exports;
const lib = (typeof window !== 'undefined' && window.AthenaLib) || null;
const index = isCjs
  ? require('./board-templates.index.generated')
  : (lib && lib.BoardTemplatesIndex);

const BOARD_CARD = (index && index.BOARD_CARD) || {};
const CARD_IDS = (index && index.CARD_IDS) || [];
const STATE_GRAPH = (index && index.STATE_GRAPH) || {};
const BOARD_PRIMARY = (index && index.BOARD_PRIMARY) || {};
const CONTROL_LABELS = (index && index.CONTROL_LABELS) || {};

// CC-01 repeats these seven authored navigation labels (s004–s010) in every
// account surface. Expanded surfaces still need this same read-only navigation.
// 증거금·담보 opens the authored "증거금 재원·담보 상세" surface; the separate
// 증거금·보증금 구간별 expansion remains available through its existing control.
const ACCOUNT_NAVIGATION = Object.freeze([
  { control: '자산 종합', board_id: '133H-2' },
  { control: '보유종목', board_id: '2SCE-1' },
  { control: '예수금·결제', board_id: '2SKU-1' },
  { control: '손익·성과', board_id: '2SRV-1' },
  { control: '주문·체결', board_id: '2SYW-1' },
  { control: '증거금·담보', board_id: '3IGR-0' },
  { control: '금현물', board_id: '3ODO-0' },
]);

// Instrument details require the subject of the same market. The source board
// is server-authored; a specimen name or a six-character code cannot prove it.
const INSTRUMENT_DOMAINS = Object.freeze({
  gold: ['2RJ7-1', '2QX1-1'],
  sector: ['32S7-0', '15J9-2', '2TZN-1'],
  etf: ['15N5-2', '2VIN-0', '2WZK-0'],
  elw: ['15P5-2', '2VO0-0', '2XA5-0', '2XY6-0', '2Y47-0', '2Z49-0', '2ZN9-0', '3DZ1-0', '3TOM-0'],
});
const INSTRUMENT_DETAIL_DOMAINS = Object.freeze({
  '137X-2': 'stock', '2R3M-1': 'stock', '2RBO-1': 'stock',
  '3DI2-0': 'stock', '3FR6-0': 'stock',
  '2RJ7-1': 'gold', '2QX1-1': 'gold', '32S7-0': 'sector', '15N5-2': 'etf',
  '15P5-2': 'elw', '3DZ1-0': 'elw',
  '13BC-2': 'stock', '1JPU-0': 'stock', '2TRW-1': 'stock',
  '3JZ3-0': 'stock', '3N4O-0': 'stock', '2QRP-1': 'stock', '3JT4-0': 'stock',
});
const ELW_LIST_BOARDS = ['2VO0-0', '2XA5-0', '2XY6-0', '2Y47-0', '2Z49-0', '2ZN9-0'];
// These detail headers visibly repeat the ETF/ELW tabs, but the authored graph
// omits their destinations. Ranking headers have different ETF/ELW list links.
const DETAIL_MARKET_TABS = ['137X-2', '2R3M-1', '2RBO-1', '2RJ7-1', '32S7-0', '32XM-0', '3DI2-0', '3FR6-0'];
const DETAIL_MARKET_LINKS = [
  { control: 'ETF', board_id: '15N5-2' },
  { control: 'ELW', board_id: '15P5-2' },
];
// These visible buttons exist in the canonical surfaces, separately from the
// specimen's marked KPI/footer anchors. Both must open the same read-only view.
const ADDITIONAL_CONTROL_LABELS = Object.freeze({
  '신용비율 높은 순': ['신용비율 상위'],
  '대차잔고 많은 순': ['대차 상위'],
  'ELW 거래원별 10창구 전체': ['창구 상세 열기'],
});

function additionalControlLabels(control) {
  return (ADDITIONAL_CONTROL_LABELS[control] || []).slice();
}

function additionalStateLinks(boardId) {
  if (['2UHM-1', '31II-0', '3TCO-0'].includes(boardId)) return [{ control: '시장 체온·VI', board_id: '15R0-2' }];
  if (boardId === '15R0-2') return [{ control: 'VI 조회 결과로', board_id: '2UHM-1' }];
  if (boardId === '2UN6-1') return [{ control: '관심·조건 신호', board_id: '15L8-2' }];
  if (boardId === '15L8-2') return [{ control: '조건검색 결과로', board_id: '2UN6-1' }];
  if (DETAIL_MARKET_TABS.includes(boardId)) return DETAIL_MARKET_LINKS;
  if (boardId === '15N5-2') return [
    { control: '현재시세', board_id: '2R3M-1' },
    { control: '차트', board_id: '137X-2' },
    { control: '기업정보', board_id: '2RBO-1' },
    ...DETAIL_MARKET_LINKS,
    { control: '금현물', board_id: '2RJ7-1' },
    { control: '순위', board_id: '2VDA-0' },
  ];
  if (ELW_LIST_BOARDS.includes(boardId) && boardId !== '2Z49-0') {
    return [{ control: 'ELW 상세 열기', board_id: '15P5-2' }];
  }
  if (boardId === '2VIN-0') return [{ control: '기간 수익률', board_id: '2WZK-0' }];
  return [];
}

function instrumentDomainFor(boardId) {
  const id = String(boardId || '');
  for (const [domain, boards] of Object.entries(INSTRUMENT_DOMAINS)) {
    if (boards.includes(id)) return domain;
  }
  return cardIdFor(id) === 'CC-03' || cardIdFor(id) === 'CC-04' ? 'stock' : '';
}

function navigationTargetRequirement(boardId, envelope = {}) {
  if (String(boardId) === '15R0-2') {
    const cached = envelope.initial_surface_contract || envelope.initialSurfaceContract;
    return envelope.operation_ref === 'base:ka10054' && cached?.board_id === '15R0-2'
      ? '' : '현재 VI 발동 종목을 조회한 뒤 시장 체온·VI를 열어 주세요.';
  }
  if (String(boardId) === '15L8-2') {
    const cached = envelope.initial_surface_contract || envelope.initialSurfaceContract;
    return envelope.operation_ref === 'base:ka10172' && cached?.board_id === '15L8-2'
      ? '' : '조건검색식을 1회 조회한 뒤 관심·조건 신호를 열어 주세요.';
  }
  const required = INSTRUMENT_DETAIL_DOMAINS[String(boardId || '')];
  if (!required) return '';
  const source = envelope.surface_contract || envelope.surfaceContract || {};
  const sourceDomain = instrumentDomainFor(source.board_id)
    || (envelope.data && envelope.data.chart && envelope.data.chart.target) || '';
  const args = envelope.operation_args || envelope.arguments || {};
  const symbol = String(envelope.stk_cd || args.stk_cd || envelope.symbol || args.symbol || '').trim();
  if (sourceDomain === required
    && !(required === 'elw' && ELW_LIST_BOARDS.includes(source.board_id) && !symbol)) return '';
  const subject = { stock: '주식 종목', gold: '금현물 종목', sector: '업종', etf: 'ETF 종목', elw: 'ELW 종목' }[required];
  return `${subject}을 지정해 조회해 주세요.`;
}

function resolvedStateLink(boardId, candidate) {
  if (candidate.control === '차트' && candidate.board_id === '32S7-0') {
    return { ...candidate, board_id: boardId === '32S7-0' || boardId === '2RJ7-1' ? boardId : '137X-2' };
  }
  if (candidate.control === '순위' && candidate.board_id === '32XM-0') {
    return { ...candidate, control: '신주인수권 전체' };
  }
  return candidate;
}

function directStateLinksFor(boardId) {
  const id = String(boardId || '');
  return [...((STATE_GRAPH[id] && STATE_GRAPH[id].links) || []), ...additionalStateLinks(id)]
    .map(link => resolvedStateLink(id, link));
}

// 이 스크립트가 어디서 왔는지 — 청크도 같은 폴더에 있다. 문서 URL 기준 상대경로를
// 쓰면 fixture HTML(app/*.html)처럼 다른 위치에서 부를 때 깨진다.
const SELF_SRC = (typeof document !== 'undefined' && document.currentScript
  && document.currentScript.src) || '';

function chunkFileName(cardId) {
  return `board-templates.${cardId}.generated.js`;
}

function chunkUrl(cardId) {
  const file = chunkFileName(cardId);
  return SELF_SRC ? SELF_SRC.replace(/[^/]+$/, file) : `lib/${file}`;
}

// 청크는 자기 자신을 window.AthenaLib.BoardTemplateChunks에 등록한다 — 레지스트리가
// 먼저 로드됐든 나중이든 상관없게 하려는 것이다.
function chunkTable() {
  return (typeof window !== 'undefined' && window.AthenaLib
    && window.AthenaLib.BoardTemplateChunks) || {};
}

const chunks = new Map();   // cardId → BOARDS
const pending = new Map();  // cardId → Promise<BOARDS>

function adopt(cardId, chunk) {
  const boards = (chunk && chunk.BOARDS) || null;
  if (!boards) return null;
  chunks.set(cardId, boards);
  return boards;
}

// 이미 와 있는 청크만 붙인다(주입은 하지 않는다). CJS에서는 require가 동기라
// 여기서 바로 읽어 온다 — 단위 테스트는 그 경로로 색인 전체를 그냥 쓴다.
function residentChunk(cardId) {
  if (!cardId) return null;
  if (chunks.has(cardId)) return chunks.get(cardId);
  const global = chunkTable()[cardId];
  if (global) return adopt(cardId, global);
  if (!isCjs) return null;
  try {
    return adopt(cardId, require(`./${chunkFileName(cardId)}`));
  } catch {
    return null;
  }
}

function injectChunk(cardId) {
  const doc = typeof document !== 'undefined' ? document : null;
  if (!doc) return Promise.reject(new Error(`보드 청크를 실을 문서가 없다 — ${cardId}`));
  return new Promise((resolve, reject) => {
    const script = doc.createElement('script');
    script.src = chunkUrl(cardId);
    // 순서를 보장할 필요가 없다 — 청크끼리 의존하지 않는다.
    script.async = true;
    script.addEventListener('load', () => {
      const boards = adopt(cardId, chunkTable()[cardId]);
      if (boards) resolve(boards);
      else reject(new Error(`보드 청크가 자기를 등록하지 않았다 — ${cardId}`));
    });
    script.addEventListener('error', () => reject(new Error(`보드 청크를 못 읽었다 — ${chunkUrl(cardId)}`)));
    (doc.head || doc.documentElement).appendChild(script);
  });
}

// 카드 청크 1개를 상주시킨다. 같은 카드를 동시에 여러 번 불러도 주입은 1회다.
function loadChunk(cardId) {
  const resident = residentChunk(cardId);
  if (resident) return Promise.resolve(resident);
  if (!cardId) return Promise.reject(new Error('보드 청크 카드 id가 없다'));
  if (pending.has(cardId)) return pending.get(cardId);
  const task = injectChunk(cardId).catch((error) => {
    pending.delete(cardId);
    throw error;
  });
  pending.set(cardId, task);
  return task;
}

function boardIds() {
  return Object.keys(BOARD_CARD).sort();
}

function hasBoard(boardId) {
  return Object.prototype.hasOwnProperty.call(BOARD_CARD, String(boardId));
}

function cardIdFor(boardId) {
  return hasBoard(boardId) ? BOARD_CARD[String(boardId)] : null;
}

function cardIds() {
  return CARD_IDS.slice();
}

// 상주한 청크에서만 찾는다. 브라우저에서 아직 안 실린 카드면 null이고, 호출부는
// loadBoard가 돌려주는 Promise를 기다려야 한다.
function boardEntry(boardId) {
  const cardId = cardIdFor(boardId);
  if (!cardId) return null;
  const boards = residentChunk(cardId);
  return (boards && boards[String(boardId)]) || null;
}

// 보드 1장을 쓸 수 있게 만든다 — 필요한 청크만 주입하고 항목으로 해석한다.
function loadBoard(boardId) {
  const cardId = cardIdFor(boardId);
  if (!cardId) return Promise.reject(new Error(`색인에 없는 보드다 — ${boardId}`));
  const resident = boardEntry(boardId);
  if (resident) return Promise.resolve(resident);
  return loadChunk(cardId).then(() => {
    const entry = boardEntry(boardId);
    if (!entry) throw new Error(`청크에 보드가 없다 — ${boardId}`);
    return entry;
  });
}

function isLoaded(boardId) {
  return boardEntry(boardId) !== null;
}

function boardHtml(boardId) {
  const entry = boardEntry(boardId);
  return entry ? entry.html : null;
}

function boardSha256(boardId) {
  const entry = boardEntry(boardId);
  return entry ? entry.htmlSha256 : null;
}

// 파싱한 <template>은 보드마다 1회만 만든다(D1 "런타임 레이아웃 재조립 없음" —
// 매 마운트마다 innerHTML을 다시 파싱하면 보드 1장에 수백 노드를 반복 파싱한다).
const templateCache = new Map();

// 마운트 계약(정적) — 어느 노드에 어떤 슬롯이 앉고 어떻게 포맷하는지. 값은 여기
// 없다. 값은 봉투의 surface_contract.slot_values가 나른다(백엔드 계약 §3).
// `primary`는 전문 렌더러가 앉을 자리의 계약이다(`renderer`·`mount_slot`·`props_from`).
// 저작 안 된 보드는 청크에 키가 없다 — 그 보드에는 전문 렌더러 자리가 없다는 뜻이다.
function contractFor(boardId) {
  const entry = boardEntry(boardId);
  if (!entry) return null;
  return { board_id: String(boardId), slots: entry.slots || [], primary: entry.primary || null };
}

// 그 보드에 전문 렌더러가 앉을 자리가 저작돼 있는가 — 종류 하나만 돌려준다.
// 청크가 아니라 색인을 읽는다: 라우팅은 봉투를 어느 표면으로 보낼지 정할 때
// 답이 있어야 하고, 그 시점에 카드 청크(수 MB)는 아직 안 실려 있다.
function primaryRendererFor(boardId) {
  return BOARD_PRIMARY[String(boardId || '')] || '';
}

// 상태 보드 링크(어느 칩이 어느 보드를 여는가)의 정본은 이 색인이다. 봉투는 마운트한
// 그 보드의 직계 자식만 나르는데, 자식 보드의 탭 레일은 부모 레일의 복제본이라 부모의
// 링크가 없으면 갈아탄 뒤 레일이 통째로 죽는다. 제 자식 + 모든 조상 레일을 준다.
// 깊이 2인 펼침 화면도 루트의 탭으로 돌아갈 수 있어야 한다. 기존 탭 문구는
// board-mount가 연결하고, navigation 링크는 canvas가 공통 복귀 버튼으로 만든다.
function stateLinksFor(boardId) {
  const id = String(boardId || '');
  const entry = STATE_GRAPH[id] || (hasBoard(id) ? {} : null);
  if (!entry) return [];
  const links = [];
  const seen = new Set();
  const visited = new Set();
  let current = id;
  const candidates = cardIdFor(id) === 'CC-01' ? ACCOUNT_NAVIGATION.slice() : [];
  candidates.push(...additionalStateLinks(id));
  while (current && !visited.has(current)) {
    visited.add(current);
    const ancestor = STATE_GRAPH[current];
    if (!ancestor) break;
    candidates.push(...(ancestor.links || []));
    current = ancestor.parent;
  }
  if (entry.parent && visited.has(entry.parent)) {
    candidates.push({ control: '상위 화면으로', board_id: entry.parent, navigation: 'parent' });
    const rootId = [...visited].at(-1);
    if (rootId !== entry.parent && !STATE_GRAPH[rootId]?.parent) {
      candidates.push({ control: '기본 화면으로', board_id: rootId, navigation: 'root' });
    }
  }
  for (const candidate of candidates) {
    // The original specimen reused the stock "차트" tab for an industry chart.
    // Keep each instrument's chart in its own family when returning from tabs.
    const link = resolvedStateLink(id, candidate);
    const key = `${link.board_id} ${link.control}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ control: link.control, board_id: link.board_id, ...(link.navigation ? { navigation: link.navigation } : {}) });
  }
  return links;
}

// 이 표식이 화면에 내는 문구들. 추출기는 표식(`data-state-control`)을 그 링크를
// 소유한 보드에만 찍는데, 자식 보드의 레일은 그 복제본이라 표식이 없다 — 자식에서는
// 문구로 칩을 찾아야 하고, 문구가 표식 이름과 다르면(「관심종목 시세 보드」 → 「관심」)
// 이 표가 없으면 그 칩이 영영 안 눌린다. 판정(유일성·경합)은 board-mount가 한다.
function controlLabels(control) {
  const labels = CONTROL_LABELS[String(control || '')];
  return Array.isArray(labels) ? labels.slice() : [];
}

// 보드 1장당 <template> 1개. cloneNode는 호출부(board-mount)가 한다.
function templateFor(boardId, doc = typeof document !== 'undefined' ? document : null) {
  if (!doc) return null;
  const html = boardHtml(boardId);
  if (html === null) return null;
  const cached = templateCache.get(boardId);
  if (cached && cached.doc === doc) return cached.template;
  const template = doc.createElement('template');
  template.innerHTML = html;
  templateCache.set(boardId, { doc, template });
  return template;
}

function clearTemplateCache() {
  templateCache.clear();
}

const __exports = {
  BOARD_CARD, boardIds, cardIds, hasBoard, cardIdFor, isLoaded,
  ACCOUNT_NAVIGATION,
  instrumentDomainFor, navigationTargetRequirement, directStateLinksFor, additionalControlLabels,
  chunkFileName, chunkUrl, loadChunk, loadBoard,
  boardHtml, boardSha256, contractFor, primaryRendererFor, stateLinksFor, controlLabels,
  templateFor, clearTemplateCache,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.BoardTemplateRegistry = __exports;
}

})();
