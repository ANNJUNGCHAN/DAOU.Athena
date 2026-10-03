// IIFE 스코프 격리 — board-format.js와 같은 이유(렌더러 스크립트 스코프 공유).
(function () {
'use strict';

const isCjs = typeof module !== 'undefined' && !!module.exports;
const lib = (typeof window !== 'undefined' && window.AthenaLib) || {};
const boardFormat = isCjs ? require('./board-format') : lib.BoardFormat;
const registry = isCjs ? require('./board-template-registry') : lib.BoardTemplateRegistry;
const displayPolicy = isCjs ? require('./board-display-policy') : lib.BoardDisplayPolicy;
const staticGraphics = isCjs ? require('./board-static-graphics-data') : lib.BoardStaticGraphicsData;
const etfPeriod = isCjs ? require('./board-etf-period') : lib.BoardEtfPeriod;
const flowLayout = isCjs ? require('./board-flow-layout') : lib.BoardFlowLayout;
const rankingResult = isCjs ? require('./board-ranking-result') : lib.BoardRankingResult;
const popoverLayout = isCjs ? require('./board-popover-layout') : lib.BoardPopoverLayout;
const goldQuote = isCjs ? require('./board-gold-quote') : lib.BoardGoldQuote;

const ROLLUP_MARK = '▸';

function slotList(contract) {
  return Array.isArray(contract && contract.slots) ? contract.slots : [];
}

// 값 슬롯 판정은 포맷터와 같은 어휘를 써야 한다 — 추출기는 `format.unit`을,
// 손으로 쓴 계약은 `format.kind`를 싣는다. 여기서만 kind를 직접 읽으면 실추출
// 보드의 금액·수량 슬롯이 전부 text로 보여 H1 영값 묶음이 조용히 꺼진다.
function isValueSlot(slot) {
  const kind = boardFormat.kindOf(slot.format || {});
  return kind === 'number' || kind === 'korean' || kind === 'percent';
}

// 앵커 이름. 추출기(scripts/paper_board_extract.py)는 Paper 노드 id를 `node_id`로
// 싣는다. 픽스처처럼 의미 있는 이름을 쓰는 계약은 `node`를 쓴다.
function anchorOf(slot) {
  return slot.node_id || slot.node || slot.slot_id;
}

// 라벨은 데이터가 아니라 디자인 문구다 — 값이 안 실려도 `미제공`으로 지우지 않고
// Paper 원문을 그대로 둔다. 값 슬롯은 반대로 값이 없으면 결측어를 쓴다(신념 5).
//
// 예외가 하나 더 있다: 저작이 `static`으로 못박은 값 자리(생성기 `_static_mode`).
//   'text'  — 화면 문구 자체다(`D+1 예상`·단계 번호) → Paper 원문.
//   'blank' — 응답에 그 필드가 없다고 사유까지 적힌 자리다 → 빈 칸. Paper 원문은
//             목업 숫자라 그대로 두면 없는 값을 지어내고, 결측어를 찍으면 「이번
//             응답에 안 왔다」는 거짓말이 된다(그 화면에는 원래 그 값이 없다).
function staticTextOf(slot) {
  if (slot.static === 'text' || slot.static === true) {
    return typeof slot.paper_text === 'string' ? slot.paper_text : '';
  }
  if (slot.static === 'blank') return '';
  const mapped = (typeof slot.mapping_id === 'string' && slot.mapping_id
    && typeof slot.f === 'string' && slot.f) || slot.composite;
  return slot.kind === 'label' && !mapped && typeof slot.paper_text === 'string'
    ? slot.paper_text
    : null;
}

// 1JPU-0의 두 레일 문구는 Paper 목업에서 거래대금·가격 비교로 저작됐지만 실제
// ka10007 바인딩은 오늘/전일 거래량과 그 전일비다. 런타임 청크는 출처 메타데이터를
// 싣지 않으므로 보드·슬롯·원문·포맷 관계가 모두 같은 경우에만 문구를 바로잡는다.
function verifiedOrderbookRailLabel(contract, slot, fallback) {
  if (!contract || contract.board_id !== '1JPU-0' || !slot || slot.kind !== 'label') return fallback;
  if (slot.slot_id !== 's251' && slot.slot_id !== 's254') return fallback;
  const byId = new Map(slotList(contract).map((item) => [item.slot_id, item]));
  const hasFormat = (item, unit, sign, precision, tone) => item && item.kind === 'value'
    && item.format && item.format.unit === unit && item.format.sign === sign
    && item.format.precision === precision && item.format.tone === tone;
  if (slot.slot_id === 's251') {
    const today = byId.get('s252');
    const previous = byId.get('s253');
    if (slot.paper_text === '거래량·거래대금'
      && hasFormat(today, 'shares', false, 0, 'neutral')
      && hasFormat(previous, 'shares', false, 0, 'neutral')
      && previous.paired_with === 's252') {
      return '오늘·전일 거래량';
    }
  }
  if (slot.slot_id === 's254') {
    const ratio = byId.get('s255');
    if (slot.paper_text === '어제 대비'
      && hasFormat(ratio, 'percent', true, 0, 'change')) {
      return '전일 거래량 대비';
    }
  }
  return fallback;
}

function verifiedChartHeaderTone(contract, slot, bound) {
  if (!contract || contract.board_id !== '137X-2' || !slot || slot.slot_id !== 's006'
    || slot.node !== '14O7-2' || slot.kind !== 'value'
    || slot.paper_text !== '+1,850 · +1.24%'
    || !slot.format || slot.format.unit !== 'percent' || slot.format.sign !== true
    || slot.format.precision !== 0 || slot.format.tone !== 'change') return null;
  const slotParts = slot.composite && slot.composite.parts;
  const valueComposite = boardFormat.compositeSpecOf(bound);
  const valueParts = valueComposite && valueComposite.parts;
  if (!Array.isArray(slotParts) || !Array.isArray(valueParts)
    || slotParts.length !== 2 || valueParts.length !== 2) return null;
  const expected = [
    ['pred_pre', 'number', 0],
    ['flu_rt', 'percent', 2],
  ];
  for (let index = 0; index < expected.length; index += 1) {
    const [field, kind, precision] = expected[index];
    const authored = slotParts[index];
    const actual = valueParts[index];
    if (!authored || !actual || authored.mapping_id !== 'detail:ka10001:current_trading'
      || authored.f !== field || actual.mapping_id !== authored.mapping_id || actual.f !== field
      || !authored.format || authored.format.kind !== kind || authored.format.sign !== true
      || authored.format.precision !== precision || authored.format.tone !== 'change'
      || !actual.format || actual.format.kind !== kind || actual.format.sign !== true
      || actual.format.precision !== precision || actual.format.tone !== 'change'
      || boardFormat.toNumber(actual.value) === null) return null;
  }
  const tones = valueParts.map((part) => boardFormat.toneOf(part.value));
  return { tone: tones[0] === tones[1] ? tones[0] : 'flat', forceFlat: true };
}

// H1 영값 묶음(헌장 §3.1) — 그룹 안 0·결측 항목이 3개 이상일 때만 접는다.
// 값이 있는 항목은 접지 않는다("값이 생기면 그 항목만 자동으로 행으로 올라온다").
function collapsePlan(contract, values) {
  const groups = new Map();
  for (const slot of slotList(contract)) {
    const group = slot.collapse_group;
    if (!group || !group.group_id) continue;
    if (!groups.has(group.group_id)) {
      groups.set(group.group_id, {
        groupId: group.group_id,
        rollupSlot: group.rollup_slot || null,
        zeroLabel: group.zero_label || '0원',
        items: new Map(),
      });
    }
    const entry = groups.get(group.group_id);
    const itemId = group.item || slot.slot_id;
    if (!entry.items.has(itemId)) entry.items.set(itemId, { itemId, label: null, zero: false, checked: false });
    const item = entry.items.get(itemId);
    if (group.label) item.label = group.label;
    if (isValueSlot(slot)) {
      item.checked = true;
      item.zero = boardFormat.isZeroLike(slot.format, values ? values[slot.slot_id] : undefined);
    }
  }

  const plans = [];
  for (const entry of groups.values()) {
    const items = [...entry.items.values()];
    const zeroItems = items.filter((item) => item.checked && item.zero);
    const collapsed = zeroItems.length >= boardFormat.ZERO_COLLAPSE_MIN;
    const labels = zeroItems.map((item) => item.label).filter(Boolean);
    plans.push({
      groupId: entry.groupId,
      rollupSlot: entry.rollupSlot,
      collapsed,
      hiddenItems: collapsed ? zeroItems.map((item) => item.itemId) : [],
      rollupText: collapsed
        ? `${labels.join('·')} — ${entry.zeroLabel} ${zeroItems.length}항목 ${ROLLUP_MARK}`
        : null,
    });
  }
  return plans;
}

// 순수 계획 — DOM 없이 검증 가능한 층. 텍스트·색·접힘 결정을 전부 여기서 내린다.
// 결측어를 쓰지 않고 **빈 칸**으로 두는 잎. 두 갈래를 한 집합으로 모은다.
//
//   deferredValueSlots  값이 조회 응답 밖(실시간 프레임·주문 응답)에서 온다 —
//                       아직 오지 않은 값이다.
//   emptyValueSlots     응답이 그 자리를 빈 값으로 답했다 — 그 줄에는 해당 값이 없다.
//
// 둘 다 「제공되지 않는다」가 아니므로 결측어를 찍으면 거짓말이 된다.
function pendingSet(options) {
  const blanks = new Set();
  for (const key of ['deferredValueSlots', 'emptyValueSlots']) {
    const list = options && options[key];
    if (!Array.isArray(list)) continue;
    for (const slotId of list) blanks.add(String(slotId));
  }
  return blanks;
}

const FIXTURE_STOCK_NAME = '삼성전자';
const FIXTURE_STOCK_CODE = '005930';

function identityCardId(contract) {
  return contract && contract.board_id ? registry.cardIdFor(contract.board_id) : null;
}

function restampFixtureText(text, identity) {
  if (typeof text !== 'string' || !identity) return text;
  let out = text;
  const rename = identity.name && identity.name !== FIXTURE_STOCK_NAME;
  const recode = identity.code && identity.code !== FIXTURE_STOCK_CODE;
  if (rename && out.includes(FIXTURE_STOCK_NAME)) {
    out = out.split(FIXTURE_STOCK_NAME).join(identity.name);
  } else if (recode && out.includes(FIXTURE_STOCK_NAME)) {
    out = out.split(FIXTURE_STOCK_NAME).join('').replace(/^ · | · $/g, '').replace(/ {2,}/g, ' ').trim();
  }
  if (recode && out.includes(FIXTURE_STOCK_CODE)) {
    out = out.split(FIXTURE_STOCK_CODE).join(identity.code);
  }
  return out;
}

function shouldBlankFixtureMarketStat(slot, text, identity) {
  if (!identity || !identity.code || identity.code === FIXTURE_STOCK_CODE) return false;
  if (!slot || slot.kind === 'label' || slot.static === 'text' || slot.static === true) return false;
  const paper = slot.paper_text;
  if (typeof paper !== 'string' || !/\d/.test(paper)) return false;
  const shown = String(text || '');
  return shown === paper || shown.includes(paper);
}

function mountPlan(contract, values, options = {}) {
  ({ contract, values } = displayPolicy.prepareDisplayInput(contract, values));
  const pending = pendingSet(options);
  const deferred = new Set(options.deferredValueSlots || []);
  const answeredEmpty = new Set(options.emptyValueSlots || []);
  if(contract.board_id==='32S7-0') {
    const selected=options.identity||{name:'업종 이름 미제공',code:''};
    contract={...contract,slots:contract.slots.map(s=>['s001','s002'].includes(s.slot_id)?{...s,kind:'value',static:null,format:{kind:'text'}}:s)};
    values={...values,s001:selected.name||'업종 이름 미제공',s002:selected.code||null};
  }
  const identity = options.identity;
  const orderbook = identityCardId(contract) === 'CC-04';
  const identitySlots = new Set();
  const flowIdentityTitle = ['2ROJ-1', '2RWK-1', '2S4E-1'].includes(contract.board_id);
  if (identity && (identity.name || identity.code)
    && (orderbook || flowIdentityTitle || slotList(contract).some((slot) => slot.slot_id === 's001' && slot.kind === 'value'))) {
    values = { ...values };
    const byId = new Map(slotList(contract).map((slot) => [slot.slot_id, slot]));
    const nameSlot = byId.get('s001');
    // 호가의 s002는 상태 또는 종목명이다. 금현물 s003도 종목코드가 아니다.
    const codeSlot = byId.get(orderbook
      ? (['13BC-2', '2TRW-1', '3JZ3-0', '2QRP-1', '3JT4-0'].includes(contract.board_id) ? 's003' : null)
      : (['2QFO-2', '2QM7-2', '2ROJ-1', '2RWK-1', '2S4E-1'].includes(contract.board_id) ? 's003' : 's002'));
    // static blank: ETF 탭처럼 응답에 종목코드가 없어 빈 칸인 헤더 — 카드 주제로 채운다.
    // static true/text: 금현물처럼 고정 표기 — 주식 identity로 덮지 않는다.
    const stampIdentity = (slot) => slot && slot.kind === 'value'
      && (!slot.static || slot.static === 'blank');
    if (identity.name && (stampIdentity(nameSlot) || (flowIdentityTitle && nameSlot?.slot_id === 's001'))) {
      values.s001 = identity.name;
      identitySlots.add('s001');
    }
    if (identity.code && stampIdentity(codeSlot)) {
      values[codeSlot.slot_id] = ['13BC-2', '32S7-0', '15N5-2', '2QFO-2', '2QM7-2', '2ROJ-1', '2RWK-1', '2S4E-1'].includes(contract.board_id)
        ? { value: identity.code, text: identity.code } : identity.code;
      identitySlots.add(codeSlot.slot_id);
    }
  }
  const slots = slotList(contract);
  const collapse = collapsePlan(contract, values);
  const rollupText = new Map();
  for (const group of collapse) {
    if (group.rollupSlot && group.rollupText) rollupText.set(group.rollupSlot, group.rollupText);
  }

  const assignments = [];
  const missing = [];
  for (const slot of slots) {
    const node = anchorOf(slot);
    const override = rollupText.get(slot.slot_id);
    const bound = values ? values[slot.slot_id] : undefined;
    // static 자리는 응답이 채우는 자리가 아니다 — 값이 실려 와도 디자인 문구가 이긴다.
    const missingBound = bound === undefined || bound === null;
    // 카드 자신의 종목 이름·코드는 응답이 채우는 자리가 아니라 **카드의 주제**다.
    // 「응답에 그 값이 없다」는 빈 칸(`static: "blank"`)보다 이쪽이 앞선다 — 실측
    // 15N5-2 `s002`를 빈 칸으로 덮으면 탭을 옮길 때 종목 코드가 사라졌다.
    const flowSourceDate = ((contract.board_id === '137X-2' && ['s076', 's091'].includes(slot.slot_id))
      || (contract.board_id === '2RBO-1' && slot.slot_id === 's103')) && slot.format?.kind === 'date';
    const authoredText = (missingBound || (slot.static && !identitySlots.has(slot.slot_id)))
      ? (missingBound && pending.has(String(slot.slot_id)) && !flowSourceDate ? '' : staticTextOf(slot))
      : null;
    const staticText = verifiedOrderbookRailLabel(contract, slot, authoredText);
    let formatted = override
      ? { text: override, tone: null, missing: false }
      : (staticText !== null
        ? { text: staticText, tone: null, missing: false }
        : boardFormat.formatSlot(
          slot.format
            ? { ...slot.format, f: slot.f, kor: slot.kor }
            : { f: slot.f, kor: slot.kor },
          bound,
        ));
    if (identity && identityCardId(contract) === 'CC-04') {
      formatted = { ...formatted, text: restampFixtureText(formatted.text, identity) };
      if (missingBound && shouldBlankFixtureMarketStat(slot, formatted.text, identity)) {
        formatted = { text: '미제공', tone: null, missing: true };
      }
    }
    const verifiedTone = verifiedChartHeaderTone(contract, slot, bound);
    if (verifiedTone) formatted = { ...formatted, tone: verifiedTone.tone };
    const brokerQuantity = contract.board_id === '2QM7-2' && !formatted.missing
      && ['s042','s054','s066','s077','s088','s043','s055','s067','s078','s089'].includes(slot.slot_id);
    if (brokerQuantity) formatted = { ...formatted, tone: 'flat' };
    const observedZero = staticText === null && !formatted.missing && isValueSlot(slot)
      && boardFormat.toNumber(bound && typeof bound === 'object' ? bound.value : bound) === 0;
    if (observedZero) formatted = { ...formatted, tone: 'flat' };
    assignments.push({
      slotId: slot.slot_id,
      node,
      text: formatted.text,
      tone: formatted.tone,
      forceFlatTone: Boolean(verifiedTone && verifiedTone.forceFlat)
        || observedZero || brokerQuantity || (!formatted.missing && bound && typeof bound === 'object' && bound.tone === 'flat'),
      missing: formatted.missing,
      // 값이 아니라 디자인이 정한 글자(Paper 라벨·static 문면·빈 칸).
      designText: !override && staticText !== null,
      valueAtomic: slot.static !== true && slot.kind !== 'label'
        && slot.kind !== 'static' && isValueSlot(slot),
      valueSlot: slot.kind === 'value' && !slot.static,
      pending: missingBound && deferred.has(String(slot.slot_id)) && !answeredEmpty.has(String(slot.slot_id))
        && slot.kind === 'value' && !slot.static,
      empty: missingBound && answeredEmpty.has(String(slot.slot_id)) && slot.kind === 'value' && !slot.static,
      pairedWith: slot.paired_with || null,
      expandedBoard: slot.expanded_board || null,
    });
    if (formatted.missing) missing.push(slot.slot_id);
  }
  return { assignments, collapse, missing };
}

// 병기(D4) — 주값과 보조값은 같은 프레임에서 함께 갱신된다. 계획 단계에서 이미
// 두 슬롯 모두 assignment를 가지므로 여기서는 짝만 돌려준다(호출부 검증용).
function pairedGroups(plan) {
  const byPrimary = new Map();
  for (const assignment of plan.assignments) {
    if (!assignment.pairedWith) continue;
    if (!byPrimary.has(assignment.pairedWith)) byPrimary.set(assignment.pairedWith, []);
    byPrimary.get(assignment.pairedWith).push(assignment.slotId);
  }
  return byPrimary;
}

function isLeafAnchor(el) {
  if (!el) return false;
  return el.dataset ? el.dataset.leaf !== undefined : el.getAttribute('data-leaf') !== null;
}

// 병기 사본(`.bs-paired`)은 접힌 열이 내려앉을 자리라 원본과 같은 Paper 노드 id를
// 이고 있고, 문서 순서상 원본보다 먼저 나올 수 있다(1JPU-0/`1JT3-0` 실측 — 머리
// 사본이 표 머리 원본보다 위에 있다). 사본에 값을 쓰면 원본은 board.html 원문 그대로
// 남아 Paper 문면과 어긋난다.
function isPairedCopy(el) {
  const className = el.className
    || (typeof el.getAttribute === 'function' ? el.getAttribute('class') : '') || '';
  return String(className).split(/\s+/).includes('bs-paired');
}

// 앵커 우선순위 — 원본이 사본을 이기고, 같은 자리면 잎이 컨테이너를 이긴다.
function anchorRank(el) {
  return (isPairedCopy(el) ? 0 : 2) + (isLeafAnchor(el) ? 1 : 0);
}

function nodeIndex(root) {
  const index = new Map();
  for (const el of root.querySelectorAll('[data-node]')) {
    const key = el.dataset ? el.dataset.node : el.getAttribute('data-node');
    if (!key) continue;
    // 추출기는 값 자리를 `<span data-node data-leaf>`로 감싸면서 바깥 원문 노드의
    // data-node를 그대로 둔다(영역·병기 묶음이 그 id를 쓴다). 같은 id가 둘이면
    // 문서 순서상 바깥이 먼저 잡히는데, 거기에 값을 쓰면 병기 줄까지 지워지므로
    // 마운트는 건너뛴다 — 값이 영영 안 나온다.
    const current = index.get(key);
    if (!current || anchorRank(el) > anchorRank(current)) index.set(key, el);
  }
  return index;
}

// 인라인 display 원문을 지우지 않고 되돌릴 수 있게 보관한다(Paper 원문 보존).
function setHidden(el, hidden) {
  if (!el) return;
  if (el.__bsDisplay === undefined) el.__bsDisplay = el.style.display;
  el.style.display = hidden ? 'none' : el.__bsDisplay;
  el.hidden = hidden;
}

function setTone(el, tone, forceFlat = false) {
  const color = forceFlat && tone === 'flat'
    ? 'var(--color-k-text)'
    : boardFormat.toneColorVar(tone);
  const hasOriginal = Object.prototype.hasOwnProperty.call(el, '__bsColor');
  if (!color && !hasOriginal) return;
  if (!hasOriginal) el.__bsColor = el.style.color || '';
  if (color || el.__bsColor) el.style.color = color || el.__bsColor;
  else if (typeof el.style.removeProperty === 'function') el.style.removeProperty('color');
  else delete el.style.color;
}

function pairedMirrorIndex(root) {
  const index = new Map();
  const add = (key, mirror) => {
    if (!key) return;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(mirror);
  };
  for (const mirror of root.querySelectorAll('[data-paired-source]')) {
    add(mirror.dataset
      ? mirror.dataset.pairedSource : mirror.getAttribute('data-paired-source'), mirror);
  }
  // 구형 사본 — paired-table이 아닌 표에서는 추출기가 접힌 열의 사본을
  // `<span class="bs-paired" data-paired-col data-node="<원본 id>">`로 만든다
  // (data-paired-source가 없다). 앵커는 원본 쪽이라 값 쓰기가 사본까지 가지 않는데,
  // 좁은 단계(S/XS)에서 원본 열은 접히고 화면에 서는 쪽은 이 사본이다 — 함께 칠하지
  // 않으면 실데이터가 실린 뒤에도 추출 당시 Paper 목업 숫자가 그대로 남는다.
  for (const mirror of root.querySelectorAll('.bs-paired')) {
    if (mirror.dataset && mirror.dataset.pairedSource !== undefined) continue;
    add(mirror.dataset ? mirror.dataset.node : mirror.getAttribute('data-node'), mirror);
  }
  return index;
}

function syncPairedMirrors(source, mirrors) {
  for (const mirror of mirrors || []) {
    // 원본이 없어 사본이 앵커로 뽑힌 자리는 이미 값이 실렸다.
    if (mirror === source) continue;
    mirror.textContent = source.textContent;
    const color = source.style.color;
    if (color) mirror.style.color = color;
    else if (typeof mirror.style.removeProperty === 'function') mirror.style.removeProperty('color');
    else delete mirror.style.color;
    if (!mirror.dataset || !source.dataset) continue;
    if (source.dataset.missing !== undefined) mirror.dataset.missing = source.dataset.missing;
    else delete mirror.dataset.missing;
  }
}

// 자식 목록을 브라우저 DOM(HTMLCollection)과 테스트 스텁(배열) 양쪽에서 같은 모양으로
// 읽는다. 스텁은 텍스트도 children에 담으므로 여기서 걸러낸다.
function elementChildren(el) {
  if (Array.isArray(el.children)) return el.children.filter((child) => child && child.tag !== '#text');
  if (el.children && typeof el.children.length === 'number') return Array.from(el.children);
  return null;
}

function isLineBreak(child) {
  const tag = child && (child.tagName || child.tag);
  return typeof tag === 'string' && tag.toLowerCase() === 'br';
}

// 요소 자식 수. 추출기는 Paper 노드 id를 모든 노드에 남기므로 앵커가 컨테이너일 수
// 있다 — textContent를 쓰면 자식(병기 span 포함)을 통째로 날린다. 그래서 잎에만 쓴다.
// <br>만 예외로 세지 않는다. 글자를 나르지 않는 줄바꿈이고, 같은 자리를 paper_text가
// "\n"으로 싣는다(부모가 white-space: pre-wrap — 실측 네 곳, 1JPU-0/1JT0-0·1JT3-0·
// 1JZW-0/3PQA-0·3PQ7-0). 추출기는 병기 사본이 붙은 잎만 <span data-leaf>로 감싸므로
// 사본이 없는 두 줄 머리글은 잎 표시 없이 <br>를 직계로 이고 있다 — 자식으로 세면
// 그 슬롯이 마운트에서 빠지고 머리글이 Paper 문면과 어긋난 두 조각으로 남는다.
function elementChildCount(el) {
  if (!el) return 0;
  const children = elementChildren(el);
  if (!children) return typeof el.childElementCount === 'number' ? el.childElementCount : 0;
  return children.filter((child) => !isLineBreak(child)).length;
}

function hasTextContent(el) {
  return typeof el.textContent === 'string' && el.textContent.trim() !== '';
}

// ---------- 빈 줄 접기 (자료가 한 칸도 없는 되풀이 줄) ----------
//
// 응답이 20줄짜리 목록에 3줄만 실어 오면 나머지 17줄은 자료가 없는 줄이다. 칸마다
// 결측어를 찍으면 보드가 결측어 벽이 된다. 백엔드가 그 줄 목록을 계약에 실어 주고
// (`surface_contract.empty_rows`), 여기서 **그 줄만 담은 가장 작은 상자**를 찾아
// 감춘다. 값이 실린 잎을 품는 상자는 감추지 않는다 — 자료를 지우는 접기는 없다.

function slotElementIndex(root) {
  const index = new Map();
  for (const el of root.querySelectorAll('[data-slot-id]')) {
    const slotId = el.dataset ? el.dataset.slotId : el.getAttribute('data-slot-id');
    if (slotId) index.set(slotId, el);
  }
  return index;
}

function commonAncestor(elements) {
  let ancestor = elements[0];
  for (const el of elements.slice(1)) {
    while (ancestor && !ancestor.contains(el)) ancestor = ancestor.parentElement;
    if (!ancestor) return null;
  }
  return ancestor;
}

// 이 상자가 값 있는 잎을 품고 있는가. 품고 있으면 접을 수 없다.
function holdsValue(box, valued) {
  for (const el of valued) if (box.contains(el)) return true;
  return false;
}

// 빈 열도 헤더와 자리를 유지한다. 셀을 숨기면 뒤 값이 다른 헤더 아래로 이동한다.
// 이전 empty_columns 적용 흔적은 복원하고, 전체 빈 행 제거는 collapseEmptyRows가 맡는다.
function collapseEmptyColumns(surface) {
  if (typeof surface.querySelectorAll !== 'function') return [];
  for (const el of surface.querySelectorAll('[data-bs-column-collapsed="true"], [data-bs-table-collapsed="true"]')) {
    setHidden(el, false);
    delete el.dataset.bsColumnCollapsed;
    delete el.dataset.bsTableCollapsed;
  }
  if (surface.dataset) surface.dataset.bsColumnsCollapsed = '0';
  return [];
}

function tableCellOf(el) {
  if (!el || typeof el.closest !== 'function') return null;
  const cell = el.closest('[data-col], [role="cell"], [role="columnheader"]');
  return cell && cell.closest('[data-row], [role="row"]') ? cell : null;
}

function collapseEmptyRows(surface, emptyRows, options = {}) {
  const rows = Array.isArray(emptyRows) ? emptyRows : [];
  if (typeof surface.querySelectorAll !== 'function') return [];
  // 다음 조회에 행이 채워질 수 있다. 이 함수가 접었던 행만 먼저 복원한다.
  for (const row of surface.querySelectorAll('[data-bs-row-collapsed="true"]')) {
    setHidden(row, false);
    delete row.dataset.bsRowCollapsed;
  }
  const bySlot = slotElementIndex(surface);
  const valued = [];
  for (const el of bySlot.values()) {
    const data = el.dataset || {};
    const missing = el.dataset ? data.missing : el.getAttribute('data-missing');
    const design = el.dataset ? data.bsDesignText : el.getAttribute('data-bs-design-text');
    // 디자인 문구는 자료가 아니다 — 그것만 남은 줄은 여전히 빈 줄이다(실측:
    // 표 첫 칸의 순번·구분 라벨이 접기를 막아 결측어 벽이 그대로 남았다).
    if (missing === undefined || missing === null) {
      if (design === undefined || design === null) valued.push(el);
    }
  }
  const hidden = [];
  const skipped = [];
  for (const row of rows) {
    const slotIds = Array.isArray(row && row.slot_ids) ? row.slot_ids : [];
    const elements = slotIds.map((slotId) => bySlot.get(slotId)).filter(Boolean);
    if (!elements.length) {
      skipped.push({ row: row.row, why: 'no_anchor' });
      continue;
    }
    const box = commonAncestor(elements);
    // 값 있는 잎을 품는 상자는 접지 않는다 — 자료를 지우는 접기는 없다. 표면
    // 자체가 그 상자면 접을 것이 없다(줄이 아니라 보드 전체다).
    if (!box) {
      skipped.push({ row: row.row, why: 'no_common_box' });
      continue;
    }
    if (box === surface) {
      skipped.push({ row: row.row, why: 'box_is_surface' });
      continue;
    }
    if (typeof box.closest === 'function' && box.closest('[data-bs-keep-empty-rows="true"]')) continue;
    if (holdsValue(box, valued)) {
      skipped.push({ row: row.row, why: 'box_holds_value' });
      continue;
    }
    setHidden(box, true);
    if (box.dataset) box.dataset.bsRowCollapsed = 'true';
    hidden.push({ row: row.row, node: (box.dataset && box.dataset.node) || '', slots: slotIds.length });
  }
  // empty_rows 메타가 없어도 실제 값 슬롯이 전부 미제공인 행은 비어 있다.
  // 대기 중인 빈 문자열/집계 전, 식별값 또는 실제 0이 하나라도 있으면 유지한다.
  for (const row of surface.querySelectorAll('[data-row]')) {
    if (row.dataset.row === 'head' || row.dataset.bsRowCollapsed === 'true'
      || typeof row.querySelectorAll !== 'function') continue;
    if (row.closest('[data-bs-keep-empty-rows="true"]')) continue;
    const values = [...row.querySelectorAll('[data-bs-value-slot="true"]')]
      .filter((el) => el.closest('[data-row]') === row);
    if (!values.length || values.some((el) => el.dataset.missing !== 'true'
      || !el.textContent.trim() || el.textContent.trim() === boardFormat.missingText('pending'))) continue;
    setHidden(row, true);
    row.dataset.bsRowCollapsed = 'true';
    hidden.push({ row: row.dataset.row, node: row.dataset.node || '', slots: values.length, source: 'all_values_missing' });
  }
  // 왜 못 접었는지는 리포트가 읽는다(프로브의 collapse 진단).
  if (surface.dataset) {
    surface.dataset.bsRowsCollapsed = String(hidden.length);
    surface.dataset.bsRowsSkipped = JSON.stringify(skipped.slice(0, 8));
  }
  if (typeof options.onCollapse === 'function') options.onCollapse(hidden);
  return hidden;
}

function hideEmptyValueUnits(surface, plan) {
  const emptyIds = new Set(
    (plan.assignments || [])
      .filter((assignment) => assignment.designText && assignment.text === '')
      .map((assignment) => assignment.slotId),
  );
  if (!emptyIds.size || typeof surface.querySelectorAll !== 'function') return;
  const bySlot = slotElementIndex(surface);
  for (const slotId of emptyIds) {
    const el = bySlot.get(slotId);
    if (!el) continue;
    if (tableCellOf(el)) continue;
    let box = el.parentElement;
    while (box && box !== surface && box.children && box.children.length < 2) {
      box = box.parentElement;
    }
    if (!box || box === surface || containsBoardChrome(box)) continue;
    const slots = [...box.querySelectorAll('[data-slot-id]')];
    const live = slots.some((node) => {
      const id = node.dataset ? node.dataset.slotId : '';
      if (node.dataset?.bsKeepMissing === 'true') return true;
      if (!id || emptyIds.has(id)) return false;
      if (node.dataset && node.dataset.missing) return false;
      if (node.dataset && node.dataset.bsDesignText) return false;
      return String(node.textContent || '').trim() !== '';
    });
    if (!live) {
      setHidden(box, true);
      surface.__bsEmptyValueHidden.add(box);
    }
  }
}

function isUnavailableSlotEl(el) {
  if (!el) return false;
  const marked = el.dataset
    ? el.dataset.missing !== undefined
    : (typeof el.getAttribute === 'function' && el.getAttribute('data-missing') !== null);
  return marked && String(el.textContent || '').trim() === boardFormat.missingText();
}

function unitBoxForUnavailable(el, surface) {
  let box = el.parentElement;
  while (box && box !== surface && box.children && box.children.length < 2) {
    box = box.parentElement;
  }
  if (!box || box === surface || containsBoardChrome(box)) return null;
  return box;
}

function containsBoardChrome(box) {
  const selector = '.bs-header, .bs-strip, [data-state-control], [data-state-board]';
  return (typeof box.closest === 'function' && !!box.closest(selector))
    || (typeof box.querySelector === 'function' && !!box.querySelector(selector));
}

function setStatusAppearance(el, receiving) {
  if (!el || !el.style) return;
  el.style.color = receiving ? 'var(--color-ok)' : 'var(--color-k-dim)';
  const chip = el.parentElement;
  const dots = chip && typeof chip.querySelectorAll === 'function'
    ? chip.querySelectorAll('[data-node="34NM-0"], [data-node="34NW-0"], [data-node="2QFW-2"], [data-node="2QKN-2"], [data-node="2RUQ-1"], [data-node="2ROP-1"], [data-node="2QNK-2"], [data-node="153F-2"], [data-node="15BT-2"], [data-node="2TZL-1"], [data-node="2TS6-1"], [data-node="3K7I-0"], [data-node="3LV0-0"], [data-node="1JQ8-0"], [data-node="3NH2-0"], [data-node="2QX8-1"], [data-node="2QYE-1"], [data-node="2S2R-1"]') : [];
  if (chip && (chip.children.length === 1 || dots.length) && chip.style.backgroundColor
    && typeof chip.closest === 'function' && chip.closest('.bs-header')) {
    chip.style.backgroundColor = receiving ? '#5FCE3F1F' : 'var(--color-k-panel3)';
  }
  for (const dot of dots) {
    dot.style.backgroundColor = receiving ? 'var(--color-ok)' : 'var(--color-k-dim)';
  }
}

function unitHasLiveSlot(box) {
  const slots = typeof box.querySelectorAll === 'function'
    ? [...box.querySelectorAll('[data-slot-id]')]
    : [];
  return slots.some((node) => {
    if (node.dataset && node.dataset.bsDesignText) return false;
    if (isUnavailableSlotEl(node)) return false;
    return String(node.textContent || '').trim() !== '';
  });
}

// 표 안의 미제공은 자리를 유지한다. 그 밖의 칸은 감추고, 그 상자에 실값이
// 하나도 없으면 라벨이 빈 채로 남는 행도 함께 접는다. `집계 전`·`해당 없음`은
// 다른 결측 사유라서 그대로 둔다. 값이 오면 같은 자리의 display를 되돌린다.
function hideUnavailableUnits(surface) {
  if (!surface || typeof surface.querySelectorAll !== 'function') return;
  const next = [];
  const seen = new Set();
  const add = (el) => {
    if (!el || seen.has(el)) return;
    seen.add(el);
    next.push(el);
  };
  for (const el of surface.querySelectorAll('[data-slot-id]')) {
    if (!isUnavailableSlotEl(el)) continue;
    if (el.closest?.('.bs-quote-labelled-value, .bs-orderbook-managed, .bs-ranking-managed, .bs-current-quote-managed')) continue;
    if (tableCellOf(el)) continue;
    add(el);
    const box = unitBoxForUnavailable(el, surface);
    const tradeDayControls = surface.dataset?.bsBoardId === '2R3M-1' && box?.dataset.node === '3CRZ-0';
    if (box && !tradeDayControls && !unitHasLiveSlot(box)) add(box);
  }
  const prev = Array.isArray(surface.__bsUnavailableHidden) ? surface.__bsUnavailableHidden : [];
  for (const el of prev) {
    if (seen.has(el) || surface.__bsEmptyValueHidden?.has(el) || el.dataset?.bsRowCollapsed === 'true') continue;
    setHidden(el, false);
    if (el.dataset) delete el.dataset.bsUnavailableHidden;
  }
  for (const el of next) {
    setHidden(el, true);
    if (el.dataset) el.dataset.bsUnavailableHidden = 'true';
  }
  surface.__bsUnavailableHidden = next;
}

// 수급·예상체결의 빈 응답도 항목명과 상태를 함께 남긴다.
function sectorChangeCaption(occurrence) {
 const source = String(occurrence || '');
 if (/^base:ka20004\|\$\.inds_tic_chart_qry\[\]\.pred_pre\|[1-9]\d*$/.test(source)) return '틱 응답 전일대비 · 단위 확인 필요';
 if (/^base:ka20005\|\$\.inds_min_pole_qry\[\]\.pred_pre\|[1-9]\d*$/.test(source)) return '분봉 응답 전일대비 · 단위 확인 필요';
 return '전일대비 · 원천·단위 확인 필요';
}
// 업종의 실제 수신 상태에 맞춰 상세 영역과 원천 문구를 갱신한다.
function updateSectorDetails(root, plan, options = {}) {
 const id=root.dataset?.bsBoardId;if(!['2TZN-1','3BQB-0','32S7-0'].includes(id))return;
 const states=root.__bsSectorStates||(root.__bsSectorStates=new Map());for(const item of plan.assignments)states.set(item.slotId,item);
 if(!options.partial)root.__bsSectorOptions=options;else options={...root.__bsSectorOptions,...options};
 const node=n=>root.querySelector('[data-node="'+n+'"]');
 const leaf=s=>[...root.querySelectorAll('[data-slot-id="'+s+'"]')].find(x=>!x.children.length);
 const received=s=>{const item=states.get(s);return !!item&&item.valueSlot&&!item.missing&&!item.empty&&!item.pending;};
 const hide=(el,yes)=>el?.classList.toggle('bs-sector-hidden',yes);
 const text=(sid,str)=>{const el=leaf(sid);if(el)el.textContent=str;};
 const note=(owner,label,empty)=>{if(!owner)return;
  for(let box=owner;box&&box!==root;box=box.parentElement){if(box.dataset.bsRowCollapsed==='true'||box.dataset.bsUnavailableHidden==='true'||root.__bsEmptyValueHidden?.has(box)){setHidden(box,false);delete box.dataset.bsRowCollapsed;delete box.dataset.bsUnavailableHidden;root.__bsEmptyValueHidden?.delete(box);}if(box.matches('.bs-primary,.bs-rail'))break;}let n=owner.querySelector(':scope > .bs-sector-note');if(!n){n=document.createElement('div');n.className='bs-sector-note';n.setAttribute('role','status');owner.append(n)}n.textContent=label;hide(n,!empty);owner.classList.toggle('bs-sector-compact',empty);};
 const compact=(nid,slots,label)=>{const owner=node(nid);if(!owner)return;const empty=!slots.some(received);for(const child of owner.children)if(!child.classList.contains('bs-sector-note'))hide(child,empty);note(owner,label,empty);return empty;};
 const label=(sid,caption)=>{const el=leaf(sid);if(!el)return;if(received(sid)&&!el.textContent.startsWith(caption+' '))el.textContent=caption+' '+el.textContent;el.classList.add('bs-sector-labelled');};
 const slots=(a,b)=>Array.from({length:b-a+1},(_,i)=>'s'+String(a+i).padStart(3,'0'));
 if(['2TZN-1','3BQB-0'].includes(id)){
  hide(leaf('s002')?.parentElement,!received('s002'));
  for(const s of ['s010','s011','s012','s015','s016','s017','s018']){const e=leaf(s);if(e)hide(s==='s010'?e:e.parentElement,true)}
 }
 if(id==='2TZN-1'){
  for(let r=0;r<6;r++)for(const offset of [30,33,34,35])leaf('s'+String(offset+r*11).padStart(3,'0'))?.classList.add('bs-sector-labelled');
  for(let r=0;r<3;r++)for(const offset of [104,107,126,129])leaf('s'+String(offset+r*7).padStart(3,'0'))?.classList.add('bs-sector-labelled');
  const pill=node('2U2O-1');pill.dataset.stateControl='업종 목록 펼침';pill.setAttribute('aria-label','전체 업종 목록 펼침');node('3BQ9-0')?.removeAttribute('data-state-control');
  const table=node('2U3G-1');
  for(const col of [1,6]){const ids=Array.from({length:6},(_,r)=>'s'+String((col===1?28:36)+r*11).padStart(3,'0'));const empty=!ids.some(received);for(const e of table.querySelectorAll('[data-col="'+col+'"]'))hide(e,empty)}
  const widths=[220,120,160,140,200,155,140];const header=table.querySelector('[data-row="head"]');
  if(header){const width=[...header.querySelectorAll('[data-col]')].reduce((sum,e)=>sum+(e.classList.contains('bs-sector-hidden')?0:widths[Number(e.dataset.col)]||0),0);table.querySelector('.bs-readable-table')?.style.setProperty('--bs-table-width',width+'px');}
  const detail=node('345C-0');detail.classList.add('bs-sector-detail');
  for(const rid of ['345G-0','345N-0','345X-0','3467-0','346J-0','346T-0','3473-0']){
   const row=node(rid);row.classList.add('bs-sector-detail-row');
   for(const child of row.children){child.hidden=false;child.classList.add('bs-sector-detail-cell')}
  }
  // Blank time remains an empty cell; no fabricated time is supplied.
  for(const s of ['s102','s109','s116','s124','s131','s138'])leaf(s)?.classList.add('bs-sector-time');
  const sector=options.identity;
  text('s145',sector?.code?(sector.name||'업종 '+sector.code)+' · 조회 업종':'조회 업종 · 이름 미제공');
  compact('34F9-0',slots(213,218),'주도 종목 정보가 제공되지 않았습니다.');
  for(const rowId of ['34CX-0','34D2-0','34DD-0','34DO-0']){const row=node(rowId);row.classList.add('bs-sector-program-row');for(const wrapper of row.querySelectorAll(':scope > .bs-col'))wrapper.replaceWith(...wrapper.childNodes);}
  compact('34CV-0',[166,167,168,169,170,171,173,174,175,176,177,178,180,181,182,183,184,185].map(n=>'s'+n),'프로그램 매매 정보가 제공되지 않았습니다.');
  node('2U4R-1')?.classList.add('bs-sector-rail');
 }
 if(id==='3BQB-0'){
  const actual=[...states.keys()].some(sid=>/^s0(2[4-9]|[3-6]\d|70)$/.test(sid)&&received(sid));
  const body=node('3PSD-0');for(const child of body.children)if(!child.classList.contains('bs-sector-note'))hide(child,!actual);
  root.classList.toggle('bs-sector-list-empty',!actual);
  const pending=options.loadStatus==='pending'||(!options.loadStatus&&[...states].some(([sid,item])=>/^s0(2[4-9]|[3-6]\d|70)$/.test(sid)&&item.valueSlot&&item.pending));
  note(body,options.loadStatus==='failed'?'업종 목록을 불러오지 못했습니다. 위의 다시 시도로 재조회할 수 있습니다.':pending?'업종 목록을 불러오는 중입니다.':'조회된 업종 목록이 없습니다.',!actual);
 }
 if(id==='32S7-0'){
  const primary=root.querySelector('.bs-workspace');
  if(primary){let status=primary.parentElement.querySelector(':scope > .bs-sector-snapshot-status');if(!status){status=document.createElement('div');status.className='bs-sector-note bs-sector-snapshot-status';status.setAttribute('role','status');primary.before(status);}status.textContent='조회 스냅샷 · 실시간 미반영';}
  text('s070','조회 스냅샷 · 실시간 미반영');
  const footer=root.querySelector('[data-node="32SB-0"]');if(footer)footer.textContent='조회 응답 기준';
  for(const sid of ['s018','s024'])leaf(sid)?.classList.add('bs-sector-labelled');
  text('s001',options.identity?.name||'업종 이름 미제공');
  const change = leaf('s005');
  const occurrence = options.sectorChangeOccurrence;
  const caption = sectorChangeCaption(occurrence);
  if (change) {
   const previous = change.dataset.sectorChangeCaption;
   if (previous && change.textContent.startsWith(previous + ' ')) change.textContent = change.textContent.slice(previous.length + 1);
   change.dataset.sectorChangeCaption = caption;
  }
  label('s005', caption);
  for(const n of ['32WL-0','32WD-0','32T6-0'])hide(node(n),true);
  for(const s of ['s003','s049'])hide(leaf(s)?.parentElement,true);
  compact('32SK-0',['s062','s063','s064','s065','s066','s067'],'일별 업종 지수가 제공되지 않았습니다.');
 }
 return {received,leaf,node};
};

function updateInstrumentResidualDetails(surface, plan) {
  const id = surface.dataset?.bsBoardId;
  const slots = { '137X-2': ['s070', 's072', 's075'], '15N5-2': ['s043', 's044', 's047'], '2RBO-1': ['s064'],
    '3FR6-0': ['s183', 's185', 's187', 's189', 's191'] }[id];
  if (!slots) return;
  const states = surface.__bsInstrumentDetailStates || (surface.__bsInstrumentDetailStates = new Map());
  for (const assignment of plan.assignments) states.set(assignment.slotId, assignment);
  const completedMissing = sid => {
    const state = states.get(sid);
    return state && !state.pending && (state.missing || state.empty);
  };
  if (id === '3FR6-0') {
    const section = authoredNode(surface, '3HAO-0');
    const empty = slots.every(completedMissing);
    const pending = slots.some(sid => states.get(sid)?.pending)
      && slots.every(sid => states.get(sid)?.pending || completedMissing(sid));
    const compact = empty || pending;
    section.classList.toggle('bs-empty-minute-summary', compact);
    let note = section.querySelector(':scope > .bs-instrument-empty-note');
    if (compact && !note) {
      note = layoutGroup(surface.ownerDocument, 'bs-instrument-empty-note');
      note.setAttribute('role', 'status');
      section.append(note);
    }
    if (note) {
      note.hidden = !compact;
      note.textContent = pending ? '분 요약 수신 대기' : '분 요약 데이터가 제공되지 않았습니다';
    }
    return;
  }
  for (const sid of slots) {
    const state = states.get(sid), node = surface.querySelector(`[data-slot-id="${sid}"]`);
    if (!state || !node) continue;
    // 값이 없는 작은 그룹도 출처·항목과 대기 상태는 읽을 수 있어야 한다.
    const sourcePrefix = id === '15N5-2' && sid === 's047' ? '수익률 조회 ' : '';
    if (state.pending) node.textContent = `${sourcePrefix}수신 대기`;
    else if (completedMissing(sid)) node.textContent = sourcePrefix
      ? `${sourcePrefix}미제공` : id === '2RBO-1' ? '미제공' : '—';
    for (let box = node; box && box !== surface; box = box.parentElement) {
      if (box.dataset.bsUnavailableHidden === 'true' || surface.__bsEmptyValueHidden?.has(box)) {
        setHidden(box, false);
        delete box.dataset.bsUnavailableHidden;
        surface.__bsEmptyValueHidden?.delete(box);
      }
      if (box.matches('.bs-rail, .bs-primary')) break;
    }
  }
  if (id !== '137X-2') return;
  const section = authoredNode(surface, '14SQ-2');
  const empty = slots.every(completedMissing);
  section.classList.toggle('bs-empty-chart-flow', empty);
  let note = section.querySelector(':scope > .bs-instrument-empty-note');
  if (empty && !note) {
    note = layoutGroup(surface.ownerDocument, 'bs-instrument-empty-note');
    note.setAttribute('role', 'status');
    note.textContent = '제공된 일별 순매수 데이터가 없습니다';
    authoredNode(surface, '3C3J-0').after(note);
  }
  if (note) note.hidden = !empty;
  authoredNode(surface, '14SW-2').textContent = empty ? '기관별 상세' : '기관';
}


// 계좌 상세의 값을 유지하고, 완전 미제공 또는 일부 미제공 상태를 한 줄로 알린다.
function updateAccountDetailSections(surface) {
  if (registry.cardIdFor(surface.dataset?.bsBoardId) !== 'CC-01') return;
  const missing = (node) => node.dataset.missing === 'true'
    && ['—', '미제공', '시각 미제공'].includes(node.textContent.trim());
  const values = (box) => [...box.querySelectorAll('[data-bs-value-slot="true"]')];
  const allMissing = (box) => { const nodes = values(box); return nodes.length > 0 && nodes.every(missing); };
  for (const section of surface.querySelectorAll('.bs-rail > [data-node]')) {
    if (section.matches('.bs-table')) continue;
    const navigation = '[data-bs-account-navigation], [data-state-control], button, [role="button"], a[href]';
    const empty = allMissing(section) && !section.querySelector(navigation);
    const partial = ['2SCE-1', '133H-2'].includes(surface.dataset.bsBoardId)
      && !allMissing(section) && values(section).some(missing);
    section.classList.toggle('bs-account-empty-section', empty);
    let note = section.querySelector(':scope > .bs-account-empty-note');
    if ((empty || partial) && !note) {
      note = layoutGroup(surface.ownerDocument, 'bs-account-empty-note');
      note.setAttribute('role', 'status');
      section.append(note);
    }
    if (note) {
      if (empty || partial) note.textContent = empty ? '제공된 데이터가 없습니다' : '미제공 항목은 —로 표시됩니다';
      note.hidden = !(empty || partial);
    }
    for (const box of [...section.children, ...section.querySelectorAll('.bs-account-detail-grid > [data-node]')]) {
      if (box === section.firstElementChild || box === note) continue;
      const labels = [...box.querySelectorAll('[data-bs-design-text="true"]')];
      box.classList.toggle('bs-account-unlabelled-empty', allMissing(box)
        && !labels.some(node => node.textContent.trim()));
    }
  }
}

function updateRankingResidualDetails(surface, plan) {
  const elw = ['2VO0-0', '2XA5-0', '2XY6-0', '2Y47-0', '2ZN9-0'].includes(surface.dataset?.bsBoardId);
  const groups = {
    '2VO0-0': [['2WXT-0', '잔량 분포'], ['3HK2-0', '발행사별 상장']],
    '2XA5-0': [['2XAD-0', '등락 분포'], ['3JI5-0', '등락 구간별']],
    '2XY6-0': [['2XYE-0', '근접 요약'], ['3LFT-0', '근접 구간별']],
    '2Y47-0': [['2Y4F-0', '감지 현황'], ['3MPF-0', '기준가 대비 구간별']],
    '2ZN9-0': [['2ZNH-0', '저장 조건식']],
    '2VDA-0': [['3HX8-0', '신고·신저 분포'], ['3HY6-0', '시장별 통계'], ['3HYL-0', '경신 시간대']],
    '2YXS-0': [['3GI1-0', '상한·하한 집계'], ['3GJP-0', '도달 시각 통계'], ['3GK7-0', '업종 분포']],
    '2ZHC-0': [['3JAN-0', '고저가 근접 집계'], ['3JBO-0', '조건별 통계'], ['3JC3-0', '잔여 폭 통계'], ['3JCI-0', '시장별 통계']],
    '2ZZ7-0': [['3KX6-0', '급등락 집계'], ['3KYB-0', '구간 등락 분포'], ['3KYT-0', '감지 시간대'], ['3KZ8-0', '시장별 통계']],
    '2VIN-0': [['3O76-0', '과세 기준', ['s399', 's400']], ['3O7G-0', '시장 요약 통계', ['s404', 's406', 's408']], ['3O7U-0', '조회 수익률', ['s411', 's413', 's415', 's417']]],
    '30C1-0': [['3M91-0', '갱신 요약'], ['3M9J-0', '배율 상위 통계'], ['3MAK-0', '거래대금 상위 통계'], ['3MAZ-0', '시장별 통계']],
    '30O1-0': [['3ORF-0', '집중 요약'], ['3ORT-0', '가격대 분포']],
  }[surface.dataset?.bsBoardId];
  if (!groups) return;
  const states = surface.__bsRankingDetailStates || (surface.__bsRankingDetailStates = new Map());
  for (const assignment of plan.assignments) states.set(assignment.slotId, assignment);
  const main = elw || surface.dataset.bsBoardId === '2VIN-0'
    ? authoredNode(surface, READABLE_TABLES[surface.dataset.bsBoardId].node) : null;
  const sections = [[surface.querySelector('.bs-kpi'), elw ? '요약 지표' : '시장 요약 통계'],
    ...(main ? [[main, '조회 종목', [...main.querySelectorAll('[data-slot-id]')]
      .map(node => node.dataset.slotId).filter(slot => states.get(slot)?.valueSlot)]] : []),
    ...groups.map(([node, title, valueSlots]) => [authoredNode(surface, node), title, valueSlots])];
  for (const [section, title, valueSlots] of sections) {
    if (!section) continue;
    const slots = (valueSlots || [...section.querySelectorAll('[data-slot-id]')].map(node => node.dataset.slotId))
      .map(slot => states.get(slot));
    const unavailable = slots.length > 0 && slots.every(state => state && !state.pending
      && (state.missing || state.empty || state.designText || !state.text));
    const pending = (!!valueSlots || elw) && slots.some(state => state?.pending)
      && slots.every(state => state && (state.pending || state.missing || state.empty
        || (elw && (state.designText || !state.text))));
    section.classList.toggle('bs-ranking-unavailable-group', unavailable || pending);
    let note = section.querySelector(':scope > .bs-ranking-unavailable-note');
    if ((unavailable || pending) && !note) {
      note = layoutGroup(surface.ownerDocument, 'bs-ranking-unavailable-note');
      section.append(note);
    }
    if (note) {
      note.textContent = title + (pending ? ' 수신 대기' : ' 미제공');
      note.hidden = !unavailable && !pending;
    }
  }
  if (elw) {
    for (const sid of ['s017', 's020', 's023', 's026']) {
      const state = states.get(sid), node = surface.querySelector(`[data-slot-id="${sid}"]`);
      node?.closest('.bs-kpi-cell')?.classList.toggle('bs-ranking-unavailable-cell',
        !!state && !state.pending && (state.empty || state.missing));
    }
    const detailSlots = surface.dataset.bsBoardId === '2ZN9-0' ? ['s172'] : ['s313', 's315', 's317', 's319'];
    for (const sid of detailSlots) {
      const state = states.get(sid), node = surface.querySelector(`[data-slot-id="${sid}"]`);
      node?.parentElement?.classList.toggle('bs-ranking-unavailable-cell',
        !!state && !state.pending && (state.empty || state.missing));
    }
  }
  if (surface.dataset.bsBoardId === '2VIN-0') {
    for (const sid of ['s411', 's413', 's415', 's417']) {
      const state = states.get(sid), node = surface.querySelector(`[data-slot-id="${sid}"]`);
      if (!node || !state) continue;
      node.parentElement.classList.toggle('bs-ranking-unavailable-cell', !state.pending && (state.empty || state.missing));
      if (state.pending) node.textContent = '수신 대기';
    }
  }
  if (surface.dataset.bsBoardId === '30O1-0') {
    // Only the received concentration ratio has a source in this KPI strip.
    for (const cell of surface.querySelectorAll('.bs-kpi-cell')) {
      cell.classList.toggle('bs-ranking-unavailable-cell', !cell.querySelector('[data-slot-id="s023"]'));
    }
  }
  surface.querySelector('.bs-rail')?.classList.add('bs-ranking-compact-rail');
  if (surface.dataset.bsBoardId === '2YXS-0') {
    // Both lists bind the same ka10017 rows. Retain a second list only if it
    // actually carries different values, so later partial updates stay visible.
    const duplicate = [['s347', 's331'], ['s348', 's332'], ['s350', 's334'],
      ['s351', 's335'], ['s353', 's337'], ['s354', 's338']].every(([lower, upper]) => {
      const a = states.get(lower), b = states.get(upper);
      return a && b && a.text === b.text && a.pending === b.pending && a.empty === b.empty;
    });
    authoredNode(surface, '3GJ6-0')?.classList.toggle('bs-ranking-duplicate-list', duplicate);
  }
}

function updateAccountResidualDetails(surface, plan) {
  const id = surface.dataset?.bsBoardId;
  if (!['2SYW-1', '3LGC-0', '3NVG-0', '3OIM-0', '3ODO-0'].includes(id)) return;
  const states = surface.__bsAccountDetailStates || (surface.__bsAccountDetailStates = new Map());
  for (const assignment of plan.assignments) states.set(assignment.slotId, assignment);
  if (id === '3OIM-0') {
    for (const [node, text] of [['3SWR-0', '미체결 주문'], ['3SXB-0', '당일 체결']]) {
      const section = authoredNode(surface, node);
      if (!section || section.querySelector(':scope > .bs-account-detail-context')) continue;
      const heading = layoutGroup(surface.ownerDocument, 'bs-account-detail-context');
      heading.textContent = text;
      section.prepend(heading);
    }
  }
  const groups = {
    '2SYW-1': [
      ['3UKP-0', ['s136','s137','s139','s140','s142','s143','s145','s147'], '미체결 주문 정보 미제공'],
      ['3ULE-0', ['s149','s150','s152','s153','s155','s158','s160'], '주문 상세 정보 미제공'],
      ['3UM3-0', ['s163','s164','s165','s166','s167','s168','s169','s170','s171','s172'], '체결 주문 정보 미제공'],
      ['3UMP-0', ['s174','s176','s177','s179','s180','s182'], '주문 상태·경로 정보 미제공'],
    ],
    '3LGC-0': [
      ['3UE1-0', ['s114','s116','s118','s120','s122','s124','s126','s128'], '외화 정산 정보 미제공'],
      ['3MNE-0', ['s149','s151','s153','s155','s157','s159','s161','s163'], '거래 성격 정보 미제공'],
    ],
    '3NVG-0': [
      ['3PAQ-0', ['s049','s051','s053','s055'], '외화 예수금 정보 미제공'],
      ['3PBO-0', ['s059','s061','s063'], '외화 미수·연체 정보 미제공'],
      ['3PC2-0', ['s067','s069'], '원화 표시 정보 미제공'],
    ],
    '3ODO-0': [
      ['3P5Z-0', ['s090','s092','s094','s096','s098','s100','s103','s105','s107'], '계좌 요약 정보 미제공'],
    ],
  }[id] || [];
  const navigation = '[data-bs-account-navigation], [data-state-control], [data-state-board], button, [role="button"], a[href]';
  for (const [node, slots, text] of groups) {
    const section = authoredNode(surface, node);
    if (!section) continue;
    const empty = slots.every(slot => {
      const state = states.get(slot);
      return state && !state.pending && (state.empty || state.missing);
    });
    const pending = (id === '2SYW-1' || id === '3ODO-0'
      || (id === '3LGC-0' && node === '3MNE-0') || (id === '3NVG-0' && node === '3PBO-0'))
      && slots.some(slot => states.get(slot)?.pending)
      && slots.every(slot => {
        const state = states.get(slot);
        return state && (state.pending || state.empty || state.missing);
      });
    const compact = empty || pending;
    section.classList.toggle('bs-account-residual-empty', compact);
    for (const child of section.children) {
      child.classList.toggle('bs-account-detail-navigation',
        child.matches(navigation) || !!child.querySelector(navigation));
    }
    let note = section.querySelector(':scope > .bs-account-residual-note');
    if (compact && !note) {
      note = layoutGroup(surface.ownerDocument, 'bs-account-empty-note bs-account-residual-note');
      section.append(note);
    }
    if (note) {
      note.textContent = pending ? text.replace(/ 정보 미제공$/, ' 수신 대기') : text;
      note.hidden = !compact;
    }
  }
}

function updateCurrentQuoteDetails(surface, plan) {
  if (surface.dataset?.bsBoardId !== '2R3M-1') return;
  const states = surface.__bsCurrentQuoteStates || (surface.__bsCurrentQuoteStates = new Map());
  for (const assignment of plan.assignments) states.set(assignment.slotId, assignment);
  const unavailable = slots => slots.every(slot => {
    const state = states.get(slot);
    return state && (state.pending || state.empty || state.missing);
  });
  const status = slots => slots.some(slot => states.get(slot)?.pending) ? '수신 대기' : '미제공';
  const costs = ['s178','s180','s182','s184','s186','s188'];
  const section = authoredNode(surface, '36TD-0');
  const compact = unavailable(costs);
  section.classList.toggle('bs-current-quote-empty-costs', compact);
  let note = section.querySelector(':scope > .bs-current-quote-note');
  if (compact && !note) {
    note = layoutGroup(surface.ownerDocument, 'bs-current-quote-note');
    note.setAttribute('role', 'status');
    section.append(note);
  }
  if (note) {
    note.textContent = `체결 비용·증거금 ${status(costs)}`;
    note.hidden = !compact;
  }
  const table = authoredNode(surface, '3DFG-0');
  const inner = table.querySelector('.bs-readable-table');
  const columns = [
    [5, 96, '전일대비·등락률', ['s221','s222','s232','s233','s243','s244']],
    [7, 144, '외국계·프로그램', ['s225','s226','s236','s237','s247','s248']],
  ];
  let width = READABLE_TABLES['2R3M-1'].widths.reduce((sum, value) => sum + value, 0);
  const notices = [];
  for (const [col, size, label, slots] of columns) {
    const hidden = unavailable(slots);
    for (const cell of inner.querySelectorAll(`.bs-readable-cell[data-col="${col}"]`)) {
      cell.classList.toggle('bs-current-quote-column-empty', hidden);
    }
    if (hidden) {
      width -= size;
      notices.push(`${label} ${status(slots)}`);
    }
  }
  inner.style.setProperty('--bs-table-width', `${width}px`);
  let columnNote = table.querySelector(':scope > .bs-current-quote-note');
  if (!columnNote && notices.length) {
    columnNote = layoutGroup(surface.ownerDocument, 'bs-current-quote-note');
    columnNote.setAttribute('role', 'status');
    table.querySelector('.bs-readable-scroll').before(columnNote);
  }
  if (columnNote) {
    columnNote.textContent = notices.join(' · ');
    columnNote.hidden = notices.length === 0;
  }
}

function updateOrderbookKpi(surface, options) {
  if (registry.cardIdFor(surface.dataset?.bsBoardId) !== 'CC-04') return;
  if (!options.partial) surface.__bsKpiPending = new Set(options.deferredValueSlots || []);
  const pending = surface.__bsKpiPending || new Set();
  for (const cell of surface.querySelectorAll('.bs-kpi-cell')) {
    const values = [...cell.querySelectorAll('[data-bs-value-slot="true"]')];
    for (const node of values) {
      if (!node.dataset.missing && node.textContent.trim()) pending.delete(node.dataset.slotId);
    }
    const empty = values.length > 0 && values.every(node => !pending.has(node.dataset.slotId)
      && ['', '—', '미제공', '시각 미제공'].includes(node.textContent.trim()));
    cell.classList.toggle('bs-empty-orderbook-kpi', empty);
  }
}

// These groups have independent response sources; zero is received data.
const ORDERBOOK_DETAIL_GROUPS = {
  '13BC-2': [],
  '1JPU-0': [['1JQF-0', ['s011', ...Array.from({ length: 96 }, (_, i) => `s${String(i + 19).padStart(3, '0')}`), 's116', 's118'], '최근체결']],
  '2TRW-1': [['3JJC-0', ['s081','s083'], '체결강도'], ['3JSS-0', ['s141','s142','s143'], '호가잔량']],
  '3JZ3-0': [
    ['3U7Z-0', ['s192','s193','s195','s196'], '호가잔량'],
    ['3UBL-0', ['s201','s203','s205','s207','s209'], '잔량균형'],
    ['3UC4-0', ['s217','s218','s219','s220','s221','s222','s223','s225','s226','s227','s228','s229','s230','s231'], '거래소별 잔량'],
    ['3UD2-0', [], 'LP 합계'],
  ],
  '2QRP-1': [
    ['3IOY-0', ['s066','s068','s070'], '정규장 구간'], ['3IQC-0', ['s073','s075','s077'], '시간외 구간'],
    ['3IW5-0', [], 'NXT 애프터마켓'], ['2QVR-1', ['s085'], '단일가 현재가'],
    ['2QW7-1', ['s093'], '시간외 정보'], ['33Q3-0', [], '거래소별 잔량'],
  ],
  '3JT4-0': [
    ['3JV8-0', ['s080','s082','s084'], '정규장 구간'], ['3JUX-0', ['s087','s089','s091'], '시간외 구간'],
    ['3JUP-0', [], 'NXT 애프터마켓'], ['3UIV-0', ['s099'], '단일가 현재가'],
    ['3UJ9-0', ['s107'], '시간외 정보'], ['3UJR-0', [], '거래소별 잔량'],
  ],
};

function updateOrderbookDetails(surface, plan) {
  const groups = ORDERBOOK_DETAIL_GROUPS[surface.dataset?.bsBoardId];
  if (!groups) return;
  const states = surface.__bsOrderbookStates || (surface.__bsOrderbookStates = new Map());
  for (const assignment of plan.assignments) states.set(assignment.slotId, assignment);
  if (surface.dataset.bsBoardId === '13BC-2') updateQuoteTradeAvailability(surface, states);
  if (surface.dataset.bsBoardId === '3JZ3-0') updateExchangeDepthColumns(surface, states);
  const navigation = '[data-state-control], [data-state-board], [data-bs-orderbook-control], button, [role="button"], a[href]';
  for (const [node, slots, label] of groups) {
    const group = authoredNode(surface, node);
    if (!group) continue;
    const compact = slots.every(slot => {
      const state = states.get(slot);
      return state && (state.pending || state.empty || state.missing);
    });
    group.classList.toggle('bs-orderbook-empty', compact);
    for (const child of group.children) child.classList.toggle('bs-orderbook-navigation',
      child.matches(navigation) || !!child.querySelector(navigation));
    let note = group.querySelector(':scope > .bs-orderbook-note');
    if (compact && !note) {
      note = layoutGroup(surface.ownerDocument, 'bs-orderbook-note');
      note.setAttribute('role', 'status');
      group.append(note);
    }
    if (note) {
      note.textContent = `${label} ${slots.some(slot => states.get(slot)?.pending) ? '수신 대기' : label.endsWith('정보') ? '미제공' : '정보 미제공'}`;
      note.hidden = !compact;
    }
  }
}

function updateQuoteTradeAvailability(surface, states) {
  const owner = authoredNode(surface, '3IMQ-0');
  const scroll = owner?.querySelector('.bs-readable-scroll');
  if (!scroll) return;
  const slots = Array.from({ length: 48 }, (_, i) => `s${String(i + 107).padStart(3, '0')}`);
  const unavailable = slots.every(slot => {
    const value = states.get(slot);
    return value && (value.pending || value.empty || value.missing);
  });
  owner.classList.toggle('bs-quote-trades-unavailable', unavailable);
  let note = owner.querySelector(':scope > .bs-quote-trades-note');
  if (!note && unavailable) {
    note = layoutGroup(surface.ownerDocument, 'bs-orderbook-note bs-quote-trades-note');
    note.setAttribute('role', 'status');
    scroll.before(note);
  }
  if (note) {
    note.textContent = slots.some(slot => states.get(slot)?.pending) ? '체결 내역 수신 대기' : '체결 내역 미제공';
    note.hidden = !unavailable;
  }
}

function updateExchangeDepthColumns(surface, states) {
  const table = authoredNode(surface, '3KFV-0');
  const inner = table?.querySelector('.bs-readable-table');
  if (!inner) return;
  const columns = [
    [4, 132, 'KRX', ['s034','s041','s048','s055','s062','s069','s076','s083','s090','s097','s103','s116','s123','s130','s137','s144','s151','s158','s165','s172','s179','s185']],
    [5, 122, 'NXT', ['s035','s042','s049','s056','s063','s070','s077','s084','s091','s098','s104','s117','s124','s131','s138','s145','s152','s159','s166','s173','s180','s186']],
  ];
  const notices = [];
  let width = READABLE_TABLES['3JZ3-0'].widths.reduce((sum, value) => sum + value, 0);
  for (const [col, size, label, slots] of columns) {
    const unavailable = slots.every(slot => {
      const state = states.get(slot);
      return state && (state.pending || state.empty || state.missing);
    });
    for (const cell of inner.querySelectorAll(`.bs-readable-cell[data-col="${col}"]`)) {
      cell.classList.toggle('bs-depth-column-unavailable', unavailable);
    }
    if (unavailable) {
      width -= size;
      notices.push(`${label} 잔량 ${slots.some(slot => states.get(slot)?.pending) ? '수신 대기' : '미제공'}`);
    }
  }
  inner.style.setProperty('--bs-table-width', `${width}px`);
  let note = table.querySelector(':scope > .bs-depth-column-note');
  if (!note && notices.length) {
    note = layoutGroup(surface.ownerDocument, 'bs-orderbook-note bs-depth-column-note');
    note.setAttribute('role', 'status');
    table.querySelector('.bs-readable-scroll').before(note);
  }
  if (note) {
    note.textContent = notices.join(' · ');
    note.hidden = notices.length === 0;
  }
}

// DOM 쓰기 층 — 텍스트 노드만 건드린다. 구조·인라인 스타일 원문은 손대지 않는다(D1).
function applyPlan(root, plan, options = {}) {
  if (!options.partial) {
    // hydration 이전 빈 값 때문에 접은 묶음만 복원한다. 명시적인 빈 행 접기는 뒤에서 적용한다.
    for (const box of root.__bsEmptyValueHidden || []) setHidden(box, false);
    root.__bsEmptyValueHidden = new Set();
  }
  const index = nodeIndex(root);
  const mirrors = pairedMirrorIndex(root);
  const unbound = [];
  const containers = [];
  for (const assignment of plan.assignments) {
    const el = index.get(assignment.node);
    if (!el) { unbound.push(assignment.slotId); continue; }
    if (elementChildCount(el) > 0) { containers.push(assignment.slotId); continue; }
    if (options.partial && assignment.valueSlot && !assignment.missing && String(assignment.text).trim()
      && !el.closest?.('[data-bs-primary-mockup="true"]')) {
      for (const box of root.__bsEmptyValueHidden || []) {
        if (box !== el && !box.contains(el)) continue;
        setHidden(box, false);
        root.__bsEmptyValueHidden.delete(box);
      }
      const row = el.closest?.('[data-bs-row-collapsed="true"]');
      if (row) {
        setHidden(row, false);
        delete row.dataset.bsRowCollapsed;
      }
    }
    const compactTime = assignment.missing && assignment.text === '시각 미제공'
      && typeof el.closest === 'function' && !!el.closest('.bs-kpi-cell, .bs-table');
    // 계좌 상세는 값이 없어도 라벨 옆 자리를 유지한다. 반복 빈 행은 별도로 접는다.
    const nestedAccountDetail = (root.dataset?.bsBoardId === '3LGC-0'
      && el.closest?.('[data-node="3UE1-0"]')) || (root.dataset?.bsBoardId === '3NVG-0'
      && el.closest?.('[data-node="3PAQ-0"], [data-node="3PBO-0"], [data-node="3PC2-0"]'))
      || (root.dataset?.bsBoardId === '3ODO-0' && el.closest?.('[data-node="3P5Z-0"]'));
    const accountDetail = registry.cardIdFor(root.dataset?.bsBoardId) === 'CC-01'
      && assignment.valueSlot && (tableCellOf(el) || el.closest?.('.bs-rail') || nestedAccountDetail);
    if (accountDetail) el.dataset.bsKeepMissing = 'true';
    if (registry.cardIdFor(root.dataset?.bsBoardId) === 'CC-01' && assignment.expandedBoard) {
      el.dataset.bsAccountNavigation = 'true';
      el.dataset.bsKeepMissing = 'true';
    }
    const accountPending = accountDetail && assignment.pending;
    const accountEmpty = accountDetail && assignment.empty;
    const missingValue = assignment.missing && assignment.text === boardFormat.missingText();
    el.textContent = accountPending ? '수신 대기' : accountEmpty ? '—'
      : compactTime || (missingValue && (tableCellOf(el) || accountDetail)) ? '—' : assignment.text;
    if (compactTime || (accountDetail && (missingValue || accountPending || accountEmpty))) {
      el.setAttribute('title', accountPending ? '수신 대기' : accountEmpty ? '응답에 값이 없습니다' : assignment.text);
      el.setAttribute('aria-label', accountPending ? '수신 대기' : accountEmpty ? '응답에 값이 없습니다' : assignment.text);
      el.dataset.bsMissingDescription = 'true';
    } else if (el.dataset && el.dataset.bsMissingDescription) {
      el.removeAttribute('title');
      el.removeAttribute('aria-label');
      delete el.dataset.bsMissingDescription;
    }
    setTone(el, accountDetail && (assignment.missing || accountPending || accountEmpty) ? 'flat' : assignment.tone,
      Boolean(accountDetail && (assignment.missing || accountPending || accountEmpty)) || assignment.forceFlatTone);
    if (assignment.text === '상태 미확인'
      || (assignment.missing && assignment.text === '시각 미제공' && el.closest?.('.bs-header'))) setStatusAppearance(el, false);
    if (el.dataset) {
      el.dataset.slotId = assignment.slotId;
      if (assignment.valueAtomic) el.dataset.bsValueAtomic = 'true';
      else delete el.dataset.bsValueAtomic;
      if (assignment.valueSlot) el.dataset.bsValueSlot = 'true';
      else delete el.dataset.bsValueSlot;
      if (assignment.missing || accountEmpty) el.dataset.missing = 'true';
      else delete el.dataset.missing;
      // 디자인 문구(라벨·static)는 값이 아니다 — 빈 줄 접기가 이 표시를 보고
      // 「이 줄에 자료가 있다」고 오해하지 않게 남긴다.
      if (assignment.designText) el.dataset.bsDesignText = 'true';
      else delete el.dataset.bsDesignText;
    }
    syncPairedMirrors(el, mirrors.get(assignment.node));
  }

  for (const group of plan.collapse) {
    const hidden = new Set(group.hiddenItems);
    for (const row of root.querySelectorAll(`[data-collapse-member="${group.groupId}"]`)) {
      const itemId = row.dataset ? row.dataset.collapseItem : row.getAttribute('data-collapse-item');
      setHidden(row, hidden.has(itemId));
    }
    for (const rollup of root.querySelectorAll(`[data-collapse-rollup="${group.groupId}"]`)) {
      setHidden(rollup, !group.collapsed);
      if (rollup.__bsExpandWired) continue;
      const boardId = rollup.dataset ? rollup.dataset.expandBoard : rollup.getAttribute('data-expand-board');
      if (typeof options.onExpand === 'function') {
        rollup.__bsExpandWired = true;
        rollup.addEventListener('click', () => options.onExpand(boardId, { groupId: group.groupId, root }));
      }
    }
  }

  // 계약이 모르는 채로 화면에 글자를 내는 노드만 잉여로 센다. 컨테이너 앵커는
  // 그 자체로 글자를 내지 않으므로(자식이 낸다) 잉여가 아니다.
  // 부분 갱신(실시간 프레임)은 계획에 슬롯 몇 개만 들어 있어 이 셈이 뜻을 잃는다.
  const collapsedRows = options.partial
    ? []
    : collapseEmptyRows(root, options.emptyRows, options);
  const collapsedColumns = options.partial
    ? []
    : collapseEmptyColumns(root, options.emptyColumns);
  if (!options.partial) {
    hideEmptyValueUnits(root, plan);
  }
  hideUnavailableUnits(root);
  updateInstrumentResidualDetails(root, plan);
  updateFlowResidualDetails(root, plan, options);
  updateAccountDetailSections(root);
  updateAccountResidualDetails(root, plan);
  updateRankingResidualDetails(root, plan);
  updateRankFour(root, plan);
  updateRankNine(root, plan);
  updateFlowRankFive(root, plan);
  updateCurrentQuoteDetails(root, plan);
  updateOrderbookKpi(root, options);
  updateOrderbookDetails(root, plan);
  updateSectorDetails(root, plan, options);
  updateWatchDetails(root, plan, options);
  if (options.partial) {
    return { unbound, unmapped: [], containers, collapsedRows, collapsedColumns };
  }
  const claimed = new Set(plan.assignments.map((assignment) => assignment.node));
  const unmapped = [];
  for (const [key, el] of index) {
    if (claimed.has(key)) continue;
    if (elementChildCount(el) === 0 && hasTextContent(el)) unmapped.push(key);
  }
  return { unbound, unmapped, containers, collapsedRows, collapsedColumns };
}

// ---------- 실시간 슬롯 이음매 (봉투 계약 ↔ 보드 잎) ----------
//
// 실시간 프레임은 `binding_id`만 들고 온다(원시 FID·별칭은 신뢰 경계 밖으로 안 나온다).
// 봉투는 두 표를 함께 싣는다: `realtime_bindings`가 binding_id ↔ observation_id를,
// `surface_contract.slot_values`가 slot_id ↔ observation_id를(백엔드
// card_surface_contract.observation_id_for가 두 쪽의 단일 출처). 같은 관찰을
// 가리킬 때만 잇는다 — 추측으로 잇는 경로는 없다.
const OBSERVATION_ID = /^obs_[a-f0-9]{12,64}$/i;
const REALTIME_BINDING_ID = /^rtb_[a-f0-9]{12,64}$/i;

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// slot_values는 {slot_id: value} 맵으로도, 목록으로도 온다. 이음매는 목록 형태에만
// 있다(관찰 식별자가 항목에 붙는다) — 맵 형태면 빈 표를 돌려 실시간이 조용히 꺼진다.
function slotValueEntries(surfaceContract) {
  const raw = surfaceContract && (surfaceContract.slot_values || surfaceContract.slotValues);
  return Array.isArray(raw) ? raw : [];
}

function observationIdsOfSlotEntry(entry) {
  const ids = [];
  const direct = text(entry && (entry.observation_id || entry.observationId));
  if (OBSERVATION_ID.test(direct)) ids.push(direct);
  const composite = boardFormat.compositeSpecOf(entry && entry.value);
  for (const part of (composite && Array.isArray(composite.parts)) ? composite.parts : []) {
    const observationId = text(part && (part.observation_id || part.observationId));
    if (OBSERVATION_ID.test(observationId) && !ids.includes(observationId)) ids.push(observationId);
  }
  return ids;
}

function realtimeSlotIndex(surfaceContract, realtimeBindings) {
  const slotsByObservation = new Map();
  for (const entry of slotValueEntries(surfaceContract)) {
    const slotId = text(entry && entry.slot_id);
    if (!slotId) continue;
    for (const observationId of observationIdsOfSlotEntry(entry)) {
      if (!slotsByObservation.has(observationId)) slotsByObservation.set(observationId, []);
      const bucket = slotsByObservation.get(observationId);
      if (!bucket.includes(slotId)) bucket.push(slotId);
    }
  }
  const index = new Map();
  // 기존 호출부의 binding_id → [slot_id] Map 계약은 유지한다. composite 갱신만
  // 어느 part를 바꿀지 알아야 하므로 같은 색인에 binding의 관찰 식별자를 덧붙인다.
  index.observationByBinding = new Map();
  for (const raw of Array.isArray(realtimeBindings) ? realtimeBindings : []) {
    const bindingId = text(raw && (raw.binding_id || raw.bindingId));
    const observationId = text(raw && (raw.observation_id || raw.observationId));
    if (!REALTIME_BINDING_ID.test(bindingId) || !OBSERVATION_ID.test(observationId)) continue;
    index.observationByBinding.set(bindingId, observationId);
    const slotIds = slotsByObservation.get(observationId);
    if (!slotIds) continue;
    if (!index.has(bindingId)) index.set(bindingId, []);
    const bucket = index.get(bindingId);
    for (const slotId of slotIds) if (!bucket.includes(slotId)) bucket.push(slotId);
  }
  return index;
}

function updateRealtimeValue(current, observationId, nextValue) {
  const composite = boardFormat.compositeSpecOf(current);
  if (!composite) return { value: nextValue, updated: true };
  // composite 전체를 scalar tick으로 덮지 않는다. 정확히 같은 observation_id인
  // part만 바꾸고 나머지 값·포맷·구분자는 그대로 보존한다.
  if (!OBSERVATION_ID.test(text(observationId)) || !Array.isArray(composite.parts)) {
    return { value: current, updated: false };
  }
  let updated = false;
  const parts = composite.parts.map((part) => {
    const partObservation = text(part && (part.observation_id || part.observationId));
    if (partObservation !== observationId) return part;
    updated = true;
    return { ...part, value: nextValue };
  });
  return updated
    ? { value: { ...current, composite: { ...composite, parts } }, updated: true }
    : { value: current, updated: false };
}

// 프레임 하나가 건드리는 슬롯 집합. 병기(D4) 짝은 같은 프레임에서 함께 칠한다 —
// 주값만 새 값이고 병기가 이전 프레임 값이면 화면에 섞인 한 순간이 남는다.
function pairedClosure(contract, slotIds) {
  const targets = new Set(slotIds);
  const slots = slotList(contract);
  let grew = true;
  while (grew) {
    grew = false;
    for (const slot of slots) {
      if (!slot.paired_with) continue;
      if (targets.has(slot.paired_with) && !targets.has(slot.slot_id)) {
        targets.add(slot.slot_id);
        grew = true;
      }
      if (targets.has(slot.slot_id) && !targets.has(slot.paired_with)) {
        targets.add(slot.paired_with);
        grew = true;
      }
    }
  }
  return targets;
}

// 부분 계획 — 텍스트는 건드린 슬롯(과 그 병기 짝)만, 접힘은 보드 전체로 다시 센다.
// H1 영값 묶음은 "값이 생기면 그 항목만 행으로 올라온다"라서 갱신된 값 하나가
// 묶음 전체의 접힘 여부를 바꿀 수 있다.
function realtimePlan(contract, values, slotIds) {
  const targets = pairedClosure(contract, slotIds);
  const full = mountPlan(contract, values);
  return {
    ...full,
    assignments: full.assignments.filter((assignment) => targets.has(assignment.slotId)),
    touched: [...targets],
  };
}

// 실시간 프레임 적용. 마운트와 **같은** 포맷터·같은 쓰기 규칙을 쓴다(같은 값이
// 두 경로에서 다르게 보이면 안 된다). 값 표는 호출부가 갖고 있고 여기서 고치지
// 않는다 — 상태 보드 전환·재마운트가 그 표를 그대로 다시 쓴다.
function applyRealtimeSlots(surface, contract, values, slotIds, options = {}) {
  if (!surface || !slotIds || !slotIds.length) return { touched: [], plan: null };
  const plan = realtimePlan(contract, values, slotIds);
  const report = applyPlan(surface, plan, { ...options, partial: true });
  if (contract.board_id === '3ODO-0') updateEmptyTableStates(surface);
  if (flowLayout && ['2QFO-2', '2QM7-2'].includes(contract.board_id)) {
    flowLayout.update(surface, contract, mountPlan(contract, values), { ...surface.__bsFlowOptions, ...options });
    updateEmptyTableStates(surface);
  }
  if (identityCardId(contract) === 'CC-04') {
    if (goldQuote) goldQuote.update(surface, contract, mountPlan(contract, values), { ...surface.__bsGoldOptions, ...options });
    if (contract.board_id === '3JT4-0') collapseEmptyRows(authoredNode(surface, '3KG8-0'), [], options);
    updateEmptyTableStates(surface);
    compactReducedContent(surface, contract);
  }
  return { touched: plan.touched, plan, ...report };
}

// 상태 보드 링크의 pointer/keyboard 경로를 한 콜백으로 묶는다. 실제 button이나
// 기존 tab/button role은 브라우저·소유 위젯의 키보드 동작을 그대로 써야 하므로
// 추가 keydown을 달지 않는다. Paper에서 온 plain text leaf만 명시적으로 요청받았을
// 때 button 의미를 보강한다.
function stateLinksFromMarks(stateControls) {
  const marks = stateControls && Array.isArray(stateControls.marks)
    ? stateControls.marks : [];
  const links = [];
  for (const mark of marks) {
    const control = String((mark && mark.control) || '').trim();
    if (!control || !Array.isArray(mark.boards)) continue;
    for (const board of mark.boards) {
      const boardId = String(board || '').trim();
      if (boardId) links.push({ control, board_id: boardId });
    }
  }
  return links;
}

// 레일 칩을 찾는 세 갈래. 추출 원문에서 칩은 그냥 텍스트 잎이라 표식이 없으면
// 문구로 찾을 수밖에 없다.
//
//   1) 표식      — `data-state-control`. 그 링크를 소유한 보드에만 찍힌다.
//   2) 같은 문구  — 스트립·내비 안에서 계약의 control과 정확히 같은 글자를 내는 잎.
//   3) 별칭 문구  — 같은 표식이 **다른 보드에서** 낸 문구(색인 CONTROL_LABELS).
//                  자식 보드의 레일은 부모 레일의 복제본인데 표식이 없어서,
//                  문구가 표식 이름과 다른 칩(「관심종목 시세 보드」 → 「관심」)은
//                  2)로는 절대 안 잡힌다 — 실측 44장 98링크가 그 상태였다.
//
// 3)은 두 겹으로 막는다: 그 문구를 내는 잎이 이 보드에 **하나**여야 하고, 다른 링크가
// 같은 문구를 노리지 않아야 한다. 엉뚱한 칩에 다른 보드를 매다는 것이 안 눌리는
// 것보다 나쁘다.
// 칩은 스트립에만 있지 않다. 능력 내비(업종·관심·테마·시장·VI·조건검색)는 카드 머리에
// 있고, 「더보기」는 표 꼬리에 있다 — 스트립만 뒤지면 그 문들이 자식 보드에서 전부
// 죽는다(실측 4A9H-1: 링크 19개 중 6개가 안 걸렸다). 그래서 좁은 자리부터 넓은 자리로
// 세 단으로 훑는다. 넓은 단(표면 전체)은 **그 문구가 보드에 하나뿐일 때만** 쓴다 —
// 「등락률」처럼 정렬 칩과 표 열 이름이 같은 글자를 쓰는 자리가 있다(그 경우는 앞 단에서
// 스트립 칩이 이미 잡는다).
const STATE_CONTROL_SCOPES = '.bs-strip, nav, [role="tablist"]';
const STATE_CONTROL_WIDE_SCOPES = '.bs-header, .bs-footer';

function leavesIn(surface, selector) {
  const leaves = [];
  for (const scope of surface.querySelectorAll(selector)) {
    for (const node of scope.querySelectorAll('*')) {
      if (node.childElementCount === 0) leaves.push(node);
    }
  }
  return leaves;
}

function stateControlScopeLeaves(surface) {
  return leavesIn(surface, STATE_CONTROL_SCOPES);
}

function surfaceLeaves(surface) {
  const leaves = [];
  for (const node of surface.querySelectorAll('*')) {
    if (node.childElementCount === 0) leaves.push(node);
  }
  return leaves;
}

function labelsOf(control, options) {
  const source = options && typeof options.labelsFor === 'function'
    ? options.labelsFor
    : (registry && registry.controlLabels);
  return typeof source === 'function' ? source(control) || [] : [];
}

function findStateControlNode(surface, control, options = {}) {
  if (!surface || typeof surface.querySelectorAll !== 'function') return null;
  const wanted = String(control || '').trim();
  if (!wanted) return null;
  for (const node of surface.querySelectorAll('[data-state-control]')) {
    if (node.dataset.stateControl === wanted) return stateControlActivationOwner(node);
  }
  const textOf = (node) => String(node.textContent || '').trim();
  const leaves = stateControlScopeLeaves(surface);
  const exact = leaves.find((node) => textOf(node) === wanted);
  if (exact) return stateControlActivationOwner(exact);
  // 머리·꼬리 → 표면 전체. 좁은 자리에서 못 찾았을 때만 넓히고, 넓은 자리에서는
  // 문구가 유일할 때만 매단다.
  for (const wide of [leavesIn(surface, STATE_CONTROL_WIDE_SCOPES), surfaceLeaves(surface)]) {
    const matches = wide.filter((node) => textOf(node) === wanted);
    if (matches.length === 1) return stateControlActivationOwner(matches[0]);
  }
  const links = Array.isArray(options.links) ? options.links : [];
  for (const label of labelsOf(wanted, options)) {
    // 같은 문구를 노리는 다른 링크가 있으면 어느 쪽인지 알 수 없다 — 건너뛴다.
    const rivals = links.filter((link) => {
      const rival = String((link && link.control) || '').trim();
      return rival && rival !== wanted && labelsOf(rival, options).includes(label);
    });
    if (rivals.length) continue;
    // 별칭도 같은 순서로 넓힌다 — 능력 내비(「관심」·「테마」)는 머리에 있어 스트립만
    // 보면 못 찾는다. 단마다 그 문구가 하나뿐일 때만 매단다.
    for (const tier of [leaves, leavesIn(surface, STATE_CONTROL_WIDE_SCOPES), surfaceLeaves(surface)]) {
      const matches = tier.filter((node) => textOf(node) === label);
      if (matches.length === 1) return stateControlActivationOwner(matches[0]);
      if (matches.length > 1) break;
    }
  }
  return null;
}

function stateControlActivationOwner(node) {
  if (!node || typeof node.closest !== 'function') return node || null;
  // Paper 칩은 클릭 표식이 글자 잎에 있고 패딩·배경은 bs-r-atomic 부모가 가진다.
  // 잎만 연결하면 글자 몇 px만 눌려 사용자가 버튼이 고장 났다고 느낀다.
  return node.closest('button, [role="button"], [role="tab"], .bs-r-atomic') || node;
}

function wireStateControlActivation(node, activate, options = {}) {
  if (!node || typeof node.addEventListener !== 'function' || typeof activate !== 'function') return false;
  if (node.__athenaStateWired) return false;

  const tagName = String(node.tagName || '').toLowerCase();
  const role = typeof node.getAttribute === 'function'
    ? String(node.getAttribute('role') || '').toLowerCase()
    : '';
  const nativeSemantics = tagName === 'button' || role === 'button' || role === 'tab';
  if (options.keyboard && !nativeSemantics && !role && typeof node.setAttribute === 'function') {
    node.setAttribute('role', 'button');
    node.setAttribute('tabindex', '0');
    node.addEventListener('keydown', (event) => {
      if (!event || event.repeat || (event.key !== 'Enter' && event.key !== ' ')) return;
      if (typeof event.preventDefault === 'function') event.preventDefault();
      activate();
    });
  }
  node.addEventListener('click', () => activate());
  node.__athenaStateWired = true;
  return true;
}

// ---------- 반응형 훅 (인라인 원문 ↔ 컨테이너 쿼리) ----------
//
// 추출 원문은 영역 노드마다 인라인 `width`/`flex-*`를 갖는다(실측: 27장 전부).
// 인라인 선언은 어떤 CSS 규칙보다 세므로, 이걸 그대로 두면 컨테이너 쿼리가
// 레일 폭 하나 못 바꾼다. `!important`로 이기는 대신(계획 §3 금지) **딱 다섯 속성만**
// 같은 요소의 커스텀 속성으로 옮긴다. XL base 규칙이 그 값을 그대로 되돌려
// 계산값이 Paper와 같고, L 이하 컨테이너 규칙만 자유롭게 덮어쓴다.
// 색·패딩·글꼴·테두리·display는 손대지 않는다 — Paper의 레이아웃 모델은 그대로다.
// bs-kpi-cell은 영역이 아니라 영역 안에서 반복되는 칸이다. 칸마다 인라인 `width`가
// 박혀 있어(추출 원문 실측 138px) 그대로 두면 M 이하에서 3칸/2칸/1칸 흐름이 안 된다.
const RESPONSIVE_REGIONS = Object.freeze([
  'bs-workspace', 'bs-primary', 'bs-rail', 'bs-kpi', 'bs-kpi-cell', 'bs-table', 'bs-strip',
]);
// `height`도 함께 걷어낸다. 폭이 줄면 글자가 줄바꿈으로 내려가는데(한국어 원문은
// `overflow-wrap: anywhere`), Paper 원문은 영역마다 인라인 고정 높이를 싣는다
// (실측 2SKU-1 헤더 106px · KPI 줄 116px, 그리고 표 행마다). 폭만 걷어내면 좁은
// 창에서 늘어난 내용이 고정 높이 상자를 뚫고 나와 아래 영역과 **겹쳐** 읽힌다.
// 되돌리기 규칙이 XL에서 같은 값을 돌려주고, L 이하에서만 최소 높이로 바뀐다.
const HOISTED_PROPERTIES = Object.freeze([
  ['width', '--bs-width'],
  ['height', '--bs-height'],
  ['flex-basis', '--bs-flex-basis'],
  ['flex-grow', '--bs-flex-grow'],
  ['flex-shrink', '--bs-flex-shrink'],
]);

// 카드 껍데기(라운드·배경·테두리·그림자)는 **카드** 계약이지 보드 원문이 아니다.
// 생성물 96장 루트 실측: 라운드 28px 62장 · 16px 27장 · 24px 3장 · 미지정 4장,
// 배경 panel 92장 · 페이지 배경 4장. 카드 = 보드 그 자체이므로(board-surface.css
// "카드 = 보드 그 자체") 그 편차가 그대로 "카드마다 껍데기가 다르다"가 된다.
// 다섯 기하 속성과 같은 방식으로 걷어낸다 — 인라인은 !important 없이 못 이긴다.
// 옮긴 값은 원문 기록으로 남기고(진단·재추출 대조용) 계약은 CSS가 세운다.
const CARD_SHELL_PROPERTIES = Object.freeze([
  ['border-radius', '--bs-shell-radius'],
  ['background-color', '--bs-shell-bg'],
  ['border-width', '--bs-shell-border-width'],
  ['border-style', '--bs-shell-border-style'],
  ['border-color', '--bs-shell-border-color'],
  ['box-shadow', '--bs-shell-shadow'],
]);

// 카드 표면 패널의 원문 서명 — 인라인 폭 + 라운드 + 그림자 + 배경 네 개를 함께
// 싣는다(생성물 96장 실측: 이 넷을 다 가진 노드는 카드 표면 패널뿐이다).
function looksLikeCardPanel(el) {
  if (!el || !el.style || typeof el.style.getPropertyValue !== 'function') return false;
  return /^\d/.test(el.style.getPropertyValue('width').trim())
    && Boolean(el.style.getPropertyValue('border-radius').trim())
    && Boolean(el.style.getPropertyValue('box-shadow').trim())
    && Boolean(el.style.getPropertyValue('background-color').trim());
}

// 표면 루트 하나에만 적용한다 — 안쪽 섹션의 라운드·배경은 Paper 원문 그대로다
// (헌장 신념 1 "섹션마다 radius·shadow를 다시 주어 미니카드처럼 보이게 하지
// 않는다"는 원문 쪽 계약이고, 여기서 손대면 그 판정을 흐린다).
function normalizeCardShell(surface) {
  if (!surface || !surface.style || typeof surface.style.setProperty !== 'function') return false;
  if (surface.dataset && surface.dataset.bsCardShell === 'true') return false;
  // 루트에 폭이 없는 보드는 Paper **아트보드 프레임**이 루트로 잡힌 것이다
  // (실측 4장 — 폭 미지정 + 페이지 배경 + 프레임 패딩 40px). 폭 판정은 hoist가
  // 끝난 뒤라 `--bs-width`로 읽는다(원문 인라인 `width`는 이미 걷혀 있다).
  const isFrameRoot = !surface.style.getPropertyValue('--bs-width').trim();
  // 그 프레임이 카드 표면 패널을 **품고 있으면** 손대지 않는다(실측 1장 — R04
  // 펼침 상태: 프레임 > absolute 1440px 래퍼 > 카드 표면 1360px). 껍데기를 입히면
  // 안쪽 패널과 두 겹이 되고, 프레임 폭을 카드 폭으로 죄면 래퍼 1440px이 그대로
  // 가로 넘침이 된다(실측 82px). 이 한 장은 Paper 원본에서 루트를 카드 표면으로
  // 다시 그려야 풀린다 — 앱에서 흉내내면 프레임 사슬을 통째로 무너뜨려야 한다.
  if (isFrameRoot && typeof surface.querySelectorAll === 'function'
      && Array.from(surface.querySelectorAll('*')).some(looksLikeCardPanel)) {
    return false;
  }
  for (const [property, token] of CARD_SHELL_PROPERTIES) {
    const value = surface.style.getPropertyValue(property);
    if (!value) continue;
    surface.style.setProperty(token, value);
    surface.style.removeProperty(property);
  }
  // 패널 없는 프레임 루트(실측 3장)는 그 자체가 카드다. 그대로 두면
  // `.board-surface`의 1440px fallback이 서서 다른 92장보다 80px 넓은 카드가 되고,
  // 카드 폭만 세우면 프레임 패딩(40px)만큼 자식이 넘친다 — 자식은 이미 카드 폭
  // 1360px으로 서 있다. 그래서 폭과 패딩은 한 짝으로 움직인다(CSS가 함께 세운다).
  if (isFrameRoot) {
    const padding = surface.style.getPropertyValue('padding');
    if (padding) {
      surface.style.setProperty('--bs-shell-padding', padding);
      surface.style.removeProperty('padding');
    }
    if (surface.dataset) surface.dataset.bsCardFrame = 'true';
  }
  if (surface.dataset) surface.dataset.bsCardShell = 'true';
  return true;
}

function markElasticKpiValue(el) {
  if (!el || !el.dataset || !el.style) return;
  const classes = String(el.className || '').split(/\s+/);
  if (!classes.includes('bs-kpi-cell')) return;
  if (el.style.getPropertyValue('flex-basis').trim() !== '0%') return;
  if (el.style.getPropertyValue('flex-grow').trim() !== '1') return;
  // 시세 스트립의 빈 spacer도 같은 flex 값을 쓴다. 그 칸에 최소 폭을 주면
  // 6~8칸 보드가 L 컨테이너보다 넓어지므로 실제 값이 있는 탄력 칸만 표시한다.
  if (!String(el.textContent || '').trim()) return;
  el.dataset.bsKpiElastic = 'true';
}

// 글자를 이고 있는 KPI 칸 — 줄바꿈 정책이 켜지면 칸의 min-content가 「가장 긴 값
// 한 줄」이 된다. L 단계의 `[data-bs-hoisted] { min-width: 0 }`이 그 바닥을 놓아
// 버리므로, 칸은 0까지 줄고 안쪽 문면이 옆 칸 위로 흘러 겹쳐 읽힌다(실측 2QM7-2
// 히어로 칸 「모건스탠리 +842억원」 min-content ≈ 324px). 탄력 칸 전용 바닥
// (`data-bs-kpi-elastic`)은 이 칸을 못 덮는다 — 원문이 `flex-shrink: 0`이라서다.
// 빈 spacer는 계속 제외한다: 6~8칸 시세 스트립이 L 컨테이너보다 넓어지는 원인이다.
function markKpiContentFloor(el) {
  if (!el || !el.dataset) return;
  if (!String(el.className || '').split(/\s+/).includes('bs-kpi-cell')) return;
  if (!String(el.textContent || '').trim()) return;
  el.dataset.bsKpiContent = 'true';
}

// 글자 단위 분절을 켜는 인라인 선언만 걷어낸다(board-surface.css 「줄바꿈 정책」).
// 추출 원문 실측 97장 중 39장이 `overflow-wrap: anywhere`를 싣고, 36장은 보드 루트
// 한 곳에만, 3장(1JPU-0·1JZW-0·2TRW-1)은 13개 내외 노드에 싣는다. 인라인은
// !important 없이 못 이기므로 규칙으로 덮을 수 없다 — 지우는 것이 유일한 길이다.
// 다섯 레이아웃 속성과 달리 커스텀 속성으로 옮겨 두지 않는다: 되돌릴 값이 아니다.
// `anywhere` 외의 값(`break-word` 등)은 Paper가 고른 문면일 수 있으니 건드리지 않는다.
function stripCharacterWrap(el) {
  if (!el || !el.style || typeof el.style.getPropertyValue !== 'function') return false;
  if (el.style.getPropertyValue('overflow-wrap').trim() !== 'anywhere') return false;
  el.style.removeProperty('overflow-wrap');
  return true;
}

function pxNumber(value) {
  const match = /^(-?\d+(?:\.\d+)?)px$/.exec(String(value || '').trim());
  return match ? Number(match[1]) : null;
}

function paddingBottomPx(style) {
  const bottom = pxNumber(style.getPropertyValue('padding-bottom'));
  if (bottom != null) return bottom;
  const block = style.getPropertyValue('padding-block').trim();
  if (!block) return 0;
  const parts = block.split(/\s+/);
  return pxNumber(parts.length > 1 ? parts[1] : parts[0]) || 0;
}

// 하단 absolute 상자(실측 2RJ7-1 Chart Context Actions: bottom 18 · height 44)는
// 흐름에서 빠지므로 부모 padding-bottom(원문 22px)이 상자보다 작으면 흐름 안
// 이웃(「예상 체결 시간」 3A46-0)이 그 자리를 차지한다. hit test가 버튼이 아니라
// 이웃으로 간다. 부모를 상자 높이+bottom만큼 비워 겹침 자체를 없앤다 — z-index로
// 덮으면 겹침은 남고 클릭만 통해 헌장 §8에 어긋난다.
//
// 2RJ7-1 레일은 `align-items: start`라 두 열이 내용 높이(원문 420·401)로 선다.
// 고정 높이 558에서 padding-bottom을 62로 올리면 내용 상자 474 — 두 열은 그 안에
// 들어가므로 패딩 영역으로 흘러 바를 다시 덮지 않는다. 열을 514로 늘려 가정하면
// 안 된다.
function reserveParentBottom(el, reservePx) {
  const parent = el.parentElement;
  if (!parent || !parent.style || !parent.dataset) return;
  const pos = parent.style.getPropertyValue('position').trim();
  if (pos !== 'relative' && pos !== 'absolute') return;
  const current = paddingBottomPx(parent.style);
  const prev = pxNumber(parent.style.getPropertyValue('--bs-reserve-bottom'));
  const reserve = Math.max(reservePx, prev || 0);
  if (reserve <= current) return;
  const block = parent.style.getPropertyValue('padding-block').trim();
  if (block) {
    const top = block.split(/\s+/)[0];
    parent.style.removeProperty('padding-block');
    if (!parent.style.getPropertyValue('padding-top')) {
      parent.style.setProperty('padding-top', top);
    }
  }
  parent.style.setProperty('--bs-reserve-bottom', `${reserve}px`);
  parent.style.setProperty('padding-bottom', `${reserve}px`);
  parent.dataset.bsReserveBottom = 'true';
}

function markInsetAbsoluteBox(el) {
  if (!el || !el.dataset || !el.style) return;
  if (el.style.getPropertyValue('position').trim() !== 'absolute') return;
  const bottom = pxNumber(el.style.getPropertyValue('bottom'));
  const heightInline = pxNumber(el.style.getPropertyValue('height'));
  const height = heightInline != null
    ? heightInline
    : pxNumber(el.style.getPropertyValue('--bs-height'));
  if (bottom != null && height != null) {
    reserveParentBottom(el, bottom + height);
  }
  const left = el.style.getPropertyValue('left').trim();
  if (!left || !el.style.getPropertyValue('width').trim()) return;
  if (el.style.getPropertyValue('right').trim()) return;
  // left+고정폭인 absolute 상자(Paper 하단 액션·차트 툴팁 라벨)는 부모가 좁아져도
  // 자기 left에 그대로 서서 부모 패딩 상자 밖으로 나간다 — 실측 137X-2 33FX-0
  // (left 748px · width 148px)이 2·4분할·최소에서 303~547px 가로 넘침의 유일한 뿌리다.
  // 다른 다섯 속성과 같은 방식으로 걷어낸다: 인라인 `left`를 지워야 컨테이너 규칙이
  // 겨룰 수 있고(인라인은 !important 없이 못 이긴다), base 규칙이 XL에서 같은 값을
  // 그대로 되돌려 Paper 자리는 안 바뀐다.
  el.style.setProperty('--bs-inset-x', left);
  el.style.removeProperty('left');
  el.dataset.bsInsetX = 'true';
}

// 영역이 **세로로 쌓아 놓은** 줄인가. Paper는 필터·칩 줄을 영역 바로 아래에
// 두기도 하고(137X-2 Chart Toolbar) 세로 래퍼 한 겹을 끼우기도 한다(실측 30O1-0
// Quote Detail Mount > Frame > Mode Row). 둘은 같은 줄이므로 같은 규약을 받는다.
// 가로로 나뉜 칸 안(표 행의 셀 등)은 아니다: 위로 올라가다 세로 래퍼가 아닌 것을
// 만나면 멈추고, 표(열 폭이 계약이다)는 이름으로도 막는다.
//
// 경계는 primary만이 아니다. 스트립이 세로로 쌓은 칩 줄도 같은 모양이고(실측
// 2XTO-0 `2XWZ-0`·`2XWH-0` — `.bs-strip`(column) 아래 `space-between` 가로 줄),
// primary만 인정하면 그 줄은 접기 표시를 못 받는다. 그 결과 좁은 폭에서 칩 묶음이
// 스크롤 경계에서 잘리고 그 **바로 옆에** 형제 문구(`● 실시간 갱신`)가 간격 없이
// 붙어 겹쳐 읽힌다(실측 4분할 캡처 board-2XTO-0-640x540: 칩이 「예상차」로 잘린 자리).
// primary는 예전 그대로 무조건 경계다(기존 보드 판정을 안 바꾼다). 새로 인정하는
// 영역은 **세로로 쌓은 것만** 경계로 본다 — 가로로 나눈 영역의 칸은 줄이 아니다.
const REGION_STACK_BOUNDARY = Object.freeze([
  'bs-rail', 'bs-strip', 'bs-header', 'bs-footer',
]);

function inRegionColumnStack(el) {
  for (let node = el.parentElement; node; node = node.parentElement) {
    if (!node.classList) return false;
    // 영역이 스스로 표인 보드도 있다(실측 2SYW-1 Order Ledger `bs-primary bs-table`).
    // 그 경계에서 멈추는 것이 먼저다 — 영역 직속 요약 줄은 표 행이 아니다.
    if (node.classList.contains('bs-primary')) return true;
    if (node.classList.contains('bs-table')) return false;
    if (REGION_STACK_BOUNDARY.some((name) => node.classList.contains(name))) {
      return Boolean(node.style)
        && node.style.getPropertyValue('flex-direction').trim() === 'column';
    }
    if (!node.style) return false;
    if (node.style.getPropertyValue('flex-direction').trim() !== 'column') return false;
  }
  return false;
}

// primary가 이고 있는 줄 — Paper가 양끝으로 벌린(`space-between`) 가로 줄이다.
// 좁아지면 양쪽 묶음의 min-content 합이 그대로 가로 넘침이 된다: 표면 머리
// (.bs-header)가 M에서 접히는 것과 같은 이유이고, 실측 137X-2 Chart Toolbar가
// 최소 폭에서 149px을 냈다. 세로 줄(`flex-direction: column`)은 뺀다 — 세로 줄에
// flex-wrap을 주면 넘친 것이 오른쪽 새 열로 가서 오히려 가로 넘침이 된다.
function markSplitRow(el) {
  if (!el || !el.dataset || !el.style) return;
  if (el.style.getPropertyValue('display').trim() !== 'flex') return;
  if (el.style.getPropertyValue('justify-content').trim() !== 'space-between') return;
  if (el.style.getPropertyValue('flex-direction').trim() === 'column') return;
  if (!inRegionColumnStack(el)) return;
  el.dataset.bsSplitRow = 'true';
}

// 머리·스트립이 이고 있는 **가로 묶음**. `.bs-header`가 M부터 접혀도(board-surface.css)
// 그 안의 묶음이 한 줄을 고집하면 그만큼이 그대로 가로 넘침이 된다 — flex item 기본
// `min-width: auto`가 자식들의 min-content를 지키기 때문이다(실측 2XTO-0 `2XXN-0`
// 기능 네비 421px ↔ 컨테이너 378px에서 표면 37px, 최소 프리셋 3회 재현).
//
// 세로 묶음은 반드시 뺀다: 세로 줄에 `flex-wrap`을 주면 넘친 것이 오른쪽 새 열로
// 가서 오히려 가로 넘침이 된다(같은 판단이 markSplitRow에도 있다). CSS로는
// flex-direction을 고를 수 없으므로 여기서 가로인 것만 표시한다.
//
// 범위는 영역의 **직계 자식**이다. 머리·스트립은 자기 자신이 M부터 접히므로 방향을
// 안 보고, 나머지 영역은 **세로로 쌓을 때만** 경계로 본다 — 가로로 나눈 영역의
// 직계 자식은 줄이 아니라 칸이고, 칸을 접으면 칸이 아랫줄로 떨어진다
// (inRegionColumnStack과 같은 판단이다).
//
// 실측 2SKU-1: `.bs-primary`(세로) > `39QL-0` 「예수금 KPI 4칸」(가로 4칸). 이 줄은
// `.bs-kpi` 표시를 못 받아 3칸/2칸 흐름도, 칸 바닥도 없다. 그래서 칸이 91px로 눌리고
// 안쪽 문면이 53px 넘쳐 사슬로 표면 9px까지 올라왔다(4분할 2회 재현).
//
// 표는 어느 쪽에서도 제외한다 — 열 폭이 계약이다.
const WRAP_ROW_ALWAYS = Object.freeze(['bs-header', 'bs-strip']);
const WRAP_ROW_WHEN_COLUMN = Object.freeze(['bs-primary', 'bs-rail', 'bs-footer']);

// 영역 직계가 아닌 **더 깊은 가로 묶음**에도 같은 처방이 필요한 자리가 있다. 좁은
// 폭에서 안 줄어드는 줄이 거기 남는다 — flex item 기본 `min-width: auto`가 자식들의
// min-content를 지키기 때문이다(실측 2VDA-0 `3HKY-0` 459px ↔ 표면 375px: 「금현물」·
// 「순위」가 표면 밖으로 40·98px 나가 스크롤로도 닿지 않았다).
//
// 그렇다고 **구조만 보고 미리** 걸 수는 없다. 모든 깊이의 가로 묶음에 접기를 주면
// 접힘이 높이를 바꾸고 높이가 다시 폭 계약을 건드려 레이아웃이 정착하지 않는다
// (실측: 마운트 게이트가 카드 1종 14장에서 정착 한도 10초에 계속 걸려 7분을 넘겼다).
// 그래서 이 자리는 **재고 나서**만 손댄다 — :func:`relaxOverflowRows`.
function markWrapRow(el) {
  if (!el || !el.dataset || !el.style || !el.classList) return;
  if (el.style.getPropertyValue('display').trim() !== 'flex') return;
  if (el.style.getPropertyValue('flex-direction').trim() === 'column') return;
  if (el.classList.contains('bs-table')) return;
  const parent = el.parentElement;
  if (!parent || !parent.classList) return;
  if (parent.classList.contains('bs-table')) return;
  if (typeof el.closest === 'function'
    && el.closest('.bs-table, .bs-r-scroll, .bs-r-scroll-table')) return;
  const always = WRAP_ROW_ALWAYS.some((name) => parent.classList.contains(name));
  const whenColumn = WRAP_ROW_WHEN_COLUMN.some((name) => parent.classList.contains(name));
  if (!always && !whenColumn) return;
  if (!always && (!parent.style
    || parent.style.getPropertyValue('flex-direction').trim() !== 'column')) return;
  el.dataset.bsWrapRow = 'true';
  markElasticCells(el);
}

// 접기만으로는 안 되는 줄이 있다. 칸이 탄력(`flex-basis: 0%` + `flex-grow: 1`)이면
// 폭이 부족해도 각 칸이 0을 기준으로 남는 폭을 나눠 가지므로 **줄바꿈이 아예 발동하지
// 않는다**. 칸은 그대로 눌리고 안쪽 문면이 옆으로 흐른다.
//   · 실측 2SKU-1 「예수금 KPI 4칸」: 칸 91px 안에 내용 144px → 표면 9px
//   · 실측 2T63-1 「Order Progress」: 단계 묶음 361px가 90px로 눌려 번호와 라벨이 겹침
//     (`주문 작성`↔`2`, 5장 동일) — flow 트레잇을 줘도 접히지 않던 이유다
// 그 칸에는 자기 문면이 한 줄로 서는 바닥을 준다(`.bs-kpi-cell[data-bs-kpi-elastic]`과
// 같은 처방을, 영역 표시를 못 받은 줄까지 넓힌 것이다).
// 빈 spacer는 제외한다 — 바닥을 주면 줄이 되려 넓어진다.
// 인라인 값과 걷어낸 값을 함께 본다 — 이 판정은 hoist 전후 어디서든 불릴 수 있고,
// hoist가 인라인 `flex-basis`를 `--bs-flex-basis`로 옮긴 뒤에는 인라인이 비어 있다.
// 그걸 놓치면 표시가 조용히 안 붙는다(실측 2T63-1 계열 5장: flow를 줘도 안 접혔다).
function flexValueOf(el, property, token) {
  const inline = el.style.getPropertyValue(property).trim();
  return inline || el.style.getPropertyValue(token).trim();
}

function markElasticCells(owner) {
  for (const cell of elementChildren(owner) || []) {
    if (!cell || !cell.dataset || !cell.style) continue;
    if (flexValueOf(cell, 'flex-basis', '--bs-flex-basis') !== '0%') continue;
    if (flexValueOf(cell, 'flex-grow', '--bs-flex-grow') !== '1') continue;
    if (!String(cell.textContent || '').trim()) continue;
    cell.dataset.bsElasticCell = 'true';
  }
}

// Paper가 레이어 이름으로 「스크롤」이라고 선언한 상자는 실제로 스크롤해야 한다.
//
// 실측 1WOB-1 `1WST-1`(이름: "목록 본문 · 펼침 · 520px 스크롤")은 추출물이
// `height: 520px; overflow: clip`으로 나와, 실데이터가 실리면 내용 720px의 아래
// 200px이 **잘려서 안 보인다**(글자 64자리, 폭 4단계 전부). 디자인은 그 자리를
// 스크롤로 그렸고 추출이 그 뜻을 잃은 것이다. 그래서 세로만 스크롤로 돌린다 —
// 가로 계약(폭·overflow-x)은 그대로 두고, Paper 문면도 건드리지 않는다.
function markDeclaredScrollBox(el) {
  if (!el || !el.dataset || !el.style) return false;
  const name = el.dataset.name || '';
  if (!name.includes('스크롤')) return false;
  const overflowY = el.style.getPropertyValue('overflow-y').trim()
    || el.style.getPropertyValue('overflow').trim();
  if (overflowY !== 'clip' && overflowY !== 'hidden') return false;
  el.style.setProperty('overflow-y', 'auto');
  el.dataset.bsScrollDeclared = 'true';
  return true;
}

// 스크롤 소유자의 인라인 `overflow`는 정책을 이긴다 — 지워야 한다.
// 실측 133H-2 `14UQ-2`(보유 종목 표)는 Paper 원문에 `overflow: visible`을 싣고 있어
// `.bs-r-scroll-table { overflow-x: auto }`가 무력화됐다. 그 결과 표가 스크롤하지 않고
// 안쪽 semantics(844px)가 그대로 표면을 뚫었다(560px에서 313px · 380px에서 493px).
// stripCharacterWrap과 같은 규약이다: 정책이 이겨야 하는 인라인 선언은 되돌리지 않고
// 지운다. `hidden`·`auto`처럼 이미 자르는 값은 Paper가 고른 문면이므로 건드리지 않는다.
function stripScrollOwnerOverflow(el) {
  if (!el || !el.style || !el.classList) return false;
  if (!el.classList.contains('bs-r-scroll') && !el.classList.contains('bs-r-scroll-table')) {
    return false;
  }
  let stripped = false;
  for (const property of ['overflow', 'overflow-x']) {
    if (el.style.getPropertyValue(property).trim() !== 'visible') continue;
    el.style.removeProperty(property);
    stripped = true;
  }
  return stripped;
}

// 세로로 쌓는 부모 아래 놓인 상자. flex-shrink는 **주축** 속성이라 부모가 column이면
// 폭이 아니라 높이를 줄인다: 좁은 단계에서 원문의 `flex-shrink: 0`을 놓아주면
// (board-surface.css L 단계) 고정 높이가 바닥이라는 계약이 세로로만 뒤집혀, 늘어난
// 내용이 상자를 그대로 뚫는다(실측 1WOB-1 목록 본문 520px 안 행 20개: 내용 48px가
// 36px 행으로 눌려 13px 넘침). 부모가 세로면 원문 flex-shrink를 그대로 지킨다 —
// 폭은 `--bs-width`와 `max-width: 100%`가 맡으므로 가로 계약은 그대로다.
function markColumnStackItem(el) {
  if (!el || !el.dataset) return;
  const parent = el.parentElement;
  if (!parent || !parent.style) return;
  if (parent.style.getPropertyValue('display').trim() !== 'flex') return;
  if (parent.style.getPropertyValue('flex-direction').trim() !== 'column') return;
  el.dataset.bsColItem = 'true';
}

function hoistLayout(el) {
  if (!el || !el.style || typeof el.style.setProperty !== 'function') return false;
  if (el.dataset && el.dataset.bsHoisted === 'true') return false;
  markElasticKpiValue(el);
  markKpiContentFloor(el);
  markInsetAbsoluteBox(el);
  markSplitRow(el);
  markWrapRow(el);
  markColumnStackItem(el);
  for (const [property, token] of HOISTED_PROPERTIES) {
    const value = el.style.getPropertyValue(property);
    if (!value) continue;
    el.style.setProperty(token, value);
    el.style.removeProperty(property);
  }
  if (el.dataset) el.dataset.bsHoisted = 'true';
  return true;
}

// 영역 밖 고정 상자 — 표 열 폭·KPI 칸·헤더 블록. 실보드 6장 실측(px 폭 노드
// 2SKU-1 75 · 2R3M-1 106 · 13BC-2 116 · 2QFO-2 155 · 13K0-2 91 · 135M-2 16)에서
// 영역 노드는 2~7개뿐이고 나머지는 전부 class 없는 안쪽 상자다. 게다가 그 상자들은
// 인라인 `flex-shrink: 0`을 함께 싣는다(보드당 23~178건) — 영역만 걷어내면 안쪽
// 고정 폭이 그대로 버텨 컨테이너가 줄어도 열이 안 줄고 가로 넘침이 남는다
// (실측 overflow_x: 컨테이너 1171px에서 89~5,659px).
//
// 그래서 인라인 선언을 **실제로 들고 있는** 노드만 추가로 걷어낸다. 아무것도 안
// 옮긴 노드에는 표시를 남기지 않는다 — 표시가 곧 되돌리기 규칙의 적용 범위다
// (board-surface.css `[data-bs-hoisted]`가 다섯 속성을 그대로 되돌린다).
function hoistRigidBox(el) {
  if (!el || !el.style || typeof el.style.setProperty !== 'function') return false;
  if (el.dataset && el.dataset.bsHoisted === 'true') return false;
  markInsetAbsoluteBox(el);
  markSplitRow(el);
  markWrapRow(el);
  markColumnStackItem(el);
  let moved = false;
  for (const [property, token] of HOISTED_PROPERTIES) {
    const value = el.style.getPropertyValue(property);
    if (!value) continue;
    el.style.setProperty(token, value);
    el.style.removeProperty(property);
    moved = true;
  }
  if (moved && el.dataset) el.dataset.bsHoisted = 'true';
  return moved;
}

// 병기 줄이 앉는 칸 — 추출기는 접힌 열의 사본(`.bs-paired`)을 행의 **둘째 칸**에
// 넣는다(paper_board_extract.apply_column_collapse). 그 칸이 세로로 쌓는 칸이면
// 사본은 그대로 아랫줄이 되지만, 가로 칸이면 옆으로 늘어서서 칸을 밀어낸다
// (실측 2TZN-1 업종 행 둘째 칸 58px 안에 병기 4줄 — 최소 폭에서 표면 66px 넘침).
// 가로 칸만 표시해 두고, 좁은 단계에서 사본을 아랫줄로 내린다.
function markPairedHost(surface) {
  let marked = 0;
  for (const pair of surface.querySelectorAll('.bs-paired')) {
    const host = pair.parentElement;
    if (!host || !host.dataset || !host.style) continue;
    if (host.dataset.bsPairedHost === 'true') continue;
    if (host.style.getPropertyValue('display').trim() !== 'flex') continue;
    if (host.style.getPropertyValue('flex-direction').trim() === 'column') continue;
    host.dataset.bsPairedHost = 'true';
    marked += 1;
  }
  return marked;
}

// 한 가로줄 안에 일반 섹션과 primary를 나란히 둔 Paper 보드가 있다(3GRO-0
// `3I8P-0`: 주문 한도 재원 + 구간별 재사용). M 단계의 일반 `.bs-primary` 규칙은
// 뒤 섹션에 폭 100%를 주므로, 부모가 nowrap이면 그 섹션이 0px까지 눌리고 끝 정렬
// 문구가 카드 왼쪽으로 샌다. 최상위 workspace는 이미 M에서 자체 wrap 계약을 가지므로
// 제외하고, 중첩 primary에 실제 형제가 있는 부모만 표시해 M 이하에서 섹션을 쌓는다.
function markPrimaryRows(surface) {
  let marked = 0;
  for (const primary of surface.querySelectorAll('.bs-primary')) {
    const row = primary.parentElement;
    if (!row || !row.dataset || !row.style) continue;
    if (row.classList && row.classList.contains('bs-workspace')) continue;
    if (row.style.getPropertyValue('display').trim() !== 'flex') continue;
    const direction = row.style.getPropertyValue('flex-direction').trim();
    if (direction === 'column' || direction === 'column-reverse') continue;
    if (elementChildren(row).length < 2 || row.dataset.bsPrimaryRow === 'true') continue;
    row.dataset.bsPrimaryRow = 'true';
    marked += 1;
  }
  return marked;
}

function applyResponsiveHooks(surface) {
  stripCharacterWrap(surface);
  hoistLayout(surface);
  // 껍데기는 기하 hoist **뒤에** 본다 — 프레임 판정이 `--bs-width`를 읽는다.
  normalizeCardShell(surface);
  let hoisted = 1;
  for (const region of RESPONSIVE_REGIONS) {
    for (const el of surface.querySelectorAll(`.${region}`)) {
      if (hoistLayout(el)) hoisted += 1;
    }
  }
  // 표면 전체를 훑는다. `data-node`만 보면 손으로 쓴 계약의 구조 노드(픽스처
  // board.html의 `.bs-header` 등)를 놓친다 — 거기에도 고정 폭이 산다.
  // 인라인 선언이 없는 노드는 hoistRigidBox가 그대로 지나간다.
  // stripCharacterWrap은 hoistRigidBox의 조기 반환(이미 걷어낸 노드)과 무관하게
  // 돌아야 한다 — 영역 노드가 `anywhere`를 함께 이고 있는 보드가 3장 있다.
  for (const el of surface.querySelectorAll('*')) {
    stripCharacterWrap(el);
    if (hoistRigidBox(el)) hoisted += 1;
  }
  // 추출기가 붙인 트레잇 소유자를 마무리한다. hoist 순회와 분리해야 한다:
  // 소유자는 인라인 기하가 없어 hoistRigidBox가 그대로 지나가는 노드일 수 있다.
  for (const owner of surface.querySelectorAll('.bs-r-scroll, .bs-r-scroll-table')) {
    stripScrollOwnerOverflow(owner);
    if (surface.dataset?.bsBoardId === '133H-2' && owner.getAttribute('data-node') === '14UQ-2'
      && owner.classList.contains('bs-r-scroll-table')
      && !owner.nextElementSibling?.classList.contains('bs-readable-hint')) {
      const hint = layoutGroup(surface.ownerDocument, 'bs-readable-hint');
      hint.textContent = '표를 좌우로 이동해 모든 열을 확인하세요';
      owner.after(hint);
    }
  }
  // Paper 이름이 스크롤이라고 적힌 상자를 실제로 스크롤시킨다(위 주석의 1WOB-1).
  for (const box of surface.querySelectorAll('[data-name]')) {
    markDeclaredScrollBox(box);
  }
  // 접기 소유자의 탄력 자식에도 바닥을 준다 — flow는 `flex-wrap`만 주고, 칸이
  // 탄력이면 그 wrap이 발동하지 않는다(markElasticCells 주석의 2T63-1 실측).
  for (const owner of surface.querySelectorAll('.bs-r-flow')) {
    markElasticCells(owner);
  }
  markPairedHost(surface);
  markPrimaryRows(surface);
  return hoisted;
}

// 실측으로 확인한 표만 보정한다. 원본 잎을 옮겨 슬롯·상태 조작은 유지한다.
const READABLE_TABLES = {
  "2YNQ-0": {"node":"3721-0","rows":["3726-0","372E-0","372W-0","373E-0","373W-0","374E-0"],"widths":[70,220,170,170,220,210],"label":"조회 결과","stack":false,"compact":true},
  "2YJ8-0": {"node":"36QC-0","rows":["36QH-0","36QP-0","36R5-0","36RL-0","36S1-0","36SH-0"],"widths":[0,220,170,130,210,210,0],"label":"조회 결과","stack":false,"compact":true},
  "2YEQ-0": {"node":"36JX-0","rows":["36K2-0","36KA-0","36KQ-0","36L6-0","36LM-0","36M2-0"],"widths":[0,220,170,130,210,210,0],"label":"조회 결과","stack":false,"compact":true},
  "2YA8-0": {"node":"36EP-0","rows":["36EU-0","36F2-0","36FI-0","36FY-0","36GE-0","36GU-0"],"widths":[0,220,170,130,210,210,0],"label":"조회 결과","stack":false,"compact":true},
  "2XP6-0": {"node":"3FC5-0","rows":["3FCA-0","3FCI-0","3FCY-0","3FDE-0","3FDU-0","3FEA-0"],"widths":[0,220,170,130,180,210,210],"label":"조회 결과","stack":false,"compact":true},
  "2XKO-0": {"node":"3DRG-0","rows":["3DRL-0","3DRT-0","3DSC-0","3DSV-0","3DTE-0","3DTX-0"],"widths":[0,220,170,130,180,210,140],"label":"조회 결과","stack":false,"compact":true},
  "2XG6-0": {"node":"352Q-0","rows":["352V-0","3533-0","353J-0","353Z-0","354F-0","354V-0"],"widths":[0,220,170,0,180,0,0],"label":"조회 결과","stack":false,"compact":true},
  '30HY-0': {"node":"34IW-0","rows":["34IX-0","34JR-0","34J6-0","34KC-0","34S0-0","34SL-0","34T6-0","34VB-0","34VW-0"],"widths":[80,240,0,210,210,210,200,0],"label":"외국인·기관 순위","stack":false,"compact":true},
  '3UTA-0': {"node":"3V3D-0","rows":["3V3G-0","3V3K-0","3V3O-0","3V3S-0","3V3W-0","3V40-0","3V44-0","3V48-0","3V4C-0","3V4G-0"],"widths":[180,200,150],"label":"대출·신용 상세","stack":false,"compact":true,"additional":[{"node":"3V4K-0","rows":["3V4N-0","3V4R-0","3V4V-0","3V4Z-0","3V53-0","3V57-0","3V5B-0","3V5F-0","3V5J-0"],"widths":[180,200,150],"label":"대출·신용 상세","stack":false,"compact":true},{"node":"3V5P-0","rows":["3V5S-0","3V5W-0","3V60-0","3V64-0","3V68-0","3V6C-0","3V6G-0"],"widths":[180,200,150],"label":"대출·신용 상세","stack":false,"compact":true},{"node":"3V6K-0","rows":["3V6N-0","3V6R-0","3V6V-0","3V6Z-0","3V73-0"],"widths":[180,200,150],"label":"대출·신용 상세","stack":false,"compact":true}]},
  '3NVG-0': {"node":"3P9I-0","rows":["3P9M-0","3P9W-0","3PA8-0"],"widths":[160,200,200,200,200],"label":"통화별 예수금","stack":false,"compact":true},
  "13K0-2": {"node":"33Z2-0","rows":["33Z6-0","33ZD-0","33ZO-0","33ZZ-0"],"widths":[0,220,106,86,160,216],"label":"조회 순위 결과","stack":false,"compact":true,"additional":[{"node":"33WD-0","rows":["33WI-0","33WQ-0","33X6-0","33XM-0","33Y2-0","33YI-0"],"widths":[100,200,160,100,165,190,0],"label":"거래대금 상위","stack":false}]},
  "15P5-2": {"node":"3D17-0","rows":["3D1B-0","3D22-0","3D2M-0","3D35-0","3D3O-0"],"widths":[130,160,200,140,120,120,120,140],"label":"조회 상세 내역","stack":false,"compact":true,"additional":[{"node":"3CCM-0","rows":["3CCQ-0","3CFC-0","3CJ3-0","3CJH-0","3CJV-0"],"widths":[52,220,200,140,200],"label":"ELW 종목 시세","stack":false,"compact":true}]},
  "2RJ7-1": {"node":"3HC9-0","rows":["3HCF-0","3HCO-0","3HDD-0","3HE2-0","3HER-0"],"widths":[150,200,200,200,200,200,200,200],"label":"조회 상세 내역","stack":false,"compact":true},
  "2ROJ-1": {"node":"33JM-0","rows":["33JN-0","33JV-0","33KB-0","33KQ-0"],"widths":[120,200,200,200,200,0],"label":"조회 상세 내역","stack":false,"compact":true,"additional":[{"node":"2RQD-1","rows":["33RX-0","33SM-0","33TX-0","33U8-0","33UJ-0","33UU-0","33V5-0"],"widths":[110,200,200,220,120,110,110],"label":"프로그램 시간대별 조회","stack":false,"compact":true}]},
  "2S4E-1": {"node":"2S68-1","rows":["33M0-0","33M8-0","33R1-0","33RH-0","33S6-0","33SX-0"],"widths":[130,160,200,200,200,120],"label":"조회 상세 내역","stack":false,"compact":true},
  "2SYW-1": {"node":"3Q8R-0","rows":["3Q9T-0","3QA1-0","3QAS-0","3QBH-0","3QC6-0","3QCV-0"],"widths":[120,220,120,200,160,200,120],"label":"조회 상세 내역","stack":false,"compact":true},
  "2TZN-1": {"node":"2U3G-1","rows":["340B-0","340J-0","3411-0","341J-0","3421-0","342J-0","3431-0"],"widths":[220,120,160,140,200,155,140],"label":"조회 상세 내역","stack":false,"compact":true},
  "2U5L-1": {"node":"3C0K-0","rows":["3C0L-0","3C5D-0","3CFR-0","3CGS-0","3CHT-0","3CNW-0","3COV-0","3CPU-0","3CQT-0"],"widths":[220,160,160,160,160,240,200],"label":"조회 상세 내역","stack":false,"compact":true},
  "2UBO-1": {"node":"34AI-0","rows":["34AM-0","34AT-0","34BA-0","34BR-0"],"widths":[220,160,220,200,200,200],"label":"조회 상세 내역","stack":false,"compact":true},
  "2UHM-1": {"node":"2ULF-1","rows":["359Q-0","359Y-0","35AN-0","35BC-0"],"widths":[120,220,180,140,160,200,120],"label":"조회 상세 내역","stack":false,"compact":true},
  "2VIN-0": {"node":"3QN3-0","rows":["3QN4-0","3QND-0","3QO4-0","3QOV-0","3QPM-0","3QQD-0","3QR4-0","3QRV-0","3QSM-0","3QTD-0","3QU4-0","3QUV-0","3QVM-0","3QWD-0","3QX4-0","3QXV-0","3QYM-0","3QZD-0","3R04-0","3R0V-0","3R1M-0"],"widths":[0,220,160,140,140,200,140,0],"label":"ETF 전체 시세","stack":false,"compact":true},
  "2VO0-0": {"node":"38TO-0","rows":["38TP-0","38TY-0","38UH-0","38V0-0","38VJ-0","38W2-0","38WL-0","38X4-0","38XN-0","3GLC-0","3GLV-0","3GME-0","3GMX-0","3GNG-0","3GNZ-0","3GOI-0","3GP1-0","3GPK-0","3GQ3-0","3GQM-0","3GR5-0"],"widths":[52,220,160,200,200,200,0,0],"label":"조회 순위 결과","stack":false,"compact":true},
  "2XA5-0": {"node":"39FH-0","rows":["39FI-0","39FR-0","39GA-0","39GT-0","39HC-0","39HV-0","39IE-0","39IX-0","39JG-0","3HZP-0","3I08-0","3I0R-0","3I1A-0","3I1T-0","3I2C-0","3I2V-0","3I3E-0","3I3X-0","3I4G-0","3I4Z-0","3I5I-0"],"widths":[52,220,160,140,200,200,0,0],"label":"조회 순위 결과","stack":false,"compact":true},
  "2XY6-0": {"node":"39V5-0","rows":["39V6-0","39VF-0","39VY-0","39WH-0","39X0-0","39Y2-0","39YL-0","39Z4-0","3KGH-0","3KH0-0","39XJ-0","3KHJ-0","3KI2-0","3KIL-0","3KJ4-0","3KJN-0","3KK6-0","3KKP-0","3KL8-0","3KLR-0","3KMA-0"],"widths":[52,220,160,140,160,200,0,0],"label":"조회 순위 결과","stack":false,"compact":true},
  "2Y47-0": {"node":"3A9M-0","rows":["3A9N-0","3A9W-0","3AAF-0","3AAY-0","3ABH-0","3AC0-0","3ACJ-0","3AD2-0","3ADL-0","3MBF-0","3MBY-0","3MCH-0","3MD0-0","3MDJ-0","3ME2-0","3MEL-0","3MF4-0","3MFN-0","3MG6-0","3MGP-0","3MH8-0"],"widths":[52,220,160,160,160,200,0,0],"label":"조회 순위 결과","stack":false,"compact":true},
  "2YXS-0": {"node":"3G5L-0","rows":["3G5M-0","3G5V-0","3G6I-0","3G75-0","3G7S-0","3G8F-0","3G92-0","3G9P-0","3GAC-0","3GAZ-0","3GBM-0","3GC9-0","3GCW-0","3GDJ-0","3GE6-0","3GET-0","3GFG-0","3GG3-0","3GGQ-0","3GHD-0"],"widths":[0,220,160,0,200,160,200,120],"label":"조회 순위 결과","stack":false,"compact":true},
  "2ZHC-0": {"node":"3IYO-0","rows":["3IYP-0","3IZJ-0","3J04-0","3J0P-0","3J2G-0","3J1A-0","3J1V-0","3J31-0","3IYY-0","3J3M-0","3J47-0","3J4S-0","3J5D-0","3J5Y-0","3J6J-0","3J74-0","3J7P-0","3J8A-0","3J8V-0","3J9G-0","3JA1-0"],"widths":[0,220,160,0,160,160,200,0],"label":"조회 순위 결과","stack":false,"compact":true},
  "2ZN9-0": {"node":"3B82-0","rows":["3B83-0","3B8C-0","3B8X-0","3B9I-0","3BA6-0","3BAR-0","3BBC-0","3BBX-0","3BCI-0"],"widths":[0,220,200,0,200,200,160,160],"label":"조회 순위 결과","stack":false,"compact":true},
  "2ZZ7-0": {"node":"3KPB-0","rows":["3KPC-0","3KPL-0","3KQ2-0","3KQJ-0","3KR0-0","3KRH-0","3KRY-0","3KSF-0","3KSW-0","3KTD-0","3KTU-0","3KUB-0","3KUS-0","3KV9-0","3KVQ-0","3KW7-0","3KWO-0"],"widths":[0,220,160,140,160,200,0,0],"label":"조회 순위 결과","stack":false,"compact":true},
  "30O1-0": {"node":"3RJU-0","rows":["3RJV-0","3RK4-0","3RKN-0","3RL6-0","3RLP-0","3RM8-0","3RMR-0","3RNA-0","3RNT-0","3ROC-0","3ROV-0","3RPE-0","3RPX-0","3RQG-0","3RQZ-0","3RRI-0","3RS1-0","3RSK-0","3RT3-0","3RTM-0"],"widths":[0,220,160,160,200,200,120,120],"label":"조회 순위 결과","stack":false,"compact":true},
  "30ZW-0": {"node":"3R7U-0","rows":["3R7V-0","3R84-0","3R8P-0","3R9A-0","3R9V-0","3RAG-0","3RB1-0","3RBM-0","3RC7-0","3RCS-0","3RDD-0","3RDY-0","3REJ-0","3RF4-0","3RFP-0","3RGA-0","3RGV-0","3RHG-0","3RI1-0","3RIM-0"],"widths":[0,220,160,120,0,0,200,0],"label":"조회 순위 결과","stack":false,"compact":true},
  "316O-0": {"node":"3NJL-0","rows":["3NJM-0","3NJV-0","3NKC-0","3NKT-0","3NLA-0","3NLR-0","3NM8-0","3NMP-0","3NN6-0","3NNN-0","3NO4-0","3NOL-0","3NP2-0","3NPJ-0","3NQ0-0","3NQH-0","3NQY-0","3NRF-0","3NRW-0","3NSD-0","3NSU-0"],"widths":[0,220,160,160,0,200,140,0],"label":"조회 순위 결과","stack":false,"compact":true},
  "31CL-0": {"node":"37AW-0","rows":["37AX-0","37B6-0","37BR-0","37CC-0","37L8-0","37LT-0","37ME-0","37MZ-0","37NK-0"],"widths":[80,240,170,260,260,260,340,180],"label":"조회 순위 결과","stack":false,"compact":true},
  "31II-0": {"node":"3ARB-0","rows":["3ARC-0","3ARL-0","3AS8-0","3ASV-0","3T6K-0","3T78-0","3T7V-0"],"widths":[52,220,160,120,160,140,200,120],"label":"조회 순위 결과","stack":false,"compact":true},
  "31OF-0": {"node":"3A7P-0","rows":["3A7Q-0","3A7Z-0","3A8E-0","3A8T-0","3AF3-0","3AFI-0","3AFX-0","3AGC-0","3AGR-0"],"widths":[52,220,160,160,140,140,140,200],"label":"조회 순위 결과","stack":false,"compact":true},
  "3JZ3-0": {"node":"3KFV-0","rows":["3KFW-0","3L2Y-0","3L2O-0","3L2E-0","3L24-0","3L1U-0","3L0S-0","3L0I-0","3L08-0","3KZY-0","3KZO-0","3L38-0","3L7D-0","3L7N-0","3L7X-0","3L87-0","3L8H-0","3LAV-0","3LB5-0","3LBF-0","3LBP-0","3LBZ-0","3LC9-0"],"widths":[120,160,200,132,132,122,200],"label":"조회 상세 내역","stack":false,"compact":true},
  "3OIM-0": {"node":"3SUJ-0","rows":["3SUQ-0","3SUY-0","3SVJ-0","3SW5-0"],"widths":[130,220,120,200,200,120,120],"label":"조회 상세 내역","stack":false,"compact":true},
  "3TCO-0": {"node":"3TEG-0","rows":["3TIB-0","3THO-0","3TH1-0","3TGE-0","3TFR-0","3TF4-0","3TEH-0","3TKQ-0","3TLD-0","3TM0-0","3TMN-0","3TNA-0","3TNX-0"],"widths":[52,220,160,120,160,140,200,120],"label":"조회 순위 결과","stack":false,"compact":true},
  '2VDA-0': {"node":"3HMX-0","rows":["3HMY-0","3HN7-0","3HNO-0","3HO5-0","3HOM-0","3HP3-0","3HPK-0","3HQ1-0","3HQI-0","3HQZ-0","3HRG-0","3HRX-0","3HSE-0","3HSV-0","3HTC-0","3HTT-0","3HUA-0","3HUR-0","3HV8-0","3HVP-0","3HW6-0"],"widths":[0,220,150,0,170,210,0,0],"label":"종목 순위 결과","stack":false,"compact":true},
  "3K7K-0": {"node":"3L4J-0","rows":["3L4N-0","3L8Y-0","3L93-0","3L98-0","3L9D-0","3L9I-0","3L9N-0","3L9S-0","3L9X-0","3LA2-0","3LD0-0","3LD5-0","3LDA-0","3LDF-0","3LDK-0"],"widths":[244,200,200,200],"label":"월별 자산·부채 구성","stack":false,"compact":true},
  "2SRV-1": {"node":"3IFY-0","rows":["3IGJ-0","3JDD-0","3JDY-0","3JEJ-0","3JF4-0","3JGA-0","3JGV-0","3JHG-0"],"widths":[112,190,180,130,205,228],"label":"일자별 실현손익","stack":false,"compact":true},
  "2SKU-1": {"node":"39SW-0","widths":[112,160,160,160,160,160,160],"label":"결제 예정","rows":["39SX-0","39T5-0","39TD-0","39TL-0"],"stack":false,"compact":true,"additional":[{"node":"3A4F-0","widths":[130,150,340,190,190],"label":"입출금 내역","rows":["3A4G-0","3A4M-0","3A51-0","3A5G-0","3G1S-0","3G2A-0","3G2T-0","3GKQ-0"],"stack":false,"compact":true}]},
  "3GRO-0": {"node":"3I8U-0","widths":[110,180,180,180],"label":"증거금율 구간별 주문가능","rows":["3I8V-0","3I93-0","3I9B-0","3I9J-0","3I9R-0","3I9Z-0","3IA7-0","3IAF-0"],"stack":false,"compact":true,"additional":[{"node":"3IAR-0","widths":[110,200,180,180,180],"label":"보증금율 구간별 주문가능","rows":["3IAS-0","3IB2-0","3IBC-0","3IBM-0","3IBW-0"],"stack":false,"compact":true}]},
  "3IGR-0": {"node":"3U6J-0","widths":[170,190,190],"label":"신용·추가 담보","rows":["3U6K-0","3U6Q-0","3U6W-0","3U72-0"],"stack":false,"compact":true},
  '32XM-0': { node: '3RU8-0', rows: ['3RU9-0', '3RUI-0', '3RV1-0', '3RVK-0', '3RW3-0', '3RWM-0', '3RX5-0', '3RXO-0', '3RY7-0', '3RYQ-0', '3RZ9-0', '3RZS-0', '3S0B-0', '3S0U-0', '3S1D-0'], widths: [52, 220, 130, 130, 170, 170, 0, 0], label: '신주인수권 조회 목록', stack: false, compact: true },
  "2X5N-0": {"node":"34X2-0","rows":["34X7-0","34XF-0","34XV-0","34YB-0","34YR-0","34Z7-0"],"widths":[0,220,170,130,180,210,0],"label":"조회 결과","stack":false,"compact":true,"additional":[{"node":"34ZR-0","rows":["34ZV-0","3501-0","3507-0","350D-0"],"widths":[100,160,140,140,180],"label":"세션별 거래 내역","compact":true}]},
  '30C1-0': { node: '3LY6-0', rows: ['3LY7-0', '3LYG-0', '3LYZ-0', '3LZI-0', '3M01-0', '3M0K-0', '3M13-0', '3M1M-0', '3M25-0', '3M2O-0', '3M37-0', '3M3Q-0', '3M49-0', '3M4S-0', '3M5B-0', '3M5U-0', '3M6D-0', '3M6W-0', '3M7F-0', '3M7Y-0', '3M8H-0'], widths: [0, 190, 130, 160, 140, 210, 0, 0], label: '거래량 갱신 결과', stack: false, compact: true },
  '15R0-2': { node: '170E-2', rows: ['36HF-0', '36IS-0', '36J5-0', '36JI-0'], widths: [190, 90, 140, 120], label: 'VI 영향 종목', stack: false, compact: true },
  "3FR6-0": {"node":"3T8I-0","rows":["3T8S-0","3T91-0","3T9C-0","3T9M-0","3T9W-0","3TA6-0","3TAG-0","3TAQ-0","3TB0-0","3TBA-0","3TBK-0","3TBU-0","3TC4-0","3TCE-0"],"widths":[210,130,130,130,130,190,0],"label":"분봉 표","stack":false,"compact":true,"additional":[{"node":"3SP2-0","rows":["3SP7-0","3SPG-0","3SPR-0","3SQ1-0"],"widths":[120,130,130,130,130,190,200],"label":"일자별 시세","stack":false,"compact":true}]},
  "15N5-2": {"node":"3CXU-0","rows":["3CXV-0","3CY4-0","3CYR-0","3CZE-0"],"widths":[112,130,130,180,190,0,0,130],"label":"ETF 시간대별 시세","stack":false,"compact":true,"additional":[{"node":"3D05-0","rows":["3D06-0","3D0C-0","3D0M-0","3D0W-0"],"widths":[120,130,120,180,190],"label":"ETF 일별 시세","stack":false,"compact":true}]},
  "3ODO-0": {"node":"3P48-0","rows":["3P4C-0","3P4J-0","3P51-0","3P5I-0"],"widths":[120,150,190,190,190,100],"label":"금현물 거래내역","stack":false,"compact":true,"additional":[{"node":"3P3G-0","rows":["3P3K-0","3P3R-0"],"widths":[190,190,190,190,190,130],"label":"금현물 잔고","stack":false,"compact":true}]},
  "3063-0": {"node":"35L4-0","rows":["35L5-0","35M1-0","35MO-0","35UQ-0","35VD-0","35W0-0","35LE-0","35WN-0","35XA-0"],"widths":[0,240,0,200,200,200,0,0],"label":"요청 주체의 매매","stack":false,"compact":true,"additional":[{"node":"3TYN-0","rows":["3TYO-0","3TYT-0","3TZ4-0","3TZF-0","3TZQ-0"],"widths":[240,200,200,200],"label":"첫3개 조회 종목","stack":false,"compact":true}]},
  "30TY-0": {"node":"362Z-0","rows":["3630-0","3639-0","363U-0","364F-0","3650-0","36A6-0","36AR-0","36BC-0","36BX-0"],"widths":[80,240,170,240,180,180,240,0],"label":"순위 결과","stack":false,"compact":true},
  '4A9H-1': {"node":"4ABV-1","rows":["4AE9-1","4ADS-1","4ADC-1","4ACW-1","4ACG-1","4AC0-1"],"widths":[52,190,130,110,190,210,130],"label":"필터 결과","stack":false,"compact":true,"additional":[{"node":"4AB3-1","rows":["4ABM-1","4ABG-1","4ABA-1","4AB4-1"],"widths":[150,200,120,140,264],"label":"세션별 거래","stack":false,"compact":true}]},
  '4AGN-1': {"node":"4AJB-1","rows":["4ALP-1","4AL8-1","4AKS-1","4AKC-1","4AJW-1","4AJG-1"],"widths":[52,190,130,110,190,210,130],"label":"필터 결과","stack":false,"compact":true,"additional":[{"node":"4AIJ-1","rows":["4AJ2-1","4AIW-1","4AIQ-1","4AIK-1"],"widths":[150,200,120,140,264],"label":"세션별 거래","stack":false,"compact":true}]},
  '4ANS-1': {"node":"4AQG-1","rows":["4ASU-1","4ASD-1","4ARX-1","4ARH-1","4AR1-1","4AQL-1"],"widths":[52,190,130,110,190,210,130],"label":"필터 결과","stack":false,"compact":true,"additional":[{"node":"4APO-1","rows":["4AQ7-1","4AQ1-1","4APV-1","4APP-1"],"widths":[150,200,120,140,264],"label":"세션별 거래","stack":false,"compact":true}]},
  '4AUX-1': {"node":"4AXL-1","rows":["4AZZ-1","4AZI-1","4AZ2-1","4AYM-1","4AY6-1","4AXQ-1"],"widths":[52,190,130,110,190,210,130],"label":"필터 결과","stack":false,"compact":true,"additional":[{"node":"4AWT-1","rows":["4AXC-1","4AX6-1","4AX0-1","4AWU-1"],"widths":[150,200,120,140,264],"label":"세션별 거래","stack":false,"compact":true}]},
  '2YS8-0': {"node":"39D6-0","rows":["39D7-0","39DG-0","39E4-0","39ES-0","39M7-0","39MV-0","39NJ-0","39O7-0","39OV-0"],"widths":[70,240,170,140,0,0,0,170],"label":"신용비율 순위","stack":false,"compact":true},
  '2ZBB-0': {"node":"384C-0","rows":["384D-0","384M-0","3857-0","385S-0","389D-0","389Y-0","38AJ-0","38B4-0","38BP-0"],"widths":[70,240,0,150,150,240,0,0],"label":"대차거래 순위","stack":false,"compact":true},
  '2V71-0': {"node":"2WBN-0","rows":["358S-0","3594-0","35C2-0","35GH-0","35NC-0","35OF-0","35PF-0","35Q1-0","35U0-0"],"widths":[80,240,150,190,190,190,160,0],"label":"프로그램 매매","stack":false,"compact":true},
  '2Z49-0': { node: '3AXF-0', rows: ['3AXG-0', '3AXP-0', '3AY4-0', '3AYJ-0', '3AYY-0', '3AZD-0', '3AZS-0'], widths: [52, 0, 220, 160, 190, 190, 210, 0], label: 'ELW 종목별 순매매', stack: false, compact: true },
  '3TOM-0': { node: '3TS6-0', rows: ['3TUP-0', '3TUA-0', '3TTV-0', '3TTG-0', '3TT1-0', '3TWV-0', '3TXA-0', '3TSM-0', '3TXP-0', '3TY4-0', '3TS7-0'], widths: [52, 0, 220, 160, 190, 190, 210, 0], label: 'ELW 종목별 순매매', stack: false, compact: true },
  '13BC-2': { node: '3IMQ-0', rows: ['3IN3-0', '3INL-0', '3INU-0', '3IO3-0', '3IOC-0', '3IP9-0', '3IPI-0', '3IPR-0', '3IQ0-0'], widths: [96, 120, 120, 180, 88, 110], label: '실시간 체결', stack: false, compact: true },
  '2TRW-1': { node: '2TS8-1', rows: ['3JJK-0', '3JQP-0', '3JQY-0', '3JR7-0', '3JRG-0', '3JRP-0', '3JRY-0', '3JS7-0', '3JSG-0'], widths: [96, 120, 120, 180, 88, 110], label: '실시간 체결', stack: false, compact: true },
  '1JPU-0': { node: '1JQF-0', rows: ['3KMT-0', '3L53-0', '3L5C-0', '3L5L-0', '3L5U-0', '3L63-0', '3L6C-0', '3L6L-0', '3L6U-0', '3LDS-0', '3LE1-0', '3LEA-0', '3LEJ-0', '3LES-0', '3LF1-0', '3LFA-0', '3LFJ-0'], widths: [96, 120, 120, 180, 88, 110], label: '최근 체결', stack: false, compact: true },
  '2RWK-1': { node: '2RYE-1', rows: ['3AUO-0', '3AUW-0', '3AVA-0', '3AVO-0', '3AW2-0', '3AWG-0'], widths: [120, 180, 180, 120, 140, 0, 0], label: '공매도 조회', stack: false, compact: true },
  '2ZTA-0': {"node":"38MX-0","rows":["38MY-0","38NS-0","38OD-0","38Y7-0","38YS-0","38ZD-0","38ZY-0","38N7-0","390J-0"],"widths":[80,240,170,160,140,170,0,170],"label":"한도 소진율","stack":false,"compact":true},
  "2XTO-0": {"node":"365N-0","rows":["365S-0","3660-0","366I-0","3670-0","367I-0","3680-0"],"widths":[0,220,170,130,210,210,160],"label":"조회 결과","stack":false,"compact":true},
  '2UN6-1': { node: '34NC-0', rows: ['34O8-0', '34OG-0', '34P0-0', '34PK-0', '34Q4-0', '34QO-0', '34R8-0'], widths: [130, 200, 140, 100, 100, 140, 130], label: '조건검색 결과', stack: false, compact: true },
  '3MTJ-0': { node: '3OP4-0', rows: ['3OP8-0', '3OPM-0', '3OQ2-0', '3OQJ-0'], widths: [112, 150, 150, 150, 150, 150, 150], label: '결제 예정' },
  '15J9-2': { node: '355R-0', rows: ['355S-0', '355Z-0', '356G-0', '356X-0'], widths: [166, 160, 126, 210, 180, 160], gap: 12, label: '조회 업종 종목' },
  '2SCE-1': { node: '375G-0', rows: ['375K-0', '379R-0', '37EU-0', '37FJ-0', '37G8-0', '37GX-0', '37HM-0', '37IB-0', '37J0-0'], widths: [168, 186, 144, 190, 222, 160], label: '보유종목' },
  '3LGC-0': { node: '3LVJ-0', rows: ['3LVN-0', '3MHR-0', '3MI8-0', '3MIO-0', '3MJ5-0', '3MJL-0', '3MK3-0', '3MKJ-0', '3ML0-0', '3MLG-0'], widths: [112, 148, 390, 204, 216], label: '매매일지' },
  '2R3M-1': { node: '3DFG-0', rows: ['3DG5-0', '3DGK-0', '3DGZ-0', '3DHE-0'], widths: [64, 80, 80, 80, 80, 96, 160, 144], label: '일별 시세', stack: false, compact: true,
    additional: [{ node: '3CRW-0', rows: ['3CS8-0','3CSF-0','3CSQ-0','3CSZ-0','3CT8-0','3CTH-0','3CTQ-0','3CTZ-0','3CU8-0','3CUH-0'], widths: [110,210,130,130,90,120], label: '실시간 체결', stack: false, compact: true }] },
};
const BASKET_ROWS = ['3ECU-0', '3EE8-0', '3EEF-0', '3EEM-0', '3EET-0'];
const BASKET_SLOTS = [['s031', 's033'], ['s036', 's037'], ['s040', 's041'], ['s044', 's045'], ['s048', 's049']];

function authoredNode(surface, id) {
  return [...surface.querySelectorAll(`[data-node="${id}"]`)]
    .find((node) => !node.closest('.bs-paired')) || null;
}

function layoutGroup(doc, className) {
  const group = doc.createElement('div');
  group.className = className;
  return group;
}

const RANK_FOUR = {"2V71-0":{"groups":[["kpi","프로그램 요약",["s013","s016","s017","s022","s023"]],["2WBN-0","프로그램 조회 종목",["s041","s042","s043","s044","s045","s046","s047","s048","s049","s050","s051","s052","s053","s054","s055","s056","s057","s058","s059","s060","s061","s062","s063","s064","s065","s066","s067","s068","s069","s070","s071","s072","s073","s074","s075","s076","s077","s078","s079","s080","s081","s082","s083","s084","s085","s086","s087","s088","s089","s090","s091","s092","s093","s094","s095","s096","s097","s098","s099","s100","s101","s102","s103","s104","s105","s106","s107","s108","s109","s110","s111","s112","s113","s114","s115","s116","s117","s118","s119","s120","s121","s122","s123","s124","s125","s126","s127","s128","s129","s130","s131","s132","s133","s134","s135","s136","s137","s138","s139","s140","s141","s142","s143","s144","s145","s146","s147","s148","s149","s150","s151","s152","s153","s154","s155"]],["3E9K-0","첫 조회 종목",["s168","s169","s173"]],["3E9U-0","프로그램 별도 조회",["s177","s179","s181"]],["3EAD-0","종목별 프로그램 조회 합계",["s185","s186","s188","s189","s191","s194"]]],"omitted":["s047","s049","s051","s053","s054","s061","s063","s065","s067","s068","s075","s077","s079","s081","s082","s089","s091","s093","s095","s096","s103","s105","s107","s109","s110","s117","s119","s121","s123","s124","s134","s136","s138","s140","s141","s148","s150","s152","s154","s155","s171","s192","s195"]},"3063-0":{"groups":[["kpi","요약 통계",["s013","s016","s020","s022"]],["35L4-0","요청 주체의 조회 종목",["s045","s046","s047","s048","s049","s050","s051","s052","s053","s054","s055","s056","s057","s058","s059","s060","s061","s062","s063","s064","s065","s066","s067","s068","s069","s070","s071","s072","s073","s074","s075","s076","s077","s078","s079","s080","s081","s082","s083","s084","s085","s086","s087","s088","s089","s090","s091","s092","s093","s094","s095","s096","s097","s098","s099","s100","s101","s102","s103","s104","s105","s106","s107","s108","s109","s110","s111","s112","s113","s114","s115","s116","s117","s118","s119","s120","s121","s122","s123","s124","s125","s126","s127","s128","s129","s130","s131","s132","s133","s134","s135","s136","s137","s138","s139","s140","s141","s142","s143","s144","s145","s146","s147","s148","s149","s150","s151","s152","s153","s154","s155","s156","s157","s158","s159","s160","s161","s162","s163","s164","s165","s166"]],["3TYJ-0","첫3개 조회 종목",["s176","s177","s179","s181","s183","s184","s186","s188","s190","s191","s193","s195"]],["3U01-0","직전 비교",["s204","s205","s206","s207","s208","s209","s210","s211","s212","s213","s214","s215","s216","s217","s218","s219","s220","s221","s222","s223","s224"]],["3U0Z-0","조회 요약",["s225","s226","s227","s228","s229","s230","s231","s232","s233","s234","s235"]]],"omitted":["s020","s045","s048","s049","s051","s053","s055","s056","s057","s058","s059","s060","s063","s064","s066","s068","s070","s071","s072","s073","s074","s075","s078","s079","s081","s083","s085","s086","s087","s088","s089","s090","s093","s094","s096","s098","s100","s101","s102","s103","s104","s105","s108","s109","s111","s113","s115","s116","s117","s118","s119","s120","s122","s125","s126","s128","s130","s132","s133","s134","s135","s136","s137","s140","s141","s143","s145","s147","s148","s149","s150","s151","s152","s155","s156","s158","s160","s162","s163","s164","s165","s166","s178","s180","s182","s185","s187","s189","s192","s194","s196","s197","s198","s199","s200","s201","s202","s203","s213","s214","s216","s217","s218","s219","s220","s221","s223","s224","s234"]},"30HY-0":{"groups":[["kpi","외국인·기관 요약",["s013","s016","s019","s020","s022"]],["34IW-0","외국인·기관 조회 종목",["s041","s042","s043","s044","s045","s046","s047","s048","s049","s050","s051","s052","s053","s054","s055","s056","s057","s058","s059","s060","s061","s062","s063","s064","s065","s066","s067","s068","s069","s070","s071","s072","s073","s074","s075","s076","s077","s078","s079","s080","s081","s082","s083","s084","s085","s086","s087","s088","s089","s090","s091","s092","s093","s094","s095","s096","s097","s098","s099","s100","s101","s102","s103","s104","s105","s106","s107","s108","s109","s110","s111","s112","s113","s114","s115","s116","s117","s118","s119","s120","s121","s122","s123","s124","s125","s126","s127","s128","s129","s130","s131","s132","s133","s134","s135","s136","s137","s138","s139","s140","s141","s142","s143","s144","s145","s146","s147","s148","s149","s150","s151","s152","s153"]],["3I61-0","첫 조회 종목",["s158","s159"]],["3I6B-0","첫 결과 연속 순매수",["s172","s173"]],["3T0G-0","외국인 순매매액",["s176","s177","s178","s179","s180","s181","s182","s183","s184","s185","s186","s187"]]],"omitted":["s044","s045","s054","s058","s059","s068","s072","s073","s082","s086","s087","s096","s100","s101","s110","s114","s115","s124","s126","s130","s131","s140","s144","s145","s154","s161","s163","s165","s166","s167","s168","s169","s170","s171"]},"31OF-0":{"groups":[["3A7P-0","신용융자 가능종목",[]]],"omitted":["s044","s045","s054","s055","s064","s065","s074","s075","s084","s085","s094","s095","s106","s107","s116","s117"]}};
function prepareRankFour(surface, contract) {
  if (!RANK_FOUR[contract.board_id]) return;
  const config = RANK_FOUR[contract.board_id];
  surface.classList.add('bs-rank-four');
  for (const slot of config.omitted) surface.querySelector(`[data-slot-id="${slot}"]`)?.classList.add('bs-rank-four-unsupported');
  for (const [id] of config.groups) {
    const group = id === 'kpi' ? surface.querySelector('.bs-kpi') : authoredNode(surface, id);
    group?.classList.add('bs-ranking-managed');
  }
  if (contract.board_id === '30HY-0') {
    const group = authoredNode(surface, '3T0G-0');
    group?.querySelector('.bs-unavailable-graphic-message')?.remove();
    for (const id of ['3T0K-0','3T0P-0','3T0U-0','3T10-0','3T15-0','3T1A-0']) authoredNode(surface,id)?.classList.add('bs-rank-four-mini-row');
  }
}

function updateRankFour(surface, plan) {
  const id = surface.dataset?.bsBoardId, config = RANK_FOUR[id];
  if (!config) return;
  const states = surface.__bsRankFourStates || (surface.__bsRankFourStates = new Map());
  for (const assignment of plan.assignments) states.set(assignment.slotId, assignment);
  for (const slot of config.omitted) surface.querySelector(`[data-slot-id="${slot}"]`)?.classList.add('bs-rank-four-unsupported');
  const received = state => state && !state.pending && !state.missing && !state.empty && !state.designText && String(state.text).trim();
  for (const [nodeId, title, ids] of config.groups) {
    const group = nodeId === 'kpi' ? surface.querySelector('.bs-kpi') : authoredNode(surface,nodeId);
    if (!group) continue;
    const watched = ids.map(slot=>states.get(slot));
    const pending = watched.some(value=>value?.pending);
    const empty = !watched.some(received);
    const unsupported = id === '31OF-0' && nodeId === '3A7P-0';
    group.classList.toggle('bs-ranking-unavailable-group',empty || unsupported);
    for (let box=group;box&&box!==surface;box=box.parentElement) {
      if (surface.__bsEmptyValueHidden?.has(box) || box.dataset.bsUnavailableHidden === 'true') {
        setHidden(box,false);surface.__bsEmptyValueHidden?.delete(box);delete box.dataset.bsUnavailableHidden;
      }
      if (box.matches('.bs-rail,.bs-primary')) break;
    }
    let note=group.querySelector(':scope > .bs-ranking-unavailable-note');
    if ((empty||unsupported)&&!note) {note=layoutGroup(surface.ownerDocument,'bs-ranking-unavailable-note');note.setAttribute('role','status');group.append(note);}
    if (note) {note.hidden=!empty&&!unsupported;note.textContent=unsupported?'모의 조회에서 신용융자 가능종목을 제공하지 않습니다.':title+(pending?' 수신 대기':' 미제공');}
  }
  const kpi=surface.querySelector('.bs-kpi');
  for (const cell of kpi?.querySelectorAll('.bs-kpi-cell')||[]) {
    const watched=[...cell.querySelectorAll('[data-slot-id]')].map(node=>states.get(node.dataset.slotId));
    cell.classList.toggle('bs-ranking-unavailable-cell',!watched.some(received)&&!watched.some(state=>state?.pending));
  }
  surface.querySelector('.bs-rail')?.classList.add('bs-ranking-compact-rail');
}

// Independent query rows must not borrow the short-sale table's date.
function prepareCreditSourceLists(surface, contract) {
  const owner = authoredNode(surface, '2RYE-1');
  if (!owner || surface.querySelector('[data-node="flow-credit-source"]')) return;
  const rows = [...owner.querySelectorAll('.bs-readable-row')];
  const dates = [109,110,111,112,113].map(n => {
    const slot = contract.slots.find(s => s.slot_id === 's'+n);
    return slot && authoredNode(surface, slot.node || slot.node_id);
  });
  for (const [key, title, column] of [
    ['lending', '대차 조회 · 응답 순서', 5],
    ['credit', '신용 조회 · 일자별 잔고율', 6],
  ]) {
    const group = layoutGroup(surface.ownerDocument, 'bs-flow-independent-source');
    group.dataset.node = 'flow-'+key+'-source';
    const heading = layoutGroup(surface.ownerDocument, 'bs-flow-source-title');
    heading.textContent = title;
    group.append(heading);
    rows.forEach((source, index) => {
      const cell = source.querySelector('.bs-readable-cell[data-col="'+column+'"]');
      if (!cell) return;
      if (!index) { cell.remove(); return; }
      const row = layoutGroup(surface.ownerDocument, 'bs-flow-independent-row');
      row.dataset.flowSourceRow = key+'-'+(index-1);
      const label = layoutGroup(surface.ownerDocument, 'bs-flow-source-label');
      label.textContent = '조회 '+index;
      row.append(label);
      if (key === 'credit' && dates[index-1]) row.append(dates[index-1]);
      cell.classList.remove('bs-readable-cell');
      cell.removeAttribute('data-col');
      cell.classList.add('bs-flow-independent-value');
      row.append(cell);
      group.append(row);
    });
    owner.append(group);
  }
  const note = layoutGroup(surface.ownerDocument, 'bs-flow-source-context');
  note.textContent = '공매도·신용·대차는 별도 조회입니다. 조회 순서가 같은 행을 같은 날짜로 간주하지 않습니다.';
  owner.prepend(note);
  authoredNode(surface, '3FQB-0')?.classList.add('bs-flow-moved-date-axis');
}
function updateCreditSourceRows(surface, states) {
  const received = id => { const value=states.get(id);return value&&!value.missing&&!value.pending&&!value.empty&&!value.designText&&String(value.text).trim(); };
  for(let i=0;i<5;i++) {
    for(const [key, ids] of [['credit',[52+10*i]],['lending',[50+10*i,51+10*i]]]) {
      const row=surface.querySelector('[data-flow-source-row="'+key+'-'+i+'"]');
      if(row) setHidden(row,!ids.some(n=>received('s'+String(n).padStart(3,'0'))));
    }
    const row=authoredNode(surface,'2RYE-1')?.querySelector('.bs-readable-row[data-row="'+i+'"]');
    if(row) setHidden(row,![44,46,47,48,49].some(n=>received('s'+String(n+10*i).padStart(3,'0'))));
  }
}


// Keep supplementary flow values separate when their queries have different bases.
function prepareFlowResidualLists(surface, contract) {
  if (contract.board_id === '2S4E-1') {
    const chart = authoredNode(surface, '3SL4-0');
    if (!chart || chart.querySelector('.bs-flow-source-lists')) return;
    const nodes = nodeIndex(surface);
    const source = new Map(contract.slots.map(slot => [slot.slot_id, nodes.get(slot.node || slot.node_id)]));
    const lists = layoutGroup(surface.ownerDocument, 'bs-flow-source-lists');
    for (const [id, title, rows] of [
      ['flow-close-investors', '장마감 후 투자자별 조회', [['외국인','s098'],['기관','s101'],['개인','s104']]],
      ['flow-cumulative-investors', '기관·외국인 기간누적 조회', [['외국인','s099'],['기관','s102']]],
      ['flow-total-investors', '투자자별 합계 조회', [['개인','s105']]],
      ['flow-cumulative-dates', '기관·외국인 조회일자', [['조회일','s106'],['조회일','s107'],['조회일','s108'],['조회일','s109'],['조회일','s110']]],
    ]) {
      const group = layoutGroup(surface.ownerDocument, 'bs-flow-source-list');
      group.dataset.node = id;
      const heading = layoutGroup(surface.ownerDocument, 'bs-flow-source-title');
      heading.textContent = title;
      group.append(heading);
      for (const [label, slot] of rows) {
        const value = source.get(slot);
        if (!value) continue;
        const row = layoutGroup(surface.ownerDocument, 'bs-flow-source-row');
        const caption = layoutGroup(surface.ownerDocument, 'bs-flow-source-label');
        caption.textContent = label;
        row.append(caption, value);
        group.append(row);
      }
      lists.append(group);
    }
    chart.append(lists);
    chart.classList.add('bs-flow-replaced-graphic');
    authoredNode(surface, '3SNA-0')?.classList.add('bs-flow-replaced-date-axis');
    chart.querySelector(':scope > .bs-unavailable-graphic-message')?.remove();
    return;
  }
  if (contract.board_id !== '2RWK-1') return;
  prepareCreditSourceLists(surface, contract);
  // Keep the received numeric leaves; the authored rectangles are still suppressed.
  for (const id of ['3PB6-0', '3SH9-0']) {
    const group = authoredNode(surface, id);
    group?.querySelector(':scope > .bs-unavailable-graphic-message')?.remove();
  }
  for (const id of ['3PB6-0', '3FQ5-0', '3FQD-0']) {
    authoredNode(surface, id)?.classList.add('bs-flow-numeric-list');
  }
  // Do not associate ka10013 credit ratios with ka10014 dates by visual position.
  const axis = authoredNode(surface, '3FQB-0');
  if (axis && !axis.querySelector('.bs-flow-date-heading')) {
    const label = layoutGroup(surface.ownerDocument, 'bs-flow-date-heading');
    label.textContent = '공매도 조회일자';
    axis.prepend(label);
  }
}

function updateFlowResidualDetails(surface, plan, options = {}) {
  const id = surface.dataset?.bsBoardId;
  const groups = {
    '2ROJ-1': [
      ['2RPL-1', ['s127','s129','s131','s134','s136','s138'], '거래원 조회 자료'],
      ['3DWA-0', ['s166','s167','s168','s170','s171','s172'], '차익잔고·미결제'],
    ],
    '2RWK-1': [
      ['flow-credit-source', ['s052','s062','s072','s082','s092'], '신용 조회'],
      ['flow-lending-source', ['s050','s051','s060','s061','s070','s071','s080','s081','s090','s091'], '대차 조회'],
      ['2RWT-1', ['s133','s135'], '프로그램 조회'],
      ['2RXM-1', ['s118','s120','s122','s125','s127','s129'], '거래원 조회 자료'],
      ['3PB4-0', ['s098','s099','s100','s101','s102'], '공매도 비중'],
      ['3FQ3-0', ['s104','s105','s106','s107','s108'], '신용잔고율'],
      ['3SH5-0', ['s150','s152','s154','s156','s158'], '공매도 대금'],
    ],
    '2S4E-1': [
      ['2S5G-1', ['s114','s115','s116','s117','s118','s119','s121','s122','s123','s124','s125','s126'], '거래원 조회 자료'],
      ['33W6-0', ['s160','s161'], '연속 순매매'],
      ['flow-close-investors', ['s098','s101','s104'], '장마감 후 투자자별 조회'],
      ['flow-cumulative-investors', ['s099','s102'], '기관·외국인 기간누적 조회'],
      ['flow-total-investors', ['s105'], '투자자별 합계 조회'],
      ['flow-cumulative-dates', ['s106','s107','s108','s109','s110'], '기관·외국인 조회일자'],
    ],
  }[id];
  if (!groups) return;
  const states = surface.__bsFlowResidualStates || (surface.__bsFlowResidualStates = new Map());
  for (const assignment of plan.assignments) states.set(assignment.slotId, assignment);
  if (id === '2RWK-1') {
    // Completed empty metadata supersedes values cached by the hydrate consumer.
    if (!options.partial) for (const slot of options.emptyValueSlots || []) {
      const current = states.get(slot);
      if (current) states.set(slot, { ...current, missing: true, empty: true, pending: false });
    }
    updateCreditSourceRows(surface, states);
  }
  for (const [nodeId, slots, label] of groups) {
    const group = authoredNode(surface, nodeId);
    if (!group) continue;
    const values = slots.map(slot => states.get(slot));
    const known = values.every(Boolean);
    const received = values.some(value => value && !value.missing && !value.pending && !value.empty
      && !value.designText && String(value.text).trim());
    const compact = known && !received;
    const pending = compact && values.some(value => value.pending);
    group.classList.toggle('bs-flow-residual-empty', compact);
    // Generic empty-leaf collapsing must not hide the explanatory group or a later zero.
    for (let box = group; box && box !== surface; box = box.parentElement) {
      if (surface.__bsEmptyValueHidden?.has(box) || box.dataset.bsUnavailableHidden === 'true'
        || box.dataset.bsRowCollapsed === 'true') {
        setHidden(box, false);
        surface.__bsEmptyValueHidden?.delete(box);
        delete box.dataset.bsUnavailableHidden;
        delete box.dataset.bsRowCollapsed;
      }
      if (box.matches('.bs-rail, .bs-primary')) break;
    }
    let note = group.querySelector(':scope > .bs-flow-residual-note');
    if (compact && !note) {
      note = layoutGroup(surface.ownerDocument, 'bs-flow-residual-note');
      note.setAttribute('role', 'status');
      group.append(note);
    }
    if (note) {
      note.hidden = !compact;
      note.textContent = `${label} ${pending ? '수신 대기' : '미제공'}`;
    }
  }
}

const RANK_NINE = {
  "2X5N-0": {"table":"34X2-0","omitted":["s039","s049","s050","s060","s061","s071","s072","s082","s083","s093","s124","s125","s126","s127","s128","s129","s130"],"omittedNodes":["34XG-0","34XU-0","34XW-0","34YA-0","34YC-0","34YQ-0","34YS-0","34Z6-0","34Z8-0","34ZM-0","2X6C-0","2X6A-0","2X69-0","2X67-0","2X66-0","2X64-0","2X63-0"],"hiddenNodes":["2X60-0","3SAQ-0","3SAT-0","3SAW-0","3SB0-0","3SB2-0","3SB4-0","3SB6-0"],"info":"3SAO-0","infoRows":[],"mini":null,"groups":[["34X2-0","조회 내역",["s040","s041","s042","s043","s044","s045","s046","s047","s048","s051","s052","s053","s054","s055","s056","s057","s058","s059","s062","s063","s064","s065","s066","s067","s068","s069","s070","s073","s074","s075","s076","s077","s078","s079","s080","s081","s084","s085","s086","s087","s088","s089","s090","s091","s092"]],["3SAO-0","추가 종목 정보",[]],["2X6E-0","첫 조회 종목",["s118","s119","s121","s122"]],["34ZR-0","세션별 거래 내역",["s104","s105","s106","s107","s109","s110","s111","s112","s114","s115","s116","s117"]]],"optionalRows":[["3501-0",["s104","s105","s106","s107"]],["3507-0",["s109","s110","s111","s112"]],["350D-0",["s114","s115","s116","s117"]]],"readable":{"node":"34X2-0","rows":["34X7-0","34XF-0","34XV-0","34YB-0","34YR-0","34Z7-0"],"widths":[0,220,170,130,180,210,0],"label":"조회 결과","stack":false,"compact":true,"additional":[{"node":"34ZR-0","rows":["34ZV-0","3501-0","3507-0","350D-0"],"widths":[100,160,140,140,180],"label":"세션별 거래 내역","compact":true}]}},
  "2XG6-0": {"table":"352Q-0","omitted":["s039","s044","s046","s047","s048","s049","s050","s055","s057","s058","s059","s060","s061","s066","s068","s069","s070","s071","s072","s077","s079","s080","s081","s082","s083","s088","s090","s091","s092","s093","s100","s103","s106","s107","s108","s109","s110","s111","s112","s113","s114","s115","s116","s117","s118","s119","s120","s121","s122","s123","s124","s125","s126","s127","s128","s129","s130","s131","s132","s133","s140"],"omittedNodes":["3534-0","353B-0","353E-0","353G-0","353H-0","353I-0","353K-0","353R-0","353U-0","353W-0","353X-0","353Y-0","3540-0","3547-0","354A-0","354C-0","354D-0","354E-0","354G-0","354N-0","354Q-0","354S-0","354T-0","354U-0","354W-0","3553-0","3556-0","3558-0","3559-0","355A-0","3C8X-0","3C92-0","3C97-0","3C9B-0","3C9C-0","3C9D-0","3C9G-0","3C9H-0","3C9I-0","3C9L-0","3C9M-0","3C9N-0","3C9R-0","3C9S-0","3C9T-0","3C9W-0","3C9X-0","3C9Y-0","3CA1-0","3CA2-0","3CA3-0","3CA7-0","3CA8-0","3CA9-0","3CAC-0","3CAD-0","3CAE-0","3CAH-0","3CAI-0","3CAJ-0","2XGV-0"],"hiddenNodes":["3SBP-0","3SBM-0","3SBJ-0","3SBH-0","3SBF-0","3SBD-0","3SBB-0"],"info":"3SB9-0","infoRows":[],"mini":{"node":"3C8N-0","tiles":["3C8T-0","3C8Y-0","3C93-0"]},"groups":[["352Q-0","조회 내역",["s040","s041","s042","s043","s045","s051","s052","s053","s054","s056","s062","s063","s064","s065","s067","s073","s074","s075","s076","s078","s084","s085","s086","s087","s089"]],["3SB9-0","추가 종목 정보",[]],["3C8N-0","조회 종목",["s098","s099","s101","s102","s104","s105"]],["2XGX-0","첫 조회 종목",["s134","s135","s137","s138"]],["2XGJ-0","다른 조회 종목",["s141","s143","s145"]]],"optionalRows":[],"readable":{"node":"352Q-0","rows":["352V-0","3533-0","353J-0","353Z-0","354F-0","354V-0"],"widths":[0,220,170,0,180,0,0],"label":"조회 결과","stack":false,"compact":true}},
  "2XKO-0": {"table":"3DRG-0","omitted":["s039","s047","s051","s059","s063","s071","s075","s083","s087","s095","s112","s113","s114","s115","s116","s117","s118","s119","s120","s121","s122","s123","s124","s125","s126","s127","s128","s129","s130","s131","s132","s133","s134","s135","s136","s137","s138","s145"],"omittedNodes":["3DRU-0","3DS7-0","3DSD-0","3DSQ-0","3DSW-0","3DT9-0","3DTF-0","3DTS-0","3DTY-0","3DUB-0","3DYB-0","3DYA-0","3DY8-0","3DY6-0","3DY5-0","3DY3-0","3DY1-0","3DY0-0","3DXY-0","3DXV-0","3DXU-0","3DXS-0","3DXQ-0","3DXP-0","3DXN-0","3DXL-0","3DXK-0","3DXI-0","3DXF-0","3DXE-0","3DXC-0","3DXA-0","3DX9-0","3DX7-0","3DX5-0","3DX4-0","3DX2-0","2XLD-0"],"hiddenNodes":["3SF1-0","3SEY-0","3SEV-0","3SET-0","3SER-0","3SEP-0","3T5P-0"],"info":"3SEL-0","infoRows":[],"mini":{"node":"3DWY-0","tiles":["3DYN-0","3DYI-0","3DYD-0"]},"groups":[["3DRG-0","조회 내역",["s040","s041","s042","s043","s044","s045","s046","s048","s049","s050","s052","s053","s054","s055","s056","s057","s058","s060","s061","s062","s064","s065","s066","s067","s068","s069","s070","s072","s073","s074","s076","s077","s078","s079","s080","s081","s082","s084","s085","s086","s088","s089","s090","s091","s092","s093","s094","s096","s097","s098"]],["3SEL-0","추가 종목 정보",[]],["3DWY-0","조회 종목",["s103","s104","s105","s106","s107","s108","s109","s110","s111"]],["2XLF-0","첫 조회 종목",["s139","s140","s142","s143"]],["2XL1-0","다른 조회 종목",["s146","s147","s148","s149","s150","s151"]]],"optionalRows":[],"readable":{"node":"3DRG-0","rows":["3DRL-0","3DRT-0","3DSC-0","3DSV-0","3DTE-0","3DTX-0"],"widths":[0,220,170,130,180,210,140],"label":"조회 결과","stack":false,"compact":true}},
  "2XP6-0": {"table":"3FC5-0","omitted":["s039","s050","s061","s072","s083","s107","s108","s109","s110","s111","s112","s113","s114","s115","s116","s117","s118","s119","s120","s121","s122","s123","s124","s125","s126","s127","s128","s129","s130","s131","s132","s133","s140"],"omittedNodes":["3FCJ-0","3FCZ-0","3FDF-0","3FDV-0","3FEB-0","3EPR-0","3EPQ-0","3EPO-0","3EPM-0","3EPL-0","3EPJ-0","3EPH-0","3EPG-0","3EPE-0","3EPB-0","3EPA-0","3EP8-0","3EP6-0","3EP5-0","3EP3-0","3EP1-0","3EP0-0","3EOY-0","3EOV-0","3EOU-0","3EOS-0","3EOQ-0","3EOP-0","3EON-0","3EOL-0","3EOK-0","3EOI-0","2XPV-0"],"hiddenNodes":["3S9F-0","3S9I-0"],"info":"3S94-0","infoRows":["3S96-0","3S99-0","3S9C-0"],"mini":{"node":"3EOE-0","tiles":["3EQ3-0","3EPY-0","3EPT-0"]},"groups":[["3FC5-0","조회 내역",["s040","s041","s042","s043","s044","s045","s046","s047","s048","s049","s051","s052","s053","s054","s055","s056","s057","s058","s059","s060","s062","s063","s064","s065","s066","s067","s068","s069","s070","s071","s073","s074","s075","s076","s077","s078","s079","s080","s081","s082","s084","s085","s086","s087","s088","s089","s090","s091","s092","s093"]],["3S94-0","추가 종목 정보",["s149","s151","s153"]],["3EOE-0","조회 종목",["s098","s099","s100","s101","s102","s103","s104","s105","s106"]],["2XPX-0","첫 조회 종목",["s134","s135","s137","s138"]],["2XPJ-0","다른 조회 종목",["s141","s142","s143","s144","s145","s146"]]],"optionalRows":[["3S96-0",["s149"]],["3S99-0",["s151"]],["3S9C-0",["s153"]]],"readable":{"node":"3FC5-0","rows":["3FCA-0","3FCI-0","3FCY-0","3FDE-0","3FDU-0","3FEA-0"],"widths":[0,220,170,130,180,210,210],"label":"조회 결과","stack":false,"compact":true}},
  "2XTO-0": {"table":"365N-0","omitted":["s040","s051","s052","s063","s064","s075","s076","s087","s088","s099","s113","s114","s115","s116","s117","s118","s119","s120","s121","s122","s123","s124","s125","s126","s127","s128","s129","s130","s131","s132","s133","s134","s135","s136","s137","s138","s139","s146"],"omittedNodes":["3661-0","366H-0","366J-0","366Z-0","3671-0","367H-0","367J-0","367Z-0","3681-0","368H-0","3EGD-0","3EGC-0","3EGA-0","3EG8-0","3EG7-0","3EG5-0","3EG3-0","3EG2-0","3EG0-0","3EFX-0","3EFW-0","3EFU-0","3EFS-0","3EFR-0","3EFP-0","3EFN-0","3EFM-0","3EFK-0","3EFH-0","3EFG-0","3EFE-0","3EFC-0","3EFB-0","3EF9-0","3EF7-0","3EF6-0","3EF4-0","2XUD-0"],"hiddenNodes":["3SC9-0","3SC6-0","3SC3-0","3SC1-0","3SBZ-0","3SBX-0","3SBV-0"],"info":"3SBT-0","infoRows":[],"mini":{"node":"3EF0-0","tiles":["3EGP-0","3EGK-0","3EGF-0"]},"groups":[["365N-0","조회 내역",["s041","s042","s043","s044","s045","s046","s047","s048","s049","s050","s053","s054","s055","s056","s057","s058","s059","s060","s061","s062","s065","s066","s067","s068","s069","s070","s071","s072","s073","s074","s077","s078","s079","s080","s081","s082","s083","s084","s085","s086","s089","s090","s091","s092","s093","s094","s095","s096","s097","s098"]],["3SBT-0","추가 종목 정보",[]],["3EF0-0","조회 종목",["s104","s105","s106","s107","s108","s109","s110","s111","s112"]],["2XUF-0","첫 조회 종목",["s140","s141","s143","s144"]],["2XU1-0","다른 조회 종목",["s147","s148","s149","s150","s151","s152"]]],"optionalRows":[],"readable":{"node":"365N-0","rows":["365S-0","3660-0","366I-0","3670-0","367I-0","3680-0"],"widths":[0,220,170,130,210,210,160],"label":"조회 결과","stack":false,"compact":true}},
  "2YA8-0": {"table":"36EP-0","omitted":["s040","s050","s051","s061","s062","s072","s073","s083","s084","s094","s101","s104","s107","s108","s109","s110","s111","s112","s113","s114","s115","s116","s117","s118","s119","s120","s121","s122","s123","s124","s125","s126","s127","s128","s129","s130","s131","s132","s133","s134","s141"],"omittedNodes":["36F3-0","36FH-0","36FJ-0","36FX-0","36FZ-0","36GD-0","36GF-0","36GT-0","36GV-0","36H9-0","3EIN-0","3EII-0","3EID-0","3EIA-0","3EI9-0","3EI7-0","3EI5-0","3EI4-0","3EI2-0","3EI0-0","3EHZ-0","3EHX-0","3EHU-0","3EHT-0","3EHR-0","3EHP-0","3EHO-0","3EHM-0","3EHK-0","3EHJ-0","3EHH-0","3EHE-0","3EHD-0","3EHB-0","3EH9-0","3EH8-0","3EH6-0","3EH4-0","3EH3-0","3EH1-0","2YAX-0"],"hiddenNodes":["3SCT-0","3SCQ-0","3SCN-0","3SCL-0","3SCJ-0","3SCH-0","3SCF-0"],"info":"3SCD-0","infoRows":[],"mini":{"node":"3EGX-0","tiles":["3EIM-0","3EIH-0","3EIC-0"]},"groups":[["36EP-0","조회 내역",["s041","s042","s043","s044","s045","s046","s047","s048","s049","s052","s053","s054","s055","s056","s057","s058","s059","s060","s063","s064","s065","s066","s067","s068","s069","s070","s071","s074","s075","s076","s077","s078","s079","s080","s081","s082","s085","s086","s087","s088","s089","s090","s091","s092","s093"]],["3SCD-0","추가 종목 정보",[]],["3EGX-0","조회 종목",["s099","s100","s102","s103","s105","s106"]],["2YAZ-0","첫 조회 종목",["s135","s136","s138","s139"]],["2YAL-0","다른 조회 종목",["s142","s144","s146"]]],"optionalRows":[],"readable":{"node":"36EP-0","rows":["36EU-0","36F2-0","36FI-0","36FY-0","36GE-0","36GU-0"],"widths":[0,220,170,130,210,210,0],"label":"조회 결과","stack":false,"compact":true}},
  "2YEQ-0": {"table":"36JX-0","omitted":["s040","s050","s051","s061","s062","s072","s073","s083","s084","s094","s101","s104","s107","s108","s109","s110","s111","s112","s113","s114","s115","s116","s117","s118","s119","s120","s121","s122","s123","s124","s125","s126","s127","s128","s129","s130","s131","s132","s133","s134","s141"],"omittedNodes":["36KB-0","36KP-0","36KR-0","36L5-0","36L7-0","36LL-0","36LN-0","36M1-0","36M3-0","36MH-0","3EKK-0","3EKF-0","3EKA-0","3EK7-0","3EK6-0","3EK4-0","3EK2-0","3EK1-0","3EJZ-0","3EJX-0","3EJW-0","3EJU-0","3EJR-0","3EJQ-0","3EJO-0","3EJM-0","3EJL-0","3EJJ-0","3EJH-0","3EJG-0","3EJE-0","3EJB-0","3EJA-0","3EJ8-0","3EJ6-0","3EJ5-0","3EJ3-0","3EJ1-0","3EJ0-0","3EIY-0","2YFF-0"],"hiddenNodes":["3SDD-0","3SDA-0","3SD7-0","3SD5-0","3SD3-0","3SD1-0","3SCZ-0"],"info":"3SCX-0","infoRows":[],"mini":{"node":"3EIU-0","tiles":["3EKJ-0","3EKE-0","3EK9-0"]},"groups":[["36JX-0","조회 내역",["s041","s042","s043","s044","s045","s046","s047","s048","s049","s052","s053","s054","s055","s056","s057","s058","s059","s060","s063","s064","s065","s066","s067","s068","s069","s070","s071","s074","s075","s076","s077","s078","s079","s080","s081","s082","s085","s086","s087","s088","s089","s090","s091","s092","s093"]],["3SCX-0","추가 종목 정보",[]],["3EIU-0","조회 종목",["s099","s100","s102","s103","s105","s106"]],["2YFH-0","첫 조회 종목",["s135","s136","s138","s139"]],["2YF3-0","다른 조회 종목",["s142","s144","s146"]]],"optionalRows":[],"readable":{"node":"36JX-0","rows":["36K2-0","36KA-0","36KQ-0","36L6-0","36LM-0","36M2-0"],"widths":[0,220,170,130,210,210,0],"label":"조회 결과","stack":false,"compact":true}},
  "2YJ8-0": {"table":"36QC-0","omitted":["s039","s049","s050","s060","s061","s071","s072","s082","s083","s093","s107","s108","s109","s110","s111","s112","s113","s114","s115","s116","s117","s118","s119","s120","s121","s122","s123","s124","s125","s126","s127","s128","s129","s130","s131","s132","s133","s140"],"omittedNodes":["36QQ-0","36R4-0","36R6-0","36RK-0","36RM-0","36S0-0","36S2-0","36SG-0","36SI-0","36SW-0","3EM4-0","3EM3-0","3EM1-0","3ELZ-0","3ELY-0","3ELW-0","3ELU-0","3ELT-0","3ELR-0","3ELO-0","3ELN-0","3ELL-0","3ELJ-0","3ELI-0","3ELG-0","3ELE-0","3ELD-0","3ELB-0","3EL8-0","3EL7-0","3EL5-0","3EL3-0","3EL2-0","3EL0-0","3EKY-0","3EKX-0","3EKV-0","2YJX-0"],"hiddenNodes":["3SDX-0","3SDU-0","3SDR-0","3SDP-0","3SDN-0","3SDL-0","3SDJ-0"],"info":"3SDH-0","infoRows":[],"mini":{"node":"3EKR-0","tiles":["3EMG-0","3EMB-0","3EM6-0"]},"groups":[["36QC-0","조회 내역",["s040","s041","s042","s043","s044","s045","s046","s047","s048","s051","s052","s053","s054","s055","s056","s057","s058","s059","s062","s063","s064","s065","s066","s067","s068","s069","s070","s073","s074","s075","s076","s077","s078","s079","s080","s081","s084","s085","s086","s087","s088","s089","s090","s091","s092"]],["3SDH-0","추가 종목 정보",[]],["3EKR-0","조회 종목",["s098","s099","s100","s101","s102","s103","s104","s105","s106"]],["2YJZ-0","첫 조회 종목",["s134","s135","s137","s138"]],["2YJL-0","다른 조회 종목",["s141","s142","s143","s144","s145","s146"]]],"optionalRows":[],"readable":{"node":"36QC-0","rows":["36QH-0","36QP-0","36R5-0","36RL-0","36S1-0","36SH-0"],"widths":[0,220,170,130,210,210,0],"label":"조회 결과","stack":false,"compact":true}},
  "2YNQ-0": {"table":"3721-0","omitted":["s106","s107","s108","s109","s110","s111","s112","s113","s114","s115","s116","s117","s118","s119","s120","s121","s122","s123","s124","s125","s126","s127","s128","s129","s130","s131","s132","s139"],"omittedNodes":["3ERO-0","3ERN-0","3ERL-0","3ERJ-0","3ERI-0","3ERG-0","3ERE-0","3ERD-0","3ERB-0","3ER8-0","3ER7-0","3ER5-0","3ER3-0","3ER2-0","3ER0-0","3EQY-0","3EQX-0","3EQV-0","3EQS-0","3EQR-0","3EQP-0","3EQN-0","3EQM-0","3EQK-0","3EQI-0","3EQH-0","3EQF-0","2YOF-0"],"hiddenNodes":["3SEH-0","3SEB-0","3SE9-0","3SE7-0","3SE5-0","3SE3-0"],"info":"3SE1-0","infoRows":["3SEE-0"],"mini":{"node":"3EQB-0","tiles":["3ES0-0","3ERV-0","3ERQ-0"]},"groups":[["3721-0","조회 내역",["s038","s039","s040","s041","s042","s043","s044","s045","s046","s047","s048","s049","s050","s051","s052","s053","s054","s055","s056","s057","s058","s059","s060","s061","s062","s063","s064","s065","s066","s067","s068","s069","s070","s071","s072","s073","s074","s075","s076","s077","s078","s079","s080","s081","s082","s083","s084","s085","s086","s087","s088","s089","s090","s091","s092"]],["3SE1-0","추가 종목 정보",["s150"]],["3EQB-0","조회 종목",["s097","s098","s099","s100","s101","s102","s103","s104","s105"]],["2YOH-0","첫 조회 종목",["s133","s134","s136","s137"]],["2YO3-0","다른 조회 종목",["s140","s141","s142","s143","s144","s145"]]],"optionalRows":[["3SEE-0",["s150"]]],"readable":{"node":"3721-0","rows":["3726-0","372E-0","372W-0","373E-0","373W-0","374E-0"],"widths":[70,220,170,170,220,210],"label":"조회 결과","stack":false,"compact":true}},
};
function prepareRankNine(surface, contract) {
  const config = RANK_NINE[contract.board_id];
  if (!config) return;
  surface.classList.add('bs-rank-nine');
  for (const node of config.hiddenNodes) authoredNode(surface,node)?.classList.add('bs-rank-nine-unsupported');
  for (const slot of config.omitted) surface.querySelector(`[data-slot-id="${slot}"]`)?.classList.add('bs-rank-nine-unsupported');
  if (config.mini) {
    const group=authoredNode(surface,config.mini.node);
    const list=layoutGroup(surface.ownerDocument,'bs-rank-nine-mini');
    for (const id of config.mini.tiles) {
      const tile=authoredNode(surface,id);
      tile.classList.add('bs-rank-nine-mini-tile');list.append(tile);
    }
    for (const child of [...group.children]) child.classList.add('bs-rank-nine-unsupported');
    const title=layoutGroup(surface.ownerDocument,'bs-rank-nine-mini-title');title.textContent='첫3개 조회 종목';
    group.append(title,list);
  }
  for (const [id] of config.groups) authoredNode(surface,id)?.classList.add('bs-ranking-managed');
  for (const id of config.infoRows) authoredNode(surface,id)?.classList.add('bs-rank-nine-info-row');
  authoredNode(surface,config.info)?.classList.add('bs-rank-nine-info');
}

function updateRankNine(surface, plan) {
  const config=RANK_NINE[surface.dataset?.bsBoardId];
  if (!config) return;
  const states=surface.__bsRankNineStates||(surface.__bsRankNineStates=new Map());
  for (const assignment of plan.assignments) states.set(assignment.slotId,assignment);
  for (const id of config.omittedNodes) for(const node of surface.querySelectorAll(`[data-node="${id}"]`)) node.classList.add('bs-rank-nine-unsupported');
  const received=s=>s&&!s.pending&&!s.missing&&!s.empty&&!s.designText&&String(s.text).trim();
  surface.classList.toggle('bs-rank-nine-empty',!config.groups.some(([, , slots])=>slots.some(s=>received(states.get(s)))));
  for (const [id,title,slots] of config.groups) {
    const group=authoredNode(surface,id);if(!group)continue;
    const watched=slots.map(s=>states.get(s));
    const empty=!watched.some(received),pending=watched.some(s=>s?.pending);
    group.classList.toggle('bs-ranking-unavailable-group',empty);
    if(surface.dataset.bsBoardId==='2YNQ-0'&&id===config.mini.node)group.classList.toggle('bs-rank-nine-mini-empty',empty);
    for(let box=group;box&&box!==surface;box=box.parentElement) {
      if(surface.__bsEmptyValueHidden?.has(box)||box.dataset.bsUnavailableHidden==='true'
        ||box.dataset.bsRowCollapsed==='true') {
        setHidden(box,false);surface.__bsEmptyValueHidden?.delete(box);delete box.dataset.bsUnavailableHidden;
        delete box.dataset.bsRowCollapsed;
      }
      if(box.matches('.bs-rail,.bs-primary'))break;
    }
    let note=group.querySelector(':scope > .bs-ranking-unavailable-note');
    if(empty&&!note){note=layoutGroup(surface.ownerDocument,'bs-ranking-unavailable-note');note.setAttribute('role','status');group.append(note);}
    if(note){note.hidden=!empty;note.textContent=title+(pending?' 수신 대기':' 미제공');}
  }
  // Each session and actual info row restores independently when even one zero arrives.
  for(const [id,slots] of config.optionalRows) {
    const row=authoredNode(surface,id);if(!row)continue;
    const empty=!slots.some(s=>received(states.get(s)));
    row.classList.toggle('bs-rank-nine-empty-row',empty);
    if(!empty){delete row.dataset.bsRowCollapsed;row.classList.remove('bs-row-collapsed');setHidden(row,false);}
  }
  for(const row of authoredNode(surface,config.table)?.querySelectorAll('[data-row]')||[]) {
    if(row.dataset.row==='head')continue;
    const slots=[...row.querySelectorAll('[data-slot-id]')].map(e=>e.dataset.slotId);
    const empty=!slots.some(s=>received(states.get(s)));
    row.classList.toggle('bs-rank-nine-empty-row',empty);
    if(!empty){delete row.dataset.bsRowCollapsed;row.classList.remove('bs-row-collapsed');setHidden(row,false);}
  }
  surface.querySelector('.bs-rail')?.classList.add('bs-ranking-compact-rail');
}

const FLOW_RANK_FIVE = {
  "2YS8-0": {"table":"39D6-0","groups":[["39D6-0","조회 내역",["s042","s043","s044","s045","s046","s047","s054","s057","s058","s059","s060","s061","s062","s069","s072","s073","s074","s075","s076","s077","s084","s087","s088","s089","s090","s091","s092","s099","s102","s103","s104","s105","s106","s107","s114","s117","s118","s119","s120","s121","s122","s129","s134","s135","s136","s137","s138","s139","s146","s149","s150","s151","s152","s153","s154","s161"]],["3F41-0","첫 조회 종목",["s166","s167","s171","s173"]],["3F4H-0","첫 결과 신용비율",["s185"]],["3SKF-0","조회 구성 정보",[]]],"cells":[{"node":"2YX5-0","sort":true,"slots":[]},{"node":"2YX1-0","sort":false,"slots":["s013"]},{"node":"2YWX-0","sort":false,"slots":["s016"]},{"node":"2YWT-0","sort":false,"slots":[]},{"node":"2YWP-0","sort":false,"slots":[]}],"optionalRows":[["3F45-0",["s169"]],["3F48-0",["s171"]],["3F4B-0",["s173"]],["3F4E-0",["s175"]],["3F4L-0",["s179"]],["3F4R-0",["s181"]],["3F4Y-0",["s183"]],["3F51-0",["s185"]]],"omitted":["s048","s049","s050","s051","s052","s053","s055","s063","s064","s065","s066","s067","s068","s070","s078","s079","s080","s081","s082","s083","s085","s093","s094","s095","s096","s097","s098","s100","s108","s109","s110","s111","s112","s113","s115","s123","s124","s125","s126","s127","s128","s130","s140","s141","s142","s143","s144","s145","s147","s155","s156","s157","s158","s159","s160","s162"],"omittedNodes":["39DT-0","39DV-0","39DW-0","39DY-0","39DZ-0","39E0-0","39E3-0","39EH-0","39EJ-0","39EK-0","39EM-0","39EN-0","39EO-0","39ER-0","39F5-0","39F7-0","39F8-0","39FA-0","39FB-0","39FC-0","39FF-0","39MK-0","39MM-0","39MN-0","39MP-0","39MQ-0","39MR-0","39MU-0","39N8-0","39NA-0","39NB-0","39ND-0","39NE-0","39NF-0","39NI-0","39NW-0","39NY-0","39NZ-0","39O1-0","39O2-0","39O3-0","39O6-0","39OK-0","39OM-0","39ON-0","39OP-0","39OQ-0","39OR-0","39OU-0","39P8-0","39PA-0","39PB-0","39PD-0","39PE-0","39PF-0","39PI-0"],"hiddenNodes":["2YTQ-0"],"mini":null,"summary":null,"formats":{"s044":["stk_infr",{"kind":"text","prefix":"종목정보 코드 "}],"s046":["pred_pre",{"kind":"number","sign":true,"precision":0,"tone":"change","prefix":"전일비 ","suffix":"원"}],"s059":["stk_infr",{"kind":"text","prefix":"종목정보 코드 "}],"s061":["pred_pre",{"kind":"number","sign":true,"precision":0,"tone":"change","prefix":"전일비 ","suffix":"원"}],"s074":["stk_infr",{"kind":"text","prefix":"종목정보 코드 "}],"s076":["pred_pre",{"kind":"number","sign":true,"precision":0,"tone":"change","prefix":"전일비 ","suffix":"원"}],"s089":["stk_infr",{"kind":"text","prefix":"종목정보 코드 "}],"s091":["pred_pre",{"kind":"number","sign":true,"precision":0,"tone":"change","prefix":"전일비 ","suffix":"원"}],"s104":["stk_infr",{"kind":"text","prefix":"종목정보 코드 "}],"s106":["pred_pre",{"kind":"number","sign":true,"precision":0,"tone":"change","prefix":"전일비 ","suffix":"원"}],"s119":["stk_infr",{"kind":"text","prefix":"종목정보 코드 "}],"s121":["pred_pre",{"kind":"number","sign":true,"precision":0,"tone":"change","prefix":"전일비 ","suffix":"원"}],"s136":["stk_infr",{"kind":"text","prefix":"종목정보 코드 "}],"s138":["pred_pre",{"kind":"number","sign":true,"precision":0,"tone":"change","prefix":"전일비 ","suffix":"원"}],"s151":["stk_infr",{"kind":"text","prefix":"종목정보 코드 "}],"s153":["pred_pre",{"kind":"number","sign":true,"precision":0,"tone":"change","prefix":"전일비 ","suffix":"원"}]}},
  "2ZBB-0": {"table":"384C-0","groups":[["384C-0","조회 내역",["s042","s043","s046","s048","s050","s051","s056","s057","s060","s062","s064","s065","s070","s071","s074","s076","s078","s079","s084","s085","s088","s090","s092","s093","s098","s099","s102","s104","s106","s107","s112","s113","s116","s118","s120","s121","s128","s129","s132","s134","s136","s137","s142","s143","s146","s148","s150","s151"]],["3F87-0","조회 응답 합계",["s161","s163","s167","s169"]],["3SNN-0","첫6개 조회 잔고",["s172","s173","s174","s175","s176","s177","s178","s179","s180","s181","s182","s183"]],["3SOO-0","조회 구성 정보",[]]],"cells":[{"node":"2ZG8-0","sort":true,"slots":[]},{"node":"2ZG4-0","sort":false,"slots":["s013"]},{"node":"2ZG0-0","sort":false,"slots":["s016"]},{"node":"2ZFW-0","sort":false,"slots":[]},{"node":"2ZFS-0","sort":false,"slots":[]}],"optionalRows":[["3F8C-0",["s161"]],["3F8I-0",["s163"]],["3F8O-0",["s165"]],["3F8R-0",["s167"]],["3F8U-0",["s169"]]],"omitted":["s044","s045","s047","s049","s052","s053","s054","s058","s059","s061","s063","s066","s067","s068","s072","s073","s075","s077","s080","s081","s082","s086","s087","s089","s091","s094","s095","s096","s100","s101","s103","s105","s108","s109","s110","s114","s115","s117","s119","s122","s123","s124","s130","s131","s133","s135","s138","s139","s140","s144","s145","s147","s149","s152","s153","s154"],"omittedNodes":["384S-0","384T-0","384W-0","384Z-0","3854-0","3855-0","3856-0","385D-0","385E-0","385H-0","385K-0","385P-0","385Q-0","385R-0","385Y-0","385Z-0","3862-0","3865-0","386A-0","386B-0","386C-0","389J-0","389K-0","389N-0","389Q-0","389V-0","389W-0","389X-0","38A4-0","38A5-0","38A8-0","38AB-0","38AG-0","38AH-0","38AI-0","38AP-0","38AQ-0","38AT-0","38AW-0","38B1-0","38B2-0","38B3-0","38BA-0","38BB-0","38BE-0","38BH-0","38BM-0","38BN-0","38BO-0","38BV-0","38BW-0","38BZ-0","38C2-0","38C7-0","38C8-0","38C9-0"],"hiddenNodes":["2ZCT-0"],"mini":{"node":"3SNN-0","pairs":[["s172","s173"],["s174","s175"],["s176","s177"],["s178","s179"],["s180","s181"],["s182","s183"]]},"summary":null,"formats":{"s050":["rmnd",{"kind":"number","precision":0,"suffix":"주","prefix":"수량 "}],"s051":["remn_amt",{"kind":"korean","sign":false,"tone":"neutral","scale":"백만","suffix":"원","prefix":"금액 "}],"s064":["rmnd",{"kind":"number","precision":0,"suffix":"주","prefix":"수량 "}],"s065":["remn_amt",{"kind":"korean","sign":false,"tone":"neutral","scale":"백만","suffix":"원","prefix":"금액 "}],"s078":["rmnd",{"kind":"number","precision":0,"suffix":"주","prefix":"수량 "}],"s079":["remn_amt",{"kind":"korean","sign":false,"tone":"neutral","scale":"백만","suffix":"원","prefix":"금액 "}],"s092":["rmnd",{"kind":"number","precision":0,"suffix":"주","prefix":"수량 "}],"s093":["remn_amt",{"kind":"korean","sign":false,"tone":"neutral","scale":"백만","suffix":"원","prefix":"금액 "}],"s106":["rmnd",{"kind":"number","precision":0,"suffix":"주","prefix":"수량 "}],"s107":["remn_amt",{"kind":"korean","sign":false,"tone":"neutral","scale":"백만","suffix":"원","prefix":"금액 "}],"s120":["rmnd",{"kind":"number","precision":0,"suffix":"주","prefix":"수량 "}],"s121":["remn_amt",{"kind":"korean","sign":false,"tone":"neutral","scale":"백만","suffix":"원","prefix":"금액 "}],"s136":["rmnd",{"kind":"number","precision":0,"suffix":"주","prefix":"수량 "}],"s137":["remn_amt",{"kind":"korean","sign":false,"tone":"neutral","scale":"백만","suffix":"원","prefix":"금액 "}],"s150":["rmnd",{"kind":"number","precision":0,"suffix":"주","prefix":"수량 "}],"s151":["remn_amt",{"kind":"korean","sign":false,"tone":"neutral","scale":"백만","suffix":"원","prefix":"금액 "}]}},
  "2ZTA-0": {"table":"38MX-0","groups":[["38MX-0","조회 내역",["s041","s042","s043","s044","s045","s046","s047","s048","s049","s053","s055","s056","s057","s058","s059","s060","s061","s062","s063","s067","s069","s070","s071","s072","s073","s074","s075","s076","s077","s081","s083","s084","s085","s086","s087","s088","s089","s090","s091","s095","s097","s098","s099","s100","s101","s102","s103","s104","s105","s109","s113","s114","s115","s116","s117","s118","s119","s120","s121","s125","s127","s128","s129","s130","s131","s132","s133","s134","s135","s139","s141","s142","s143","s144","s145","s146","s147","s148","s149","s153"]],["3H8X-0","첫 조회 종목",["s158","s159","s165"]],["3H9A-0","한도 요약",[]],["3SQH-0","첫5개 소진율 증가",["s178","s179","s180","s181","s182","s183","s184","s185","s186","s187"]],["3H94-0","별도 종목 조회 지분율",["s163"]]],"cells":[{"node":"2ZY7-0","sort":true,"slots":[]},{"node":"2ZY3-0","sort":false,"slots":["s013"]},{"node":"2ZXZ-0","sort":false,"slots":["s016"]},{"node":"2ZXV-0","sort":false,"slots":[]},{"node":"2ZXR-0","sort":false,"slots":[]}],"optionalRows":[["3H91-0",["s161"]],["3H97-0",["s165"]],["3H9F-0",["s169"]],["3H9L-0",["s171"]],["3H9R-0",["s173"]],["3H9U-0",["s175"]]],"omitted":["s050","s051","s052","s054","s064","s065","s066","s068","s078","s079","s080","s082","s092","s093","s094","s096","s106","s107","s108","s110","s122","s123","s124","s126","s136","s137","s138","s140","s150","s151","s152","s154"],"omittedNodes":["38O6-0","38O8-0","38O9-0","38OC-0","38OR-0","38OT-0","38OU-0","38OX-0","38YL-0","38YN-0","38YO-0","38YR-0","38Z6-0","38Z8-0","38Z9-0","38ZC-0","38ZR-0","38ZT-0","38ZU-0","38ZX-0","390C-0","390E-0","390F-0","390I-0","38NL-0","38NN-0","38NO-0","38NR-0","390X-0","390Z-0","3910-0","3913-0"],"hiddenNodes":["3SQB-0","2ZUS-0"],"mini":{"node":"3SQH-0","pairs":[["s178","s179"],["s180","s181"],["s182","s183"],["s184","s185"],["s186","s187"]]},"summary":null,"formats":{"s045":["pred_pre",{"kind":"number","sign":true,"precision":0,"tone":"change","prefix":"전일비 ","suffix":"원"}],"s047":["base_limit_exh_rt",{"kind":"percent","precision":2,"prefix":"기준 "}],"s059":["pred_pre",{"kind":"number","sign":true,"precision":0,"tone":"change","prefix":"전일비 ","suffix":"원"}],"s061":["base_limit_exh_rt",{"kind":"percent","precision":2,"prefix":"기준 "}],"s073":["pred_pre",{"kind":"number","sign":true,"precision":0,"tone":"change","prefix":"전일비 ","suffix":"원"}],"s075":["base_limit_exh_rt",{"kind":"percent","precision":2,"prefix":"기준 "}],"s087":["pred_pre",{"kind":"number","sign":true,"precision":0,"tone":"change","prefix":"전일비 ","suffix":"원"}],"s089":["base_limit_exh_rt",{"kind":"percent","precision":2,"prefix":"기준 "}],"s101":["pred_pre",{"kind":"number","sign":true,"precision":0,"tone":"change","prefix":"전일비 ","suffix":"원"}],"s103":["base_limit_exh_rt",{"kind":"percent","precision":2,"prefix":"기준 "}],"s117":["pred_pre",{"kind":"number","sign":true,"precision":0,"tone":"change","prefix":"전일비 ","suffix":"원"}],"s119":["base_limit_exh_rt",{"kind":"percent","precision":2,"prefix":"기준 "}],"s131":["pred_pre",{"kind":"number","sign":true,"precision":0,"tone":"change","prefix":"전일비 ","suffix":"원"}],"s133":["base_limit_exh_rt",{"kind":"percent","precision":2,"prefix":"기준 "}],"s145":["pred_pre",{"kind":"number","sign":true,"precision":0,"tone":"change","prefix":"전일비 ","suffix":"원"}],"s147":["base_limit_exh_rt",{"kind":"percent","precision":2,"prefix":"기준 "}]}},
  "30TY-0": {"table":"362Z-0","groups":[["362Z-0","조회 내역",["s047","s048","s049","s050","s051","s052","s053","s055","s057","s058","s059","s061","s062","s063","s064","s065","s066","s067","s069","s071","s072","s073","s075","s076","s077","s078","s079","s080","s081","s083","s085","s086","s087","s089","s090","s091","s092","s093","s094","s095","s097","s099","s100","s101","s103","s104","s105","s106","s107","s108","s109","s111","s113","s114","s115","s117","s118","s119","s120","s121","s122","s123","s125","s127","s128","s129","s134","s135","s136","s137","s138","s139","s140","s142","s144","s145","s146","s148","s149","s150","s151","s152","s153","s154","s156","s158","s159","s160"]],["3CKK-0","별도 종목별 증권사 조회",["s168","s171","s174","s177","s179"]],["3CLF-0","별도 종목·증권사 일별 조회",["s184","s185","s187","s188","s190","s191"]],["3S7F-0","별도 증권사 조회",["s195","s196","s197","s198","s199","s200","s201","s202","s203","s204","s205","s206"]]],"cells":[{"node":"30YV-0","sort":true,"slots":[]},{"node":"30YR-0","sort":false,"slots":[]},{"node":"30YN-0","sort":false,"slots":[]},{"node":"30YJ-0","sort":false,"slots":[]},{"node":"30YF-0","sort":false,"slots":[]}],"optionalRows":[["flow-five-summary-s168",["s168"]],["flow-five-summary-s171",["s171"]],["flow-five-summary-s174",["s174"]],["flow-five-summary-s177",["s177"]],["flow-five-summary-s179",["s179"]],["3CLC-0",["s181"]],["3CLL-0",["s185"]],["3CLQ-0",["s188"]],["3CLV-0",["s191"]]],"omitted":["s054","s056","s060","s068","s070","s074","s082","s084","s088","s096","s098","s102","s110","s112","s116","s124","s126","s130","s141","s143","s147","s155","s157","s161"],"omittedNodes":["363L-0","363O-0","363T-0","3646-0","3649-0","364E-0","364R-0","364U-0","364Z-0","365C-0","365F-0","365K-0","36AI-0","36AL-0","36AQ-0","36B3-0","36B6-0","36BB-0","36BO-0","36BR-0","36BW-0","36C9-0","36CC-0","36CH-0"],"hiddenNodes":["315U-0","3S6W-0","30VE-0","30VG-0"],"mini":{"node":"3S7F-0","pairs":[["s195","s196"],["s197","s198"],["s199","s200"],["s201","s202"],["s203","s204"],["s205","s206"]]},"summary":[["s167","s168"],["s170","s171"],["s173","s174"],["s176","s177"],["s178","s179"]],"formats":{"s051":["pred_pre",{"kind":"number","sign":true,"precision":0,"tone":"change","prefix":"전일비 ","suffix":"원"}],"s052":["netprps_prica",{"kind":"korean","sign":true,"tone":"change","scale":"백만","suffix":"원","prefix":"금액 "}],"s053":["netprps_trde_qty",{"kind":"number","precision":0,"suffix":"주","sign":true,"tone":"change","prefix":"수량 "}],"s058":["trde_qty",{"kind":"number","precision":0,"suffix":"주","sign":false,"tone":"neutral","prefix":"수량 "}],"s059":["trde_prica",{"kind":"korean","sign":true,"tone":"change","scale":"백만","suffix":"원","prefix":"금액 "}],"s065":["pred_pre",{"kind":"number","sign":true,"precision":0,"tone":"change","prefix":"전일비 ","suffix":"원"}],"s066":["netprps_prica",{"kind":"korean","sign":true,"tone":"change","scale":"백만","suffix":"원","prefix":"금액 "}],"s067":["netprps_trde_qty",{"kind":"number","precision":0,"suffix":"주","sign":true,"tone":"change","prefix":"수량 "}],"s072":["trde_qty",{"kind":"number","precision":0,"suffix":"주","sign":false,"tone":"neutral","prefix":"수량 "}],"s073":["trde_prica",{"kind":"korean","sign":true,"tone":"change","scale":"백만","suffix":"원","prefix":"금액 "}],"s079":["pred_pre",{"kind":"number","sign":true,"precision":0,"tone":"change","prefix":"전일비 ","suffix":"원"}],"s080":["netprps_prica",{"kind":"korean","sign":true,"tone":"change","scale":"백만","suffix":"원","prefix":"금액 "}],"s081":["netprps_trde_qty",{"kind":"number","precision":0,"suffix":"주","sign":true,"tone":"change","prefix":"수량 "}],"s086":["trde_qty",{"kind":"number","precision":0,"suffix":"주","sign":false,"tone":"neutral","prefix":"수량 "}],"s087":["trde_prica",{"kind":"korean","sign":true,"tone":"change","scale":"백만","suffix":"원","prefix":"금액 "}],"s093":["pred_pre",{"kind":"number","sign":true,"precision":0,"tone":"change","prefix":"전일비 ","suffix":"원"}],"s094":["netprps_prica",{"kind":"korean","sign":true,"tone":"change","scale":"백만","suffix":"원","prefix":"금액 "}],"s095":["netprps_trde_qty",{"kind":"number","precision":0,"suffix":"주","sign":true,"tone":"change","prefix":"수량 "}],"s100":["trde_qty",{"kind":"number","precision":0,"suffix":"주","sign":false,"tone":"neutral","prefix":"수량 "}],"s101":["trde_prica",{"kind":"korean","sign":true,"tone":"change","scale":"백만","suffix":"원","prefix":"금액 "}],"s107":["pred_pre",{"kind":"number","sign":true,"precision":0,"tone":"change","prefix":"전일비 ","suffix":"원"}],"s108":["netprps_prica",{"kind":"korean","sign":true,"tone":"change","scale":"백만","suffix":"원","prefix":"금액 "}],"s109":["netprps_trde_qty",{"kind":"number","precision":0,"suffix":"주","sign":true,"tone":"change","prefix":"수량 "}],"s114":["trde_qty",{"kind":"number","precision":0,"suffix":"주","sign":false,"tone":"neutral","prefix":"수량 "}],"s115":["trde_prica",{"kind":"korean","sign":true,"tone":"change","scale":"백만","suffix":"원","prefix":"금액 "}],"s121":["pred_pre",{"kind":"number","sign":true,"precision":0,"tone":"change","prefix":"전일비 ","suffix":"원"}],"s122":["netprps_prica",{"kind":"korean","sign":true,"tone":"change","scale":"백만","suffix":"원","prefix":"금액 "}],"s123":["netprps_trde_qty",{"kind":"number","precision":0,"suffix":"주","sign":true,"tone":"change","prefix":"수량 "}],"s128":["trde_qty",{"kind":"number","precision":0,"suffix":"주","sign":false,"tone":"neutral","prefix":"수량 "}],"s129":["trde_prica",{"kind":"korean","sign":true,"tone":"change","scale":"백만","suffix":"원","prefix":"금액 "}],"s138":["pred_pre",{"kind":"number","sign":true,"precision":0,"tone":"change","prefix":"전일비 ","suffix":"원"}],"s139":["netprps_prica",{"kind":"korean","sign":true,"tone":"change","scale":"백만","suffix":"원","prefix":"금액 "}],"s140":["netprps_trde_qty",{"kind":"number","precision":0,"suffix":"주","sign":true,"tone":"change","prefix":"수량 "}],"s145":["trde_qty",{"kind":"number","precision":0,"suffix":"주","sign":false,"tone":"neutral","prefix":"수량 "}],"s146":["trde_prica",{"kind":"korean","sign":true,"tone":"change","scale":"백만","suffix":"원","prefix":"금액 "}],"s152":["pred_pre",{"kind":"number","sign":true,"precision":0,"tone":"change","prefix":"전일비 ","suffix":"원"}],"s153":["netprps_prica",{"kind":"korean","sign":true,"tone":"change","scale":"백만","suffix":"원","prefix":"금액 "}],"s154":["netprps_trde_qty",{"kind":"number","precision":0,"suffix":"주","sign":true,"tone":"change","prefix":"수량 "}],"s159":["trde_qty",{"kind":"number","precision":0,"suffix":"주","sign":false,"tone":"neutral","prefix":"수량 "}],"s160":["trde_prica",{"kind":"korean","sign":true,"tone":"change","scale":"백만","suffix":"원","prefix":"금액 "}]}},
  "31CL-0": {"table":"37AW-0","groups":[["37AW-0","조회 내역",["s041","s042","s043","s044","s045","s046","s047","s048","s049","s050","s051","s052","s053","s054","s055","s056","s057","s058","s059","s060","s061","s062","s063","s064","s065","s066","s067","s068","s069","s070","s071","s072","s073","s074","s075","s076","s077","s078","s079","s080","s081","s082","s083","s084","s085","s086","s087","s088","s089","s090","s091","s092","s093","s094","s095","s096","s097","s098","s099","s100","s101","s102","s103","s104","s105","s106","s107","s108","s109","s110","s111","s112","s113","s114","s115","s116","s117","s118","s119","s120","s121","s122","s123","s124","s127","s128","s129","s130","s131","s132","s133","s134","s135","s136","s137","s138","s139","s140","s141","s142","s143","s144","s145","s146","s147","s148","s149","s150","s151","s152","s153","s154"]],["3I6Z-0","첫 조회 종목",["s158","s159"]],["3I79-0","동일순매매 요약",[]],["3T1K-0","첫6개 조회 금액",["s176","s177","s178","s179","s180","s181","s182","s183","s184","s185","s186","s187"]]],"cells":[{"node":"31HI-0","sort":true,"slots":[]},{"node":"31HE-0","sort":false,"slots":[]},{"node":"31HA-0","sort":false,"slots":[]},{"node":"31H6-0","sort":false,"slots":["s020"]},{"node":"31H2-0","sort":false,"slots":[]}],"optionalRows":[["3I73-0",["s161"]],["3I76-0",["s163"]],["3I7E-0",["s167"]],["3I7K-0",["s169"]],["3I7Q-0",["s171"]],["3I7T-0",["s173"]]],"omitted":["s126","s172","s173"],"omittedNodes":["3T6B-0","3I7U-0","3I7V-0"],"hiddenNodes":["3I73-0","3T1G-0","31E3-0"],"mini":{"node":"3T1K-0","pairs":[["s176","s177"],["s178","s179"],["s180","s181"],["s182","s183"],["s184","s185"],["s186","s187"]]},"summary":null,"formats":{"s045":["pred_pre",{"kind":"number","sign":true,"precision":0,"tone":"change","prefix":"전일비 ","suffix":"원"}],"s046":["for_nettrde_amt",{"kind":"korean","sign":true,"tone":"change","scale":"백만","suffix":"원","prefix":"금액 "}],"s047":["for_nettrde_qty",{"kind":"number","precision":0,"sign":true,"tone":"change","prefix":"수량 ","suffix":" (단위 미확인)"}],"s048":["orgn_nettrde_amt",{"kind":"korean","sign":true,"tone":"change","scale":"백만","suffix":"원","prefix":"금액 "}],"s049":["orgn_nettrde_qty",{"kind":"number","precision":0,"sign":true,"tone":"change","prefix":"수량 ","suffix":" (단위 미확인)"}],"s050":["nettrde_amt",{"kind":"korean","sign":true,"tone":"change","scale":"백만","suffix":"원","prefix":"금액 "}],"s051":["nettrde_qty",{"kind":"number","precision":0,"sign":true,"tone":"change","prefix":"수량 ","suffix":" (단위 미확인)"}],"s052":["for_nettrde_avg_pric",{"kind":"number","precision":2,"prefix":"외국인 ","suffix":" (단위 확인 필요)"}],"s053":["orgn_nettrde_avg_pric",{"kind":"number","precision":2,"prefix":"기관 ","suffix":" (단위 확인 필요)"}],"s059":["pred_pre",{"kind":"number","sign":true,"precision":0,"tone":"change","prefix":"전일비 ","suffix":"원"}],"s060":["for_nettrde_amt",{"kind":"korean","sign":true,"tone":"change","scale":"백만","suffix":"원","prefix":"금액 "}],"s061":["for_nettrde_qty",{"kind":"number","precision":0,"sign":true,"tone":"change","prefix":"수량 ","suffix":" (단위 미확인)"}],"s062":["orgn_nettrde_amt",{"kind":"korean","sign":true,"tone":"change","scale":"백만","suffix":"원","prefix":"금액 "}],"s063":["orgn_nettrde_qty",{"kind":"number","precision":0,"sign":true,"tone":"change","prefix":"수량 ","suffix":" (단위 미확인)"}],"s064":["nettrde_amt",{"kind":"korean","sign":true,"tone":"change","scale":"백만","suffix":"원","prefix":"금액 "}],"s065":["nettrde_qty",{"kind":"number","precision":0,"sign":true,"tone":"change","prefix":"수량 ","suffix":" (단위 미확인)"}],"s066":["for_nettrde_avg_pric",{"kind":"number","precision":2,"prefix":"외국인 ","suffix":" (단위 확인 필요)"}],"s067":["orgn_nettrde_avg_pric",{"kind":"number","precision":2,"prefix":"기관 ","suffix":" (단위 확인 필요)"}],"s073":["pred_pre",{"kind":"number","sign":true,"precision":0,"tone":"change","prefix":"전일비 ","suffix":"원"}],"s074":["for_nettrde_amt",{"kind":"korean","sign":true,"tone":"change","scale":"백만","suffix":"원","prefix":"금액 "}],"s075":["for_nettrde_qty",{"kind":"number","precision":0,"sign":true,"tone":"change","prefix":"수량 ","suffix":" (단위 미확인)"}],"s076":["orgn_nettrde_amt",{"kind":"korean","sign":true,"tone":"change","scale":"백만","suffix":"원","prefix":"금액 "}],"s077":["orgn_nettrde_qty",{"kind":"number","precision":0,"sign":true,"tone":"change","prefix":"수량 ","suffix":" (단위 미확인)"}],"s078":["nettrde_amt",{"kind":"korean","sign":true,"tone":"change","scale":"백만","suffix":"원","prefix":"금액 "}],"s079":["nettrde_qty",{"kind":"number","precision":0,"sign":true,"tone":"change","prefix":"수량 ","suffix":" (단위 미확인)"}],"s080":["for_nettrde_avg_pric",{"kind":"number","precision":2,"prefix":"외국인 ","suffix":" (단위 확인 필요)"}],"s081":["orgn_nettrde_avg_pric",{"kind":"number","precision":2,"prefix":"기관 ","suffix":" (단위 확인 필요)"}],"s087":["pred_pre",{"kind":"number","sign":true,"precision":0,"tone":"change","prefix":"전일비 ","suffix":"원"}],"s088":["for_nettrde_amt",{"kind":"korean","sign":true,"tone":"change","scale":"백만","suffix":"원","prefix":"금액 "}],"s089":["for_nettrde_qty",{"kind":"number","precision":0,"sign":true,"tone":"change","prefix":"수량 ","suffix":" (단위 미확인)"}],"s090":["orgn_nettrde_amt",{"kind":"korean","sign":true,"tone":"change","scale":"백만","suffix":"원","prefix":"금액 "}],"s091":["orgn_nettrde_qty",{"kind":"number","precision":0,"sign":true,"tone":"change","prefix":"수량 ","suffix":" (단위 미확인)"}],"s092":["nettrde_amt",{"kind":"korean","sign":true,"tone":"change","scale":"백만","suffix":"원","prefix":"금액 "}],"s093":["nettrde_qty",{"kind":"number","precision":0,"sign":true,"tone":"change","prefix":"수량 ","suffix":" (단위 미확인)"}],"s094":["for_nettrde_avg_pric",{"kind":"number","precision":2,"prefix":"외국인 ","suffix":" (단위 확인 필요)"}],"s095":["orgn_nettrde_avg_pric",{"kind":"number","precision":2,"prefix":"기관 ","suffix":" (단위 확인 필요)"}],"s101":["pred_pre",{"kind":"number","sign":true,"precision":0,"tone":"change","prefix":"전일비 ","suffix":"원"}],"s102":["for_nettrde_amt",{"kind":"korean","sign":true,"tone":"change","scale":"백만","suffix":"원","prefix":"금액 "}],"s103":["for_nettrde_qty",{"kind":"number","precision":0,"sign":true,"tone":"change","prefix":"수량 ","suffix":" (단위 미확인)"}],"s104":["orgn_nettrde_amt",{"kind":"korean","sign":true,"tone":"change","scale":"백만","suffix":"원","prefix":"금액 "}],"s105":["orgn_nettrde_qty",{"kind":"number","precision":0,"sign":true,"tone":"change","prefix":"수량 ","suffix":" (단위 미확인)"}],"s106":["nettrde_amt",{"kind":"korean","sign":true,"tone":"change","scale":"백만","suffix":"원","prefix":"금액 "}],"s107":["nettrde_qty",{"kind":"number","precision":0,"sign":true,"tone":"change","prefix":"수량 ","suffix":" (단위 미확인)"}],"s108":["for_nettrde_avg_pric",{"kind":"number","precision":2,"prefix":"외국인 ","suffix":" (단위 확인 필요)"}],"s109":["orgn_nettrde_avg_pric",{"kind":"number","precision":2,"prefix":"기관 ","suffix":" (단위 확인 필요)"}],"s115":["pred_pre",{"kind":"number","sign":true,"precision":0,"tone":"change","prefix":"전일비 ","suffix":"원"}],"s116":["for_nettrde_amt",{"kind":"korean","sign":true,"tone":"change","scale":"백만","suffix":"원","prefix":"금액 "}],"s117":["for_nettrde_qty",{"kind":"number","precision":0,"sign":true,"tone":"change","prefix":"수량 ","suffix":" (단위 미확인)"}],"s118":["orgn_nettrde_amt",{"kind":"korean","sign":true,"tone":"change","scale":"백만","suffix":"원","prefix":"금액 "}],"s119":["orgn_nettrde_qty",{"kind":"number","precision":0,"sign":true,"tone":"change","prefix":"수량 ","suffix":" (단위 미확인)"}],"s120":["nettrde_amt",{"kind":"korean","sign":true,"tone":"change","scale":"백만","suffix":"원","prefix":"금액 "}],"s121":["nettrde_qty",{"kind":"number","precision":0,"sign":true,"tone":"change","prefix":"수량 ","suffix":" (단위 미확인)"}],"s122":["for_nettrde_avg_pric",{"kind":"number","precision":2,"prefix":"외국인 ","suffix":" (단위 확인 필요)"}],"s123":["orgn_nettrde_avg_pric",{"kind":"number","precision":2,"prefix":"기관 ","suffix":" (단위 확인 필요)"}],"s131":["pred_pre",{"kind":"number","sign":true,"precision":0,"tone":"change","prefix":"전일비 ","suffix":"원"}],"s132":["for_nettrde_amt",{"kind":"korean","sign":true,"tone":"change","scale":"백만","suffix":"원","prefix":"금액 "}],"s133":["for_nettrde_qty",{"kind":"number","precision":0,"sign":true,"tone":"change","prefix":"수량 ","suffix":" (단위 미확인)"}],"s134":["orgn_nettrde_amt",{"kind":"korean","sign":true,"tone":"change","scale":"백만","suffix":"원","prefix":"금액 "}],"s135":["orgn_nettrde_qty",{"kind":"number","precision":0,"sign":true,"tone":"change","prefix":"수량 ","suffix":" (단위 미확인)"}],"s136":["nettrde_amt",{"kind":"korean","sign":true,"tone":"change","scale":"백만","suffix":"원","prefix":"금액 "}],"s137":["nettrde_qty",{"kind":"number","precision":0,"sign":true,"tone":"change","prefix":"수량 ","suffix":" (단위 미확인)"}],"s138":["for_nettrde_avg_pric",{"kind":"number","precision":2,"prefix":"외국인 ","suffix":" (단위 확인 필요)"}],"s139":["orgn_nettrde_avg_pric",{"kind":"number","precision":2,"prefix":"기관 ","suffix":" (단위 확인 필요)"}],"s145":["pred_pre",{"kind":"number","sign":true,"precision":0,"tone":"change","prefix":"전일비 ","suffix":"원"}],"s146":["for_nettrde_amt",{"kind":"korean","sign":true,"tone":"change","scale":"백만","suffix":"원","prefix":"금액 "}],"s147":["for_nettrde_qty",{"kind":"number","precision":0,"sign":true,"tone":"change","prefix":"수량 ","suffix":" (단위 미확인)"}],"s148":["orgn_nettrde_amt",{"kind":"korean","sign":true,"tone":"change","scale":"백만","suffix":"원","prefix":"금액 "}],"s149":["orgn_nettrde_qty",{"kind":"number","precision":0,"sign":true,"tone":"change","prefix":"수량 ","suffix":" (단위 미확인)"}],"s150":["nettrde_amt",{"kind":"korean","sign":true,"tone":"change","scale":"백만","suffix":"원","prefix":"금액 "}],"s151":["nettrde_qty",{"kind":"number","precision":0,"sign":true,"tone":"change","prefix":"수량 ","suffix":" (단위 미확인)"}],"s152":["for_nettrde_avg_pric",{"kind":"number","precision":2,"prefix":"외국인 ","suffix":" (단위 확인 필요)"}],"s153":["orgn_nettrde_avg_pric",{"kind":"number","precision":2,"prefix":"기관 ","suffix":" (단위 확인 필요)"}]}},
};
function prepareFlowRankFive(surface,contract) {
 const cfg=FLOW_RANK_FIVE[contract.board_id];if(!cfg)return;
 surface.classList.add('bs-flow-rank-five');
 const sourceNodes=new Map(contract.slots.map(s=>[s.slot_id,authoredNode(surface,s.node||s.node_id)]));
 for(const id of cfg.hiddenNodes)authoredNode(surface,id)?.classList.add('bs-flow-five-unsupported');
 if(contract.board_id==='2ZTA-0'){
  const row=authoredNode(surface,'3H94-0'),rail=surface.querySelector('.bs-rail');if(row&&rail){row.classList.add('bs-flow-five-separate');rail.append(row);}
 }
 if(cfg.mini){
  const group=authoredNode(surface,cfg.mini.node);group?.querySelector('.bs-unavailable-graphic-message')?.remove();
  const nodes=new Map(contract.slots.map(s=>[s.slot_id,authoredNode(surface,s.node||s.node_id)]));
  const list=layoutGroup(surface.ownerDocument,'bs-flow-five-mini');
  for(const pair of cfg.mini.pairs){const row=layoutGroup(surface.ownerDocument,'bs-flow-five-mini-row');for(const slot of pair){const e=nodes.get(slot);if(e)row.append(e);}list.append(row);}
  for(const child of [...group.children])child.classList.add('bs-flow-five-unsupported');
  const title=layoutGroup(surface.ownerDocument,'bs-flow-five-mini-title');title.textContent=cfg.groups.find(g=>g[0]===cfg.mini.node)[1];group.append(title);
  group.append(list);
 }
 if(cfg.summary){
  const group=authoredNode(surface,'3CKK-0'),rows=[];
  for(const[caption,value]of cfg.summary){const row=layoutGroup(surface.ownerDocument,'bs-flow-five-summary-row');row.dataset.node='flow-five-summary-'+value;row.append(sourceNodes.get(caption),sourceNodes.get(value));rows.push(row);}
  for(const child of [...group.children])child.classList.add('bs-flow-five-unsupported');
  const title=layoutGroup(surface.ownerDocument,'bs-flow-five-mini-title');title.textContent='별도 종목별 증권사 조회';group.append(title,...rows);
 }
 for(const[id]of cfg.groups)authoredNode(surface,id)?.classList.add('bs-ranking-managed');
}
function updateFlowRankFive(surface,plan) {
 const cfg=FLOW_RANK_FIVE[surface.dataset?.bsBoardId];if(!cfg)return;
 const states=surface.__bsFlowFiveStates||(surface.__bsFlowFiveStates=new Map());for(const a of plan.assignments)states.set(a.slotId,a);
 const received=a=>a&&!a.missing&&!a.empty&&!a.pending&&!a.designText&&String(a.text).trim();
 for(const id of cfg.omittedNodes)for(const e of surface.querySelectorAll(`[data-node="${id}"]`))e.classList.add('bs-flow-five-unsupported');
 for(const[id,title,ids]of cfg.groups){const group=authoredNode(surface,id);if(!group)continue;const values=ids.map(s=>states.get(s)),empty=!values.some(received),pending=values.some(a=>a?.pending);group.classList.toggle('bs-ranking-unavailable-group',empty);
  for(let box=group;box&&box!==surface;box=box.parentElement){if(surface.__bsEmptyValueHidden?.has(box)||box.dataset.bsUnavailableHidden==='true'||box.dataset.bsRowCollapsed==='true'){setHidden(box,false);surface.__bsEmptyValueHidden?.delete(box);delete box.dataset.bsUnavailableHidden;delete box.dataset.bsRowCollapsed;}if(box.matches('.bs-rail,.bs-primary'))break;}
  let note=group.querySelector(':scope > .bs-ranking-unavailable-note');if(empty&&!note){note=layoutGroup(surface.ownerDocument,'bs-ranking-unavailable-note');note.setAttribute('role','status');group.append(note);}if(note){note.hidden=!empty;note.textContent=title+(pending?' 수신 대기':' 미제공');}
 }
 const kpi=surface.querySelector('.bs-kpi');let hasMetric=false,pendingMetric=false;
 for(const c of cfg.cells){const cell=authoredNode(surface,c.node);if(!cell)continue;cell.classList.toggle('bs-flow-five-sort',c.sort);const values=c.slots.map(s=>states.get(s)),present=values.some(received);hasMetric||=present;pendingMetric||=values.some(a=>a?.pending);cell.classList.toggle('bs-flow-five-empty',!c.sort&&!present);if(present){setHidden(cell,false);surface.__bsEmptyValueHidden?.delete(cell);}}
 if(kpi){let note=kpi.querySelector(':scope > .bs-flow-five-kpi-note');if(!note){note=layoutGroup(surface.ownerDocument,'bs-flow-five-kpi-note');kpi.append(note);}note.hidden=hasMetric;note.textContent=pendingMetric?'요약 지표 수신 대기':'요약 지표 미제공';}
 for(const[id,ids]of cfg.optionalRows){const row=authoredNode(surface,id);if(!row)continue;const empty=!ids.some(s=>received(states.get(s)));row.classList.toggle('bs-flow-five-empty',empty);if(!empty){delete row.dataset.bsRowCollapsed;row.classList.remove('bs-row-collapsed');setHidden(row,false);}}
 for(const row of authoredNode(surface,cfg.table)?.querySelectorAll('[data-row]')||[]){if(row.dataset.row==='head')continue;const ids=[...row.querySelectorAll('[data-slot-id]')].map(n=>n.dataset.slotId),empty=!ids.some(id=>received(states.get(id)));row.classList.toggle('bs-flow-five-empty',empty);if(!empty){delete row.dataset.bsRowCollapsed;row.classList.remove('bs-row-collapsed');setHidden(row,false);}}
 if(cfg.mini)for(const row of authoredNode(surface,cfg.mini.node)?.querySelectorAll('.bs-flow-five-mini-row')||[]){const ids=[...row.querySelectorAll('[data-slot-id]')].map(n=>n.dataset.slotId);row.classList.toggle('bs-flow-five-empty',!ids.some(s=>received(states.get(s))));}
 surface.querySelector('.bs-rail')?.classList.add('bs-ranking-compact-rail');
}

function suppressStaticGraphics(surface, contract) {
  const entry = staticGraphics[contract.board_id];
  if (!entry) return;
  const regions = new Set(entry.regions);
  const anchors = new Set(slotList(contract).map(anchorOf));
  for (const id of entry.shapes) {
    const shape = authoredNode(surface, id);
    if (!shape) continue;
    shape.style.display = 'none';
    shape.dataset.bsStaticGraphic = 'true';
    const track = shape.parentElement;
    if (track.children.length === 1 && !regions.has(track.dataset.node)
      && !anchors.has(track.dataset.node) && !anchors.has(shape.dataset.node)) {
      track.style.display = 'none';
    }
    for (let box = track; box && box !== surface; box = box.parentElement) {
      if (regions.has(box.dataset.node)) {
        for (let child = track; child && child !== box; child = child.parentElement) {
          child.classList.add('bs-static-graphic-space');
        }
        break;
      }
    }
  }
  for (const id of regions) {
    const region = authoredNode(surface, id);
    if (!region) continue;
    region.classList.add('bs-static-graphic-space');
    const note = layoutGroup(surface.ownerDocument, 'bs-unavailable-graphic-message');
    note.setAttribute('role', 'status');
    note.textContent = '그래프 데이터가 제공되지 않았습니다';
    region.append(note);
  }
}

function readableTable(surface, contract, config) {
  const owner = authoredNode(surface, config.node);
  const rows = config.rows.map((id) => authoredNode(surface, id));
  if (!owner || rows.some((row) => !row)) return;
  for (const property of ['overflow', 'overflow-x', 'overflow-y']) owner.style.removeProperty(property);
  owner.classList.remove('bs-r-scroll', 'bs-r-scroll-table');
  owner.removeAttribute('tabindex');
  const doc = surface.ownerDocument;
  const viewport = layoutGroup(doc, 'bs-readable-scroll');
  viewport.tabIndex = 0;
  viewport.setAttribute('role', 'region');
  viewport.setAttribute('aria-label', `${config.label} 표, 좌우 방향키로 이동`);
  const inner = layoutGroup(doc, 'bs-readable-table');
  inner.setAttribute('role', 'table');
  inner.setAttribute('aria-label', config.label);
  inner.style.setProperty('--bs-table-width', `${config.widths.reduce((a, b) => a + b, 0) + (config.widths.length - 1) * (config.gap || 0)}px`);
  inner.style.setProperty('--bs-table-gap', `${config.gap || 0}px`);
  let firstRowContainer = rows[0];
  while (firstRowContainer.parentElement !== owner) firstRowContainer = firstRowContainer.parentElement;
  owner.insertBefore(viewport, firstRowContainer);
  viewport.append(inner);
  const sourceParents = new Set(rows.map(row => row.parentElement));
  for (const [rowIndex, row] of rows.entries()) {
    if (!row.dataset.row) row.dataset.row = rowIndex === 0 ? 'head' : String(rowIndex - 1);
    // 병기 사본은 원본 열을 모두 유지하는 이 표에서는 필요 없다.
    for (const mirror of row.querySelectorAll('.bs-paired')) mirror.remove();
    let cells = [...row.querySelectorAll('[data-col]')]
      .filter((cell) => cell.closest('[data-row]') === row);
    if (!cells.length) cells = [...row.children];
    if (contract.board_id === '2SCE-1' && cells.length === 7) {
      cells[1].append(...cells[6].childNodes);
      cells[6].remove();
      cells.pop();
    }
    row.classList.add('bs-readable-row');
    row.setAttribute('role', 'row');
    row.style.removeProperty('gap');
    row.style.removeProperty('padding-inline');
    row.style.removeProperty('padding');
    if ((contract.board_id === '3LGC-0' && row.dataset.node === '3MHR-0')
      || (contract.board_id === '3MTJ-0' && row.dataset.node === '3OQJ-0')) {
      row.style.setProperty('border-left-width', '0');
      row.style.setProperty('box-shadow', 'inset 2px 0 0 var(--color-brand)');
    }
    for (const [index, cell] of cells.entries()) {
      cell.classList.add('bs-readable-cell');
      cell.dataset.col = String(index);
      cell.style.setProperty('--bs-cell-width', `${config.widths[index]}px`);
      cell.setAttribute('role', rowIndex === 0 ? 'columnheader' : 'cell');
      cell.style.removeProperty('justify-content');
      cell.style.removeProperty('align-items');
      for (const node of [cell, ...cell.querySelectorAll('*')]) {
        if (!node.children.length) {
          node.style.removeProperty('font-size');
          node.style.removeProperty('line-height');
          node.style.removeProperty('text-align');
          node.dataset.bsTableText = 'true';
        }
      }
    }
    inner.append(row);
  }
  for (const parent of sourceParents) {
    if (parent === owner || parent.contains(viewport)) continue;
    if (!parent.textContent.trim()) setHidden(parent, true);
    else parent.classList.add('bs-readable-remainder');
  }
  if (firstRowContainer !== rows[0] && firstRowContainer.textContent.trim()) firstRowContainer.after(viewport);
  const hint = layoutGroup(doc, 'bs-readable-hint');
  hint.textContent = '표를 좌우로 이동해 모든 열을 확인하세요';
  viewport.after(hint);
  owner.classList.add('bs-readable-owner');
  if (config.compact) owner.classList.add('bs-readable-compact');
  // These secondary lines belong to another ELW list, not this row's source.
  if (['2XY6-0', '2Y47-0'].includes(contract.board_id)) {
    for (const slot of slotList(contract)) {
      if (!slot.paired_with) continue;
      const node = authoredNode(surface, anchorOf(slot));
      if (!node || !owner.contains(node)) continue;
      const col = node.closest('.bs-readable-cell')?.dataset.col;
      if (col === '5' || (contract.board_id === '2XY6-0' && col === '4')) node.classList.add('bs-elw-unavailable-line');
    }
  }
}

function prepareInvestorGrid(surface, contract) {
  if (contract.board_id !== '3DI2-0') return;
  const groups = [
    { node: '3E9H-0', rows: ['3ED5-0','3EDR-0','3EDZ-0','3ESA-0','3ESI-0','3ESQ-0','3ESY-0','3ET6-0','3ETE-0','3ETM-0','3ETU-0','3EV7-0','3EVF-0','3EVN-0','3EVV-0'], widths: [130,190,190,190,190,190,190], label: '일자별 투자자', headings: [['3EDP-0','3EDR-0'],['3ES8-0','3ESA-0'],['3EV5-0','3EV7-0']] },
    { node: '3E9I-0', rows: ['3F58-0','3F5L-0','3F5Q-0','3F5X-0','3F62-0','3F67-0','3F6C-0','3F6H-0','3F6M-0','3F6R-0','3F6W-0','3F7M-0','3F7R-0','3F7W-0','3F81-0'], widths: [130,190,190,190], label: '장중 투자자', headings: [['3F5J-0','3F5L-0'],['3F5V-0','3F5X-0'],['3F7K-0','3F7M-0']] },
  ];
  for (const group of groups) {
    const owner = authoredNode(surface, group.node);
    owner.classList.add('bs-table');
    readableTable(surface, contract, { ...group, compact: true });
    for (const [headingId, rowId] of group.headings) {
      const heading = authoredNode(surface, headingId);
      authoredNode(surface, rowId).before(heading);
      heading.classList.add('bs-investor-group-title');
    }
  }
}

function prepareAfterhoursDepthTable(surface) {
  const table = authoredNode(surface, '3KG8-0');
  table.classList.add('bs-table', 'bs-depth-scroll');
  table.tabIndex = 0;
  table.setAttribute('role', 'region');
  table.setAttribute('aria-label', '시간외 단일가 5단 호가, 좌우 방향키로 이동');
  for (const property of ['overflow', 'overflow-x', 'overflow-y']) table.style.removeProperty(property);
  for (const mirror of table.querySelectorAll('.bs-paired')) mirror.remove();
  for (const node of [table, ...table.querySelectorAll('*')]) {
    // The source classified an entire depth group as one row. Its five levels
    // must never be hidden as optional columns at a narrow width.
    delete node.dataset.row;
    delete node.dataset.col;
    node.classList.remove('bs-r-paired-table', 'bs-col');
    node.removeAttribute('data-paired-source');
  }
  const stages = ['3L3J-0', '3L3Q-0', '3L3X-0', '3L45-0', '3L4C-0', '3LAA-0', '3LAH-0', '3LAO-0', '3LCJ-0', '3LCQ-0'];
  const rows = [authoredNode(surface, '3KG9-0'), ...stages.map(id => authoredNode(surface, id).parentElement)];
  rows.forEach((row, index) => {
    row.classList.add('bs-depth-row');
    row.dataset.row = index === 0 ? 'head' : `depth-${index}`;
    row.setAttribute('role', 'row');
    delete row.dataset.bsWrapRow;
    row.style.flexWrap = 'nowrap';
    row.style.justifyContent = 'flex-start';
    row.style.gap = '0';
    row.style.removeProperty('padding');
    [...row.children].forEach((cell, col) => {
      cell.dataset.col = String(col);
      cell.setAttribute('role', index === 0 ? 'columnheader' : 'cell');
    });
  });
  const inner = layoutGroup(surface.ownerDocument, 'bs-depth-table');
  inner.append(...table.childNodes);
  table.append(inner);
}

function prepareOrderbookDetails(surface, contract) {
  const id = contract.board_id;
  const sideSlots = {
    '13BC-2': [['s013','s030','s033','s036','s039','s042','s045','s048','s051','s054','s057'], ['s016','s064','s067','s070','s073','s076','s079','s082','s085','s088','s091']],
    '2TRW-1': [['s013','s029','s032','s035','s038','s041','s143'], ['s016','s048','s051','s054','s057','s060']],
    '3JZ3-0': [['s013','s031','s038','s045','s052','s059','s066','s073','s080','s087','s094'], ['s016','s113','s120','s127','s134','s141','s148','s155','s162','s169','s176']],
    '1JPU-0': [['s127','s131','s135','s139','s143','s147','s151','s155','s159','s163'], ['s174','s178','s182','s186','s190','s194','s198','s202','s206','s210']],
    '3N4O-0': [['s018','s024','s030','s036','s042','s048','s054','s060','s066','s072'], ['s089','s095','s101','s107','s113','s119','s125','s131','s137','s143']],
    '2QRP-1': [['s014','s026','s029','s032','s035','s038'], ['s017','s045','s048','s051','s054','s057']],
    '3JT4-0': [['s014','s031','s035','s039','s043','s047'], ['s017','s058','s062','s066','s070','s074']],
    '2ZN9-0': [['s060','s074','s089','s103','s117','s131','s145','s160'], ['s061','s075','s090','s104','s118','s132','s146','s161']],
  }[id];
  if (!sideSlots) return;
  const slots = new Map(contract.slots.map(slot => [slot.slot_id, slot]));
  const anchors = nodeIndex(surface);
  const valueNode = slot => anchors.get(anchorOf(slots.get(slot)));
  for (const [node, ids] of ORDERBOOK_DETAIL_GROUPS[id] || []) {
    authoredNode(surface, node)?.classList.add('bs-orderbook-managed');
    for (const slot of ids) {
      const value = valueNode(slot);
      if (value) value.dataset.bsKeepMissing = 'true';
    }
  }
  for (const node of { '3JZ3-0': ['3UD4-0'], '3JT4-0': ['3JV4-0'] }[id] || []) {
    const control = authoredNode(surface, node);
    if (control) control.dataset.bsOrderbookControl = 'true';
  }
  sideSlots.forEach((ids, index) => {
    for (const slot of ids) {
      const value = valueNode(slot);
      if (value) value.dataset.bsQuoteSide = index === 0 ? 'ask' : 'bid';
    }
  });
  const footer = {
    '13BC-2': [['s164','상한가'], ['s165','하한가'], ['s166','전일종가']],
    '2TRW-1': [['s145','상한가'], ['s146','하한가'], ['s147','전일종가']],
    '3JZ3-0': [['s236','상한가'], ['s237','하한가'], ['s238','전일종가']],
    '1JPU-0': [['s226','현재가'], ['s261','매도 호가'], ['s263','매수 호가']],
    '3N4O-0': [['s188','매도 체결'], ['s190','매수 체결']],
    '2QRP-1': [['s060','매도 잔량'], ['s062','매수 잔량']],
  }[id] || [];
  for (const [slot, text] of footer) {
    const value = valueNode(slot);
    if (!value || value.parentElement.classList.contains('bs-quote-labelled-value')) continue;
    const item = layoutGroup(surface.ownerDocument, 'bs-quote-labelled-value');
    const label = layoutGroup(surface.ownerDocument, 'bs-quote-value-label');
    label.textContent = text;
    item.dataset.bsKeepMissing = 'true';
    value.dataset.bsKeepMissing = 'true';
    value.before(item);
    item.append(label, value);
  }
  const unsupported = {
    '2TRW-1': ['3JSP-0'],
    '3JZ3-0': ['3U8G-0','3UD6-0'],
    '2QRP-1': ['2QUG-1','2QVO-1','2QVW-1','2QVY-1','2QVZ-1','2QWE-1','2QWK-1'],
    '3JT4-0': ['3L4W-0','3UJ4-0','3UJH-0','3UJN-0'],
  }[id] || [];
  for (const node of unsupported) authoredNode(surface, node)?.classList.add('bs-orderbook-unsupported');
  // After-hours history and optional money fields have no response source.
  const unavailable = {
    '2TRW-1': ['s026','s030','s033','s036','s039','s042','s049','s052','s055','s058','s061'],
    '2QRP-1': ['s109'],
    '3JT4-0': ['s098','s100','s101','s102','s103','s109','s113','s123'],
  }[id] || [];
  for (const slot of unavailable) valueNode(slot)?.classList.add('bs-orderbook-unsupported');
  if (id === '2TRW-1') {
    const summary = authoredNode(surface, '33L5-0');
    for (const mirror of summary.querySelectorAll('.bs-paired')) mirror.remove();
    for (const wrapper of summary.querySelectorAll('.bs-col')) wrapper.replaceWith(...wrapper.childNodes);
    for (const node of [summary, ...summary.querySelectorAll('[data-col], [data-row]')]) {
      delete node.dataset.row;
      delete node.dataset.col;
      node.classList.remove('bs-col');
    }
    summary.classList.add('bs-quote-totals', 'bs-orderbook-managed');
    valueNode('s064').dataset.bsKeepMissing = 'true';
  }
}

function prepareSessionQuoteTable(surface) {
  const table = authoredNode(surface, '2QT1-1');
  table.classList.add('bs-table');
  for (const property of ['overflow', 'overflow-x', 'overflow-y']) table.style.removeProperty(property);
  for (const mirror of table.querySelectorAll('.bs-paired')) mirror.remove();
  // The extracted ask/bid group is not a row: each child is one quote level.
  for (const node of [table, ...table.querySelectorAll('*')]) {
    delete node.dataset.row;
    delete node.dataset.col;
    node.classList.remove('bs-r-paired-table', 'bs-col');
    node.removeAttribute('data-paired-source');
  }
  const rows = ['2QT9-1', '2QTH-1', '2QTO-1', '2QTV-1', '2QU2-1', '2QU9-1', '2QUN-1', '2QUU-1', '2QV1-1', '2QV8-1', '2QVF-1'];
  rows.forEach((id, index) => {
    const row = authoredNode(surface, id);
    row.classList.add('bs-session-quote-row');
    row.dataset.row = index === 0 ? 'head' : `quote-${index}`;
    row.setAttribute('role', 'row');
    delete row.dataset.bsWrapRow;
    row.style.flexWrap = 'nowrap';
    [...row.children].forEach((cell, col) => {
      cell.dataset.col = String(col);
      cell.setAttribute('role', index === 0 ? 'columnheader' : 'cell');
    });
  });
  const scroll = layoutGroup(surface.ownerDocument, 'bs-session-quote-scroll');
  scroll.tabIndex = 0;
  scroll.setAttribute('role', 'region');
  scroll.setAttribute('aria-label', '시간외 단일가 호가, 좌우 방향키로 이동');
  const inner = layoutGroup(surface.ownerDocument, 'bs-session-quote-table');
  const header = authoredNode(surface, '2QT9-1');
  header.before(scroll);
  inner.append(header, authoredNode(surface, '2QTH-1').parentElement, authoredNode(surface, '2QUN-1').parentElement);
  scroll.append(inner);
}

const WATCH_DETAIL_CONFIG = {
 '2U5L-1':{hide:['s003','s016','s017','s018','s019','s020','s191','s194','s200','s202','s203','s207','s210','s213','s216','s219','s220','s221'],captions:{s195:'현재가',s197:'거래량',s206:'조회 그룹'},groups:[['2UBA-1',[],'편입 기준'],['2UBD-1',[],'관심 신호'],['33QH-0',['s208','s209','s211','s212','s214','s215','s217','s218'],'그룹 자료']]},
 '2UBO-1':{hide:['s003','s014','s016','s017','s065','s067','s068','s109','s116','s117','s120','s133','s134'],captions:{s021:'상승 · 하락 종목',s110:'당일 등락률',s118:'응답 주요 종목',s121:'다른 조회 테마'},groups:[['3DUL-0',['s111','s113','s114','s115','s119'],'테마 자료'],['3DVR-0',['s122','s123','s124','s125','s126','s127','s128','s129','s130'],'다른 테마']]},
 '3D4I-0':{hide:['s003','s016','s017','s018','s019','s020','s024','s063','s080','s100','s108'],hideNodes:['3D5O-0'],captions:{s099:'조회 종목',s101:'현재가',s103:'거래량',s107:'거래대금'},groups:[['3D4Q-0',[],'그룹 자료']]},
 '3EWN-0':{hide:['s003','s016','s017','s018','s019','s020','s024','s063','s077','s101','s108','s109','s114'],captions:{s102:'현재가',s104:'거래량'},groups:[['3FEV-0',['s065','s067','s069','s071','s073','s075'],'ELW 조건'],['3FN1-0',['s080','s082','s084','s086','s088','s091','s093','s095','s097','s099'],'ELW 위험·미결제'],['3EXT-0',[],'LP 보유 정보'],['3EXO-0',['s110'],'만기'],['3FO7-0',['s115','s116','s117','s118','s119','s120','s121','s122','s123','s124','s125','s126'],'다른 조회 종목']]},
 '2UHM-1':{hide:['s003','s011','s012','s014','s015','s016','s017','s082','s103','s104',...Array.from({length:18},(_,i)=>'s'+String(85+i).padStart(3,'0')),'s120'],captions:{s024:'장 상태 응답',s083:'장 상태 수신 시각',s105:'VI 구분 코드',s107:'정적 괴리율',s109:'해제 시각 응답',s111:'다른 조회 종목'},groups:[['357G-0',[],'KOSPI 지수'],['357K-0',[],'KOSDAQ 지수'],['357O-0',['s025','s026'],'장 상태'],['357S-0',[],'VI 집계'],['3FB3-0',['s084'],'장 상태 시각'],['2UMO-1',['s106'],'VI 구분'],['2UMR-1',['s108'],'정적 괴리율'],['2UMU-1',['s110'],'해제 시각'],['3FP8-0',['s112','s113','s114','s115','s116','s117'],'다른 조회 종목']]},
 '2UN6-1':{hide:['s003','s011','s015','s016','s017','s018','s019','s021','s023','s024','s025','s027','s029','s030','s032','s034','s035','s112','s123','s141','s142'],captions:{s036:'응답 시각',s040:'매매 구분',s042:'응답 등락률',s122:'응답 시각 목록'},groups:[['34ND-0',['s020','s022','s026','s028','s031','s033'],'저장된 조건검색 자료'],['2USC-1',['s113'],'응답 시각'],['2USF-1',['s115'],'5분 거래대금'],['2USI-1',['s117'],'체결강도'],['2USL-1',['s119'],'감지 가격'],['3H8D-0',['s124','s127','s130'],'응답 시각'],['33HP-0',[],'감시 상태']]},
 '15L8-2':{hide:['s045','s055','s065','s075','s085'],hideNodes:['15LC-2','15LF-2','15LN-2','1VAO-1'],captions:{s005:'조건검색 조회 결과'},groups:[['15MN-2',[],'조건 신호'],['15MT-2',[],'조건 기준'],['3IMH-0',[],'조건 이력']]},
};

function prepareWatchDetails(surface, contract) {
  const id=contract.board_id,config=WATCH_DETAIL_CONFIG[id];if(!config)return;
  surface.classList.add('bs-watch-six');
  for(const [node,slots]of config.groups)for(const slot of slots){const source=contract.slots.find(s=>s.slot_id===slot);const value=source&&authoredNode(surface,anchorOf(source));if(value)value.dataset.bsKeepMissing='true';}
  if(id==='2UBO-1'){
    const rows=['348K-0','348Q-0','3490-0','349A-0','349K-0','349U-0','34A4-0'];
    const owner=layoutGroup(surface.ownerDocument,'bs-watch-theme-owner');owner.dataset.node='watch-theme-list';
    authoredNode(surface,rows[0]).before(owner);for(const row of rows)owner.append(authoredNode(surface,row));
    readableTable(surface,contract,{node:'watch-theme-list',rows,widths:[240,150,0,210,180],label:'조회 테마',compact:true});
  }
  if(id==='15L8-2')for(const row of surface.querySelectorAll('[data-node="15LI-2"] [data-row]'))if(row.children[5])row.children[5].classList.add('bs-watch-unsupported');
}

function updateWatchNativeResiduals(surface, states, received, restore, caption) {
  const id=surface.dataset.bsBoardId;
  if(!['2U5L-1','2UBO-1','3D4I-0','3EWN-0','2UHM-1','2UN6-1'].includes(id))return;
  const nodes=slot=>surface.querySelectorAll('[data-slot-id="'+slot+'"]');
  for(const [nodeId,slots]of WATCH_DETAIL_CONFIG[id].groups)if(!slots.length)authoredNode(surface,nodeId)?.classList.add('bs-watch-empty-detail');
  if(['2U5L-1','3D4I-0','3EWN-0'].includes(id)){
    for(const slot of ['s011','s012','s013','s014'])for(const node of nodes(slot))node.parentElement.classList.toggle('bs-watch-missing-pill',!received(states.get(slot)));
    for(const node of nodes('s010'))node.parentElement.classList.toggle('bs-watch-missing-pill',!['s011','s012','s013','s014'].some(slot=>received(states.get(slot))));
  }
  if(['3D4I-0','3EWN-0'].includes(id)){
    for(const [slot,label]of [['s002','체결 시각 '],['s027','조회 일자 '],['s043','호가 시각 '],[id==='3D4I-0'?'s127':'s128','체결 시각 ']])if(received(states.get(slot)))caption(slot,label+states.get(slot).text);
  }
  const rail=surface.querySelector('.bs-rail');
  if(rail){
    const actual=!!surface.__bsWatchSelectedValues||[...rail.querySelectorAll('[data-slot-id]')].some(node=>received(states.get(node.dataset.slotId))&&!node.closest('.bs-watch-unsupported,.bs-watch-original-selection'));
    const pending=[...rail.querySelectorAll('[data-slot-id]')].some(node=>states.get(node.dataset.slotId)?.pending);
    rail.classList.toggle('bs-watch-empty-rail',!actual);restore(rail);
    let note=rail.querySelector(':scope > .bs-watch-rail-note');
    if(!note){note=layoutGroup(surface.ownerDocument,'bs-watch-note bs-watch-rail-note');note.setAttribute('role','status');rail.prepend(note);}
    note.hidden=actual;
    const label={'2U5L-1':'관심 상세 자료','2UBO-1':'테마 상세 자료','3D4I-0':'종목 상세 자료','3EWN-0':'ELW 상세 자료','2UHM-1':'VI 상세 자료','2UN6-1':'조건검색 상세 자료'}[id];
    note.textContent=label+(pending?' 수신 대기':' 미제공');
    if(id==='2U5L-1'){
      for(const [nodeId,slots]of [['33QL-0',['s208','s209']],['33QQ-0',['s211','s212']],['33QV-0',['s214','s215']],['3D4C-0',['s217','s218']]]){
        const row=authoredNode(surface,nodeId);if(!row)continue;
        row.classList.add('bs-watch-group-row');
        row.classList.toggle('bs-watch-group-missing',!slots.some(slot=>received(states.get(slot))));
        for(const slot of slots)for(const node of nodes(slot))node.classList.toggle('bs-watch-group-missing',!received(states.get(slot)));
      }
      const absent=!surface.__bsWatchActionStock;
      for(const nodeId of ['2UB1-1','2UB4-1','2UB7-1','2UBA-1','2UBD-1'])authoredNode(surface,nodeId)?.classList.add('bs-watch-original-selection');
      authoredNode(surface,'2UBI-1')?.classList.toggle('bs-watch-empty-detail',absent);
      let guide=rail.querySelector(':scope > .bs-watch-selection-note');
      if(!guide){guide=layoutGroup(surface.ownerDocument,'bs-watch-note bs-watch-selection-note');guide.setAttribute('role','status');rail.prepend(guide);}
      guide.hidden=!absent;guide.textContent='표에서 종목을 선택하면 해당 종목의 상세와 차트·호가 열기가 표시됩니다.';
      let detail=rail.querySelector(':scope > .bs-watch-selected-detail');
      if(!detail){detail=layoutGroup(surface.ownerDocument,'bs-watch-selected-detail');rail.prepend(detail);}
      detail.hidden=absent;detail.replaceChildren();
      if(!absent)for(const [index,label]of ['선택 종목','종목코드','현재가','거래량'].entries()){
        const line=layoutGroup(surface.ownerDocument,'bs-watch-selected-field'),term=surface.ownerDocument.createElement('span'),value=surface.ownerDocument.createElement('span');
        term.textContent=label;value.textContent=surface.__bsWatchSelectedValues[index]?.text||'미제공';line.append(term,value);detail.append(line);
      }
    }
  }
  for(const table of surface.querySelectorAll('.bs-readable-owner')){
    const rows=[...table.querySelectorAll('[data-row]')].filter(row=>row.dataset.row!=='head');
    const actual=rows.some(row=>[...row.querySelectorAll('[data-slot-id]')].some(node=>received(states.get(node.dataset.slotId))));
    const pending=rows.some(row=>[...row.querySelectorAll('[data-slot-id]')].some(node=>states.get(node.dataset.slotId)?.pending));
    const empty=rows.length>0&&!actual;
    table.classList.toggle('bs-watch-empty-owner',empty);
    let note=table.__bsWatchTableNote;
    if(!note){note=layoutGroup(surface.ownerDocument,'bs-watch-note bs-watch-table-note');note.setAttribute('role','status');table.querySelector('.bs-readable-scroll').after(note);table.__bsWatchTableNote=note;}
    note.hidden=!empty;note.textContent=pending?'조회 내역 수신 대기':'표시할 조회 내역이 없습니다';
    if(table.__bsEmptyMessage)table.__bsEmptyMessage.classList.toggle('bs-watch-duplicate-note',empty);
  }
  const primary=surface.querySelector('.bs-primary');
  if(primary){
    const actual=[...primary.querySelectorAll('[data-slot-id]')].some(node=>received(states.get(node.dataset.slotId))&&!node.closest('.bs-watch-unsupported'));
    const pending=[...primary.querySelectorAll('[data-slot-id]')].some(node=>states.get(node.dataset.slotId)?.pending);
    primary.classList.toggle('bs-watch-primary-empty',!actual);restore(primary);
    let note=primary.querySelector(':scope > .bs-watch-primary-note');
    if(!note){note=layoutGroup(surface.ownerDocument,'bs-watch-note bs-watch-primary-note');note.setAttribute('role','status');primary.prepend(note);}
    note.hidden=actual;note.textContent=pending?'조회 자료 수신 대기':'표시할 조회 자료가 없습니다';
    surface.classList.toggle('bs-watch-all-empty',!actual&&!!rail?.classList.contains('bs-watch-empty-rail'));
  }
}

function updateWatchDetails(surface, plan, options={}) {
  const id=surface.dataset.bsBoardId,config=WATCH_DETAIL_CONFIG[id];if(!config)return;
  const states=surface.__bsWatchStates ||= new Map();for(const assignment of plan.assignments)states.set(assignment.slotId,assignment);
  const received=a=>a?.valueSlot&&!a.pending&&!a.missing&&!a.empty&&!a.designText&&String(a.text).trim();
  const nodes=slot=>surface.querySelectorAll('[data-slot-id="'+slot+'"]');
  const caption=(slot,text)=>{for(const node of nodes(slot))if(!node.children.length)node.textContent=text;};
  const restore=node=>{for(let at=node;at&&at!==surface;at=at.parentElement){if(at.hidden||at.style.display==='none'||at.dataset.bsRowCollapsed==='true'||at.dataset.bsUnavailableHidden==='true'){setHidden(at,false);delete at.dataset.bsRowCollapsed;delete at.dataset.bsUnavailableHidden;surface.__bsEmptyValueHidden?.delete(at);if(Array.isArray(surface.__bsUnavailableHidden))surface.__bsUnavailableHidden=surface.__bsUnavailableHidden.filter(item=>item!==at);else surface.__bsUnavailableHidden?.delete?.(at);}}};
  for(const slot of config.hide)for(const node of nodes(slot))node.classList.add('bs-watch-unsupported');
  for(const slot of config.hide)for(const node of nodes(slot)){let parent=node.parentElement;while(parent&&parent.closest('.bs-strip')&&!parent.matches('.bs-strip')){if([...parent.children].every(child=>child.classList.contains('bs-watch-unsupported')||child.hidden))parent.classList.add('bs-watch-unsupported');else break;parent=parent.parentElement;}}
  for(const id of config.hideNodes||[])authoredNode(surface,id)?.classList.add('bs-watch-unsupported');
  for(const [slot,text]of Object.entries(config.captions||{}))caption(slot,text);
  for(const [nodeId,slots,label]of config.groups){
    const group=authoredNode(surface,nodeId);if(!group)continue;
    const empty=!slots.some(slot=>received(states.get(slot))),pending=slots.some(slot=>states.get(slot)?.pending);
    group.classList.add('bs-watch-managed');group.classList.toggle('bs-watch-empty',empty);restore(group);
    let note=group.querySelector(':scope > .bs-watch-note');if(!note){note=layoutGroup(surface.ownerDocument,'bs-watch-note');note.setAttribute('role','status');group.append(note);}
    note.hidden=!empty;note.textContent=label+(pending?' 수신 대기':' 미제공');
  }
  const primary=surface.querySelector('.bs-primary');if(primary&&['3D4I-0','3EWN-0'].includes(id)){restore(primary);const actual=[...primary.querySelectorAll('[data-slot-id]')].some(n=>received(states.get(n.dataset.slotId)));let note=primary.querySelector(':scope > .bs-watch-main-note');if(!note){note=layoutGroup(surface.ownerDocument,'bs-watch-note bs-watch-main-note');note.setAttribute('role','status');primary.prepend(note);}note.hidden=actual;note.textContent=[...states.values()].some(a=>a.pending)?'조회 종목 자료 수신 대기':'조회 종목 자료 미제공';}
  for(const [slot,assignment]of states)if(received(assignment))for(const node of nodes(slot))restore(node);
  if(id!=='15L8-2')for(const node of nodes('s002'))node.parentElement.classList.toggle('bs-watch-missing-pill',!received(states.get('s002')));
  for(const nodeId of {'3D4I-0':['3EAY-0','3EMO-0'],'3EWN-0':['3EZV-0']}[id]||[]){const group=authoredNode(surface,nodeId);if(group){const absent=![...group.querySelectorAll('[data-slot-id]')].some(n=>received(states.get(n.dataset.slotId)));group.classList.toggle('bs-watch-empty-detail',absent);}}
  const identitySlots={'3D4I-0':['s023','s022'],'3EWN-0':['s023','s022']}[id];
  surface.__bsWatchActionStock=null;
  if(identitySlots){const [code,name]=identitySlots.map(slot=>states.get(slot));if(received(code)&&received(name)&&/^[0-9A-Z]{6}(?:_(?:AL|NX))?$/.test(code.text)&&code.text!=='000000')surface.__bsWatchActionStock={stkCd:code.text,stockName:name.text};}
  surface.__bsWatchSelectedValues=null;
  if(id==='2U5L-1'&&Array.isArray(options.watchlistSelection)){
    const selected=options.watchlistSelection.map(slot=>states.get(slot)),[name,code]=selected;
    if(received(name)&&received(code)&&/^[0-9A-Z]{6}(?:_(?:AL|NX))?$/.test(code.text)&&code.text!=='000000'){
      surface.__bsWatchSelectedValues=selected;
      surface.__bsWatchActionStock={stkCd:code.text,stockName:name.text};
    }
  }
  for(const node of surface.querySelectorAll('[data-card-action]')){const context=node.__bsRankingActionContext;if(!context||!['open-card','compare-add'].includes(context.action?.kind))continue;const disabled=!surface.__bsWatchActionStock;node.setAttribute('aria-disabled',String(disabled));node.parentElement?.classList.toggle('bs-watch-disabled-action',disabled);if(disabled)node.title='조회 종목이 있으면 열 수 있습니다';else node.removeAttribute('title');}
  if(id==='2UN6-1')for(const node of nodes('s120')){const control=node.closest('[role="button"],button')||node.parentElement;control.setAttribute('aria-disabled','true');control.title='조회 종목을 선택한 상태가 아닙니다';}
  if(id==='2UBO-1'){
    const context=options.watchSourceContext||{},period=value=>/^\d+$/.test(String(value??''))?String(Number(value))+'일 수익률':'조회 기간 수익률';
    caption('s015',context.list_period?String(Number(context.list_period))+'일 조회':'조회 기간 미제공');
    caption('s022',period(context.list_period));caption('s112',period(context.detail_period));for(const slot of ['s080','s091','s102'])if(received(states.get(slot)))caption(slot,period(context.detail_period)+' '+states.get(slot).text);
  }
  if(id==='2UHM-1'){
    const sessions={'0':'장 시작 전','3':'장 시작','2':'장 마감 전','4':'장 마감','8':'정규장 마감','9':'전체장 마감',a:'시간외 종가매매 시작',b:'시간외 종가매매 종료',c:'시간외 단일가 시작',d:'시간외 단일가 종료',e:'선옵 마감 전 동시호가 종료',f:'선옵 장 운영시간 알림',o:'선옵 장 시작',s:'선옵 마감 전 동시호가 시작',P:'NXT 프리마켓 시작',Q:'NXT 프리마켓 종료',R:'NXT 메인마켓 시작',S:'NXT 메인마켓 종료',T:'NXT 애프터마켓 단일가 시작',U:'NXT 애프터마켓 시작',V:'NXT 애프터마켓 종료'};
    for(const slot of ['s002','s025']){const a=states.get(slot);if(received(a))caption(slot,sessions[a.text]||'장 상태 코드 '+a.text);}
  }
  if(id==='2UN6-1'){
    const once=options.operationRef==='base:ka10172',list=options.operationRef==='base:ka10171';
    caption('s013','실시간 감시');caption('s014','1회 조회');
    const context=surface.querySelector('.bs-condition-query-context');if(context){context.hidden=false;context.textContent=once?'조건검색 1회 조회 결과':list?'저장된 조건검색 목록':'감시 상태 미확인';}
    for(const node of surface.querySelectorAll('.bs-condition-empty'))node.textContent='저장된 조건검색 자료 미제공';
    for(const code of ['32OZ-0','32P0-0']){const node=authoredNode(surface,code);if(node){node.style.removeProperty('background-color');node.style.removeProperty('color');node.parentElement?.classList.add('bs-watch-unselected-monitor');}}
  }
  for(const table of surface.querySelectorAll('.bs-readable-owner')){
    const message=table.__bsEmptyMessage;if(message&&table.contains(message))table.after(message);
  }
  updateWatchNativeResiduals(surface, states, received, restore, caption);
}


function applyReadableBoardLayout(surface, contract) {
  prepareWatchDetails(surface, contract);
  const id = contract.board_id;
  if (id === '2X5N-0') {
    const sorts = authoredNode(surface, '2X92-0');
    sorts.classList.add('bs-r-scroll');
    sorts.tabIndex = 0;
    sorts.setAttribute('role', 'region');
    sorts.setAttribute('aria-label', '종목 순위 정렬, 좌우 방향키로 이동');
    sorts.addEventListener('keyup', event => {
      if (event.key !== 'Tab') return;
      const choice = event.target.closest('[role="button"]');
      if (!choice || !sorts.contains(choice)) return;
      const viewport = sorts.getBoundingClientRect();
      const item = choice.getBoundingClientRect();
      if (item.left < viewport.left) sorts.scrollLeft += item.left - viewport.left;
      else if (item.right > viewport.right) sorts.scrollLeft += item.right - viewport.right;
    });
    if (!surface.querySelector('.bs-day-volume-sort-hint')) {
      const hint = layoutGroup(surface.ownerDocument, 'bs-day-volume-sort-hint');
      hint.textContent = '정렬 항목을 좌우로 이동해 모두 확인하세요';
      sorts.parentElement.after(hint);
    }
  }
  if (id === '2R3M-1') {
    // The day selectors remain available when the adjacent venue/time is absent.
    for (const node of ['3CS2-0', '3CS4-0']) authoredNode(surface, node).dataset.bsKeepMissing = 'true';
    const costs = authoredNode(surface, '36TD-0');
    costs.classList.add('bs-current-quote-managed');
    for (const slot of nodeIndex(costs).values()) slot.dataset.bsKeepMissing = 'true';
  }
  if (id === '2ZN9-0') {
    const modes = authoredNode(surface, '3056-0');
    modes.tabIndex = 0;
    modes.setAttribute('role', 'region');
    modes.setAttribute('aria-label', 'ELW 조회 방식, 좌우 방향키로 이동');
  }
  if (id === '2VIN-0') {
    for (const node of ['3O76-0', '3O7G-0']) {
      const group = authoredNode(surface, node);
      group.classList.add('bs-ranking-managed');
      for (const slot of nodeIndex(group).values()) slot.dataset.bsKeepMissing = 'true';
    }
  }
  if (id === '3JT4-0') prepareAfterhoursDepthTable(surface);
  if (id === '2QRP-1') prepareSessionQuoteTable(surface);
  if (id === '3NVG-0') {
    // D+1 through D+4 are independent settlement summaries, not currency cells.
    const summary = authoredNode(surface, '3PAQ-0');
    for (const mirror of summary.querySelectorAll('.bs-paired')) mirror.remove();
    for (const wrapper of summary.querySelectorAll('.bs-col')) wrapper.replaceWith(...wrapper.childNodes);
    for (const node of [summary, ...summary.querySelectorAll('[data-col]')]) {
      delete node.dataset.row;
      delete node.dataset.col;
      node.classList.remove('bs-col');
    }
  }
  if (id === '3N4O-0') {
    // This authored ladder has no table metadata. Missing quotes still occupy
    // their own column so the received quantity cannot move under the price.
    const table = authoredNode(surface, '3OSI-0');
    table.classList.add('bs-table', 'bs-quote-scroll');
    table.style.removeProperty('overflow');
    table.tabIndex = 0;
    table.setAttribute('role', 'region');
    table.setAttribute('aria-label', '단계별 호가 표, 좌우 방향키로 이동');
    for (const row of table.querySelectorAll('[data-name]')) {
      const name = row.dataset.name;
      if (name !== '열 제목' && !/^(매도|매수) (10|[1-9])$/.test(name)) continue;
      row.dataset.row = name === '열 제목' ? 'head' : name;
      delete row.dataset.bsWrapRow;
      row.style.flexWrap = 'nowrap';
      [...row.children].forEach((cell, index) => { cell.dataset.col = String(index); });
    }
    const inner = layoutGroup(surface.ownerDocument, 'bs-quote-table');
    inner.append(...table.childNodes);
    table.append(inner);
  }
  if (!READABLE_TABLES[id] && !['3D4I-0', '3EWN-0', '3JZ3-0', '3DZ1-0', '137X-2', '2VDA-0', '133H-2', '2SKU-1', '2SYW-1', '3MTJ-0', '15N5-2'].includes(id)) return;
  surface.dataset.bsLayout = id;
  if (['2R3M-1', '2VDA-0', '133H-2', '2SKU-1', '15N5-2'].includes(id)) {
    const rail = surface.querySelector('.bs-rail');
    rail.style.setProperty('--bs-rail-direction', rail.style.getPropertyValue('flex-direction') || 'column');
    rail.style.removeProperty('flex-direction');
  }
  if (READABLE_TABLES[id] && READABLE_TABLES[id].stack !== false) {
    surface.querySelector('.bs-workspace').style.removeProperty('flex-direction');
  }
  if (READABLE_TABLES[id]) {
    for (const table of [READABLE_TABLES[id], ...(READABLE_TABLES[id].additional || [])]) readableTable(surface, contract, table);
  }
  if (id === '2SCE-1') {
    const rail = surface.querySelector('.bs-rail');
    rail.style.removeProperty('display');
    rail.classList.add('bs-holdings-rail');
    for (const id of ['388U-0', '3895-0', '38JG-0', '38JN-0', '38JY-0']) {
      const row = authoredNode(surface, id);
      row.classList.add('bs-account-detail-grid');
      row.style.removeProperty('display');
      row.style.removeProperty('gap');
    }
  }
  const fixedAccountTables = { '2SKU-1': ['39SW-0'], '3GRO-0': ['3I8U-0', '3IAR-0'], '3IGR-0': ['3U6J-0'], '3K7K-0': ['3L4J-0'] };
  if (id === '3K7K-0') {
    for (const [heading, row] of [['3L4S-0', '3L8Y-0'], ['3LCX-0', '3LD0-0']]) {
      authoredNode(surface, row).before(authoredNode(surface, heading));
    }
  }
  for (const tableId of fixedAccountTables[id] || []) authoredNode(surface, tableId).dataset.bsKeepEmptyRows = 'true';
  if (id === '15N5-2') {
    // 이 템플릿의 선·구성 막대는 응답에 연결되지 않은 고정 예시다. 앵커는 보존한다.
    for (const [nodeId, message] of [
      ['3D47-0', '가격·NAV 추이 데이터가 제공되지 않았습니다'],
      ['3CWC-0', '구성종목 비중 데이터가 제공되지 않았습니다'],
    ]) {
      const owner = authoredNode(surface, nodeId);
      owner.classList.add('bs-unavailable-graphic');
      for (const child of owner.children) {
        child.classList.add('bs-unavailable-graphic-source');
        child.style.display = 'none';
      }
      const note = layoutGroup(surface.ownerDocument, 'bs-unavailable-graphic-message');
      note.setAttribute('role', 'status');
      note.textContent = message;
      owner.append(note);
    }
    const legend = authoredNode(surface, '3CW5-0');
    legend.classList.add('bs-unavailable-graphic-source');
    legend.style.display = 'none';
    const heading = authoredNode(surface, '3CWB-0');
    const composition = layoutGroup(surface.ownerDocument, 'bs-unavailable-graphic-section');
    heading.before(composition);
    composition.append(heading, authoredNode(surface, '3CWC-0'));
  }
  if (id === '15J9-2') {
    const doc = surface.ownerDocument;
    const score = authoredNode(surface, '15JM-2');
    score.style.removeProperty('flex-direction');
    const summary = layoutGroup(doc, 'bs-theme-summary-details');
    summary.append(authoredNode(surface, '15JN-2'), authoredNode(surface, '15JR-2'), authoredNode(surface, '15JU-2'));
    score.append(summary);
    const evidence = authoredNode(surface, '15KI-2');
    const columns = layoutGroup(doc, 'bs-theme-evidence-columns');
    const metrics = layoutGroup(doc, 'bs-theme-metrics');
    metrics.append(authoredNode(surface, '3HJL-0'), authoredNode(surface, '32I4-0'));
    columns.append(authoredNode(surface, '3HF8-0'), metrics);
    evidence.append(columns);
  }
  if (id === '3D4I-0' || id === '3EWN-0') {
    const rowIds = id === '3D4I-0' ? ['3EAY-0', '3EMO-0'] : ['3EZV-0', '3EY6-0'];
    for (const rowId of rowIds) {
      const row = authoredNode(surface, rowId);
      row.classList.add('bs-detail-panels');
      for (const panel of row.children) {
        panel.classList.add('bs-detail-panel');
        // 패널 내부의 고정 두 칸도 같은 비율로 줄여 숫자 칸의 최소 폭을 지킨다.
        const widths = { 402: '100%', 191: 'calc((100% - 20px) / 2)', 170: 'calc((100% - 20px) / 2)', 62: '54px', 151: 'calc((100% - 54px) / 2)', 100: '80px' };
        for (const node of panel.querySelectorAll('[data-bs-hoisted]')) {
          const width = pxNumber(node.style.getPropertyValue('--bs-width'));
          if (widths[width]) node.style.setProperty('--bs-width', widths[width]);
        }
      }
    }
  }
  if (id === '3JZ3-0') {
    const rows = ['3UC7-0', '3UCD-0', '3UCP-0'].map((node) => authoredNode(surface, node));
    rows[0].parentElement.classList.add('bs-exchange-scroll');
    rows[0].parentElement.tabIndex = 0;
    rows[0].parentElement.setAttribute('role', 'region');
    rows[0].parentElement.setAttribute('aria-label', '거래소 비교 표, 좌우 방향키로 이동');
    for (const row of rows) {
      row.classList.add('bs-exchange-row');
      [...row.children].forEach((cell, index) => {
        cell.classList.add('bs-exchange-cell');
        cell.style.setProperty('--bs-cell-width', `${[36, 64, 66, 102, 102][index]}px`);
      });
    }
  }
  if (id === '137X-2') {
    const institutionDetail = authoredNode(surface, '3C3E-0');
    institutionDetail.dataset.stateControl = '투자자 12주체';
    institutionDetail.setAttribute('aria-label', '기관별 상세 열기');
    const flowHeading = authoredNode(surface, '14SR-2');
    const flowDate = authoredNode(surface, '3C3J-0');
    flowHeading.parentElement.insertBefore(flowDate, flowHeading.nextSibling);
    const sessions = authoredNode(surface, '38LB-0');
    sessions.classList.add('bs-session-scroll');
    sessions.tabIndex = 0;
    sessions.setAttribute('role', 'region');
    sessions.setAttribute('aria-label', '세션별 거래, 좌우 방향키로 이동');
    if (!sessions.querySelector('.bs-session-columns')) {
      const columns = layoutGroup(surface.ownerDocument, 'bs-session-row bs-session-columns');
      for (const label of ['구분', '거래량 · 비중', '거래대금 · 비중']) {
        const cell = surface.ownerDocument.createElement('span');
        cell.textContent = label;
        columns.append(cell);
      }
      const firstRow = authoredNode(surface, '38LH-0');
      firstRow.parentElement.insertBefore(columns, firstRow);
    }
    for (const rowId of ['38LH-0', '38LP-0', '38LX-0', '38M5-0']) {
      const row = authoredNode(surface, rowId);
      row.classList.add('bs-session-row');
      [...row.children].forEach((cell, index) => cell.style.setProperty('--bs-cell-width', `${[46, 162, 162][index]}px`));
    }
  }
}

function applyConditionQueryMode(surface, contract, operationRef) {
  if (contract.board_id !== '2UN6-1') return;
  const query = operationRef === 'base:ka10171' || operationRef === 'base:ka10172';
  surface.dataset.bsConditionRead = query ? (operationRef === 'base:ka10171' ? 'list' : 'search') : '';
  const band = authoredNode(surface, '34ND-0');
  if (band && !band.dataset.bsConditionPrepared) {
    const keep = ['34NG-0', '3SAL-0', '34NQ-0', '34NS-0', '34O0-0', '34O2-0'].map(id => authoredNode(surface, id));
    for (const node of band.querySelectorAll('[data-node]')) {
      if (!keep.some(leaf => leaf && (node === leaf || node.contains(leaf)))) node.classList.add('bs-condition-monitor-only');
    }
    band.dataset.bsConditionPrepared = 'true';
  }
  let context = surface.querySelector('.bs-condition-query-context');
  if (!context) {
    context = layoutGroup(surface.ownerDocument, 'bs-query-context bs-condition-query-context');
    surface.insertBefore(context, surface.querySelector('.bs-workspace'));
  }
  context.hidden = !query;
  context.textContent = operationRef === 'base:ka10171' ? '저장된 조건검색 목록' : '조건검색 1회 조회 결과';
  if (band) {
    for (const [cardId, nameId, codeId] of [['34NE-0','34NG-0','3SAL-0'], ['34NO-0','34NQ-0','34NS-0'], ['34NY-0','34O0-0','34O2-0']]) {
      const card = authoredNode(surface, cardId);
      const hasData = [nameId, codeId].some(id => {
        const node = authoredNode(surface, id);
        return node && !node.dataset.missing && !node.dataset.bsDesignText && node.textContent.trim();
      });
      if (card) card.classList.toggle('bs-condition-empty-card', !hasData);
    }
    let empty = band.querySelector('.bs-condition-empty');
    if (!empty) {
      empty = layoutGroup(surface.ownerDocument, 'bs-empty-table-message bs-condition-empty');
      empty.setAttribute('role', 'status');
      empty.textContent = '저장된 조건검색이 없습니다';
      band.append(empty);
    }
    empty.hidden = !query || ['34NG-0', '34NQ-0', '34O0-0'].some(id => {
      const node = authoredNode(surface, id);
      return node && !node.dataset.missing && node.textContent.trim();
    });
  }
  for (const [id, selected] of [['32P0-0', false], ['32P2-0', operationRef === 'base:ka10172']]) {
    const label = authoredNode(surface, id);
    if (!label || !label.parentElement) continue;
    const chip = label.parentElement;
    chip.classList.add('bs-condition-monitor-mode');
    for (const [node, properties] of [[chip, ['backgroundColor', 'borderColor', 'borderStyle', 'borderWidth']], [label, ['color', 'fontFamily']]]) {
      if (!node.__bsQueryModeStyle) node.__bsQueryModeStyle = Object.fromEntries(properties.map(key => [key, node.style[key]]));
      for (const key of properties) node.style[key] = node.__bsQueryModeStyle[key];
    }
    if (!query) continue;
    chip.style.backgroundColor = selected ? 'var(--color-k-text)' : 'transparent';
    chip.style.border = '1px solid var(--color-k-line)';
    label.style.color = selected ? 'var(--color-k-panel)' : 'var(--color-k-text)';
    label.style.fontFamily = selected ? 'var(--font-strong)' : 'var(--font-body)';
  }
}

function compactReducedContent(surface, contract) {
  for (const box of surface.querySelectorAll('.bs-reduced-content')) {
    box.classList.remove('bs-reduced-content');
    if (box.dataset.bsGrowBox === 'true') box.style.setProperty('min-height', box.style.getPropertyValue('--bs-height'));
  }
  // 실제 차트·호가 모듈만 높이를 소유한다. 형제 보조 영역은 빈 값에 맞춰 줄인다.
  const primary = contract.primary && contract.primary.renderer ? primaryMountPoint(surface, contract) : null;
  const hidden = [
    ...surface.querySelectorAll('[data-bs-row-collapsed="true"]'),
    ...(surface.__bsEmptyValueHidden || []),
    ...(surface.__bsUnavailableHidden || []),
  ];
  for (const unit of hidden) {
    if (!unit.hidden) continue;
    if (primary && primary.contains(unit)) continue;
    for (let box = unit.parentElement; box && box !== surface; box = box.parentElement) {
      if (box.matches('.bs-header, .bs-strip, .bs-footer')) break;
      if (primary && box.contains(primary)) break;
      // 원래 접힌 값/행을 담던 상자의 높이만 풀고 글자와 앵커는 그대로 둔다.
      box.classList.add('bs-reduced-content');
      if (box.dataset.bsGrowBox === 'true') box.style.setProperty('min-height', '0');
    }
  }
}

function updateEmptyTableStates(surface) {
  const tables = surface.dataset.bsLayout === '2R3M-1'
    ? [['3CRW-0', '체결 내역']]
    : surface.dataset.bsLayout === '2VDA-0' ? [['3HMX-0', '순위 종목'], ['3HXP-0', '최근 경신 내역']]
      : surface.dataset.bsLayout === '133H-2' ? [['14UQ-2', '보유 종목']]
        : surface.dataset.bsLayout === '2SCE-1' ? [['375G-0', '보유 종목']]
          : surface.dataset.bsLayout === '2SKU-1' ? [['3A4F-0', '입출금 내역']]
            : surface.dataset.bsLayout === '2SYW-1' ? [['3Q8R-0', '주문·체결 내역']]
              : surface.dataset.bsLayout === '3MTJ-0' ? [['3OP4-0', '결제 예정 내역']]
                : surface.dataset.bsLayout === '3ODO-0' ? [['3P3G-0', '금현물 잔고 내역'], ['3P48-0', '금현물 거래 내역']] : [];
  const known = new Set(tables.map(([id]) => id));
  for (const table of surface.querySelectorAll('.bs-table')) {
    if (table.dataset.node && !known.has(table.dataset.node)) {
      tables.push([table.dataset.node, '조회 내역']);
      known.add(table.dataset.node);
    }
  }
  let empty = false;
  let short = false;
  for (const [id, label] of tables) {
    const table = authoredNode(surface, id);
    if (!table) continue;
    const rows = [...table.querySelectorAll('[data-row]')].filter((row) => row.dataset.row !== 'head');
    // 명시적 빈 행 또는 모든 실제 값이 미제공인 행만 근거로 쓴다. pending/hydration은 제외한다.
    const allCollapsed = rows.length > 0 && rows.every((row) => row.dataset.bsRowCollapsed === 'true');
    const someCollapsed = rows.some((row) => row.dataset.bsRowCollapsed === 'true');
    let message = table.__bsEmptyMessage;
    if (allCollapsed && !message) {
      message = layoutGroup(surface.ownerDocument, 'bs-empty-table-message');
      message.setAttribute('role', 'status');
      message.textContent = `표시할 ${label}이 없습니다`;
      let lastRow = rows[rows.length - 1];
      while (lastRow.parentElement !== table) lastRow = lastRow.parentElement;
      if (surface.dataset.bsBoardId === '3JT4-0' && id === '3KG8-0') table.after(message);
      else lastRow.after(message);
      table.__bsEmptyMessage = message;
    }
    if (message) message.hidden = !allCollapsed;
    table.classList.toggle('bs-empty-table', allCollapsed);
    table.classList.toggle('bs-short-table', someCollapsed);
    empty = empty || allCollapsed;
    short = short || someCollapsed;
  }
  surface.classList.toggle('bs-has-empty-table', empty);
  surface.classList.toggle('bs-has-short-table', short);
}

// 결측 자료와 해당 없음은 다르다. 구성종목 이름과 비중 모두 명시적으로 해당 없음인
// 행만 접는다. 다음 응답에 종목이 생기면 같은 DOM 행을 다시 드러낸다.
function inapplicableBasketRows(contract, plan, values) {
  if (!contract || contract.board_id !== '3DZ1-0') return [];
  const texts = new Map(plan.assignments.map((item) => [item.slotId, String(item.text).replace(/\s/g, '')]));
  // 런타임 계약은 mapping 필드를 제거하므로 검증된 원본 슬롯 쌍을 사용한다.
  // 실제 응답에 두 값이 없으면 Paper의 라벨 fallback만 보고 숨기지 않는다.
  return BASKET_ROWS.filter((row, index) => BASKET_SLOTS[index].every((slot) =>
    values && Object.prototype.hasOwnProperty.call(values, slot) && texts.get(slot) === '해당없음'));
}

function updateBasketRows(surface, contract, plan, values) {
  if (contract.board_id !== '3DZ1-0') return;
  const hidden = new Set(inapplicableBasketRows(contract, plan, values));
  for (const id of BASKET_ROWS) {
    const row = authoredNode(surface, id);
    if (!row) continue;
    if (hidden.has(id)) {
      if (!row.hidden) { setHidden(row, true); row.dataset.bsBasketHidden = 'true'; }
    } else if (row.dataset.bsBasketHidden === 'true') {
      setHidden(row, false);
      delete row.dataset.bsBasketHidden;
    }
  }
}

// ---------- 마지막 처방: **재고 나서** 넘친 줄만 접는다 ----------
//
// 구조만 보고 미리 접으면 레이아웃이 정착하지 않는다(markWrapRow 위 주석의 실측).
// 그래서 실제로 넘친 뒤에만, 넘친 글자의 조상 사슬에서 가장 얕은 가로 묶음 하나에
// 접기 표시를 준다 — 이미 있는 CSS 계약(`[data-bs-wrap-row]`)을 그대로 쓴다. 한 번에
// 하나씩 주고 다시 재서 넘침이 사라지면 멈춘다.
//
// 손대지 않는 것: 표(열 폭이 계약)·스크롤 소유자(스크롤로 닿는다)·세로 묶음(세로 줄에
// wrap을 주면 넘친 것이 오른쪽 새 열로 간다, markSplitRow와 같은 판단).
// 접기를 줄 수 있는 **모양**인가 — 기하는 보지 않는다.
function isRowShape(el, surface) {
  if (!el || el === surface || !el.classList || !el.dataset) return false;
  if (el.dataset.bsWrapRow === 'true') return false;
  if (el.classList.contains('bs-table')) return false;
  if (typeof el.closest === 'function'
    && el.closest('.bs-table, .bs-r-scroll, .bs-r-scroll-table')) return false;
  const style = getComputedStyle(el);
  if (style.display !== 'flex') return false;
  if (style.flexDirection === 'column' || style.flexDirection === 'column-reverse') return false;
  if (style.flexWrap === 'wrap') return false;
  return true;
}

function isRelaxableRow(el, surface, bound) {
  if (!isRowShape(el, surface)) return false;
  // **자기 칸보다 넓은가**가 아니라 **부모가 준 폭을 넘는가**를 본다. 안 줄어드는 줄은
  // 스스로는 딱 맞고(scrollWidth == clientWidth) 부모 밖으로 나가 있다 — 실측 2VDA-0
  // `3HKY-0`은 459/459인데 표면은 375다. 자기 칸만 보면 원인을 못 짚는다.
  const parent = el.parentElement;
  const room = parent ? parent.clientWidth : 0;
  if (room && el.getBoundingClientRect().width > room + 1) return true;
  if (el.getBoundingClientRect().right > bound + 1) return true;
  // 줄 자체는 부모 안에 들어가는데 **칸이 눌려** 그 안의 글자가 새는 자리도 있다
  // (실측 30ZW-0 `313O-0` 282px 안의 `3R7S-0`이 폭 0으로 눌리고 글자가 6px 넘쳤다).
  // 그 줄을 접으면 눌린 칸이 자기 줄을 받아 폭이 생긴다.
  for (const child of elementChildren(el) || []) {
    if (!child || !child.getBoundingClientRect) continue;
    if (!String(child.textContent || '').trim()) continue;
    if (child.clientWidth === 0) return true;
    if (child.scrollWidth > child.clientWidth + 1) return true;
  }
  return false;
}

// 표면 밖으로 나간 **잎 요소**들. 텍스트 노드를 Range로 재지 않는다 — 보드 하나에
// 텍스트 노드가 수백 개라 폭 4단계 전수에서 그 비용이 실행 시간을 지배했다(실측).
// 가로로 **스크롤해서 닿는가**. 클래스로 판정하지 않는다 — `.bs-r-scroll`은 좁은
// 단계에서만 `overflow-x: auto`가 되고(board-surface.css 381) 그 밖에서는 세로 스크롤
// 상자일 뿐이다. 이름만 보고 안쪽을 통째로 빼면 **닿을 수 없는** 가로 잘림까지 놓칠
// 수 있으니 계산된 값을 본다. 두 판정 모두 실측에서 같은 결과였고(전수 프로브 잘림 0 ·
// 마운트 게이트 68/33), 계산값 쪽이 규칙을 그대로 말한다.
function reachesByScroll(el, surface) {
  for (let up = el.parentElement; up; up = up.parentElement) {
    const overflow = getComputedStyle(up).overflowX;
    if (overflow === 'auto' || overflow === 'scroll') return true;
    if (up === surface) break;
  }
  return false;
}

// 잎의 사각형만 봐도 어느 줄이 넘치는지 짚는 데 충분하다.
function overflowingLeaves(surface) {
  const bound = surface.getBoundingClientRect().left
    + surface.clientLeft + surface.clientWidth;
  const leaves = [];
  for (const el of surface.querySelectorAll('*')) {
    if (el.firstElementChild) continue;
    if (!String(el.textContent || '').trim()) continue;
    if (el.closest('[hidden]')) continue;
    // 스크롤로 닿는 자리는 결함이 아니다(계획 §2). 그 안쪽 글자까지 후보로 잡으면
    // 스크롤 표가 있는 보드에서 수십 개가 걸려 접기·줄바꿈이 판을 흔든다(실측:
    // 마운트 게이트가 카드 1종에서 정착 한도에 걸렸다).
    if (reachesByScroll(el, surface)) continue;
    if (el.getBoundingClientRect().right > bound + 1) leaves.push(el);
  }
  return leaves;
}

// 잎의 사각형으로는 못 짚는 넘침이 있다. 칸이 눌려 글자가 **자기 상자 밖으로** 새면
// 잎의 상자는 표면 안에 남는다 — 실측 2YS8-0 `2YWF-0`은 폭 11px인데 그 안의
// 「장중 투자자 상위」가 표면을 3px 넘었고, 같은 자리가 보드 7장에 있었다.
// 그때는 **자기 내용이 자기 칸보다 넓은 가로 묶음**을 직접 찾는다(그 줄의 알약 4개가
// 255px 칸에 331px로 들어 있었다). 표면에 가장 가까운 하나만 고른다 — 깊은 줄을
// 접으면 그 줄만 아랫줄로 가고 위 줄은 그대로 넘친다.
function squeezedRow(surface) {
  let picked = null;
  let depth = Infinity;
  for (const el of surface.querySelectorAll('*')) {
    if (el.scrollWidth <= el.clientWidth + 1) continue;
    if (el.closest('[hidden]')) continue;
    if (!isRowShape(el, surface)) continue;
    let steps = 0;
    for (let up = el.parentElement; up && up !== surface; up = up.parentElement) steps += 1;
    if (steps < depth) {
      picked = el;
      depth = steps;
    }
  }
  return picked;
}

// 글자가 자기 상자보다 넓어 표면을 넘는 자리. 값은 접지 않는다 — 원자값이 두 줄이
// 되면 숫자가 쪼개져 읽힌다(헌장, `.bs-r-atomic`·`data-bs-value-atomic`). 문장 라벨은
// 접어도 뜻이 그대로다: 「전체 814건 · 19건 표시」가 두 줄이 되는 것이 6px 잘려 보이지
// 않는 것보다 낫다. 띄어쓰기나 가운뎃점이 있는 글자만 문장으로 본다.
const SENTENCE_TEXT = /[\s·]/u;

function wrapOverflowingLabels(leaves) {
  let wrapped = 0;
  for (const leaf of leaves) {
    if (!leaf || !leaf.style || !leaf.dataset) continue;
    if (leaf.dataset.bsLabelWrap === 'true') continue;
    if (leaf.dataset.bsValueAtomic !== undefined) continue;
    if (typeof leaf.closest === 'function' && leaf.closest('.bs-r-atomic')) continue;
    if (leaf.classList && leaf.classList.contains('bs-r-atomic')) continue;
    if (!SENTENCE_TEXT.test(String(leaf.textContent || ''))) continue;
    leaf.style.setProperty('white-space', 'normal');
    leaf.style.setProperty('overflow-wrap', 'anywhere');
    leaf.dataset.bsLabelWrap = 'true';
    wrapped += 1;
  }
  return wrapped > 0;
}

// 접을 줄도, 접을 라벨도 없을 때의 마지막 처방. 남는 것은 **열 폭이 계약인 표**와
// 그 안의 칸들이다(실측: 남은 보드 9장의 넘친 상자가 전부 표 안이었다). 열을 줄이면
// 표의 계약이 깨지므로 대신 **가로로 스크롤해서 닿게** 한다 — 스크롤로 닿는 자리는
// 결함이 아니고(계획 §2), 잘려서 못 닿는 것보다 낫다. 이미 있는 스크롤 소유자 계약을
// 그대로 쓰고(`data-bs-scroll-declared`), 표면에 가장 가까운 상자 하나만 소유자로
// 만든다 — 깊은 칸을 스크롤로 만들면 칸마다 스크롤바가 생긴다.
function scrollOverflowOwner(surface) {
  let picked = null;
  let depth = Infinity;
  for (const el of surface.querySelectorAll('*')) {
    if (el.scrollWidth <= el.clientWidth + 1) continue;
    if (!String(el.textContent || '').trim()) continue;
    if (el.closest('[hidden]')) continue;
    if (el.dataset && el.dataset.bsScrollDeclared === 'true') continue;
    // 이미 스크롤로 닿는 상자 안쪽은 건드리지 않는다.
    if (reachesByScroll(el, surface)) continue;
    let steps = 0;
    for (let up = el.parentElement; up && up !== surface; up = up.parentElement) steps += 1;
    if (steps < depth) {
      picked = el;
      depth = steps;
    }
  }
  if (!picked || !picked.style || !picked.dataset) return null;
  // 폭은 건드리지 않는다 — `min-width: 0`을 주면 상자 폭이 바뀌고, 폭이 컨테이너
  // 질의(board-surface.css)의 단계를 바꿔 다른 자리의 접힘까지 흔든다(실측 2SYW-1
  // 최소 폭에서 결측어 11자리가 되살아났다). 스크롤만 준다.
  picked.style.setProperty('overflow-x', 'auto');
  picked.dataset.bsScrollDeclared = 'true';
  return picked;
}

// 세로로 뚫린 상자를 **재고 나서** 자라게 한다.
//
// 높이 되돌리기는 CSS가 좁은 단계에서 이미 허용한다(board-surface.css:
// `height: auto; min-height: var(--bs-height)`) — 「높이 hoist가 허용하는 것은
// 성장뿐」이라는 계약이다. 그런데 그 단계 규칙이 닿지 않는 상자가 남아, 실데이터가
// 목업보다 길면 내용이 칸을 그대로 뚫는다(실측 2XP6-0 `3FCI-0`: 55px 칸에 내용
// 59px — 「1위 이수페타시스」가 Paper 목업 이름보다 길다). 그 상자에만 같은 처방을
// 준다: Paper 높이는 **바닥**으로 남기고(min-height) 자라기만 허용한다.
function relaxOverflowHeights(surface) {
  const grown = [];
  for (const el of surface.querySelectorAll('[data-bs-hoisted]')) {
    if (!el.style || !el.dataset) continue;
    if (el.dataset.bsGrowBox === 'true') continue;
    const paperHeight = el.style.getPropertyValue('--bs-height');
    if (!paperHeight) continue;
    if (!String(el.textContent || '').trim()) continue;
    if (getComputedStyle(el).overflowY !== 'visible') continue;
    if (el.scrollHeight <= el.clientHeight + 1) continue;
    el.style.setProperty('height', 'auto');
    el.style.setProperty('min-height', el.classList.contains('bs-reduced-content') ? '0' : paperHeight);
    el.dataset.bsGrowBox = 'true';
    grown.push(el.dataset.node || '');
  }
  if (grown.length && surface.dataset) {
    surface.dataset.bsGrownBoxes = String(
      Number(surface.dataset.bsGrownBoxes || 0) + grown.length,
    );
  }
  return grown;
}

function relaxOverflowRows(surface) {
  if (!surface || typeof surface.querySelectorAll !== 'function') return [];
  if (typeof getComputedStyle !== 'function' || typeof document === 'undefined') return [];
  if (popoverLayout) popoverLayout.update(surface);
  for (const hint of surface.querySelectorAll('.bs-readable-hint, .bs-ranking-scroll-hint')) {
    const scroll = hint.classList.contains('bs-ranking-scroll-hint') ? hint.nextElementSibling : hint.previousElementSibling;
    hint.style.display = scroll && scroll.clientWidth > 0 && scroll.scrollWidth > scroll.clientWidth + 1 ? 'block' : 'none';
  }
  // 같은 폭에서 두 번 재지 않는다. 제품에서는 표면의 관찰자가, 게이트에서는 정착
  // 판정이 같은 함수를 부르므로 그대로 두면 같은 폭에서 여러 번 돌고, 그때마다
  // 레이아웃이 조금씩 바뀌어 정착 판정이 한도까지 늘어진다(실측: 마운트 게이트가
  // 카드 1종 14장에서 8분을 넘겼다).
  const width = surface.clientWidth;
  if (surface.__bsRelaxWidth === width) return [];
  surface.__bsRelaxWidth = width;
  const relaxed = [];
  // 각 회차는 아직 표시되지 않은 줄·라벨·스크롤 소유자 하나 이상을 표시한다.
  // DOM 노드 수가 유한하고 같은 처방을 두 번 고르지 않으므로, 임의 횟수에서 끊지
  // 않아도 새 처방이 없을 때 반드시 끝난다. 여섯 회 뒤에 잘림이 남았던 31OF-0도
  // 이 수렴 조건으로 마지막 줄까지 처리한다.
  while (true) {
    if (surface.scrollWidth <= surface.clientWidth + 1) break;
    // 표면 밖으로 **나간 잎이 없어도** 표면은 넘칠 수 있다 — 눌린 칸의 내용이 자기
    // 상자 밖으로만 새는 자리다(실측 137X-2 `14T8-2`: 535px 칸에 내용 547px, 표면
    // 밖으로 나간 잎은 없다). 그래서 잎이 비어도 접을 줄 찾기까지는 간다.
    const leaves = overflowingLeaves(surface);
    const bound = surface.getBoundingClientRect().left
      + surface.clientLeft + surface.clientWidth;
    let picked = null;
    let depth = -1;
    for (const leaf of leaves) {
      let steps = 0;
      for (let el = leaf; el && el !== surface.parentElement; el = el.parentElement) {
        // 사슬을 위로 훑으며 **가장 얕은**(표면에 가까운) 후보를 남긴다 — 깊은 칸을
        // 접으면 그 칸만 아랫줄로 가고 줄은 그대로 넘친다.
        if (isRelaxableRow(el, surface, bound) && steps > depth) {
          picked = el;
          depth = steps;
        }
        if (el === surface) break;
        steps += 1;
      }
    }
    if (!picked) picked = squeezedRow(surface);
    if (!picked) {
      // 접을 줄이 없다 — 남은 것은 **글자 자체가 상자보다 넓은** 자리다(실측
      // 30ZW-0 「전체 814건 · 19건 표시」 6px · 2V71-0 「장중 투자자 상위」 23px).
      // 값은 절대 접지 않는다(헌장: 원자값은 한 줄) — 문장 라벨만 접는다.
      if (wrapOverflowingLabels(leaves)) {
        relaxed.push('label-wrap');
        continue;
      }
      const owner = scrollOverflowOwner(surface);
      if (!owner) break;
      relaxed.push(`scroll:${(owner.dataset && owner.dataset.node) || ''}`);
      continue;
    }
    picked.dataset.bsWrapRow = 'true';
    markElasticCells(picked);
    relaxed.push((picked.dataset && picked.dataset.node) || '');
  }
  if (relaxed.length && surface.dataset) {
    surface.dataset.bsRelaxedRows = String(
      Number(surface.dataset.bsRelaxedRows || 0) + relaxed.length,
    );
  }
  if (popoverLayout) popoverLayout.update(surface);
  return relaxed;
}

// 폭이 바뀌면 다시 잰다 — CSS 단계는 폭에 반응하지만 이 처방은 실측이 근거다.
// 표면 하나에 관찰자 하나만 붙이고, 프레임 하나 뒤에 잰다(리사이즈 직후에는 아직
// 새 폭으로 배치되지 않은 프레임을 본다).
function watchSurfaceWidth(surface) {
  if (!surface || surface.__bsWidthWatch) return null;
  if (typeof ResizeObserver !== 'function') return null;
  // clientWidth는 안쪽 세로 스크롤바가 생기고 사라질 때도 바뀐다. 그 값을 관찰하면
  // 이 함수가 준 접기 처방이 다시 자신을 깨워 두 폭 사이를 오간다. 외부가 실제로
  // 배정한 border-box 폭만 리사이즈로 본다.
  const borderWidth = () => surface.getBoundingClientRect().width;
  let last = borderWidth();
  // ResizeObserver 전달 중 높이를 바꾸면 같은 프레임에 새 알림이 생긴다.
  // 다음 task에서 한 번만 보정한다. rAF와 달리 가려진 Electron 창에서도 실행된다.
  let running = false;
  const observer = new ResizeObserver(() => {
    if (running) return;
    const width = borderWidth();
    if (Math.abs(width - last) < 2) return;
    running = true;
    setTimeout(() => {
      try {
        if (surface.isConnected === false) return;
        last = borderWidth();
        relaxOverflowHeights(surface);
        relaxOverflowRows(surface);
      } finally {
        running = false;
      }
    }, 0);
  });
  observer.observe(surface, { box: 'border-box' });
  surface.__bsWidthWatch = observer;
  return observer;
}

// Paper 레이어 이름(data-name)에 박힌 원시 식별자 앵커를 걷어낸다. 카드 커버리지
// 증명 규약(`raw · <mapping_id> · <json path>`, PAPER_CARD_COVERAGE.md)이 추출 HTML에
// 그대로 남아 제품 DOM으로 흘러든다(2026-09-04 gold-market 실측:
// data-name="raw · base:ka50081 · $.gds_day_chart_qry[].acc_trde_prica" — 97장 중 20장,
// 157개). 런타임은 슬롯을 data-node로 찾고 data-name으로는 아무 판정도 하지 않으므로,
// 식별자 모양의 값만 지운다. 다른 레이어 이름
// (Rectangle·행·Instrument Header…)은 verify-integrated-cards 진단 리포트가 읽으므로 둔다.
// 패턴은 verify-semantic-workspaces의 원시 식별자 게이트와 같은 축이다.
const RAW_IDENTITY_NAME = /(?:\b(?:raw|alias|FID|REST)\b|(?:base|detail):[a-z0-9]|\bka\d{5}\b|\$\.|mapping[ _-]?id|operation[ _-]?ref)/i;

function scrubRawIdentityNames(surface) {
  if (!surface || typeof surface.querySelectorAll !== 'function') return 0;
  let scrubbed = 0;
  for (const el of [surface, ...surface.querySelectorAll('*')]) {
    const name = el && el.dataset ? el.dataset.name : undefined;
    if (typeof name !== 'string' || !RAW_IDENTITY_NAME.test(name)) continue;
    if (typeof el.removeAttribute === 'function') el.removeAttribute('data-name');
    delete el.dataset.name;
    scrubbed += 1;
  }
  return scrubbed;
}

// 추출기가 보드 루트에 .board-surface를 붙이지 않은 경우 첫 요소를 표면으로 삼는다.
// 컨테이너 쿼리의 기준점이 없으면 반응형이 통째로 죽는다.
function surfaceRoot(root) {
  const marked = root.querySelector('.board-surface');
  if (marked) return marked;
  const first = root.firstElementChild
    || (Array.isArray(root.children) ? root.children.find((child) => child.tag !== '#text') : null);
  if (first && first.classList && typeof first.classList.add === 'function') first.classList.add('board-surface');
  else if (first) first.className = `${first.className || ''} board-surface`.trim();
  return first || null;
}

// 전문 렌더러가 앉을 자리 하나를 찾아 돌려준다. 계약이 `mount_slot`을 주면 그
// data-node를, 없거나 못 찾으면 표면의 `.bs-primary`로 떨어진다. 둘 다 없으면 null이다.
// 여기서 렌더러를 부르지는 않는다 — DOM 텍스트 층은 차트·호가에 의존하지 않는다(D1).
function primaryMountPoint(surface, contract) {
  if (!surface || typeof surface.querySelectorAll !== 'function') return null;
  const slot = String((contract && contract.primary && contract.primary.mount_slot) || '');
  if (slot) {
    const [node] = surface.querySelectorAll(`[data-node="${slot}"]`);
    if (node) return node;
  }
  const [fallback] = surface.querySelectorAll('.bs-primary');
  return fallback || null;
}

// 앱 렌더러가 앉을 자리를 비운다 — Paper 목업 자식(툴바·프리뷰)을 지우지 않고
// 접는다(D1: 추출 원문 삭제 금지). 접은 목록을 돌려주므로 마운트가 실패하면
// 그대로 되돌릴 수 있다. 이미 접혀 있던 자식(병합·접기 계획이 접은 것)은 건드리지
// 않는다 — 되돌릴 때 그것까지 펴면 보드가 계획과 달라진다.
function collapsePrimaryMockup(mountPoint) {
  if (!mountPoint || !mountPoint.children) return [];
  const collapsed = [];
  for (const child of Array.from(mountPoint.children)) {
    // Hydration may restore an empty row even after a renderer failed. Keep
    // authored children folded until an explicit restoration is requested.
    if (child.dataset) child.dataset.bsPrimaryMockup = 'true';
    if (child.hidden) continue;
    setHidden(child, true);
    collapsed.push(child);
  }
  return collapsed;
}

function restorePrimaryMockup(collapsed) {
  for (const child of collapsed || []) {
    if (child.dataset) delete child.dataset.bsPrimaryMockup;
    setHidden(child, false);
  }
  return (collapsed || []).length;
}

// 보드 1장을 root 안에 세운다. <template>은 registry가 보드당 1회만 파싱하고
// 여기서는 cloneNode만 한다 — 같은 보드를 다시 마운트하면 텍스트만 갈아끼운다.
function slotTextValue(value) {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object') {
    if (typeof value.value === 'string') return value.value.trim();
    if (typeof value.text === 'string') return value.text.trim();
  }
  return '';
}

function nameFromBoundValues(values) {
  if (!values || typeof values !== 'object') return '';
  for (const slotId of ['s001', 's002']) {
    const text = slotTextValue(values[slotId]);
    if (!text || text.includes(FIXTURE_STOCK_NAME) || text.includes('통합 호가')) continue;
    const short = text.split('·')[0].trim();
    if (short && short.length <= 32) return short;
  }
  return '';
}

function sectorIdentityFromEnvelope(envelope = {}) {
 const args=envelope.operation_args||envelope.operationArgs||{}, op=envelope.operation_ref||envelope.operationRef||'';
 if(!/^base:ka200(?:0[1-9]|19)$/.test(op)&&!/^detail:ka20001:/.test(op))return {name:'업종 이름 미제공',code:''};
 const requested=String(args.inds_cd||'').trim(), actual=String(envelope.data?.symbol||'').trim();
 if(!/^\d{3}$/.test(requested)||(actual&&actual!==requested))return {name:'업종 이름 미제공',code:''};
 const known={'001':'KOSPI 종합','101':'KOSDAQ 종합'};
 return {code:requested,name:known[requested]||'업종 '+requested};
}

function boardIdentityFromEnvelope(envelope = {}, values = null) {
  const stringValue = (value) => typeof value === 'string' ? value.trim() : '';
  const args = envelope.operation_args || envelope.arguments || {};
  const code = stringValue(envelope.stk_cd || args.stk_cd || envelope.symbol || args.symbol);
  let name = stringValue(
    (envelope.data && envelope.data.stk_nm)
    || envelope.stk_nm
    || args.stk_nm,
  );
  for (const contract of [
    envelope.surface_contract || envelope.surfaceContract,
    envelope.initial_surface_contract || envelope.initialSurfaceContract,
  ]) {
    if (name || !contract || registry.cardIdFor(contract.board_id) !== 'CC-03'
      || !slotList(registry.contractFor(contract.board_id))
        .some((slot) => slot.slot_id === 's001' && slot.kind === 'value')) continue;
    const raw = contract.slot_values || contract.slotValues || {};
    name = stringValue(Array.isArray(raw)
      ? (raw.find((slot) => slot.slot_id === 's001') || {}).value : raw.s001);
  }
  if (!name) name = nameFromBoundValues(values);
  return displayPolicy.correctBoardIdentity(envelope, values, { name, code });
}

function applyQueryContext(surface, contract, options) {
  const id = contract.board_id;
  if (!['31UD-0', '2Z49-0', '3TOM-0', '15R0-2'].includes(id)) return;
  if (id === '15R0-2') surface.classList.toggle('bs-vi-snapshot', options.operationRef === 'base:ka10054');
  if (id === '15R0-2' && options.operationRef !== 'base:ka10054') {
    surface.querySelector('.bs-query-context')?.remove();
    return;
  }
  const args = options.operationArgs || {};
  let text;
  if (id === '15R0-2') {
    text = 'VI 조회 결과 · 지수는 별도 조회가 필요합니다';
  } else if (id === '31UD-0') {
    const target = [options.identity?.name, args.stk_cd || options.identity?.code].filter(Boolean).join(' · ');
    const day = { '1': '당일', '2': '전일' }[String(args.tdy_pred)] || '조회일 미확인';
    text = `${target || '조회 종목 미확인'} · ${day} 체결 내역`;
  } else {
    const issuer = args.isscomp_cd ? `거래원 코드 ${args.isscomp_cd}` : '거래원 미확인';
    const period = { '1': '전일', '5': '5일', '10': '10일', '40': '40일', '60': '60일' }[String(args.dt)] || '기간 미확인';
    const direction = { '1': '순매수', '2': '순매도' }[String(args.trde_tp)] || '순매매';
    text = `${issuer} · ${period} · 종목별 ${direction}`;
  }
  let note = surface.querySelector('.bs-query-context');
  if (!note) {
    note = surface.ownerDocument.createElement('div');
    note.className = 'bs-query-context';
    surface.insertBefore(note, surface.querySelector('.bs-workspace'));
  }
  note.textContent = text;
}

function mountBoard(root, boardId, values, options = {}) {
  const doc = options.doc || (typeof document !== 'undefined' ? document : null);
  if (!root || !doc) return null;
  // 마운트 계약은 정적이라 색인이 갖고 있다(값만 봉투가 나른다). 호출부가
  // 명시로 넘기면 그쪽을 쓴다 — 상태 보드 전환·테스트가 그 경로를 쓴다.
  const contract = options.contract || registry.contractFor(boardId);
  if (!contract || !Array.isArray(contract.slots)) throw new Error(`보드 슬롯 계약이 없다 — ${boardId}`);
  const template = registry.templateFor(boardId, doc);
  if (!template) throw new Error(`보드 템플릿이 없다 — ${boardId}`);

  // 탭의 예시 종목이나 누락된 조회 응답이 원래 카드 종목을 바꾸지 않는다.
  // CC-04 호가는 Paper 픽스처가 「삼성전자 통합 호가」로 박혀 있어, 다른 종목
  // 조회에서도 그 제목이 남았다. 카드 주제(identity)로만 고친다.
  const cardId = registry.cardIdFor(boardId);
  const identity = (cardId === 'CC-03' || cardId === 'CC-04'
    || ['2QFO-2', '2QM7-2', '2ROJ-1', '2RWK-1', '2S4E-1'].includes(String(boardId))) ? options.identity : null;
  const plan = mountPlan(contract, values, { ...options, identity });
  let surface = root.__bsSurface;
  if (!surface || root.__bsBoardId !== String(boardId) || !root.contains(surface)) {
    root.replaceChildren(template.content.cloneNode(true));
    surface = surfaceRoot(root);
    if (!surface) throw new Error(`board.html에 보드 루트가 없다 — ${boardId}`);
    surface.dataset.bsBoardId = String(boardId);
    applyResponsiveHooks(surface);
    applyReadableBoardLayout(surface, contract);
    prepareOrderbookDetails(surface, contract);
    if (cardId === 'CC-01') {
      const links = registry.stateLinksFor(boardId);
      for (const link of links) {
        const node = findStateControlNode(surface, link.control, { links });
        if (node) node.dataset.bsAccountNavigation = 'true';
      }
    }
    if (String(boardId) === '3GRO-0') {
      const strip = authoredNode(surface, '3S9V-0');
      if (strip) {
        strip.tabIndex = 0;
        strip.setAttribute('role', 'region');
        strip.setAttribute('aria-label', '증거금율 구간별 주문가능');
        const hint = layoutGroup(doc, 'bs-readable-hint');
        hint.textContent = '구간을 좌우로 이동해 모두 확인하세요';
        strip.after(hint);
      }
    }
    prepareInvestorGrid(surface, contract);
    if (flowLayout) flowLayout.prepare(surface, contract);
    if (goldQuote) goldQuote.prepare(surface, contract);
    suppressStaticGraphics(surface, contract);
    prepareFlowResidualLists(surface, contract);
    prepareRankFour(surface, contract);
    prepareRankNine(surface, contract);
    prepareFlowRankFive(surface, contract);
    scrubRawIdentityNames(surface);
    root.__bsSurface = surface;
    root.__bsBoardId = String(boardId);
  }
  const report = applyPlan(surface, plan, options);
  applyConditionQueryMode(surface, contract, options.operationRef);
  updateBasketRows(surface, contract, plan, values);
  if (flowLayout) flowLayout.update(surface, contract, plan, options);
  if (goldQuote) goldQuote.update(surface, contract, plan, options);
  updateEmptyTableStates(surface);
  compactReducedContent(surface, contract);
  applyQueryContext(surface, contract, options);
  updateWatchDetails(surface, plan, options);
  if (etfPeriod) etfPeriod.mount(surface, contract, plan, options);
  if (rankingResult) rankingResult.mount(surface, contract, plan, options);
  // 값이 실린 뒤에 잰다 — 목업보다 긴 값이 들어오면 줄이 그때 넘친다. 폭이 바뀌면
  // 표면의 관찰자가 다시 잰다.
  relaxOverflowHeights(surface);
  // 같은 폭이어도 새 응답으로 행·레일 구성이 바뀌면 다시 측정한다.
  delete surface.__bsRelaxWidth;
  relaxOverflowRows(surface);
  watchSurfaceWidth(surface);
  // 렌더러가 저작된 보드에서만 자리를 딸려 보낸다 — 그 자리에 앱 렌더러를 얹는 것은
  // 호출부(canvas) 몫이고, 여기는 자리를 찾아 주기만 한다.
  const primary = contract.primary && contract.primary.renderer
    ? {
      renderer: String(contract.primary.renderer),
      mountPoint: primaryMountPoint(surface, contract),
      propsFrom: contract.primary.props_from || [],
    }
    : null;
  return { surface, plan, primary, ...report };
}

// 청크를 먼저 실은 뒤 마운트한다. 셸은 색인(수 KB)만 동기로 싣고 원문 HTML은
// 카드 청크에 있으므로, 그 카드의 첫 보드는 여기서 한 번 기다린다. 값만 바뀌는
// 재마운트·상태 보드 교체는 이미 상주한 청크를 써서 같은 프레임에서 끝난다.
function mountBoardAsync(root, boardId, values, options = {}) {
  if (registry.isLoaded(boardId)) {
    try {
      return Promise.resolve(mountBoard(root, boardId, values, options));
    } catch (error) {
      return Promise.reject(error);
    }
  }
  return registry.loadBoard(boardId).then(() => mountBoard(root, boardId, values, options));
}

// 같은 보드 자리에서 겹쳐 달리는 비동기 로드 중 마지막 요청만 DOM 소유권을 갖는다.
// 카드 닫기·상태 보드 전환 뒤에 먼저 시작한 hydrate가 늦게 끝나도 이전 보드를
// 되살리지 않도록 호출자에게 current 판정 함수를 건넨다.
function createLatestBoardLoad() {
  let revision = 0;
  let disposed = false;

  function invalidate() {
    revision += 1;
  }

  function dispose() {
    disposed = true;
    invalidate();
  }

  async function run(task, handlers = {}) {
    const ticket = ++revision;
    const isCurrent = () => !disposed && revision === ticket;
    if (typeof handlers.onLoading === 'function') handlers.onLoading();
    try {
      const value = await task(isCurrent);
      if (!isCurrent()) return { status: 'stale' };
      if (typeof handlers.onReady === 'function') await handlers.onReady(value);
      return { status: 'ready', value };
    } catch (error) {
      if (!isCurrent()) return { status: 'stale' };
      const retry = () => run(task, handlers);
      if (typeof handlers.onError === 'function') handlers.onError(error, retry);
      return { status: 'error', error };
    }
  }

  return { run, invalidate, dispose };
}

function nextHydrationSlots(pending, filled, surfaceContract) {
  const authoritative = surfaceContract && surfaceContract.hydration_slot_ids;
  if (Array.isArray(authoritative)) return authoritative.slice();
  const values = filled && typeof filled === 'object' && !Array.isArray(filled) ? filled : {};
  return (Array.isArray(pending) ? pending : [])
    .filter((slotId) => !Object.prototype.hasOwnProperty.call(values, slotId));
}

const __exports = {
  ROLLUP_MARK, RESPONSIVE_REGIONS, HOISTED_PROPERTIES, CARD_SHELL_PROPERTIES, normalizeCardShell,
  isValueSlot, anchorOf, staticTextOf, collapsePlan, mountPlan, pairedGroups,
  nodeIndex, elementChildCount, setHidden, setStatusAppearance, applyPlan, collapseEmptyRows, collapseEmptyColumns,
  relaxOverflowRows, relaxOverflowHeights, isRelaxableRow, isRowShape, squeezedRow,
  reachesByScroll,
  scrollOverflowOwner,
  watchSurfaceWidth,
  wrapOverflowingLabels,
  markDeclaredScrollBox,
  hoistLayout, hoistRigidBox, applyResponsiveHooks, surfaceRoot,
  primaryMountPoint, collapsePrimaryMockup, restorePrimaryMockup, mountBoard, mountBoardAsync,
  markPrimaryRows,
  inapplicableBasketRows,
  sectorIdentityFromEnvelope, boardIdentityFromEnvelope,
  createLatestBoardLoad, nextHydrationSlots,
  RAW_IDENTITY_NAME, scrubRawIdentityNames,
  slotValueEntries, observationIdsOfSlotEntry, realtimeSlotIndex, updateRealtimeValue,
  pairedClosure, realtimePlan, applyRealtimeSlots,
  stateLinksFromMarks, stateControlActivationOwner, wireStateControlActivation,
  findStateControlNode, STATE_CONTROL_SCOPES, STATE_CONTROL_WIDE_SCOPES,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.BoardMount = __exports;
}

})();
