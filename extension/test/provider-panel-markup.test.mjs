import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../src/sidepanel/index.html", import.meta.url), "utf8");
const panel = await readFile(new URL("../src/sidepanel/provider-panel.mjs", import.meta.url), "utf8");

test("provider panel exposes explicit connection, live model selection, cancellation, and separate proposal controls", () => {
  for (const id of [
    "provider-connect", "provider-disconnect", "provider-reset", "provider-model", "provider-models",
    "provider-refresh", "provider-cancel", "provider-proposal", "provider-assistant-text", "provider-command-text",
    "provider-execute", "provider-reject",
  ]) assert.match(html, new RegExp(`id="${id}"`, "u"));
  assert.match(html, />Continue with ChatGPT</u);
  assert.match(html, /id="provider-connect"[^>]*>Continue with ChatGPT<\/button>/u);
  assert.match(html, /id="provider-usage-link" href="https:\/\/chatgpt\.com\/settings\/usage" target="_blank" rel="noopener noreferrer"/u);
});

test("privacy copy states the bounded OpenAI transmission and excluded WTS data accurately", () => {
  assert.match(html, /제출한 대화 문장과 고정된 WTS 명령 목록만 OpenAI로 보냅니다/u);
  assert.match(html, /WTS 캡처, 쿠키, HTML, 입력값, 계좌번호, 금융 조회 결과, 로컬 파일과 키움 인증 정보는 OpenAI로 보내지 않습니다/u);
  assert.match(html, /토큰과 모델 상태는 로컬 실행기 프로세스 메모리에만 유지/u);
});

test("assistant and proposal data use textContent and never HTML insertion", () => {
  assert.match(panel, /elements\.assistant\.textContent =/u);
  assert.match(panel, /elements\.command\.textContent =/u);
  assert.doesNotMatch(panel, /innerHTML|insertAdjacentHTML|outerHTML/u);
});
