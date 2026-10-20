import test from "node:test";
import assert from "node:assert/strict";

import { createProviderPanelController } from "../src/sidepanel/provider-panel.mjs";

const OWNER = "11111111-1111-4111-8111-111111111111";

function element({ options = false } = {}) {
  const listeners = new Map();
  const value = {
    textContent: "",
    disabled: false,
    hidden: false,
    value: "",
    addEventListener(type, listener) { listeners.set(type, listener); },
    dispatch(type) { listeners.get(type)?.(); },
  };
  if (options) {
    value.options = [];
    value.replaceChildren = () => { value.options = []; };
    value.append = (option) => { value.options.push(option); };
  }
  return value;
}

function elements() {
  return {
    status: element(), operation: element(), connect: element(), disconnect: element(), reset: element(),
    models: element(), refresh: element(), cancel: element(), model: element({ options: true }), proposal: element(),
    assistant: element(), command: element(), execute: element(), reject: element(),
  };
}

function harness(send, { attachOwner = true, nativeConnected = true, manual = false, requestTimeoutMs = 30_000 } = {}) {
  const messageListeners = [];
  const disconnectListeners = [];
  const posted = [];
  const controlResults = [];
  const terminals = [];
  let disconnects = 0;
  const panelElements = elements();
  const respond = (request, result) => messageListeners[0]({ type: "provider.response", requestId: request.requestId, ok: true, result });
  const runtime = {
    connect() {
      return {
        onMessage: { addListener(listener) { messageListeners.push(listener); } },
        onDisconnect: { addListener(listener) { disconnectListeners.push(listener); } },
        postMessage(envelope) {
          posted.push(structuredClone(envelope));
          if (manual) return;
          void Promise.resolve().then(() => send(envelope.message.type, envelope.message)).then(
            (result) => respond(envelope, result),
            (error) => messageListeners[0]({ type: "provider.response", requestId: envelope.requestId, ok: false, error: error.message, errorCode: error.code }),
          );
        },
        disconnect() { disconnectListeners[0](); },
      };
    },
  };
  const controller = createProviderPanelController({
    runtime,
    elements: panelElements,
    onPlanTerminal(value) { terminals.push(value); },
    onControlResult(value) { controlResults.push(value); },
    onPortDisconnect() { disconnects += 1; },
    pollMs: 0,
    requestTimeoutMs,
  });
  if (attachOwner) messageListeners[0]({ type: "provider.owner", ownerId: OWNER });
  if (nativeConnected) controller.applyNativeConnection(true);
  return {
    controller,
    elements: panelElements,
    posted, respond, controlResults, terminals,
    disconnects: () => disconnects,
    receive: (message) => messageListeners[0](message),
    owner: () => messageListeners[0]({ type: "provider.owner", ownerId: OWNER }),
    ownerError: (error) => messageListeners[0]({ type: "provider.owner.error", error }),
    disconnect: () => disconnectListeners[0](),
  };
}

async function settle(check, attempts = 20) {
  for (let index = 0; index < attempts; index += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.fail("provider panel did not settle");
}

const signedOut = { connection: "signed-out", operation: null, proposal: null, models: [] };
const connected = { connection: "connected", operation: null, proposal: null, models: [] };

for (const connection of ["unknown", "signed-out", "connected"]) {
  test(`explicit status refresh recovers ${connection} through status reads only`, async () => {
    const calls = [];
    const value = harness(async (type) => {
      calls.push(type);
      if (type !== "panel.provider.status") throw new Error(`unexpected ${type}`);
      return calls.length === 1 ? { ...signedOut, connection } : connected;
    });
    await settle(() => value.controller.snapshot().state?.connection === connection);
    assert.equal(value.elements.refresh.disabled, false);
    value.elements.refresh.dispatch("click");
    await settle(() => calls.length === 2 && !value.elements.refresh.disabled);
    assert.equal(value.controller.snapshot().state.connection, "connected");
    assert.deepEqual(calls, ["panel.provider.status", "panel.provider.status"]);
    value.disconnect();
    assert.equal(value.elements.refresh.disabled, true);
  });
}

test("status refresh preserves a failed models terminal and its signed-in session", async () => {
  const calls = [];
  const failure = "ChatGPT 모델 목록을 가져오지 못했습니다.";
  let statusReads = 0;
  const value = harness(async (type) => {
    calls.push(type);
    if (type === "panel.provider.status") {
      statusReads += 1;
      if (statusReads === 2) throw new Error("private status detail");
      return connected;
    }
    if (type === "panel.provider.models") return { ...connected, operation: { kind: "models", state: "running", cancellable: true } };
    if (type === "panel.provider.get") return { ...signedOut, connection: "unknown", terminal: { kind: "models", state: "failed", error: { message: failure } } };
    throw new Error(`unexpected ${type}`);
  });
  await settle(() => value.controller.snapshot().state?.connection === "connected");
  value.elements.models.dispatch("click");
  await settle(() => value.elements.operation.textContent.includes(failure));
  const terminalText = value.elements.operation.textContent;
  value.elements.refresh.dispatch("click");
  await settle(() => statusReads === 2 && !value.elements.refresh.disabled);
  assert.equal(value.elements.operation.textContent, terminalText);
  assert.equal(value.controller.snapshot().state.connection, "unknown");
  value.elements.refresh.dispatch("click");
  await settle(() => statusReads === 3 && !value.elements.refresh.disabled);
  assert.equal(value.elements.operation.textContent, terminalText);
  assert.equal(value.controller.snapshot().state.connection, "connected");
  assert.equal(calls.filter((type) => type === "panel.provider.models").length, 1);
  assert.equal(calls.some((type) => /connect|reset/.test(type)), false);
  value.disconnect();
});

test("status refresh reconciles a consumed terminal summary and keeps its error without replay", async () => {
  const calls = [];
  const terminal = { kind: "models", state: "failed", error: { code: "PROVIDER_MODELS_FAILED", message: "ChatGPT 모델 목록을 가져오지 못했습니다." } };
  const summary = { operationId: OWNER, kind: "models", state: "failed", revision: 2, cancellable: false };
  let statusReads = 0;
  let polls = 0;
  const value = harness(async (type) => {
    calls.push(type);
    if (type === "panel.provider.status") return ++statusReads === 1 ? connected : { ...connected, operation: summary };
    if (type === "panel.provider.models") return { ...connected, operation: { ...summary, state: "running", revision: 1, cancellable: true } };
    if (type === "panel.provider.get") { polls += 1; return { ...connected, terminal }; }
    throw new Error(`unexpected ${type}`);
  });
  await settle(() => value.controller.snapshot().state?.connection === "connected");
  value.elements.models.dispatch("click");
  await settle(() => polls === 1 && value.elements.operation.textContent.includes(terminal.error.message));
  const original = value.elements.operation.textContent;
  value.elements.refresh.dispatch("click");
  await settle(() => polls === 2 && !value.controller.snapshot().state?.operation && !value.elements.refresh.disabled);
  assert.equal(value.elements.operation.textContent, original);
  assert.equal(value.elements.status.textContent, "연결됨");
  assert.deepEqual(calls, ["panel.provider.status", "panel.provider.models", "panel.provider.get", "panel.provider.status", "panel.provider.get"]);
  value.disconnect();
});

for (const disconnected of ["native", "owner"]) {
  test(`explicit status refresh fences a late reply after ${disconnected} disconnect`, async () => {
    const value = harness(async () => {}, { manual: true });
    value.respond(value.posted[0], connected);
    await settle(() => value.controller.snapshot().state?.connection === "connected");
    value.elements.refresh.dispatch("click");
    assert.equal(value.elements.refresh.disabled, true);
    const pending = value.posted.at(-1);
    value.elements.refresh.dispatch("click");
    assert.equal(value.posted.length, 2);
    if (disconnected === "native") value.controller.applyNativeConnection(false);
    else value.disconnect();
    value.respond(pending, connected);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(value.controller.snapshot().state, null);
    assert.equal(value.elements.refresh.disabled, true);
    assert.equal(value.posted.length, 2);
  });
}

test("explicit status refresh is unavailable without owner/native or during an operation", async () => {
  const value = harness(async () => ({ ...connected, operation: { kind: "models", state: "running", cancellable: true } }), { attachOwner: false });
  assert.equal(value.elements.refresh.disabled, true);
  value.elements.refresh.dispatch("click");
  assert.equal(value.posted.length, 0);
  value.owner();
  await settle(() => value.controller.snapshot().state?.operation);
  assert.equal(value.elements.refresh.disabled, true);
  value.disconnect();
});

test("initial panel state distinguishes a disconnected Native host from provider work", () => {
  const value = harness(async () => { throw new Error("must not send"); }, { attachOwner: false, nativeConnected: false });
  assert.equal(value.elements.status.textContent, "로컬 실행기 연결 안 됨");
  assert.equal(value.elements.operation.textContent, "로컬 실행기에 연결해 주세요.");
  assert.equal(value.elements.connect.disabled, true);
});

test("connected Native host waits for an owner without sending provider requests", () => {
  let calls = 0;
  const value = harness(async () => { calls += 1; }, { attachOwner: false });
  assert.equal(value.elements.status.textContent, "패널 연결 대기 중");
  assert.equal(value.elements.operation.textContent, "ChatGPT 패널 연결을 준비하는 중입니다.");
  assert.equal(value.elements.connect.disabled, true);
  assert.equal(calls, 0);
});

test("owner rejection remains visible after the port disconnects without exposing raw error text", () => {
  const value = harness(async () => { throw new Error("must not send"); }, { attachOwner: false });
  value.ownerError("token=secret https://example.invalid/internal");
  value.disconnect();
  assert.equal(value.elements.status.textContent, "패널 연결 차단");
  assert.equal(value.elements.operation.textContent, "신뢰할 수 없는 ChatGPT 패널 연결 요청이 차단되었습니다. 확장 프로그램을 다시 로드한 뒤 패널을 다시 열어 주세요.");
  assert.equal(value.elements.operation.textContent.includes("secret"), false);
  assert.equal(value.elements.operation.textContent.includes("https://"), false);
  assert.equal(value.elements.connect.disabled, true);
});

for (const scenario of [
  {
    error: "다른 ChatGPT 패널이 이미 연결되어 있습니다.",
    status: "다른 패널 연결 중",
    operation: "다른 ATHENA 패널이 이미 ChatGPT 연결을 사용 중입니다. 다른 ATHENA 패널을 닫고 이 패널을 다시 열어 주세요.",
  },
  {
    error: "ChatGPT 패널 문서 식별자를 확인할 수 없습니다.",
    status: "패널 식별 실패",
    operation: "ChatGPT 패널 문서 식별자를 확인하지 못했습니다. 확장 프로그램을 다시 로드한 뒤 패널을 다시 열어 주세요.",
  },
]) {
  test(`allowlisted owner failure '${scenario.status}' remains actionable after disconnect`, () => {
    const value = harness(async () => { throw new Error("must not send"); }, { attachOwner: false });
    value.ownerError(scenario.error);
    value.disconnect();
    assert.equal(value.elements.status.textContent, scenario.status);
    assert.equal(value.elements.operation.textContent, scenario.operation);
    assert.equal(value.elements.connect.disabled, true);
  });
}

test("accepted owner refreshes provider status and renders the signed-out state", async () => {
  const calls = [];
  const value = harness(async (type) => {
    calls.push(type);
    if (type === "panel.provider.status") return signedOut;
    throw new Error(`unexpected ${type}`);
  }, { attachOwner: false });
  value.owner();
  await settle(() => value.controller.snapshot().state?.connection === "signed-out");
  assert.deepEqual(calls, ["panel.provider.status"]);
  assert.equal(value.elements.status.textContent, "연결 안 됨");
  assert.equal(value.elements.operation.textContent, "ChatGPT를 연결해 주세요.");
  assert.equal(value.elements.connect.disabled, false);
});

for (const scenario of [
  { kind: "connect", action: "connect", base: signedOut, state: "failed", message: "ChatGPT 계정 연결을 완료하지 못했습니다." },
  { kind: "connect", action: "connect", base: signedOut, state: "cancelled", message: "ChatGPT 계정 연결을 취소했습니다." },
  { kind: "models", action: "models", base: connected, state: "failed", message: "ChatGPT 모델 목록을 가져오지 못했습니다." },
  { kind: "models", action: "models", base: connected, state: "cancelled", message: "ChatGPT 모델 목록 요청을 취소했습니다." },
]) {
  test(`retains ${scenario.state} ${scenario.kind} terminal until the next explicit action`, async () => {
    const calls = [];
    const value = harness(async (type) => {
      calls.push(type);
      if (type === "panel.provider.status") return scenario.base;
      if (type === `panel.provider.${scenario.action}`) {
        return { ...scenario.base, operation: { kind: scenario.kind, state: "running", cancellable: true } };
      }
      if (type === "panel.provider.get") {
        return {
          ...scenario.base,
          terminal: { kind: scenario.kind, state: scenario.state, error: { message: scenario.message } },
        };
      }
      throw new Error(`unexpected ${type}`);
    });
    await settle(() => calls.includes("panel.provider.status"));
    value.elements[scenario.action].dispatch("click");
    await settle(() => value.elements.operation.textContent.includes(scenario.message));
    assert.equal(value.elements.operation.textContent, `ChatGPT ${scenario.kind === "connect" ? "연결" : "모델 목록"} ${scenario.state === "failed" ? "실패" : "취소됨"}: ${scenario.message}`);

    value.elements[scenario.action].dispatch("click");
    assert.equal(value.elements.operation.textContent.includes(scenario.message), false);
  });
}

test("a terminal response from an invalidated Native generation cannot reappear", async () => {
  let resolvePoll;
  let pollStarted = false;
  const value = harness(async (type) => {
    if (type === "panel.provider.status") return signedOut;
    if (type === "panel.provider.connect") return { ...signedOut, operation: { kind: "connect", state: "running", cancellable: true } };
    if (type === "panel.provider.get") {
      pollStarted = true;
      return new Promise((resolve) => { resolvePoll = resolve; });
    }
    throw new Error(`unexpected ${type}`);
  });
  await settle(() => value.controller.snapshot().state?.connection === "signed-out");
  value.elements.connect.dispatch("click");
  await settle(() => pollStarted);
  value.controller.applyNativeConnection(false);
  resolvePoll({
    ...signedOut,
    terminal: { kind: "connect", state: "failed", error: { message: "ChatGPT 계정 연결을 완료하지 못했습니다." } },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(value.controller.snapshot().state, null);
  assert.equal(value.controller.snapshot().busy, false);
  assert.equal(value.elements.operation.textContent, "로컬 실행기에 연결해 주세요.");
});

test("provider and chat RPC use only the owner Port and correlate out-of-order replies", async () => {
  const value = harness(() => assert.fail("manual transport only"), { manual: true });
  value.respond(value.posted[0], signedOut);
  await settle(() => value.controller.snapshot().state?.connection === "signed-out");
  const first = value.controller.request("panel.chat.submit", { submissionId: "one", text: "안녕" });
  const second = value.controller.request("panel.provider.status");
  const firstWire = value.posted[1];
  const secondWire = value.posted[2];
  assert.deepEqual(firstWire.message, { type: "panel.chat.submit", submissionId: "one", text: "안녕" });
  assert.equal(firstWire.type, "provider.request");
  assert.equal(firstWire.ownerId, OWNER);
  assert.notEqual(firstWire.requestId, secondWire.requestId);
  value.receive({ type: "provider.response", requestId: "unrelated", ok: true, result: "wrong" });
  value.respond(secondWire, "second");
  value.respond(firstWire, "first");
  assert.equal(await first, "first");
  assert.equal(await second, "second");
  value.disconnect();
});

test("Port disconnect rejects every pending RPC and ignores late owner or proposal replies", async () => {
  const value = harness(() => assert.fail("manual transport only"), { manual: true });
  value.respond(value.posted[0], signedOut);
  await settle(() => value.controller.snapshot().state?.connection === "signed-out");
  const first = value.controller.request("panel.chat.submit", { submissionId: "one", text: "안녕" });
  const second = value.controller.request("panel.provider.status");
  const failures = Promise.all([assert.rejects(first, /연결이 끊어/), assert.rejects(second, /연결이 끊어/)]);
  value.disconnect();
  await failures;
  value.owner();
  value.respond(value.posted[2], { ...connected, proposal: { assistantText: "late", commandText: "차트 열어줘" } });
  value.controller.trackOperation({ submissionId: "late", operation: { kind: "plan", state: "running" } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(value.controller.snapshot().ownerId, null);
  assert.equal(value.controller.snapshot().state, null);
  assert.equal(value.controller.snapshot().busy, false);
  assert.equal(value.elements.proposal.hidden, true);
  assert.equal(value.elements.execute.disabled, true);
  assert.equal(value.elements.reject.disabled, true);
  assert.equal(value.elements.model.disabled, true);
  assert.equal(value.elements.cancel.disabled, true);
  assert.equal(value.elements.status.textContent, "패널 연결 끊김");
  assert.equal(value.disconnects(), 1);
  assert.equal(value.posted.length, 3);
});

for (const action of ["execute", "reject"]) {
  test(`resolved ${action} response cannot mutate state after disconnect before its callback`, async () => {
    const value = harness(() => assert.fail("manual transport only"), { manual: true });
    const proposal = { submissionId: "one", catalogVersion: "test", assistantText: "제안", commandText: "차트 열어줘" };
    value.respond(value.posted[0], { ...connected, proposal });
    await settle(() => value.controller.snapshot().state?.proposal);
    value.elements[action].dispatch("click");
    value.respond(value.posted[1], action === "execute" ? { kind: "control-task", task: {} } : { ...connected, proposal });
    value.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(value.controller.snapshot().state, null);
    assert.equal(value.elements.proposal.hidden, true);
    assert.equal(value.elements.execute.disabled, true);
    assert.equal(value.elements.reject.disabled, true);
    assert.deepEqual(value.controlResults, []);
    assert.equal(value.elements.operation.textContent, "ChatGPT 패널 연결이 끊어졌습니다. 패널을 다시 열어 주세요.");
  });
}

test("an RPC timeout does not retry and its late response cannot render", async () => {
  const value = harness(() => assert.fail("manual transport only"), { manual: true, requestTimeoutMs: 15 });
  value.respond(value.posted[0], signedOut);
  await settle(() => value.controller.snapshot().state?.connection === "signed-out");
  const pending = value.controller.request("panel.provider.connect");
  const wire = value.posted[1];
  await assert.rejects(pending, /자동으로 다시 실행하지 않습니다/);
  value.respond(wire, { ...connected, proposal: { commandText: "차트 열어줘" } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(value.posted.length, 2);
  assert.equal(value.controller.snapshot().state.connection, "signed-out");
  assert.equal(value.elements.proposal.hidden, true);
  value.disconnect();
});

test("Native disconnect also fences an already resolved confirmation callback", async () => {
  const value = harness(() => assert.fail("manual transport only"), { manual: true });
  value.respond(value.posted[0], { ...connected, proposal: { submissionId: "one", catalogVersion: "test" } });
  await settle(() => value.controller.snapshot().state?.proposal);
  value.elements.execute.dispatch("click");
  value.respond(value.posted[1], { kind: "control-task", task: {} });
  value.controller.applyNativeConnection(false);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(value.controller.snapshot().state, null);
  assert.deepEqual(value.controlResults, []);
  value.disconnect();
});

test("the owner Port bounds outstanding requests without sending overflow", async () => {
  const value = harness(() => assert.fail("manual transport only"), { manual: true });
  value.respond(value.posted[0], signedOut);
  await settle(() => value.controller.snapshot().state?.connection === "signed-out");
  const waiting = Array.from({ length: 16 }, () => value.controller.request("panel.provider.status"));
  await assert.rejects(value.controller.request("panel.provider.status"), /요청이 많습니다/);
  assert.equal(value.posted.length, 17);
  const rejected = Promise.all(waiting.map((pending) => assert.rejects(pending, /연결이 끊어/)));
  value.disconnect();
  await rejected;
});
