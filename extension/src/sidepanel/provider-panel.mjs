const TERMINAL = new Set(["succeeded", "failed", "cancelled"]);
const CONTROL_KINDS = new Set(["connect", "models", "disconnect", "account-reset"]);
const KIND_LABEL = Object.freeze({ connect: "연결", models: "모델 목록", plan: "응답 생성", disconnect: "연결 해제", "account-reset": "계정 연결 초기화" });
const STATE_LABEL = Object.freeze({ running: "진행 중", cancelling: "취소 중", succeeded: "완료", failed: "실패", cancelled: "취소됨" });
const OWNER_FAILURE = Object.freeze({
  "다른 ChatGPT 패널이 이미 연결되어 있습니다.": "duplicate-panel",
  "ChatGPT 패널 문서 식별자를 확인할 수 없습니다.": "missing-document",
  "허용되지 않은 확장 프로그램 발신자입니다.": "untrusted-panel",
  "지원하지 않는 패널 연결입니다.": "untrusted-panel",
  "ChatGPT 패널 소유자 식별자가 올바르지 않습니다.": "untrusted-panel",
});
const OWNER_FAILURE_COPY = Object.freeze({
  "duplicate-panel": Object.freeze({ status: "다른 패널 연결 중", operation: "다른 ATHENA 패널이 이미 ChatGPT 연결을 사용 중입니다. 다른 ATHENA 패널을 닫고 이 패널을 다시 열어 주세요." }),
  "missing-document": Object.freeze({ status: "패널 식별 실패", operation: "ChatGPT 패널 문서 식별자를 확인하지 못했습니다. 확장 프로그램을 다시 로드한 뒤 패널을 다시 열어 주세요." }),
  "untrusted-panel": Object.freeze({ status: "패널 연결 차단", operation: "신뢰할 수 없는 ChatGPT 패널 연결 요청이 차단되었습니다. 확장 프로그램을 다시 로드한 뒤 패널을 다시 열어 주세요." }),
});

export function createProviderPanelController({ runtime, elements, onPlanTerminal, onControlResult, onBusyChange = () => {}, onPortDisconnect = () => {}, pollMs = 500, requestTimeoutMs = 30_000 }) {
  let ownerId = null;
  let nativeConnected = false;
  let state = null;
  let timer = null;
  let trackedSubmissionId = null;
  let busy = false;
  let lastTerminal = null;
  let nativeGeneration = 0;
  let ownerFailure = null;
  let ownerPortDisconnected = false;
  let refreshingStatus = false;
  const pendingRequests = new Map();

  const setBusy = (value) => {
    if (busy === value) return;
    busy = value;
    onBusyChange(value);
  };
  const stopPolling = () => { if (timer !== null) clearTimeout(timer); timer = null; };
  const rejectPending = (message) => {
    for (const pending of pendingRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
    }
    pendingRequests.clear();
  };
  const request = (type, payload = {}) => {
    if (!ownerId || ownerPortDisconnected) return Promise.reject(new Error("ChatGPT 패널 연결이 준비되지 않았습니다."));
    if (!nativeConnected) return Promise.reject(new Error("먼저 로컬 실행기에 연결해 주세요."));
    if (pendingRequests.size >= 16) return Promise.reject(new Error("ChatGPT 패널 요청이 많습니다. 진행 중인 요청이 끝난 뒤 다시 시도해 주세요."));
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const pending = {
        resolve, reject, generation: nativeGeneration,
        timer: setTimeout(() => {
          if (!pendingRequests.delete(requestId)) return;
          reject(new Error("ChatGPT 패널 응답을 확인하지 못했습니다. 자동으로 다시 실행하지 않습니다."));
        }, requestTimeoutMs),
      };
      pendingRequests.set(requestId, pending);
      try { port.postMessage({ type: "provider.request", requestId, ownerId, message: { ...payload, type } }); }
      catch { disconnectOwner(); try { port.disconnect(); } catch {} }
    });
  };
  const isCurrent = (generation) => generation === nativeGeneration && nativeConnected && Boolean(ownerId) && !ownerPortDisconnected;
  const runRequest = (type, payload, onResult) => {
    const generation = nativeGeneration;
    return request(type, payload).then((result) => {
      if (isCurrent(generation)) onResult(result);
    }).catch((error) => {
      if (isCurrent(generation)) {
        render();
        elements.operation.textContent = error.message;
      }
    });
  };

  function disconnectOwner() {
    if (ownerPortDisconnected) return;
    ownerPortDisconnected = true;
    ownerId = null;
    nativeGeneration += 1;
    state = null;
    trackedSubmissionId = null;
    clearLastTerminal();
    stopPolling();
    rejectPending("ChatGPT 패널 연결이 끊어졌습니다. 패널을 다시 열어 주세요.");
    render();
    onPortDisconnect();
  }
  const clearLastTerminal = () => { lastTerminal = null; };
  const rememberTerminal = (terminal) => {
    if (!terminal || !CONTROL_KINDS.has(terminal.kind) || !TERMINAL.has(terminal.state)) return;
    lastTerminal = {
      kind: terminal.kind,
      state: terminal.state,
      message: typeof terminal.error?.message === "string" ? terminal.error.message : null,
    };
  };
  const terminalText = () => {
    if (!lastTerminal) return null;
    const prefix = `ChatGPT ${KIND_LABEL[lastTerminal.kind] || "작업"} ${STATE_LABEL[lastTerminal.state] || "완료"}`;
    return lastTerminal.message ? `${prefix}: ${lastTerminal.message}` : prefix;
  };

  function render() {
    const connected = state?.connection === "connected";
    const operation = state?.operation || null;
    const proposal = state?.proposal || null;
    elements.status.textContent = !nativeConnected
      ? "로컬 실행기 연결 안 됨"
      : ownerFailure
        ? OWNER_FAILURE_COPY[ownerFailure].status
        : !ownerId
          ? ownerPortDisconnected ? "패널 연결 끊김" : "패널 연결 대기 중"
          : connected ? "연결됨" : state?.connection === "signed-out" ? "연결 안 됨" : "상태 확인 중";
    elements.operation.textContent = !nativeConnected
      ? "로컬 실행기에 연결해 주세요."
      : ownerFailure
        ? OWNER_FAILURE_COPY[ownerFailure].operation
        : !ownerId
          ? ownerPortDisconnected ? "ChatGPT 패널 연결이 끊어졌습니다. 패널을 다시 열어 주세요." : "ChatGPT 패널 연결을 준비하는 중입니다."
          : operation
            ? `ChatGPT ${KIND_LABEL[operation.kind] || "작업"} ${STATE_LABEL[operation.state] || "상태 확인 중"}`
            : terminalText() || (connected ? (state?.selectedModel ? `선택 모델: ${state.selectedModel.displayName}` : "모델을 선택해 주세요.") : state ? "ChatGPT를 연결해 주세요." : "ChatGPT 연결 상태를 확인하는 중입니다.");
    elements.connect.disabled = !nativeConnected || !ownerId || state?.connection !== "signed-out" || Boolean(operation);
    elements.disconnect.disabled = !nativeConnected || !ownerId || !connected || Boolean(operation);
    elements.reset.disabled = !nativeConnected || !ownerId || state?.connection !== "signed-out" || Boolean(operation);
    elements.models.disabled = !nativeConnected || !ownerId || !connected || Boolean(operation);
    elements.refresh.disabled = !nativeConnected || !ownerId || Boolean(operation || proposal) || refreshingStatus;
    elements.cancel.disabled = !operation?.cancellable || TERMINAL.has(operation.state);
    elements.model.disabled = !connected || state?.catalog !== "ready" || Boolean(operation);
    const selected = state?.selectedModel?.slug || "";
    const previousOptions = Array.from(elements.model.options).map((option) => option.value).filter(Boolean).join("\n");
    const nextModels = Array.isArray(state?.models) ? state.models : [];
    const nextOptions = nextModels.map((item) => item.slug).join("\n");
    if (previousOptions !== nextOptions) {
      elements.model.replaceChildren();
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = nextModels.length ? "모델을 선택해 주세요" : "모델 목록을 불러와 주세요";
      elements.model.append(placeholder);
      for (const model of nextModels) {
        const option = document.createElement("option");
        option.value = model.slug;
        option.textContent = model.displayName;
        elements.model.append(option);
      }
    }
    elements.model.value = selected;
    elements.proposal.hidden = !proposal;
    elements.assistant.textContent = proposal?.assistantText || "";
    elements.command.textContent = proposal?.commandText || "";
    elements.execute.disabled = !proposal;
    elements.reject.disabled = !proposal;
    setBusy(Boolean(operation || proposal));
  }

  async function refresh() {
    if (!nativeConnected || !ownerId) return;
    const expectedGeneration = nativeGeneration;
    const next = await request("panel.provider.status");
    if (!isCurrent(expectedGeneration)) return;
    state = next;
    render();
    if (state.operation) schedulePoll();
  }

  function schedulePoll() {
    stopPolling();
    timer = setTimeout(() => { void poll(); }, pollMs);
  }

  async function poll() {
    timer = null;
    const expectedGeneration = nativeGeneration;
    try {
      const next = await request("panel.provider.get");
      if (!isCurrent(expectedGeneration)) return;
      state = next;
      rememberTerminal(state.terminal);
      render();
      if (state.operation) {
        schedulePoll();
        return;
      }
      if (state.terminal?.kind === "plan") {
        onPlanTerminal({ submissionId: trackedSubmissionId, terminal: state.terminal, proposal: state.proposal });
        trackedSubmissionId = null;
      }
    } catch (error) {
      if (!isCurrent(expectedGeneration)) return;
      elements.operation.textContent = error.message;
      setBusy(false);
    }
  }

  function start(type) {
    clearLastTerminal();
    render();
    return runRequest(type, {}, (next) => {
      state = next;
      render();
      schedulePoll();
    });
  }

  elements.connect.addEventListener("click", () => void start("panel.provider.connect"));
  elements.models.addEventListener("click", () => void start("panel.provider.models"));
  elements.refresh.addEventListener("click", () => {
    if (!nativeConnected || !ownerId || state?.operation || state?.proposal || refreshingStatus) return;
    refreshingStatus = true;
    render();
    void refreshSafely().finally(() => {
      refreshingStatus = false;
      elements.refresh.disabled = !nativeConnected || !ownerId || Boolean(state?.operation || state?.proposal);
    });
  });
  elements.disconnect.addEventListener("click", () => void start("panel.provider.disconnect"));
  elements.reset.addEventListener("click", () => void start("panel.provider.reset"));
  elements.cancel.addEventListener("click", () => {
    clearLastTerminal();
    render();
    void runRequest("panel.provider.cancel", {}, (next) => {
      state = next;
      render();
      schedulePoll();
    });
  });
  elements.model.addEventListener("change", () => {
    const slug = elements.model.value;
    if (!slug) return;
    clearLastTerminal();
    render();
    void runRequest("panel.provider.select", { slug }, (next) => {
      state = next;
      render();
    });
  });
  elements.execute.addEventListener("click", () => {
    const proposal = state?.proposal;
    if (!proposal) return;
    elements.execute.disabled = true;
    elements.reject.disabled = true;
    void runRequest("panel.provider.confirm", { submissionId: proposal.submissionId, catalogVersion: proposal.catalogVersion },
      (result) => { state = { ...state, proposal: null }; render(); onControlResult(result); });
  });
  elements.reject.addEventListener("click", () => {
    const proposal = state?.proposal;
    if (!proposal) return;
    void runRequest("panel.provider.reject", { submissionId: proposal.submissionId, catalogVersion: proposal.catalogVersion },
      (next) => { state = next; render(); });
  });

  const port = runtime.connect({ name: "athena-provider-panel-v1" });
  port.onMessage.addListener((message) => {
    if (ownerPortDisconnected) return;
    if (message?.type === "provider.response") {
      const pending = pendingRequests.get(message.requestId);
      if (!pending || pending.generation !== nativeGeneration) return;
      pendingRequests.delete(message.requestId);
      clearTimeout(pending.timer);
      if (message.ok === true) pending.resolve(message.result);
      else {
        const error = new Error(message.error || "ChatGPT 패널 요청에 실패했습니다.");
        if (typeof message.errorCode === "string") error.code = message.errorCode;
        pending.reject(error);
      }
      return;
    }
    if (message?.type === "provider.owner" && typeof message.ownerId === "string") {
      if (ownerId) return;
      ownerId = message.ownerId;
      ownerFailure = null;
      ownerPortDisconnected = false;
      render();
      if (nativeConnected) void refreshSafely();
    }
    if (message?.type === "provider.owner.error") {
      ownerFailure = OWNER_FAILURE[message.error] || "untrusted-panel";
      disconnectOwner();
    }
  });
  port.onDisconnect.addListener(disconnectOwner);

  async function refreshSafely() {
    const generation = nativeGeneration;
    try { await refresh(); } catch (error) {
      if (isCurrent(generation)) elements.operation.textContent = terminalText() || error.message;
    }
  }

  render();
  return Object.freeze({
    applyNativeConnection(connected) {
      const nextConnected = connected === true;
      if (nextConnected !== nativeConnected) nativeGeneration += 1;
      nativeConnected = nextConnected;
      if (!nativeConnected) {
        state = null; trackedSubmissionId = null; clearLastTerminal(); stopPolling();
        rejectPending("로컬 실행기 연결이 끊어졌습니다.");
      }
      render();
      if (nativeConnected && ownerId) void refreshSafely();
    },
    trackOperation(result) {
      if (!nativeConnected || !ownerId || ownerPortDisconnected) return;
      trackedSubmissionId = result.submissionId;
      state = { ...(state || {}), operation: result.operation, proposal: null };
      render();
      schedulePoll();
    },
    snapshot: () => ({ ownerId, nativeConnected, state, busy }),
    request,
  });
}
