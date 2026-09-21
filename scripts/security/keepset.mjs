/**
 * Dest keep-set: paths allowed on the public remote.
 * Mirrors scripts/build-windows-installer.ps1 staging plus dest-control files.
 */

export const RUNTIME_ROOT_FILES = Object.freeze([
  "app/main.js",
  "app/preload.js",
  "app/shell.html",
  "app/shell.js",
  "app/shell.css",
  "app/canvas.js",
  "app/canvas.css",
  "app/chat.js",
  "app/chat.css",
  "app/orb.html",
  "app/orb.js",
  "app/orb.css",
  "app/provider-first-paint.js",
  "app/package.json",
  "app/package-lock.json",
]);

export const DEST_CONTROL_FILES = Object.freeze([
  ".gitignore",
  ".gitattributes",
  ".github/workflows/secret-scan.yml",
  ".github/workflows/release.yml",
  "scripts/build-windows-installer.ps1",
  "scripts/windows-installer.config.cjs",
  "README.md",
  "GROK.md",
  "AGENTS.md",
  "CLAUDE.md",
  "backend/verification/test_ws_feed_status.py",
  "backend/verification/test_index_realtime_semantics.py",
  "backend/verification/test_scheduled_catchup_lifetime.py",
  "backend/verification/test_aegis_runtime.py",
]);

const RUNTIME_ROOT = new Set(RUNTIME_ROOT_FILES);
const DEST_FILES = new Set(DEST_CONTROL_FILES);
const NON_RUNTIME_APP_FILES = new Set([
  "app/lib/board-probe.js",
  "app/lib/board-sweep-targets.js",
  "app/lib/probe-captures.js",
  "app/lib/probe-model-prefs.js",
]);

export function normalizeGitPath(path) {
  return String(path || "").replace(/\\/g, "/").replace(/^\.\//, "");
}

export function isKeepPath(path) {
  const p = normalizeGitPath(path);
  if (!p) return false;
  if (DEST_FILES.has(p)) return true;
  if (p.startsWith(".githooks/")) return true;
  if (p.startsWith("scripts/security/")) return true;
  if (p.startsWith("scripts/release/")) return true;
  if (RUNTIME_ROOT.has(p)) return true;
  if (p === "app/test-fixtures/provider-contract/decision.json") return true;
  if (NON_RUNTIME_APP_FILES.has(p)) return false;
  if (
    /^app\/(lib|data|styles)\//.test(p) &&
    !/(?:^|\/)(?:__pycache__|node_modules)\//.test(p) &&
    !/\.test\.js$/.test(p)
  ) {
    return true;
  }
  if (p === "backend/pyproject.toml" || p === "backend/uv.lock") return true;
  if (p.startsWith("backend/ref/paper-ledger/")) return false;
  if (
    /^backend\/(athena_api|athena_mcp|ref)\//.test(p) &&
    !/(?:^|\/)(?:__pycache__|tests?)\//.test(p) &&
    !/\.(?:pyc|pyo)$/.test(p)
  ) {
    return true;
  }
  return false;
}

export function forbiddenTrackedPaths(paths) {
  return [...paths].map(normalizeGitPath).filter((p) => p && !isKeepPath(p));
}
