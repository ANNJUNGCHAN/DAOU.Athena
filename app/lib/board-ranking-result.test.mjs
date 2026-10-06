import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { cellText, modelFor } = createRequire(import.meta.url)('./board-ranking-result.js');

test('identifiers, missing prices and received zero quantities remain distinct', () => {
  assert.equal(cellText({role:'identifier',format:{unit:'text',literal:true}}, '000007').text, '000007');
  assert.equal(cellText({role:'identifier',format:{unit:'text',literal:true}}, '252670').text, '252670');
  assert.deepEqual(cellText({role:'price',format:{kind:'number',absolute:true}}, '0000000'), {text:'—',missing:true});
  assert.equal(cellText({role:'price',format:{kind:'number',absolute:true}}, '-001234').text, '1,234');
  assert.equal(cellText({format:{kind:'number',suffix:'주'}}, '0000000').text, '0주');
  assert.equal(cellText({format:{kind:'number',suffix:'백만원'}}, '1234').text, '1,234백만원');
});

test('large growth and long quantities do not disappear or change unit', () => {
  assert.equal(cellText({format:{kind:'percent',precision:2,sign:true}}, '12500.12').text, '+12,500.12%');
  assert.equal(cellText({format:{kind:'number',suffix:'주'}}, '5846278608123').text, '5,846,278,608,123주');
  assert.equal(cellText({format:{kind:'date'}}, '20261001').text, '2026-10-01');
  assert.equal(cellText({format:{kind:'time'}}, '094200').text, '09:42:00');
});

test('expanded model preserves all 100 positions, handles empty and does not retain prior responses', () => {
  const columns = [{key:'_position',label:'번호',format:{kind:'number'}},{key:'stk_nm',label:'종목',format:{unit:'text'}}];
  const result = {board_id:'4B22-1',received_count:103,columns,rows:Array.from({length:100},(_,i)=>({_position:i+1,stk_nm:`합성 ${i+1}`})),truncated:true};
  const snapshot = JSON.stringify(result);
  const model = modelFor(result);
  assert.equal(model.rows.length,100);
  assert.equal(model.rows[99][1].text,'합성 100');
  assert.equal(model.truncated,true);
  assert.equal(JSON.stringify(result),snapshot);
  assert.deepEqual(modelFor({...result,rows:[],received_count:0,truncated:false}).rows,[]);
  assert.equal(modelFor(null),null);
  assert.equal(modelFor({...result,board_id:'13K0-2'}),null);
});
