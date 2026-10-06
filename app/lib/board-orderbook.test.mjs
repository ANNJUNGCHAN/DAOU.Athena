import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { parseQuoteBookTick } = require('./main/orderbook-realtime');
const book = require('./board-orderbook');

test('typed quote frame preserves side, depth, venue and LP without exposing raw fields', () => {
  const tick = parseQuoteBookTick({ type:'0D', item:'A123456', values:{
    41:'-10001', 50:'10010', 51:'9999', 60:'9990', 61:'0', 90:'-4',
    621:'12', 630:'99', 631:'13', 640:'88', 6044:'14', 6053:'77',
    6054:'15', 6063:'66', 6066:'16', 6075:'55', 6076:'17', 6085:'44',
    6064:'101', 6065:'102', 6086:'103', 6087:'104', 122:'-5', 126:'6',
  } });
  assert.equal(tick.symbol,'123456');
  assert.deepEqual([tick.sellPrices[0],tick.sellPrices[9],tick.buyPrices[0],tick.buyPrices[9]],[10001,10010,9999,9990]);
  assert.deepEqual([tick.sellQuantities[0],tick.sellChanges[9]],[0,-4]);
  assert.deepEqual([tick.sellLpQuantities[9],tick.buyLpQuantities[9],tick.krxSellQuantities[9],tick.krxBuyQuantities[9],tick.nxtSellQuantities[9],tick.nxtBuyQuantities[9]],[99,88,77,66,55,44]);
  assert.deepEqual([tick.krxSellTotal,tick.krxBuyTotal,tick.nxtSellTotal,tick.nxtBuyTotal,tick.sellTotalChange,tick.buyTotalChange],[101,102,103,104,-5,6]);
  assert.equal(tick.values,undefined);
});

test('authored regular tables receive their corresponding level, without fabricating missing fields', () => {
  const tick=parseQuoteBookTick({type:'0D',item:'123456',values:{45:'10005',50:'10010',51:'9999',65:'0',70:'22',6053:'33',6075:'44',630:'55'}});
  const five=book.updatesFor('2TRW-1',tick),venues=book.updatesFor('3JZ3-0',tick),details=book.updatesFor('3N4O-0',tick);
  assert.equal(five.s029,10005);assert.equal(five.s031,0);
  assert.deepEqual([venues.s031,venues.s032,venues.s034,venues.s035,venues.s036],[10010,22,33,44,55]);
  assert.deepEqual([details.s018,details.s019,details.s022],[10010,22,55]);
  assert.equal(details.s024,undefined);
  for(const id of ['2QRP-1','2QX1-1','3JT4-0','137X-2'])assert.deepEqual(book.updatesFor(id,tick),{});
});

test('zero prices and quantities remain typed data while malformed partial ticks do not erase values', () => {
  assert.deepEqual(book.updatesFor('2TRW-1',{sellPrices:[null,null,null,null,0],sellQuantities:[null,null,null,null,0]}),{s029:0,s031:0});
  assert.deepEqual(book.updatesFor('2TRW-1',{sellPrices:[null,null,null,null,'10005']}),{});
});

test('authored subscription is single per surface and stale-board callbacks cannot repaint', () => {
  const source=fs.readFileSync(new URL('../canvas.js',import.meta.url),'utf8');
  const start=source.indexOf('function mountAuthoredOrderbook('),end=source.indexOf('function mountBoardOrderbook(',start);
  const surface={}, card={}, state={boardId:'2TRW-1',surface,values:{s029:1},valuesByBoard:new Map(),mountContract:{}};
  const host={closest:()=>card};let opened=0,callback,applied=0,options;
  const context={window:{AthenaLib:{BoardOrderbook:book}},boardStateOf:()=>state,
    boardMount:{applyRealtimeSlots:()=>applied++},
    wireOrderbookRealtime:(_card,_surface,_envelope,fn,opts)=>{opened++;callback=fn;options=opts;return()=>true;}};
  vm.createContext(context);vm.runInContext(source.slice(start,end),context);
  context.mountAuthoredOrderbook(host,{}, {surface});context.mountAuthoredOrderbook(host,{}, {surface});
  assert.equal(opened,1);assert.equal(options.fallbackKind,'integrated-board');
  callback(surface,{}, {sellPrices:[null,null,null,null,12345]});
  assert.equal(state.values.s029,12345);assert.equal(applied,1);
  state.boardId='2QRP-1';callback(surface,{}, {sellPrices:[null,null,null,null,99999]});
  assert.equal(state.values.s029,12345);assert.equal(applied,1);
});
