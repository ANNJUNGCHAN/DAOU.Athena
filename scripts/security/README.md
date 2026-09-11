# Dest security gates (public remote)

These repos are intended to be **public**. Gates stop live secrets from landing in git; they do not hide product source.

- `gitleaks.toml` — commit-time secret policy.
- `.githooks/pre-commit` — refuses a staged secret.
- `.githooks/pre-push` — refuses a push if gitleaks finds a leak, or if GitHub push protection is off.
- `.github/workflows/secret-scan.yml` — CI gitleaks after a push.

Enable hooks: `powershell -File scripts/security/install-hooks.ps1`

Eval: `powershell -File scripts/security/eval-security-gates.ps1`
