# WTS 통합 대화 source 0.5 검증

검증일: 2026-10-19

상태: **SOURCE VALIDATION AND STAGING PASS — INSTALLATION/LIVE CHROME PENDING**

대상: 소스 `0.5.0` / Native Messaging 프로토콜 5의 결정형 통합 대화와 로컬 조회 기능 metadata 탐색

## 현재 판정

source 0.5는 Chrome의 한 composer에서 두 가지 기존 기능만 요청하도록 연결한다.

1. 기존 고정 차트 문법을 `wts-control` 작업으로 전달한다.
2. 정확한 `조회 기능 찾아줘: 검색어` 문법을 로컬 metadata `source-search`로 전달한다.

분류는 사용자 PC의 Native Host에서 `deterministic-wts-conversation-v1` 라우터가 수행한다. 생성형 계획기, LAYA, 실제 금융 조회, 주문, 임의 도구 실행과 fallback route는 추가하지 않는다. source 검증, 격리 build, 모든 독립 검토와 최종 보안·보존 검사는 통과했다. 이 문서는 설치 또는 실제 Chrome 통과를 주장하지 않는다.

설치된 host와 `extension/dist`는 `0.3.0` / 프로토콜 3 그대로다. 최신 실제 Chrome 제어 증거는 `0.2.0` 영수증 4건이고 설치된 v3 task는 0건이다. 0.3 복합 작업, 0.4.1 월봉·년봉과 0.5 통합 composer는 실제 Chrome에서 확인하지 않았다. 전체 기능 판정도 완료 0개, 부분 1개, 미완료 22개를 유지한다.

## 로컬 라우팅 계약

프로토콜 5의 `conversation.route` 요청은 정확한 `{submissionId, text}` 객체만 허용한다.

- `submissionId`: UUID
- `text`: 앞뒤 공백을 제거한 1–512자 사용자 입력. routing prefix도 이 길이에 포함
- source 검색어: `조회 기능 찾아줘: ` 뒤의 공백을 제거한 2–500자

selector, URL, path, Native method, HTTP header, credential, timeout, 금융 실행 인자는 요청에 넣을 수 없다. 결과는 같은 `submissionId`를 되돌리고 다음 세 형태 중 하나만 반환한다.

| route | 조건 | 결과 |
|---|---|---|
| `wts-control` | 기존 `compileTaskInput`이 전체 입력을 고정 차트 문법으로 해석 | 정규화된 차트 문장만 전달 |
| `source-search` | 정확한 `조회 기능 찾아줘: 검색어` 문법과 2–500자 검색어 | 정규화된 검색어만 전달 |
| `unsupported` | 그 밖의 모든 입력 | `지금은 차트 명령과 “조회 기능 찾아줘: 검색어”만 지원합니다.` |

부분 일치, 부정·혼합 지시, 일반 질문과 임의 명령에는 generic fallback이 없다. `unsupported` 분류는 chart task, source request, backend 시작, browser observation과 persistence를 모두 0회로 유지해야 한다. 분류 자체도 Python backend를 시작하거나 도구를 실행하지 않는다. Native 응답의 `submissionId`가 요청과 다르면 branch dispatch 전에 거부한다.

hello의 `conversation` capability는 router ID, `generative=false`, 허용 route 두 개를 정확히 보고해야 한다. 차트 catalog 2와 compiler 2, legacy task/receipt 호환성은 [차트 월봉·년봉 source 0.4.1 검증](chart-period-v2-validation-20261019.md)의 승인된 경계를 그대로 유지한다.

## 검색 카드와 상세 binding

metadata 검색 결과는 기존 canonical `capability-list` card로 같은 대화에 표시한다. 상세 버튼은 coordinator가 방금 검증한 list card의 `submissionId`, `operationRef`, `expectedCatalogVersion` binding과 모두 일치할 때만 `panel.chat.describe`를 보낼 수 있다.

- 임의 operation reference 또는 오래되거나 제거된 binding은 새 명시적 검색을 요구한다.
- 상세 조회는 현재 source manifest를 다시 읽어 catalog identity를 검증한다.
- 상세 결과는 metadata card일 뿐 described operation을 실행하지 않는다.
- detail 요청은 완료된 submit 결과 cache를 덮어쓰지 않는다.
- 카드에는 execute, trade 또는 financial-query 버튼을 추가하지 않는다.

binding은 메모리에서 최대 12개와 encoded 256 KiB로 제한하고 오래된 완전한 항목부터 제거한다. extension storage나 disk에 chat/source card를 새로 저장하지 않는다.

## activity, 취소와 복구

라우팅 전에 하나의 exclusive conversation reservation을 잡고 branch admission까지 유지한다. 이 reservation을 기존 foreground/source lock 안에 다시 중첩하지 않는다. 이미 진행 중인 source·chart·capture·receipt·task journal recovery와 서로 배타적이어야 한다.

- 같은 `submissionId`와 같은 정규화 text는 진행 중 promise 또는 bounded 완료 결과를 재사용한다.
- 같은 ID에 다른 text는 거부한다.
- 다른 ID가 reservation 동안 들어오면 busy로 거부한다.
- chart branch는 control gate와 저장된 capture를 다시 확인한다.
- configured source branch는 저장된 WTS capture 없이 metadata 검색을 허용하지만 source 구성과 pending recovery guard를 다시 확인한다.
- route 응답·generation 검증 뒤에도 authoritative branch gate를 다시 확인하고, 취소나 disconnect가 먼저 이기면 dispatch하지 않는다.

Stop은 routing과 control admission, 기존 chart task에만 적용한다. source dispatch 뒤에는 Stop을 비활성화하고 기존 Disconnect만 coarse cancellation으로 사용한다. 버려진 late result를 backend 취소 성공으로 표시하지 않는다. Disconnect/reconnect는 generation을 바꾸고 진행 중 route/result와 session-only binding을 무효화한다.

패널을 닫는 행위는 service worker가 이미 수락한 요청을 자동 취소하지 않는다. 기존 chart task는 기존 journal recovery를 따른다. 반면 typed message와 metadata card history는 session-only이며 패널을 다시 열 때 암시적으로 replay하지 않는다.

## Chrome UI 경계

source 0.5는 별도 조회 composer를 통합 composer로 교체하는 범위다. typed text, task 상태와 validated source card를 같은 conversation history에 표시하되 다음 제한을 유지한다.

- 모든 text는 `textContent`로 렌더링한다.
- history는 최대 12개 entry와 encoded 256 KiB다.
- 한도를 넘으면 가장 오래된 완전한 terminal message부터 제거한다.
- active task view는 history와 별도로 authoritative 상태를 계속 표시한다.
- panel reopen은 source search, detail 또는 route를 자동 재실행하지 않는다.
- 연결됐고 `controlReady` 또는 `sourceConfigured`일 때만 composer를 활성화하며 busy/recovery guard를 우선한다.
- 지원 문법과 metadata-only 제한을 UI에 명시한다.

health는 reservation 동안 `conversationRunning`, routing 단계에서만 `conversationRouting`, 현재 단계를 `idle|routing|control|source`로 보고한다. source 작업의 authoritative completion/error/disconnect 전에는 source busy 상태를 임의로 해제하지 않는다.

## 고정 비기능과 제품 범위

이 slice는 다음을 제공하지 않는다.

- 생성형 대화, 모호성 질문 생성 또는 자유 형식 목표 계획
- 원격 AI나 로컬 모델 fallback
- LAYA 추론·재학습 또는 training gold 생성
- 실제 금융 데이터 query, selector operation 실행 또는 계좌 조회
- 실계좌 주문, 모의투자 주문, 자동매매
- arbitrary tool, CSS selector, JavaScript 또는 shell 실행

향후 모의투자 주문은 주문표마다 사용자가 개별 확인하고 로컬 실행기가 계좌·모의환경·payload·만료·일회성을 재검증하는 별도 기능으로만 인수한다. 이 composer 구현은 그 주문 ticket 경계를 제공하거나 주문 기능을 완료하지 않는다. 실계좌 주문과 자동매매는 계속 제품 범위 밖이다.

## source 검증 결과

root의 fresh 전체 JavaScript 실행은 계약 20개, runtime 109개, extension 198개로 **327/327**을 통과했다. 실패·취소·skip·todo는 모두 0이다.

- 계약·runtime 독립 검토는 지적 0건으로 승인됐다. 검토자는 44개 집중 검사, 기존 차트 정의 29개 불변과 installer의 runtime 파일 14개 exact allowlist를 확인했다.
- 실제 runtime fixture를 잇는 통합 테스트 24개가 통과했고 별도 검토도 지적 0건으로 승인됐다. fixture 범위 밖의 설치본·브라우저 동작은 증명하지 않는다.
- panel 집중 검사 57개는 health 오류 처리 수정 뒤 통과했고 독립 검토도 지적 0건으로 승인됐다. source 0.5에 추가된 keep-set 경로 5개의 exact 목록도 별도 검토를 통과했다.
- 마지막 coordinator 검토가 찾은 routed payload binding, source pre-dispatch 취소, legacy submit 우회 세 문제는 수정됐고 집중 검사 26개가 통과했다. 독립 재검토도 지적 0건으로 승인됐다.
- backend 경로를 구성한 installer DryRun은 `backendConfigured=true`, `filesWritten=false`, `registryUpdated=false`를 확인했다. 실제 installer 적용이나 installed host 변경 증거가 아니다.
- 최종 extension gitleaks 검사는 leak 0건, keep-set 검사는 84개 파일 중 누락 0건, placeholder 검사는 0건, `git diff --check`는 오류 0건이었다. 앞서 계약·runtime·공개 문서 범위도 leak 0건이었다.

root가 마지막 수정 뒤 실행한 실제 cross-layer smoke도 통과했다. 이 smoke는 dispatcher와 conversation reservation에서 시작해 Native router/handler, source coordinator/bridge, 실제 read-only Python backend, wire 5와 canonical card normalizer까지 연결했다.

- 분류 단계의 backend ensure/request는 0회였고 금지된 호출도 0회였다.
- read-only 호출 순서는 manifest → search → manifest → describe였으며 목록 1개와 상세 필드 7개를 검증했다.
- 같은 submission의 duplicate native call은 0회였고 최종 conversation 상태는 `idle`이었다.
- Python child는 종료됐고 해당 실행의 임시 디렉터리도 제거됐다.
- 응답은 `financialQuery=false`, `externalAi=false`를 유지했다.
- Chrome transport와 실제 Chrome은 이 smoke에 포함하지 않았다.

격리 staging은 source `0.5.0` 확장 파일 24개를 만들고 stable extension identity를 유지한 채 build와 정적 검사를 통과했다. 공개 문서에는 staging의 개인 절대 경로와 실제 확장 ID를 기록하지 않는다.

예비 smoke가 만든 다른 격리 임시 위치의 정리를 시도했으나 자동 정책이 추가 삭제를 허용하지 않아 빈 임시 디렉터리 하나가 남았다. 사용자 데이터나 설치본은 들어 있지 않다. Python 실행 과정에서 생성될 수 있는 bytecode까지 파일시스템 무변경으로 주장하지 않는다.

설치된 host와 `extension/dist`는 `0.3.0` 그대로이며 dist 20개 파일과 기존 비공개 기록 10개 모두 기준 hash가 일치했다. task 디렉터리는 없다. 읽기 전용 감사는 캡처 6건, 관측 6건, verified receipt 4건을 오류 없이 읽었고 `legacyComplete=true`, `currentComplete=false`를 보고했다. `trainingGold`, `layaReady`, live guard 완료 플래그는 모두 false다. 설치·실제 Chrome 인수는 아직 남아 있다.

승인된 0.4.1 차트 bundle의 **285/285** 결과와 0.4 metadata의 역사적 **259/259** 결과는 각각 기존 검증 문서에 보존한다. source 0.5의 **327/327** 결과는 설치본·실제 Chrome·전체 기능 완료 증거로 재해석하지 않는다.

전체 이식 완료 조건은 [ATHENA → Chrome 이식 인수 대장](migration-acceptance-ledger-20261019.md)에서 관리한다.
