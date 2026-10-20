# WTS source metadata v4 소스 검증

검증일: 2026-10-19

대상: 소스 `0.4.0` / Native Messaging 프로토콜 4의 선택적 로컬 조회 기능 메타데이터 경로

## 현재 판정

v4 소스는 기존 차트 제어 계약을 유지하면서 전용 Python backend에서 **조회 기능의 이름·인자·응답 필드 메타데이터만** 찾아 Chrome 카드로 표시하는 선택적 경로를 추가한다. 설치된 로컬 호스트와 `extension/dist`는 여전히 `0.3.0`이며, 현재 `extension/dist`에 v4를 반영하거나 설치·새로고침하지 않았다.

backend, 프로토콜, Node supervisor/bridge, runtime 통합, service worker와 panel은 각각 검증·독립 검토를 통과했다. 계약 17, runtime 100, 확장 142의 전체 JavaScript 검증도 **259/259 통과**했고 실패·취소·skip·todo는 0이다. 실제 backend → Node bridge → 프로토콜 4 → Chrome 카드 정규화 smoke도 통과했다. 임시 격리 경로의 0.4 확장 package 23개 파일도 build·정적 검사를 통과하고 기존 확장 ID를 유지했다. 따라서 v4 **소스 bundle과 격리 확장 package**의 검증·검토는 통과했지만, 현재 `extension/dist`와 설치본을 바꾸거나 Chrome에서 실행한 것은 아니다.

## 추가된 기능과 명시적 비기능

v4가 추가한 것은 다음 다섯 Native Messaging 메서드다.

| 메서드 | 역할 | Python 시작 여부 |
|---|---|---|
| `backend.status` | 구성·수명 상태 조회 | 시작하지 않음 |
| `backend.ensure` | 구성된 전용 read-only backend를 지연 시작하고 준비 확인 | 필요할 때 시작 |
| `source.manifest` | profile, API, catalog identity와 기능 수 조회 | 준비된 backend 사용 |
| `source.search` | 2–500자의 명시적 검색어로 최대 5개 조회 기능 메타데이터 검색 | 준비된 backend 사용 |
| `source.describe` | catalog identity에 결합된 기능 참조의 인자·응답 필드 설명 | 준비된 backend 사용 |

이 경로는 `wts-readonly-v1` / `selector-readonly-v1` profile로 고정된다. Chrome에 전달되는 source capability도 `metadataOnly=true`, `financialQuery=false`, `externalAi=false`를 요구한다.

따라서 v4는 다음 기능을 제공하지 않는다.

- 주가·잔고·공시 같은 실제 금융 데이터 조회 또는 selector operation 실행
- 거래·주문 action
- 생성형 AI, 원격 AI, 로컬 모델 또는 LAYA 추론
- LAYA 학습 자료 생성이나 학습 완료
- 임의 URL, HTTP header, backend 경로, timeout 또는 자격증명의 Chrome 전달
- 카드가 설명하는 operation을 실행하는 버튼

## 선택적 로컬 backend 경계

로컬 호스트 설정에서 `backendRoot`와 `pythonExecutable`은 둘 다 없거나 둘 다 절대 경로여야 한다.

- 둘 다 없으면 source는 `unconfigured`이며 기존 차트 전용 host가 Python을 시작하지 않고 동작한다.
- 둘 다 있으면 첫 `backend.ensure`에서만 별도의 Python child를 지연 시작한다.
- Chrome은 backend 경로나 Python 경로를 wire parameter로 보낼 수 없다.
- backend는 기존 사용자 profile을 재사용하지 않고 WTS data directory 아래의 격리된 임시 상태를 사용한다.
- host가 만든 child만 종료한다. stdin 종료·연결 해제·요청 취소에서 다른 Python이나 다른 애플리케이션을 종료하지 않는다.
- installer는 backend 소스나 virtual environment를 복사·삭제하지 않는다. 개발자가 지정한 두 경로를 검증해 host 설정에 참조만 기록한다.

설치 스크립트의 source backend 옵션은 반드시 쌍으로 쓴다.

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

위 예시는 개발 source 구성을 미리 검사하는 용도다. 현재 설치된 0.3 host를 이 문서 작업에서 변경하지 않았고 installer도 실행하지 않았다. 기본 차트 전용 설치는 두 backend 옵션을 모두 생략한다.

## Chrome 카드 계약

source UI는 side panel의 별도 `조회 기능 찾기` 영역이다. 자유 형식 대화가 source 조회로 자동 routing되는 구조가 아니다.

- 검색 결과는 최대 5개의 `capability-list` item을 표시한다.
- item은 기능 참조, domain, 이름과 선택적 group title만 포함한다.
- 상세 카드는 실행 정책, 필수·선택 인자와 응답 필드를 표시한다.
- 상세 카드의 실행 상태는 항상 `available=false`, 이유는 `FINANCIAL_QUERY_NOT_CONNECTED`다.
- 카드에는 `기능 메타데이터이며 실제 금융 데이터는 조회하지 않았습니다.`라는 고정 notice를 표시한다.
- catalog identity가 검색과 상세 사이에 바뀌면 상세 요청을 중단한다.
- 렌더러는 `textContent`만 사용하고 임의 HTML, URL, 원격 asset과 기본 데이터를 허용하지 않는다.
- 늦게 도착한 이전 연결의 결과, 중복 source 요청, 진행 중인 차트 작업과 충돌하는 source 요청을 거부한다.

정본 카드 형태는 공개 [WTS foundation 계약](../../../contracts/README.md)과 [프로토콜 schema](../../../contracts/wts-foundation.protocol.schema.json)에 정의돼 있다. 이 소스 계약은 실제 Chrome 렌더링 증거가 아니다.

## 확인된 소스 증거

| 구간 | 결과 | 판정 범위 |
|---|---:|---|
| Python metadata backend | 27 tests 통과, 독립 검토 완료 | manifest/search/describe의 metadata-only backend 계약 |
| 프로토콜 4 | 17 tests 통과, 독립 검토 APPROVE | 다섯 Native 메서드와 strict card schema |
| Node supervisor·bridge helper | 28 tests 통과, 독립 검토 APPROVE | lazy owned-child lifecycle, transport 검증, bounded projection |
| 로컬 runtime 통합 | targeted 40 tests와 full 100 tests 통과, 독립 검토 APPROVE | protocol 4 host routing, optional config, 설치 script source 경계 |
| 확장 service worker | targeted 33 tests 통과, 독립 검토 APPROVE | trusted-panel routing, busy gate, disconnect 정리, protocol/runtime gate |
| 확장 panel | targeted 31 tests 통과, 독립 검토 APPROVE | source 검색·상세 상태, generation guard와 정본 카드 렌더링 |
| 전체 JavaScript 검증 | 계약 17 + runtime 100 + 확장 142 = **259/259 통과** | 실패·취소·skip·todo 0; targeted 수치는 이 259개의 부분집합이므로 다시 더하지 않음 |
| 격리 확장 package | 임시 staging 23개 파일 build·정적 검사 통과 | 기존 확장 ID 유지; `extension/dist`와 설치본은 변경하지 않음 |
| 기존 설치본 불변 | 설치된 0.3 `extension/dist` 20개 파일이 이전 승인 staging과 일치하고 기존 로컬 기록 10개도 변경 없음 | v4 미설치 확인; 저장된 v3 task는 0건이라 실제 v3 작업 증거로 해석하지 않음 |
| 실제 native-process source 경로 | 6 methods, 264 operations, search 5건, detail 통과 | 실제 backend와 native framing을 사용한 로컬 소스 통합 |
| backend → bridge → wire 4 → card smoke | 264 operations, search 1건, detail 7 fields, stop 뒤 `ownedChild=false` | 실제 backend metadata가 정본 card validator까지 도달 |

실제 native-process의 6 methods는 기존 `runtime.hello`와 source용 다섯 메서드를 함께 센 값이다. operation 264개는 backend manifest의 관찰값이며 Chrome에 264개 실행 기능을 추가했다는 뜻이 아니다. 검색 5건·1건은 서로 다른 검증의 결과 수이고, detail 7 fields는 smoke에 사용한 한 설명 카드의 관찰값이다.

Node와 Python 구문 검사, Ruff, PowerShell parse 검사는 통과했다. 계약·확장·로컬 runtime·read-only Python source/tests 대상 gitleaks 검사는 누출 0건이었고 placeholder·skip·only 검사도 0건이었다. LSP와 ESLint는 현재 환경에 없어 실행하지 못했다. 더 넓은 기존 selector 검사는 47개가 통과했고, 별도의 사전 존재 35 대 33 불일치 1건은 이번 source metadata 변경과 무관하게 그대로 남아 있다.

소스 카드에는 실제 backend의 정본 metadata를 사용했다. fixture나 임의 기본 카드로 실제 backend 통합을 대체하지 않았다. 이 결과는 로컬 source 통합 증거이며 설치된 Chrome UI 증거는 아니다.

## 아직 증명하지 않은 것

- v4 package의 실제 installer 적용과 rollback·uninstall 검증
- 현재 사용자 설치본의 v4 업그레이드, Chrome 새로고침과 실제 source 목록·상세 렌더링
- 실제 Chrome 연결 해제 중 source child·port 정리
- 실제 금융 조회, AI·모델·LAYA 계획, LAYA 학습, ATHENA 23개 기능 완료

현재 설치본의 실제 Chrome 증거는 0.2 단일 차트 명령 영수증 4건이 마지막이며, 설치된 0.3의 복합 대화 작업도 아직 실제 Chrome에서 확인하지 않았다. 전체 판정은 완료 0개, 부분 1개, 미완료 22개를 유지한다.

설치된 0.3과 v3 검증 경계는 [WTS 대화 작업 v3 검증](chat-task-v3-validation-20261019.md), 전체 기능 판정은 [ATHENA → Chrome 이식 인수 대장](migration-acceptance-ledger-20261019.md)에서 관리한다.
