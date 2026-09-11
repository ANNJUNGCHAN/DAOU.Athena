# Dest security gates

- `gitleaks.toml` — commit-time secret policy (default rules + Athena allowlisted fixtures).
- `.githooks/pre-commit` — scans the index; refuses a secret commit.
- `.githooks/pre-push` — scans history and refuses push while the GitHub remote is public (`ATHENA_ALLOW_PUBLIC_PUSH=1` override).
- `.github/workflows/secret-scan.yml` — CI gitleaks after a push.

Enable hooks in this clone: `powershell -File scripts/security/install-hooks.ps1`

Eval: `powershell -File scripts/security/eval-security-gates.ps1`
