import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const extensionRoot = resolve(import.meta.dirname, "..");
const extensionId = "mhbcjkjmgabekcakpilhgkgeedhkjfee";
const panelUrl = `chrome-extension://${extensionId}/sidepanel/index.html`;
const catalogVersion = `sha256:${"a".repeat(64)}`;
const financialJobId = "00000000-0000-4000-8000-000000000901";
const financialSubmissionId = "00000000-0000-4000-8000-000000000902";
const financialProfileId = "00000000-0000-4000-8000-000000000903";

function financialJob(state, revision) {
  return {
    jobId: financialJobId, submissionId: financialSubmissionId, parentJobId: null,
    profileId: financialProfileId, operationRef: "base:stockinfo", state, revision,
    createdAt: "2026-10-19T00:00:00.000Z", updatedAt: "2026-10-19T00:00:01.000Z",
    queueDeadlineAt: "2026-10-19T00:01:00.000Z",
    runDeadlineAt: state === "queued" ? null : "2026-10-19T00:01:00.000Z",
    terminalAt: state === "completed" || state === "cancelled" ? "2026-10-19T00:00:02.000Z" : null,
    errorCode: state === "cancelled" ? "QUERY_CANCELLED" : null, card: null,
  };
}

function event() {
  const listeners = [];
  return {
    addListener(listener) { listeners.push(listener); },
    fire(...args) { for (const listener of listeners) listener(...args); },
    listeners,
  };
}

function helloResult() {
  return {
    runtimeVersion: "0.8.0",
    capabilities: { observationStorage: true, screenControl: true, laya: false, localPlanner: false },
    control: {
      catalogVersion: "wts-main-control-3",
      actions: [
        "wts.main.p3.chart.open",
        "wts.main.p3.chart.period.set",
        "wts.main.sitemap.open",
        "wts.main.p1.market.navigate",
      ],
      commandMode: "bounded-korean-v3",
      taskMode: "bounded-compound-v1",
      maxTaskSteps: 12,
      planner: {
        kind: "deterministic",
        id: "deterministic-korean-wts-v3",
        version: "3",
        bundleHash: null,
        generative: false,
        localModelReady: false,
      },
      market: { id: "market-menu-navigation-20261019", targetCount: 25 },
    },
    storage: "user-local",
    lifecycle: "native-port",
    source: {
      configured: true,
      profile: "wts-readonly-v1",
      apiVersion: "selector-readonly-v1",
      metadataOnly: true,
      financialQuery: false,
      externalAi: false,
    },
    financial: {
      configured: true,
      profile: "wts-financial-read-v1",
      apiVersion: "selector-financial-read-v1",
      cardVersion: "wts-financial-card-1",
      methods: [
        "source.credentials.status",
        "source.credentials.configure",
        "source.credentials.delete",
        "source.query.start",
        "source.query.status",
        "source.query.page",
        "source.query.continue",
        "source.query.cancel",
      ],
      renderKinds: ["facts", "table", "compound", "chart"],
      queryOnly: true,
      credentialSetup: true,
      order: false,
      websocket: false,
      externalAi: false,
    },
    conversation: {
      routerId: "deterministic-wts-conversation-v1",
      generative: false,
      routes: ["wts-control", "source-search"],
    },
    provider: {
      id: "openai-chatgpt-siwc-v1",
      apiVersion: "openai-provider-native-v1",
      methods: [
        "provider.status", "provider.connect.start", "provider.models.start", "provider.model.select",
        "provider.plan.start", "provider.operation.get", "provider.operation.cancel",
        "provider.disconnect.start", "provider.account.reset.start",
      ],
      asyncJobs: true,
      auth: "explicit-browser-consent",
      tokenStorage: "native-memory-only",
      planner: "proposal-only",
      modelCatalog: true,
      tools: false,
      order: false,
      dataSent: "user-text-and-fixed-control-catalog",
    },
  };
}

function resultFor(message) {
  switch (message.method) {
    case "runtime.hello": return helloResult();
    case "provider.status": return {
      provider: "openai-chatgpt-siwc-v1", connection: "signed-out", accountResetAvailable: true,
      catalog: "unavailable", selectedModel: null, operation: null,
    };
    case "inventory.summary": return {
      captureCount: 0,
      observationCount: 0,
      lastObservedAt: null,
      coverage: "partial",
      controlEnabled: true,
      layaReady: false,
    };
    case "backend.ensure": return {
      configured: true,
      state: "ready",
      profile: "wts-readonly-v1",
      apiVersion: "selector-readonly-v1",
      catalogVersion,
      ownedChild: true,
    };
    case "source.manifest": return {
      profile: "wts-readonly-v1",
      apiVersion: "selector-readonly-v1",
      catalogVersion,
      operationCount: 264,
    };
    case "source.credentials.status": return {
      profile: "wts-financial-read-v1",
      apiVersion: "selector-financial-read-v1",
      catalogVersion,
      profiles: [],
      mutation: null,
    };
    case "source.query.start": return { job: financialJob("queued", 1) };
    case "source.query.status": return { job: financialJob("cancelled", 2) };
    case "source.search": return {
      schemaVersion: 1,
      kind: "capability-list",
      canvasId: "00000000-0000-4000-8000-000000000001",
      title: "조회 기능 찾기",
      catalogVersion,
      fetchedAt: "2026-10-19T06:00:00.000Z",
      notice: "기능 메타데이터이며 실제 금융 데이터는 조회하지 않았습니다.",
      query: message.params.query,
      items: [],
    };
    case "conversation.route": {
      const prefix = "조회 기능 찾아줘:";
      if (message.params.text.startsWith(prefix)) {
        return {
            submissionId: message.params.submissionId,
            kind: "source-search",
            query: message.params.text.slice(prefix.length).trim(),
          };
      }
      if (message.params.text === "차트 열어줘") {
        return {
          submissionId: message.params.submissionId,
          kind: "wts-control",
          text: message.params.text,
        };
      }
      return {
            submissionId: message.params.submissionId,
            kind: "unsupported",
            message: "지금은 차트 명령, “시장 메뉴 열어줘: 그룹 > 메뉴”, “조회 기능 찾아줘: 검색어”만 지원합니다.",
          };
    }
    default: throw new Error(`unexpected native method: ${message.method}`);
  }
}

function createPort(resolveResult = resultFor) {
  const onMessage = event();
  const onDisconnect = event();
  const posted = [];
  const held = new Map();
  let disconnected = false;

  function respond(message) {
    onMessage.fire({
      protocolVersion: 8,
      requestId: message.requestId,
      method: message.method,
      ok: true,
      result: resolveResult(message),
    });
  }

  return {
    onMessage,
    onDisconnect,
    posted,
    hold(method) { held.set(method, []); },
    release(method) {
      const messages = held.get(method) || [];
      held.delete(method);
      for (const message of messages) respond(message);
    },
    postMessage(message) {
      posted.push(structuredClone(message));
      if (held.has(message.method)) held.get(message.method).push(message);
      else queueMicrotask(() => respond(message));
    },
    disconnect() {
      if (disconnected) return;
      disconnected = true;
      onDisconnect.fire();
    },
    failUnexpectedly() {
      if (disconnected) return;
      disconnected = true;
      onDisconnect.fire();
    },
  };
}

function createProviderPanelPort(documentId, { throwOnPost = false } = {}) {
  const onDisconnect = event();
  const onMessage = event();
  const posted = [];
  return {
    name: "athena-provider-panel-v1",
    sender: { id: extensionId, url: panelUrl, documentId },
    onDisconnect,
    onMessage,
    posted,
    disconnected: false,
    failPost: false,
    postMessage(message) {
      if (throwOnPost || this.failPost) throw new Error("panel closed before response");
      posted.push(structuredClone(message));
    },
    disconnect() { this.disconnected = true; onDisconnect.fire(); },
  };
}

test("staged provider panel accepts the exact trusted Port without an optional documentId", async (t) => {
  const output = await mkdtemp(resolve(tmpdir(), "athena-wts-extension-sw-port-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  execFileSync(process.execPath, [resolve(extensionRoot, "scripts", "build.mjs")], {
    stdio: "pipe", env: { ...process.env, ATHENA_EXTENSION_OUTPUT: output },
  });
  const previousChrome = globalThis.chrome;
  const harness = makeChrome();
  globalThis.chrome = harness.chrome;
  t.after(() => { globalThis.chrome = previousChrome; });
  await import(`${pathToFileURL(resolve(output, "service-worker.mjs")).href}?port-owner=${Date.now()}`);
  const panel = createProviderPanelPort(undefined);
  delete panel.sender.documentId;
  harness.connect(panel);
  assert.equal(panel.disconnected, false);
  assert.equal(panel.posted[0]?.type, "provider.owner");
  const ownerId = panel.posted[0].ownerId;
  const listener = harness.listener();
  assert.equal((await invoke(listener, { type: "panel.connect" })).ok, true);
  const status = await invokePort(panel, { type: "panel.provider.status", ownerId });
  assert.equal(status.ok, true, status.error);
  assert.equal(status.result.connection, "signed-out");
  const submissionId = "00000000-0000-4000-8000-000000000681";
  const chat = await invokePort(panel, { type: "panel.chat.submit", ownerId, submissionId, text: "조회 기능 찾아줘: 종목 정보" });
  assert.equal(chat.ok, true, chat.error);
  assert.equal(chat.result.kind, "source-card");
  assert.equal(chat.result.submissionId, submissionId);
  await new Promise((resolve) => setImmediate(resolve));

  const nativeForLimit = harness.ports[0];
  nativeForLimit.hold("provider.status");
  const waiting = Array.from({ length: 16 }, () => invokePort(panel, { type: "panel.provider.status", ownerId }));
  const overflow = await invokePort(panel, { type: "panel.provider.status", ownerId });
  assert.equal(overflow.ok, false);
  assert.match(overflow.error, /요청이 많습니다/);
  assert.equal(nativeForLimit.posted.filter((message) => message.method === "provider.status").length, 17);
  nativeForLimit.release("provider.status");
  await Promise.all(waiting);

  for (const type of ["panel.provider.status", "panel.provider.connect", "panel.provider.confirm", "panel.chat.submit"]) {
    const denied = await invoke(listener, { type, ownerId, submissionId, text: "차트 열어줘" }, panel.sender);
    assert.equal(denied.ok, false);
    assert.match(denied.error, /소유자/);
  }
  const spoofed = await invokePort(panel, { type: "panel.provider.status", ownerId: crypto.randomUUID() });
  assert.equal(spoofed.ok, false);
  assert.match(spoofed.error, /소유자/);
  const extraOwner = await invokePort(panel, { type: "panel.provider.status", ownerId }, { innerOwner: crypto.randomUUID() });
  assert.equal(extraOwner.ok, false);
  assert.match(extraOwner.error, /형식/);
  const wrongRoute = await invokePort(panel, { type: "panel.connect", ownerId });
  assert.equal(wrongRoute.ok, false);
  assert.match(wrongRoute.error, /형식/);

  const wrongPort = createProviderPanelPort(undefined);
  harness.connect(wrongPort);
  assert.equal(wrongPort.disconnected, true);
  const countBefore = harness.ports[0].posted.length;
  wrongPort.onMessage.fire({ type: "provider.request", requestId: crypto.randomUUID(), ownerId, message: { type: "panel.provider.status" } });
  assert.equal(harness.ports[0].posted.length, countBefore);

  const native = harness.ports[0];
  native.hold("conversation.route");
  const heldRequest = { type: "provider.request", requestId: crypto.randomUUID(), ownerId, message: {
    type: "panel.chat.submit", submissionId: crypto.randomUUID(), text: "조회 기능 찾아줘: 종목 정보",
  } };
  const routesBefore = native.posted.filter((message) => message.method === "conversation.route").length;
  panel.onMessage.fire(heldRequest);
  panel.onMessage.fire(heldRequest);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(native.posted.filter((message) => message.method === "conversation.route").length, routesBefore + 1);
  panel.disconnect();
  const repliesBefore = panel.posted.length;
  const searchesBefore = native.posted.filter((message) => message.method === "source.search").length;
  const nextPanel = createProviderPanelPort(undefined);
  harness.connect(nextPanel);
  assert.equal(nextPanel.posted[0]?.type, "provider.owner");
  panel.onDisconnect.fire();
  panel.onMessage.fire({ type: "provider.request", requestId: crypto.randomUUID(), ownerId, message: { type: "panel.provider.status" } });
  native.release("conversation.route");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(panel.posted.length, repliesBefore);
  assert.equal(native.posted.filter((message) => message.method === "source.search").length, searchesBefore);
  const nextStatus = await invokePort(nextPanel, { type: "panel.provider.status", ownerId: nextPanel.posted[0].ownerId });
  assert.equal(nextStatus.ok, true);
  nextPanel.disconnect();

  for (const sender of [undefined, { id: extensionId, url: "https://wts.kiwoom.com/" }, { id: "foreign", url: panelUrl }]) {
    const untrusted = createProviderPanelPort(undefined);
    untrusted.sender = sender;
    harness.connect(untrusted);
    assert.equal(untrusted.disconnected, true);
    assert.equal(untrusted.posted[0]?.type, "provider.owner.error");
    assert.match(untrusted.posted[0].error, /허용되지 않은/);
  }
});

function makeChrome(sharedStorage = {}, resolveResult = resultFor) {
  const onRuntimeMessage = event();
  const onRuntimeConnect = event();
  const onUpdated = event();
  const onActivated = event();
  const storage = sharedStorage;
  const ports = [];
  const notifications = [];
  return {
    ports,
    notifications,
    storage,
    chrome: {
      runtime: {
        id: extensionId,
        getURL: (path) => `chrome-extension://${extensionId}/${path}`,
        connectNative() {
          const port = createPort(resolveResult);
          ports.push(port);
          return port;
        },
        sendMessage: async (message) => { notifications.push(structuredClone(message)); },
        onMessage: onRuntimeMessage,
        onConnect: onRuntimeConnect,
      },
      sidePanel: { setPanelBehavior: async () => {}, setOptions: async () => {} },
      tabs: {
        onUpdated,
        onActivated,
        query: async () => [],
        get: async () => { throw new Error("not used"); },
      },
      scripting: { executeScript: async () => { throw new Error("not used"); } },
      storage: {
        local: {
          async get(key) {
            if (typeof key === "string") return Object.hasOwn(storage, key) ? { [key]: storage[key] } : {};
            return structuredClone(storage);
          },
          async set(value) { Object.assign(storage, structuredClone(value)); },
          async remove(key) { delete storage[key]; },
        },
      },
    },
    listener() {
      assert.equal(onRuntimeMessage.listeners.length, 1);
      return onRuntimeMessage.listeners[0];
    },
    connect(port) { onRuntimeConnect.fire(port); },
  };
}

function invoke(listener, message, sender = { id: extensionId, url: panelUrl, documentId: "panel-document-1" }) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`panel message timed out: ${message.type}`)), 2_000);
    const keepOpen = listener(message, sender, (response) => {
      clearTimeout(timeout);
      resolve(response);
    });
    assert.equal(keepOpen, true);
  });
}

function invokePort(port, { ownerId, ...message }, { innerOwner } = {}) {
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`provider message timed out: ${message.type}`)), 2_000);
    const original = port.postMessage;
    port.postMessage = function (response) {
      original.call(this, response);
      if (response.type !== "provider.response" || response.requestId !== requestId) return;
      clearTimeout(timeout);
      resolve(response);
    };
    port.onMessage.fire({ type: "provider.request", requestId, ownerId, message: innerOwner ? { ...message, ownerId: innerOwner } : message });
  });
}

test("provider owner notification failure cleans up before a new panel connects", async (t) => {
  const output = await mkdtemp(resolve(tmpdir(), "athena-wts-extension-sw-owner-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  execFileSync(process.execPath, [resolve(extensionRoot, "scripts", "build.mjs")], {
    stdio: "pipe",
    env: { ...process.env, ATHENA_EXTENSION_OUTPUT: output },
  });

  const previousChrome = globalThis.chrome;
  const harness = makeChrome();
  globalThis.chrome = harness.chrome;
  t.after(() => { globalThis.chrome = previousChrome; });
  await import(`${pathToFileURL(resolve(output, "service-worker.mjs")).href}?owner-cleanup=${Date.now()}`);

  const closedPort = createProviderPanelPort("panel-document-closed", { throwOnPost: true });
  harness.connect(closedPort);
  assert.equal(closedPort.disconnected, true);

  const replacementPort = createProviderPanelPort("panel-document-replacement");
  harness.connect(replacementPort);
  assert.equal(replacementPort.disconnected, false);
  assert.equal(replacementPort.posted[0]?.type, "provider.owner");
  const ownerId = replacementPort.posted[0].ownerId;
  replacementPort.failPost = true;
  replacementPort.onMessage.fire({ type: "provider.request", requestId: crypto.randomUUID(), ownerId, message: { type: "panel.provider.status" } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(replacementPort.disconnected, true);
  const finalPort = createProviderPanelPort(undefined);
  harness.connect(finalPort);
  assert.equal(finalPort.posted[0]?.type, "provider.owner");
  replacementPort.onDisconnect.fire();
  const status = await invokePort(finalPort, { type: "panel.provider.status", ownerId: finalPort.posted[0].ownerId });
  assert.equal(status.ok, true);
});

test("staged Port chat delivers provider-pending and terminal while requiring exact stored-proposal confirmation", async (t) => {
  const output = await mkdtemp(resolve(tmpdir(), "athena-wts-extension-sw-provider-chat-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  execFileSync(process.execPath, [resolve(extensionRoot, "scripts", "build.mjs")], {
    stdio: "pipe", env: { ...process.env, ATHENA_EXTENSION_OUTPUT: output },
  });
  const previousChrome = globalThis.chrome;
  let submissionId = null;
  const operation = { operationId: crypto.randomUUID(), kind: "plan", state: "running", revision: 1, cancellable: true, result: null, error: null };
  const harness = makeChrome({}, (message) => {
    if (message.method === "provider.status") return {
      ...resultFor(message), connection: "connected", catalog: "ready", accountResetAvailable: false,
      selectedModel: { slug: "gpt-test", displayName: "GPT Test", compatibility: "untested" },
    };
    if (message.method === "provider.plan.start") { submissionId = message.params.submissionId; return operation; }
    if (message.method === "provider.operation.get") return {
      ...operation, state: "succeeded", revision: 2, cancellable: false,
      result: { submissionId, catalogVersion: "wts-main-control-3", assistantText: "차트 열기를 제안합니다.", proposal: { kind: "wts-control", text: "차트 열어줘" } },
    };
    return resultFor(message);
  });
  globalThis.chrome = harness.chrome;
  t.after(() => { globalThis.chrome = previousChrome; });
  await import(`${pathToFileURL(resolve(output, "service-worker.mjs")).href}?provider-chat=${Date.now()}`);
  const panel = createProviderPanelPort(undefined);
  harness.connect(panel);
  const ownerId = panel.posted[0].ownerId;
  assert.equal((await invoke(harness.listener(), { type: "panel.connect" })).ok, true);
  const providerStatus = await invokePort(panel, { type: "panel.provider.status", ownerId });
  assert.equal(providerStatus.ok, true, providerStatus.error);
  assert.equal(providerStatus.result.connection, "connected");
  const started = await invokePort(panel, { type: "panel.chat.submit", ownerId, submissionId: crypto.randomUUID(), text: "차트 화면을 제안해 줘" });
  assert.equal(started.ok, true, started.error);
  assert.equal(started.result.kind, "provider-pending");
  assert.equal(started.result.operation.operationId, operation.operationId);
  const terminal = await invokePort(panel, { type: "panel.provider.get", ownerId });
  assert.equal(terminal.ok, true, terminal.error);
  assert.equal(terminal.result.terminal.state, "succeeded");
  assert.equal(terminal.result.proposal.commandText, "차트 열어줘");
  const native = harness.ports[0];
  assert.equal(native.posted.some((message) => message.method === "control.task.start"), false);
  const forged = await invokePort(panel, { type: "panel.provider.confirm", ownerId, submissionId, catalogVersion: "wts-main-control-3", text: "주봉으로" });
  assert.equal(forged.ok, false);
  assert.match(forged.error, /형식/);
  panel.disconnect();
  const next = createProviderPanelPort(undefined);
  harness.connect(next);
  const stale = await invokePort(next, { type: "panel.provider.confirm", ownerId: next.posted[0].ownerId, submissionId, catalogVersion: "wts-main-control-3" });
  assert.equal(stale.ok, false);
  assert.match(stale.error, /실행 제안이 없거나/);
  assert.equal(native.posted.some((message) => message.method === "control.task.start"), false);
  next.disconnect();
});

async function waitForMethod(port, method) {
  const deadline = Date.now() + 2_000;
  while (!port.posted.some((message) => message.method === method) && Date.now() < deadline) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(port.posted.some((message) => message.method === method), true, `${method} should be posted`);
}

test("staged service worker enforces trusted source routing, busy exclusion, and disconnect invalidation", async (t) => {
  const output = await mkdtemp(resolve(tmpdir(), "athena-wts-extension-sw-source-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  execFileSync(process.execPath, [resolve(extensionRoot, "scripts", "build.mjs")], {
    stdio: "pipe",
    env: { ...process.env, ATHENA_EXTENSION_OUTPUT: output },
  });

  const previousChrome = globalThis.chrome;
  const harness = makeChrome();
  globalThis.chrome = harness.chrome;
  t.after(() => { globalThis.chrome = previousChrome; });
  await import(`${pathToFileURL(resolve(output, "service-worker.mjs")).href}?source-harness=${Date.now()}`);
  const listener = harness.listener();
  const providerPort = createProviderPanelPort("panel-document-1");
  harness.connect(providerPort);
  assert.equal(providerPort.posted[0]?.type, "provider.owner");
  const ownerId = providerPort.posted[0].ownerId;

  const rejectedPort = createProviderPanelPort("panel-document-2");
  harness.connect(rejectedPort);
  assert.equal(rejectedPort.posted[0]?.type, "provider.owner.error");
  assert.equal(rejectedPort.disconnected, true);

  const rejectedOwnerSubmit = await invoke(listener, {
    type: "panel.chat.submit",
    ownerId,
    submissionId: "00000000-0000-4000-8000-000000000598",
    text: "지원하지 않는 요청",
  }, { id: extensionId, url: panelUrl, documentId: "panel-document-2" });
  assert.equal(rejectedOwnerSubmit.ok, false);
  assert.match(rejectedOwnerSubmit.error, /소유자/);
  assert.equal(harness.ports.length, 0);

  const missingOwnerSubmit = await invoke(listener, {
    type: "panel.chat.submit",
    submissionId: "00000000-0000-4000-8000-000000000597",
    text: "지원하지 않는 요청",
  });
  assert.equal(missingOwnerSubmit.ok, false);
  assert.match(missingOwnerSubmit.error, /소유자/);

  const rejectedOwnerConfirm = await invoke(listener, {
    type: "panel.provider.confirm",
    ownerId,
    submissionId: "00000000-0000-4000-8000-000000000596",
    catalogVersion: "wts-main-control-3",
  }, { id: extensionId, url: panelUrl, documentId: "panel-document-2" });
  assert.equal(rejectedOwnerConfirm.ok, false);
  assert.match(rejectedOwnerConfirm.error, /소유자/);

  const denied = await invoke(
    listener,
    { type: "panel.source.search", query: "종목 정보" },
    { id: "foreign", url: panelUrl },
  );
  assert.equal(denied.ok, false);
  assert.match(denied.error, /허용되지 않은/);
  assert.equal(harness.ports.length, 0);

  const deniedContentScript = await invoke(
    listener,
    { type: "panel.source.search", query: "종목 정보" },
    { id: extensionId, url: "https://wts.kiwoom.com/" },
  );
  assert.equal(deniedContentScript.ok, false);
  assert.match(deniedContentScript.error, /허용되지 않은/);
  assert.equal(harness.ports.length, 0);

  const connected = await invoke(listener, { type: "panel.connect" });
  assert.equal(connected.ok, true, connected.error);
  assert.equal(connected.result.sourceConfigured, true);
  assert.equal(connected.result.controlReady, false);
  assert.match(connected.result.controlBlockedReason, /1회 이상/);
  assert.equal(connected.result.conversationPhase, "idle");
  const port = harness.ports[0];

  const financialStatus = await invoke(listener, { type: "panel.financial.credentials.status", mutationId: null });
  assert.equal(financialStatus.ok, true);
  assert.deepEqual(financialStatus.result.profiles, []);
  assert.equal(port.posted.at(-1).method, "source.credentials.status");

  const deniedFinancial = await invoke(
    listener,
    { type: "panel.financial.credentials.status", mutationId: null },
    { id: extensionId, url: "https://wts.kiwoom.com/" },
  );
  assert.equal(deniedFinancial.ok, false);
  assert.match(deniedFinancial.error, /허용되지 않은/);

  const legacySend = await invoke(listener, { type: "panel.chat.send", text: "차트 열어줘" });
  assert.equal(legacySend.ok, false);
  assert.match(legacySend.error, /지원하지 않는 사이드패널 요청/);
  assert.equal(port.posted.some((message) => message.method === "control.task.start"), false);

  const malformedSubmit = await invokePort(providerPort, {
    type: "panel.chat.submit",
    ownerId,
    submissionId: "00000000-0000-4000-8000-000000000599",
    text: "차트 열어줘",
    selector: "#secret",
  });
  assert.equal(malformedSubmit.ok, false);
  assert.match(malformedSubmit.error, /형식/);
  assert.equal(port.posted.some((message) => message.method === "conversation.route"), false);

  const routeSubmissionId = "00000000-0000-4000-8000-000000000500";
  port.hold("conversation.route");
  const routed = invokePort(providerPort, {
    type: "panel.chat.submit",
    ownerId,
    submissionId: routeSubmissionId,
    text: "차트 열어줘",
  });
  const duplicate = invokePort(providerPort, {
    type: "panel.chat.submit",
    ownerId,
    submissionId: routeSubmissionId,
    text: "차트 열어줘",
  });
  await waitForMethod(port, "conversation.route");
  assert.equal(port.posted.filter((message) => message.method === "conversation.route").length, 1);
  const routingHealth = await invoke(listener, { type: "panel.health" });
  assert.equal(routingHealth.result.conversationRunning, true);
  assert.match(routingHealth.result.controlBlockedReason, /1회 이상/);
  assert.equal(routingHealth.result.conversationRouting, true);
  assert.equal(routingHealth.result.conversationPhase, "routing");
  const stopped = await invoke(listener, { type: "panel.chat.cancel" });
  assert.deepEqual(stopped, { ok: true, result: { task: null } });
  port.release("conversation.route");
  for (const response of await Promise.all([routed, duplicate])) {
    assert.equal(response.ok, false);
    assert.match(response.error, /실행 전에 취소/);
  }
  assert.equal(port.posted.some((message) => message.method === "control.task.start"), false);

  const chartWithoutCapture = await invokePort(providerPort, {
    type: "panel.chat.submit",
    ownerId,
    submissionId: "00000000-0000-4000-8000-000000000502",
    text: "차트 열어줘",
  });
  assert.equal(chartWithoutCapture.ok, false);
  assert.match(chartWithoutCapture.error, /화면 조사 저장/);
  assert.equal(port.posted.some((message) => message.method === "control.task.start"), false);

  const submissionId = "00000000-0000-4000-8000-000000000501";
  const chatSearch = await invokePort(providerPort, {
    type: "panel.chat.submit",
    ownerId,
    submissionId,
    text: "조회 기능 찾아줘: 종목 정보",
  });
  assert.equal(chatSearch.ok, true);
  assert.equal(chatSearch.result.kind, "source-card");
  assert.equal(chatSearch.result.submissionId, submissionId);
  assert.equal(chatSearch.result.card.query, "종목 정보");
  assert.deepEqual(port.posted.slice(-4).map((message) => message.method), [
    "conversation.route",
    "backend.ensure",
    "source.manifest",
    "source.search",
  ]);
  port.hold("source.search");
  const source = invoke(listener, { type: "panel.source.search", query: "종목 정보" });
  await waitForMethod(port, "source.search");

  const healthWhileBusy = await invoke(listener, { type: "panel.health" });
  assert.equal(healthWhileBusy.ok, true);
  assert.equal(healthWhileBusy.result.sourceRunning, true);
  assert.equal(healthWhileBusy.result.sourceConfigured, true);

  const blockedMessages = [
    { type: "panel.connect" },
    { type: "panel.collectAndStore" },
    { type: "panel.discardPending" },
    { type: "panel.summary" },
    { type: "panel.control.execute", command: "차트 열어줘" },
    { type: "panel.control.cancel" },
    { type: "panel.control.retryReceipt" },
    { type: "panel.control.archiveReceipt" },
    { type: "panel.chat.get" },
    { type: "panel.chat.cancel" },
    { type: "panel.source.describe", operationRef: "base:stockinfo", expectedCatalogVersion: catalogVersion },
  ];
  for (const message of blockedMessages) {
    const response = await invoke(listener, message);
    assert.equal(response.ok, false, `${message.type} must be blocked`);
    assert.match(response.error, /조회 기능 요청/, message.type);
  }

  const disconnected = await invoke(listener, { type: "panel.disconnect" });
  assert.equal(disconnected.ok, true);
  assert.equal(disconnected.result.connected, false);
  const cancelledSource = await source;
  assert.equal(cancelledSource.ok, false);
  assert.match(cancelledSource.error, /연결이 종료/);
  const healthAfterDisconnect = await invoke(listener, { type: "panel.health" });
  assert.equal(healthAfterDisconnect.result.sourceRunning, false);
  assert.equal(healthAfterDisconnect.result.sourceConfigured, false);

  const reconnected = await invoke(listener, { type: "panel.connect" });
  assert.equal(reconnected.ok, true);
  assert.equal(reconnected.result.sourceConfigured, true);
  const secondPort = harness.ports[1];
  secondPort.failUnexpectedly();
  await new Promise((resolve) => setImmediate(resolve));
  const healthAfterFailure = await invoke(listener, { type: "panel.health" });
  assert.equal(healthAfterFailure.result.connected, false);
  assert.equal(healthAfterFailure.result.sourceRunning, false);
  assert.equal(healthAfterFailure.result.sourceConfigured, false);
  assert.equal(harness.notifications.some((message) => (
    message.type === "native.status" && message.status.connected === false
  )), true);
  providerPort.disconnect();
  const staleOwnerSubmit = await invoke(listener, {
    type: "panel.chat.submit",
    ownerId,
    submissionId: "00000000-0000-4000-8000-000000000595",
    text: "지원하지 않는 요청",
  });
  assert.equal(staleOwnerSubmit.ok, false);
  assert.match(staleOwnerSubmit.error, /소유자/);
});

test("service-worker restart reconciles one journaled query status without replaying start", async (t) => {
  const output = await mkdtemp(resolve(tmpdir(), "athena-wts-extension-sw-financial-"));
  t.after(() => rm(output, { recursive: true, force: true }));
  execFileSync(process.execPath, [resolve(extensionRoot, "scripts", "build.mjs")], {
    stdio: "pipe", env: { ...process.env, ATHENA_EXTENSION_OUTPUT: output },
  });
  const previousChrome = globalThis.chrome;
  t.after(() => { globalThis.chrome = previousChrome; });
  const storage = {};

  const first = makeChrome(storage);
  globalThis.chrome = first.chrome;
  await import(`${pathToFileURL(resolve(output, "service-worker.mjs")).href}?financial-first=${Date.now()}`);
  const firstListener = first.listener();
  assert.equal((await invoke(firstListener, { type: "panel.connect" })).ok, true);
  const started = await invoke(firstListener, {
    type: "panel.financial.query.start",
    params: {
      submissionId: financialSubmissionId,
      profileId: financialProfileId,
      operationRef: "base:stockinfo",
      arguments: { stk_cd: "005930" },
    },
  });
  assert.equal(started.ok, true, started.error);
  assert.equal(storage.wtsFinancialJournalV1.pendingJob.jobId, financialJobId);
  assert.doesNotMatch(JSON.stringify(storage.wtsFinancialJournalV1), /005930/);

  const second = makeChrome(storage);
  globalThis.chrome = second.chrome;
  await import(`${pathToFileURL(resolve(output, "service-worker.mjs")).href}?financial-second=${Date.now()}`);
  const reconnected = await invoke(second.listener(), { type: "panel.connect" });
  assert.equal(reconnected.ok, true, `${reconnected.error}\n${JSON.stringify(second.ports.map((port) => port.posted))}\n${JSON.stringify(second.notifications)}`);
  assert.equal(reconnected.result.financial.job.state, "cancelled");
  const financialCalls = second.ports[0].posted.filter((message) => message.method.startsWith("source.query."));
  assert.deepEqual(financialCalls.map((message) => message.method), ["source.query.status"]);
  assert.equal(storage.wtsFinancialJournalV1.pendingJob, null);
});
