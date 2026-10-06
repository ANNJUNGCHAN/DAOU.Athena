# rest-state: portable public fixture

The independent review correction is installed and was freshly rerun from the current product source. `renderRestStateCard` now stamps `data-rest-state`; the compact status-card CSS uses only that marker. Workflow cards continue to use `data-screen-state` without the REST marker.

The baseline and corrected candidate each rendered 44 states and 44 captures. The corrected candidate had zero issues, external requests, provider calls, private reads or renderer exceptions. A separate comparison measured event, guarded-order action and OAuth status cards in every state; all 44 sets retained identical card/body geometry and flex/min/max/align properties, with zero REST marker leaks. Reports and PNGs are under ignored `.omc/artifacts/card-ui-handoff-resume/rest-state/runs/`; the prior broad-selector run is preserved below `runs/archive-broad-selector/`.

After npm dependencies are installed under app, Node syntax and manifest verification can be performed without launching Electron. launch.mjs defaults to PREPARED_ONLY_NO_EXECUTION. Explicit --execute-reviewed plus --fixture-mode=baseline orcandidate is required only after independent entry review and exclusive renderer approval. Run variants sequentially, record exact owned exit/PID absence, preserve existing results. Fresh fixture profile stays below ignored .omc output; never copy or load existing profiles.

The original Date V3 candidate was actually rendered in18 states and achieved a scoped PASS, with a formal independent review. Prior date V2 reports are18states each; candidate10pass8fail. Four illustrative prior V2 synthetic PNGs are included, not native screenshots. The REST fixture covers11cases4stages44states each. Normal chart is CSS height control, not a mounted plot. This scoped public renderer result is not native-app or all-card approval.

The snapshot node_modules directory contains only frozen public standalone library inputs and their licensing. It is not an installed dependency tree. Nested .gitignore explicitly allows these public source snapshots so GitHub handoff does not silently omit them.
