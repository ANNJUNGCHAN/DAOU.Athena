import test from 'node:test';
import assert from 'node:assert/strict';
import natural from './backtest-natural.js';
import fakeDom from './graph-mode/fake-dom.js';

const paused = { session_id: 'session-1', status: 'paused', cursor: 0, total: 3,
  strategy: '<img src=x onerror=alert(1)>', data_source: 'demo', symbol: 'SYNTHETIC',
  input: { initial_cash: 1000, candles: [{ dt: '2026-01-02' }, { dt: '2026-01-05' }] },
  current_state: { cash: 1000, qty: 0, pending_entry: false, pending_exit: false },
  decisions: [], trades: [], equity: [], flags: [], notices: ['순차 재생 안내'] };
const ok = data => ({ ok: true, data });
function prepared(strategy = natural.DEFAULT_STRATEGY) {
  return { strategy, warnings: ['검토 안내'], decision_schema: {
    schema_version: 1, source_text: strategy, schema_hash: 'sealed-example', title: '평균선 조건',
    explanation: '종가와 이동평균으로 판단', required_observations: ['close', 'sma_5'],
    flat: { type: 'choice', instructions: '보유하지 않은 상태에서 판단', criteria: { enter: '종가가 평균보다 높음', wait: '그 외' } },
    holding: { type: 'choice', instructions: '보유 중 판단', criteria: { exit: '종가가 평균보다 낮음', hold: '그 외' } },
    author: { provider: 'configured-provider', model: 'configured-model' },
  } };
}
const settle = () => new Promise(resolve => setImmediate(resolve));
function fixture(invoke, extra = {}) {
  const timers = new Map();
  let count = 0;
  const model = natural.createMonitor({ invoke, ...extra,
    setTimeoutImpl(fn) { const id = ++count; timers.set(id, fn); return id; },
    clearTimeoutImpl(id) { timers.delete(id); },
  });
  return { model, timers, tick() {
    const first = timers.entries().next().value;
    assert.ok(first, 'expected a scheduled poll');
    timers.delete(first[0]);
    first[1]();
  } };
}

test('create stays paused; step and run use the existing allowlisted IPC with session identity', async () => {
  const calls = [];
  const { model, timers } = fixture(async (channel, body) => {
    calls.push({ channel, body });
    return ok({ ...paused, status: body.operation === 'run' ? 'running' : 'paused' });
  });
  const payload = { strategy: '조건', data_source: 'demo', costs: { fee_bps: 2, tax_bps: 3, slippage_bps: 4 } };
  await model.create(payload);
  assert.equal(timers.size, 0);
  await model.step();
  await model.run();
  assert.equal(timers.size, 1);
  assert.deepEqual(calls, [
    { channel: 'athena:backtest-run', body: { ...payload, decision_mode: 'natural', operation: 'create' } },
    { channel: 'athena:backtest-run', body: { session_id: 'session-1', decision_mode: 'natural', operation: 'step' } },
    { channel: 'athena:backtest-run', body: { session_id: 'session-1', decision_mode: 'natural', operation: 'run' } },
  ]);
});

test('rapid repeated create/step/run clicks cannot launch duplicate operations', async () => {
  let finish;
  let count = 0;
  const { model } = fixture(() => { count++; return new Promise(resolve => { finish = resolve; }); });
  const creation = model.create({});
  assert.equal(model.state().busy, true);
  assert.equal(await model.create({}), null);
  assert.equal(await model.step(), null);
  assert.equal(await model.run(), null);
  assert.equal(count, 1);
  finish(ok(paused));
  await creation;
  const step = model.step();
  assert.equal(await model.step(), null);
  assert.equal(await model.run(), null);
  assert.equal(count, 2);
  finish(ok({ ...paused, cursor: 1 }));
  await step;
});

test('pause cannot be overwritten by a stale running poll and closes its timer', async () => {
  let finishPoll;
  const { model, timers, tick } = fixture(async (_channel, body) => {
    if (body.operation === 'result') return new Promise(resolve => { finishPoll = resolve; });
    return ok({ ...paused, status: body.operation === 'run' ? 'running' : 'paused' });
  });
  await model.create({});
  await model.run();
  tick();
  await model.pause();
  finishPoll(ok({ ...paused, status: 'running' }));
  await settle();
  assert.equal(model.state().snapshot.status, 'paused');
  assert.equal(timers.size, 0);
});

test('hidden panel pauses between bars and polls until server confirms pause', async () => {
  const calls = [];
  const { model, timers, tick } = fixture(async (_channel, body) => {
    calls.push(body.operation);
    return ok({ ...paused, status: ['run', 'pause'].includes(body.operation) ? 'running' : 'paused' });
  }, { isVisible: () => false });
  await model.create({});
  await model.run();
  tick();
  await settle();
  assert.equal(calls.at(-1), 'pause');
  assert.equal(model.state().snapshot.status, 'running');
  assert.equal(model.state().pauseRequested, true);
  tick();
  await settle();
  assert.equal(calls.at(-1), 'result');
  assert.equal(model.state().snapshot.status, 'paused');
  assert.equal(timers.size, 0);
});

test('closing while run request is pending waits then pauses the newly running session', async () => {
  let finishRun;
  const calls = [];
  const { model } = fixture(async (_channel, body) => {
    calls.push(body.operation);
    if (body.operation === 'run') return new Promise(resolve => { finishRun = resolve; });
    return ok(paused);
  });
  await model.create({});
  const run = model.run();
  const close = model.pause();
  finishRun(ok({ ...paused, status: 'running' }));
  await Promise.all([run, close]);
  assert.deepEqual(calls, ['create', 'run', 'pause']);
  assert.equal(model.state().snapshot.status, 'paused');
});

test('backend errors preserve records and do not pretend a running session was paused', async () => {
  const { model } = fixture(async (_channel, body) => {
    if (body.operation === 'pause') return { ok: false, status: 0, error: '연결 끊김' };
    return ok({ ...paused, status: body.operation === 'run' ? 'running' : 'paused' });
  });
  await model.create({});
  await model.run();
  await model.pause();
  assert.equal(model.state().error, '연결 끊김');
  assert.equal(model.state().snapshot.status, 'running');
  assert.deepEqual(JSON.parse(model.exportJSON()), model.state().snapshot);
});

test('new session replaces the current paused session and failed creation preserves prior records', async () => {
  const calls = [];
  const { model } = fixture(async (_channel, body) => {
    calls.push(body);
    return calls.length === 1 ? ok(paused) : { ok: false, error: '입력 범위 오류' };
  });
  await model.create({ strategy: 'first' });
  await model.create({ strategy: 'changed' });
  assert.equal(calls[1].replace_session_id, 'session-1');
  assert.equal(model.state().snapshot.strategy, paused.strategy);
  assert.equal(model.state().error, '입력 범위 오류');
});

test('missing replacement after backend restart retries once without its old ID and preserves failed drafts', async () => {
  for (const retrySucceeds of [true, false]) {
    const calls = [];
    const { model } = fixture(async (_channel, body) => {
      calls.push(body);
      if (calls.length === 1) return ok(paused);
      if (calls.length === 2) return { ok: false, status: 404, error: '교체할 세션 없음' };
      return retrySucceeds ? ok({ ...paused, session_id: 'replacement', strategy: 'changed' })
        : { ok: false, status: 404, error: '새 세션 실패' };
    });
    await model.create({ strategy: 'first' });
    await model.create({ strategy: 'changed' });
    assert.equal(calls.length, 3);
    assert.equal(calls[1].replace_session_id, 'session-1');
    assert.equal('replace_session_id' in calls[2], false);
    assert.equal(calls[2].strategy, 'changed');
    assert.equal(model.state().snapshot.session_id, retrySucceeds ? 'replacement' : 'session-1');
    if (!retrySucceeds) assert.equal(model.state().error, '새 세션 실패');
  }
});

test('completed and failed snapshots stop polling and refuse more bars', async () => {
  for (const status of ['done', 'failed']) {
    let count = 0;
    const { model, timers } = fixture(async () => { count++; return ok({ ...paused, status }); });
    await model.create({});
    await model.step();
    await model.run();
    assert.equal(count, 1);
    assert.equal(timers.size, 0);
  }
});

test('prepare returns reviewable schema separately and never launches or replaces a simulation', async () => {
  const calls = [];
  const { model } = fixture(async (_channel, body) => {
    calls.push(body);
    return body.operation === 'prepare' ? ok(prepared(body.strategy)) : ok(paused);
  });
  await model.create({});
  await model.prepare('  평균선 조건  ');
  assert.equal(model.state().snapshot, paused);
  assert.equal(model.state().preparation.decision_schema.source_text, '평균선 조건');
  assert.deepEqual(calls.at(-1), { strategy: '평균선 조건', decision_mode: 'natural', operation: 'prepare' });
  assert.equal(calls.some(body => body.operation === 'run'), false);
});

test('failed, mismatched and clarification preparations cannot become executable schemas', async () => {
  for (const response of [{ ok: false, error: '설계 모델 연결 실패' }, ok(prepared('different')),
    ok({ strategy: '조건', status: 'needs_clarification', question: '이동평균 기간은 며칠인가요?' })]) {
    const { model } = fixture(async (_channel, body) => body.operation === 'prepare' ? response : ok(paused));
    await model.create({});
    await model.prepare('조건');
    assert.equal(model.state().snapshot, paused);
    assert.equal(!!model.state().preparation?.decision_schema, false);
    assert.ok(model.state().error || model.state().preparation.question);
  }
});

test('snapshot displays actual accounting, pending actions, source range and notices as text', () => {
  const document = { createElement: fakeDom.fakeNode };
  const root = fakeDom.fakeNode('div');
  const row = { as_of: '2026-01-02', action: 'wait', fallback_reason: 'server_unavailable',
    request: { state: { pending_entry: true } }, response: { raw: '<script>attack</script>' } };
  natural.renderSnapshot(document, root, { ...paused, decisions: [row],
    current_state: { cash: 500, qty: 4.5, pending_entry: true }, equity: [{ equity: 1200 }] });
  assert.match(root.textContent, /합성 데모 · 실제 시장 데이터 아님/);
  assert.match(root.textContent, /2026-01-02 ~ 2026-01-05/);
  assert.match(root.textContent, /현금 500원 · 보유 4.5주 · 평가자산 1,200원/);
  assert.match(root.textContent, /대기 진입/);
  assert.match(root.textContent, /server_unavailable/);
  assert.match(root.textContent, /진입 대기/);
  assert.match(root.textContent, /순차 재생 안내/);
  const tags = [];
  const walk = node => { tags.push(node.nodeName); node.children.forEach(walk); };
  walk(root);
  assert.equal(tags.includes('img'), false);
  assert.equal(tags.includes('script'), false);
});

test('input budget and server failures have Korean explanations while JSON retains exact causes', () => {
  const document = { createElement: fakeDom.fakeNode };
  const root = fakeDom.fakeNode('div');
  natural.renderSnapshot(document, root, { ...paused, decisions: [
    { as_of: '2026-01-02', action: 'wait', fallback_reason: 'invalid_input:input_budget_exceeded' },
    { as_of: '2026-01-05', action: 'wait', fallback_reason: 'server_unavailable_or_invalid_json' },
  ] });
  assert.match(root.textContent, /조건과 관측값이 모델 입력 한도를 초과함/);
  assert.match(root.textContent, /LAYA 서버 연결 또는 응답 오류/);
  assert.match(root.textContent, /invalid_input:input_budget_exceeded/);
});

test('panel requires reviewed unchanged input and sends prepared schema before demo replay', async () => {
  const calls = [];
  const panel = natural.createPanel({ document: { createElement: fakeDom.fakeNode },
    invoke: async (_channel, body) => { calls.push(body); return body.operation === 'prepare' ? ok(prepared(body.strategy)) : ok(paused); },
    onClose() {}, setTimeoutImpl() {}, clearTimeoutImpl() {},
  });
  const buttons = panel.element.querySelectorAll('.backtest-natural-button');
  const button = label => buttons.find(node => node.textContent === label);
  assert.equal(button('다음 봉').disabled, true);
  const begin = button('검토한 조건으로 모의 시작');
  assert.equal(begin.disabled, true);
  const fields = panel.element.querySelectorAll('.backtest-natural-field').map(label => label.children[1]);
  const start = fields.find(field => field.name === 'from_dt');
  assert.equal(start.disabled, true);
  begin.dispatchEvent({ type: 'click' });
  assert.equal(calls.length, 0);
  button('LAYA 판단 설계').dispatchEvent({ type: 'click' });
  await settle();
  assert.equal(begin.disabled, false);
  assert.match(panel.element.textContent, /보유하지 않을 때/);
  assert.match(panel.element.textContent, /종가가 평균보다 높음/);
  assert.match(panel.element.textContent, /LAYA 판단 입력 JSON 보기/);
  const strategy = fields.find(field => field.name === 'strategy');
  strategy.value += ' 바뀐 조건';
  strategy.dispatchEvent({ type: 'input' });
  assert.equal(begin.disabled, true);
  assert.match(panel.element.textContent, /원문이 변경되었습니다/);
  strategy.value = natural.DEFAULT_STRATEGY;
  strategy.dispatchEvent({ type: 'input' });
  begin.dispatchEvent({ type: 'click' });
  await settle();
  assert.equal(calls[1].data_source, 'demo');
  assert.equal('from_dt' in calls[1], false);
  assert.deepEqual(calls[1].decision_schema, prepared().decision_schema);
  assert.deepEqual(calls[1].costs, { fee_bps: 1.5, tax_bps: 18, slippage_bps: 5 });
  assert.equal(button('다음 봉').disabled, false);
});

test('clarification is shown as a question and keeps simulation start disabled', async () => {
  const panel = natural.createPanel({ document: { createElement: fakeDom.fakeNode },
    invoke: async () => ok({ strategy: natural.DEFAULT_STRATEGY, status: 'needs_clarification', question: '어떤 기간인가요?' }),
    onClose() {}, setTimeoutImpl() {}, clearTimeoutImpl() {},
  });
  const buttons = panel.element.querySelectorAll('.backtest-natural-button');
  buttons.find(node => node.textContent === 'LAYA 판단 설계').dispatchEvent({ type: 'click' });
  await settle();
  assert.match(panel.element.textContent, /어떤 기간인가요/);
  assert.equal(buttons.find(node => node.textContent === '검토한 조건으로 모의 시작').disabled, true);
});
