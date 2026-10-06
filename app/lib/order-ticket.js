// IIFE 스코프 격리 — canvas-layout.js와 같은 UMD 패턴.
(function () {
'use strict';

// 발화 이벤트 → 티켓 프리필. AI가 채우는 것은 값(종목·발화 시점 관측값)과
// 사유까지다 — 방향·수량은 사람이 티켓에서 정한다(자동 주문 제안 아님).
function buildPrefill(event) {
  if (!event || event.type !== 'routine-fired') return null;
  return {
    symbol: event.symbol,
    firedAt: event.fired_at || null,
    observed: event.observed,
    mode: event.mode,
    reason: `루틴 '${event.note || event.routine_id}' ${event.fired_at ? '발화' : ''}`.trim(),
  };
}

// Selector one-shot 응답 → 사람 확인용 주문 티켓 프리필.
// 현금 주식 시장가·지정가 매수/매도 초안을 사람 확인 티켓으로 바꾼다.
function buildSelectorOrderPrefill(payload) {
  if (!payload) return null;
  const goldOperation = payload.operation_ref === 'base:kt50000' ? 'buy'
    : payload.operation_ref === 'base:kt50001' ? 'sell' : null;
  if (goldOperation) {
    if (payload.status !== 'collecting' && payload.status !== 'guarded') return null;
    const draft = payload.order_draft;
    if (!draft || typeof draft !== 'object' || Array.isArray(draft)) return null;
    if (draft.asset_kind !== 'gold' || draft.side !== goldOperation) return null;
    if (!['market', 'regular', 'unspecified'].includes(draft.requested_order_type)
        || draft.execution_supported !== false) return null;
    if (draft.unit !== 'g') return null;
    if (typeof draft.execution_blocker !== 'string' || !draft.execution_blocker.trim()) return null;

    const products = {
      M04020000: '금 99.99_1kg',
      M04020100: '미니금 99.99_100g',
    };
    const symbol = draft.stk_cd == null ? null : String(draft.stk_cd);
    if (symbol != null && !Object.hasOwn(products, symbol)) return null;
    if (symbol != null && draft.product_name != null && draft.product_name !== products[symbol]) return null;

    const qtyText = typeof draft.ord_qty === 'number' ? String(draft.ord_qty) : draft.ord_qty;
    if (qtyText != null && (typeof qtyText !== 'string' || !/^[1-9]\d*$/.test(qtyText))) return null;
    const qty = qtyText == null ? null : Number(qtyText);
    if (qty != null && (!Number.isSafeInteger(qty) || qty > 100000)) return null;

    return {
      assetKind: 'gold',
      symbol,
      productName: symbol == null ? null : products[symbol],
      side: goldOperation,
      qty,
      unit: 'g',
      orderType: draft.requested_order_type,
      executionSupported: false,
      executionBlocker: draft.execution_blocker.trim(),
      reason: `금현물 ${draft.requested_order_type === 'market' ? '시장가' : draft.requested_order_type === 'regular' ? '보통' : '유형 미지정'} ${goldOperation === 'buy' ? '매수' : '매도'} 주문 초안`,
    };
  }

  if (payload.status !== 'guarded') return null;
  const side = payload.operation_ref === 'base:kt10000' ? 'buy'
    : payload.operation_ref === 'base:kt10001' ? 'sell' : null;
  if (!side) return null;

  const draft = payload.order_draft;
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) return null;
  if (draft.side != null && draft.side !== side) return null;
  const tradeType = String(draft.trde_tp);
  if (draft.dmst_stex_tp !== 'KRX' || !['0', '3'].includes(tradeType)) return null;
  if (typeof draft.stk_cd !== 'string' || !/^\d{6}$/.test(draft.stk_cd)) return null;

  const qtyText = typeof draft.ord_qty === 'number'
    ? String(draft.ord_qty) : draft.ord_qty;
  if (typeof qtyText !== 'string' || !/^[1-9]\d*$/.test(qtyText)) return null;
  const qty = Number(qtyText);
  if (!Number.isSafeInteger(qty) || qty > 100000) return null;
  const limitPriceText = draft.ord_uv == null ? null : String(draft.ord_uv).replace(/,/g, '');
  const limitPrice = limitPriceText == null ? null : Number(limitPriceText);
  if (tradeType === '0'
      && (!/^[1-9]\d*$/.test(limitPriceText || '') || !Number.isSafeInteger(limitPrice)
        || limitPrice > 1_000_000_000)) return null;
  if (tradeType === '3' && draft.ord_uv != null && String(draft.ord_uv).trim() !== '') return null;
  const orderType = tradeType === '0' ? 'limit' : 'market';

  return {
    symbol: draft.stk_cd,
    side,
    qty,
    orderType,
    ...(orderType === 'limit' ? { limitPrice } : {}),
    reason: `${orderType === 'limit' ? '지정가' : '시장가'} ${side === 'buy' ? '구매' : '판매'} 주문 초안 — 실행 전 내용을 확인하세요`,
  };
}

// 게이트 사전 판정 — 비활성이면 실행 버튼을 잠그고 사유를 보여준다(정직 고지).
function gateBlocker(accountInfo) {
  if (!accountInfo) return '계좌 정보를 확인할 수 없습니다 — 백엔드 기동을 확인해 주세요';
  if (!accountInfo.orderApi) {
    return '활성 계좌의 주문 API가 OFF입니다 — 설정 › 계좌에서 게이트를 여세요.';
  }
  return null;
}

// Paper 9F3-0 잠금 블록 — 라벨과 사유를 한 문장으로 붙이지 않는다.
function gateLockModel(blocker) {
  if (!blocker) return { locked: false, label: null, reason: null };
  return {
    locked: true,
    label: '지금은 실행할 수 없음',
    reason: String(blocker),
  };
}

// 매수 kt10000 / 매도 kt10001 — generated/models.py 실측 필드만 쓴다.
function buildOrderPayload(ticket) {
  if (ticket && ticket.assetKind === 'gold') {
    throw new Error(ticket.executionBlocker || '금현물 시장가 주문은 실행할 수 없다');
  }
  if (!/^\d{6}$/.test(ticket.symbol || '')) throw new Error('종목코드가 유효하지 않다');
  const qty = Number(ticket.qty);
  if (!Number.isInteger(qty) || qty <= 0 || qty > 100000) {
    throw new Error('수량은 1~100,000 사이 정수여야 한다');
  }
  if (ticket.side !== 'buy' && ticket.side !== 'sell') {
    throw new Error('방향(매수/매도)을 선택해야 한다');
  }
  const orderType = ticket.orderType === 'limit' ? 'limit' : 'market';
  const limitPrice = Number(ticket.limitPrice);
  if (orderType === 'limit'
      && (!Number.isSafeInteger(limitPrice) || limitPrice < 1 || limitPrice > 1_000_000_000)) {
    throw new Error('지정가는 1~1,000,000,000원 사이 정수여야 한다');
  }
  return {
    tr_id: ticket.side === 'buy' ? 'kt10000' : 'kt10001',
    body: {
      dmst_stex_tp: 'KRX',
      stk_cd: ticket.symbol,
      ord_qty: String(qty),
      ...(orderType === 'limit' ? { ord_uv: String(limitPrice) } : {}),
      trde_tp: orderType === 'limit' ? '0' : '3',
    },
  };
}

// 총 주문 금액 추정 — 수량 × 발화 시점 관측값. 관측값은 집행 시점 값이 아니므로
// 라벨의 '(시장가 추정)'과 값의 '약'을 양쪽 다 남긴다. 관측값이나 수량이 없으면
// 행 자체를 만들지 않는다(0원을 지어내지 않는다).
function estimateOrderTotal(input) {
  const src = input || {};
  const qty = Number(src.qty);
  const isLimit = src.orderType === 'limit';
  const observed = Number(isLimit ? src.limitPrice : src.observed);
  if (!Number.isFinite(qty) || qty <= 0) return null;
  if ((isLimit ? src.limitPrice : src.observed) == null
      || !Number.isFinite(observed) || observed <= 0) return null;
  const total = Math.round(qty * observed);
  return {
    label: isLimit ? '총 주문 금액 (지정가)' : '총 주문 금액 (시장가 추정)',
    text: `${isLimit ? '' : '약 '}${String(total).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}원`,
  };
}

// 가격 행 — 실행되는 것이 시장가 고정임을 각주가 아니라 값으로 드러낸다.
// 지정가는 P4 1차 범위 밖이라 눌리지 않는 세그먼트다(UI가 약속하면 거짓이 된다).
function priceRowModel(input) {
  if (input && input.assetKind === 'gold') {
    if (input.orderType === 'regular') {
      return {
        segments: ['보통', '시장가'],
        selected: '보통',
        readout: '단가 입력 필요 · 실행 불가',
        limitEnabled: false,
      };
    }
    if (input.orderType !== 'market') {
      return {
        segments: ['보통', '시장가'],
        selected: null,
        readout: '주문 유형 미지정 · 실행 불가',
        limitEnabled: false,
      };
    }
    return {
      segments: ['지정가', '시장가'],
      selected: '시장가',
      readout: '시장가 요청 · 실행 불가',
      limitEnabled: false,
    };
  }
  if (input && input.orderType === 'limit') {
    const price = Number(input.limitPrice);
    return {
      segments: ['지정가', '시장가'],
      selected: '지정가',
      readout: Number.isSafeInteger(price) && price > 0
        ? `${String(price).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}원 지정가`
        : '지정가를 입력해 주세요',
      limitEnabled: true,
    };
  }
  return {
    segments: ['지정가', '시장가'],
    selected: '시장가',
    readout: '시장가 체결',
    limitEnabled: false,
  };
}

// Paper 1OP-0 수량 칩 — 10% · 25% · 50% · 최대. 매수여력·보유·관측가가 없으면
// 칩은 그리되 수량을 짓지 않는다(실주문 없음 · 없는 잔고를 있다고 하지 않는다).
const QTY_CHIP_FRACTIONS = Object.freeze([
  { label: '10%', fraction: 0.10 },
  { label: '25%', fraction: 0.25 },
  { label: '50%', fraction: 0.50 },
  { label: '최대', fraction: 1 },
]);

function parsePaddedNumber(raw) {
  if (raw == null || raw === '') return null;
  const n = Number(String(raw).replace(/,/g, '').trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function stockCode6(raw) {
  const digits = String(raw == null ? '' : raw).replace(/\D/g, '');
  return digits.length >= 6 ? digits.slice(-6) : '';
}

// kt00001 주문가능금액 · kt00018 보유 행만 읽는다. 없는 필드는 null — 0을 지어내지 않는다.
function readTicketCapacity(input) {
  const src = input || {};
  const cash = src.cash && typeof src.cash === 'object' && !Array.isArray(src.cash) ? src.cash : {};
  const buyingPower = parsePaddedNumber(cash.ord_alow_amt);
  const holdingsBody = src.holdings && typeof src.holdings === 'object' ? src.holdings : {};
  const rows = Array.isArray(src.holdingsRows) ? src.holdingsRows
    : Array.isArray(holdingsBody.acnt_evlt_remn_indv_tot) ? holdingsBody.acnt_evlt_remn_indv_tot
    : [];
  const symbol = stockCode6(src.symbol);
  let holdings = null;
  if (symbol) {
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      if (stockCode6(row.stk_cd) !== symbol) continue;
      holdings = parsePaddedNumber(row.trde_able_qty) || parsePaddedNumber(row.rmnd_qty);
      break;
    }
  }
  return { buyingPower, holdings };
}

function qtyChipModel(input) {
  const src = input || {};
  const side = src.side === 'buy' || src.side === 'sell' ? src.side : null;
  const observed = Number(src.observed);
  const buyingPower = Number(src.buyingPower);
  const holdings = Number(src.holdings);
  let reason = null;
  if (!side) reason = '방향을 먼저 고르세요';
  else if (side === 'buy' && !(Number.isFinite(buyingPower) && buyingPower > 0)) {
    reason = '매수 가능 금액을 아직 모릅니다';
  } else if (side === 'sell' && !(Number.isFinite(holdings) && holdings > 0)) {
    reason = '보유 수량을 아직 모릅니다';
  } else if (side === 'buy' && !(Number.isFinite(observed) && observed > 0)) {
    reason = '관측가가 없어 수량을 계산할 수 없습니다';
  }
  return {
    unit: '주',
    chips: QTY_CHIP_FRACTIONS.map((chip) => {
      if (reason) return { label: chip.label, qty: null, enabled: false, reason };
      const raw = side === 'buy'
        ? Math.floor((buyingPower * chip.fraction) / observed)
        : Math.floor(holdings * chip.fraction);
      if (!Number.isFinite(raw) || raw < 1) {
        return { label: chip.label, qty: null, enabled: false, reason: '1주 미만입니다' };
      }
      const qty = Math.min(raw, 100000);
      return { label: chip.label, qty, enabled: true, reason: null };
    }),
  };
}

// HTTP 상태 → 티켓 상태. 409(멱등 충돌/IN_DOUBT)는 재전송 금지 상태다.
// 0(전송 중 오류·시간 초과)과 500/502/504는 주문이 나갔는지 알 수 없다 — 재전송하면
// 중복 주문이 될 수 있으므로 종결 상태 in_doubt로 본다.
const IN_DOUBT_STATUSES = new Set([0, 409, 500, 502, 504]);

function interpretExecuteStatus(status) {
  if (status >= 200 && status < 300) return 'done';
  if (IN_DOUBT_STATUSES.has(Number(status) || 0)) return 'in_doubt';
  if (status === 428) return 'needs_confirm';
  return 'failed';
}

// 상태기계: review → executing → done | in_doubt | needs_confirm | failed.
// in_doubt/done은 종결 — 같은 티켓으로 재실행 불가(1회용, 중복 주문 방지).
// 428 확인 요청은 실패가 아니다 — 게이트로 돌아가 다시 누른다(OBS-030, Paper FY7-0).
function createTicket(prefill) {
  const symbol = prefill && typeof prefill.symbol === 'string'
    ? prefill.symbol : null;
  const side = prefill && (prefill.side === 'buy' || prefill.side === 'sell')
    ? prefill.side : null;
  const qty = prefill && Number.isInteger(prefill.qty)
    && prefill.qty > 0 && prefill.qty <= 100000 ? prefill.qty : null;
  return {
    state: 'review',
    prefill,
    assetKind: prefill && prefill.assetKind === 'gold' ? 'gold' : 'stock',
    productName: prefill && typeof prefill.productName === 'string' ? prefill.productName : null,
    unit: prefill && prefill.assetKind === 'gold' ? 'g' : '주',
    orderType: prefill && ['market', 'limit', 'regular', 'unspecified'].includes(prefill.orderType)
      ? prefill.orderType : null,
    limitPrice: prefill && Number.isSafeInteger(prefill.limitPrice) && prefill.limitPrice > 0
      ? prefill.limitPrice : null,
    executionSupported: !(prefill && prefill.executionSupported === false),
    executionBlocker: prefill && typeof prefill.executionBlocker === 'string'
      ? prefill.executionBlocker : null,
    symbol,
    side,
    qty,
    // 멱등키는 티켓마다 한 번 만든다(클릭마다가 아니다). 접수되지 않은 것이 확정된
    // 실패(failed) 뒤에만 새 키로 바꾼다 — rotateIdempotencyKeyAfter 참고.
    idempotencyKey: newIdempotencyKey(),
    result: null,
  };
}

const _TRANSITIONS = {
  review: ['executing'],
  executing: ['done', 'in_doubt', 'needs_confirm', 'failed'],
  failed: ['executing'], // 명시적 재시도는 사람이 새로 누른 경우만(새 멱등키)
  needs_confirm: ['executing'],
  done: [],
  in_doubt: [],
};

function ticketStateAfterExecute(outcome) {
  if (outcome === 'done' || outcome === 'in_doubt' || outcome === 'needs_confirm') return outcome;
  return 'failed';
}

function executeOutcomeTone(outcome) {
  if (outcome === 'done') return 'ok';
  if (outcome === 'in_doubt') return 'warn';
  if (outcome === 'needs_confirm') return 'info';
  return 'up';
}

function executeOutcomeCopy(outcome, res) {
  if (outcome === 'done') return '주문 접수됨 — 체결은 계좌에서 확인하세요.';
  if (outcome === 'in_doubt') {
    return '주문이 전송됐을 수 있습니다(IN_DOUBT) — 중복 방지를 위해 재전송하지 않습니다. 체결·잔고에서 접수 여부를 확인하세요.';
  }
  if (outcome === 'needs_confirm') {
    return '확인 요청 — 조건을 확인한 뒤 주문 게이트로 돌아갑니다.';
  }
  return `실행 실패: ${(res && res.error) || 'HTTP ' + ((res && res.status) || '?')} — 재시도하려면 다시 실행을 누르세요(새 멱등키).`;
}

// 접수되지 않은 것이 확정된 실패만 새 멱등키로 다시 시도한다. 같은 키에는 백엔드가
// 앞선 결과를 캐시하므로, 거절된 주문을 고쳐 다시 낼 때 키가 그대로면 막힌다.
function rotateIdempotencyKeyAfter(ticket, outcome) {
  if (outcome === 'failed') ticket.idempotencyKey = newIdempotencyKey();
  return ticket.idempotencyKey;
}

function transition(ticket, next) {
  const allowed = _TRANSITIONS[ticket.state] || [];
  if (!allowed.includes(next)) {
    throw new Error(`티켓 전이 불가: ${ticket.state} → ${next}`);
  }
  ticket.state = next;
  return ticket;
}

function newIdempotencyKey(randomFn) {
  const rand = randomFn || Math.random;
  return `ticket-${Date.now().toString(36)}-${Math.floor(rand() * 1e9).toString(36)}`;
}

function canPresentOrderTicket(state) {
  if (!state || state.switchingConversation || !state.displayedConversationId
      || state.settingsOpen || state.onboardVisible) {
    return false;
  }
  return true;
}

const __exports = {
  buildPrefill,
  buildSelectorOrderPrefill,
  gateBlocker,
  gateLockModel,
  buildOrderPayload,
  estimateOrderTotal,
  priceRowModel,
  qtyChipModel,
  QTY_CHIP_FRACTIONS,
  readTicketCapacity,
  interpretExecuteStatus,
  ticketStateAfterExecute,
  executeOutcomeTone,
  executeOutcomeCopy,
  createTicket,
  transition,
  newIdempotencyKey,
  rotateIdempotencyKeyAfter,
  canPresentOrderTicket,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = __exports;
} else {
  window.AthenaLib = window.AthenaLib || {};
  window.AthenaLib.OrderTicket = __exports;
}

})();
