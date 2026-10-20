# Chrome ChatGPT 0.8 연결 검증

기준일: 2026-10-19. 이 문서는 진행 중인 작업 기록이며, 실제 ChatGPT 인증·대화·WTS 제어 완료를 뜻하지 않는다.

## 현재 확인된 설치 기준선

0.8 변경 전 설치본을 실제 Native stdio로 다시 검사했다. 확장·실행기 0.7.0 / 프로토콜 7, `runtime.hello`와 `inventory.summary`, 정상 종료를 확인했다. 검사 전후 로컬 데이터 11개 파일의 해시가 동일했다. 이는 사용자 Chrome의 AI 대화나 금융 조회 검증과는 별개다.

## 이번 작업 범위

- 기존 Chrome 대화창에 별도 ChatGPT 연결·모델 선택·응답·취소 상태를 추가한다.
- 기존 로컬 문법으로 처리할 수 있는 요청은 먼저 로컬에서 처리한다. 그 밖의 문장은 연결된 ChatGPT 모델에 요청하며, 제출한 문장과 허용된 화면 명령 목록만 전달한다.
- AI가 제안한 화면 명령은 Chrome에 표시하고 사용자가 실행을 선택했을 때만 기존 관찰·작업·후조건·영수증 경로로 넘긴다.
- 인증값과 토큰은 확장 저장소나 대화에 넣지 않는다. 토큰은 Native 프로세스 메모리에만 있으므로 해당 프로세스가 종료되면 다시 연결해야 한다.
- 사용자 PC의 기존 Codex·ChatGPT·Claude 인증 파일을 읽거나 재사용하지 않는다. 금융 데이터, 화면 HTML·캡처와 로컬 파일은 모델 입력에 포함하지 않는다.
- 실제 로그인·MFA·권한 동의는 사용자가 공식 브라우저 화면에서 수행한다. 계정 이용 가능 여부와 모델 호환성은 실제 응답으로 판정한다.

## 구현 및 검증 상태

| 영역 | 상태 | 증거 범위 |
| --- | --- | --- |
| Chrome UI / service worker | 모델 실패 상태 복구 수정 후 전체 검사 355/355 및 독립 검토 APPROVE | 실패·취소 상태 동기화·읽기 전용 상태 확인, static/build 통과 |
| Native provider 취소·결과 처리 | 모델 실패 진단 수정·독립 검토 통과 | 모델·전송·대화·계약 통합 122/122; 직전 인증 수리의 전체 검사 342/342는 역사적 기준선 |
| 인증 식별자 / 브라우저 helper | 수정·독립 검토 통과 | 실제 등록·토큰 발급은 미검증 |
| Native wire 검증 | 엄격한 상태·식별자·크기 검증 및 독립 검토 통과 | 실제 계정 증거 없음 |
| 설치·업데이트·제거 | 격리 테스트 44건 및 독립 검토 통과 | 실제 updater DryRun·Apply 성공, 0.7 복구 사본 보존 |
| 격리 Chrome 패널 QA | 모델 상태 복구 빌드에서 25/25 통과 | 실제 패널 모듈과 모의 Port 전송으로 모델 실패·읽기 전용 상태 복구 포함; 실제 계정 연결 증거는 아님 |
| 0.8 설치본 | 적용 및 실제 Native stdio 검사 통과 | 확장 50개 파일 해시 일치, 실행기 0.8.0 / 프로토콜 8 hello·미연결 provider 상태·정상 종료 확인 |
| 실제 ChatGPT 인증·모델 응답 | 미검증 | 완료된 실제 Responses 응답 필요 |
| 실제 확장 경유 WTS 제어 | 미검증 | 명시적 실행 후 새 검증 영수증 필요 |

최종 Native 검사 기록은 `.omx/artifacts/wts-v8-native-contract-final-test.log`이다. 최초 전체 검사 326건 중 5건의 실패를 숨기지 않고 원인을 분리했다. 현재 protocol 8 fixture 두 곳의 오래된 `0.7.0` 표기를 수정했으며, 나머지는 제품의 시작 제한 시간보다 짧은 테스트 대기와 Windows 종료 후 임시 파일 정리 경합이었다. 제품 timeout이나 검증 조건을 줄이지 않고 기존 제한 시간 내 조건 대기, `finally` 정리와 소유 경로에 대한 제한적 삭제 재시도를 적용했다. 수정 후 순차 검사에서 실패·skip·todo는 모두 0이다. 변경되지 않은 설치·업데이트 44건은 앞선 전체 실행과 별도 독립 검토의 결과를 사용한다.

인증 helper의 추가 실결함도 수정했다. WHATWG `URLSearchParams`가 공백을 `+`로 직렬화하지만 PowerShell percent decoder는 이를 공백으로 해석하지 않아 정상 인증 URL을 거부했다. form 방식으로 디코딩하고 중복·대소문자 변형 키를 거부한다. 실제 helper 사본에서 브라우저 실행 한 줄만 검증용 stub으로 바꾸는 회귀로 정상 URL 수락과 비정상 URL 거부를 확인했다. 이 검사는 실제 인증 또는 브라우저 실행을 하지 않는다.

확장 검토에서 발견된 HIGH 3건과 MEDIUM 2건도 수정하고 별도 검토자가 승인했다. 각 비동기 계획은 고유한 job·연결 세대·원래 패널 소유자·예약에 묶인다. 접수 응답이 시간 초과되면 자동으로 재요청하거나 잠금을 풀지 않으며, 상태 조회로 확인한 고아 작업은 취소·소비한다. 고아 결과는 실행 가능한 제안을 만들지 않는다. 패널 Port 알림 전송 실패도 정리하여 새 패널이 정상 연결되도록 했다. 315건 전체 검사에서 실패·skip·todo는 모두 0이다.

승인 소스 138개 파일의 SHA-256 manifest는 `.omx/artifacts/wts-v8-source-freeze-before-cutover.json`에 기록했고, 최종 검사 후에도 138개 모두 일치했다. 설치 전에 0.7 Native 소유 프로세스 5개를 종료하고 잔여 host 0개를 확인했으며, 기존 데이터 11개 파일의 해시는 종료 후에도 동일했다. 최종 확장 빌드 50개 파일을 격리 경로에서 검사한 뒤 설치했다. `.omx/artifacts/wts-v8-final-extension-build.json`의 파일별 manifest로 설치 대상을 고정했다. 최종 패널 QA는 11/11 통과했고, 소유한 격리 Chrome 및 임시 프로필 잔여가 모두 0임을 확인했다. 패널 QA 결과는 `.omx/artifacts/wts-v8-panel-browser-offline-20261019/result.json`이다.

## 실제 인수 절차

1. 설치된 확장과 Native 실행기의 버전·파일을 확인하고 Chrome에서 로컬 실행기를 연결한다.
2. `Continue with ChatGPT`로 공식 인증을 시작한다. 사용자가 로그인과 필요한 동의를 끝낸 뒤 실제 모델 목록에서 모델을 선택한다.
3. `안녕. 연결이 됐는지 한 문장으로 답해줘.` 같은 비민감한 일반 대화의 완료 응답이 Chrome에 나타나는지 확인한다.
4. `현재 WTS 화면에서 차트 화면으로 이동하는 명령을 제안해줘.` 또는 `차트를 주간 단위로 보여주도록 바꾸는 명령을 제안해줘.`를 보낸다. 이 문장들이 로컬 결정적 문법에 해당하지 않음을 사전 확인했으므로, 실제 provider 경로를 검사할 수 있다. 반환된 정확한 제안을 확인한 뒤 실행한다.
5. 현재 WTS 화면의 후조건과 새 영수증을 함께 확인한다. 모델 답변, 일반 브라우저의 직접 클릭, 테스트용 응답을 실행 성공으로 집계하지 않는다.
6. 패널 종료·취소·연결 해제 뒤 이전 제안이 실행되지 않는지 확인한다. 모의·실전 주문은 이 검증에 포함하지 않는다.

사용자가 별도 채팅에서 승인한 저장소 통합과 조율했다. 통합 Git HEAD는 `bb9a3c9c1f2f57c387d865d364028422474c2c59`이며 승인 소스 138개는 모두 보존됐다. 그러나 Windows 열린 핸들 잠금으로 폴더 이름 변경이 거부되어 `C:\Projects\DAOU.Athena`가 계속 실제 물리 경로다. `C:\Projects\ATHENA`로의 전환은 완료되지 않았다. 두 작업이 상호 동결을 해제하기로 조정한 뒤, 현재 물리 SourceRoot·BackendRoot·PythonExecutable로 0.8을 설치했다. 이후 물리 경로 전환은 Native 종료와 설정 갱신을 다시 조율해야 한다.

실제 설치 증거는 `.omx/artifacts/wts-v8-installed-verification-20261019.json`이다. Native 업데이트는 기존 레지스트리 위치를 유지하고 보호된 0.7 복구 사본을 생성했다. 확장 `extension/dist`의 50개 파일은 승인된 빌드와 모두 일치하며, 기존 dist도 별도 보존했다. 설치된 Native를 직접 기동한 검사에서 0.8.0 / 프로토콜 8, 유효한 hello, ChatGPT 미연결 상태, 정상 종료를 확인했다. 검사 전후 데이터 11개 파일의 SHA-256 digest는 `65abb9bf3dd24c6451406efb62b422697ee5cb518a95d63ddf6dcc89fc0fa7b9`로 동일했다.

경로 전환 협의는 사용자의 “예약하지 않고, 작업 종료 후 제가 다시 요청하겠습니다” 결정으로 종료됐다. 전환 자동화를 생성하지 않으며, 새 요청 전에는 폴더 rename 재시도나 전환을 위한 프로세스 종료를 하지 않는다. 기존 Native·ChatGPT 연결 검증은 현재 물리 경로에서 계속한다.

설치 후 독립 읽기 전용 감사도 APPROVE를 받았다. 설치된 승인 원본 31개(runtime 26개, helper 2개, package와 contract 2개)의 해시가 현재 승인 소스와 모두 일치한다. Host 전체 35개와 확장 전체 50개 파일의 누락·추가가 없고, 이전 Native와 확장 0.7 백업도 실제 존재한다.

사용자는 로컬 실행기 연결 단계부터 `처리 중`이 유지되고, `dd`를 보내면 `요청을 완료하지 못했습니다. 자동으로 다시 실행하지 않습니다.`라는 공통 실패 문구가 나타난다고 보고했다. 실제 로그인·모델 선택은 확인되지 않았다. 설치된 Native에 stdin을 열어 둔 별도 진단에서 `runtime.hello`, `inventory.summary`, `provider.status` 세 응답이 156ms 내에 도착했고, stderr 없이 정상 종료됐다. 따라서 Native 초기 응답 자체가 멈췄다는 가설은 이 별도 검사에서 재현되지 않았다. 사용자 Chrome의 패널과 Native 사이 전체 연결을 입증한 것은 아니다.

소스에서는 두 결함을 별도로 재현했다. 첫째, 초기 상태와 패널 소유자 연결 실패가 `처리 중`으로 표시되고 Port 단절이 오류 안내를 덮어썼다. 둘째, 정상 `provider-pending` 대화 응답이 패널 소비자의 허용 종류에서 빠져 거부됐다. 공통 실패 문구만으로 사용자의 실제 실패 원인을 단정할 수 없다. 두 결함은 수정하고 회귀 검사를 추가했다. 앞서 기록한 315건 검사와 11건 격리 QA는 수정 이전 결과다. 특히 이전 격리 QA는 실제 provider 모듈을 사용했지만 전체 `panel.mjs` 초기화 경로는 테스트 코드로 대체하여 대화 소비자의 통합 결함을 검출하지 못했다.

패널 수정 후 전체 확장 검사는 324/324 통과했고 실패·skip·todo는 0이다. 최초 제한된 실행에서는 Windows 임시 태스크 저장소 게시가 실패했으나, 동일 소스와 테스트를 일반 사용자 권한으로 실행하면 모두 통과했다. 실패 기록도 보존한다. 별도 검토자는 수정된 소스 3개와 테스트 3개의 동결 해시, 집중 검사 59건, 정적 검사를 확인하고 APPROVE했다. 연결 거부는 중복 패널·문서 식별 실패 등 알려진 원인별 고정 안내로 표시하며 임의 오류 원문은 출력하지 않는다. 수정 빌드의 50개 파일 중 변경된 제품 파일은 `sidepanel/panel-source.mjs`, `sidepanel/panel.mjs`, `sidepanel/provider-panel.mjs` 세 개뿐이다. Native 실행기와 인증 구현은 이번 수리에서 변경하지 않았다.

수정 빌드의 격리 Chrome 검사는 14/14 통과했다. 실제 `panel.mjs`를 초기화하고 모의 Chrome 전송으로 입력 제출 → `provider-pending` → 진행 표시 → 성공 답변·입력 재활성화를 확인했다. 이 시나리오의 제출은 1회이며 WTS 제어 요청은 0회였다. 문서 식별 오류가 Port 단절 뒤에도 유지됨을 확인했다. QA가 소유한 Chrome 프로세스는 정상 종료했고 임시 경로 2개를 제거했으며 해당 임시 프로필의 잔여 프로세스도 0개였다. 최종 결과는 `.omx/artifacts/wts-v8-panel-repair-browser-offline-20261019/result.json`이며 SHA-256은 `03e32789333bfa1d1883362a6f0f1b81bda17ecfa30f80b3390308d484d8964f`이다.

검토와 QA를 통과한 수정 빌드를 `extension/dist`에 반영했다. 이전 0.8 dist는 `.omx/artifacts/wts-v8-dist-before-panel-repair-20261019`에 보존했고, 설치 후 50개 파일 해시가 새 manifest와 모두 일치했다. 새 manifest와 설치 기록은 각각 `.omx/artifacts/wts-v8-panel-repair-build-20261019.json`, `.omx/artifacts/wts-v8-panel-repair-installed-20261019.json`이다. Chrome에서 수정본을 새로고침한 뒤 표시되는 실제 연결 상태를 사용자에게 요청했다. 실제 인증·모델 선택·대화·WTS 제어는 아직 미검증이다.

도구가 Chrome 확장 내부 페이지에 접근할 수 없어 확장 새로고침·내부 패널 조작은 사용자에게 안내해야 한다. 설치 stdio 검사 및 격리 패널 QA를 실제 계정 인증이나 Chrome 대화의 완료 증거로 해석하지 않는다.

사용자가 수정본을 다시 로드한 뒤 보낸 화면에서는 Native Messaging 0.8.0이 service worker 경로로 연결됐고, ChatGPT 영역은 `패널 식별 실패`와 문서 식별자를 확인하지 못했다는 안내를 표시했다. 이 증거로 현재 차단은 Native 초기 연결이 아니라 패널 소유권 등록의 documentId 검사임을 확인했다. [Chrome MessageSender 문서](https://developer.chrome.com/docs/extensions/reference/api/runtime/#type-MessageSender)는 documentId를 선택 항목으로 정의한다. 모든 Chrome 패널이 이 필드를 생략한다고 일반화하지 않는다. 별도 수리 계획 `.omx/plans/wts-provider-port-owner-repair-20261019.md`에 따라 신뢰한 패널의 실제 Port 객체에 권한을 묶도록 수정했다.

Port 권한 수리는 정확한 확장 ID·패널 URL·Port 이름을 유지하며 실제 Port 객체와 서버 발급 owner ID를 검사한다. provider 명령과 대화 제출은 이 Port로만 받고 일반 메시지의 우회 요청은 거부한다. 대기 요청은 양쪽 각각 16개로 제한하고 30초 응답 제한 후 자동 재전송하지 않는다. 연결 종료 시 대기 요청·패널 상태·제안을 비우며 이미 resolve된 확인·거부 콜백도 이전 세대이면 적용하지 않는다. 분류 중 패널이 닫히면 후속 실행 전에 취소한다. Native 및 기존 PlanJob 예약·저장된 제안의 단일 사용 확인 로직은 변경하지 않았다.

실제 staged service worker 회귀에서 문서 ID 없는 정상 Port, 같은 Port의 provider 상태 조회·대화 전달, 다른 Port·owner·발신자·중첩 owner·일반 메시지 우회 거부를 검사했다. 확장 전체 333/333, 독립 집중 검사 71/71, 정적 검사와 별도 소스 검토 APPROVE를 받았다. 전체 실행의 요약과 개별 TAP 미보존 여부는 `.omx/artifacts/wts-v8-port-owner-extension-tests-20261019.log`에 명시했다. 격리 Chrome 20/20 검사는 실제 패널 초기화와 모의 Port 전송으로 Continue 활성화·대화 완료 표시·종료 경합을 확인했다. 이는 실제 사용자 Chrome의 로그인·OpenAI 응답을 대신하지 않는다.

승인된 Port 수정 빌드 50개 파일을 `extension/dist`에 반영하고 설치 해시 일치를 확인했다. 이전 설치본은 `.omx/artifacts/wts-v8-dist-before-port-owner-repair-20261019`에 보존했다. 최신 증거는 `.omx/artifacts/wts-v8-port-owner-build-20261019.json`, `.omx/artifacts/wts-v8-port-owner-installed-20261019.json`, `.omx/artifacts/wts-v8-port-owner-browser-offline-20261019/result.json`이다. 마지막 QA 결과 SHA-256은 `262f9a56db8744b39a809f22db24662ed4a2ec4fbca0a215b21e4d07f9b873ff`이며 소유 Chrome은 정상 종료되고 임시 경로 2개가 제거됐다. 사용자에게 확장 재로드·공식 로그인·동의·모델 선택을 요청했다. 실제 인증·모델 응답·WTS 제어는 아직 미검증이다.

## 로그인 callback 이후 실패 수리

사용자는 공식 로그인·동의를 마친 뒤 `OpenAI login received. You can close this window.`를 확인했고, 이어 패널에 `ChatGPT 연결 실패: ChatGPT 계정 연결을 완료하지 못했습니다.`가 표시됐다고 보고했다. callback 성공 문구는 인증 반환값 수신을 뜻하며 토큰 교환·신원 검증·세션 활성화까지의 완료 증거는 아니다. Edge는 Windows 기본 브라우저로 열린 것이며 callback 자체는 수신됐으므로 브라우저 선택을 현재 실패 원인으로 단정하지 않는다.

공개 discovery/JWKS만 조회하는 별도 검사에서 실제 OpenAI 서명키 4개 중 일부의 `x5c` 필드를 기존 검증기가 거부하는 결함을 확인했다. 인증·토큰 교환 없이 가짜 서명으로 검사했을 때 수정 전 `OPENAI_OIDC_JWKS_INVALID`, 수정 후 `OPENAI_OIDC_SIGNATURE_INVALID`가 반환됐다. 공개 메타데이터 호환성은 복구됐고 가짜 서명 거부는 유지된다. 과거 실제 오류는 공통 문구로 치환되어 이 결함이 당시 계정 연결 실패의 유일한 원인인지는 단정할 수 없다.

`x5c`는 크기와 형식이 제한된 선택 메타데이터로만 허용한다. 공개키 생성은 기존 `kty/n/e`만 사용하고 JWT 헤더의 외부 키 지정 금지 및 서명·issuer·audience·nonce 검증을 유지한다. 실패 단계는 토큰 교환·응답 형식·신원 검증·등록·세션 활성화 등 알려진 오류 9개를 고정된 코드·한국어 문구로 구분한다. 원문 HTTP 응답·토큰·인증 코드·URL은 안내에 넣지 않는다. 초기 토큰 응답의 필수 `scope` 검사는 현재 공식 SIWC 계약과 일치하므로 유지했다.

패널은 실패·취소된 connect 결과를 소비한 뒤 `signed-out`으로 전환하고 모델 상태를 비운다. `connecting` 상태가 남아 Continue 버튼이 계속 잠기는 결함을 회귀 테스트로 재현한 뒤 수정했다. 자동 인증 재시도는 없다.

변경 9개 파일의 동결 해시를 독립 검토했고 집중 검사 132/132와 APPROVE를 받았다. 확장 전체 335/335, Native·계약 전체 342/342, static/build 검사가 통과했으며 실패·skip·todo는 0이다. 격리 Chrome QA는 22/22 통과했다. 새 실패·취소 시나리오는 Continue 재활성화·busy 해제·고정 오류 유지·자동 재실행 0회를 확인한다. QA Chrome은 정상 종료됐고 임시 폴더 2개 및 해당 프로필의 잔여 프로세스 0개를 확인했다.

증거는 `.omx/artifacts/wts-v8-auth-repair-build-20261019.json`, `wts-v8-auth-repair-extension-tests-20261019.log`, `wts-v8-auth-repair-native-contract-tests-20261019.log`, `wts-v8-auth-repair-browser-offline-20261019/result.json`, `wts-v8-public-oidc-after-x5c-repair-20261019.json`에 있다. 실제 계정 재연결·모델 응답·WTS 실행은 별도 검증이 남아 있다.

업데이트 준비에서 전체 프로세스 명령줄을 읽는 별도 진단은 자동 승인 검토로 거부됐다. 이후 updater의 실행 중 프로세스 검사도 설치 경로를 서버 측 WQL에서 필터링하고 `ProcessId/ParentProcessId/Name`만 반환하도록 좁혔다. 자손 검사·실패 시 중단·복구 조건은 유지했다. 독립 검토 APPROVE, fixture 4/4 및 실제 격리 업데이트 관련 검사 7/7을 통과했다. 새 방식의 실제 DryRun·Apply도 성공했다. 기존 Native 전용 PID는 시작 시각·실행 파일·부모를 재확인한 뒤 종료했고, Chrome·Edge는 종료하지 않았다.

인증 복구 수정본은 Native 실행기와 `extension/dist` 모두에 적용됐다. 확장 50개 파일은 승인 manifest와 일치하며 이전 dist는 `.omx/artifacts/wts-v8-dist-before-auth-repair-20261019`에 보존했다. Native의 이전 0.8 설치본은 보호된 `.WtsNativeHost-rollback-20261019T073258Z-0d832541f9a34ff78c3fefe3e1f90d07` 사본과 보안 메타데이터로 보존했다. 설치된 Native의 실제 stdio 검사에서 버전 0.8.0·프로토콜 8·유효한 hello·미연결 provider 상태·정상 종료를 확인했다. 설치 전과 직후 검사에서 로컬 데이터는 16개 파일, SHA-256 digest `c85ef30d5d73b2bf3377468af9a9bc2a3767b483005f7cd5b1e359bd7a4b2fbe`로 동일했다. 앞선 실제 인증 시도 전의 11파일 기준선과 구별한다.

사용자에게 확장과 WTS 새로고침 후 새 공식 인증을 요청했다. 도구에서 확장 내부 화면 접근이 제한되어 이 조작은 직접 요청해야 한다. Edge 인증도 허용되는 기존 반환 경로를 사용하며 Windows 기본 브라우저는 바꾸지 않았다. 최신 실제 계정 결과를 기다리는 중이다.

설치 후 독립 읽기 전용 감사도 APPROVE다. Native 승인 원본 31개 및 설치 전체 35개, Native 복구본 35개, 새 확장 50개 및 이전 확장 백업 50개가 모두 해당 manifest와 일치했다. 기록은 `.omx/artifacts/wts-v8-auth-repair-installed-20261019.json`이다. 새 인증 시도에서 데이터가 정상 변경될 수 있어 감사 단계에서는 설치 직후 데이터 해시를 현재 상태에 강제하지 않았다.

## 실제 모델 목록 조회 실패 후속 수리

인증 수정본 설치 후 사용자는 `ChatGPT 모델 목록 실패: ChatGPT 모델 목록을 가져오지 못했습니다.`를 보고했고, 현재 화면의 상태 문구는 `연결됨`이라고 답했다. Native의 모델 작업은 connected와 활성 토큰 세션을 확인한 뒤 시작하므로 요청 시작 시에는 인증 절차가 진전했다. 다만 모델 실패 이후 UI가 Native 연결 상태를 다시 읽지 않는 결함이 있어 화면의 연결됨만으로 현재 세션 유지를 확정하지 않는다.

현재 공식 [SIWC 모델·추론 문서](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)를 다시 확인했다. `/v1/models`, OAuth Bearer, 최상위 `models` 배열, `visibility=list`, `display_name` 및 `slug` 사용은 구현과 일치한다. 응답 크기·모델 개수 제한이 이번 실제 오류 원인이라는 증거는 없으므로 제한이나 주소를 추측으로 바꾸지 않는다.

확인한 결함은 오류 정보와 상태가 가려지는 부분이다. Native는 여러 모델 실패를 하나의 공통 오류로 치환했고, UI는 모델 실패 후 예전 연결 상태나 선택 모델을 남길 수 있었다. 모델 오류를 알려진 고정 코드·문구로 분류하고, 모델 실패·취소 뒤 같은 Native 세션의 상태를 다시 읽도록 수리한다. 별도 읽기 전용 상태 확인 버튼으로 새 인증 없이 현재 상태를 확인할 수 있게 한다. 원문 HTTP 본문·인증값·계정 정보는 출력하지 않는다.

실제 모델 목록 실패의 하위 원인, 완료된 모델 응답, 확장 경유 WTS 후조건과 새 영수증은 아직 확인되지 않았다.

모델 진단과 상태 복구 수정 14개 파일은 독립 검토 APPROVE를 받았다. Native 모델·전송·대화·계약 통합 122/122, 확장 전체 355/355, 독립 집중 167/167, 격리 Chrome 25/25, static/build 검사가 통과했다. 모델 실패 terminal을 소비하는 동안 소유자가 바뀌는 경합도 재현하고 수정했다. 상태 확인 버튼은 기존 status 요청만 수행하며 인증·모델 요청을 자동 재시작하지 않는다. Native가 이미 소비한 terminal 요약을 상태에 다시 반환하는 실제 형태도 producer 회귀로 검증했다. Chrome UI harness는 공개 bridge snapshot을 모의하므로 producer 검증과 범위를 구분한다.

검증한 수정본을 Native와 확장에 적용했다. Native DryRun·Apply는 모두 성공했으며 이전 설치본은 `.WtsNativeHost-rollback-20261019T080911Z-f83d6aaa7bda4142a790f82822faf772`와 보안 메타데이터로 보존했다. 확장 50개 파일은 승인 manifest와 일치하고 이전 설치본은 `.omx/artifacts/wts-v8-dist-before-models-repair-20261019`에 남겼다. 별도 설치 stdio 검사에서 0.8.0·프로토콜 8·유효한 hello·미연결 상태·정상 종료를 확인했다. 설치 전후 데이터는 16개 파일, digest `30bbb4d6b243060d4a6e8de0fcf5441d7080f451295c7bed694b73da660ccfaa`로 동일했다. 이전 인증 수리 직후와의 해시 차이는 그 사이 사용자 인증이 있었으므로 설치 중 변경과 혼동하지 않는다.

최신 증거는 `.omx/artifacts/wts-v8-models-repair-build-20261019.json`, `wts-v8-models-repair-installed-20261019.json`, `wts-v8-models-repair-native-contract-tests-20261019.log`, `wts-v8-models-repair-extension-tests-20261019.log`, `wts-v8-models-repair-browser-offline-20261019/result.json`이다. QA 결과 SHA-256은 `5980ecaf574b2f031414ac43b3b9344529e04e0fefd0f21723f61b953912dd28`이다. 기존 영수증 4개의 파일 식별·해시 기준선을 별도 저장했으며, 이를 새 실제 제어 성공으로 집계하지 않는다.

실행기 교체로 메모리 로그인 세션이 종료됐음을 안내하고, 사용자에게 수정 확장·WTS 새로고침 후 새 인증과 모델 목록 조회 한 번을 요청했다. 새 목록 또는 구체적인 실패 안내를 기다리고 있다. 이번 설치가 아직 확인하지 못한 실제 모델 목록 실패 원인 자체를 해결했다고 주장하지 않는다.

마지막 설치 감사도 APPROVE다. 동결 소스 14/14, Native 승인 원본 31/31 및 전체 35파일, Native 복구본 35/35, 확장·stage·이전 백업 각 50/50, QA 25건과 결과 해시가 모두 일치했다. 실제 인증이 진행될 수 있는 현재 데이터·세션·브라우저는 감사에서 조회하지 않았다.

사용자의 새 실제 결과는 `ChatGPT 모델 목록 실패: OpenAI 모델 목록 응답이 허용된 크기를 초과해 처리하지 않았습니다.`였다. 이 고정 진단은 `OPENAI_MODELS_BODY_TOO_LARGE`에 해당하며 기존 256 KiB 읽기 상한에서 중단된 것이 확인됐다. 전체 응답 크기는 상한을 넘으면 reader를 취소하므로 아직 알 수 없다. 이 증거에 근거해 로컬 응답 한도를 8 MiB로 늘리는 최소 수리를 진행한다. 8 MiB는 새 로컬 자원 상한이며 실제 서버 응답 크기의 측정값이 아니다. 모델 수·식별자·표시 이름·wire 제한과 20초 제한, 토큰·endpoint·확인 경계는 유지한다.

크기 상한 수리를 완료해 Native에 설치했다. 운영 코드 변경은 `models-client.mjs`의 256 KiB → 8 MiB 한 줄이며, 이전 Native와 비교해 실제 배포 파일 35개 중 이 파일만 달라졌다. 256 KiB를 넘는 정상 메타데이터, 정확히 8 MiB인 분할 응답 허용, 8 MiB+1 응답 거부·reader 취소/해제를 회귀 검사했다. 모델 검사 23/23, Native·계약 통합 125/125, 독립 집중 검사 101/101 및 독립 검토 APPROVE를 받았다. 실패·skip·todo는 0이다. 확장 50개 파일은 앞서 검증한 설치본을 유지했다.

실제 updater DryRun·Apply와 설치 stdio 검사는 성공했다. 설치 직후 Native는 버전 0.8.0·프로토콜 8·유효한 hello·격리 프로세스의 미연결 상태·정상 종료를 확인했고, 설치 전후 로컬 데이터 16개 파일의 digest는 `30bbb4d6b243060d4a6e8de0fcf5441d7080f451295c7bed694b73da660ccfaa`로 동일했다. 복구본은 `.WtsNativeHost-rollback-20261019T081732Z-699f08476c9744ce874fa12ce0f5808b`와 보안 메타데이터에 보존했다. 독립 설치 감사에서 새 원본·설치 파일 일치, 복구본 35개, 단일 운영 파일 변경, 확장 50개 유지가 확인됐다. 증거는 `.omx/artifacts/wts-v8-models-size-installed-20261019.json`과 `wts-v8-models-size-native-contract-tests-20261019.log`에 있다.

이번에는 Native만 바뀌어 확장 새로고침 없이 기존 패널에서 로컬 실행기를 다시 연결할 수 있다. 실행기 교체로 메모리 인증 세션이 종료됐으므로 사용자에게 새 공식 인증, 모델 목록 조회·선택 및 짧은 인사를 요청했다. 크기 수정 이후의 실제 목록·대화와 확장 경유 WTS 제어·새 영수증은 아직 미검증이다. 8 MiB 안에 실제 응답이 들어오는지는 다음 실제 조회로 확인해야 한다.

## 실제 모델 선택 후 연결 종료 수리

8 MiB 수정본에서 사용자는 실제 Chrome 모델 목록이 나왔다고 확인했다. 따라서 목록 조회는 사용자 관찰로 통과했으며, 이어 사용자는 모델 하나를 선택하면 꺼진다고 보고했다. 실제 대화 응답은 아직 확인되지 않았다. Computer Use의 현재 공개 표면에는 WTS 탭이 있고 native 앱 제어는 0개이며, 확장 패널 내부 접근은 제한된다. 설치 경로로 좁힌 프로세스 메타데이터 검사에서 ATHENA Native 실행 프로세스는 0개였다. 명령줄 값·인증 정보·브라우저 프로필은 조회하지 않았다.

현재 Native는 소비가 완료된 모델 목록 terminal 요약도 public status에 남긴다. `modelSelect`가 선택 모델을 설정하고 그 요약을 포함한 status를 반환하면, 계약은 ‘models/succeeded 직후에는 선택 모델 없음’ 조건 위반으로 거부한다. Native handler의 검증 오류는 최상위 종료 경로로 전파될 수 있다. 별도 메모리 재현에서 설치 확장의 실제 validator/native-client도 이 응답을 거부하여 disconnect 1회·connected=false가 됐으며, 같은 응답의 operation이 null이면 연결을 유지했다. 실제 사용자 선택 시점의 원시 응답을 읽지는 않았으므로 사용자 실행의 직접 추적 증거와 코드 재현을 구별한다.

소비 완료 결과의 내부 기록은 보존하면서 현재 공개 상태에서만 제외하는 최소 수리를 진행한다. 실제 Coordinator·Native handler·계약을 함께 통과하는 로그인→모델 목록→결과 소비→모델 선택 회귀와 이후 대화 lifecycle을 검증한다. 계약을 느슨하게 하거나 인증·모델 사용권한을 변경하지 않는다.

수정 전 실제 Coordinator→Native handler→계약 통합 회귀에서 모델 선택 응답이 `INVALID_PROTOCOL_MESSAGE`로 거부되는 것을 재현했다. coordinator 검사 44개 중 신규 2개가 실패했고, 소비된 terminal을 공개 status에서 제외하는 운영 한 줄 수정 후 coordinator·계약 79/79가 통과했다. 내부 terminal은 유지해 반복 소비 및 같은 취소 ID의 멱등 응답을 보존한다. 추가로 선택 후 status, plan 시작·완료·소비, 소비 후 세션 만료를 검사했다. 독립 핵심 119/119, Windows 저장소 fixture 3/3 elevated 재검사, root 통합 157/157이 통과했고 독립 소스 검토 APPROVE를 받았다. 일반 sandbox에서의 기존 저장소 fixture 실패와 elevated 통과를 구분한다.

승인된 Native만 업데이트했다. DryRun·Apply 및 설치 stdio 검사가 통과했고 버전 0.8.0·프로토콜 8·유효한 hello·정상 종료를 확인했다. 이전 실행기는 `.WtsNativeHost-rollback-20261019T084828Z-1f3501025d5140f7a6db469071344ffb`와 보안 메타데이터에 남겼다. 확장 50개 파일은 변경하지 않았다. 이번 설치 전후 데이터 18개 파일의 digest는 `5a0d29a431d0039c2f37af4c3bdad32f9951c3033a7f69da89d10001d26bf4eb`로 동일했다. 앞선 16파일 시점 이후 실제 인증·목록 조회가 있었으므로 그 역사적 기준선과 혼동하지 않는다. 증거는 `.omx/artifacts/wts-v8-model-selection-repair-tests-20261019.json`과 `wts-v8-model-selection-installed-20261019.json`이다.

도구로 접근할 수 없는 확장 패널에서의 재연결·인증·선택·짧은 대화는 사용자에게 요청했다. 실제 수정본에서 모델 선택 유지와 대화 답변, WTS 제어 및 새로운 verified receipt는 아직 미검증이다.

설치 후 독립 감사도 APPROVE다. Native 현재·복구본 각 35파일 중 승인된 coordinator 1개만 달랐고, 원본·테스트·설치 해시와 전체 Native digest가 일치했다. 확장 50/50은 기존 models-repair manifest와 일치하고 복구본의 보안 메타데이터도 존재했다. 감사 과정에서 실제 인증·사용자 데이터·브라우저·프로세스는 조회하지 않았다.

## 공식 계약 근거

[OpenAI SIWC 등록·로그인](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)은 로컬 앱의 안정적인 host ID, 동적 등록과 루프백 인증 흐름을 정의한다. 기존 raw base64url host ID는 문서의 허용 형식과 달라, 이번 구현에서 `urn:uuid:` 형식으로 맞춘다. 기존에 묶인 등록을 임의로 변환하지 않는다.

[모델·추론 계약](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)에 따라 계정이 반환한 모델 목록에서 선택하고, 완료된 응답을 실제 추론의 성공 기준으로 사용한다. [UI 지침](https://developers.openai.com/siwc/ui-ux-guidelines)에 따른 연결 문구와 [사용량 관리](https://chatgpt.com/settings/usage) 링크를 제공한다.

이 기록은 실제 인수 결과가 생길 때 갱신한다. 전체 ATHENA 기능 이식, LAYA, 실제 금융 조회 또는 공개 배포의 완료 증거로 확대하지 않는다.
