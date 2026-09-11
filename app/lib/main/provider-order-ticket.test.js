'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { toSelectorPayload, presentProviderOrderTicket } = require('./provider-order-ticket');

const BUY = {
  ticketCreated: true,
  operationRef: 'base:kt10000',
  orderDraft: { dmst_stex_tp: 'KRX', stk_cd: '005930', ord_qty: '2', trde_tp: '0' },
};

test('provider confirmation becomes a guarded market ticket without executing', () => {
  const payload = toSelectorPayload(BUY);
  assert.deepEqual(payload, {
    status: 'guarded',
    operation_ref: 'base:kt10000',
    order_draft: {
      dmst_stex_tp: 'KRX', stk_cd: '005930', ord_qty: '2', trde_tp: '3', side: 'buy',
    },
  });
});

test('provider confirmation does not open a ticket without a created draft', () => {
  assert.equal(toSelectorPayload({
    ticketCreated: false,
    operationRef: 'base:kt10000',
    orderDraft: BUY.orderDraft,
  }), null);
  assert.equal(toSelectorPayload({
    ticketCreated: true,
    operationRef: 'base:kt10000',
  }), null);
});

test('presentProviderOrderTicket sends the guarded draft and never calls execute', () => {
  const sent = [];
  let executions = 0;
  const confirmation = { ...BUY, execute: () => { executions += 1; } };
  assert.equal(presentProviderOrderTicket({
    confirmation,
    sendDraft: (payload) => sent.push(payload),
  }), true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].order_draft.side, 'buy');
  assert.equal(sent[0].order_draft.trde_tp, '3');
  assert.equal(executions, 0);
});
