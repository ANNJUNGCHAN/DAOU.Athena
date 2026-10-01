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
  // A missing period observation never removes its fixed table-column caption.
  if (slot.table?.row === 'head') return null;
  const text = String(slot.paper_text || '').trim();
  const reason = [slot.unbound_reason, slot.static_reason,
    typeof slot.static === 'string' ? slot.static : ''].filter(Boolean).join(' ');
  if (!text) return null;
  if (/^[▸▾▲▼→←…·]+$/.test(text)) return null;
  if (/상태|여부/.test(reason) && /필드.{0,16}없|미제공/.test(reason)) return 'status';
  if (/부모 보드.*되비침|관심 그룹.*응답.*(?:아니|없)|그룹 종목 수.*개별 필드가 아니다/.test(reason)) return 'unavailable';
  if (slot.region === 'rail' && /—\s*(?:선택|발동 중)/.test(text)) return 'unavailable';
  if (slot.region === 'rail' && /^(?:VI (?:미발동|발동)|단일가 진행)$/.test(text)) return 'status';
  // Specimen as-of dates remain unavailable even when authored as fixed prose.
  if (/기준일|기준 시각|갱신 시각/.test(reason)
    && /\d{1,2}(?:월|\/|-)\s*\d{1,2}/.test(text)) return 'time';
  // Specimen retrieval/current-range clocks are observations even when the
  // authoring metadata calls them fixed prose. Operating hours and axes remain.
  if (/\d{1,2}:\d{2}/.test(text)
    && !/시간대|거래 시간|개시|운영 시간|구간 (?:이름|라벨|표기)/.test(reason)) return 'time';
  // Fixed axes, selectors, units and section names are meaningful even without a feed.
  if (/고정 (?:문구|라벨)|컨트롤|버튼|단계 번호|라벨|이름|항목명|제목|정렬 기준|기준선|단위 설명|민감도 단위|선택 옵션/.test(reason)
    && !/시각|상태|집계|파생|목업|예시/.test(reason)) return null;
  if (/^(?:정규장|장중|실시간|정상 거래|연결됨|정상|감리 없음|투자유의 아님|유동성 정상)$/.test(text)
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
  '4A9H-1': ['s124'],
  '4AGN-1': ['s124'],
  '4ANS-1': ['s124'],
  '4AUX-1': ['s124'],
  '2SYW-1': ['s133'],
  '2ZN9-0': ['s165', 's187', 's188', 's189', 's190'],
  '3LGC-0': ['s026', 's027', 's034', 's043', 's051', 's060', 's077', 's085', 's094', 's102', 's109', 's112'],
  '2TZN-1': ['s213', 's215', 's217'],
  '3D4I-0': ['s011', 's012', 's013', 's014', 's114', 's117', 's120', 's123'],
  '3EWN-0': ['s011', 's012', 's013', 's014'],
};
// Observed native defects: captions described several specimen values while
// their source mapping supplies only the named field below. Do not infer extras.
const LABELS = {
  '2YXS-0': { s327: '조회 종목 등락률', s343: '추가 조회 종목 등락률' },
  '3LGC-0': { s026: '입출고 내역' },
  '137X-2': { s068: '일별 거래상세 · 순매수', s109: '장중', s122: '기간중 거래량' },
  '15L8-2': { s001: '조건검색 결과 종목', s003: '조건검색 결과', s005: '일회 검색 결과',
    s009: '등락률(계산)', s095: '첫 결과 · 누적거래량', s100: '', s106: '', s110: '', s111: '', s112: '' },
  "32XM-0": {"s002":"조회 응답 순서","s004":"최대 14종목 표시","s005":"","s014":"표시 기준","s015":"조회 응답 순서","s022":"첫 수신 종목 등락률","s032":"조회 순서 · 최대 14종목 표시","s033":"순서","s036":"시가","s038":"거래량","s041":"1","s054":"2","s067":"3","s080":"4","s093":"5","s106":"6","s119":"7","s132":"8","s145":"9","s158":"10","s171":"11","s184":"12","s197":"13","s210":"14"},
  '15J9-2': { s001: '업종별 종목 시세', s002: '조회한 업종의 종목 목록', s003: '업종 구성 종목',
    s005: '업종 지표', s009: '종목', s011: '거래량', s012: '고가 · 시가', s013: '매도 · 매수 호가',
    s048: '조회 순서 · 최대 3종목 표시', s050: '테마 데이터 미제공', s051: '', s068: '', s071: '', s074: '' },
  '13BC-2': { s007: '5단', s008: '10단' },
  '2TRW-1': { s007: '5단', s008: '10단' },
  '2QRP-1': { s007: '5단', s008: '10단' },
  "2YS8-0": {"s003":"요청한 시장 · 신용비율순","s012":"첫 결과 신용비율","s015":"첫 결과 거래량","s018":"조회 조건","s020":"조건별 조회","s022":"조회 응답","s131":"","s132":"","s184":"첫 결과 신용비율","s186":"조회 목록 · 최대 8개 표시","s192":"표시 비율 범위","s041":"1","s056":"2","s071":"3","s086":"4","s101":"5","s116":"6","s133":"7","s148":"8"},
  "2ZBB-0": {"s003":"요청 기간 · 대차잔고 상위","s012":"첫 결과 대차잔고","s015":"조회 잔고 합","s017":"응답 합계","s018":"조회 조건","s020":"조건별 조회","s022":"조회 응답","s125":"","s126":"","s155":"조회 순서 · 최대 8개 표시","s156":"","s159":"조회 응답 합계","s166":"조회 전체 잔고주수 비율","s170":"응답 순서 · 최대 6개 표시","s171":"조회 잔고","s184":"조회 목록 · 최대 8개 표시","s186":"표시 목록 잔고 합","s188":"미표시 목록 증감","s041":"1","s055":"2","s069":"3","s083":"4","s097":"5","s111":"6","s127":"7","s141":"8"},
  "3DI2-0": {"s017":"누적 거래대금","s029":"투자자별 조회","s031":"최근 조회일 · 기관","s035":"조회 응답 · 값별 단위 표기","s038":"","s040":"","s042":"","s044":"","s046":"","s047":"조회일","s151":"조회 응답 · 값별 단위 표기","s154":"","s156":"","s157":"조회 시각","s219":"일자별 · 장중 조회 결과","s220":"실제 조회값과 단위를 표시합니다."},
  "3FR6-0": {"s015":"당일 시가","s031":"분봉","s036":"분봉 · 최대 13개 표시","s149":"일자별 · 최대 3개 표시","s196":"요청한 분봉 주기","s208":"당일 고가"},
  "31II-0": {"s135":"첫 번째 결과 · VI 시각","s138":"체결처리 시각","s139":"","s140":"","s142":"VI 해제 시각","s149":"첫 결과 해제 시각"},
  "3BQB-0": {"s003":"요청한 시장의 업종 목록","s012":"요청 시장","s018":"업종 목록","s021":"응답 순서 · 최대 21개 표시","s022":"조회 업종","s023":"","s032":"","s047":"이어지는 업종","s048":"","s061":"이어지는 업종","s062":"","s071":"응답 순서 · 최대 21개 표시","s072":""},
  "2VDA-0": {s047: "거래량 · 전일비", s289: "조회 종목 고가", s291: "고가"},
  '2ZHC-0': { s048: '거래량', s337: '조회 종목' },
  '2ZZ7-0': { s047: '거래량', s253: '조회 종목 구간 등락률' },
  '2VIN-0': { s409: '조회 수익률', s410: '수익률', s412: '수익률', s414: '수익률', s416: '수익률' },
  '30C1-0': { s045: '이전 거래량', s047: '현재 거래량', s330: '조회 종목' },
  '30O1-0': { s022: '조회 종목 비중', s024: '조회 응답' },
  "13K0-2": {"s130":"조회 종목","s143":"다른 조회 결과"},
  "2XG6-0": {"s136":"첫 번째 결과","s139":"다른 조회 결과"},
  "2XKO-0": {"s141":"첫 번째 결과","s144":"다른 조회 결과"},
  "2XP6-0": {"s002":"예상체결 조회","s136":"첫 번째 결과","s139":"다른 조회 결과","s157":"미제공"},
  "2XTO-0": {"s142":"첫 번째 결과","s145":"다른 조회 결과"},
  "2XY6-0": {"s309":"첫 번째 결과"},
  "2YA8-0": {"s137":"첫 번째 결과","s140":"다른 조회 결과"},
  "2YEQ-0": {"s137":"첫 번째 결과","s140":"다른 조회 결과"},
  "2YJ8-0": {"s136":"첫 번째 결과","s139":"다른 조회 결과"},
  "2YNQ-0": {"s135":"첫 번째 결과","s138":"다른 조회 결과","s149":"정규장 종가"},
  '15P5-2': { s173: 'LP 지표' },
  "15N5-2": { s023: "추적오차", s067: "거래량 · 거래대금", s070: "NAV 지수 · 추적오차" },
  "31UD-0": {"s001":"종목 체결 내역","s002":"선택 종목 · 조회일 체결","s041":"당일·전일 체결 내역","s043":"번호","s045":"체결가 · 전일비","s047":"체결량","s048":"누적거래량"},
  "2WZK-0": {"s002":"선택 ETF · 조회 기간 수익률","s016":"ETF 수익률","s019":"체결 수익률","s022":"외국인 순매수","s025":"기관 순매수"},
  "30ZW-0": {"s002":"요청 조건의 PER 순위","s046":"PER","s049":"거래량"},
  "316O-0": {"s002":"요청 조건의 시가 대비 등락","s047":"거래량"},
  "2Z49-0": {"s001":"ELW 종목별 순매매","s002":"요청 거래원 · 종목별 조회","s039":"번호","s114":"종목별 순매매","s117":"등락률","s120":"거래량"},
  "3TOM-0": {"s001":"ELW 종목별 순매매","s002":"요청 거래원 · 종목별 조회","s039":"번호"},
  '3NVG-0': { s033: '원화', s034: 'KRW', s038: '해당 없음', s039: '외화',
    s048: 'D+1', s050: 'D+2', s052: 'D+3', s054: 'D+4' },
  '3K7K-0': { s029: '기간 미제공', s031: '기초', s032: '기말', s113: '기간 미제공' },
  '2TZN-1': { s145: '선택 업종', s147: '지수', s149: '거래대금', s151: '구성 종목', s153: '시가', s155: '52주 최저' },
  '2SKU-1': { s047: '오늘', s054: 'D+1', s061: 'D+2', s175: '기간 입금', s178: '기간 출금' },
  '3MTJ-0': { s026: '결제 예정', s035: '오늘', s043: 'D+1', s052: 'D+2', s036: '', s044: '', s053: '',
    s064: 'D+2 자산', s067: 'D+2 금액', s106: '오늘', s108: 'D+1', s110: 'D+2' },
};
const FORMATS = {
  '15N5-2': { s062: ['etfobjt_idex_cd', { kind: 'text', prefix: '대상지수 코드 ' }] },
  '2TZN-1': {
    s148: ['cur_prc', { kind: 'number', precision: 2, absolute: true }],
    s150: ['trde_prica', { kind: 'korean', scale: '백만', suffix: '원' }],
    s152: ['flo_stk_num', { kind: 'number', precision: 0, suffix: '개' }],
    s154: ['open_pric', { kind: 'number', precision: 2, absolute: true }],
    s156: ['52wk_lwst_pric', { kind: 'number', precision: 2, absolute: true }],
    s157: ['52wk_hgst_pric_dt', { kind: 'date', prefix: '52주 최고가일 ' }],
  },
};
const PRICE_FIELDS = new Set(['cur_prc', 'cur_prc_n', 'open_pric', 'high_pric', 'low_pric', 'base_pric',
  'upl_pric', 'lst_pric', 'oyr_hgst', 'oyr_lwst', '250hgst', '250lwst', 'exp_cntr_pric',
  '52wk_hgst_pric', '52wk_lwst_pric']);
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
      const sessionQuote = ['2QRP-1', '3JT4-0', '2QX1-1'].includes(entry.board_id)
        && /^(?:ovt_sigpric_(?:(?:sel|buy)_bid_[1-5]|cur_prc)|pri_(?:sel|buy)_bid_unit|cntr_pric)$/.test(slot.f || '');
      const price = (PRICE_FIELDS.has(slot.f) || /^(?:sel|buy)_(?:[1-9]|10)bid$/.test(slot.f || '') || sessionQuote) && hasBinding(slot);
      const direction = /^(?:pred_pre_sig(?:_n)?|pre_sig|pre_tp)$/.test(slot.f || '') && hasBinding(slot);
      const time = hasBinding(slot) && (TIME_FIELDS.test(slot.f || '') || slot.f === 'bid_req_base_tm'
        || (slot.f === '20' && /^base:0/.test(slot.mapping_id || '')));
      const identifier = hasBinding(slot) && (/^(?:code|symbol)$|(?:_cd|_code)$/.test(slot.f || '')
        || /코드/.test(slot.kor || '') || slot.format?.literal === true);
      const priceParts = entry.card_id === 'CC-03' && slot.composite?.parts
        ?.filter((part) => PRICE_FIELDS.has(part.f)).map((part) => part.f);
      const boundName = entry.card_id === 'CC-03' && slot.slot_id === 's001' && slot.f === 'stk_nm';
      const boundLabel = slot.kind === 'label' && hasBinding(slot);
      const displayRole = role || (price ? 'price' : direction ? 'direction' : time ? 'bound-time' : identifier ? 'bound-identifier'
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
