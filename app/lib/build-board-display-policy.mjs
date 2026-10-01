// Derive display safeguards from the tracked authoring contract, not from live values.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sourceRoot = path.join(root, 'backend/ref/card-surface-templates');
const index = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'index.json'), 'utf8'));

export function hasBinding(slot) {
  return Boolean((slot.mapping_id && slot.f) || slot.composite
    || (Array.isArray(slot.alt_mappings) && slot.alt_mappings.length));
}

export function staticDisplayRole(slot) {
  if (hasBinding(slot)) return null;
  const text = String(slot.paper_text || '').trim();
  const reason = [slot.unbound_reason, slot.static_reason,
    typeof slot.static === 'string' ? slot.static : ''].filter(Boolean).join(' ');
  if (!text) return null;
  if (/^[▸▾▲▼→←…·]+$/.test(text)) return null;
  // Specimen as-of dates remain unavailable even when authored as fixed prose.
  if (/기준일|기준 시각|갱신 시각/.test(reason)
    && /\d{1,2}(?:월|\/|-)\s*\d{1,2}/.test(text)) return 'time';
  // Fixed axes, selectors, units and section names are meaningful even without a feed.
  if (/고정 (?:문구|라벨)|컨트롤|버튼|단계 번호|라벨|이름|항목명|제목|정렬 기준|기준선|단위 설명|민감도 단위|선택 옵션/.test(reason)
    && !/시각|상태|집계|파생|목업|예시/.test(reason)) return null;
  if (/^(?:정규장|장중|실시간|정상 거래|연결됨)$/.test(text)
    || /(?:실시간|연결).*(?:갱신|반영|정상|수신|연결됨)/.test(text)) return 'status';
  if (/조회.*시각|기준 시각|마지막.*시각|실시간 연결|갱신 시각|체결 시각/.test(reason)
    || (/\d{1,2}:\d{2}/.test(text) && !/시간대|거래 시간|개시|운영 시간|구간 (?:이름|라벨|표기)/.test(reason))) return 'time';
  if (!slot.static) return null;
  if (/고정 (?:문구|라벨)|컨트롤|버튼|단계 번호|라벨|이름|항목명|제목|정렬 기준|기준선|단위 설명|민감도 단위|선택 옵션|요청 조건|표시 순번|행 번호|순위 번호/.test(reason)) return null;
  if (/필드.{0,16}(?:없|아니|미제공)|응답에 없다|대응.{0,12}없|파생|집계|계산값|목업|예시|미제공|비용 합계|영값 묶음/.test(reason)) return 'unavailable';
  if (/상태|여부|조건 충족/.test(reason) && !/라벨|제목|선택/.test(reason)) return 'status';
  return null;
}

// These unannotated authoring values are explicit fixture data, not labels.
const UNANNOTATED = {
  '2SYW-1': ['s133'],
  '2ZN9-0': ['s165'],
  '3LGC-0': ['s026', 's027', 's034', 's043', 's051', 's060', 's077', 's085', 's094', 's102', 's109', 's112'],
  '2TZN-1': ['s213', 's215', 's217'],
};
// Observed native defects: captions described several specimen values while
// their source mapping supplies only the named field below. Do not infer extras.
const LABELS = {
  "15N5-2": { s023: "추적오차", s070: "NAV 지수 · 추적오차" },
  "31UD-0": {"s001":"종목 체결 내역","s002":"선택 종목 · 조회일 체결","s041":"당일·전일 체결 내역","s043":"번호","s045":"체결가 · 전일비","s047":"체결량","s048":"누적거래량"},
  "2WZK-0": {"s002":"선택 ETF · 조회 기간 수익률","s016":"ETF 수익률","s019":"체결 수익률","s022":"외국인 순매수","s025":"기관 순매수"},
  "30ZW-0": {"s002":"요청 조건의 PER 순위","s046":"PER","s049":"거래량"},
  "316O-0": {"s002":"요청 조건의 시가 대비 등락","s047":"거래량"},
  "2Z49-0": {"s001":"ELW 종목별 순매매","s002":"요청 거래원 · 종목별 조회","s039":"번호","s114":"종목별 순매매","s117":"등락률","s120":"거래량"},
  "3TOM-0": {"s001":"ELW 종목별 순매매","s002":"요청 거래원 · 종목별 조회","s039":"번호"},
  '2TZN-1': { s145: '선택 업종', s147: '지수', s149: '거래대금', s151: '구성 종목', s153: '시가', s155: '52주 최저' },
  '2SKU-1': { s047: '오늘', s054: 'D+1', s061: 'D+2' },
  '3MTJ-0': { s035: '오늘', s043: 'D+1', s052: 'D+2', s036: '', s044: '', s053: '',
    s064: 'D+2 자산', s067: 'D+2 금액' },
};
const FORMATS = {
  '2TZN-1': {
    s148: ['cur_prc', { kind: 'number', precision: 2, absolute: true }],
    s150: ['trde_prica', { kind: 'korean' }],
    s152: ['flo_stk_num', { kind: 'number', precision: 0, suffix: '개' }],
    s154: ['open_pric', { kind: 'number', precision: 2, absolute: true }],
    s156: ['52wk_lwst_pric', { kind: 'number', precision: 2, absolute: true }],
    s157: ['52wk_hgst_pric_dt', { kind: 'date', prefix: '52주 최고가일 ' }],
  },
};
const PRICE_FIELDS = new Set(['cur_prc', 'open_pric', 'high_pric', 'low_pric', 'base_pric',
  'upl_pric', 'lst_pric', 'oyr_hgst', 'oyr_lwst', '250hgst', '250lwst']);
const TIME_FIELDS = /^(?:tm|cntr_tm|cntr_time|trde_tm|time|last_cntr_tm)$/;

export function buildPolicy() {
  const policies = {};
  for (const entry of index.boards) {
    // Order tickets are retained as reference designs and cannot be invoked in this app.
    if (entry.card_id === 'CC-02' || entry.board_id === '1JZW-0') continue;
    const source = JSON.parse(fs.readFileSync(path.join(sourceRoot, entry.board_id, 'slots.json'), 'utf8'));
    const slots = {};
    for (const slot of source.slots) {
      const caption = LABELS[entry.board_id]?.[slot.slot_id];
      if (caption !== undefined) { slots[slot.slot_id] = [slot.paper_text, 'caption', caption]; continue; }
      const format = FORMATS[entry.board_id]?.[slot.slot_id];
      if (format && slot.f === format[0] && hasBinding(slot)) {
        slots[slot.slot_id] = [slot.paper_text, 'bound-format', format[1]]; continue;
      }
      const role = staticDisplayRole(slot)
        || (UNANNOTATED[entry.board_id]?.includes(slot.slot_id) ? 'unavailable' : null);
      const price = entry.card_id === 'CC-03' && PRICE_FIELDS.has(slot.f) && hasBinding(slot);
      const time = hasBinding(slot) && TIME_FIELDS.test(slot.f || '');
      const priceParts = entry.card_id === 'CC-03' && slot.composite?.parts
        ?.filter((part) => PRICE_FIELDS.has(part.f)).map((part) => part.f);
      const boundName = entry.card_id === 'CC-03' && slot.slot_id === 's001' && slot.f === 'stk_nm';
      const boundLabel = slot.kind === 'label' && hasBinding(slot);
      const displayRole = role || (price ? 'price' : time ? 'bound-time'
        : priceParts?.length ? 'price-composite' : boundName ? 'bound-name' : boundLabel ? 'bound-label' : null);
      if (displayRole) slots[slot.slot_id] = [slot.paper_text, displayRole,
        displayRole === 'price-composite' ? priceParts : slot.f || null];
    }
    if (Object.keys(slots).length) policies[entry.board_id] = slots;
  }
  return policies;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const policy = buildPolicy();
  const target = path.join(root, 'app/lib/board-display-policy-data.js');
  fs.writeFileSync(target, '// Generated by app/lib/build-board-display-policy.mjs from public authoring contracts.\n'
    + '(function () {\n\'use strict\';\nconst policy = ' + JSON.stringify(policy, null, 2) + ';\n'
    + 'if (typeof module !== "undefined" && module.exports) module.exports = policy;\n'
    + 'else { window.AthenaLib = window.AthenaLib || {}; window.AthenaLib.BoardDisplayPolicyData = policy; }\n})();\n');
  console.log(JSON.stringify({ boards: Object.keys(policy).length, slots: Object.values(policy).reduce((n, slots) => n + Object.keys(slots).length, 0) }));
}
