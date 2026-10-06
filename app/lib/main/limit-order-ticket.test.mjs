import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import selectorFastPath from './selector-fast-path.js';
import providerOrderTicket from './provider-order-ticket.js';
import orderTicket from '../order-ticket.js';
import stockEntityIndexModule from './rest-dataset-runner.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));

test('지정가 초안은 요청 가격과 유형을 실제 티켓 본문까지 보존한다', () => {
  const index = new stockEntityIndexModule.StockEntityIndex();
  index.replace([{ code: '005930', name: '삼성전자', market: '0' }]);
  const draft = selectorFastPath.buildMarketOrderDraft(
    '삼성전자 005930 1주 지정가 200000원 매수 주문 초안만 만들어줘',
    index,
  );
  assert.deepEqual(draft, {
    intent: 'order', expectedOperationRef: 'base:kt10000', side: 'buy',
    arguments: {
      dmst_stex_tp: 'KRX', stk_cd: '005930', ord_qty: '1', ord_uv: '200000', trde_tp: '0',
    },
  });

  const payload = providerOrderTicket.toSelectorPayload({
    ticketCreated: true,
    operationRef: draft.expectedOperationRef,
    orderDraft: draft.arguments,
  });
  const prefill = orderTicket.buildSelectorOrderPrefill(payload);
  assert.deepEqual(prefill, {
    symbol: '005930', side: 'buy', qty: 1, orderType: 'limit', limitPrice: 200000,
    reason: '지정가 구매 주문 초안 — 실행 전 내용을 확인하세요',
  });
  const ticket = orderTicket.createTicket(prefill);
  assert.deepEqual(orderTicket.buildOrderPayload(ticket), {
    tr_id: 'kt10000',
    body: {
      dmst_stex_tp: 'KRX', stk_cd: '005930', ord_qty: '1', ord_uv: '200000', trde_tp: '0',
    },
  });
  assert.deepEqual(orderTicket.priceRowModel(ticket), {
    segments: ['지정가', '시장가'], selected: '지정가',
    readout: '200,000원 지정가', limitEnabled: true,
  });
  assert.deepEqual(orderTicket.estimateOrderTotal({
    qty: 1, orderType: 'limit', limitPrice: 200000,
  }), { label: '총 주문 금액 (지정가)', text: '200,000원' });
  const chatSource = fs.readFileSync(path.join(testDir, '..', '..', 'chat.js'), 'utf8');
  assert.match(chatSource, /chip\.addEventListener\('click', \(\) => selectPriceType\(seg\)\)/);
  assert.match(chatSource, /ticket\.limitPrice = ticket\.orderType === 'limit'/);
});

test('시장가 초안은 그대로 시장가이고, 단가가 없거나 어긋난 지정가는 티켓이 되지 않는다', () => {
  const index = new stockEntityIndexModule.StockEntityIndex();
  index.replace([{ code: '005930', name: '삼성전자', market: '0' }]);
  const market = selectorFastPath.buildMarketOrderDraft('삼성전자 2주 시장가 매도해줘', index);
  assert.deepEqual(market.arguments, {
    dmst_stex_tp: 'KRX', stk_cd: '005930', ord_qty: '2', trde_tp: '3',
  });
  assert.equal(market.side, 'sell');

  const guarded = (draft) => ({ status: 'guarded', operation_ref: 'base:kt10000', order_draft: draft });
  const base = { dmst_stex_tp: 'KRX', stk_cd: '005930', ord_qty: '1' };
  assert.equal(orderTicket.buildSelectorOrderPrefill(guarded({ ...base, trde_tp: '0' })), null);
  assert.equal(orderTicket.buildSelectorOrderPrefill(guarded({ ...base, trde_tp: '0', ord_uv: '0' })), null);
  assert.equal(orderTicket.buildSelectorOrderPrefill(guarded({ ...base, trde_tp: '3', ord_uv: '1000' })), null);
  assert.equal(orderTicket.buildSelectorOrderPrefill(guarded({ ...base, trde_tp: '5', ord_uv: '1000' })), null);

  assert.throws(() => orderTicket.buildOrderPayload({
    symbol: '005930', side: 'buy', qty: 1, orderType: 'limit', limitPrice: 0,
  }), /지정가는/);
});
