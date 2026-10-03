# Company unit V2 installed source independent verification

Verdict: **APPROVE installed exact three-file source** against standalone review `caa2b42d946f929987b0b3651de0fae6ef00ee2c7eea384d95f2cc5389494722`. Reviewer account_candidate_review; root performed installation and installed-source execution. Reviewer product/native/provider/network writes or execution: 0.

Fresh product SHA256 readings (terminal `afcdf2`, exit 0) match all three approved candidates:

| Installed file | SHA256 |
| --- | --- |
| app/lib/build-board-display-policy.mjs | 5d5aa699fa90410f66e7c05fd59b4c592ac8e41ca668541a504bf738f659f2fc |
| app/lib/board-display-policy-data.js | bd7a74b6cc10d1b0fa7ca580dfac805774145ea5c441f2e4dd7e34a0a0eead28 |
| app/lib/board-display-policy.js | 5b29d0939673cbd81dac1f2c1ecc3c7fac9ab1c9ecce780218a651a3294bd770 |

The four previously approved account files are unchanged: main `78f680293c7cd53521f98f13269109b7dca5562f17c5bd85fdc4852e5778fc57`, selector `8559ee623b5fe178f74efd5ad6d48abbd90345c765a1f2fbf9739b29c6d6f5de`, helper `0f135119650095ce5a0bf3d799484539388f49649c019a6303fd774a5b71f014`, test `4d117be257ae7d97946d6b744b5e4e12978de70cb9376c0b5a4586deca406f11`. Git status is on `codex/athena-install-startup-20260930` with exactly these seven product files changed (five tracked modified and two new account files); staged diff is empty. Fresh `git diff --check` has zero diagnostics (terminal `635555`, enclosing exit 0). No chart candidate is installed within this observed scope. Git emitted permission warnings for the user global ignore file, which did not change these scoped file/hash outputs.

The full root installation receipt was read: `.omc/artifacts/card-ui-audit/company-info971-unit-v2-root-install/ROOT-INSTALL-RECEIPT.json`, SHA256 `6d342884df5dc6fbf2f397e1cf38695b5fb24af1ed9f8d2be41512772c48c80d`. It records eleven successful preinstallation guards, exact installed three pins, unchanged account main, and no staging/commit/push. Its guards cover the original display-policy baseline, unchanged mount/formatter/registry/canonical contracts and the frozen candidate copies.

The reviewer read all of root `check-installed.cjs` and its exact diff against the frozen approved `consumer.cjs`. The derivative changes only (1) original baseline location, (2) the after and invalid-metadata consumer paths to installed product policy/data, (3) nine exact product source guards, (4) the post-install status label and ignored result path. All 338 assertion bodies and actual mountPlan/prepareDisplayInput/unchanged boardFormat paths are preserved. There is no skipped assertion, stub replacement or narrowed case set. Checker SHA256: `bb59358a379f2715ca8b8b00d12ad86b4f53da0e95d1fa7a71ba0ec395e2fc0f`.

Root's actual installed-source run completed at terminal `37011d` with exit 0 and **338 PASS**. The reviewer directly read the result projection (terminal `875e8c`, exit 0) and full postcheck receipt (terminal `f48a24`, exit 0). These confirm actual compiled contract verification, unchanged three parent cases, 18 contract mismatch checks, 42 metadata guard checks, five wire cases and zero product writes/renderer/network runs by the checker. Root's run also retains current-price zero as `—`/missing true. Exact evidence:

| Evidence | SHA256 |
| --- | --- |
| ROOT-POSTCHECK-RECEIPT.json | 32996b7760ce10c173d9af3ca385a279e6bd835c910f00bbc62a70478f9f9df0 |
| INSTALLED-CONSUMER-RESULT.json | 6ea32f88e0cf2f6708e6a7eba5122f154631ff8c0c69eab4119ae6104d260079 |

An additional identical 338-run is unnecessary after the fresh exact-byte verification and preserved-checker review; the previous independent candidate run and root actual installed-source run cover the same approved source. This report distinguishes reviewer execution of the former from root execution of the latter.

Approval is installed source verification only. **Native verification remains NOT_RUN**: the receipt records runtime 29300 as still having the previous display-policy source loaded. This is not proof of successful unit rendering, maximum/narrow fit, actual native card template identity, chart merge safety, app readiness, or completion of all 94 card states. A normal new runtime and actual company-card verification remain root's subsequent work.
