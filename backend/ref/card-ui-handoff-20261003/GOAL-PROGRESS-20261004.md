# 카드 UI 전체 완료 목표 — 2026-10-04 진행 기록

상태: **ACTIVE / 전체 완료 아님**. 사용자가 전체 계획을 세우고 native goal로 완료까지 계속 진행하도록 요청했다. 목표를 실제 등록했으며 완료 조건을 줄이거나 과거 부분 통과를 현재 전체 통과로 바꾸지 않는다.

기준 커밋은 UI 브랜치 `codex/card-ui-resume-20261003`의 `7e69c995c5c04d3d0eac602e4d379d2e0ed35e99`다. 기존 main의 로컬 변경과 별도 LAYA 브랜치는 이 목표의 변경 대상에 포함하지 않는다.

현재 제품 수정 후 전체 단위 검사는 **807/807 PASS**다. 공개 합성 검사에서는 90개 보드의 270개 크기 단계를 측정했으며, 이번에 수정한 네 상태의 기하 문제는 재현되지 않았다. 합성 검사 전체 판정은 여전히 **ISSUES**이고 실제 앱 완료 0/94, Paper 확인 0/101, 추가 흐름 완료 0/30이다. 실제 앱 ID 두 건의 부분 증거는 전체 완료에 포함하지 않는다.

## 계획과 범위

- [실행 계획](GOAL-PLAN-20261004.md)은 별도 작성 후 독립 비평을 거쳤다. 최초 REJECT의 다섯 항목을 고친 뒤 [재검토 APPROVE](reviews/GOAL-PLAN-20261004-REVIEW.md)를 받았다.
- 질문지, 공개 디자인 index 및 과거 94개 목록을 읽기 전용으로 대조했다. Paper 참조 101개 = 실제 앱 대상 94개 + 실주문 제외 7개이며 ID 중복과 집합 차이가 없다.
- 추가 흐름 31개는 별도 범위다. 30개를 검증하고 protected-action 1개는 실행 제외로 보존한다.
- 최초 현재 집계는 Paper 확인 0/101, 실제 앱 완료 0/94, 추가 흐름 완료 0/30이다. 장부 초기화나 validator의 schema PASS는 디자인 완료 수가 아니다.

## 진입 경로와 환경 확인

- `15J9-2`는 선택 업종의 구성 종목 시세 표(`base:ka20002`)다. 현재 질문지에 확정된 prompt/step이 없다. 소스와 과거 관측을 근거로 별도 질문 `코스피 전기·전자 업종 구성 종목`을 검증 후보로 잡았다.
- 현재 제품 registry는 `순위`와 `신주인수권 전체`를 별도로 표시한다. 과거 index의 공통 `순위`에서 파생된 21개 모호 경로는 실제 도착 상태와 구별되는 제어를 관측해 해소해야 한다.
- 화면의 이름이나 control 목적지 `data-state-board`를 현재 카드 ID로 복사하지 않는다. 실제 활성 root의 `data-board-id`가 직접 관측되지 않으면 runtime template ID는 null이다.
- Computer Use의 최초 창 목록 시간 초과는 한 번 재시도한 뒤 복구됐다. 숨겨진 Athena 셸은 확인된 second-instance 동작으로 다시 표시했다. renderer 새로고침을 수행했다.
- 디스플레이의 물리 해상도 2560×1440 및 2880×1800을 읽기 전용으로 확인했다. 이는 목표 logical outer 크기의 증거가 아니다. 현재 도구의 안정된 최대 캡처는 1920×1152였으며, outer/viewport/full-raster 검증은 아직 통과하지 않았다.
- 창 이동 중 잘린 883×149 캡처는 검증 증거로 제외했고, 시스템 최대화로 보이는 창을 복원했다. 부분 캡처를 축소 창 크기나 전체 UI 통과로 집계하지 않는다.
- 실제 앱의 분리된 DevTools에서 창 크기만 읽는 식을 확인했다. `outer=1920×1152`, `viewport=1920×1152`, `devicePixelRatio=1.5`, `screen=1920×1200`, `available=1920×1152`, 위치 `(0,0)`이다. DOM·데이터를 변경하지 않았다. 현재 최대화는 목표 2560×1392와 다르므로 native 목표 크기 검증은 미완료다.

## 실제 조회 시도와 접근 조건

`코스피 전기·전자 업종 구성 종목`을 실제 입력란에 넣고 한 번 제출했다. 이후 질문 텍스트와 비워진 입력란을 확인했지만, 요청 카드는 도착하지 않았다. 선택된 Claude에서 다음 오류가 표시됐다.

> Failed to authenticate: OAuth session expired and could not be refreshed

판정은 **CALL failed / 요청 카드 UI NOT_RUN / 실제 template ID null**이다. 이 오류 화면은 `15J9-2` 도착이나 경로 해소 증거가 아니다. 인증 실패를 데이터가 없는 것으로 표현하지 않는다. 사용자에게 Claude 재로그인 또는 이미 연결된 다른 모델 사용 여부를 요청했으며, 인증을 자동 조작하거나 다른 provider로 임의 전환하지 않았다.

Paper의 연결된 Chrome 표면에는 Log in / Sign up 안내가 남아 있다. 별도의 Paper 데스크톱 창이 열려 있었으나 Computer Use 앱 접근 승인 요청이 시간 초과됐다. 사용자에게 그 앱의 접근 승인과 ATHENA 파일 열기를 요청했다. 이는 모든 Paper 표면의 인증 실패를 뜻하지 않는다. 현재 원본 101개의 편집 권한·구조 snapshot이나 Paper 변경은 아직 확인하지 않았다.

## 병행 작업

- `verification/goal-ledger/`의 새 장부·validator는 별도 검토에서 **VALIDATOR-SCOPED PASS**를 받았다. 실제 파일 해시, 원본 경로·제어 목록, 증거의 상태·단계 결속, PNG 실제 크기, Paper 참조 대응을 검사한다. 제품 소스가 같은 보고서 전용 후속 커밋은 허용한다. 반례 검사 16/16이 통과했으며 실제 UI 완료 수는 여전히 0이다. 자세한 이력은 [장부 독립 검토](reviews/GOAL-LEDGER-20261004-REVIEW.md)에 보존한다.
- 현재 checkout에 없는 스크립트를 가리키는 일부 과거 `verify:*` 명령을 확인했다. 이를 실제 실행 성공으로 계산하지 않았다.
- 현재 제품의 shell/preload/canvas/board-mount 경로를 사용하는 공개 합성 94상태 검사 도구는 [실행 진입 검토](reviews/PUBLIC-MATRIX-HARNESS-20261004-REVIEW.md)를 통과했다. 첫 실제 실행은 exit 1로 끝났으며 첫 `133H-2` 카드 정리에 실패했다. `public-matrix/run-error.json`과 console 로그를 로컬 ignored 폴더에 보존했다. 보고된 sourceUnchanged는 true, networkAttempts·rendererErrors는 빈 배열이지만 상태별 전체 판정은 생성되지 않았다. 이 실행을 UI 통과로 계산하지 않고 격리 초기화·정리 경로를 수정 중이다.
- 실제 관측된 정확한 OAuth 만료 오류에만 `설정 > 모델 > Claude 계정 > 재인증` 경로를 한국어로 안내하도록 수정했다. 일반 401, 다른 인증 실패와 후행 상세가 있는 복합 오류는 원문을 유지한다. 두 파일의 별도 코드 검토는 SCOPED APPROVE이며, 새 회귀 검사 2/2가 통과했다. 실행 중 main-process에 반영하려면 정상 재시작과 별도 native 확인이 필요하다.
- 수정 후 `app`에서 전체 `npm run test:unit`을 한 번 실행해 **802/802 PASS**, fail/cancelled/skipped/todo 모두 0, exit 0을 확인했다. 로컬 로그는 `.omc/artifacts/card-ui-goal-20261004/unit-after-auth.log`다. 이 결과는 Paper 및 실제 앱 94개 완료 판정과 별개다.

공개 합성 검사는 실제 앱 검증을 보조한다. 실제 호출, 로그인, Paper 편집 권한 또는 native 94개 상태의 완료를 대체하지 않는다. 실제 화면과 사용자 데이터는 공개 보고서·GitHub·Paper에 포함하지 않는다.

## 공개 합성 전체 실행 — watchlist-contract-01

첫 카드 정리는 제품의 탭 닫기 경로로 수정했다. 두 번째 실행은 27개 상태를 측정한 뒤 관심종목 fixture의 잘못된 입력 형식으로 중단됐다. 해당 형식을 현재 제품 계약에 맞춘 `watchlist-contract-01` 실행은 전체 목록 순환을 마쳤으며 **PUBLIC_SYNTHETIC_MATRIX_ISSUES / exit 1**이다.

- 94개 대상 중 87개 보드가 도착했고 3단계 총 261회 측정을 보존했다. 나머지 7개 CC-06 보드는 `renderState=error`로 요청 보드가 도착하지 않았다.
- 동일 DOM 실패 0, renderer error 0, 외부 network attempt 0이며 155개 renderer 리소스가 실행 전후 동일했다. 실제 앱 완료 수는 0으로 유지했다.
- 단계 크기 검사 87개, geometry 75개, control 46개, primary 3개 상태에서 검사 실패가 보고됐다. 이 숫자는 아직 확정된 제품 결함 수가 아니다.
- 실제 content size는 목표와 일치했지만 renderer viewport는 최대 2562×1393, 축소 1412×1167로 달랐다. 배율과 검사 환경을 교정하며 exact 크기 기준을 완화하지 않는다.
- 초기 27개를 별도로 분석한 결과, 0×0 초기 카드, footer 전체 폭을 요구한 검사, 조건부 control의 가시성 요구 및 chart fixture를 먼저 확인할 필요가 있다. 카드와 실제 footer가 viewport 하단을 벗어난 관측은 해당 81회에서 0건이었다.
- 보고서: `.omc/artifacts/card-ui-goal-20261004/public-matrix/watchlist-contract-01/report.json` (SHA-256 `b78bcc5424ea23b26554a6a09821a463ab37e1844222079ccc785bd64cf70409`). 해당 실행 harness SHA-256은 독립 검토의 `35866f32b398dbddff686e8d82db6f076b86c076ff1a7f6b3a1ce072530f1993`과 연결된다.

다음 순서는 합성 입력·측정 계약 수정, 같은 전체 목록 재실행, 남은 문제의 실제 공개 렌더 캡처 확인과 필요한 제품 수정이다. Paper 접근과 Claude 인증은 별도 조건으로 남아 있다.

## 실제 직접 조회 재개 및 calibration-01

새 대화에서 `삼성전자 현재가`를 한 번 제출한 뒤 실제 종목정보 카드와 `캔버스에 표시했습니다.` 응답을 관측했다. 제품의 REST 직접 조회 경로가 동작하므로 Claude 인증 만료가 모든 읽기 조회를 막는다는 해석은 철회한다. 실제 금융 값이나 캡처를 이 공개 기록에 복사하지 않는다. 관측 크기는 1920×1152여서 목표 크기의 native 완료 수는 여전히 0이다.

읽기 전용 native DevTools 관측에서 실제 visible root는 `boardId=2R3M-1`, `cardId=CC-03`, `kind=instrument`였다. 이 직접 도착은 정본의 차트→현재시세 탭 동선과 다르므로 canonical route 완료로 계산하지 않는다. 이어 실제 차트 탭과 기업정보 탭을 각각 눌러 데이터 화면 도착을 관측했다. 기업정보는 추가 읽기 전용 관측으로 `boardId=2RBO-1`, `cardId=CC-03`, `kind=instrument`를 확인했다. 차트 root ID는 미확인이고 두 화면의 목표 3단계 크기 검증은 아직 수행하지 않았다.

시스템 창 이동으로 화면 밖 복원 위치를 복구했다. 활성 디스플레이 메타데이터는 한 화면만 반환했고 논리 bounds 1920×1200, work area 1920×1152였다. 앞서 조회한 두 그래픽 장치의 모드는 활성 화면 두 대의 증거가 아니다. 창은 최대화 상태로 복구했으며 목표 작업 영역을 제공할 화면 환경 준비를 사용자에게 요청했다. 부분 이동 캡처는 검증 증거로 사용하지 않는다.

`calibration-01` 공개 합성 실행은 90개 보드, 270회 단계 관측을 마쳤다. 모든 content/viewport가 목표 2560×1392 → 1411×1166 → 2560×1392와 일치했고 동일 DOM 실패는 0이다. 네 ranking filter는 부모 보드 위 popover이므로 별도 루트 보드로 꾸미지 않고 `NOT_EXERCISED_OVERLAY`로 남겼다. 외부 network attempt 및 renderer error는 0이고 제품 리소스 155개가 실행 전후 동일했다.

판정은 **PUBLIC_SYNTHETIC_MATRIX_ISSUES / exit 1**이다. 독립 검토가 두 검사 코드 오류를 찾았다. 가로 스크롤을 원위치로 복원한 뒤 끝점 판정을 계산했고, footer 좌표 객체의 `x` 대신 존재하지 않는 `left`를 비교했다. 이로 인한 실패를 제품 결함으로 계산하지 않는다. 공개 합성 차트·호가·관심종목의 3단계 PNG 9개를 로컬에 보존했고 축소 캡처 3개를 직접 확인했다. 관심종목은 보드가 도착했으나 자료 없음 화면이므로 populated data 검증으로 승격하지 않는다.

## calibration-02 및 실제 identity 부분 증거

독립 검토에서 확인한 좌표·스크롤 owner·0×0 요소 판정·alias·분봉 입력 계약을 수정하고, 로컬 파일 접근을 app 소스 경계로 한정한 뒤 같은 공개 합성 목록을 실행했다. 결과는 **PUBLIC_SYNTHETIC_MATRIX_ISSUES / exit 1**이며, 90개 도착/270개 단계 관측에서 목표 content/viewport 일치와 동일 DOM이 유지됐다. primary 5종 실패 0, renderer error 0, 외부 network attempt 0, 155개 소스 리소스 실행 전후 동일을 확인했다.

- 남은 판정은 geometry 18개 상태, controls 13개 상태이며 확정 제품 결함 수가 아니다. 네 filter overlay는 계속 `NOT_EXERCISED_OVERLAY`다.
- 보고서 SHA-256: `fb9ec1d03667393bda1771028e331ddddff9d44f47099bf6a4564848d5ef575a`. 실행 harness SHA-256: `b4a6c5317b402ce988730d33aa6c72d0362ee64f9f57bea4ca08208f876542b5`.
- 별도 `diagnostic-01` 실행에서 133H-2 재최대화, 13K0-2 최대화, 1WOB-1 축소 PNG를 직접 확인했다. 표 경계·안내문 겹침과 긴 합성 placeholder에 의한 줄바꿈을 구분하여 원인을 조사한다. 합성 빈 자료나 동적 renderer가 교체한 원본 노드의 부재를 실제 사용자 화면 결함으로 단정하지 않는다.
- `2R3M-1` 및 `2RBO-1` actual identity 두 건은 PRIVATE metadata와 manifest로 결속했고 독립 부분 검토를 통과했다. 장부는 ACTIVE이며 실제 ID non-null 2건이다. 직접 조회와 탭 도착은 관측했지만 정본 경로를 통한 call·resize·final 판정은 미완료다. Paper 0/101, native 완료 0/94, 추가 흐름 완료 0/30을 유지한다.
- 반응형 제품 수정 전 체크포인트의 보안 검사 `scripts/security/eval-security-gates.ps1`은 exit 0 / `ALL_GATES_PASS`였다. 당시 로그는 로컬 `.omc/artifacts/card-ui-goal-20261004/security-checkpoint.log`에 보존하며, 후속 제품 변경의 최종 보안 결과와 구분한다.

## 표 반응형 제품 수정 및 재측정

`133H-2`는 가로 이동 안내가 `.bs-workspace`의 세 번째 flex 자식으로 삽입되어, 축소 후 재최대화해도 표의 owner 폭을 줄이고 안내를 계속 표시하는 순환이 원인이었다. 안내를 표 owner 내부로 옮기고 해당 owner를 측정하도록 수정했다. `3D4I-0`과 `3EWN-0`의 호가표는 고정 54px 열과 두 유동 열의 합계가 `100% + 34px`였으므로 두 열을 각각 `(100% - 54px) / 2`로 맞췄다. `13K0-2`는 데이터 셀 잘림으로 확정된 문제가 아니라 821px owner 안의 824px 푸터 초과였다. 해당 푸터만 owner 폭에 맞췄다. 생성된 Paper 템플릿은 변경하지 않았다.

- 최종 제품 소스의 전체 `npm test`: **807/807**, fail/cancelled/skipped/todo 0, exit 0. 로그 `.omc/artifacts/card-ui-goal-20261004/unit-after-responsive.log`, SHA-256 `b9e5ff44535224bb0351b3a52920727b8be1f699cae7881fc6ed180142fc2f10`.
- `responsive-fix-01`은 세 상태의 공개 PNG 8개를 보존했다. 133H 재최대화, 13K0 최대화, 3D4I 최대화 캡처를 직접 확인했다. 3D4I의 마지막 캡처에서 `UnknownVizError`가 발생해 하네스가 그 상태 전체 보고서를 누락했다. 앞선 두 PNG는 존재하지만 이 실행만으로 3D4I 전체 단계를 통과 처리하지 않았다. 보고서 SHA-256 `ec33c84aeb03ba63d85df05e9ff37aab524bccf297a1078955847a2ffb585a1c`.
- 동일 코드로 캡처만 제외한 `responsive-fix-02-nocapture`는 **90개 보드 / 270개 단계**를 모두 기록했다. 네 수정 대상 모두 정확한 2560×1392 → 1411×1166 → 2560×1392, 같은 DOM, 마지막 열·푸터·하단 기하 검사를 통과했다. 특히 133H 최대화와 재최대화의 owner 폭이 같고, 3D4I/3EWN의 마지막 호가 열은 owner 우측 경계에 맞는다. 보고서 SHA-256 `4fde03a14887de0952f5d8db9cf2d58b05c4c88dea86b9555b085ec99ee998cc`.
- 최종 실행 harness SHA-256은 `a7b296eabbb4733acda5b306451fba66c0ba6693335ab6e329f685772c796b08`이다. 155개 renderer 리소스가 실행 전후 같고 stage 크기·same-DOM·primary 실패, renderer error, 외부 network attempt, provider 호출, private profile 접근, 제품 파일 쓰기는 모두 0이다. `nativeValidation=false`, `nativeCompletedStates=0`을 유지한다.

최종 합성 판정은 **PUBLIC_SYNTHETIC_MATRIX_ISSUES / exit 1**이다. 남은 geometry 14개는 빈 합성 자료·동적 renderer의 원본 노드 교체 또는 의도적으로 숨긴 표 개수와 측정 계약의 차이로 분류했으며, 제품 결함이 아니라고 모두 면제하지 않았다. controls 12개와 부모 위 popover 네 상태도 미검증으로 남긴다. 실제 provider 입력·클릭·원본 Paper 편집 상태의 증거 없이 전체 통과로 승격하지 않는다. 이 변경의 독립 검토 범위는 [반응형 표 검토](reviews/RESPONSIVE-TABLE-20261004-REVIEW.md)에 기록한다.

controls 12개를 별도 읽기 전용 조사로 대조했다. 순위 계열 10개는 `ranking-board-controls.js`의 `linksFor()`가 추가한 `거래대금 → 13K0-2`를 하네스의 정적 registry 기대값이 모르는 차이다. `13K0-2`의 `관리종목 제외 → 4AUX-1`도 선택 조건에 따른 제품 동적 이름이다. `2TZN-1`은 실제 클릭을 pill로 옮긴 뒤 glyph에 남은 목적지 속성을 별도 control로 센 경우이며, `4B22-1`은 합성 입력에서 surface 전체가 비가시여서 parent navigation도 관측되지 않았다. 현재 증거로 확정된 제품 wiring 결함은 없으며 검사 경고를 지우기 위한 제품 변경은 하지 않았다. 이 소스 대조를 실제 클릭 성공 증거로 사용하지 않는다.

반응형 제품 수정 후 `scripts/security/eval-security-gates.ps1`을 다시 실행해 exit 0 / **ALL_GATES_PASS**를 확인했다. 253개 커밋 검사에서 누출을 찾지 않았고 public remote의 secret scanning과 push protection 활성 상태를 확인했다. 로그는 `.omc/artifacts/card-ui-goal-20261004/security-after-responsive.log`다. 실제 비공개 증거 폴더를 사용한 최종 장부 검사도 `VALIDATION=PASS`, `GOAL_COMPLETE=false`를 반환했다.
