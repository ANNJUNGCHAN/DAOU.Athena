# WTS ChatGPT 제공자 v8 Slice 1 source 검증 기록

기준일: 2026-10-19

판정: **Slice 1 source 구현·최종 검증과 독립 코드 리뷰를 통과했다.** 리뷰에서 확인한 direct tool SSE event와 assistant lifecycle 검증 결함을 보수했고, 독립 재검토는 남은 지적 0건으로 승인했다. 이번 범위는 공식 ChatGPT Responses API를 호출할 로컬 제공자 경계 3개 모듈과 그 테스트 3개뿐이다. 설치된 ATHENA 0.7, 사용자 Chrome, 인증 또는 실제 OpenAI 추론에는 연결하지 않았다.

## 선택한 연결 방향

사용자는 대화 UI를 Chrome의 ATHENA 패널에 유지하고 공식 ChatGPT 연결을 먼저 구현하기로 했다. Claude Desktop MCP는 선택되지 않은 대안으로 남아 있다. 사용자가 입력한 대화 문장은 향후 OpenAI로 전송하고, WTS 실행과 저장은 사용자 PC의 기존 로컬 경계에서 처리한다.

이 구현은 Codex나 별도 CLI 프로세스를 요구하지 않는다. 로컬 실행기가 공식 `https://api.openai.com/v1/responses` 엔드포인트에 직접 요청하는 구조다. 요청은 `store: false`, `stream: true`, 엄격한 JSON Schema 형식을 사용한다. 완료된 응답의 단일 assistant `output_text`만 채택한다.

사용자는 공개 배포를 계획하고 있으나, 이 문서는 저장소 라이선스나 OpenAI 이용 자격이 확정됐다고 판단하지 않는다. 앱 등록 조건, 계정·모델 이용 가능 여부와 schema 호환성은 실제 공식 인증과 완료된 live inference로 별도 확인해야 한다. 근거가 되는 선택과 제한은 [ATHENA의 ChatGPT / Claude Desktop 연결 방향](desktop-llm-integration-decision-20261019.md)에 기록돼 있다.

## Slice 1 구현 범위

| 모듈 | 구현된 경계 | source에서 제외한 것 |
|---|---|---|
| [`responses-client.mjs`](../../../local-runtime/src/chatgpt-provider/responses-client.mjs) | 고정 Responses URL, Bearer 토큰 함수, 허용된 요청 필드, SSE 완료 응답 검증, 단일 실행, 제한 시간과 취소를 제공한다. | OAuth, 토큰 저장, 재시도, fallback, tool 호출, 임의 endpoint·header |
| [`control-candidate.mjs`](../../../local-runtime/src/chatgpt-provider/control-candidate.mjs) | 정확한 `{assistantText, proposal}` JSON만 받고, proposal을 `null` 또는 `{kind: "wts-control", text}`로 제한한다. 기존 명령 정규화·컴파일러와 전달된 catalog를 다시 검증하고 결과를 freeze한다. | 모델 출력의 직접 실행, 임의 JavaScript·selector·URL·shell·주문 명령 |
| [`planning-client.mjs`](../../../local-runtime/src/chatgpt-provider/planning-client.mjs) | 사용자 문장, 고정 instructions와 제한된 command catalog만 Responses client에 전달한다. 엄격한 schema를 만들고, 민감 입력 사전 차단과 취소·동시 실행 제한을 적용한다. | 화면 관찰, HTML, 계좌·금융 데이터, 실행 영수증, Chrome 메시지, Native Messaging method |

공개 API는 `ResponsesClient(...).complete(...)`, `ResponsesClient.cancel()`, `PlanningClient(...).plan(text)`, `PlanningClient.cancel()`로 제한된다. 토큰 공급 함수는 abort signal을 받지만, 이번 source에는 토큰을 발급하거나 보존하는 인증 구현이 없다.

## 검증된 실패 폐쇄 경계

- Responses 요청은 고정 URL에 `POST`하며 redirect를 거부한다. body는 model, instructions, 사용자 입력 배열, `store: false`, `stream: true`, strict JSON Schema로 제한된다.
- SSE는 event 256 KiB, 전체 1 MiB, 완료 텍스트 8 KiB 한도를 적용한다. UTF-8 오류, response ID 변경, 중복 완료, 실패·미완료·refusal, direct tool event, 여러 assistant message와 예상하지 않은 output을 거부한다. 허용된 reasoning lifecycle과 단일 assistant item·text lifecycle의 event type·header·identity를 완료 응답까지 교차 확인한다.
- 요청은 한 번에 하나만 허용하고 최대 60초 안에 토큰 획득과 응답 처리를 끝낸다. 취소 후 늦게 도착한 결과를 게시하지 않으며 자동 재시도하지 않는다.
- command catalog는 최대 100개·직렬화 8 KiB로 제한한다. 사용자 입력은 512 Unicode scalar·2 KiB, 제안 문장은 512 scalar·2 KiB, 표시 문장은 4,096 scalar·8 KiB를 넘길 수 없다.
- 입력에서 비밀번호·인증번호·계좌번호·토큰·API key 표기와 7자리 이상 숫자열을 발견하면 전송 전에 거부한다. 6자리 종목 코드는 이 단순 규칙에서 허용한다. 이 규칙은 완전한 비밀 탐지기가 아니므로 향후 전송 범위를 넓히는 근거로 사용하지 않는다.
- 모델 결과는 표시 문장과 실행 전 제안일 뿐이다. 실제 WTS 동작은 기존 command compiler, 현재 화면 조건, 사용자 흐름과 실행 영수증 경계를 그대로 거쳐야 한다.

## source 검증 증거

| 검증 | 현재 결과 | 이 결과가 증명하지 않는 것 |
|---|---|---|
| Slice 1 targeted tests | 최종 31/31 통과. direct tool event, 두 assistant lifecycle, 멈춘 fetch·read의 deadline과 reader cleanup 회귀를 포함한다. | live OpenAI, Chrome 연동 |
| local runtime full suite | 최종 191/191 통과 | 설치본 갱신, 실제 인증·추론 |
| Native contract suite | 최종 30/30 통과 | 새 공개 Native method 또는 host 통합 |
| 정적 점검 | 새 module 3개와 test 3개의 Node syntax, scoped diff, TODO·skip·only 부재와 외부 import 부재를 확인했다. LSP와 ast-grep은 사용할 수 없어 Node·정적 검사와 bounded probe로 대체했다. | 실행 환경의 계정·네트워크 호환성 |
| 독립 코드 리뷰 | 첫 리뷰의 두 검증 결함을 보수한 뒤 최종 재검토 승인, 남은 지적 0건 | 인증·설치·live inference 승인 |

최종 실행에서는 failure, skipped, cancelled, TODO가 없었다. targeted 31건은 full runtime 191건과 별도 검증이며 두 수를 합쳐 전체 suite 수로 표시하지 않는다. contract 30건도 별도 suite다. 모든 검증은 mock·offline 조건에서 실행했으며 실제 OpenAI 계정이나 네트워크를 사용하지 않았다.

검증·독립 리뷰가 고정한 source SHA-256은 다음과 같다.

| 파일 | SHA-256 |
|---|---|
| `responses-client.mjs` | `C2C1ED28DFFF58E101704606D0556B8F192694F2CAE7127C84925D950D01D3EC` |
| `control-candidate.mjs` | `B8A38DD551D7A36BD3A380661C07515235C6A3033F8BB3B957BA126B3E988380` |
| `planning-client.mjs` | `CEA148F28F881A773CF5DF2DEC76C58F3ECCF1B494582E967B16308BF7609E12` |
| `chatgpt-responses-client.test.mjs` | `544C426CF8E1CA91B1EFCE21A90B216E3F7894402A2247FFA39A2CACA1A98302` |
| `chatgpt-control-candidate.test.mjs` | `3990E3CD7A4D19479D25F504A208A72E2D4716CBA948DE30F166C47ABD0C6CBC` |
| `chatgpt-planning-client.test.mjs` | `9050C7319E6416E345392EA7E836F88E89A30E213A1DFA694EEB46AA98D22DB9` |

구현 기준은 로컬 작업 기록 `.omx/plans/wts-chatgpt-provider-v8-20261019.md`다. 이 운영 artifact는 공개 문서의 전제 자료가 아니며, 이 보고서가 현재 source 범위와 증거를 독립적으로 설명한다. 계획 승인은 Slice 1에만 적용됐다.

## 설치·사용자 환경 경계

- 설치된 extension과 host는 계속 0.7.0 / protocol 7이다. Slice 1 모듈은 host entrypoint에서 import하지 않으며 설치본에 포함하지 않았다.
- 기존 데이터는 11개 파일, 즉 화면 조사 7개와 과거 실행 영수증 4개인 상태로 유지됐다. Slice 1은 화면 조사, action receipt 또는 금융 조회 기록을 만들지 않았다.
- 사용자가 확인한 Chrome 0.7 연결·화면 조사 성공은 기존 설치 검증이다. ChatGPT 연결, 로그인, 대화 전송 또는 명령 제안이 Chrome에서 동작했다는 증거가 아니다.
- 실제 access token, refresh token, 계정 식별 정보, Kiwoom 자격증명과 계좌 데이터는 사용하지 않았다. live inference와 실제 Responses 응답도 실행하지 않았다.

## 다음 인증 단계의 제한

첫 live 인증 단계는 access token과 refresh token을 owned Native process의 RAM에만 보관하는 방향이다. process 종료·연결 해제 뒤에는 다시 로그인해야 한다. JavaScript 참조를 버리는 동작을 보안상 확실한 메모리 zeroization으로 표현하지 않는다.

디스크에는 소유자만 접근할 수 있는 private registration metadata만 저장할 계획이다. 대상은 정확한 metadata version, opaque host ID, 발급된 client ID와 검증된 계정 binding hash다. 이메일, 이름, 원본 identity claim 또는 token은 저장하지 않는다. 다른 계정 binding이 감지되면 기존 값을 덮어쓰거나 활성화하지 않고 명시적 reset을 요구한다.

이 방향은 로컬 작업 기록 `.omx/plans/wts-chatgpt-v8-session-auth-amendment-20261019.md`에 한정해 검토됐다. 이 운영 artifact는 공개 배포 문서에 포함된다고 가정하지 않는다. 정확한 OAuth endpoint, callback listener, state·PKCE, JWKS·claim 검증, refresh·revocation, registration store 계약은 아직 별도 검토 중이다. 인증 source도 작성하지 않았다.

## 남은 검증 게이트

1. 별도 검토 중인 인증 계약을 확정한 뒤 구현·검증한다. 시스템 브라우저의 사용자 동의, 공식 앱 등록과 실제 계정 이용 자격은 그 단계에서 확인한다.
2. 실제 계정으로 최소 한 번의 Responses 요청이 `completed`로 끝나고 strict schema 결과가 검증되는지 확인한다. 이 과정 전에는 공식 연결 성공을 주장하지 않는다.
3. 제공자 경계를 Native Messaging과 Chrome UI에 연결한 뒤 대화 입력→제안→사용자 확인→기존 실행·영수증 흐름을 검증한다.

따라서 현재 증거는 **설치되지 않은 source-only Slice 1의 구현·검증·독립 리뷰 통과**까지다. 전체 WTS 분석·제어, LAYA 학습, ChatGPT 인증·추론, Chrome 통합 또는 오픈소스 배포 준비가 완료됐다는 뜻이 아니다.
