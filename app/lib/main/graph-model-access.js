'use strict';

// The renderer context is display data, not authorization. Check both the saved
// preference and the current backend gate before any graph turn reaches a model.
async function checkGraphModelAccess(canvasMode, { readPreferences, getBackendUrl, getBearerToken, fetchImpl = fetch }) {
  if (canvasMode !== 'graph') return null;
  const unavailable = () => ({
    ok: false, source: 'local', code: 'GRAPH_MODEL_EXPOSURE_UNAVAILABLE',
    error: '그래프의 모델 전달 상태를 확인하지 못해 질문을 보내지 않았습니다. 잠시 후 다시 시도해 주세요. 그래프 화면은 계속 볼 수 있습니다.',
    answerText: null, canvasTypes: [], canvasCaptions: [],
  });
  const disabled = () => ({
    ok: false, source: 'local', code: 'GRAPH_MODEL_EXPOSURE_DISABLED',
    error: '그래프의 모델 전달이 꺼져 있어 질문을 보내지 않았습니다. 그래프 화면은 계속 볼 수 있으며, 일반 대화는 Agora에서 이용할 수 있습니다.',
    answerText: null, canvasTypes: [], canvasCaptions: [],
  });
  try {
    if (readPreferences().exposeToModel !== true) {
      return disabled();
    }
    const token = getBearerToken();
    if (!token) return unavailable();
    const response = await fetchImpl(`${getBackendUrl()}/api/v1/settings/expose-to-model`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000),
    });
    if (!response.ok || (await response.json()).enabled !== true) return unavailable();
    // The preference may have changed while the request was in flight.
    if (readPreferences().exposeToModel !== true) {
      return disabled();
    }
    return null;
  } catch {
    return unavailable();
  }
}

module.exports = { checkGraphModelAccess };
