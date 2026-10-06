# Card UI resume independent review — 2026-10-03

## Verdict

**SCOPED APPROVE** for the installed date-axis patch, company-history spacing patch, REST status-card correction, questionnaire metadata update, and the unit-test harness recovery described below.

This receipt does not approve the remaining 94 native card states as complete. The public renderer runs are synthetic and the limited native observation covers one monthly chart only.

## Date axis

- The installed `app/lib/chart-card.js`, vendored `lightweight-charts-axis.mjs`, license, and notice match the independently reviewed V3 candidate byte-for-byte.
- The vendored library is Lightweight Charts 5.2.1 under Apache-2.0. The package dependency and lockfile were not changed.
- The patch changes the axis behavior at the previously reviewed boundary only. The regression test imports the actual upstream and installed modules and checks edge, interior, bold-label, and already-aligned behavior.
- Targeted verification passed: 2 subtests and 20 assertions. The fresh portable run rendered all 18 public month/week × max/narrow/remax × first/middle/latest states with zero boundary, overlap, network, renderer-error, or product-write findings. The minimum measured label gap was 34.375 px.
- The separate native observation contains five local, untracked captures for one monthly card: initial and restored 1920×1152 views plus three 954×1057 narrow views. Within that limited sequence, year labels remained visible without overlap or boundary clipping, the restored view recovered the initial axis layout, and the lower card boundary remained visible.

## Company-history spacing

- The installed `app/styles/board-surface.css` change is limited to the reviewed company-history board and its two intended child nodes below the 1279 px container threshold.
- The fresh isolated public renderer report covers 30 cases across five widths: 25 target-board cases over five content modes and five unrelated-board controls. It reports zero issues, renderer errors, external requests, or product writes. The unrelated comparison board retained its geometry and values.
- This is synthetic layout evidence. It does not establish a native template identity or complete the native card inventory.

## REST status cards

- The first installed candidate used the broad `.card[data-screen-state]` selector. Independent review requested changes because `data-screen-state` is also used by WebSocket, guarded-order, and OAuth workflow cards.
- The final correction fixes the root cause: `renderRestStateCard` stamps `data-rest-state`, and the compact-height/action CSS is scoped to that marker. Workflow stamping does not receive the REST marker.
- Fresh baseline and corrected-candidate runs each contain 44 mounted, same-DOM states and 44 capture hashes. Baseline reports 88 known issues; the corrected candidate reports zero. Both runs report zero external requests, renderer exceptions, timeouts, provider calls, private reads, or product writes, and both owned fixture processes were absent after completion.
- The added workflow probes measured event, guarded-order action, and OAuth status cards in every state. All 44 baseline/candidate probe sets retained identical card/body geometry and flex/min/max/align properties, with zero REST-marker leaks.
- `verify-current-source.cjs` confirms that the candidate consumer and CSS were extracted from the installed product source. The earlier broad-selector run remains preserved separately as failure evidence.

## Questionnaire metadata

- The live and candidate questionnaire appendices contain exactly rows 978–996, with all actual template IDs left unconfirmed.
- Rows 993–994 exclude UI/image evidence and retain `window: null`; rows 995–996 are `not_run` and remain linked to the failed request at 994 without claiming a resubmission.
- Rows 979/982 are limited to unit-fit evidence, row 981 to the lower boundary, and rows 985/990 to the final column. None of these rows claim whole-card, final-row, or native 94-state completion.
- The prior `REQUEST_CHANGES` receipt remains historical evidence; this receipt records the later corrected scope without overwriting it.

## Unit-test recovery and static checks

- Reviewed all 15 modified test files. The changes restore current VM dependencies and stubs, await asynchronous navigation where required, and update exact current declarations, source slices, and arguments.
- No assertion was deleted or weakened. Test counts were retained; no `.skip`, `.only`, TODO placeholder, or product-code workaround was introduced by this lane.
- The modified subset passed 181/181. A fresh independent full run of `npm run test:unit` passed 800/800 with zero failures, cancellations, skips, or TODOs.
- `node --check` passed for the 22 changed JavaScript/MJS/CJS files reviewed, JSON parsing passed for the four changed manifests/questionnaire files, and `git diff --check` reported no whitespace errors. No LSP diagnostic tool was available in this review environment, so syntax checks and the complete unit suite are the recorded diagnostics.

## Limits and stop condition

- Native verification is limited to one monthly card at 1920×1152 and 954×1057. The requested exact 2560/1411 native sizes, other card states, and actual template identity were not established.
- The public date, company, and REST renderer runs prove only their named synthetic fixtures. They do not substitute for the remaining native max→narrow→remax inventory.
- The reviewer did not use the Paper browser session, did not write to Paper, and did not establish a Paper template identity.
- No private screenshots, financial values, user profile data, credentials, or conversation data are included in this receipt.

The reviewed changes may proceed as the current scoped resume candidate. The native 94-state remainder stays open and must not be reported as complete.

## Current resume documentation review

`CURRENT-RESUME-20261003.md` and the README top pointer accurately distinguish the new scoped results from the historical handoff state. Their local links and listed evidence/product hashes resolve, including the corrected workflow-regression hash. The final unit log records 800/800 with no failures, cancellations, skips, or TODOs; the final security log records exit 0 and `ALL_GATES_PASS`. The remaining Paper and native 94-state work is explicit, and no private screen content or credentials are included. **Documentation review: APPROVE.**
