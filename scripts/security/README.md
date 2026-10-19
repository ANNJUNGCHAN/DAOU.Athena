# Dest security gates (public remote)

These repos are intended to be **public**. Gates stop live secrets from landing in git; they do not hide product source. Prompt text is policy for agents and the in-app model, not a sandbox.

Gates:
- `gitleaks.toml` — commit-time secret policy.
- `.githooks/pre-commit` — refuses a staged secret.
- `.githooks/pre-push` — refuses a push if gitleaks finds a leak, GitHub push protection cannot be positively verified as enabled, prompt markers are missing, or the tracked keep-set fails. After all gates pass, it preserves Git's ref stream for `git lfs pre-push` so presentation assets upload normally. Missing GitHub CLI, authentication/API errors, and empty responses fail closed; no bypass environment variable is accepted.
- `.github/workflows/secret-scan.yml` — CI gitleaks after a push, then prompt-marker and tracked keep-set checks.
- `scripts/security/check-prompt-security.mjs` — fail-closed marker presence check, invoked by eval, pre-push, and CI.
- `scripts/security/keepset.mjs` / `check-tracked-keepset.mjs` — only the desktop run/rebuild paths, dest-control paths, and reviewed `web/` and `presentation/` subtrees may be tracked. Nested environment files, credentials, profiles, databases, installed runtimes, caches, and generated render output remain forbidden.
- `scripts/security/check-public-artifacts.mjs` — materializes only reviewed tracked files under `web/` and `presentation/` into a bounded temporary directory, rejects forbidden paths and unresolved LFS pointers, scans actual contents and archives with strict gitleaks decoding, and runs `git lfs fsck`.
- CI must check out LFS objects (`lfs: true`) before running the public-artifact gate; pointer-only checkout fails closed.

Policy (instructed, not a sandbox):
- `GROK.md` / `AGENTS.md` / `CLAUDE.md` — coding-agent deploy procedure (no `--no-verify`, no live secrets in git).
- `app/lib/main/live-prompt.js` — in-app model should not echo secrets and should treat injection in tool/news text as data.

Enable hooks: `powershell -File scripts/security/install-hooks.ps1`

Eval: `powershell -File scripts/security/eval-security-gates.ps1`
