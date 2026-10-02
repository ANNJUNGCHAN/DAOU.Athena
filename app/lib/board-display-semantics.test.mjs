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

test('sector detail captions preserve raw units, wrapped zero and low-date meaning', () => {
  assert.equal(text('2TZN-1', {s033:0}, 's033'), '거래량 0천주');
  assert.equal(text('2TZN-1', {s106:12}, 's106'), '12천주');
  assert.equal(text('2TZN-1', {s157:'20260202'}, 's157'), '52주 최저가일 2026-02-02');
  for (const shown of ['0천주', '누적 0천주']) {
    const value = {value:0,text:shown,display_unit:'천주'};
    assert.equal(text('2TZN-1', {s107:value}, 's107'), '누적 0천주');
    assert.equal(value.text, shown);
  }
  assert.equal(text('32S7-0', {s024:{value:0,text:'0주'}}, 's024'), '이전 일봉 거래량 0주');
  assert.equal(text('32S7-0', {}, 's056'), '조회 연봉 저가 · 고가');
});

test('five flow rankings retain labels without replacing received conditional units', () => {
  for (const board of ['2YS8-0','2ZBB-0','2ZTA-0','30TY-0','31CL-0']) {
    for (const slot of source(board).slots.filter(s => s.mapping_id && s.format?.prefix)) {
      const prefix = slot.format.prefix;
      const raw = slot.f === 'stk_infr' ? '27' : 0;
      const display = slot.f === 'stk_infr' ? '27' : '0천주';
      for (const received of [display, prefix + display]) {
        const wrapped = {value:raw, text:received, display_unit:'천주'};
        assert.equal(text(board, {[slot.slot_id]:wrapped}, slot.slot_id), prefix + display);
        assert.equal(wrapped.text, received);
      }
      const pending = mountPlan(registry.contractFor(board), {}, {deferredValueSlots:[slot.slot_id]}).assignments.find(a => a.slotId === slot.slot_id);
      assert.equal(pending.pending, true);
      assert.equal(pending.text.includes(prefix), false);
    }
  }
});

test('flow quantity zeros stay whole and ambiguous averages keep their warning', () => {
  for (const board of ['2YS8-0','2ZBB-0','30TY-0','31CL-0']) {
    for (const slot of source(board).slots.filter(s => s.mapping_id && s.format?.precision === 0 && /qty|rmnd/.test(s.f || ''))) {
      assert.match(text(board, {[slot.slot_id]:'0.0'}, slot.slot_id), /0/);
      assert.doesNotMatch(text(board, {[slot.slot_id]:'0.0'}, slot.slot_id), /0\.0/);
    }
  }
  for (const slot of source('31CL-0').slots.filter(s => /nettrde_avg_pric$/.test(s.f || ''))) {
    assert.match(text('31CL-0', {[slot.slot_id]:{value:'12345.67',text:'12,345.67 (단위 확인 필요)'}}, slot.slot_id), /12,345\.67 \(단위 확인 필요\)$/);
    assert.doesNotMatch(text('31CL-0', {[slot.slot_id]:null}, slot.slot_id), /단위 확인 필요/);
  }
});

test('13K0 paired values label prior rank, price change and quantity for raw and wrapped values', () => {
  const contract=registry.contractFor('13K0-2');
  for(let row=0;row<5;row++)for(const[num,prefix,suffix]of [[40,'전일 ','위'],[44,'전일비 ','원'],[48,'전일 ','주']]) {
    const sid='s'+String(num+row*11).padStart(3,'0');
    for(const value of [0,'0',{value:0,text:'0'}]) {
      const a=mountPlan(contract,{[sid]:value}).assignments.find(x=>x.slotId===sid);
      assert.equal(a.missing,false);assert.ok(a.text.startsWith(prefix)&&a.text.endsWith(suffix)&&a.text.includes('0'));
    }
    const empty=mountPlan(contract,{[sid]:null}).assignments.find(x=>x.slotId===sid);
    assert.equal(empty.missing,true);assert.equal(empty.text.includes(prefix),false);
    const value=num===44?-12345:12345,display=prefix+(value<0?'-12,345':'12,345')+suffix;
    assert.equal(text('13K0-2',{[sid]:{value,text:display}},sid),display);
    if(num===44) {
      const a=mountPlan(contract,{[sid]:{value,text:'12,345'}}).assignments.find(x=>x.slotId===sid);
      assert.equal(a.text,'전일비 -12,345원');assert.equal(a.tone,'down');
    }
  }
});

test('13K0 direction codes use enum meaning instead of numeric sign', () => {
  for(const[value,tone]of [['1','up'],['2','up'],['3','flat'],['4','down'],['5','down']]) {
    const a=mountPlan(registry.contractFor('13K0-2'),{s132:{value,text:'wire'}}).assignments.find(x=>x.slotId==='s132');
    assert.equal(a.tone,tone);
  }
  for(const value of [null,'bad'])assert.equal(text('13K0-2',{s132:value},'s132'),'—');
});

test('chart flow captions show each received date and preserve missing source context', () => {
  assert.equal(text('137X-2', {}, 's068'), '일별 거래상세 · 순매수');
  assert.equal(text('137X-2', {s076:'20260102',s091:'20251231'}, 's076'), '기준일 2026-01-02');
  assert.equal(text('137X-2', {s076:'20260102',s091:'20251231'}, 's091'), '투자자별 조회 · 2025-12-31');
  for (const options of [{}, {emptyValueSlots:['s076','s091']}, {deferredValueSlots:['s076','s091']}]) {
    const plan = mountPlan(registry.contractFor('137X-2'), {}, options);
    assert.equal(plan.assignments.find(x => x.slotId === 's076').text, '기준일 미제공');
    assert.equal(plan.assignments.find(x => x.slotId === 's091').text, '투자자별 조회 · 기준일 미제공');
  }
  const slots = source('137X-2').slots;
  for (const id of ['s070','s072','s075','s076','s091','s093','s096','s099']) {
    const slot = slots.find(s => s.slot_id === id);
    assert.equal(slot.row_index, 0);
    assert.deepEqual(registry.contractFor('137X-2').slots.find(s => s.slot_id === id).format, slot.format);
  }
});

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
  assert.equal(text('2XKO-0',{},'s026'),'유동성 정상');
  for(const slot of ['s159','s160','s161'])assert.equal(text('2XKO-0',{},slot),'상태 미확인');
});

test('ranking filter names stay actionable while actual unknown direction codes stay missing', () => {
  const boards=['2X5N-0','2XG6-0','2XKO-0','2XP6-0','2XTO-0','2YA8-0','2YEQ-0','2YJ8-0','2YNQ-0'];
  for(const board of boards) {
    const contract=registry.contractFor(board);
    assert.equal(text(board,{},'s026'),'유동성 정상');
    for(const slot of source(board).slots.filter(s=>s.f==='pred_pre_sig')) {
      for(const[value,tone]of [['1','up'],['2','up'],['3','flat'],['4','down'],['5','down']]) {
        const assignment=mountPlan(contract,{[slot.slot_id]:{value,text:'wire'}}).assignments.find(a=>a.slotId===slot.slot_id);
        assert.equal(assignment.tone,tone,board+'/'+slot.slot_id+'/'+value);
      }
      for(const value of [null,'0','unknown']) {
        const assignment=mountPlan(contract,{[slot.slot_id]:value}).assignments.find(a=>a.slotId===slot.slot_id);
        assert.equal(assignment.missing,true);
        assert.equal(assignment.text,'—');
      }
    }
  }
});

test('ranking price differences preserve wrapped negatives and label a real zero once', () => {
  for(const board of ['2X5N-0','2XG6-0','2XKO-0','2XP6-0','2XTO-0','2YA8-0','2YEQ-0','2YJ8-0','2YNQ-0']) {
    for(const slot of source(board).slots.filter(s=>s.mapping_id&&s.f==='pred_pre')) {
      const wrapped={value:-12345,text:'12,345'},before=JSON.stringify(wrapped);
      assert.equal(text(board,{[slot.slot_id]:wrapped},slot.slot_id),'전일비 -12,345원');
      assert.equal(JSON.stringify(wrapped),before);
      assert.equal(text(board,{[slot.slot_id]:{value:0,text:'전일비 0원'}},slot.slot_id),'전일비 0원');
      assert.equal(text(board,{[slot.slot_id]:null},slot.slot_id),'—');
    }
  }
});

test('ranking increase headers remain labels when all response rows are absent', () => {
  for(const[board,slot,caption]of [['2YA8-0','s037','잔량 급증률'],['2YJ8-0','s036','거래량 급증률']]) {
    const contract=registry.contractFor(board),generated=contract.slots.find(s=>s.slot_id===slot);
    assert.equal(source(board).slots.find(s=>s.slot_id===slot).kind,'label');
    assert.equal(generated.kind,'label');
    assert.equal(generated.table.row,'head');
    for(const options of [{},{emptyValueSlots:[slot]},{deferredValueSlots:[slot]}]) {
      const assignment=mountPlan(contract,{},options).assignments.find(a=>a.slotId===slot);
      assert.equal(assignment.text,caption);
      assert.equal(assignment.missing,false);
    }
  }
});

test('ranking bid and ask prices keep positive amounts and zero without losing their side', () => {
  for(const[slot,caption]of [['s046','매도 '],['s047','매수 ']]) {
    for(const value of [-12345,{value:-12345,text:'-12,345원'}]) {
      assert.equal(text('2XP6-0',{[slot]:value},slot),caption+'12,345원');
    }
    assert.equal(text('2XP6-0',{[slot]:0},slot),caption+'0원');
  }
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

test('settlement summary keeps its caption without specimen calendar dates', () => {
  assert.equal(text('3MTJ-0', {}, 's026'), '결제 예정');
  assert.equal(text('2QRP-1', {}, 's007'), '5단');
  assert.equal(text('2QRP-1', {}, 's008'), '10단');
});

test('account secondary amounts retain exact names without changing their values or signs', () => {
  for (const id of ['133H-2','2SCE-1','2SKU-1','2SRV-1','2SYW-1','3GRO-0','3IGR-0','3K7K-0','3LGC-0','3MTJ-0','3NVG-0','3UTA-0']) {
    const slot=source(id).slots.find(s=>s.region==='kpi'&&s.f==='tot_pur_amt');
    assert.equal(text(id,{[slot.slot_id]:'0'},slot.slot_id),'총매입 0');
    assert.equal(text(id,{[slot.slot_id]:'12345'},slot.slot_id),'총매입 1만 2,345');
  }
  const prefixes={trde_able_qty:'가능 ',pur_amt:'매입 ',pred_close_pric:'전일 종가 ',poss_rt:'보유 비중 ',tdy_buyq:'오늘 매수 ',pred_buyq:'전일 매수 '};
  for(const s of source('2SCE-1').slots.filter(s=>s.table?.table==='375G-0'&&prefixes[s.f])) {
    for(const value of ['0','123']) {
      const expected=formatSlot({...s.format,prefix:undefined},value);
      assert.equal(text('2SCE-1',{[s.slot_id]:value},s.slot_id),prefixes[s.f]+expected.text);
    }
  }
  for(const [slot,prefix] of Object.entries({s155:'평가액 합계 ',s156:'매수금액 합계 ',s187:'세금 ',s190:'수수료 상세 ',s192:'전일 매수 ',s193:'전일 매도 '})) {
    const spec=source('2SCE-1').slots.find(s=>s.slot_id===slot).format;
    for(const value of ['0','-12345','12345']) {
      const before=formatSlot({...spec,prefix:undefined},value);
      const after=formatSlot(spec,value);
      assert.equal(after.text,prefix+before.text);
      assert.equal(after.tone,before.tone);
    }
  }
});

test('cash-flow row captions stay fixed and daily money is not formatted as a date', () => {
  assert.equal(text('2SKU-1',{},'s175'),'기간 입금');
  assert.equal(text('2SKU-1',{},'s178'),'기간 출금');
  assert.equal(text('2SKU-1',{s175:'다른 거래명',s178:'2'},'s175'),'기간 입금');
  assert.equal(text('2SKU-1',{s175:'다른 거래명',s178:'2'},'s178'),'기간 출금');
  assert.equal(text('2SKU-1',{s177:'0'},'s177'),'일별 입금 0');
  assert.equal(text('2SKU-1',{s180:'12345678'},'s180'),'일별 출금 1,234만 5,678');
});

test('exploration details do not claim selection or an unobserved specimen industry', () => {
  assert.equal(text('13K0-2',{},'s130'),'조회 종목');
  for(const id of ['4A9H-1','4AGN-1','4ANS-1','4AUX-1']) {
    assert.equal(text(id,{},'s124'),'—');
    assert.equal(text(id,{s124:'합성 실제 업종'},'s124'),'합성 실제 업종');
    assert.equal(text(id,{s138:'거래 정상'},'s138'),'거래 정상');
    assert.equal(text(id,{},'s138'),'상태 미확인');
  }
});

test('account settlement axes and deposit ledger keep fixed context without specimen dates', () => {
  assert.equal(text('3LGC-0',{},'s026'),'입출고 내역');
  for (const [slot,label] of [['s106','오늘'],['s108','D+1'],['s110','D+2']]) {
    assert.equal(text('3MTJ-0',{},slot),label);
    assert.equal(text('3MTJ-0',{[slot]:'20991231'},slot),label);
  }
  assert.equal(text('3MTJ-0',{s109:'0'},'s109'),'0');
  assert.equal(text('3OIM-0',{s092:'0000512'},'s092'),'0000512');
});

test('ETF flow quantities retain source captions and index identifiers have a name', () => {
  const identityPlan = mountPlan(registry.contractFor('15N5-2'), {}, {identity:{code:'153270',name:'합성 ETF'}});
  assert.equal(identityPlan.assignments.find(s => s.slotId === 's002').text, '153270');
  assert.equal(text('15N5-2', {s007:'85980.95'}, 's007'), 'NAV 85,980.95');
  assert.equal(text('15N5-2', {s022:'1455'}, 's022'), '전일비 +1,455원');
  assert.equal(text('15N5-2', {s028:'82'}, 's028'), '82 (단위 미확인)');
  assert.equal(text('15N5-2', {s029:'0'}, 's029'), '누적 거래량 0주');
  assert.equal(text('15N5-2', {s043:'-1234',s044:'0',s047:'99',s062:'201'}, 's043'), '시간대별 조회 -1,234주');
  assert.equal(text('15N5-2', {s044:'0'}, 's044'), '수익률 조회 0주');
  assert.equal(text('15N5-2', {s047:'99'}, 's047'), '수익률 조회 +99주');
  assert.equal(text('15N5-2', {s062:'201'}, 's062'), '대상지수 코드 201');
  for (const sid of ['s043','s044','s047','s062']) {
    assert.deepEqual(registry.contractFor('15N5-2').slots.find(s => s.slot_id === sid).format,
      source('15N5-2').slots.find(s => s.slot_id === sid).format);
  }
});

test('company expected price is won and daily flow caption uses the received date', () => {
  assert.equal(text('2RBO-1', {s064:'-150900'}, 's064'), '150,900원');
  assert.equal(text('2RBO-1', {s064:'0'}, 's064'), '—');
  assert.equal(text('2RBO-1', {s103:'20260102'}, 's103'), '일별주가 수급 · 2026-01-02');
  for (const options of [{}, {emptyValueSlots:['s103']}, {deferredValueSlots:['s103']}]) {
    const plan = mountPlan(registry.contractFor('2RBO-1'), {}, options);
    assert.equal(plan.assignments.find(s => s.slotId === 's103').text, '일별주가 수급 · 기준일 미제공');
  }
});

test('ETF time-series quantities and amounts retain distinct names and source units', () => {
  assert.equal(text('15N5-2', {}, 's067'), '거래량 · 거래대금');
  for (const sid of ['s079', 's094', 's109']) {
    assert.equal(text('15N5-2', {[sid]:'0'}, sid), '거래대금 0원');
    assert.equal(text('15N5-2', {[sid]:'2'}, sid), '거래대금 200만원');
    const slot = source('15N5-2').slots.find(s => s.slot_id === sid);
    assert.equal(slot.mapping_id, 'base:ka40006');
    assert.equal(slot.f, 'trde_prica');
    assert.equal(slot.format.scale, '백만');
    assert.deepEqual(registry.contractFor('15N5-2').slots.find(s => s.slot_id === sid).format, slot.format);
  }
  assert.equal(text('15N5-2', {s078:'2'}, 's078'), '2주');
});

test('minute-chart header uses the first received candle time instead of the authored example', () => {
  const contract = source('3FR6-0');
  const header = contract.slots.find(slot => slot.slot_id === 's007');
  assert.equal(header.mapping_id, 'base:ka10080');
  assert.equal(header.f, 'cntr_tm');
  assert.equal(header.row_index, 0);
  assert.equal(registry.contractFor('3FR6-0').slots.find(slot => slot.slot_id === 's007').static, undefined);
  for (const [input, expected] of [['20261001192300', '2026-10-01 19:23:00'],
    ['092318', '09:23:18'], ['000000', '시각 미제공'], [undefined, '시각 미제공']]) {
    assert.equal(text('3FR6-0', {s007:input}, 's007'), expected);
  }
  const firstRow = contract.slots.find(slot => slot.f === header.f && slot.mapping_id === header.mapping_id
    && String(slot.table?.row) === '0');
  assert.ok(firstRow);
  const values = {s007:'20261001192300', [firstRow.slot_id]:'20261001192300'};
  assert.equal(text('3FR6-0', values, 's007'), text('3FR6-0', values, firstRow.slot_id));
});

test('price-limit query lists describe their shared response instead of upper and lower proximity', () => {
  assert.equal(text('2YXS-0', {}, 's327'), '조회 종목 등락률');
  assert.equal(text('2YXS-0', {}, 's343'), '추가 조회 종목 등락률');
  for (const [upper, lower] of [['s331','s347'], ['s332','s348'], ['s334','s350'],
    ['s335','s351'], ['s337','s353'], ['s338','s354']]) {
    const slots = source('2YXS-0').slots;
    const a = slots.find(s => s.slot_id === upper), b = slots.find(s => s.slot_id === lower);
    assert.equal(a.mapping_id, b.mapping_id);
    assert.equal(a.f, b.f);
    assert.equal(a.table.row, b.table.row);
  }
});

test('ETF whole-quotes hero binds one coherent response row and return labels do not invent periods', () => {
  const slots = source('2VIN-0').slots;
  for (const sid of ['s386','s387','s388','s389','s391','s395','s399','s400']) {
    const slot = slots.find(s => s.slot_id === sid);
    assert.equal(slot.mapping_id, 'base:ka40004');
    assert.equal(slot.row_index, 0);
  }
  assert.equal(text('2VIN-0', {}, 's409'), '조회 수익률');
  for (const sid of ['s410','s412','s414','s416']) assert.equal(text('2VIN-0', {}, sid), '수익률');
  for (const sid of ['s411','s413','s415','s417']) {
    assert.match(text('2VIN-0', {[sid]:'0'}, sid), /0/);
    assert.equal(slots.find(s => s.slot_id === sid).mapping_id, 'base:ka40001');
  }
});

test('volume renewal and concentration captions describe available response fields', () => {
  assert.equal(text('30C1-0', {}, 's045'), '이전 거래량');
  assert.equal(text('30C1-0', {}, 's047'), '현재 거래량');
  assert.equal(text('30C1-0', {}, 's330'), '조회 종목');
  assert.equal(text('30O1-0', {}, 's022'), '조회 종목 비중');
  assert.equal(text('30O1-0', {}, 's024'), '조회 응답');
  assert.equal(text('30O1-0', {s023:'0'}, 's023'), '0.0%');
});

test('PER rows preserve actual PER without authored sector comparison examples', () => {
  const slots = source('30ZW-0').slots;
  const examples = slots.filter(s => /^업종\s.*배$/.test(s.paper_text) && !s.mapping_id);
  assert.equal(examples.length, 19);
  for (const slot of examples) {
    assert.equal(slot.static, 'blank');
    assert.equal(registry.contractFor('30ZW-0').slots.find(s => s.slot_id === slot.slot_id).static, 'blank');
    assert.equal(text('30ZW-0', {}, slot.slot_id), '');
  }
  assert.match(text('30ZW-0', {s056:'0'}, 's056'), /0/);
});

test('ranking mini lists identify received data without event-time claims', () => {
  assert.equal(text('2VDA-0', {}, 's289'), '조회 종목 고가');
  assert.equal(text('2VDA-0', {}, 's291'), '고가');
  for (const sid of ['s294','s297','s300']) {
    assert.equal(source('2VDA-0').slots.find(s => s.slot_id === sid).f, 'high_pric');
  }
  assert.equal(text('2ZHC-0', {}, 's337'), '조회 종목');
  assert.equal(text('2ZHC-0', {}, 's048'), '거래량');
  assert.equal(text('2ZZ7-0', {}, 's253'), '조회 종목 구간 등락률');
  assert.equal(text('2ZZ7-0', {}, 's047'), '거래량');
});

test('minute amount specimens remain distinct from received daily amounts', () => {
  const slots = source('3FR6-0').slots;
  const minute = slots.filter(s => s.table?.table === '3T8I-0' && s.table.col === 6 && s.table.row !== 'head');
  const daily = slots.filter(s => s.table?.table === '3SP2-0' && s.table.col === 6 && s.table.row !== 'head');
  assert.equal(minute.length, 13);
  assert.ok(minute.every(s => !s.mapping_id));
  assert.equal(daily.length, 3);
  for (const slot of daily) {
    assert.equal(slot.mapping_id, 'base:ka10005');
    assert.equal(slot.f, 'trde_prica');
    assert.match(text('3FR6-0', {[slot.slot_id]:'0'}, slot.slot_id), /0/);
  }
});

test('ELW summaries remove saved-search specimens while retaining received percentages', () => {
  for (const id of ['2XA5-0', '2XY6-0', '2Y47-0']) {
    const plan = mountPlan(registry.contractFor(id), {});
    const count = plan.assignments.find(slot => slot.slotId === 's026');
    assert.equal(count.missing, true);
    assert.notEqual(count.text, '2건');
  }
  for (const id of ['2VO0-0', '2XA5-0', '2XY6-0', '2Y47-0', '2ZN9-0']) {
    assert.equal(text(id, {s017:'0'}, 's017'), '0.00%');
    assert.equal(text(id, {s017:'200'}, 's017'), '+200.00%');
    assert.equal(text(id, {}, 's016'), '첫 결과 등락률');
  }
  assert.equal(text('2XY6-0', {}, 's043'), '근접률');
  assert.equal(text('2XY6-0', {}, 's044'), '거래량');
  assert.equal(text('2Y47-0', {}, 's044'), '거래량');
});

test('account action captions remain actionable without asserting missing sales', () => {
  for (const values of [{}, {s068:'0'}, {s068:'12345'}]) {
    assert.equal(text('2SKU-1', values, 's069'), '정산 상세 ›');
  }
  assert.equal(registry.contractFor('2SKU-1').slots.find(s => s.slot_id === 's069').expanded_board, '3MTJ-0');
  for (const values of [{}, {s100:'0'}, {s100:'12345'}]) {
    assert.equal(text('3ODO-0', values, 's101'), '');
  }
  for (const sid of ['s090','s092','s094','s096','s098','s100','s103','s105','s107']) {
    assert.match(text('3ODO-0', {[sid]:'0'}, sid), /0/);
  }
});

test('orderbook session controls remain captions while after-hours summaries name their source', () => {
  for (const id of ['13BC-2','2TRW-1','3JZ3-0','2QRP-1','3JT4-0']) {
    for (const values of [{}, {s004:'0'}, {s004:'3'}]) {
      assert.equal(text(id, values, 's004'), '정규장');
      assert.equal(text(id, values, 's007'), '5단');
      assert.equal(text(id, values, 's008'), '10단');
    }
  }
  assert.equal(text('2TRW-1', {}, 's082'), '순매수 체결량');
  assert.equal(text('2QRP-1', {}, 's065'), '정규장');
  assert.equal(text('3JT4-0', {}, 's079'), '정규장');
  assert.equal(text('2QRP-1', {}, 's082'), '단일가 현재가');
  assert.equal(text('3JT4-0', {}, 's096'), '단일가 현재가');
});

test('NXT orderbook volume caption describes its two received share quantities', () => {
  assert.equal(text('3N4O-0', {}, 's174'), '오늘·전일 거래량');
  const slots = source('3N4O-0').slots;
  assert.equal(slots.find(slot => slot.slot_id === 's175').f, 'trde_qty');
  assert.equal(slots.find(slot => slot.slot_id === 's176').f, 'pred_trde_qty');
  for (const id of ['s175', 's176']) {
    assert.equal(text('3N4O-0', {[id]: 0}, id), '0주');
    assert.equal(text('3N4O-0', {[id]: {value: 12345, text: '12,345주'}}, id), '12,345주');
  }
  assert.equal(text('3N4O-0', {s178: 0}, 's178'), '0.00%');
});

test('ELW condition quote magnitudes preserve zero and preformatted units without changing dates or changes', () => {
  const slots = source('2ZN9-0').slots.filter(slot => ['sel_bid', 'buy_bid'].includes(slot.f));
  assert.equal(slots.length, 16);
  for (const slot of slots) {
    assert.equal(slot.mapping_id, 'base:ka30005');
    for (const raw of [-25, '-25', '+25', '-000025', '+000025', {value:-25, text:'-25', tone:'down'}]) {
      assert.equal(text('2ZN9-0', {[slot.slot_id]:raw}, slot.slot_id), '25');
    }
    assert.equal(text('2ZN9-0', {[slot.slot_id]:{value:-1250,text:'−1,250원'}}, slot.slot_id), '1,250원');
    for (const raw of [0, '0', {value:0,text:'0'}]) {
      const value = mountPlan(registry.contractFor('2ZN9-0'), {[slot.slot_id]:raw}).assignments.find(a => a.slotId === slot.slot_id);
      assert.equal(value.text, '0');
      assert.equal(value.missing, false);
    }
    assert.equal(mountPlan(registry.contractFor('2ZN9-0'), {[slot.slot_id]:null}).assignments.find(a => a.slotId === slot.slot_id).missing, true);
  }
  assert.equal(text('2ZN9-0', {s054:'-25'}, 's054'), '-25');
  assert.equal(text('2ZN9-0', {s062:'37'}, 's062'), '37');
  assert.equal(text('2ZN9-0', {s063:'20260930'}, 's063'), '2026-09-30');
});

test('ETF tax and optional summary metrics preserve supplied zero', () => {
  for (const slot of ['s399','s400','s404','s406','s408']) {
    const value = mountPlan(registry.contractFor('2VIN-0'), {[slot]:0}).assignments.find(a => a.slotId === slot);
    assert.equal(value.text, '0');
    assert.equal(value.missing, false);
  }
});

test('quote costs and daily change or foreign flow columns keep actual zero observations', () => {
  const ids = ['s178','s180','s182','s184','s186','s188','s221','s222','s232','s233','s243','s244','s225','s226','s236','s237','s247','s248'];
  const slots = source('2R3M-1').slots;
  for (const id of ids) {
    assert.ok(slots.find(slot => slot.slot_id === id).mapping_id, id);
    for (const value of [0, '0', {value: 0, text: '0'}]) {
      const assignment = mountPlan(registry.contractFor('2R3M-1'), {[id]: value}).assignments.find(a => a.slotId === id);
      assert.equal(assignment.missing, false, id);
      assert.match(assignment.text, /0/, id);
    }
  }
});

test('trade flow keeps source exchange strength and bid-ask composite beneath a truthful header', () => {
  assert.equal(text('2R3M-1', {}, 's049'), '거래소');
  assert.equal(text('2R3M-1', {s058:'KRX'}, 's058'), 'KRX');
  assert.equal(text('2R3M-1', {s059:'157.6'}, 's059'), '157.6%');
  const slot = source('2R3M-1').slots.find(s => s.slot_id === 's053');
  const composite = {composite:{...slot.composite,parts:slot.composite.parts.map((p,i)=>({...p,value:i?'12300':'12400'}))}};
  assert.match(text('2R3M-1', {s053:composite}, 's053'), /12,400.*12,300/);
});

// Exact five-tab FLOW residual regressions.
{
const flow = require('./board-flow-layout');
const boards = ['2QFO-2','2QM7-2','2ROJ-1','2RWK-1','2S4E-1'];
const assignment = (board, values, options, id) => mountPlan(registry.contractFor(board), values, options).assignments.find(slot => slot.slotId === id);

test('all five flow headers keep an identifier code and separate status', () => {
  for (const board of boards) {
    const status = assignment(board, {}, {}, 's002').text;
    const options = { identity: { name: '공개 합성 종목', code: '123456' } };
    assert.equal(assignment(board, {}, options, 's001').text, '공개 합성 종목');
    assert.equal(assignment(board, {}, options, 's003').text, '123456');
    assert.equal(assignment(board, {}, options, 's002').text, status);
  }
});

test('rejected received names use neutral titles and matching wrapped identity propagates', () => {
  for (const board of boards) {
    const fallback = { code: '123456', name: '' };
    const neutral = flow.identityFor(board, { data: { fields: [
      { key: 'stk_cd', value: '999999' }, { key: 'stk_nm', value: '다른 종목' },
    ] } }, {}, fallback);
    assert.notEqual(neutral.name, '다른 종목');
    assert.equal(assignment(board, {}, { identity: neutral }, 's001').text, neutral.name);
    const accepted = flow.identityFor(board, {}, { s001: { value: '수신된 종목명' }, s003: { value: '123456_AL' } }, fallback);
    assert.equal(assignment(board, {}, { identity: accepted }, 's001').text, '수신된 종목명');
    assert.equal(assignment(board, {}, { identity: accepted }, 's003').text, '123456');
  }
});

test('broker quantities preserve wire signs and units while using the same neutral tone', () => {
  const contract = registry.contractFor('2QM7-2');
  for (const raw of ['+123','-123','-000123',0,{ value:'-123', text:'-123주', tone:'down' }]) {
    for (const id of ['s042','s054','s066','s077','s088','s043','s055','s067','s078','s089']) {
      const slot = contract.slots.find(s => s.slot_id === id);
      const result = assignment('2QM7-2', { [id]: raw }, {}, id);
      assert.equal(result.text, formatSlot(slot.format, raw).text);
      assert.equal(result.tone, 'flat');
      assert.equal(result.forceFlatTone, true);
      assert.equal(result.missing, false);
    }
  }
});

test('numeric list dates retain full date text and raw wrapped amount units', () => {
  for (const id of ['s149','s151','s153','s155','s157']) {
    assert.equal(assignment('2RWK-1', { [id]:'20261002' }, {}, id).text, '2026-10-02');
  }
  for (const [board, ids] of [['2ROJ-1',['s074','s075','s076','s166','s170']],['2RWK-1',['s150','s152','s154','s156','s158']]]) {
    for (const id of ids) assert.equal(assignment(board, { [id]: { value:'0', text:'0백만원', display_unit:'백만원' } }, {}, id).text, '0백만원');
  }
});

test('received personal and fourth KPI zeros remain distinct from missing and pending', () => {
  for (const [board, ids] of [['2RWK-1',['s029','s031','s033','s035']],['2S4E-1',['s029','s031','s033','s035','s036','s052','s062','s072','s082','s092','s160','s161']]]) {
    for (const id of ids) {
      const zero = assignment(board, { [id]:0 }, {}, id);
      assert.equal(zero.missing, false);
      assert.ok(zero.text.includes('0'));
      assert.equal(assignment(board, {}, { deferredValueSlots:[id] }, id).pending, true);
      assert.equal(assignment(board, {}, { emptyValueSlots:[id] }, id).empty, true);
    }
  }
});

}
