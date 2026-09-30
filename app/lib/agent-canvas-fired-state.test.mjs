import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import agentCanvas from './agent-canvas.js';
const { recordedFireTime } = agentCanvas;

test('active future reservation and suppressed history never imply an arrived alert', () => {
  const item = { kind: 'schedule', status: 'active', raw: {
    next_fire_at: '2030-09-22T17:07:00+09:00',
    last_fired_at: null,
    last_run: { verdict: 'suppressed', ts: '2030-09-21T17:07:00+09:00' },
  } };
  assert.equal(recordedFireTime(item), null);
  assert.equal(recordedFireTime({ ...item, raw: {} }), null);
  assert.equal(recordedFireTime({ ...item, raw: { last_fired_at: 'invalid' } }), null);
});

test('a real prior firing stays accessible after pause or completion', () => {
  const fired = '2026-09-22T17:07:11+09:00';
  for (const status of ['active', 'paused', 'completed', 'cancelled']) {
    assert.equal(recordedFireTime({ status, raw: { last_fired_at: fired } }), fired);
  }
});

test('a fired alert still renders its evidence without an order execution entry', () => {
  const source = fs.readFileSync(new URL('../chat.js', import.meta.url), 'utf8');
  const start = source.indexOf('function renderAgentTurn(event)');
  const createElement = tag => ({ tag, children: [], textContent: '',
    get childNodes() { return this.children; },
    append(...children) { this.children.push(...children); },
    appendChild(child) { this.children.push(child); },
  });
  let rendered;
  const context = vm.createContext({ document: { createElement },
    routineTurnLib: { buildTurnModel: () => ({ kind: 'fired', badge: '알림', symbolText: '삼성전자',
      bodyText: '조건 도달', bodyNote: '발화 시점', sourceLabel: '관측 기록',
      conditions: [{ met: true, label: '현재가', value: '100' }] }) },
    _mountTurn: (_line, box) => { rendered = box; },
  });
  vm.runInContext(source.slice(start, source.indexOf('\n}', start) + 2), context);
  context.renderAgentTurn({ routine_id: 'qa' });
  const all = node => [node, ...node.children.flatMap(all)];
  const nodes = all(rendered);
  assert.equal(nodes.some(node => node.tag === 'button'), false);
  assert.ok(nodes.some(node => node.textContent === '조건 도달'));
  assert.ok(nodes.some(node => node.textContent === '100'));
  assert.ok(nodes.some(node => node.textContent === '관측 기록'));
});
