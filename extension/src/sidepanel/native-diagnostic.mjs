export const NATIVE_DIAGNOSTIC_BUILD = "nm-diag-1";

function readRuntimeIdentity(runtime) {
  let version = "알 수 없음";
  try {
    const manifest = runtime?.getManifest?.();
    if (typeof manifest?.version === "string" && manifest.version.length > 0) version = manifest.version;
  } catch {}

  return {
    extensionId: typeof runtime?.id === "string" && runtime.id.length > 0 ? runtime.id : "알 수 없음",
    version,
  };
}

function defaultAttemptId() {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    const bytes = new Uint32Array(4);
    globalThis.crypto.getRandomValues(bytes);
    return [...bytes].map((value) => value.toString(16).padStart(8, "0")).join("");
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createNativeDiagnostic({
  runtime,
  hostName,
  now = () => new Date(),
  createAttemptId = defaultAttemptId,
}) {
  const identity = readRuntimeIdentity(runtime);
  let state = {
    build: NATIVE_DIAGNOSTIC_BUILD,
    ...identity,
    hostName,
    attempted: false,
    attemptId: null,
    attemptedAt: null,
    route: null,
    status: "idle",
    error: null,
    detail: null,
  };

  return Object.freeze({
    beginAttempt(route = "service-worker") {
      state = {
        ...state,
        attempted: true,
        attemptId: createAttemptId(),
        attemptedAt: now().toISOString(),
        route,
        status: "running",
        error: null,
        detail: null,
      };
      return { ...state };
    },
    succeed(expectedAttemptId, detail = "연결됨") {
      if (state.attemptId !== expectedAttemptId) return { ...state };
      state = { ...state, status: "connected", error: null, detail };
      return { ...state };
    },
    fail(expectedAttemptId, error) {
      if (state.attemptId !== expectedAttemptId) return { ...state };
      state = { ...state, status: "failed", error: String(error), detail: null };
      return { ...state };
    },
    snapshot() {
      return { ...state };
    },
  });
}

export function formatNativeDiagnostic(state) {
  const result = state.status === "idle"
    ? "시도 전"
    : state.status === "running"
      ? "연결 중"
      : state.status === "connected"
        ? state.detail
        : `실패: ${state.error}`;
  return [
    `빌드: ${state.build}`,
    `확장 ID: ${state.extensionId}`,
    `버전: ${state.version}`,
    `요청 호스트: ${state.hostName}`,
    `연결 시도: ${state.attempted ? "예" : "아니요"}`,
    `경로: ${state.route ?? "—"}`,
    `시도 ID: ${state.attemptId ?? "—"}`,
    `시각: ${state.attemptedAt ?? "—"}`,
    `결과: ${result}`,
  ].join("\n");
}

export function mountNativeDiagnostic(document, parent) {
  const details = document.createElement("details");
  details.open = true;
  const summary = document.createElement("summary");
  summary.textContent = "Native Messaging 진단";
  const output = document.createElement("pre");
  output.id = "native-diagnostic";
  output.style.whiteSpace = "pre-wrap";
  output.style.overflowWrap = "anywhere";
  output.style.fontSize = "11px";
  output.style.lineHeight = "1.55";
  output.style.color = "#aab8ca";
  const probeButton = document.createElement("button");
  probeButton.type = "button";
  probeButton.textContent = "직접 연결 진단";
  probeButton.style.width = "100%";
  probeButton.style.marginTop = "8px";
  details.append(summary, output, probeButton);
  parent.append(details);
  return { output, probeButton };
}

export async function runDirectNativeProbe({ client, hostName, protocolVersion, requestId }) {
  try {
    client.connect(hostName);
    const response = await client.request({
      protocolVersion,
      requestId,
      method: "runtime.hello",
      params: {},
    });
    if (!response.ok) throw new Error(response.error?.message || "로컬 실행기 hello 요청에 실패했습니다.");
    return response.result;
  } finally {
    client.disconnect();
  }
}
