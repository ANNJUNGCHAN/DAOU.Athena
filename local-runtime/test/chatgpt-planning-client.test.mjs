import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACCIDENTAL_DISCLOSURE_PATTERN,
  PlanningClient,
  createControlCandidateSchema,
  createPlanningInstructions,
  validateControlCatalog,
} from '../src/chatgpt-provider/planning-client.mjs';

const CATALOG = ['차트 열어줘', '주봉으로', '차트 열고 주봉으로'];

function responseClient(result) {
  const calls = [];
  return {
    calls,
    cancelCalls: 0,
    async complete(request) { calls.push(request); return result; },
    cancel() { this.cancelCalls += 1; return true; },
  };
}

test('validates, deduplicates and freezes the deterministic offered catalog', () => {
  const catalog = validateControlCatalog(['주봉으로', '주봉으로', '차트 열어줘']);
  assert.deepEqual(catalog, ['주봉으로', '차트 열어줘']);
  assert.equal(Object.isFrozen(catalog), true);
  for (const invalid of [
    [], [' 주봉으로'], ['매수해줘'], Array.from({ length: 101 }, (_, index) => `명령-${index}`),
    ['\ud800'],
  ]) assert.throws(() => validateControlCatalog(invalid), { code: 'OPENAI_CONTROL_CATALOG_INVALID' });
});

test('constructs exact proposal-only schema and bounded non-execution instructions', () => {
  const schema = createControlCandidateSchema(CATALOG);
  assert.deepEqual(schema.required, ['assistantText', 'proposal']);
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.properties.proposal.anyOf[1].properties.text.enum, CATALOG);
  assert.equal(Object.isFrozen(schema.properties.proposal.anyOf[1].properties.text.enum), true);
  const instructions = createPlanningInstructions(CATALOG);
  assert.match(instructions, /이미 실행되었다고 말하지 마세요/u);
  for (const entry of CATALOG) assert.equal(instructions.includes(`- ${entry}`), true);
});

test('sends only preflighted user text, static instructions and schema then validates the completion', async () => {
  const transport = responseClient(JSON.stringify({
    assistantText: '주봉 전환을 제안합니다.',
    proposal: { kind: 'wts-control', text: '주봉으로' },
  }));
  const planner = new PlanningClient({ responsesClient: transport, catalog: CATALOG });
  const result = await planner.plan('한 주 단위 차트로 바꿔줘');
  assert.deepEqual(result, {
    assistantText: '주봉 전환을 제안합니다.',
    proposal: { kind: 'wts-control', text: '주봉으로' },
  });
  assert.deepEqual(Object.keys(transport.calls[0]).sort(), ['inputText', 'instructions', 'schema']);
  assert.equal(transport.calls[0].inputText, '한 주 단위 차트로 바꿔줘');
  assert.equal(JSON.stringify(transport.calls[0]).includes('cookie'), false);
  assert.equal(JSON.stringify(transport.calls[0]).includes('receipt'), false);
});

test('blocks named credential labels and seven-digit runs before transport while allowing six-digit stock codes', async () => {
  const blocked = [
    '비밀번호 1234', '인증번호 알려줘', '계좌번호 123-4', 'ACCESS_TOKEN abc',
    'refresh-token abc', 'api key abc', '값은 1234567',
  ];
  for (const input of blocked) {
    const transport = responseClient('{}');
    const planner = new PlanningClient({ responsesClient: transport, catalog: CATALOG });
    await assert.rejects(planner.plan(input), { code: 'OPENAI_PLANNING_INPUT_SENSITIVE' });
    assert.equal(transport.calls.length, 0);
  }
  assert.equal(ACCIDENTAL_DISCLOSURE_PATTERN.test('005930'), false);
  const transport = responseClient('{"assistantText":"종목 코드는 실행 명령이 아닙니다.","proposal":null}');
  const planner = new PlanningClient({ responsesClient: transport, catalog: CATALOG });
  assert.equal((await planner.plan('005930')).proposal, null);
});

test('rejects empty, noncanonical, oversized and unpaired-surrogate user input before transport', async () => {
  for (const input of ['', '   ', ' 주봉으로 ', '가'.repeat(683), '\ud800']) {
    const transport = responseClient('{}');
    const planner = new PlanningClient({ responsesClient: transport, catalog: CATALOG });
    await assert.rejects(planner.plan(input), { code: 'OPENAI_PLANNING_INPUT_INVALID' });
    assert.equal(transport.calls.length, 0);
  }
});

test('single-flight blocks overlap and cancellation delegates only while active', async () => {
  let resolve;
  const transport = responseClient(null);
  transport.complete = (request) => {
    transport.calls.push(request);
    return new Promise((done) => { resolve = done; });
  };
  const planner = new PlanningClient({ responsesClient: transport, catalog: CATALOG });
  assert.equal(planner.cancel(), false);
  const pending = planner.plan('주봉으로 바꿔줘');
  await assert.rejects(planner.plan('차트 보여줘'), { code: 'OPENAI_PLANNING_BUSY' });
  assert.equal(planner.cancel(), true);
  resolve('{"assistantText":"제안입니다.","proposal":null}');
  await assert.rejects(pending, { code: 'OPENAI_PLANNING_CANCELLED' });
  assert.equal(transport.cancelCalls, 1);
  assert.equal(planner.cancel(), false);
});

test('local cancellation wins when a transport ignores cancellation and resolves late', async () => {
  let resolve;
  const transport = responseClient(null);
  transport.complete = () => new Promise((done) => { resolve = done; });
  transport.cancel = () => false;
  const planner = new PlanningClient({ responsesClient: transport, catalog: CATALOG });
  const pending = planner.plan('주봉으로 바꿔줘');
  assert.equal(planner.cancel(), true);
  resolve('{"assistantText":"늦은 제안","proposal":{"kind":"wts-control","text":"주봉으로"}}');
  await assert.rejects(pending, { code: 'OPENAI_PLANNING_CANCELLED' });
});

test('never falls back when completed structured output is malformed or unoffered', async () => {
  for (const completedText of [
    '주봉으로',
    '{"assistantText":"제안","proposal":{"kind":"wts-control","text":"일봉으로"}}',
    '{"assistantText":"제안","proposal":{"kind":"wts-control","text":"주봉으로"},"extra":1}',
  ]) {
    const planner = new PlanningClient({
      responsesClient: responseClient(completedText),
      catalog: CATALOG,
    });
    await assert.rejects(planner.plan('주봉으로 바꿔줘'));
  }
});
