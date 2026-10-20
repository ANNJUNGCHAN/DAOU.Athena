export function byteLength(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export function createNativeClient({
  connectNative,
  validateRequest,
  validateResponse,
  maxMessageBytes,
  timeoutMs = 8_000,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  getLastError = () => globalThis.chrome?.runtime?.lastError?.message || null,
  onStatusChange = () => {},
}) {
  const normalizeTimeout = (value) => {
    if (!Number.isInteger(value) || value < 100 || value > 60_000) {
      throw new RangeError("로컬 실행기 제한 시간은 100~60000ms여야 합니다.");
    }
    return value;
  };
  const defaultTimeoutMs = normalizeTimeout(timeoutMs);
  let port = null;
  let lastDisconnectError = null;
  const pending = new Map();

  const rejectPending = (message) => {
    for (const { reject, timer } of pending.values()) {
      clearTimer(timer);
      reject(new Error(message));
    }
    pending.clear();
  };

  const disconnect = () => {
    const active = port;
    port = null;
    if (active) active.disconnect();
    rejectPending("로컬 실행기 연결이 종료되었습니다.");
    onStatusChange({ connected: false, error: lastDisconnectError });
  };

  const connect = (hostName) => {
    if (port) return;
    lastDisconnectError = null;
    const nextPort = connectNative(hostName);
    port = nextPort;
    onStatusChange({ connected: true, error: null });
    nextPort.onMessage.addListener((message) => {
      try {
        const response = validateResponse(message);
        const entry = pending.get(response.requestId);
        if (!entry) return;
        if (response.method !== entry.method) {
          throw new Error("로컬 실행기 응답 메서드가 요청과 일치하지 않습니다.");
        }
        pending.delete(response.requestId);
        clearTimer(entry.timer);
        entry.resolve(response);
      } catch (error) {
        lastDisconnectError = error instanceof Error ? error.message : String(error);
        disconnect();
      }
    });
    nextPort.onDisconnect.addListener(() => {
      if (port !== nextPort) return;
      port = null;
      lastDisconnectError = getLastError() || "로컬 실행기 연결이 종료되었습니다.";
      rejectPending(lastDisconnectError);
      onStatusChange({ connected: false, error: lastDisconnectError });
    });
  };

  const request = (input, options = {}) => {
    if (!port) return Promise.reject(new Error("로컬 실행기에 연결되어 있지 않습니다."));
    if (!options || typeof options !== "object" || Array.isArray(options)) {
      return Promise.reject(new TypeError("로컬 실행기 요청 옵션이 올바르지 않습니다."));
    }
    const optionKeys = Object.keys(options);
    if (optionKeys.some((key) => key !== "timeoutMs")) {
      return Promise.reject(new TypeError("지원하지 않는 로컬 실행기 요청 옵션입니다."));
    }
    let requestTimeoutMs;
    try {
      requestTimeoutMs = options.timeoutMs === undefined
        ? defaultTimeoutMs
        : normalizeTimeout(options.timeoutMs);
    } catch (error) {
      return Promise.reject(error);
    }
    const message = validateRequest(input);
    if (byteLength(message) > maxMessageBytes) {
      return Promise.reject(new Error("로컬 실행기 요청 크기 제한을 초과했습니다."));
    }
    if (pending.has(message.requestId)) {
      return Promise.reject(new Error("중복 요청 ID입니다."));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimer(() => {
        pending.delete(message.requestId);
        reject(new Error("로컬 실행기 응답 시간이 초과되었습니다. 요청은 자동 재시도하지 않습니다."));
      }, requestTimeoutMs);
      pending.set(message.requestId, { resolve, reject, timer, method: message.method });
      try {
        port.postMessage(message);
      } catch (error) {
        pending.delete(message.requestId);
        clearTimer(timer);
        reject(error);
      }
    });
  };

  return {
    connect,
    disconnect,
    request,
    status: () => ({ connected: Boolean(port), error: lastDisconnectError }),
  };
}
