import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const renderer = fs.readFileSync(new URL('../../canvas.js', import.meta.url), 'utf8');
const main = fs.readFileSync(new URL('../../main.js', import.meta.url), 'utf8');
function functionSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1);
  const asyncStart = source.slice(start - 6, start) === 'async ' ? start - 6 : start;
  return source.slice(asyncStart, source.indexOf('\n}', start) + 2);
}
const errorSource = functionSource(renderer, 'boardHydrationError');
const secret = 'Bearer synthetic-secret https://private.example/account';

function hydration(invoke) {
  const state = { boardId: 'board', hydrationByBoard: new Map([['board', ['price']]]) };
  const run = Function('window', 'boardStateOf', 'boardHydrateTarget', 'boardHydrateAccount',
    `${errorSource}\n${functionSource(renderer, 'hydrateBoardSlots')}\nreturn hydrateBoardSlots;`)(
    { athena: { invoke } }, () => state, () => ({}), () => null,
  );
  return { state, run };
}

test('missing account classification survives main binding failure and offers safe account guidance', async () => {
  const handler = Function('realtimeAccountGeneration', 'createActiveBackendAccountInvoker',
    `${functionSource(main, 'hydrateCanvasBoardForActiveAccount')}\nreturn hydrateCanvasBoardForActiveAccount;`)(
    1, async () => ({ ok: false, error: secret }),
  );
  const reply = await handler();
  assert.equal(reply.errorCode, 'backend_account_unavailable');
  const h = hydration(async () => reply);
  await assert.rejects(h.run({}, {}, {}), (error) => {
    assert.equal(error.action, 'accounts');
    assert.match(error.message, /계좌를 추가하거나 연결 상태/);
    assert.ok(!error.message.includes(secret));
    return true;
  });
});

test('HTTP authentication, unavailable service, and unknown errors give sanitized distinct guidance', async () => {
  for (const [reply, expected] of [
    [{ ok: false, httpStatus: 401 }, /인증.*앱을 다시 시작/],
    [{ ok: false, httpStatus: 403 }, /인증.*앱을 다시 시작/],
    [{ ok: false, status: 'unavailable' }, /서비스에 연결하지 못했습니다/],
    [{ ok: false, httpStatus: 500 }, /잠시 후 다시 시도/],
    [null, /잠시 후 다시 시도/],
  ]) {
    const h = hydration(async () => reply && { ...reply, error: secret });
    await assert.rejects(h.run({}, {}, {}), (error) => {
      assert.match(error.message, expected);
      assert.equal(error.action, undefined);
      assert.ok(!error.message.includes(secret));
      return true;
    });
  }
});

test('rejected IPC is sanitized and obsolete hydration cannot replace the current board', async () => {
  const h = hydration(async () => { throw new Error(secret); });
  await assert.rejects(h.run({}, {}, {}), /서비스에 연결하지 못했습니다/);
  const mounted = {};
  assert.equal(await h.run({}, {}, mounted, () => false), mounted);
});

test('account failure exposes existing settings navigation and retains retry after reconnecting', () => {
  const actions = [];
  const failure = { classList: { add() {} }, setAttribute() {}, appendChild(child) { actions.push(child); } };
  const calls = [];
  const state = { loadCard: { dataset: {} } };
  const host = { setAttribute() {} };
  const show = Function('removeBoardLoadNode', 'emptyState', 'button', 'boardLoadAnchor',
    'settleBoardChartMount', 'window', 'document',
    `${functionSource(renderer, 'showBoardLoadError')}\nreturn showBoardLoadError;`)(
    () => {}, () => failure, (_kind, label, options) => ({ label, ...options }),
    () => ({ insertBefore() {} }), () => {},
    { AthenaShell: { openSettings: () => calls.push('settings') } },
    { querySelector: (selector) => {
      assert.equal(selector, '.settings-nav-item[data-key="accounts"]');
      return { click: () => calls.push('accounts') };
    } },
  );
  show(state, host, { message: 'safe', action: 'accounts' }, () => calls.push('retry'));
  assert.deepEqual(actions.map((action) => action.label), ['계좌 설정', '다시 시도']);
  actions[0].onClick();
  actions[1].onClick();
  assert.deepEqual(calls, ['settings', 'accounts', 'retry']);
  assert.equal(state.loadCard.dataset.renderState, 'error');
  assert.equal(host.hidden, true);
});
