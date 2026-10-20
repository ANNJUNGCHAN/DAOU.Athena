import { reasonError } from "./control-core.mjs";

const WTS_ORIGIN = "https://wts.kiwoom.com";

export function createControlBrowserBridge({
  tabs,
  scripting,
  runChartAdapter,
  runMarketNavigationAdapter,
  validateControlObservation,
  chartOpenActionId,
  periodSetActionId,
  sitemapOpenActionId,
  marketNavigateActionId,
  marketMenuTargets,
  createId = () => crypto.randomUUID(),
  now = () => new Date().toISOString(),
  nowMs = Date.now,
}) {
  const actionRegistry = new Map([
    [chartOpenActionId, { adapter: runChartAdapter, catalog: null }],
    [periodSetActionId, { adapter: runChartAdapter, catalog: null }],
    [sitemapOpenActionId, { adapter: runMarketNavigationAdapter, catalog: marketMenuTargets }],
    [marketNavigateActionId, { adapter: runMarketNavigationAdapter, catalog: marketMenuTargets }],
  ]);

  function actionAdapter(action) {
    if (
      !action
      || typeof action !== "object"
      || Array.isArray(action)
      || Object.keys(action).length !== 2
      || typeof action.actionId !== "string"
      || !action.args
      || typeof action.args !== "object"
      || Array.isArray(action.args)
    ) {
      throw new Error("관찰할 WTS 동작 형식이 올바르지 않습니다.");
    }
    const entry = actionRegistry.get(action.actionId);
    if (!entry || typeof entry.adapter !== "function") {
      throw new Error("허용되지 않은 WTS 동작은 화면에 주입하지 않습니다.");
    }
    if (
      (action.actionId === chartOpenActionId && Object.keys(action.args).length !== 0)
      || (
        action.actionId === periodSetActionId
        && (
          Object.keys(action.args).length !== 1
          || !["day", "week", "month", "year"].includes(action.args.period)
        )
      )
    ) {
      throw new Error("고정 차트 동작 인자와 일치하지 않는 동작은 화면에 주입하지 않습니다.");
    }
    if (entry.catalog) {
      const target = entry.catalog.find((item) => item.id === action.args.targetId);
      if (
        Object.keys(action.args).length !== 1
        || !target
      ) {
        throw new Error("고정 시장 메뉴 대상과 일치하지 않는 동작은 화면에 주입하지 않습니다.");
      }
    }
    return entry;
  }

  function parseControlUrl(value) {
    const url = new URL(value);
    if (url.origin !== WTS_ORIGIN || url.pathname !== "/" || url.search || url.hash) {
      throw new Error("WTS 화면 제어는 메인 화면에서만 사용할 수 있습니다.");
    }
    return url;
  }

  function assertControlTab(tab, expectedSource = null) {
    parseControlUrl(tab?.url || "");
    if (!Number.isInteger(tab?.id) || !Number.isInteger(tab?.windowId)) {
      throw new Error("제어할 활성 WTS 탭을 찾지 못했습니다.");
    }
    if (expectedSource && (
      tab.id !== expectedSource.tabId
      || tab.windowId !== expectedSource.windowId
    )) {
      throw reasonError("DOCUMENT_CHANGED", "활성 WTS 탭 또는 창이 바뀌었습니다.");
    }
  }

  async function activeTab(expectedSource = null) {
    const [tab] = await tabs.query({ active: true, currentWindow: true });
    assertControlTab(tab, expectedSource);
    return tab;
  }

  function buildObservation(tab, injection, capturedAt) {
    if (
      injection?.frameId !== 0
      || typeof injection.documentId !== "string"
      || !injection.documentId
      || !injection.result?.state
    ) {
      throw reasonError("DOCUMENT_CHANGED", "WTS 메인 문서를 정확히 확인하지 못했습니다.");
    }
    return validateControlObservation({
      id: createId(),
      capturedAt,
      source: {
        origin: WTS_ORIGIN,
        path: "/",
        tabId: tab.id,
        windowId: tab.windowId,
        frameId: 0,
        documentId: injection.documentId,
      },
      state: injection.result.state,
    });
  }

  async function inject({ tab, documentId = null, adapter, input }) {
    const target = documentId
      ? { tabId: tab.id, documentIds: [documentId] }
      : { tabId: tab.id, frameIds: [0] };
    let injections;
    try {
      injections = await scripting.executeScript({
        target,
        func: adapter,
        args: [input],
        world: "ISOLATED",
      });
    } catch (error) {
      if (documentId) {
        const changed = reasonError("DOCUMENT_CHANGED", "WTS 문서가 실행 중에 바뀌었습니다.");
        changed.actionMayHaveRun = input.mode === "execute";
        throw changed;
      }
      throw error;
    }
    if (injections.length !== 1) {
      throw reasonError("DOCUMENT_CHANGED", "WTS 메인 문서를 유일하게 확인하지 못했습니다.");
    }
    const [injection] = injections;
    if (documentId && injection.documentId !== documentId) {
      throw reasonError("DOCUMENT_CHANGED", "WTS 문서 식별자가 실행 전후에 달라졌습니다.");
    }
    return injection;
  }

  async function observeWith({ adapter, input, expectedSource = null }) {
    const tab = await activeTab(expectedSource);
    const capturedAt = now();
    const injection = await inject({
      tab,
      documentId: expectedSource?.documentId || null,
      adapter,
      input,
    });
    const rebound = await activeTab(expectedSource || {
      tabId: tab.id,
      windowId: tab.windowId,
    });
    if (rebound.id !== tab.id || rebound.windowId !== tab.windowId || rebound.url !== tab.url) {
      throw reasonError("DOCUMENT_CHANGED", "WTS 탭이 관찰 중에 바뀌었습니다.");
    }
    return buildObservation(tab, injection, capturedAt);
  }

  async function observeAction(action, expectedSource = null) {
    const entry = actionAdapter(action);
    return observeWith({
      adapter: entry.adapter,
      expectedSource,
      input: {
        mode: "observe",
        actionId: action.actionId,
        args: action.args,
        ...(entry.catalog ? { catalog: entry.catalog } : {}),
      },
    });
  }

  async function observeChart(expectedSource = null) {
    return observeWith({
      adapter: runChartAdapter,
      expectedSource,
      input: { mode: "observe" },
    });
  }

  async function executeOnce(proposal) {
    const entry = actionAdapter({ actionId: proposal.actionId, args: proposal.args });
    const source = proposal.observation.source;
    const tab = await activeTab(source);
    if (Date.parse(proposal.expiresAt) <= nowMs()) {
      throw new Error("실행 직전에 제안이 만료되었습니다.");
    }
    const capturedAt = now();
    const injection = await inject({
      tab,
      documentId: source.documentId,
      adapter: entry.adapter,
      input: {
        mode: "execute",
        expectedState: proposal.observation.state,
        actionId: proposal.actionId,
        args: proposal.args,
        ...(entry.catalog ? { catalog: entry.catalog } : {}),
      },
    });
    let rebound;
    try {
      rebound = await activeTab(source);
    } catch (error) {
      error.actionMayHaveRun = injection.result.acted === true;
      throw error;
    }
    if (rebound.url !== tab.url) {
      const changed = reasonError("DOCUMENT_CHANGED", "WTS 탭이 실행 중에 바뀌었습니다.");
      changed.actionMayHaveRun = injection.result.acted === true;
      throw changed;
    }
    return {
      observation: buildObservation(tab, injection, capturedAt),
      acted: injection.result.acted,
      reason: injection.result.reason,
    };
  }

  return Object.freeze({
    observeCurrent: (action) => observeAction(action),
    observeSameDocument: (source, action) => observeAction(action, source),
    executeOnce,
    chart: Object.freeze({
      observeCurrent: () => observeChart(),
      observeSameDocument: (source) => observeChart(source),
    }),
  });
}
