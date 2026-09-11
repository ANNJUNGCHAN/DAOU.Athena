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
});

test("app lib/data/styles runtime sources stay; tests and probes do not", () => {
  assert.equal(isKeepPath("app/lib/main/live-prompt.js"), true);
  assert.equal(isKeepPath("app/lib/card-kind-주문.js"), true);
  assert.equal(isKeepPath("app/data/athena-icon.png"), true);
  assert.equal(isKeepPath("app/styles/tokens.css"), true);
  assert.equal(isKeepPath("app/lib/main/live-prompt.test.js"), false);
  assert.equal(isKeepPath("app/lib/card-kind-주문.test.js"), false);
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

test("handoff, datasets, paper ledgers, and prompt dumps are outside the keep-set", () => {
  assert.equal(isKeepPath("docs/handoff/README.md"), false);
  assert.equal(isKeepPath("datasets/앱-검증-200.jsonl"), false);
  assert.equal(isKeepPath("PAPER_APP_PARITY.md"), false);
  assert.equal(isKeepPath("_g5b_prompt.txt"), false);
  assert.equal(isKeepPath("docs/blog/athena-ai/README.md"), false);
  assert.equal(isKeepPath("docs/product-pages/index.html"), false);
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
