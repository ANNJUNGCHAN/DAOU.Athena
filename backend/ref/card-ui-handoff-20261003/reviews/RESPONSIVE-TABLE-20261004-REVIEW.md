# Responsive table corrections independent review — 2026-10-04

## Verdict

**SCOPED APPROVE** for the four responsive-layout corrections in the reviewed source. This approval covers `133H-2`, the shared `3D4I-0`/`3EWN-0` quote-width formula, and the `13K0-2` fixed-footer containment rule. It is not approval of the full public matrix, native UI completion, Paper preservation, provider behavior, or the overall card UI goal.

Reviewed files:

- `app/lib/board-mount.js` — SHA-256 `E97F9327AC4559584DD18DF9B06F4CCE3A73C2A6301E750D0F9AF3ECC64456C8`
- `app/styles/board-surface.css` — SHA-256 `7642100C3A1B0D0C58717F0F4C3304A2FBB0A100C470D27C370EC94CCF1CA057`
- `app/lib/board-scroll-hint-layout.test.mjs` — SHA-256 `DAD4B4979D94459F3DCAEB232517102E95DA9BBB6AE0A1207E94C9036D9EFF5B`
- `app/lib/board-responsive-width.test.mjs` — SHA-256 `21F08114B80E7BBE2E22930A61CFA84FF5DFB808DC66869F6E7A834216636292`

## Spec and root-cause review

No CRITICAL, HIGH, MEDIUM, or LOW issue remains in this source slice.

- In `133H-2`, the readable hint used to be inserted after `14UQ-2`, making it a third flex item in the workspace. The hint appeared at narrow width, retained flex width after remax, narrowed the table owner, and therefore kept the overflow condition that kept the hint visible. The fix inserts the hint inside the actual `14UQ-2` scroll owner and makes `readableHintScroll()` measure that parent. Existing sibling-readable and ranking-hint directions remain unchanged. The scoped sticky-left CSS keeps the hint readable without making it a workspace sibling.
- In `3D4I-0` and `3EWN-0`, the prior quote-row widths were `54px + 2 * ((100% - 20px) / 2)`, which is exactly `100% + 34px` and matches the former runtime overflow. The reviewed formula is `54px + 2 * ((100% - 54px) / 2) = 100%`. It is applied only inside the existing two-board detail-panel branch.
- In `13K0-2`, the observed three-pixel mismatch belonged to fixed footer `33YY-0` under readable owner `33WD-0`, not to a clipped final data cell. The scoped CSS makes that footer follow the owner width. This review does not characterize the old observation as a data-column clipping defect.
- The changes repair the measured ownership and width contracts directly. They do not catch or suppress renderer errors, relax the public-matrix predicates, create an alternate rendering path, add a dependency, or touch provider/profile/order behavior.

## Tests and static checks

- `node --check` passed for `board-mount.js` and both new test modules.
- The two new test modules passed 5/5 with zero failures, cancellations, skips, or TODOs.
- The broader related layout selection passed 32/32 with zero failures, cancellations, skips, or TODOs.
- The final full app unit suite passed 807/807 with zero failures, cancellations, skips, or TODOs. Log: `.omc/artifacts/card-ui-goal-20261004/unit-after-responsive.log`, SHA-256 `B9E5FF44535224BB0351B3A52920727B8BE1F699CAE7881FC6ED180142FC2F10`.
- `git diff --check` passed for the four reviewed files.
- No language-server diagnostic endpoint was available in this review lane; Node parser checks and the repository tests were the applicable diagnostics for the JavaScript files.

## Runtime evidence

The first same-source run, `responsive-fix-01`, remained `PUBLIC_SYNTHETIC_MATRIX_ISSUES` and exited non-zero. Its report SHA-256 is `EC33C84AEB03BA63D85DF05E9FF37AAB524BCCF297A1078955847A2FFB585A1C`.

- `133H-2`, `13K0-2`, and `3EWN-0` recorded exact max/narrow/remax viewports, strict same-DOM identity, connected cards, complete endpoints, footer completion, and horizontal/vertical containment.
- `133H-2` restored the same 1440px card, 1360px surface, and final endpoint geometry after remax. Its max and remax PNGs have the same SHA-256, `6F0F2B9F867DA5C698C092F7C5E2F85E761E0E28B8D2DFF32474ADD650B4A463`.
- `3D4I-0` produced max and narrow captures but then raised `UnknownVizError`; the report did not retain that state as a completed three-stage observation. This run therefore supplies no full-cycle pass claim for `3D4I-0`.

The second same-source run disabled optional capture and completed all standalone states. Report: `.omc/artifacts/card-ui-goal-20261004/public-matrix/responsive-fix-02-nocapture/report.json`, SHA-256 `4FDE03A14887DE0952F5D8DB9CF2D58B05C4C88DEA86B9555B085EC99EE998CC`.

- 90 standalone roots and 270 stage observations completed. The remaining four historical IDs are the declared `NOT_EXERCISED_OVERLAY` entries.
- Stage-contract failures: 0. Same-DOM failures: 0. Primary-renderer failures: 0.
- All four reviewed targets recorded exact viewports, the same connected card through max/narrow/remax, zero outer overflow, complete footer and endpoint evidence, and surface/card containment.
- `133H-2` max/remax endpoint remained `1407/1433`, and narrow was `933/962`, all contained.
- `13K0-2` endpoints were exactly `1384/1384` at max/remax and `933/933` at narrow. Its two pre-existing unmatched control observations remain control failures and are outside this geometry approval.
- `3D4I-0` endpoints were `1500/1500` and `1019.5/1019.5` at max/remax, and both `933/933` at narrow.
- `3EWN-0` endpoint was `1500/1500` at max/remax and `933/933` at narrow.
- Source drift: none. Network attempts: 0. Renderer errors: 0. Provider calls, private-profile reads, and product writes: 0.

The matrix status remains `PUBLIC_SYNTHETIC_MATRIX_ISSUES`: 14 geometry-failure boards, 12 control-failure boards, and four overlay-only missing entries remain. `nativeValidation` is false and `nativeCompletedStates` remains 0. The evidence approves only the four responsive corrections named above.
