# ATHENA WTS Chrome extension

This directory contains the Chrome side-panel UI for the ATHENA WTS foundation, bounded WTS control, capability metadata, and the source 0.7 financial-read path for
`https://wts.kiwoom.com/`. It opens a side panel, connects to the local native-messaging host,
and records a bounded description of the current WTS frames only after the user clicks
**현재 화면 조사**.

After at least one capture is stored, the current protocol 7 preserves the strict Korean chart grammar introduced by protocol 3. A
single prompt may open the P3 chart and then select the daily or weekly period. The protocol 4 expansion retained in the current bundle extends the reviewed grammar to monthly and yearly periods. The whole
prompt must compile without unknown, ambiguous, negative, or residual text before the first
browser action. The extension binds
each proposal to the active tab, window, top-frame document ID, full observed state, and a
five-second lifetime. It performs at most one click, polls only by reading the same document,
and stores a verified or fail-closed receipt. A failed receipt write can resend only the exact
same receipt; it never repeats the click. Each task also stores an `armed` record before a
click and the exact commit wrapper before sending its receipt. A restart reconciles those
records without resuming later steps or repeating an uncertain click. If the native process can no longer accept that
receipt, the user may explicitly move the exact JSON into a bounded extension-local
**미확인 결과 보관** archive. Archived entries are audit leftovers only: they are not runtime
receipts, successful execution evidence, or LAYA training data.

The extension does not execute orders or claim that LAYA or a generative planner is ready. Source 0.7 sends no conversation or screen capture to a remote AI service.
The current bounded observer omits input values, cookies, HTML, table-row controls, and
known authentication/security frames. It redacts number-like text unless the six-digit code
has explicit stock-code evidence; this is a tested collection boundary, not a guarantee about
every future WTS markup pattern.

All accepted frames are stored as one atomic capture. A failed or timed-out native request
keeps the exact capture payload in extension-local storage. The next explicit retry resends
the same capture ID and body; the user can also discard it before starting a new capture.

## Source 0.7 financial read — implementation lanes independently approved

The current source tree is version 0.7.0 / protocol 7. It preserves the protocol 6 chart, market-menu, metadata, capture, task, and receipt contracts and adds a separate local financial-read profile. The Chrome side panel owns credential setup, operation selection, canonical form input, explicit query submission, cancellation, paging, and four card renderers. The local runtime and Python backend perform the work on the user's PC.

The source catalog exposes all 264 current generic read operations: 114 facts, 114 table, 17 compound, and 19 chart operations. Their canonical forms contain 697 fields: 609 required or optional strings and 88 nullable strings. Omitted, explicit `null`, and empty string remain distinct. Account-domain and account/password/PIN aliases use masked transient controls and are never persisted in extension storage.

The extension calls exactly eight financial Native methods:

- `source.credentials.status`, `source.credentials.configure`, `source.credentials.delete`
- `source.query.start`, `source.query.status`, `source.query.page`, `source.query.continue`, `source.query.cancel`

Credential values pass only from the trusted side panel to the local host and are cleared from the form after submission. The local backend stores configured profiles with Windows CurrentUser DPAPI; access tokens and query results remain memory-only. Query start and continuation require explicit clicks. A Native disconnect or child restart performs one status reconciliation using non-secret identifiers and never resends credentials or starts a query automatically.

The source proof currently includes 30 contract tests, 39 independently reviewed Native recovery tests, 33 independently reviewed vault tests, a final 160/160 local-runtime aggregate, a final 108/108 financial aggregate, and an independently approved extension freeze with 281/281 tests and `npm check` passing. Contract, runtime, and extension suites total 471 current JavaScript tests without counting targeted subsets twice. The latest three backend repairs also passed 51 targeted tests, Ruff, AST, and diff checks and received independent approval with zero findings. An owned isolated Chrome run rendered real facts, table, compound, and chart cards and verified chart mount, wheel zoom, trusted drag pan, resize, older-page prepend, and destroy. All source implementation lanes, the ACL upgrade repair, package readiness, and staged package build/check passed. The initial summary-only runtime failure has no proven cause; two later 157-test runs and the final 160-test run passed. These results do not prove a live Kiwoom request or operation in the user's Chrome/WTS session. See [source 0.7 financial-read validation](../backend/ref/wts/financial-read-v7-validation-20261019.md).

The installed host and `extension/dist` are now 0.7.0. A direct installed Native subprocess `runtime.hello` confirmed protocol 7, runtime 0.7.0, and the financial capability with empty stderr and exit code 0. Independent post-install verification matched the exact 48-file extension stage, the 23-file host installation (19 source files and four generated controls), both unchanged and valid Registry views, and the unchanged 10-file data set. It also matched the prior 20-file extension and 18-file host rollback payloads and verified their private ACL and security metadata; no owned process remained. After reloading Chrome, the user reported version 0.7.0, a successful local-runtime connection, and a successful screen inventory. The local store now contains one new capture dated 2026-10-19 08:02:39 KST with one observation, one heading, 13 controls, no child frames or canvases, and `truncated=false`; the file total increased from 10 to 11 while the four historical receipts stayed unchanged. The capture has no extension-version field, so version 0.7.0 remains user-confirmed. Independent verification passed the capture against identical current-source and installed protocol 7 schemas and matched all original 10 baseline hashes unchanged. No source 0.7 metadata-search, credential, account, live market-data, control-action, training, LAYA, order, or remote-AI claim is made.

## Historical source 0.6 market navigation — source validation passed

Source 0.6.0 / protocol 6 made catalog `wts-main-control-3` and deterministic compiler 3 current. It preserved the chart and metadata routes and added one exact market-menu form:

```text
시장 메뉴 열어줘: <그룹> > <메뉴>
```

The complete input must match one of 25 recorded destinations. Each accepted market command expands into two separately observed and receipted one-click steps: open the WTS sitemap, then select the fixed P1 market target. The extension observes each step again before execution, advances at most one already-satisfied step per Native call, and verifies the requested active menu after the sitemap closes. It never accepts a caller-supplied selector or arbitrary label.

The injected market adapter binds P1 by its semantic rank and Big Data controls, hashes the same visible P3 stock label as the chart adapter, and treats hidden ancestors or unreadable computed style as blocked. A closed sitemap may expose the opener, while target availability is required only after the sitemap opens. Modal conflicts, missing or duplicate controls, changed tab/window/document/instrument context, unknown targets, and unmet postconditions fail closed without a second click.

The full source run passed 23 contract, 115 runtime, and 238 extension tests (**376/376**) with no failures, cancellations, skips, or todos. A 25-file isolated package passed build and static inspection while preserving the extension identity. These are historical source and isolated-package results; source 0.6 itself was not exercised in Chrome at that point. The current 0.7.0 bundle has since been loaded for a user-confirmed connection and screen inventory, but the latest market or chart action receipts remain the four 0.2.0 chart receipts. See [source 0.6 market-navigation validation](../backend/ref/wts/market-navigation-source-v6-validation-20261019.md).

This slice does not add free-form conversation, financial queries, LAYA, a generative planner, orders, arbitrary selectors, script execution, or all-WTS control.

## Source 0.5 unified conversation — source validation and staging passed

The validated historical source 0.5.0 / protocol 5 bundle provided one Chrome composer for two deterministic routes only: existing complete chart commands and the exact `조회 기능 찾아줘: 검색어` metadata-search phrase. Native Host routing reported `deterministic-wts-conversation-v1` with `generative=false`. Unsupported, partial, negative, mixed, and general-chat input had no fallback and created no chart task, source request, backend startup, browser observation, or persisted record.

Conversation search cards reuse the canonical metadata renderer. A detail button works only while its in-memory list binding still matches the exact submission, operation reference, and catalog version; the existing manifest revalidation remains mandatory. Chat text and cards are session-only, bounded to 12 entries and 256 KiB, rendered as text, and not replayed when the panel is reopened.

One conversation reservation excludes conflicting chart, source, capture, receipt, and journal-recovery work. Same-ID/same-text submissions coalesce, ID reuse with different text fails, and another submission while reserved reports busy. Stop applies before source dispatch and during control admission; after source dispatch the existing Disconnect action is the explicit coarse cancellation path.

The fresh source run passed 20 contract, 109 runtime, and 198 extension tests (**327/327**) with no failures, cancellations, skips, or todos. The actual read-only cross-layer smoke passed from conversation dispatch through Native routing, source coordination, Python, wire 5, and canonical cards. A 24-file isolated package also passed build and static inspection while preserving the extension identity. All code, test, plan, smoke, and keep-set reviews approved their scopes with no open findings. Final leak, keep-set, placeholder, diff, installed-file, and private-record preservation checks passed.

Protocol 5 was not installed or exercised in Chrome at that validation point. The current 0.7.0 bundle has since been loaded for a user-confirmed connection and screen inventory, while the latest action receipts remain from 0.2.0. This historical route did not add financial queries, generative AI, LAYA, or orders. See [source 0.5 unified-conversation validation](../backend/ref/wts/unified-conversation-source-v5-validation-20261019.md).

## Source-only chart-period expansion

The historical source 0.4.1 bundle uses catalog `wts-chart-pilot-2` and deterministic compiler `deterministic-korean-chart-v2`. It accepts only the fixed day, week, month, and year chart phrases, including bounded compounds of at most twelve fully parsed steps. It keeps the existing chart-open and period-set action IDs. It does not add free-form planning, LAYA, orders, arbitrary selectors, or script execution.

The P3 adapter requires unique enabled day, week, month, and year controls. Modal blocking, stale document/context checks, one-click execution, postcondition verification, and exact receipt persistence remain mandatory. Minute and other periods remain observations only and cannot be dispatched.

Legacy catalog 1 tasks and receipts stay readable in their original day/week shape. A legacy ready task is never sent through the current adapter. On a fresh explicit user send, recovery and pending receipt reconciliation run first; only an authoritative cancellation of that exact legacy task permits the already-requested text to start once under catalog 2. Lost or conflicting cancellation produces no new dispatch.

The final extension suite passed 161 tests as part of a **285/285** contract, runtime, and extension run. Independent lifecycle, adapter/UI, and integration reviews approved the extension scope with no findings. A 23-file isolated temporary package also passed build and static inspection while preserving the extension identity. The current 0.7.0 bundle has since been loaded for a user-confirmed connection and screen inventory; the latest action receipts remain from 0.2.0 and no live month/year receipt exists. See [source 0.4.1 chart-period validation](../backend/ref/wts/chart-period-v2-validation-20261019.md).

## Source-only metadata UI

The approved 0.4.0 metadata bundle uses protocol 4. It adds a separate **조회 기능 찾기** area for explicit capability-metadata search and detail cards. That v4 bundle was not installed or verified in Chrome at its validation point. The current 0.7.0 bundle has since been loaded for a user-confirmed connection and screen inventory, but the metadata search UI has not been confirmed in the live panel.

The source UI sends only `panel.source.search` and `panel.source.describe` messages from the trusted panel. The coordinator lazily ensures the configured local read-only backend, reads a fresh catalog manifest, and binds search/detail to that exact catalog identity. Search returns at most five capability descriptions. Detail cards show argument and response-field metadata with execution unavailable.

The cards display the notice `기능 메타데이터이며 실제 금융 데이터는 조회하지 않았습니다.` They do not expose an execute, trade, or financial-query button. This path does not add market/account data retrieval, AI/model calls, LAYA inference, or training data. If the optional backend is not configured, source search stays unavailable while the chart pilot remains usable.

Source work keeps source requests separate from chart tasks and control receipts. It rejects duplicate or late results, catalog drift, invalid cards, and source requests that conflict with an active chart task. Disconnect remains available to cancel the local source request. The reviewed source bundle passed 142 extension tests as part of a 259-test JavaScript run. A 23-file temporary package also passed the static build check and preserved the extension identity. These remain source and isolated-package contracts; installation of the later 0.7 bundle does not prove that the metadata UI was exercised in actual Chrome.

## Build and verify

```powershell
cd extension
npm test
npm run check
```

`npm run check` builds and inspects a unique temporary package, then removes it. It does not
replace the currently installed `extension/dist` directory. Set `ATHENA_EXTENSION_OUTPUT` to
an allowed temporary staging path when a retained review package is required.

`npm run build` creates `extension/dist` without downloading dependencies. It copies the
canonical protocol module and JSON schema from `contracts/` byte-for-byte, generates a static
schema ES module for synchronous service-worker startup, and prints the
stable unpacked extension ID required by the native-host installer. Only the public manifest
key is stored in the repository.

The build replaces only its marked `extension/dist` directory. Test output overrides must be
absolute `athena-wts-extension-*` directories directly under the operating-system temp folder;
repository roots, source paths, symlinks, and unmarked non-empty directories are rejected.

Load `extension/dist` from `chrome://extensions` using **Load unpacked**. The local host must
register `com.athena.wts` with an `allowed_origins` entry for the ID printed by the build.
Without that host, the panel reports the real disconnected state.

## 설치된 확장 업데이트 적용

현재 host와 `extension/dist` 설치 파일은 `0.7.0`입니다. 독립 설치 후 검사는 extension stage 48개와 설치본의 정확한 일치, host 23개(소스 19개·생성 control 4개), 불변이며 유효한 32/64-bit Registry, 불변인 data 10개, 이전 host 18개·extension 20개 rollback backup의 payload·private ACL·security metadata, owned process 0개를 확인했습니다. 설치된 Native subprocess의 `runtime.hello`는 프로토콜 7, runtime 0.7.0과 금융 capability를 확인했고 stderr 0·exit 0으로 끝났습니다. 사용자는 Chrome 새로고침 뒤 `0.7.0이고 연결·화면 조사 성공`이라고 확인했습니다. 로컬 저장소에는 2026-10-19 08:02:39 KST의 새 캡처 1개가 추가됐고 관측 1개·heading 1개·control 13개·child frame 0개·canvas 0개·비절단 상태를 기록했습니다. 캡처 자체에는 확장 버전 필드가 없어 0.7.0은 사용자 확인에 근거합니다. 독립 검사는 현재 source와 설치본의 동일한 프로토콜 7 schema로 캡처가 유효하고 기존 10개 파일 hash가 모두 불변임을 확인했습니다. 비민감 metadata 검색과 금융 조회는 확인하지 않았습니다.

새 설치에서 같은 bundle을 확인할 때는 다음 순서를 한 번 수행합니다. 현재 사용자 세션은 1–5번과 새 캡처의 schema·기존 파일 hash 독립 검사가 끝났고, 6번이 남아 있습니다.

1. Chrome 주소창에 `chrome://extensions`를 입력합니다.
2. 페이지 오른쪽 위 **개발자 모드**를 켭니다.
3. **ATHENA for Kiwoom WTS** 카드의 켜짐/꺼짐 스위치 옆 **원형 새로고침(↻)** 아이콘을 누릅니다.
4. WTS 탭에서 ATHENA 패널을 다시 열고, Native Messaging 진단의 **버전 0.7.0 / 프로토콜 7**을 확인합니다.
5. **로컬 실행기 연결** 후 **현재 화면 조사**를 한 번 누릅니다.
6. 같은 패널에서 `조회 기능 찾아줘: 현재가`처럼 비민감 metadata 검색을 한 번 실행해 목록 또는 명시적 오류 상태를 확인합니다.

진단 버전이 `0.7.0`이 아니면 확장 전체 새로고침이 반영되지 않은 상태입니다. 패널 파일은 새로 읽을 수 있지만 manifest와 서비스 워커는 별도로 새로고침해야 합니다. 이 브라우저 내부 페이지와 side panel은 자동화 도구의 URL 식별 정책 때문에 사용자가 직접 조작해야 합니다. 이 확인에서는 자격증명을 입력하지 말고, 계정 키·비밀번호·인증 코드를 채팅에 보내지 않습니다. 개발자 모드를 켜는 동작 자체가 차단되면 표시된 차단 상태를 확인하고 보안 설정을 임의로 바꾸지 않습니다.

버튼 위치와 파일 종류별 새로고침 필요 여부: [Chrome 공식 확장 새로고침 안내](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#reload-the-extension).
