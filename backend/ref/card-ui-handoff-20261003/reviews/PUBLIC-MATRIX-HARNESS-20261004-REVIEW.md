# Public matrix harness independent review — 2026-10-04

## Verdict

**APPROVE for the bounded isolation/entry gate; `calibration-02` is `PUBLIC_SYNTHETIC_MATRIX_ISSUES`.** The entry approval applies to the harness at the hashes below. The fresh run is not a matrix pass, native UI evidence, provider correctness, Paper preservation, or completion of any of the 94 native states.

Reviewed files:

- `verification/public-matrix/run.cjs` — SHA-256 `A7B296EABBB4733ACDA5B306451FBA66C0BA6693335AB6E329F685772C796B08`
- `verification/public-matrix/README.md` — SHA-256 `E3141736551E981F72DD4545D0E9BEE541DF5434985146FBFAFA496F33E075DA`

## Review history

The first review requested changes because missing renderer errors and stage identity could pass, geometry checks were vacuous for empty footer/table/scroll cases, same-card evidence used a copied nonce instead of object identity, the completion status was too broad, the operational path was ignored, source pinning and network blocking were incomplete, teardown could leave stale cards, and primary renderer checks did not prove their actual child renderer was mounted.

The next review found two remaining false-pass paths: the lower-boundary check only required any finite visible node, and the five primary renderers only required DOM presence. The final revision closes both paths by requiring every observed vertical scroller to reach its end, the bottommost authored node and authored footer to remain within the surface/card bounds, and each primary marker plus its real chart canvas or orderbook node to be connected, visible, and non-zero-size with no primary error.

Three subsequent runtime attempts correctly exited non-zero or reported issues and produced no public-matrix pass. The first exposed teardown through a removed board-header control. The next used the owning product tab close contract and retained 27 completed state results, then exposed a `2U5L-1` watchlist fixture/input mismatch followed by missing-card cleanup. The third, `calibration-01`, mounted 90 standalone roots with exact size and same-DOM evidence, then reported the remaining primary, control, and geometry failures. These failures were preserved as evidence rather than weakened into alternate pass paths.

The reviewed runtime correction identifies the newly created product card by its product `sessionCardId` before checking the expected board ID. It records the actual board/card/kind/render/load/tab metadata, keeps a mismatch or null board ID in `missing`, and closes that actual card through its owning `.canvas-tab-close` path. It does not write a requested board ID into product DOM or remove DOM directly. `2U5L-1` receives observation-entry `slot_values`, as required by the current product reconciler, and uses the current `base:ka10095` watchlist operation reference present in the questionnaire/template index.

The final calibration corrections fix the root measurement contracts exposed by `calibration-01`: exact device scale/zoom and content-size settling; post-scroll surface coordinates; real horizontal and vertical scrollers selected from computed overflow plus positive overflow; endpoint containment within both surface and card; footer geometry in one coordinate vocabulary; registry control labels included in exact canonical pairs; non-zero rendered controls required; and numeric epoch seconds for the authored minute-chart fixture. They do not suppress the earlier failures or add a passing fallback.

## Final findings

No CRITICAL, HIGH, MEDIUM, or LOW issue remains in the reviewed isolation/entry source scope. One MEDIUM diagnostic-precision issue was exposed by the fresh run and then corrected without rewriting the run evidence:

- **[MEDIUM, resolved in current source] A control node could satisfy an alias pair but fail its required canonical pair.** The `calibration-02` source stored only the first `controlsPlan.all.find(...)` match as `exactPair`, then compared that one pair's canonical `control`. For `133H-2`, the rendered `3ODO-0` node carries both accepted labels, but the first match was the inherited `금현물` link, so the required `금현물 잔고·거래내역` link was reported missing in all three stages. Current `run.cjs:559-565` evaluates each required link directly against every rendered node's exact target plus accepted-label intersection. `invalidActual` still fails any rendered node that matches no registry pair. The historical `calibration-02` report remains unchanged and is not upgraded.

- The manifest is fail-closed at 94 unique public IDs, rejects all seven live-order IDs, asserts the exact five current primary-renderer mappings, and requires current display policy for every row.
- The harness uses the product `shell.html`, preload, canvas ingress, generated board registry/chunks, board mount path, and primary chart/orderbook renderer. It does not start `main.js`, a backend, provider sessions, an existing profile, or an order execution path.
- A fresh non-persistent Electron partition and output-local user/session directories isolate the run. Permission requests and new windows are denied. A `file:` URL is allowed only when its resolved real path remains inside the checkout's `app/` tree; `data:` and `blob:` are the only other local schemes. An out-of-root file URL is blocked and recorded without exposing its local path. Blocked attempts are evidence and make the run fail.
- A reviewed execution requires a lowercase slug `--run-name`; its output remains below the fixed ignored parent and an existing run directory is never overwritten. The product preload, shell resources, all generated board chunks, and both chart modules are pinned before launch and rehashed after all states.
- The extra shell boot IPC handlers are explicit empty or neutral fixtures for the eleven read-only views observed in the failed run. They contain no financial values, provider/profile state, stored conversations, or mutation channel.
- Each standalone state requires exactly one mounted product card, strict renderer-side object identity through max → narrow → remax, exact content and viewport sizes, the expected board ID, connected DOM, non-vacuous lower and final-column evidence, authored footer/table/control coverage, and complete teardown to zero cards.
- Scroller evidence enumerates only measurable elements whose computed axis overflow is `auto` or `scroll` and whose scroll extent is positive, records each endpoint, and fails unless every observed scroller reaches its real end. Footer, table, final-column, and lower-boundary endpoints must be non-zero and remain inside their applicable surface/card/clipping-owner bounds.
- Required controls pass only when the rendered node has non-zero geometry and an exact canonical target/accepted-label pair. Unmatched rendered controls remain failures. Interaction itself remains unverified and is reported as such.
- The four historical `4A*` ranking-filter IDs remain explicit `NOT_EXERCISED_OVERLAY` issues tied to their `13K0-2` product root. The capture allowlist rejects them because they do not mount as standalone roots.
- Renderer console errors, network attempts, source drift, missing states, size/identity/geometry/control/primary failures, or teardown failure prevent `PUBLIC_SYNTHETIC_MATRIX_PASS` and produce a non-zero exit.
- The result remains explicitly bounded as `PUBLIC_SYNTHETIC_PRODUCT_RENDERER_ONLY`, `nativeValidation: false`, and `nativeCompletedStates: 0`.

## Static validation

- `node --check verification/public-matrix/run.cjs` — exit 0.
- Default preparation-only invocation — exit 0 with `PREPARED_ONLY_NO_EXECUTION`, 94 states, three stages, five primary mappings, and 155 pinned renderer resources.
- Overlay-only capture ID `4A9H-1` — exit 1 before Electron.
- Four capture IDs — exit 1 because the reviewed capture bound is three.
- Traversal-shaped run name `../escape` — exit 1 before Electron or output creation.
- No `TODO`, `FIXME`, `test.skip`, `test.only`, or credential-assignment marker was found in the two reviewed files; trailing whitespace count was zero.
- The harness and README are not ignored under the tracked `backend/ref/**` exception.
- No language-server diagnostic endpoint was available in this review lane; `node --check` was the applicable parser diagnostic for this CommonJS harness.
- No Electron renderer or native UI was launched by this independent review lane. The parent-owned run is judged separately below from its fresh `report.json`. Irrespective of that result, native completion remains 0/94.

## `calibration-02` runtime result

The fresh result at `.omc/artifacts/card-ui-goal-20261004/public-matrix/calibration-02/report.json` (SHA-256 `FB9EC1D03667393BDA1771028E331DDDDFF9D44F47099BF6A4564848D5EF575A`) is **not approved as a pass**:

- Status is `PUBLIC_SYNTHETIC_MATRIX_ISSUES`, with evidence level `PUBLIC_SYNTHETIC_PRODUCT_RENDERER_ONLY`.
- 90 standalone roots mounted across 270 max/narrow/remax observations. The remaining four historical IDs are the explicit `NOT_EXERCISED_OVERLAY` entries and remain missing.
- Stage-contract failures: 0. Same-DOM failures: 0. Primary-renderer failures: 0.
- Control-failure boards: 13. The `133H-2` item includes the historical harness alias collision described above; the remaining reported entries are rendered-but-unregistered pairs, a missing required navigation control, or an unmeasurable product surface and remain unresolved evidence rather than passes. The current-source correction was syntax/preparation checked but not Electron-rerun, so this historical count remains authoritative for `calibration-02`.
- Geometry-failure boards: 18. The report preserves missing/non-zero endpoint, authored footer/table-count, and containment failures by stage. This review does not convert those observations into product defects without the separate design/metadata reconciliation.
- Source drift: none. Network attempts: 0. Renderer errors: 0. Provider calls, private-profile reads, and product writes: 0.
- Nine selected public-synthetic PNGs exist and every file hash matches its report entry. Image inspection is owned by the parent review lane; hash agreement alone is not visual approval.
- `nativeValidation` remains false and `nativeCompletedStates` remains 0. The run cannot satisfy the native 94-state goal or Paper-preservation gate.

The run behaved fail-closed: it kept the issue status despite completing the renderer cycle and despite the control diagnostic false negative. The accurate downstream statement is that the calibrated public-synthetic run improved coverage and exposed unresolved evidence; it did not complete the card UI goal.

## Related Claude authentication error scope

The separate change in `app/lib/main/claude-agent-session.js` (SHA-256 `191C3947377345E547728913DE144BFA4E55745B47DA90A45E2182056BF8F3BA`) and `app/lib/main/claude-agent-session-error.test.mjs` (SHA-256 `A9FDD7DB56159EA18A6EF7423FD6D95992B9E416626134C65B6C72AD10737D04`) is also **APPROVE** in its bounded source scope. The formatter translates only the exact, anchored Claude OAuth-expiry signature into the Korean Claude reauthentication path; generic 401, incomplete authentication text, other OAuth failures, and a matching signature with appended detail remain unchanged. The targeted test passed 2/2, and the post-change full unit suite passed 802/802 with zero failures, cancellations, skips, or TODOs. The Electron main process has not been restarted, so live UI confirmation remains open and is not claimed here.
