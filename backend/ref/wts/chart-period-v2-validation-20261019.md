# WTS 차트 월봉·년봉 source 0.4.1 검증

검증일: 2026-10-19

대상: 소스 `0.4.1` / Native Messaging 프로토콜 4 / `wts-chart-pilot-2`의 월봉·년봉 확장

## 현재 판정

소스 `0.4.1`은 기존 차트 열기·일봉·주봉에 월봉·년봉을 추가한다. 프로토콜은 4를 유지하고, 현재 action catalog는 `wts-chart-pilot-2`, 결정형 compiler는 `deterministic-korean-chart-v2`다. 생성형 계획기, LAYA, 주문과 임의 selector 실행은 추가하지 않는다.

계약 19, runtime 105, 확장 161의 전체 JavaScript 검증이 **285/285 통과**했고 실패·취소·skip·todo는 0이다. 계약, runtime, 확장 lifecycle, adapter/UI, 통합의 다섯 독립 검토도 모두 APPROVE였으며 잔여 finding은 없다. 임시 격리 경로의 0.4.1 확장 package 23개 파일도 build·정적 검사를 통과하고 기존 확장 ID를 유지했다. 따라서 **source bundle과 격리 확장 package 검증은 통과**했다. 설치된 host와 `extension/dist`는 `0.3.0` 그대로이며, 실제 Chrome에서 확인된 최신 제어 증거도 `0.2.0` 영수증 4건이다. 설치된 v3 task는 0건이고 0.3 복합 작업과 source 0.4.1 월봉·년봉은 실제 Chrome에서 확인하지 않았다.

## 추가된 결정형 범위

현재 catalog 2가 허용하는 차트 기간은 `day`, `week`, `month`, `year`다. 다음 고정 한국어 문구만 추가한다.

- `월봉으로`, `월봉으로 바꿔줘`, 연속형 `월봉으로 바꾸고`
- `년봉으로`, `년봉으로 바꿔줘`, 연속형 `년봉으로 바꾸고`

전체 입력이 고정 문법으로 해석돼야 하며 알 수 없는 접미사, 부정문, 일부만 일치하는 문장과 12단계 초과 입력은 실행 계획을 만들지 않는다. action ID는 기존 `wts.main.p3.chart.open`과 `wts.main.p3.chart.period.set` 두 개를 유지한다. 분봉 등 다른 주기는 관찰값 `other`로 남으며 실행 인자가 아니다.

월봉·년봉 전환도 기존 P3 안전 경계를 그대로 적용한다.

- 정확한 WTS origin, P3 영역, 활성 차트, instrument, tab/window/document에 결합한다.
- 일·주·월·년 버튼이 각각 하나이고 활성화돼 있어야 한다.
- modal, 오래된 observation, context 변경, 누락·중복·disabled target은 클릭 전에 차단한다.
- proposal 하나에 클릭은 최대 한 번이며, 같은 document를 읽어 기간 선택 후조건을 확인한다.
- 후조건이나 receipt 저장이 불확실하면 클릭을 자동 반복하지 않는다.

일반 Chrome 제어에서 월봉·년봉 버튼과 선택 상태는 직접 확인했지만, 이는 확장 proposal·click·receipt 증거가 아니다. 실측 범위는 [직접 브라우저 제어 검증](direct-control-validation-20261018.md)에 별도로 기록돼 있다.

## catalog 호환성과 복구

기존 `wts-chart-pilot-1` 기록은 compiler 1과 일봉·주봉 형태 그대로 읽는다. 현재 catalog 2는 compiler 2와 일·주·월·년 형태를 사용한다. proposal, receipt, task validator는 각 catalog의 완전한 형태 중 하나만 허용하고 catalog·compiler·observation·action 인자를 섞은 기록을 거부한다. 기존 저장소 key와 기록 bytes를 전역 변환·재분류·삭제하지 않는다.

복구는 catalog 전환보다 먼저 처리한다.

1. `pendingCommit`과 `receipt_pending`은 기존 exact-wrapper 규칙으로 먼저 화해한다.
2. `armed` 또는 journal 없는 `awaiting_receipt`·`cancel_requested`는 클릭 없이 원래 catalog와 observation으로 미확인 결과를 정리한다.
3. 화해 뒤 legacy task가 `ready`라면 조회나 자동 재개만으로 취소·전환하지 않는다.
4. 사용자가 새 문장을 명시적으로 보낼 때만 그 exact legacy task/revision을 안정된 cancellation ID로 취소한다.
5. 같은 task의 authoritative `cancelled` 응답을 확인한 경우에만 이미 요청된 새 문장을 catalog 2로 한 번 시작한다.
6. 취소 응답 상실, conflict, 미해결 commit, 다른 nonterminal 상태 또는 사용자 취소가 있으면 새 proposal을 dispatch하지 않는다.

비-panel caller가 legacy `ready` task를 현재 adapter로 넘기면 runtime은 observation binding과 planner 호출 전에 `TASK_CATALOG_CHANGED`로 거부하고 원래 기록을 바꾸지 않는다. 이 보호는 새 사용자 전송 시의 정상 retirement 흐름을 대신하지 않는다.

## 감사 결과의 분리

offline evidence audit는 두 catalog의 완료 조건을 합치지 않는다.

- `happyPathCoverage`: catalog 1의 차트 열기, 일봉→주봉, 주봉→일봉만 집계
- `currentCatalogCoverage`: catalog 2의 차트 열기, 일봉→주봉, 주봉→일봉, 월봉 전환, 년봉 전환만 집계
- `legacyComplete`: legacy 세 항목이 모두 실제 verified receipt로 충족될 때만 참
- `currentComplete`: current 다섯 항목이 모두 실제 verified receipt로 충족될 때만 참

현재 로컬 기록을 새 auditor로 읽은 결과는 캡처 6건, verified receipt 4건, diagnostics 0건, `legacyComplete=true`, `currentComplete=false`다. 기존 10개 기록은 변경되지 않았고 current coverage 다섯 항목은 모두 false다. audit의 `pass`는 legacy 기록 무결성과 저장된 후조건이 완성됐다는 뜻이며, catalog 2 준비 상태나 source 0.4.1의 실제 Chrome 실행을 뜻하지 않는다. `trainingApproved`, `layaReady`, `liveFailureGuardsVerified`도 계속 false다.

## 확인된 소스 증거

다음 수치는 최종 root 통합 검증과 독립 검토를 반영한다. targeted 검증은 전체 285개의 부분집합일 수 있으므로 다시 더하지 않는다.

| 구간 | 최종 결과 | 판정 범위 |
|---|---:|---|
| 프로토콜 계약 | 19 tests 통과, 독립 검토 APPROVE | legacy/current strict family와 exact `task.next` proposal binding |
| 로컬 runtime | 105 tests 통과, 독립 검토 APPROVE | compiler/planner, task recovery, catalog별 evidence audit |
| 확장 | 161 tests 통과 | lifecycle, adapter/UI와 runtime 통합 fixture 포함 |
| 전체 JavaScript 검증 | 19 + 105 + 161 = **285/285 통과** | 실패·취소·skip·todo 0 |
| 독립 검토 | 5개 범위 모두 APPROVE, finding 0 | 계약, runtime, lifecycle, adapter/UI, 통합 |
| 격리 확장 package | 임시 staging 23개 파일 build·정적 검사 통과 | 기존 확장 ID 유지; 현재 `extension/dist`와 설치본 미변경 |
| 실제 metadata cross-layer smoke | 264 operations, search 1건, detail 7 fields, stop 뒤 `ownedChild=false` | read-only Python → bridge → wire 4 → card normalizer; `financialQuery=false`, live Chrome 아님 |
| 기존 설치본 불변 | 설치된 0.3 dist 20개 파일이 승인된 v3 staging과 일치 | 기존 로컬 기록 10개 불변, task directory 없음 |
| 기존 로컬 기록 감사 | legacy 완료, current 미완료 | current catalog의 새 실제 영수증 필요 |

초기 계약 검토에서 `task.next`가 task에 저장된 전체 active proposal과 정확히 결합되지 않는 HIGH finding이 발견됐다. 수정 뒤 동일 UUID로 다른 proposal을 넣는 재현은 거부됐고 계약 19 tests와 독립 재검토를 통과했다. 계약·확장·runtime 대상 gitleaks 검사도 누출 0건이었다.

0.4 metadata bundle의 역사적 **259/259** 검증과 독립 승인은 [source metadata v4 소스 검증](source-metadata-v4-validation-20261019.md)에 별도로 남아 있다. 해당 기준선의 Python backend 27 tests와 LSP/ESLint 공백도 역사적 0.4 검증 범위다. 0.4.1에서는 실제 metadata cross-layer smoke를 다시 통과했지만 Python backend test suite를 새로 실행했다고 주장하지 않는다.

## 아직 증명하지 않은 것

- source 0.4.1 installer 적용과 rollback·uninstall 검증
- 설치된 0.3의 복합 작업 실행과 source 0.4.1 업그레이드·Chrome 새로고침
- 실제 Chrome의 월봉·년봉 단일·복합 명령, 실패 guard와 recovery
- catalog 2의 새 verified receipt와 `currentComplete=true` audit
- GPU 환경의 로컬 계획기 적합성, LAYA 학습과 ATHENA 23개 기능 완료

전체 기능 판정은 완료 0개, 부분 1개, 미완료 22개를 유지한다. 전체 범위와 설치본 완료 조건은 [ATHENA → Chrome 이식 인수 대장](migration-acceptance-ledger-20261019.md)에서 관리한다.
