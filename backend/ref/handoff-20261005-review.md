# 2026-10-05 handoff verification

This snapshot preserves unfinished LAYA/provider runtime work. It is a WIP handoff, not a product release. Keep `codex/laya-runtime-handoff-20261005` separate from the UI-only `codex/card-ui-resume-20261003` branch and the older `codex/laya-experiments-20261001` branch.

## Checks performed

| Check | Result | Scope |
| --- | --- | --- |
| `cd app; node --test lib/main/laya-routing.test.mjs lib/main/codex-chat-runtime.test.mjs` | 27 passed, 0 failed, 0 cancelled, 0 skipped, 0 TODO; exit 0 | Injected routing, session ownership, cancellation, private environment propagation, response formatting and ticket redaction contracts. |
| `cd backend; .\.venv\Scripts\python.exe -m unittest discover -s verification -p 'test_laya_*.py'` | 52 tests, OK; exit 0; 7.225 seconds | All five LAYA verification modules using the existing Python environment. |
| Full app unit suite, run by the coordinating agent | 819 tests: 772 passed, 46 failed, 1 cancelled, 0 skipped, 0 TODO; exit 1 | Latest full-suite outcome, still failing. Do not substitute the focused passes for this result. |
| `git diff --check` | Exit 0 | Tracked source/document changes present during review. |

The backend command initially could not spawn the existing Python environment inside the restricted sandbox. It succeeded with approved execution using that same environment; no packages were installed. The successful run printed a Starlette/httpx deprecation warning and asyncio timing notices, without test failures.

An independent read pass covered the modified runtime integration, newly added LAYA modules and tests, `AGENTS.md`, the handoff README, and the five explicit verification paths added to `scripts/security/keepset.mjs`. The keepset change admits those specific source tests; it does not admit runtime artifacts or credentials. Test bearer strings and identity pins reviewed here are fixtures, not deployment configuration. Three Windows-only cleanup contracts use platform guards; they executed on this Windows run.

## Limits and privacy

No native app, browser, card UI or live model inference was run in this review. Tests using fake predictors, HTTP transports and injected child processes do not establish that a real LAYA checkpoint loads, CUDA is available, the packaged app works, or all card states pass. The complete 101 editable Paper / 94 real-app UI objective remains paused and unfinished, including the same-card maximum → narrow → maximum cycle and bottom/final-column/tab checks.

The runtime requires a separately prepared SDK environment and deployment/catalog/policy/checkpoint files with matching hashes. Verify destination paths, device availability and deployment identity locally. Git source transfer does not transfer those installed artifacts or authenticate providers.

Do not publish `.env`, live bearer tokens, provider profiles, conversation databases, model/source datasets, local runtime logs or raw application payloads. Leases and generation values travel through private process environment variables; the opaque turn ticket intentionally travels in the provider prompt and local HTTP path. Callback redaction tests are scoped checks and do not prove that provider transcripts or HTTP access logs are safe to publish. Keep those logs private and recreate credentials locally on the destination computer.

Public-repository security gates remain a separate required check before publishing the snapshot. This focused review does not replace the complete gate evaluation. Real-money order execution remains outside scope; simulated backtests remain in scope.
