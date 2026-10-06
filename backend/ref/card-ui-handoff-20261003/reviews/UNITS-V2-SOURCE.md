# Company information unit V2 independent source review

Verdict: **APPROVE exact three-file standalone source candidate**, subject to the baseline byte guards below. Reviewer: account_candidate_review; author: card_readiness_investigation. This is a separate review pass. Product writes, staging, commit, app execution, native input, provider calls and network calls by this reviewer: 0.

The approval covers installing these three files on the reviewed unchanged display-policy baseline. It does not approve a future merged chart/main candidate, successful live card invocation, the actual identity of the native company card, or completion of all 94 card checks. Post-install source verification and native maximum/narrow/remaximum checks remain separate. **Native verification of this candidate: NOT_RUN.**

## Exact inputs and installation scope

Author folder: `.omc/artifacts/card-ui-audit/company-info971-unit-v2-candidate/`.

| File | SHA256 |
| --- | --- |
| AUTHOR-FREEZE.json | 142452a58023fef93a638ddfcdfb71cc55d364f295ccc1f8c59f9dd554266f8b |
| AUTHOR-PREPARATION.md | 08396eea50ee0f3390cd71db5681bbb410981149ede5554d7e21bcf7a2fce52d |
| candidate/app/lib/build-board-display-policy.mjs | 5d5aa699fa90410f66e7c05fd59b4c592ac8e41ca668541a504bf738f659f2fc |
| candidate/app/lib/board-display-policy-data.js | bd7a74b6cc10d1b0fa7ca580dfac805774145ea5c441f2e4dd7e34a0a0eead28 |
| candidate/app/lib/board-display-policy.js | 5b29d0939673cbd81dac1f2c1ecc3c7fac9ab1c9ecce780218a651a3294bd770 |

Required installed baseline hashes are builder `5d8b3e529d52e63e3b8ce6d7ea7df9ea234ebca360c0dd56f039c2df37641ebe`, generated data `283fb40a4b87f57c8d98b83698af4d908989b5b0c2907d7241d6a0cfbad7fd5e`, and consumer policy `9b6790b4f03ccdb8e2aa2dd8a3d523563875b6201365cca9be88fb3e1a8a9d4d`. The independent run checked all author frozen files and baseline/dependency pins before copying or running them. If an installation guard differs, this approval does not authorize overwriting that changed source.

## Source findings

The canonical binding source is `backend/ref/card-surface-templates/2RBO-1/slots.json`; generated policy is derived from `app/lib/build-board-display-policy.mjs`. The candidate uses that builder override and regenerates `board-display-policy-data.js`, instead of editing compiled template bindings or the global formatter. The original builder recreates the installed original generated data byte for byte; the candidate builder recreates the candidate data byte for byte. The only changed board is `2RBO-1`, and the only changed rules are `s005`, `s006`, `s021`, `s024`, `s041`, and `s044`.

The resulting units are current price and price change in 원, and PER/PBR in 배. Existing precision, sign, tone, and current-price absolute formatting remain as originally defined. The s005 rule keeps its original price role. Neither unknown share-count units nor unavailable times are invented. Other boards, backend, the actual compiled registry, mount consumer, and global formatter remain unchanged.

The additional policy consumer code is narrow. It requires board/slot/field allowlist agreement, canonical field provenance, full source-format agreement, and full expected candidate-format agreement. For the real compiled contract, where `f` is absent, reviewed canonical provenance supplies the binding only after these format checks. An explicit runtime `f` mismatch still rejects the override. A malformed or incomplete provenance record rejects it. The independent inspection found no widening to unrelated cards or fields.

For a provided display string, a unit is appended only to a complete numeric string with a present numeric bound value. Existing units, percent/mixed strings, prose, unavailable values, and metadata mismatches retain their original behavior. In the price path, the original zero-price guard still yields `—` and `missing: true`; it is not turned into `0원`. This addresses the rejected V1 regression. Original missing labels are preserved in the bound-format path.

The diff is localized: builder 4 added lines, generated policy additions for six rules, and consumer 44 added lines. Original mixed line endings were retained outside the edited spans; no broad line-ending or whitespace normalization was found. No placeholder branch, skipped test, fake provider implementation, or app readiness bypass forms part of this candidate.

## Independent verification

The reviewer read the complete author preparation, frozen pins, generator and consumer changes, actual mount/format consumer harness, and the reported result. In the independent folder, `audit.mjs` checks pins, copies the exact original/candidate three files, imports the actual original generator and candidate generator in memory, and executes their actual serialization body without writing product output. It then runs the copied frozen actual-consumer harness against the independent candidate copy. This is a source-consumer replay, not an Electron or native-card run.

Terminal `f67822` completed with overall exit 0. Actual consumer replay: **338 checks PASS**, consumer exit 0. Its result includes canonical and actual compiled contracts, the current-price zero regression, existing-unit/bare display inputs, positive/negative/large/missing values, unchanged parent cases, and field/format/provenance mismatch guards. The independent zero-price output before and after is exactly `{slotId:"s005", text:"—", tone:null, missing:true}`. There are no skip/todo substitutes for these checks.

Three `node --check` runs exited 0. Three `git diff --no-index --check` runs produced zero diagnostics; their exit 1 denotes differing files, and the audit checks that expected status explicitly. The enclosing audit exited 0. Baseline and candidate build equality and exact one-board/six-slot scope assertions passed.

Evidence in this reviewer-owned folder:

| File | SHA256 |
| --- | --- |
| audit.mjs | 1a82ea840bbcfc70658e8c3305deb386c34627d7a908d8f35a0a79cbafe74b58 |
| AUDIT-RESULT.json | 92dd42d441e26fa3849725fb2a7b168757b5f93919b03bbe880b9b84b562ca48 |
| CONSUMER-RESULT.json | 230fd0a28231337317ec170081d0d4e230fa87335fd69acb4b48b089afbc1a56 |
| consumer-output.txt | 02a537aefd35cf80dedabd5f265a9d5ba10a81ef109dcc7f5cd86e6119c02631 |

The standalone source change is reviewable and approved at these exact bytes. Live rendering, overflow and unit appearance must be verified after root installs and starts the reviewed product source. Prior screenshots 971–974 established a public-source unit-contract inconsistency, not clipping of the first price glyph; they are not evidence that this new candidate has rendered successfully.
