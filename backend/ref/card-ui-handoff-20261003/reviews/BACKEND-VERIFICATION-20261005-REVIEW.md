# Backend verification independent review — 2026-10-05

## Verdict

**SCOPED APPROVE** for the recorded backend verification run at reviewed HEAD `c7c7e872bad7d3db0b64cd3c72349f6568f3094e`.

This verdict approves the backend pytest evidence described below. It does not approve the Paper work, native UI inventory, renderer matrix, or the overall card UI goal as complete.

## Evidence reviewed

| Evidence | Independently recomputed SHA-256 | Result |
| --- | --- | --- |
| `.omc/artifacts/card-ui-goal-20261004/condition-result-targeted.log` | `C745790298A8BFDC8C9D0603F8C937F7771C2EDBAE54817185A90CFE1CC5EFF0` | 22 passed in 20.67 s |
| `.omc/artifacts/card-ui-goal-20261004/backend-verification-full-20261005.log` | `CBF45CF07507367DDB4484F4F7E731E25BC3ACD5207CA0B78C594A5B8B6792B4` | 376 passed, 1 warning in 95.01 s |
| `backend/pyproject.toml` | `0D4C40DC3AC7CEBB244E6FEC79D41F3310A8A33E43100DEEC2FCABEF2C1F02AB` | matches the reviewed dependency declaration |
| `backend/uv.lock` | `B2A532ADEB45E4239150E8F169A730BE1C55C8F60983624A48A52A1E3A589233` | matches the reviewed frozen lock |

The full command was run from `backend` as:

```powershell
$env:PYTHONDONTWRITEBYTECODE='1'; uv run --isolated --frozen --extra dev pytest -q -p no:cacheprovider verification
```

The command selects the complete `verification` directory and contains no `-k`, path exclusion, ignore, skip, or early-stop option. `-p no:cacheprovider` disables pytest's cache plugin; it does not exclude tests. The completed summary contains no failed, skipped, xfailed, xpassed, cancelled, or TODO count. The targeted 22 cases are a focused subset of the full 376-case run and must not be added to produce a false total of 398.

The targeted log records the count and duration but does not retain collected node IDs or its exact selector command. This review therefore confirms its 22-pass result and hash, while relying on the full unfiltered `verification` run for suite-wide coverage.

## Isolation and side-effect review

- The reviewed verification tests use synthetic values, FastAPI in-process `ASGITransport`, `httpx.MockTransport`, dependency overrides, monkeypatches, and fake WebSocket objects. Provider dispatch, bearer checks, and upstream sockets are replaced with process-local test doubles where those paths are exercised.
- Condition-query tests use a synthetic signing key and an in-memory client. They assert that registration, removal, realtime subscription, order, and mismatched commands fail before dispatch; the read-only delivery cases preserve one-shot plan behavior and business-error evidence.
- Searches of `backend/verification` found no live request transport, test skip, or xfail declaration. Explicit test-case file and SQLite persistence is confined to pytest `tmp_path` or `TemporaryDirectory` fixtures; no tracked product, test, configuration, lock, or user-data profile path is written. Runner and dependency caches plus ignored evidence logs are outside this test-side-effect claim. Test strings resembling accounts, tokens, and bearer values are explicitly synthetic fixtures.
- `uv run --isolated --frozen` created an isolated environment from the reviewed lock. `PYTHONDONTWRITEBYTECODE=1` and the disabled cache provider avoided Python bytecode and pytest-cache writes in the repository. The backend product, verification, dependency declaration, and lock paths had no uncommitted changes after the run.
- Execution-owner provenance records terminal sessions `53419` and `48323` as exited with code 0 and no retained handles. The preserved logs independently show normal completed pytest summaries; they do not themselves encode terminal handle state.

## Source and warning boundary

`07b266cf90f243367bdb4ed3eb63b90d3844d266` is an ancestor of the reviewed HEAD. Committed backend product and verification changes exist between that source anchor and `c7c7e872`; this receipt therefore binds the test result to the current reviewed HEAD and its clean backend working-tree paths, rather than claiming byte identity with the older anchor. A concurrent edit to `GOAL-PROGRESS-20261004.md` was outside this review and was not modified here.

The only warning is `StarletteDeprecationWarning` from FastAPI's installed `testclient.py`, stating that the `httpx` integration is deprecated in favor of `httpx2`. It is a dependency-maintenance warning and did not suppress or downgrade a test failure. It should be handled during a deliberate dependency update, not by weakening this verification run.

## Limits

- This is backend verification evidence only. It does not establish native card geometry, Paper fidelity, renderer behavior, actual provider connectivity, or live financial correctness.
- It does not authorize provider writes, order execution, profile access, or use of private account data.
- The overall native goal remains active. Its current `0/94` and `0/30` completion figures are unchanged by this review.
- No source, Paper, native, or full-goal completion claim may be inferred from this scoped approval.

Within these bounds, the backend verification evidence is internally consistent and suitable for the current checkpoint.
