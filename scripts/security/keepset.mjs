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
  "scripts/windows-installer.nsh",
  "scripts/windows-installer-processes.nsh",
  "scripts/windows-installer-processes.ps1",
  "scripts/windows-installer-upgrade.nsh",
  "scripts/windows-installer-upgrade.ps1",
  "README.md",
  "GROK.md",
  "AGENTS.md",
  "CLAUDE.md",
  "backend/verification/test_ws_feed_status.py",
  "backend/verification/test_index_realtime_semantics.py",
  "backend/verification/test_graph_edit_proposal.py",
  "backend/verification/test_graph_projection_provenance.py",
  "backend/verification/test_propose_optimize_ranges.py",
  "backend/verification/test_scheduler_isolation.py",
  "backend/verification/test_scheduled_catchup_lifetime.py",
  "backend/verification/test_aegis_runtime.py",
  "backend/verification/test_mcp_runtime.py",
  "backend/verification/test_canvas_delivery_correlation.py",
  "backend/verification/test_company_info_projection.py",
  "backend/verification/test_selector_business_result.py",
  "backend/verification/test_account_surface_binding_semantics.py",
  "backend/verification/test_mcp_condition_receipt.py",
  "backend/verification/test_condition_query_delivery.py",
  "backend/verification/test_elw_surface_entry.py",
  "backend/verification/test_surface_row_source_identity.py",
  "backend/verification/test_ranking_rail_identity.py",
  "backend/verification/test_vi_snapshot_surface.py",
  "backend/verification/test_remaining_surface_routes.py",
  "backend/verification/test_nudge_guard_proposal.py",
  "backend/verification/test_condition_result_surface.py",
  "backend/verification/test_orderbook_change_rates.py",
  "backend/verification/test_credit_lending_rankings.py",
  "backend/verification/test_minute_surface_binding.py",
  "backend/verification/test_investor_grid_binding.py",
  "backend/verification/test_afterhours_gold_surface_binding.py",
  "backend/verification/test_ranking_expanded_result.py",
  "backend/verification/test_orderbook_surface_binding.py",
  "backend/verification/test_sector_list_identity.py",
  "backend/verification/test_sector_quote_surface.py",
  "backend/verification/test_flow_semantic_contracts.py",
  "backend/verification/test_elw_display_identity.py",
  "backend/verification/test_stock_display_identity.py",
  "backend/verification/test_stock_chart_catalog_periods.py",
  "backend/verification/test_table_query_arguments.py",
  "backend/verification/test_instrument_semantic_contracts.py",
  "backend/verification/test_subscription_rights_surface.py",
  "backend/verification/test_surface_display_units.py",
  "backend/verification/test_backtest_project_scope.py",
  "backend/verification/test_project_list_responsiveness.py",
  "backend/verification/test_backtest_refresh.py",
  "backend/verification/test_natural_backtest.py",
  "backend/verification/test_natural_laya.py",
  "backend/verification/test_natural_schema.py",
  "backend/verification/test_natural_api.py",
  "backend/verification/test_product_scope.py",
  "backend/verification/test_release_version.py",
  "backend/verification/wts_local_planner_probe.py",
  "backend/verification/test_wts_local_planner_probe.py",
  "backend/verification/verify_mcp_bundled_runtime.py",
  "backend/verification/test_laya_api_worker.py",
  "backend/verification/test_laya_native.py",
  "backend/verification/test_laya_query_memory.py",
  "backend/verification/test_laya_llm_tool_timeouts.py",
  "backend/verification/test_laya_full_catalog.py",
  "backend/verification/test_laya_runtime.py",
  "backend/verification/test_laya_cancellation.py",
  "backend/verification/test_laya_context.py",
  "backend/verification/test_laya_cpu_threads.py",
  "backend/verification/test_laya_force_choice.py",
  "backend/verification/test_laya_layer_cancellation.py",
  "backend/verification/test_laya_selector_dispatch.py",
]);

const RUNTIME_ROOT = new Set(RUNTIME_ROOT_FILES);
const DEST_FILES = new Set(DEST_CONTROL_FILES);
// Reviewed Chrome/local-runtime source only; generated bundles and user records stay local.
const WTS_FOUNDATION_FILES = new Set([
  "backend/tests/test_launcher.py",
  "backend/tests/test_readonly_app.py",
  "contracts/README.md",
  "contracts/wts-foundation.protocol.schema.json",
  "contracts/wts-foundation.mjs",
  "contracts/tests/wts-foundation.test.mjs",
  "extension/package.json",
  "extension/README.md",
  "extension/scripts/build.mjs",
  "extension/scripts/check.mjs",
  "extension/src/browser-control.mjs",
  "extension/src/capture-core.mjs",
  "extension/src/collector.mjs",
  "extension/src/control-core.mjs",
  "extension/src/conversation-dispatch.mjs",
  "extension/src/manifest.json",
  "extension/src/native-client.mjs",
  "extension/src/service-worker.mjs",
  "extension/src/task-control.mjs",
  "extension/src/sidepanel/index.html",
  "extension/src/sidepanel/native-diagnostic.mjs",
  "extension/src/sidepanel/panel-actions.mjs",
  "extension/src/sidepanel/panel-chat.mjs",
  "extension/src/sidepanel/panel-chat-polling.mjs",
  "extension/src/sidepanel/panel.css",
  "extension/src/sidepanel/panel.mjs",
  "extension/src/sidepanel/panel-source.mjs",
  "extension/src/sidepanel/source-cards.mjs",
  "extension/src/source-control.mjs",
  "extension/src/wts/chart-adapter.mjs",
  "extension/src/wts/market-navigation-adapter.mjs",
  "extension/test/build.test.mjs",
  "extension/test/browser-control.test.mjs",
  "extension/test/chart-adapter.test.mjs",
  "extension/test/collector.test.mjs",
  "extension/test/control-core.test.mjs",
  "extension/test/conversation-dispatch.test.mjs",
  "extension/test/conversation-runtime-integration.test.mjs",
  "extension/test/helpers/market-navigation-dom.mjs",
  "extension/test/market-navigation-adapter.test.mjs",
  "extension/test/market-navigation-runtime-integration.test.mjs",
  "extension/test/native-client.test.mjs",
  "extension/test/native-diagnostic.test.mjs",
  "extension/test/panel-actions.test.mjs",
  "extension/test/panel-chat.test.mjs",
  "extension/test/panel-chat-polling.test.mjs",
  "extension/test/panel-chat-markup.test.mjs",
  "extension/test/panel-source.test.mjs",
  "extension/test/source-cards.test.mjs",
  "extension/test/source-control.test.mjs",
  "extension/test/task-control.test.mjs",
  "extension/test/task-runtime-integration.test.mjs",
  "extension/test/service-worker.test.mjs",
  "extension/test/service-worker-source.test.mjs",
  "local-runtime/package.json",
  "local-runtime/README.md",
  "local-runtime/scripts/audit-pilot-evidence.mjs",
  "local-runtime/scripts/diagnose-chrome-native-host.cmd",
  "local-runtime/scripts/diagnose-chrome-native-host.ps1",
  "local-runtime/scripts/install.ps1",
  "local-runtime/scripts/path-validation.ps1",
  "local-runtime/scripts/registry.ps1",
  "local-runtime/scripts/repair-native-host-path.ps1",
  "local-runtime/scripts/uninstall.ps1",
  "local-runtime/src/config.mjs",
  "local-runtime/src/backend-supervisor.mjs",
  "local-runtime/src/source-bridge.mjs",
  "local-runtime/src/control-planner.mjs",
  "local-runtime/src/conversation-router.mjs",
  "local-runtime/src/errors.mjs",
  "local-runtime/src/framing.mjs",
  "local-runtime/src/host.mjs",
  "local-runtime/src/inventory-store.mjs",
  "local-runtime/src/main.mjs",
  "local-runtime/src/receipt-store.mjs",
  "local-runtime/src/task-compiler.mjs",
  "local-runtime/src/task-engine.mjs",
  "local-runtime/src/task-store.mjs",
  "local-runtime/test/control-pilot.test.mjs",
  "local-runtime/test/conversation-router.test.mjs",
  "local-runtime/test/config.test.mjs",
  "local-runtime/test/evidence-audit.test.mjs",
  "local-runtime/test/task-engine.test.mjs",
  "local-runtime/test/backend-supervisor.test.mjs",
  "local-runtime/test/source-bridge.test.mjs",
  "local-runtime/test/chrome-native-diagnostic.test.mjs",
  "local-runtime/test/install-scripts.test.mjs",
  "local-runtime/test/native-host.test.mjs",
  "local-runtime/test/native-host-path-repair.test.mjs",
  "local-runtime/test/registry-write.test.ps1",
  "backend/tests/test_financial_cards.py",
  "backend/tests/test_financial_query_runtime.py",
  "backend/tests/test_financial_read_app.py",
  "backend/tests/test_financial_read_client.py",
  "backend/tests/test_financial_vault.py",
  "contracts/tests/fixtures/wts-protocol6-pre-v7-baseline.json",
  "contracts/tests/fixtures/wts-protocol6-pre-v7-module.mjs",
  "extension/scripts/verify-financial-chart-browser.mjs",
  "extension/src/financial-control.mjs",
  "extension/src/provider-control.mjs",
  "extension/src/sidepanel/financial-cards.mjs",
  "extension/src/sidepanel/financial-chart-renderer.mjs",
  "extension/src/sidepanel/financial-form.mjs",
  "extension/src/sidepanel/panel-financial.mjs",
  "extension/src/sidepanel/provider-panel.mjs",
  "extension/test/financial-cards.test.mjs",
  "extension/test/financial-chart-renderer.test.mjs",
  "extension/test/financial-control.test.mjs",
  "extension/test/financial-form.test.mjs",
  "extension/test/panel-financial-source.test.mjs",
  "extension/test/panel-financial.test.mjs",
  "extension/test/provider-control.test.mjs",
  "extension/test/provider-panel-markup.test.mjs",
  "extension/test/provider-panel-terminal.test.mjs",
  "local-runtime/scripts/open-openai-authorization.ps1",
  "local-runtime/scripts/openai-registration-store.ps1",
  "local-runtime/scripts/upgrade-native-host.ps1",
  "local-runtime/src/chatgpt-provider/browser-opener.mjs",
  "local-runtime/src/chatgpt-provider/control-candidate.mjs",
  "local-runtime/src/chatgpt-provider/models-client.mjs",
  "local-runtime/src/chatgpt-provider/oauth-session.mjs",
  "local-runtime/src/chatgpt-provider/openid-verifier.mjs",
  "local-runtime/src/chatgpt-provider/planning-client.mjs",
  "local-runtime/src/chatgpt-provider/provider-coordinator.mjs",
  "local-runtime/src/chatgpt-provider/registration-store.mjs",
  "local-runtime/src/chatgpt-provider/responses-client.mjs",
  "local-runtime/src/chatgpt-provider/token-session.mjs",
  "local-runtime/src/financial-backend-supervisor.mjs",
  "local-runtime/src/financial-source-bridge.mjs",
  "local-runtime/test/chatgpt-browser-opener.test.mjs",
  "local-runtime/test/chatgpt-control-candidate.test.mjs",
  "local-runtime/test/chatgpt-models-client.test.mjs",
  "local-runtime/test/chatgpt-oauth-session.test.mjs",
  "local-runtime/test/chatgpt-openid-verifier.test.mjs",
  "local-runtime/test/chatgpt-planning-client.test.mjs",
  "local-runtime/test/chatgpt-provider-coordinator.test.mjs",
  "local-runtime/test/chatgpt-registration-store.test.mjs",
  "local-runtime/test/chatgpt-responses-client.test.mjs",
  "local-runtime/test/chatgpt-token-session.test.mjs",
  "local-runtime/test/financial-backend-supervisor.test.mjs",
  "local-runtime/test/financial-describe-schema-integration.test.mjs",
  "local-runtime/test/financial-native-integration.test.mjs",
  "local-runtime/test/financial-source-bridge.test.mjs",
  "local-runtime/test/openai-registration-store-windows.test.mjs",
  "local-runtime/test/upgrade-native-host.test.mjs",
]);
const NON_RUNTIME_APP_FILES = new Set([
  "app/lib/board-probe.js",
  "app/lib/board-sweep-targets.js",
  "app/lib/probe-captures.js",
  "app/lib/probe-model-prefs.js",
]);

export const PUBLIC_SUBTREE_ROOTS = Object.freeze(["web/", "presentation/"]);

const FORBIDDEN_PUBLIC_SUBTREE_DIRECTORIES = new Set([
  ".agents",
  ".aws",
  ".cache",
  ".claude",
  ".codex",
  ".next",
  ".omc",
  ".omx",
  ".playwright-mcp",
  ".private",
  ".ssh",
  ".venv",
  ".vinext",
  ".wrangler",
  "artifacts",
  "browser-data",
  "browser-profile",
  "cache",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "outputs",
  "profiles",
  "private",
  "user data",
  "user-data",
  "venv",
  "work",
  "__pycache__",
]);

const FORBIDDEN_PUBLIC_SUBTREE_FILES = new Set([
  "athena-secrets.json",
  "auth.json",
  "cookies.json",
  "credentials.json",
  "generator-secrets.json",
  "secrets.json",
  "storage-state.json",
  "storagestate.json",
]);

export function normalizeGitPath(path) {
  return String(path || "").replace(/\\/g, "/").replace(/^\.\//, "");
}

export function isForbiddenPublicSubtreePath(path) {
  const p = normalizeGitPath(path);
  if (!PUBLIC_SUBTREE_ROOTS.some((root) => p.startsWith(root))) return false;

  const parts = p.split("/").slice(1);
  const lowerParts = parts.map((part) => part.toLowerCase());
  if (lowerParts.some((part) => FORBIDDEN_PUBLIC_SUBTREE_DIRECTORIES.has(part))) {
    return true;
  }

  const name = lowerParts.at(-1) || "";
  if (/^\.env(?:\.|$)/.test(name) && !/^\.env(?:\.[^/]*)?\.example$/.test(name)) {
    return true;
  }
  if (FORBIDDEN_PUBLIC_SUBTREE_FILES.has(name)) return true;
  if (/\.(?:pem|key|p12|pfx|db|sqlite|sqlite3)(?:-[^/]*)?$/.test(name)) return true;
  if (/^presentation\/source\/video\/render\//i.test(p)) return true;
  return false;
}

export function isKeepPath(path) {
  const p = normalizeGitPath(path);
  if (!p) return false;
  if (PUBLIC_SUBTREE_ROOTS.some((root) => p.startsWith(root))) {
    return !isForbiddenPublicSubtreePath(p);
  }
  if (DEST_FILES.has(p)) return true;
  if (WTS_FOUNDATION_FILES.has(p)) return true;
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
