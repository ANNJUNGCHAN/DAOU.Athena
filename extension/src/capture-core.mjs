const WTS_ORIGIN = "https://wts.kiwoom.com";

function exactUrl(value) {
  const url = new URL(value);
  if (url.origin !== WTS_ORIGIN) throw new Error("현재 탭이 키움 WTS가 아닙니다.");
  return url.href;
}

export function assertStableTab(expected, actual) {
  if (
    !Number.isInteger(expected?.id)
    || !Number.isInteger(expected?.windowId)
    || expected.id !== actual?.id
    || expected.windowId !== actual?.windowId
    || exactUrl(expected.url) !== exactUrl(actual?.url)
  ) {
    throw new Error("조사 중 WTS 탭이 변경되어 결과를 저장하지 않았습니다.");
  }
}

export function buildCapture({
  tab,
  reboundTab,
  injections,
  capturedAt,
  createId,
  validateObservation,
  maxObservations = 16,
  maxCaptureBytes = 130_048,
  measureBytes = (value) => new TextEncoder().encode(JSON.stringify(value)).byteLength,
}) {
  assertStableTab(tab, reboundTab);
  if (!Array.isArray(injections) || injections.length === 0) {
    throw new Error("WTS 프레임 조사 결과가 없습니다.");
  }

  const accepted = [];
  for (const injection of injections) {
    const result = injection?.result;
    if (result?.excluded === true) continue;
    if (
      !result
      || !Number.isInteger(injection.frameId)
      || typeof injection.documentId !== "string"
      || injection.documentId.length === 0
      || result.source?.origin !== WTS_ORIGIN
    ) {
      throw new Error("WTS 프레임 조사 결과가 불완전하여 캡처를 저장하지 않았습니다.");
    }
    const observation = {
      id: createId(),
      capturedAt,
      source: {
        origin: WTS_ORIGIN,
        path: result.source.path,
        tabId: tab.id,
        windowId: tab.windowId,
        frameId: injection.frameId,
        documentId: injection.documentId,
      },
      title: result.title,
      headings: result.headings,
      controls: result.controls,
      frames: result.frames,
      canvasCount: result.canvasCount,
      truncated: Boolean(result.truncated),
    };
    accepted.push(validateObservation(observation));
  }

  accepted.sort((left, right) => left.source.frameId - right.source.frameId);
  const mainFrames = accepted.filter((item) => item.source.frameId === 0);
  if (mainFrames.length !== 1) {
    throw new Error("WTS 메인 프레임을 유일하게 확인하지 못해 캡처를 저장하지 않았습니다.");
  }
  const identities = new Set();
  const frameIds = new Set();
  for (const observation of accepted) {
    const identity = [
      observation.source.tabId,
      observation.source.windowId,
      observation.source.frameId,
      observation.source.documentId,
    ].join(":");
    if (identities.has(identity)) throw new Error("중복된 WTS 프레임 조사 결과입니다.");
    if (frameIds.has(observation.source.frameId)) {
      throw new Error("하나의 캡처에 같은 WTS 프레임의 서로 다른 문서가 포함되었습니다.");
    }
    identities.add(identity);
    frameIds.add(observation.source.frameId);
  }
  if (accepted.length === 0) throw new Error("저장할 수 있는 WTS 프레임을 찾지 못했습니다.");

  const truncated = accepted.length > maxObservations;
  const observations = accepted.slice(0, maxObservations).map((observation) => (
    truncated && !observation.truncated ? { ...observation, truncated: true } : observation
  ));
  const capture = {
    id: createId(),
    capturedAt,
    observations,
  };
  while (measureBytes(capture) > maxCaptureBytes) {
    let reduced = false;
    for (const observation of capture.observations) {
      const collection = observation.controls.length > 0
        ? observation.controls
        : observation.headings.length > 0
          ? observation.headings
          : observation.frames;
      if (collection.length === 0) continue;
      collection.splice(-Math.max(1, Math.ceil(collection.length / 4)));
      observation.truncated = true;
      reduced = true;
    }
    if (!reduced) throw new Error("WTS 캡처가 로컬 전송 크기 제한을 초과했습니다.");
  }
  return capture;
}

export function createCaptureCoordinator({ loadPending, savePending, clearPending, collectCapture, sendCapture }) {
  let inFlight = null;

  async function run() {
    const pendingJson = await loadPending();
    const capture = pendingJson ? JSON.parse(pendingJson) : await collectCapture();
    const captureJson = pendingJson || JSON.stringify(capture);
    if (!pendingJson) await savePending(captureJson);
    const result = await sendCapture(JSON.parse(captureJson));
    await clearPending();
    return { result, retried: Boolean(pendingJson), capture: JSON.parse(captureJson) };
  }

  return {
    collectOrRetry() {
      if (!inFlight) inFlight = run().finally(() => { inFlight = null; });
      return inFlight;
    },
    async discardPending() {
      if (inFlight) throw new Error("화면 저장 요청이 진행 중입니다.");
      await clearPending();
    },
    async hasPending() {
      return Boolean(await loadPending());
    },
  };
}
