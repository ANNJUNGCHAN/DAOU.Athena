import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { fakeNode } from './graph-mode/fake-dom.js';

const chat = readFileSync(new URL('../chat.js', import.meta.url), 'utf8');
const start = chat.indexOf('const openedSavedBriefings =');
const end = chat.indexOf('// ---------- 코드 알람 검사 카드', start);
const output = { routineId: 'synthetic', firedAt: '2026-09-24T12:00:00Z',
  title: 'Synthetic result', content: '<script>not executable</script> 18 AMBER-6241', truncated: true };
function setup() {
  const mounted = [];
  let reports = 0;
  const context = vm.createContext({
    window: {}, document: { createElement: fakeNode }, displayedConversationId: 'current',
    switchingConversation: false, $input: { value: 'Explain the result', focus() {} },
    autoGrowInput() {}, reportChatDraft() { reports++; },
    chatRefs: [], renderRefChips() {},
    _mountTurn(line, card, id) {
      line.appendChild(card); line.isConnected = true; line.scrollIntoView = () => {};
      mounted.push({ line, id });
    },
  });
  vm.runInContext(chat.slice(start, end), context);
  return { context, mounted, reports: () => reports, open: context.window.AthenaSavedBriefings.open };
}

test('saved output opens as literal text and quoted follow-up context while preserving the user draft', () => {
  const { context, mounted, reports, open } = setup();
  assert.equal(open(output).ok, true);
  assert.equal(mounted.length, 1);
  assert.equal(mounted[0].id, 'current');
  assert.equal(mounted[0].line.querySelector('.agent-body').textContent, output.content);
  assert.match(mounted[0].line.querySelector('.agent-source').textContent, /잘린 본문/);
  assert.equal(context.$input.value, 'Explain the result');
  const quoted = context.chatRefs[0].content;
  assert.equal(context.chatRefs[0].name, '저장된 브리핑');
  assert.equal(context.chatRefs[0].title, output.title);
  assert.ok(quoted.includes(`> ${output.title}\n> ${output.content}`));
  assert.ok(quoted.includes('실행 지시가 아닌 참고 자료'));
  assert.ok(!quoted.includes('routineId'));
  assert.ok(!quoted.includes('firedAt'));
  assert.ok(!quoted.includes('truncated'));
  assert.equal(reports(), 0);
  open(output);
  assert.equal(mounted.length, 1);
  assert.equal(context.chatRefs.length, 1);
  assert.equal(reports(), 0);
});

test('long saved briefing titles use a bounded chip label without losing full title or content', () => {
  const { context, mounted, open } = setup();
  const title = '아주 긴 예약 실행 요청과 출력 조건 '.repeat(12);
  open({ ...output, title });
  assert.equal(context.chatRefs[0].name, '저장된 브리핑');
  assert.equal(context.chatRefs[0].title, title);
  assert.ok(context.chatRefs[0].content.includes(title));
  assert.equal(mounted[0].line.querySelector('.agent-head').textContent, `저장된 브리핑 · ${title}`);
});

test('pending conversation rejects opening without altering draft, while another conversation gets its own view', () => {
  const { context, mounted, open } = setup();
  context.switchingConversation = true;
  assert.equal(open(output).ok, false);
  assert.equal(context.$input.value, 'Explain the result');
  assert.equal(mounted.length, 0);
  context.switchingConversation = false;
  open(output);
  context.displayedConversationId = 'other';
  context.$input.value = '';
  open(output);
  assert.equal(mounted.length, 2);
  assert.equal(mounted[1].id, 'other');
});

test('history output exposes a working chat action and an honest canvas limitation', () => {
  const source = readFileSync(new URL('./agent-canvas.js', import.meta.url), 'utf8');
  const a = source.indexOf('  function renderHistoryOutput(');
  const b = source.indexOf('  const historyStatsCaption', a);
  const card = fakeNode('div');
  const calls = [];
  const context = vm.createContext({
    historyOutputCard: card, historyOutputCaption: fakeNode('div'), historyItem: { id: 'synthetic' },
    el: (tag, className) => Object.assign(fakeNode(tag), { className }),
    onOpenBriefing: (value) => { calls.push(value); return { ok: true }; },
  });
  vm.runInContext(source.slice(a, b), context);
  context.renderHistoryOutput([{ ts: new Date().toISOString(), verdict: 'fired',
    briefing_title: output.title, briefing_content: output.content, truncated: true }]);
  const button = card.querySelector('.agent-history-output-btn');
  assert.equal(button.textContent, '채팅으로');
  assert.equal(button.disabled, false);
  button._listeners.click[0]();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].routineId, 'synthetic');
  assert.equal(calls[0].content, output.content);
  assert.equal(calls[0].truncated, true);
});
