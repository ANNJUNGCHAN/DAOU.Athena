import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const integratedCardSurface = require('./integrated-card-surface');
const source = fs.readFileSync(new URL('../canvas.js', import.meta.url), 'utf8');
function extract(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from);
  return source.slice(from, to);
}
test('one actual workflow badge and a contextual footer replace specimen session chips', () => {
  const nodes = new Map(['s003','s004','s136'].map(id => {
    const node = { textContent: 'fixture', style: {} };
    node.parentElement = { children: [node], style: {} };
    return [id,node];
  }));
  const host = { __athenaBoard: { boardId: '137X-2' }, querySelector: (q) => nodes.get(q.match(/"([^"]+)"/)[1]) };
  const root = { querySelectorAll: () => [host] };
  const context = vm.createContext({ integratedCardSurface });
  vm.runInContext(extract('function stampBoardRealtimeStatus(', 'function stampOrderbookRealtimeStatus('), context);
  context.stampBoardRealtimeStatus(root, 'active');
  assert.equal(nodes.get('s003').parentElement.hidden, true);
  assert.equal(nodes.get('s004').textContent, integratedCardSurface.workflowStateLabel('active'));
  assert.equal(nodes.get('s136').textContent, `차트 · ${integratedCardSurface.workflowStateLabel('active')}`);
  context.stampBoardRealtimeStatus(root, 'receiving');
  context.stampBoardRealtimeStatus(root, 'active');
  assert.equal(nodes.get('s004').textContent, integratedCardSurface.workflowStateLabel('receiving'));
  context.stampBoardRealtimeStatus(root, 'snapshot');
  context.stampBoardRealtimeStatus(root, 'active');
  assert.equal(nodes.get('s004').textContent, integratedCardSurface.workflowStateLabel('active'));
});
test('real connection failures explain the state in Korean and keep raw text in closed details', () => {
  const make = (tag) => ({ tag, children: [], style: {}, textContent: '',
    setAttribute() {}, addEventListener() {}, append(...nodes) { this.children.push(...nodes); },
    appendChild(node) { this.children.push(node); }, prepend(node) { this.children.unshift(node); } });
  const content = make('section');
  const root = { querySelector: q => q === '.integrated-card-content' ? content : null };
  const context = vm.createContext({ document: { createElement: make }, clearIntegratedRealtimeError() {}, syncIntegratedRealtime() {} });
  vm.runInContext(extract('function showIntegratedRealtimeError(', '// 이 조회에서'), context);
  const raw = 'REG connection failed <img src=x onerror=alert(1)>';
  context.showIntegratedRealtimeError(root, {}, new Error(raw));
  const note = content.children[0];
  assert.match(note.children[0].textContent, /^실시간 데이터를 연결하지 못했습니다/);
  assert.doesNotMatch(note.children[0].textContent, /REG/);
  const details = note.children.find(node => node.tag === 'details');
  assert.equal(details.open, undefined);
  assert.equal(details.children[1].textContent, raw);
  assert.equal(details.children[1].style.overflowWrap, 'anywhere');
});
