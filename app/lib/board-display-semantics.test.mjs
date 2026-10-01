import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const registry = require('./board-template-registry');
const { mountPlan } = require('./board-mount');
const { formatSlot } = require('./board-format');
const source = id => JSON.parse(fs.readFileSync(new URL(`../../backend/ref/card-surface-templates/${id}/slots.json`, import.meta.url)));
const text = (id, values, slot) => mountPlan(registry.contractFor(id), values).assignments.find(x => x.slotId === slot)?.text;

test('chart session label and company secondary metrics retain their meaning', () => {
  assert.equal(text('137X-2', {}, 's109'), '장중');
  assert.equal(text('137X-2', {}, 's122'), '기간중 거래량');
  assert.equal(text('137X-2', {s120:'123456', s123:'654321'}, 's120'), '123,456주');
  assert.equal(text('137X-2', {s120:'123456', s123:'654321'}, 's123'), '654,321주');
  assert.equal(text('2RBO-1', {s070:'0', s071:'0'}, 's070'), '0.00%');
  assert.equal(text('2RBO-1', {s070:'0', s071:'0'}, 's071'), '신용잔고율 0.00%');
  assert.equal(text('2RBO-1', {s042: '7115'}, 's042'), 'EPS 7,115원');
  assert.equal(text('2RBO-1', {s045: '57320'}, 's045'), 'BPS 5만 7,320원');
  const slot = source('2RBO-1').slots.find(s => s.slot_id === 's052');
  const composite = {composite: {...slot.composite, parts: slot.composite.parts.map((p, i) => ({...p, value: i ? '20260918' : '-123450'}))}};
  assert.equal(text('2RBO-1', {s052: composite}, 's052'), '123,450원 · 2026-09-18');
  composite.composite.parts[0].value = '0';
  assert.equal(text('2RBO-1', {s052: composite}, 's052'), '—');
});

test('regular orderbook change rates keep their two decimal places in every repeated location', () => {
  for (const [board,slots] of [['13BC-2',['s011','s062']],['1JPU-0',['s169','s255']],
    ['2TRW-1',['s011','s046']],['3JZ3-0',['s011','s108']],['3N4O-0',['s085','s178']]]) {
    for (const slot of slots) {
      assert.equal(text(board,{[slot]:'0.93'},slot),'+0.93%');
      assert.equal(text(board,{[slot]:'-0.04'},slot),'-0.04%');
    }
  }
});

test('credit and lending summaries describe their actual ranking source and scaled aggregate', () => {
  assert.equal(text('2YS8-0', {}, 's014'), '미제공');
  assert.equal(text('2YS8-0', {s166:'합성가'}, 's166'), '합성가');
  assert.equal(text('2YS8-0', {}, 's133'), '7');
  assert.equal(text('2ZBB-0', {}, 's141'), '8');
  assert.equal(text('2ZBB-0', {s167:'1898'}, 's167'), '18.98%');
  assert.equal(text('2ZBB-0', {}, 's166'), '조회 전체 잔고주수 비율');
  for (const slot of ['s125','s126','s156']) assert.equal(text('2ZBB-0', {}, slot), '');
  for (const slot of ['s172','s174','s176','s178','s180','s182']) assert.equal(text('2ZBB-0', {}, slot), '미제공');
});

test('investor grids label real dates and times without specimen weekdays or cumulative claims', () => {
  assert.equal(text('3DI2-0', {s030:'20261001'}, 's030'), '2026-10-01');
  for (const slot of ['s038','s040','s042','s044','s046','s154','s156']) assert.equal(text('3DI2-0', {}, slot), '');
  assert.equal(text('3DI2-0', {}, 's047'), '조회일');
  assert.equal(text('3DI2-0', {}, 's157'), '조회 시각');
  assert.equal(text('3DI2-0', {s051:{value:'0',text:'0천주',display_unit:'천주'}}, 's051'), '0천주');
});

test('minute timestamps and price changes do not become dates without clocks or percentages', () => {
  assert.equal(text('3FR6-0', {s044:'20261001101500'}, 's044'), '2026-10-01 10:15:00');
  assert.equal(text('3FR6-0', {s049:'1250'}, 's049'), '+1,250원');
  assert.equal(text('3FR6-0', {s048:'-1234'}, 's048'), '1,234');
  assert.equal(text('3FR6-0', {}, 's036'), '분봉 · 최대 13개 표시');
  assert.equal(text('3FR6-0', {}, 's183'), '시각 미제공');
  for (const slot of ['s051','s185','s187','s189','s191']) assert.equal(text('3FR6-0', {}, slot), '—');
});

test('warrant terms absent from the quote response cannot retain specimen periods or amounts', () => {
  for (const slot of ['s018','s027','s232','s238','s240','s242','s245']) assert.equal(text('32XM-0', {}, slot), '—');
});

test('ranking rails name their first result and do not retain unsupported cross-query specimens', () => {
  assert.equal(text('2YA8-0', {}, 's137'), '첫 번째 결과');
  assert.equal(text('2YA8-0', {}, 's140'), '다른 조회 결과');
  for (const slot of ['s141', 's150', 's152', 's154']) assert.equal(text('2YA8-0', {}, slot), '—');
  assert.equal(text('2YA8-0', {s136:'252670'}, 's136'), '252670');
  assert.equal(text('2VDA-0', {s054:'0.34'}, 's054'), '+0.34%');
  assert.equal(text('2VDA-0', {s058:'-30.12'}, 's058'), '전일비 -30.12%');
  assert.equal(text('2VDA-0', {}, 's047'), '거래량 · 전일비');
});

test('a single-market sector list does not claim specimen markets or a fixed selection', () => {
  assert.equal(text('3BQB-0', {}, 's022'), '조회 업종');
  assert.equal(text('3BQB-0', {}, 's047'), '이어지는 업종');
  assert.equal(text('3BQB-0', {}, 's061'), '이어지는 업종');
  for (const slot of ['s023','s032','s048','s062','s072']) assert.equal(text('3BQB-0', {}, slot), '');
  assert.equal(text('3BQB-0', {s024:'001'}, 's024'), '001');
});

test('VI summary describes observed fields and cannot claim an invented active event', () => {
  assert.equal(text('31II-0', {}, 's135'), '첫 번째 결과 · VI 시각');
  assert.notEqual(text('31II-0', {}, 's136'), '한미반도체 · 정적 VI');
  assert.equal(text('31II-0', {s136:'합성 VI 하나'}, 's136'), '합성 VI 하나');
  assert.equal(text('31II-0', {}, 's138'), '체결처리 시각');
  assert.equal(text('31II-0', {}, 's140'), '');
  assert.equal(text('31II-0', {}, 's142'), 'VI 해제 시각');
});

test('actual orderbook price fields hide zero prices while retaining zero quantities', () => {
  for (const id of ['2TRW-1','3JZ3-0','3N4O-0']) {
    const slots=source(id).slots;
    const price=slots.find(s=>/^(?:sel|buy)_(?:[1-9]|10)bid$/.test(s.f||''));
    assert.ok(price,id);
    assert.equal(text(id,{[price.slot_id]:'0'},price.slot_id),'—');
    assert.equal(text(id,{[price.slot_id]:'-12345'},price.slot_id),'12,345');
    const quantity=slots.find(s=>/^(?:sel|buy)_\d+bid_req$/.test(s.f||''));
    assert.ok(quantity,id);
    assert.notEqual(text(id,{[quantity.slot_id]:'0'},quantity.slot_id),'—');
  }
});

test('price differences, direction enumerations, fiscal months and dates keep their separate meanings', () => {
  assert.equal(text('2RBO-1', {s006:-1500}, 's006'), '-1,500');
  assert.equal(text('2RBO-1', {s113:12}, 's113'), '결산 12월');
  assert.equal(text('2X5N-0', {s122:'2'}, 's122'), '상승');
  assert.equal(text('2X5N-0', {s122:'999'}, 's122'), '—');
  assert.equal(text('2SRV-1', {s139:'20260317'}, 's139'), '2026-03-17');
  assert.equal(text('2ROJ-1', {s164:'20260317'}, 's164'), '2026-03-17');
});

test('negative direction-prefixed prices are positive magnitudes across instrument and flow tables', () => {
  for(const id of ['2V71-0','2Y47-0','137X-2']) {
    const slot=source(id).slots.find(s=>s.f==='cur_prc'&&!s.composite);
    const formatted=text(id,{[slot.slot_id]:'-265500'},slot.slot_id);
    assert.ok(formatted&&!formatted.includes('-'),id+': '+formatted);
  }
  assert.equal(formatSlot({kind:'number',sign:true},-23).text,'-23');
});

test('official fixed-point Greek and ETF divisors preserve precision without changing source values', () => {
  const s=source('15P5-2').slots.find(s=>s.slot_id==='s180');
  assert.equal(formatSlot(s.format,'590470').text,'0.590470');
  assert.equal(formatSlot({kind:'number',precision:2,divisor:100},'12345').text,'123.45');
  assert.equal(formatSlot({kind:'number',divisor:0},42).missing,true);
  assert.equal(formatSlot({kind:'number',divisor:-100},42).missing,true);
  assert.equal(formatSlot({kind:'number'},12345).text,'12,345');
});

test('money never acquires share units and source alternatives cannot swap different observations', () => {
  assert.equal(text('2RWK-1',{s047:1234567},'s047'),'12억 3,456만원');
  assert.equal(source('2RWK-1').slots.find(s=>s.slot_id==='s047').alt_mappings.length,0);
  const delta=source('15P5-2').slots.find(s=>s.slot_id==='s005');
  assert.ok(delta.alt_mappings.every(a=>a.f==='pred_pre'));
  const low=source('2TZN-1').slots.find(s=>s.slot_id==='s156');
  assert.ok(low.alt_mappings.every(a=>a.f==='52wk_lwst_pric'));
});

test('relative periods and currency captions cannot display specimen dates or optional foreign values', () => {
  for(const [slot,expected]of Object.entries({s033:'원화',s034:'KRW',s038:'해당 없음',s039:'외화',s048:'D+1',s050:'D+2',s052:'D+3',s054:'D+4'}))assert.equal(text('3NVG-0',{},slot),expected);
  for(const [slot,expected]of Object.entries({s029:'기간 미제공',s031:'기초',s032:'기말',s113:'기간 미제공'}))assert.equal(text('3K7K-0',{},slot),expected);
  assert.equal(text('2ZZ7-0',{},'s005'),'시각 미제공');
  assert.equal(text('2QFO-2',{},'s033'),'5일 누적');
  assert.equal(text('2QRP-1',{},'s091'),'16:00~18:00');
});

test('request-specific unit displays preserve the actual raw number and bypass specimen units', () => {
  for(const unit of ['백만원','천주','주']) {
    const value={value:'-1234',text:`-1,234${unit}`,display_unit:unit,tone:'down'};
    const before=JSON.stringify(value);
    assert.equal(text('2QFO-2',{s038:value},'s038'),`-1,234${unit}`);
    assert.equal(JSON.stringify(value),before);
  }
  assert.equal(text('2QFO-2',{s038:{value:'0',text:'0주',display_unit:'주'}},'s038'),'0주');
});

test('ELW fixed-point volatility and LP metrics cannot appear as unscaled percentages or shares', () => {
  const slots=source('15P5-2').slots;
  assert.equal(text('15P5-2',{s179:'2658'},'s179'),'26.6%');
  assert.equal(text('15P5-2',{s185:'6197'},'s185'),'61.97');
  assert.equal(text('15P5-2',{},'s173'),'LP 지표');
  for(const id of ['s046','s060']) assert.ok(!slots.find(s=>s.slot_id===id).alt_mappings.some(a=>a.mapping_id==='base:ka10050'));
  assert.equal(text('15P5-2',{},'s160'),'상태 미확인');
  assert.notEqual(text('2ZN9-0',{},'s188'),'활성');
  for(const slot of ['s026','s159','s160','s161'])assert.equal(text('2XKO-0',{},slot),'상태 미확인');
});

test('zero date/time sentinels are missing and leading-zero clocks are formatted before identifier handling', () => {
  for(const kind of ['date','time'])for(const value of ['000000','00000000',0])assert.equal(formatSlot({kind},value).missing,true);
  assert.equal(formatSlot({kind:'time'},'093127').text,'09:31:27');
  assert.equal(formatSlot({kind:'text',f:'stk_cd'},'005930').text,'005930');
  assert.equal(formatSlot({kind:'number',unit:'shares'},0).text,'0주');
});

test('numeric realtime field IDs follow their official price or difference meaning', () => {
  assert.equal(text('2R3M-1',{s251:1234},'s251'),'+1,234원');
  assert.equal(text('2RJ7-1',{s076:1234},'s076'),'+1,234원');
  assert.equal(text('133H-2',{s043:1234},'s043'),'1,234');
  assert.equal(text('15R0-2',{s006:'1234.56'},'s006'),'1,234.56');
  assert.equal(text('15R0-2',{s009:'12345678'},'s009'),'12,345,678');
  assert.equal(text('2TZN-1',{s150:1234},'s150'),'12억 3,400만원');
});

test('identifier fields keep every character instead of grouping them as a number', () => {
  assert.equal(text('2YA8-0',{s042:'252670'},'s042'),'252670');
  assert.equal(text('2YA8-0',{s042:'005930'},'s042'),'005930');
  assert.equal(text('3BQB-0',{s024:'007'},'s024'),'007');
  assert.equal(text('2XP6-0',{s041:'A12345'},'s041'),'A12345');
  assert.equal(text('2YA8-0',{},'s042'),'—');
});

test('unreceived watchlist group context and VI states do not reuse authored examples', () => {
  for(const [board,slots]of [['3D4I-0',['s003','s011','s019','s020','s099','s113']],['3EWN-0',['s003','s011','s019','s020','s114']],['2UHM-1',['s103']]]){
    for(const id of slots)assert.equal(text(board,{},id),'—',`${board}/${id}`);
  }
  assert.equal(text('2UHM-1',{},'s104'),'상태 미확인');
});

test('after-hours and gold quote prices preserve positive amounts and real zero quantities', () => {
  for (const [board, price, quantity] of [['2QRP-1','s026','s028'],['3JT4-0','s031','s032'],['2QX1-1','s014','s092']]) {
    assert.equal(text(board,{[price]:0},price),'—');
    assert.equal(text(board,{[price]:-1234},price),'1,234');
    assert.match(text(board,{[quantity]:0},quantity),/^0(?:주)?$/);
  }
  assert.equal(text('2QRP-1',{s012:'160001'},'s012'),'16:00:01');
  assert.equal(text('2QX1-1',{s011:'0.78'},'s011'),'+0.78%');
  assert.equal(text('2QX1-1',{s050:'121.5'},'s050'),'121.5%');
});
