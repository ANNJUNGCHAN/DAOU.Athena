# Public card UI matrix harness

This harness mounts the current checkout's real `shell.html`, product preload,
`canvas.js`, generated board registry, and `board-mount.js`. It injects only
deterministic public synthetic envelopes through the product
`athena:add-canvas-live` IPC ingress. It does not start `main.js`, a backend, a
provider, or an existing Athena profile.

The default command performs source/manifest checks only and does not start
Electron:

```powershell
node backend/ref/card-ui-handoff-20261003/verification/public-matrix/run.cjs
```

After independent entry review and an exclusive renderer slot, run exactly:

```powershell
app\node_modules\.bin\electron.cmd backend/ref/card-ui-handoff-20261003/verification/public-matrix/run.cjs --execute-reviewed --run-name retry-01
```

To retain three-stage public screenshots for up to three canonical IDs, add a
comma-separated allowlist. Each selected ID produces max, narrow, and remax
PNGs plus SHA-256 entries in the report:

```powershell
app\node_modules\.bin\electron.cmd backend/ref/card-ui-handoff-20261003/verification/public-matrix/run.cjs --execute-reviewed --run-name calibration-01 --capture-board 137X-2,13BC-2,2U5L-1
```

`--run-name` is a lowercase letter/digit/hyphen slug and must be new for every
execution. The reviewed run creates only
`.omc/artifacts/card-ui-goal-20261004/public-matrix/<run-name>/`, including fresh
isolated Chromium user/session data and `report.json`. It refuses to overwrite
an existing run. HTTP(S) and WebSocket requests are cancelled and recorded by
scheme. `file:` resource URLs are allowed only when their resolved real path is
inside the checkout's `app/` tree; `data:` and `blob:` remain local-only
exceptions. Out-of-root file attempts are cancelled and recorded without their
local path. Window creation, navigation, and permissions are denied outside
that local closure.
Every JS/CSS file loaded by `shell.html`, the product preload, all generated
board chunks, and both chart modules are SHA-256 pinned before and after the
run. Seven live-order surfaces are excluded and asserted absent. No order
operation is sent.

The shell boot reads only explicit, neutral public-fixture responses: empty
conversation, account, routine, MCP, backtest, and strategy lists; disconnected
CLI entries; completed onboarding; a ready empty boot snapshot; and null model
preferences. These responses contain no financial values, provider state,
private profile, or stored conversation and invoke no mutation.

For each of the 94 public state IDs, one product card DOM is retained while the
offscreen BrowserWindow content size cycles through 2560x1392, 1411x1166, and
2560x1392. The isolated Electron process fixes its device scale factor and web
contents zoom at 1, waits for the exact main-process content size and renderer
viewport, and records attempts, elapsed time, devicePixelRatio, zoom, and
VisualViewport values at every stage. It also waits until the product boot is
hidden and the shell, app, and grid have measurable geometry before the first
card. The report keeps same-DOM identity, actual content/card/surface
geometry, non-vacuous vertical and horizontal endpoint evidence, authored
footer expectations, wired state controls, and the five authored primary
renderer mount markers plus their actual chart canvas or orderbook node as
separate observations. Same-DOM evidence uses a strict renderer-side element
reference. Each state must own exactly one card, and teardown waits until that
exact card is disconnected and the active-card count is zero. Board surfaces
close through their owning product tab's `.canvas-tab-close` contract; the
harness never removes product DOM directly.

The new card is identified independently by the product `sessionCardId`. Its
actual board ID, card ID/kind, render state, load error, and owning tab key are
recorded before the expected-board assertion. If routing or loading produces a
different board (or no board ID), that state remains `missing`, but the actual
new card still closes through its owning product tab so later states can run.
The watchlist state `2U5L-1` uses its current product contract: canonical
`base:ka10095` routing and observation-entry `slot_values`. No requested board
ID is written into product DOM or renderer state. The three watch-source boards
`2UBO-1`, `3D4I-0`, and `3EWN-0` also use observation entries plus explicit
source context. `2UBO-1` records both canonical theme list/detail operations;
the detail boards use `base:ka10095`. The three chart primaries use their
authored source mappings (`ka10081` stock day, `ka50092` gold minute, and
`ka20006` sector day) with the same deterministic public OHLC shape used by the
date-axis verifier.

Vertical evidence requires every visible vertical scroller to reach its real
scroll end and the bottommost authored node to remain inside both the surface
and card bounds. An authored footer records its own rectangle and nearest
horizontal clipping-owner rectangle, must have non-zero size, and must remain
inside that owner/card horizontally and surface/card vertically. State-control
evidence separates required direct controls, required generated navigation,
inherited opportunistic controls, and actual wired nodes. Every actual visible
node must match a canonical control/target pair. Fixture-gated or inherited
absence remains `controlNotExercised`; this harness does not click transitions
and records `interactionVerified: false`. Primary
renderer evidence requires a connected, visible marker and connected, visible,
non-zero-size chart canvas or orderbook node with no primary error.

The four `4A*` ranking-filter IDs in the historical set are product popovers
over the `13K0-2` ranking root, not standalone board roots. This bounded
calibration run records them as `NOT_EXERCISED_OVERLAY` instead of rewriting a
product board ID or treating the parent root as those states. They therefore
keep the overall synthetic matrix in issue status until a separate real-control
popover interaction check is reviewed.

This is a public synthetic product-renderer check. It is not native UI evidence,
provider correctness, private-account validation, or proof that a real query
selected the same template ID. A missing fixture or renderer is recorded under
`missing`; it is never converted into a pass.

The only passing status is `PUBLIC_SYNTHETIC_MATRIX_PASS`. Any renderer console
error, blocked URL, source drift, viewport mismatch, disconnected/wrong board,
missing endpoint/control/footer, primary error, or teardown failure yields an
issue/failure result. The report always records `nativeCompletedStates: 0`.
An interrupted run persists `run-error.json` with its completed state results,
missing list, invoked channels, source pins, and terminal error.
