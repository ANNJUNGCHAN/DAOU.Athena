# WTS foundation protocol

This directory is the canonical wire contract shared by the ATHENA Chrome
extension and its user-local Native Messaging host.

- `wts-foundation.protocol.schema.json` defines strict version 8 request,
  response, observation, local financial-profile, job, and card-page shapes.
  Fixed-shape objects reject unknown fields. The two intentional dynamic maps
  (canonical query arguments and table rows) bound their key count, key length,
  and scalar values; semantic validation also requires row keys to exactly
  match the ordered columns.
- `wts-foundation.mjs` provides the dependency-free validator used by both
  browser and Node.js consumers.
- The maximum serialized message size is 128 KiB. Large screenshots, raw HTML,
  cookies, form values, selectors, executable actions, and arbitrary code are
  deliberately outside this foundation protocol.

Consumers must package or load the exact schema file rather than maintain a
second copy. A browser bundle can fetch the packaged JSON resource; the local
Node.js runtime can load the same file from disk. The protocol module itself is
browser/Node-neutral and does not perform file or network I/O.

Version 7 added eight fixed financial-read methods:

- `source.credentials.status|configure|delete`
- `source.query.start|status|page|continue|cancel`

The credential methods expose only bounded profile summaries and asynchronous
mutation state. Configure is the sole request that may carry an app key and
secret key; validation errors contain constant paths and never echo submitted
values. Query requests contain a profile ID, canonical operation reference,
and bounded scalar arguments, with no URL, header, selector token, or arbitrary
transport field.

`FINANCIAL_ERROR_CODES` and `FINANCIAL_ERROR_MESSAGES` are frozen,
one-to-one public exports. Native and backend boundaries reuse those exact
constant messages; arbitrary upstream, exception, or submitted text is
rejected.

Financial success responses use only `wts-financial-card-1`. Facts, table,
compound, and chart variants bind their render kind, renderer ID, and data
kind. Each card page is limited to 96 KiB inside the unchanged 128 KiB Native
Messaging envelope. Page bounds and opaque-token boundaries are checked, table
rows must preserve the exact ordered column keys, and job/mutation state
transitions reject inconsistent terminal data. Raw responses, signed plans,
broker continuation keys, credentials, tokens, and account identifiers have
no field in the public card contract.

`runtime.hello.source` remains the version-6 metadata-only capability object.
Version 7 added a separate required `financial` sibling that advertises the
fixed method order, four render kinds, query-only behavior, and explicit
credential setup. Hello does not start a backend or claim credential/token
readiness.

Version 8 adds the nine fixed `provider.*` methods and exact static
`runtime.hello.provider` metadata for the source-only Native ChatGPT bridge.
Provider operation IDs, submission IDs, and cancellation IDs are lowercase
canonical UUIDs. The validator binds operation kind, lifecycle state,
revision, cancellability, typed result, and fixed error code/message pairs;
it also enforces the 100-entry model catalog and PlanningClient Unicode and
UTF-8 limits. These fields report source protocol capability only and do not
claim installed UI, authentication, inference, or WTS execution readiness.
The current source `runtimeVersion` is `0.8.0`, matching the local-runtime and
extension package identities.

The committed fixtures under `tests/fixtures/` preserve the complete
pre-version-7 module and 125-definition schema. Regression tests normalize
only the protocol-version constants, the approved `runtimeVersion`
`0.6.0` to `0.8.0` identity delta, and the explicitly additive version-7 and
version-8 surfaces before comparing every old definition.

Capability detail cards carry argument form metadata through the dedicated
`sourceArgumentField` definition. Every required and optional argument has a
mandatory camel-case `jsonSchema` containing exactly either
`{type:'string'}` or the ordered string/null, default-null form. Required
entries must report `required:true`; optional entries must report
`required:false`. The original `sourceField` definition remains unchanged
for `responseFields`, which do not accept `jsonSchema`.

Version 6 preserves the complete `wts-chart-pilot-1` and
`wts-chart-pilot-2` proposal, receipt, and task families while making
`wts-main-control-3` current. Public persisted-record validators accept all
three complete families and reject mixed catalog, compiler, observation,
action-argument, target, and active-proposal identities. Catalog 1 remains
bound to compiler 1 and day/week; catalog 2 remains bound to compiler 2 and
day/week/month/year. Catalog 3 uses deterministic compiler 3 and adds the two
fixed market-navigation actions over the immutable 25-target catalog.
The existing Chrome storage keys remain `wtsControlTaskV3` and
`wtsControlReceiptsV2`; this source release does not migrate, relabel, or
delete either store. The chart methods remain:

- `runtime.hello` reports the exact current `wts-main-control-3` action catalog,
  compiler identity, and 25-target market profile.
  Screen control is limited to opening the main P3 chart and selecting
  day/week/month/year.
- `inventory.record` stores one atomic capture containing 1–16 sanitized WTS
  frame observations on the user's PC. The caller must reuse the same capture
  ID and exact body when retrying an uncertain request.
- `inventory.summary` returns separate capture and observation counts for
  partial discovery progress.
- `control.plan` parses only the fixed Korean chart commands against a fresh,
  top-frame current-catalog observation and returns either a short-lived
  catalog-2 proposal or a fail-closed terminal status.
- `control.receipt.record` stores a strict execution receipt that is bound to a
  proposal issued by the same native process.
- `control.task.start` compiles one complete bounded Korean chart request and
  stores the task idempotently by submission ID.
- `control.task.get` reads the latest persisted task state.
- `control.task.next` binds one fresh observation to the current task step and
  persists a proposal before returning it.
- `control.task.step.commit` reconciles one canonical receipt against the
  persisted proposal and advances only after both receipt and task storage
  succeed.
- `control.task.cancel` cancels before execution or records a stop request that
  retains an outstanding proposal until its uncertain result is reconciled.

Legacy terminal tasks and exact outstanding-receipt recovery remain readable.
The contract does not authorize dispatching a catalog-1 or catalog-2 ready
task through the current adapter, and it does not rewrite stored records.

Version 6 adds exact `wts.main.sitemap.open` and
`wts.main.p1.market.navigate` actions. Both accept only `{targetId}` for one
of the 25 frozen targets. A verified opener receipt requires the exact sitemap
and requested target to be visible and available; a verified navigation
receipt requires the sitemap closed and the requested target active. Both
retain the same tab, window, document, and hashed instrument binding.

Version 4 added a metadata-only local source boundary:

- `backend.status` reports the configured lifecycle without starting Python.
- `backend.ensure` lazily starts the configured read-only backend and returns
  only a ready status.
- `source.manifest` returns the exact read-only profile, API version, catalog
  identity, and bounded operation count.
- `source.search` accepts only a trimmed 2–500 character query, a 1–5 result
  limit, and the expected `sha256:` catalog identity. It returns one direct
  flat `capability-list` card.
- `source.describe` accepts only a bounded operation reference and expected
  catalog identity. It returns one direct flat `capability-detail` card.

The hello response keeps the original source object metadata-only with
financial query and external AI disabled. Source requests contain no URL, path, header,
timeout, intent, or arbitrary transport field. Source cards reject unknown
fields and preserve upstream non-query text exactly; only search query text is
trimmed before it enters the wire request.

Version 5 adds one deterministic, classification-only conversation boundary:

- `conversation.route` accepts only an exact UUID submission ID and trimmed
  1–512 character text.
- Existing complete chart commands route to `wts-control` with normalized
  text only when the current deterministic chart compiler accepts them.
- `조회 기능 찾아줘: 검색어` routes to `source-search` with a trimmed 2–500
  character query. Every other input returns the fixed unsupported message.

Routing does not start the read-only backend, create a chart task, read an
observation, or write a store. The hello response reports the exact two routes
under `deterministic-wts-conversation-v1` with generative behavior disabled.

The wire contract contains no stock label, input value, selector, raw HTML, or
arbitrary executable action. A browser adapter hashes the visible public stock
label separately into `instrumentToken` and includes that token in the
structural `contextToken` before transmission. This lets a verified receipt
prove that the instrument stayed fixed while the screen state changed. LAYA
and a generative local planner remain explicitly disabled. The hello response
labels the active compiler as deterministic and reports `localModelReady:false`.

Run the contract checks with:

```powershell
node --test contracts/tests/wts-foundation.test.mjs
```
