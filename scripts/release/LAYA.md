# LAYA CPU bundle

The default Windows installer requires an explicit, verified LAYA bundle. It
contains the currently adopted Athena v018 checkpoint and force-choice policy,
the LAYA SDK, CPU-only PyTorch, their pinned dependency wheels and model notices.
Training data, credentials and user profiles are not part of the bundle.

For future model/state releases and the linked public training records, follow
[학습 산출물 보존·공개 지침](TRAINING-ARTIFACTS.md). It covers Release packaging,
Git provenance records, split-file restoration and publication verification.

Obtain `Athena-LAYA-v018-cpu-bundle.zip` from the same GitHub Release as the
installer, verify its SHA-256 against the release checksums, and extract it to a
build-input directory outside the source checkout. Read `notices/MODEL-TERMS.txt`
before using or redistributing the model components. The installer presents
these terms; all component notices remain available in the installed backend.

```powershell
python scripts/release/laya_bundle.py --source C:/build-inputs/Athena-LAYA-v018-cpu-bundle
pwsh -NoProfile -File scripts/build-windows-installer.ps1 -LayaBundle C:/build-inputs/Athena-LAYA-v018-cpu-bundle
```

The build requires a clean, committed checkout and Python 3.12.11 managed by uv.
It verifies every model/config/notice/wheel hash, installs the CPU wheels offline
with exact hashes and backend dependency constraints, checks dependencies, and
runs a real CPU forward pass before producing the installer. The final app
contains installed libraries but does not duplicate the wheel archives.

For source development, stage into a fresh `backend/laya-runtime` directory and
put build dependencies in a separate ignored directory:

```powershell
python scripts/release/laya_bundle.py --source C:/build-inputs/Athena-LAYA-v018-cpu-bundle --destination backend/laya-runtime --dependency-directory .omc/artifacts/laya-dependencies
uv export --project backend --frozen --no-dev --no-emit-project --output-file .omc/artifacts/backend-requirements.txt
uv pip install --python backend/.venv/Scripts/python.exe --no-index --find-links .omc/artifacts/laya-dependencies/wheels --require-hashes --constraint .omc/artifacts/backend-requirements.txt --requirement .omc/artifacts/laya-dependencies/requirements.txt
```

The backend discovers `backend/laya-runtime/bundle.json` after loading explicit
settings. With no manual deployment identity configured it uses its own Python,
CPU inference, a 30-second request timeout and a fresh private worker token.
Explicit `ATHENA_LAYA_*` settings remain authoritative. Missing/invalid bundles
and worker startup errors use the existing fallback and report their state;
they do not imply successful model loading.

## Package format

`bundle.json` schema version 1 contains `deployment_sha256`, a `files` map of
relative paths to SHA-256 digests, `notices` (a list of files under `notices/`), and
`dependencies` (name, version, wheel path and SHA-256 for each dependency).

Runtime files are `deployment.json`, `catalog.json`, `policy.json`, the five
checkpoint files bound by the deployment, and the listed notices. Deployment
paths must be `checkpoint`, `catalog.json` and `policy.json`. Wheel paths are
`wheels/<filename>.whl`; they are verified build inputs. Symlinks, reparse points,
path traversal, LFS pointers, mismatched metadata and non-CPU Torch are rejected.

The v018 checkpoint weight SHA-256 is
`2cde2e3a251a23a4477cf51b6faee4c55e7075306e646315b9589a5c94af280f`.
The active policy SHA-256 is
`d876114d9e34eb36098c682d76446f5f438039ca4b5f17e087259569d40cc721`.
Portable deployment paths change the deployment manifest hash, not the model
weights or policy. The release bundle and build receipt record that new hash.

This policy uses zero confidence thresholds and forces a non-defer choice. CPU
loading and inference verification do not establish accuracy for that policy.
Existing account permissions, per-order mock-account confirmation and the
exclusion of real-account orders and automated trading remain in force.
