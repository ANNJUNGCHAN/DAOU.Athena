# ATHENA WTS local runtime foundation

This directory contains the user-local runtime boundary for the ATHENA WTS Chrome extension. It is a dependency-free Node.js 20+ Windows Native Messaging host. The current source tree is version 0.7.0 / protocol 7. It preserves the screen-inventory, proposal, receipt, bounded persistent task formats, frozen chart catalogs 1 and 2, catalog 3 market navigation, and the metadata-only source boundary. Protocol 7 adds a separate local financial-read child without changing those historical contracts.

The runtime uses a local deterministic compiler for the documented Korean chart phrases and the exact market form `시장 메뉴 열어줘: 그룹 > 메뉴`, with at most twelve fully expanded steps. Catalog 3 supports chart open, day/week/month/year, and two separately receipted steps for each of 25 fixed market destinations. It issues a five-second proposal after validating a fresh action-specific top-frame observation. The browser remains responsible for one-shot execution and postcondition checking. The runtime does **not** run LAYA, a generative planner, arbitrary selectors, order actions, or a remote provider. Its financial child exposes an authenticated loopback API only to the owned Native supervisor; it is not a public server. `inventory.summary.captureCount` and `observationCount` remain partial discovery counts.

## Protocol and process boundary

The host loads the canonical schema directly from `../contracts/wts-foundation.protocol.schema.json` and uses `createProtocolValidator(schema)` from `../contracts/wts-foundation.mjs`. Native messages are UTF-8 JSON framed with a four-byte little-endian length. Both requests and responses are limited to 128 KiB.

Chrome supplies the calling extension origin as the first host argument. The host requires that value and compares it exactly with the single `chrome-extension://<id>/` origin stored by the installer. Content scripts must relay through the extension service worker; they cannot invoke Native Messaging directly.

Only validated metadata is stored: WTS origin/path, tab/window/frame/document identity, title/headings, bounded control descriptions, frame origins/paths, canvas count, timestamps, and truncation state. Input values, raw HTML, cookies, account values, passwords, authentication codes, arbitrary selectors, and executable actions are not part of the schema.

`inventory.record` accepts one capture containing 1–16 frame observations. A capture must contain exactly one top frame, every observation must belong to the same tab/window and timestamp, and every frame ID must be unique even if Chrome reports multiple document versions. Each complete capture is written as one bounded JSON file. A synced temporary file is published with an exclusive same-filesystem hard link, so concurrent writers cannot replace an existing capture. Retrying the exact capture ID and body is idempotent; changing the body under an existing ID is rejected.

The data directory must use a local Windows filesystem with hard-link support, such as NTFS. If exclusive publication is unsupported, storage fails closed and does not fall back to an overwriting rename.

Crash residue matching the runtime's exact private temporary-file pattern is ignored during inventory reads and is never treated as a committed capture. Unknown files and directories still fail closed. This lets a valid inventory remain readable after a crash before publication or between publication and temporary-name cleanup without deleting a file that another native host may still be writing.

The native port owns the host lifetime. Closing the port stops the process. This foundation is not a persistent scheduler or background worker.

## Financial-read process boundary — source 0.7 under final review

Protocol 7 adds a sibling capability for profile `wts-financial-read-v1` / API `selector-financial-read-v1`. `runtime.hello`, control startup, and metadata status start neither child. The existing metadata child and the new financial child are separate owned processes. The first financial request starts financial initialization in the background and returns the fixed starting state; status polling remains responsive on the Native message loop.

The financial bridge exposes exactly eight methods: `source.credentials.status|configure|delete` and `source.query.start|status|page|continue|cancel`. Chrome cannot supply a URL, HTTP header, executable string, or arbitrary transport method. The backend enforces a fixed real/mock read-only TR and endpoint allowlist. Every public card page is at most 96 KiB and every whole Native response remains within the existing 128 KiB limit.

The Chrome side panel sends credentials only for an explicit configure action. The local backend stores the profile snapshot in `financial-read-v1/credentials.dpapi` with Windows CurrentUser DPAPI and a protected ACL; access tokens are memory-only. A pending commit marker causes financial requests to fail closed after a lost mutation result. Metadata and WTS control remain available while the financial child is starting or latched unavailable.

All 264 generic read operations cross the metadata-to-form carrier: 114 facts, 114 table, 17 compound, and 19 chart. The carrier preserves 697 canonical string fields, including 88 nullable fields, and distinguishes omitted, explicit `null`, and empty string. Query results are memory-only, bounded to 2 MiB per retained result, split into lossless pages, and separated from explicit broker continuation.

Contracts passed 30 tests; the independently reviewed Native recovery scope passed 39; the independently reviewed vault scope passed 33; the final root local-runtime aggregate passed 160/160 with no failures, cancellations, skips, or todos. The initial summary-only failure has no proven cause; two later 157-test runs and the final 160-test run passed. The extension freeze is independently approved with 281/281 tests and `npm check`; contract, runtime, and extension therefore total 471 current JavaScript tests without targeted-subset double counting. The final financial aggregate passed 108/108 with one external Starlette/httpx deprecation warning and no dependency change. The latest three backend repairs also passed 51 targeted tests plus Ruff, AST, and diff checks and received independent approval with zero findings. All implementation lanes, the ACL upgrade repair, package readiness, and staged package build/check passed. No credential file, upstream Kiwoom request, or live Chrome financial flow is claimed. See [source 0.7 financial-read validation](../backend/ref/wts/financial-read-v7-validation-20261019.md).

## Deterministic conversation routing — source validated and staged

Protocol 7 retains the protocol 6 `conversation.route` with exact `{submissionId,text}` input. The local router accepts only the complete chart grammar, one of the 25 exact market phrases, or `조회 기능 찾아줘: 검색어` with a trimmed 2–500 character query. All other input returns the fixed unsupported message without starting Python, reading a WTS observation, creating a task, calling a source method, or writing storage.

The hello capability reports `deterministic-wts-conversation-v1`, the two exact routes, and `generative=false`. The route request contains no selector, URL, path, method, credential, timeout, financial argument, or executable string. Classification returns normalized chart text, a normalized metadata query, or the fixed unsupported result; it does not perform the delegated work itself.

The Chrome coordinator owns one exclusive conversation reservation across routing and branch admission. Source search may proceed without a saved WTS capture when the backend is configured; chart work still requires the existing capture and control gate. Pending receipt, task journal, capture, source, and foreground recovery guards remain authoritative. This source feature passed source validation, isolated staging, and independent review. The user has since reported a successful Chrome 0.7.0 connection and screen inventory. The local store contains one corresponding new capture with one observation, one heading, 13 controls, no child frames or canvases, and no truncation. Independent validation passed it against identical current-source and installed protocol 7 schemas and matched the original 10 baseline hashes unchanged. Live metadata-search verification remains pending.

## Optional source-metadata backend

Protocol 4 introduced, and protocols 5 through 7 retain, five metadata-only methods: `backend.status`, `backend.ensure`, `source.manifest`, `source.search`, and `source.describe`. The source profile is fixed to `wts-readonly-v1` / `selector-readonly-v1` and remains separate from the protocol 7 financial profile.

`backend.status` never starts Python. When configured, `backend.ensure` lazily starts one dedicated child, verifies its health and catalog identity, and returns only bounded lifecycle metadata. Search accepts a trimmed 2–500 character query and at most five results. Describe accepts only a bounded operation reference and the exact expected catalog identity. Neither request accepts a URL, path, HTTP header, credential, intent, timeout, or arbitrary transport input from Chrome.

The backend exposes capability metadata only. It does not execute the described financial query, return market or account data, call an AI/model, or create LAYA training data. The host projects the backend response into the canonical flat list/detail cards and rejects oversized or invalid responses without clipping required fields or exposing raw upstream errors.

`backendRoot` and `pythonExecutable` are an optional pair in the local host config. Both absent keeps the existing chart-only runtime and does not start Python. Both present must be absolute physical paths. The runtime creates an isolated state directory below its own data directory and stops only the child it started. It never reuses an existing user profile or terminates an unrelated process.

## Chart-control proposal and receipt boundary

`control.plan` accepts a sanitized control observation for the exact WTS `/`
top frame. The observation carries structural state, a SHA-256
`instrumentToken`, and a SHA-256 `contextToken`; the visible stock label used
to produce those tokens is not sent to the host. A verified receipt must keep
the same instrument, tab, window, and document identity across its before and
after observations. Stale, blocked, ambiguous, compound, unsupported, and
non-chart period commands fail closed without a proposal.

`control.receipt.record` accepts only a receipt bound byte-for-byte to a
proposal issued during the same native process lifetime. Receipts are stored as
immutable, idempotent JSON files under the separate `receipts` directory. A
process restart intentionally loses the proposal registry, so an orphaned
receipt is rejected and no action is replayed automatically.

## Persistent bounded chat tasks

`control.task.start` compiles the entire local chat input before any browser
action. Unknown, negative, ambiguous, partially matched, stock-selection,
order, selector, and script text becomes an `unsupported` task with no steps.
The same submission ID and exact text are idempotent; changing the text under
an existing ID is rejected.

`control.task.next` requires the exact task revision and a fresh sanitized WTS
observation. It persists the current proposal before returning it and never
reissues a proposal while a receipt is outstanding. `control.task.step.commit`
binds the exact step, proposal, revision, and canonical receipt, mirrors the
receipt through the immutable receipt store, then advances the task. An
immutable revision claim records the exact pending commit first while the
public task remains on the same outstanding proposal. This hard-link CAS gives
multiple native processes one durable winner without recoverable lock files.
If receipt storage or the final task snapshot fails, retrying the exact commit
after restart safely completes the transaction without another browser click.

`control.task.cancel` cancels a ready task immediately. While a proposal is
outstanding it records `cancel_requested`, retains the proposal, and accepts
only the exact original commit revision so an uncertain click can be reconciled
without replay. Task snapshots are bounded immutable physical files under
`tasks`, use atomic same-filesystem publication, reject linked or unexpected
entries, and store only intentional local chat text plus canonical control
metadata.

Catalog 1 records remain bound to compiler 1 and day/week observations and arguments. Catalog 2 records remain bound to compiler 2 and day/week/month/year. New tasks use catalog 3 and compiler 3. Validators accept all three complete families and reject mixed identities. `control.task.next` rejects a catalog-1 or catalog-2 ready task with `TASK_CATALOG_CHANGED` before observation binding or planner work, without rewriting its stored revision.

Recovery takes precedence over catalog retirement. Exact pending commits and receipts reconcile first, and uncertain armed or awaiting-receipt state never causes another click. A fresh explicit send may cancel one reconciled legacy ready task; only an authoritative cancellation of that same task permits the already-requested text to start once under current catalog 3. Lost, conflicting, or unresolved cancellation stops without a new proposal.

## Development verification

From this directory:

```powershell
npm test
```

The integration suite launches the real `src/main.mjs` process with stdin/stdout pipes and a temporary configuration and data directory. It covers framing, authorization, strict protocol validation, atomic capture persistence, whole-input task compilation, persistent proposal binding, immutable receipt persistence, restart recovery, idempotency, cancellation reconciliation, corrupt data, and write failure. This proves the source runtime contract. It does not prove installation into Chrome or interaction with a live WTS tab.

### Offline evidence audit

The source-only audit command reads an explicit local data directory without creating or changing files:

```powershell
node .\scripts\audit-pilot-evidence.mjs --data-dir 'C:\Users\<user>\.athena\WtsData'
```

It checks bounded regular capture and receipt files against the canonical protocol, UUID file/body identity after the store's lowercase normalization, producer-valid receipt outcomes, timestamp order, same-context and same-instrument constraints. Catalog 1 evidence is reported only in `happyPathCoverage` for chart open, day-to-week, and week-to-day. Catalog 2 evidence is reported only in `currentCatalogCoverage` for those three transitions plus a real transition to month and year. Evidence from the two catalogs is never combined to complete either set. Unknown entries fail closed. A runtime-owned temporary file produces an explicit incomplete/in-progress result. Output is bounded JSON metadata and diagnostic codes; it does not print record bodies, filenames, input paths, or exception messages.

Exit code `0` means either `legacyComplete` or `currentComplete` is true and the inspected storage passed these static checks. A legacy-only pass does not establish current-catalog readiness. Exit code `1` means evidence is missing or in progress. Exit code `2` means storage or evidence is invalid. `overallWtsCoverage` remains `partial`, and the report always keeps `trainingApproved`, `layaReady`, and `liveFailureGuardsVerified` false.

This is an **offline evidence audit**, not behavioral replay. It checks basic integrity and recorded postconditions only. It does not independently prove browser execution, proposal provenance, the user's instruction, or live failure handling, and it does not turn a valid receipt into trusted training gold. Live browser and failure-path tests remain separate requirements.

## Windows installation

Use the unpacked extension ID shown by Chrome. It must be 32 lowercase characters from `a` through `p`.

Preview and validate the requested paths and installed prerequisites without changing files or the registry:

```powershell
powershell -NoProfile -File .\scripts\install.ps1 `
  -ExtensionId <extension-id> `
  -DryRun
```

The default command above omits both backend options and keeps the chart-only runtime. For a development preview of the optional metadata backend, provide `-BackendRoot` and `-PythonExecutable` together:

```powershell
$extensionId = '<32-character unpacked extension ID>'
$backendRoot = 'C:\path\to\Athena\backend'
$pythonExecutable = 'C:\path\to\venv\Scripts\python.exe'

powershell -NoProfile -File .\scripts\install.ps1 `
  -ExtensionId $extensionId `
  -BackendRoot $backendRoot `
  -PythonExecutable $pythonExecutable `
  -DryRun
```

The installer requires both backend options or neither. It validates the backend directory, Python executable, `athena_api\launcher.py`, and `athena_api\readonly_app.py`. It copies only the owned Node runtime and contracts; it does not copy, delete, or package the backend or virtual environment. Production Python packaging is not complete.

Install for the current Windows user by omitting `-DryRun`. The installer:

- finds an installed Node.js 20+ executable;
- copies only the explicitly allowlisted runtime and canonical protocol files;
- writes UTF-8 files without a byte-order mark;
- installs the host under `%USERPROFILE%\.athena\WtsNativeHost` and stores observations under `%USERPROFILE%\.athena\WtsData` by default, outside virtualized AppData paths;
- opens every destination directory and output file through Windows handles and refuses registration if a physical path differs or an output is linked elsewhere;
- binds `com.athena.wts` to exactly one extension origin;
- registers under `HKCU\Software\Google\Chrome\NativeMessagingHosts`;
- keeps observation data outside the installed program directory.

No secrets are written to the manifest, configuration, launcher, or ownership marker.

To relocate the existing installed v1 host out of virtualized AppData, first run the bounded repair in its default dry-run mode, then apply the same validated plan:

```powershell
powershell -NoProfile -File .\scripts\repair-native-host-path.ps1
powershell -NoProfile -File .\scripts\repair-native-host-path.ps1 -Apply
```

The repair copies only the validated installed `0.1.0` file set and does not install the source v2 runtime. It refuses automatic data migration when the old v1 data directory is not empty.

Uninstall with:

```powershell
powershell -NoProfile -File .\scripts\uninstall.ps1
```

Dry-run never creates, copies, or rewrites installation files. Uninstall validates physical paths and removes only the installer's exact file allowlist; an unknown or linked item stops removal before the registration changes. The observation data directory is preserved. Use `-DryRun` to inspect ownership without changing files or the registry.

## Chrome integration status

The current source tree is 0.7.0 / protocol 7. It implements the separate financial-read child, 264-operation form carrier, CurrentUser DPAPI profile storage, bounded query jobs/pages/continuations, and Chrome card contracts. The source evidence and exact open gates are recorded in [source 0.7 financial-read validation](../backend/ref/wts/financial-read-v7-validation-20261019.md). All implementation lanes, source aggregates, the ACL upgrade repair, package readiness, staged build/check, and the actual 0.7 file installation passed. The user reported a successful Chrome 0.7.0 connection and screen inventory, and one new local capture was found. Its schema and original baseline hashes passed independent validation. Metadata search and credential-gated live reads remain pending.

The installed host and extension files are version 0.7.0 / protocol 7. Independent post-install verification matched the exact 48-file extension stage and the 23-file host installation: 19 source files plus four generated controls. Both Registry views remained unchanged and valid, the then-current 10-file data set was unchanged, and no owned process remained. The prior 18-file host and 20-file extension rollback backups matched their payloads and retained private ACL and security metadata. A direct installed Native subprocess `runtime.hello` confirmed runtime 0.7.0, protocol 7, and the financial capability with stderr empty and exit code 0. The later Chrome connection and screen-inventory success is user-reported evidence. A new capture at 2026-10-19 08:02:39 KST increased the file total to 11; it contains one observation, one heading, 13 controls, no child frames or canvases, and no truncation. It has no extension-version field. Independent validation passed the capture against identical current-source and installed protocol 7 schemas and matched all original 10 baseline hashes unchanged. Credential-gated live reads remain unverified.

The approved historical source 0.4.0 metadata bundle passed 17 contract, 100 runtime, and 142 extension tests (**259/259** total), with zero failures, cancellations, skips, or todos. Its 23-file package also passed an isolated temporary build and static check while preserving the extension identity. These historical source and staging results do not prove live Chrome rendering.

The historical source 0.4.1 / protocol 4 bundle added catalog 2 and compiler 2 month/year support. Its final run passed 19 contract, 105 runtime, and 161 extension tests (**285/285** total), with zero failures, cancellations, skips, or todos. Contract, runtime, extension lifecycle, adapter/UI, and integration reviews all approved their scopes with no findings. An isolated 23-file extension package and the real read-only metadata cross-layer smoke also passed. These results prove that source bundle and staging candidate; they do not prove installation or actual Chrome month/year behavior.

Source 0.5.0 / protocol 5 unified conversation passed source validation and isolated staging. The fresh run passed 20 contract, 109 runtime, and 198 extension tests (**327/327**) with zero failures, cancellations, skips, or todos. The actual dispatcher → reservation → Native router/handler → source coordinator/bridge → read-only Python → wire 5 → canonical-card smoke passed with classification backend calls 0, forbidden calls 0, list result 1, detail fields 7, duplicate Native calls 0, final conversation `idle`, and no owned child left running. A 24-file isolated package passed build and static inspection while preserving the extension identity. All independent code, test, plan, smoke, and keep-set reviews approved their scopes; final leak, keep-set, placeholder, diff, installed-file, and private-record preservation checks passed.

Source 0.6.0 / protocol 6 makes `wts-main-control-3` current and adds two fixed actions for 25 recorded P1 market destinations. Exact `시장 메뉴 열어줘: 그룹 > 메뉴` input expands to a sitemap-open step and a target-navigation step. Each step uses a fresh action-specific observation, one click at most, a strict postcondition, and its own immutable receipt. The fresh source run passed 23 contract, 115 runtime, and 238 extension tests (**376/376**) with zero failures, cancellations, skips, or todos. A 25-file isolated extension package passed build and static inspection while preserving the extension identity. The actual local Python metadata smoke and installer DryRun also passed; DryRun wrote no files and changed no registry entry.

The historical 0.6 results verify that source and isolated staging candidate only. The installed host and `extension/dist` are now 0.7.0, and the user reported a successful Chrome connection and screen inventory. The latest action receipts remain the four 0.2.0 receipts. The 25 historical direct-browser menu transitions informed the fixed catalog and postconditions, but they are not extension receipts.

The installed 0.7 package has been reloaded with user-confirmed connection and screen-inventory success, and the new local capture passed independent schema and baseline-hash validation. Separate Chrome verification remains for metadata search and detail rendering, all 25 market paths, financial setup/forms/cards, catalog drift rejection, source/chart/query mutual exclusion, disconnect cleanup, reconnect reconciliation, legacy recovery, month/year postconditions, and the unchanged chart-task guards. Credential entry and live Kiwoom reads are separate user-gated evidence. One coherent current-bundle Chrome proof must distinguish these checks from the obsolete installed-0.3 compound check.

## Chrome Native Messaging 진단

Chrome에서 `Specified native messaging host not found`가 계속 표시되면 먼저 실행 계획만 확인합니다. 계획 모드는 Chrome을 시작하거나 파일을 만들지 않습니다.

```powershell
powershell -NoProfile -File .\scripts\diagnose-chrome-native-host.ps1 -Mode Plan -OpenWts
```

모든 Chrome 창을 직접 닫고 작업 관리자에서도 Chrome 프로세스가 끝난 뒤, 아래 래퍼를 더블클릭하거나 같은 스크립트를 `-Mode Launch -OpenWts`로 실행합니다. 스크립트는 Chrome을 강제 종료하지 않고, 기존 프로필을 그대로 사용하며, 원격 디버깅이나 보안 우회 옵션을 켜지 않습니다.

```text
scripts\diagnose-chrome-native-host.cmd
```

출력된 `logPath`를 보관하고 Chrome에서 ATHENA의 로컬 실행기 연결 오류를 한 번 재현합니다. Chrome을 연 상태에서 그 경로를 그대로 사용해 분류 결과를 수집합니다.

```powershell
powershell -NoProfile -File .\scripts\diagnose-chrome-native-host.ps1 `
  -Mode Collect `
  -LogPath '<Launch 출력의 logPath>'
```

Chrome 155.0.8059.82의 [`launch_context.cc`](https://chromium.googlesource.com/chromium/src/+/155.0.8059.82/chrome/browser/extensions/api/messaging/launch_context.cc)는 Native Messaging 호스트 검색 실패를 `WARNING`으로 기록하므로 진단 실행은 로그 레벨 1을 사용합니다. 원본 Chrome 로그는 `%LOCALAPPDATA%\Athena\WtsDiagnostics`에만 남습니다. WARNING과 ERROR 로그에는 이 진단과 무관한 로컬 브라우징 메타데이터가 섞일 수 있으므로 저장소에 복사하거나 공유하지 마세요. `Collect`는 알려진 Native Messaging 오류 범주와 횟수만 출력하며 원본 로그 줄은 출력하지 않습니다.
