import assert from "node:assert/strict";
import test from "node:test";
import {
  DEST_CONTROL_FILES,
  RUNTIME_ROOT_FILES,
  forbiddenTrackedPaths,
  isKeepPath,
} from "./keepset.mjs";

test("installer runtime roots stay in the keep-set", () => {
  for (const p of RUNTIME_ROOT_FILES) {
    assert.equal(isKeepPath(p), true, p);
  }
  assert.equal(isKeepPath("app/test-fixtures/provider-contract/decision.json"), true);
  assert.equal(isKeepPath("backend/pyproject.toml"), true);
  assert.equal(isKeepPath("backend/uv.lock"), true);
});

test("dest-control files stay in the keep-set", () => {
  for (const p of DEST_CONTROL_FILES) {
    assert.equal(isKeepPath(p), true, p);
  }
  assert.equal(isKeepPath(".githooks/pre-commit"), true);
  assert.equal(isKeepPath("scripts/security/keepset.mjs"), true);
  assert.equal(isKeepPath("scripts/security/check-tracked-keepset.mjs"), true);
  assert.equal(isKeepPath(".github/workflows/release.yml"), true);
  assert.equal(isKeepPath("scripts/release/version.mjs"), true);
  assert.equal(isKeepPath("scripts/release/check-version.mjs"), true);
  assert.equal(isKeepPath("scripts/release/set-version.mjs"), true);
});

test("app lib/data/styles runtime sources stay; tests and probes do not", () => {
  assert.equal(isKeepPath("app/lib/main/live-prompt.js"), true);
  assert.equal(isKeepPath("app/lib/card-kind-주문.js"), true);
  assert.equal(isKeepPath("app/data/athena-icon.png"), true);
  assert.equal(isKeepPath("app/styles/tokens.css"), true);
  assert.equal(isKeepPath("app/lib/main/live-prompt.test.js"), false);
  assert.equal(isKeepPath("app/lib/card-kind-주문.test.js"), false);
  assert.equal(isKeepPath("app/lib/board-probe.js"), false);
  assert.equal(isKeepPath("app/lib/board-sweep-targets.js"), false);
  assert.equal(isKeepPath("app/lib/probe-captures.js"), false);
  assert.equal(isKeepPath("app/lib/probe-model-prefs.js"), false);
  assert.equal(isKeepPath("app/probe-orb-chat.js"), false);
  assert.equal(isKeepPath("app/verify.js"), false);
});

test("backend runtime packages stay; tests and scripts do not", () => {
  assert.equal(isKeepPath("backend/athena_api/main.py"), true);
  assert.equal(isKeepPath("backend/athena_mcp/server.py"), true);
  assert.equal(isKeepPath("backend/ref/foo.json"), true);
  assert.equal(isKeepPath("backend/tests/api/test_canvas_render_plan.py"), false);
  assert.equal(isKeepPath("backend/athena_api/tests/foo.py"), false);
  assert.equal(isKeepPath("backend/scripts/seed_long_term_etf_persona.py"), false);
});

test("MCP runtime verification is narrowly kept", () => {
  assert.equal(isKeepPath("backend/verification/test_mcp_runtime.py"), true);
  assert.equal(isKeepPath("backend/verification/verify_mcp_bundled_runtime.py"), true);
  assert.equal(isKeepPath("backend/verification/private-mcp-probe.py"), false);
});

test("canvas delivery regression is kept without allowing adjacent private artifacts", () => {
  assert.equal(isKeepPath("backend/verification/test_canvas_delivery_correlation.py"), true);
  for (const path of [
    "backend/verification/private-canvas-probe.py",
    "backend/verification/canvas-delivery.log",
    "backend/verification/profile/Local Storage/leveldb/000003.log",
    "backend/verification/.env",
    "backend/verification/conversations.db",
  ]) assert.equal(isKeepPath(path), false, path);
});

test("handoff, datasets, paper ledgers, and prompt dumps are outside the keep-set", () => {
  assert.equal(isKeepPath("docs/handoff/README.md"), false);
  assert.equal(isKeepPath("datasets/앱-검증-200.jsonl"), false);
  assert.equal(isKeepPath("PAPER_APP_PARITY.md"), false);
  assert.equal(isKeepPath("_g5b_prompt.txt"), false);
  assert.equal(isKeepPath("docs/blog/athena-ai/README.md"), false);
  assert.equal(isKeepPath("docs/product-pages/index.html"), false);
});

test("Paper extraction ledgers stay local while runtime card templates remain tracked", () => {
  assert.equal(isKeepPath("backend/ref/paper-ledger/1-0/1DX-0.json"), false);
  assert.equal(isKeepPath("backend/ref/paper-ledger/index.json"), false);
  assert.equal(isKeepPath("backend/ref/card-surface-templates/2RJ7-1/slots.json"), true);
  assert.equal(isKeepPath("app/lib/paper-screen-phrases.generated.js"), true);
});

test("forbiddenTrackedPaths returns only drop paths in input order", () => {
  assert.deepEqual(
    forbiddenTrackedPaths([
      "app/main.js",
      "docs/handoff/x.md",
      "app/lib/main/live-prompt.test.js",
      "backend/athena_api/main.py",
    ]),
    ["docs/handoff/x.md", "app/lib/main/live-prompt.test.js"],
  );
});


test("backtest project scope regression is narrowly kept", () => {
  assert.equal(isKeepPath("backend/verification/test_backtest_project_scope.py"), true);
  assert.equal(isKeepPath("backend/verification/private-project-probe.py"), false);
  assert.equal(isKeepPath("backend/verification/project-registry.json"), false);
});
