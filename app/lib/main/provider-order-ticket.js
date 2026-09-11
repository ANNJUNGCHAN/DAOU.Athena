'use strict';

const { buildSelectorOrderPrefill } = require('../order-ticket');

const CASH_ORDER_SIDES = Object.freeze({
  'base:kt10000': 'buy',
  'base:kt10001': 'sell',
});

function toSelectorPayload(confirmation) {
  if (!confirmation || confirmation.ticketCreated !== true) return null;
  const ref = confirmation.operationRef;
  const side = CASH_ORDER_SIDES[ref];
  const draft = confirmation.orderDraft;
  if (!side || !draft || typeof draft !== 'object' || Array.isArray(draft)) return null;
  const payload = {
    status: 'guarded',
    operation_ref: ref,
    order_draft: {
      dmst_stex_tp: draft.dmst_stex_tp || 'KRX',
      stk_cd: draft.stk_cd,
      ord_qty: draft.ord_qty,
      trde_tp: '3',
      side,
    },
  };
  return buildSelectorOrderPrefill(payload) ? payload : null;
}

function presentProviderOrderTicket({ confirmation, sendDraft } = {}) {
  if (typeof sendDraft !== 'function') return false;
  const payload = toSelectorPayload(confirmation);
  if (!payload) return false;
  sendDraft(payload);
  return true;
}

module.exports = {
  toSelectorPayload,
  presentProviderOrderTicket,
};
