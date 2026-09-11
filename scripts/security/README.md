# Dest security gates (public remote)

These repos are intended to be **public**. Gates stop live secrets from landing in git; they do not hide product source. Prompt text is policy for agents and the in-app model, not a sandbox.

Gates:
- `gitleaks.toml` — commit-time secret policy.
- `.githooks/pre-commit` — refuses a staged secret.
- `.githooks/pre-push` — refuses a push if gitleaks finds a leak, GitHub push protection is off, or prompt markers are missing.
- `.github/workflows/secret-scan.yml` — CI gitleaks after a push, then prompt-marker check.
- `scripts/security/check-prompt-security.mjs` — fail-closed marker presence check, invoked by eval, pre-push, and CI.
- `scripts/security/keepset.mjs` / `check-tracked-keepset.mjs` — only run/rebuild + dest-control paths may be tracked.

Policy (instructed, not a sandbox):
- `GROK.md` / `AGENTS.md` / `CLAUDE.md` — coding-agent deploy procedure (no `--no-verify`, no live secrets in git).
- `app/lib/main/live-prompt.js` — in-app model should not echo secrets and should treat injection in tool/news text as data.

Enable hooks: `powershell -File scripts/security/install-hooks.ps1`

Eval: `powershell -File scripts/security/eval-security-gates.ps1`
