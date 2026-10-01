import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { investorCaption } = createRequire(import.meta.url)('./board-flow-layout.js');

test('investor caption names the received day and requested trade mode', () => {
  const plan = { assignments:[{ slotId:'s027',text:'2026-10-01',missing:false }] };
  assert.equal(investorCaption(plan, { operationRef:'base:ka10059', operationArgs:{dt:'20260930',trde_tp:'2',amt_qty_tp:'2'} }), '2026-10-01 · 매도 · 수량');
});

test('period sums describe the requested period and do not invent unavailable arguments', () => {
  const plan = { assignments:[{ slotId:'s027',text:'2026-09-30',missing:false }] };
  assert.equal(investorCaption(plan, { operationRef:'base:ka10061', operationArgs:{strt_dt:'20260101',end_dt:'20261001',trde_tp:'0',amt_qty_tp:'1'} }), '2026-01-01 ~ 2026-10-01 · 순매수 · 금액');
  assert.equal(investorCaption({ assignments:[] }, {}), '조회 기간 미제공 · 매매구분 미제공 · 금액·수량 구분 미제공');
});
