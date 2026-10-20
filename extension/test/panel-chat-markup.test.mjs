import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const panelHtml = await readFile(new URL("../src/sidepanel/index.html", import.meta.url), "utf8");
const panelSource = await readFile(new URL("../src/sidepanel/panel.mjs", import.meta.url), "utf8");
const panelSourceLogic = await readFile(new URL("../src/sidepanel/panel-source.mjs", import.meta.url), "utf8");
const panelStyles = await readFile(new URL("../src/sidepanel/panel.css", import.meta.url), "utf8");

test("chat log announces only additions and progress has a dedicated live output", () => {
  assert.match(panelHtml, /id="chat-log"[^>]*role="log"[^>]*aria-relevant="additions text"/);
  assert.match(panelHtml, /<output id="task-progress"[^>]*aria-live="polite"[^>]*aria-atomic="true"/);
  assert.doesNotMatch(panelSource, /chatLog\.replaceChildren/);
});

test("privacy copy names both observation triggers", () => {
  assert.match(panelHtml, /‘현재 화면 조사’를 누르거나 지원되는 WTS 화면 명령을 제출했을 때만 수행합니다/);
  assert.match(panelHtml, /메타데이터 검색은 WTS 화면을 관찰하지 않습니다/);
  assert.match(panelHtml, /메타데이터 대화와 카드는 열린 패널 세션에만 보관합니다/);
  assert.match(panelHtml, /명령·작업·영수증 메타데이터만 사용자 PC에 제한적으로 저장합니다/);
  assert.match(panelHtml, /제출한 대화 문장과 고정된 WTS 명령 목록만 OpenAI로 보냅니다/);
  assert.match(panelHtml, /WTS 캡처, 쿠키, HTML, 입력값, 계좌번호, 금융 조회 결과, 로컬 파일과 키움 인증 정보는 OpenAI로 보내지 않습니다/);
});

test("chat help exposes chart, one canonical market example, and source grammar", () => {
  assert.match(panelHtml, /WTS 대화형 화면 제어/);
  assert.match(panelHtml, /data-command="일봉으로"/);
  assert.match(panelHtml, /data-command="차트 열고 주봉으로"/);
  assert.match(panelHtml, /data-command="월봉으로"/);
  assert.match(panelHtml, /data-command="년봉으로"/);
  assert.equal(
    panelHtml.match(/data-command="시장 메뉴 열어줘: [^"]+"/gu)?.length,
    1,
  );
  assert.match(panelHtml, /data-command="시장 메뉴 열어줘: 순위 > 전일대비 등락률 순위"/);
  assert.match(panelHtml, /data-command="조회 기능 찾아줘: 현재가"/);
  assert.match(panelHtml, /지원되는 차트·시장·조회 명령은 로컬에서 먼저 처리합니다/);
  assert.match(panelHtml, /지원되지 않는 문장은 ChatGPT가 연결되고 모델이 선택된 경우에만 전송/);
  assert.match(panelHtml, /WTS 실행 제안은 별도 실행 확인 전에는 실행되지 않습니다/);
  assert.doesNotMatch(panelHtml, /시장 메뉴 열어줘: 시세분석/);
});

test("ready copy describes bounded WTS screen work instead of chart-only capability", () => {
  assert.match(panelHtml, /현재 화면 조사 후 지원되는 WTS 화면 작업을 사용할 수 있습니다/);
  assert.match(panelSourceLogic, /지원되는 WTS 화면 작업을 사용할 수 있습니다/);
  assert.match(panelSource, /화면 조사가 저장되어 지원되는 WTS 화면 작업이 활성화됐습니다/);
  assert.doesNotMatch(panelSource, /차트 파일럿을 사용할 수 있습니다/);
  assert.doesNotMatch(panelSource, /차트 파일럿이 활성화됐습니다/);
});

test("panel handles task push status and error events", () => {
  assert.match(panelSource, /message\?\.type === "task\.status"/);
  assert.match(panelSource, /message\?\.type === "task\.error"/);
  assert.match(panelSource, /showTaskRefreshError/);
});

test("reopen and native status health both render the authoritative control gate", () => {
  assert.match(panelSource, /const initialHealth = await readPanelHealth\(\{[\s\S]*onHealth: applyHealth/);
  assert.match(panelSource, /message\?\.type === "native\.status"\) applyHealth\(message\.status\)/);
  assert.match(panelSource, /function applyControlHealth\(health\) \{[\s\S]*lastControlHealth = health;[\s\S]*renderControlHealth\(health\)/);
  assert.doesNotMatch(panelSource, /taskRefreshed && !currentTask/);
});

test("manual status refresh stays available for a paused running task", () => {
  assert.match(panelSource, /refreshed\.ok && isTaskRunning\(currentTask\) && !taskPoller\.running\(\)/);
  assert.match(panelSource, /elements\.taskRefresh\.hidden = false/);
  assert.match(panelSource, /상태 새로고침은 화면 동작을 다시 실행하지 않습니다/);
});

test("one composer renders typed metadata cards without a separate source input", () => {
  assert.doesNotMatch(panelHtml, /id="source-query"|id="source-search"|id="source-card"/);
  assert.match(panelHtml, /id="chat-input"[^>]*maxlength="512"/);
  assert.match(panelHtml, /패널을 닫으면 메타데이터 대화는 사라지고 자동으로 재실행하지 않습니다/);
  assert.match(panelSource, /send\("panel\.chat\.submit"|createPanelConversationController/);
  assert.match(panelSource, /conversationController\.describe/);
  assert.match(panelSource, /sourceConfigured/);
  assert.match(panelSource, /chatLog\.querySelectorAll\("\.source-card button"\)/);
  assert.match(panelSource, /nativeDiagnosticElements\.probeButton\.disabled = directProbeRunning \|\| conversationIsBusy \|\| sourceIsBusy \|\| disconnecting/);
  assert.match(panelSource, /elements\.collect\.disabled = [^;]+disconnecting/);
  assert.match(panelSource, /elements\.retryReceipt\.disabled = [^;]+disconnecting/);
  assert.match(panelSource, /elements\.archiveReceipt\.disabled = [^;]+disconnecting/);
  assert.match(panelHtml, /id="source-refresh"[^>]*hidden>활동 상태 다시 확인/);
  assert.match(panelSource, /sourceActivityPoller\.stop\(\);\s*invalidateConversation\(\)/);
  assert.match(panelSource, /활동 상태 다시 확인은 화면 동작을 실행하지 않습니다/);
  assert.match(panelSource, /renderSourceCard/);
  assert.match(panelSource, /message\.card\.kind === "capability-list"/);
  assert.match(panelSource, /conversationPhase\(\) === "source"/);
  assert.match(panelSource, /canStopPanelConversation/);
  assert.match(panelSource, /elements\.chatStop\.disabled = stopRequestRunning \|\| !canStopPanelConversation/);
  assert.match(panelSource, /health\.conversationPhase === "source" && health\.conversationRunning === true/);
  assert.match(panelSource, /기능 메타데이터 확인이 이미 시작되어 중지하지 않았습니다/);
  assert.doesNotMatch(panelSource, /panel\.health"\)\.catch\(\(\) => \(\{ connected: false \}\)\)/);
  assert.doesNotMatch(panelSource, /panel\.health"\)\.catch\(\(\) => \(\{ pendingCapture: false \}\)\)/);
  assert.doesNotMatch(panelSource, /refreshSummary\(\)\.catch\(\(\) => setConnected\(false\)\)/);
  assert.match(panelSource, /마지막으로 확인된 연결과 작업 상태를 유지합니다/);
  assert.match(panelStyles, /\.source-field-group li \{ white-space: pre-wrap; overflow-wrap: anywhere; \}/);
  assert.doesNotMatch(panelHtml, /금융 데이터 조회 준비|AI 준비|모델 준비/);
});
