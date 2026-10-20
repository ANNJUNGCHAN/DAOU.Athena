# ATHENA의 ChatGPT / Claude Desktop 연결 방향

기준일: 2026-10-19. 상태: 사용자가 **Chrome의 ATHENA 대화창 유지와 ChatGPT 공식 연결 우선**, **오픈소스로 공개 배포할 예정**임을 확인했다. 로컬 Responses 처리 모듈과 명령 제안 검증은 소스 단계의 독립 검토를 통과했다. 실제 로그인, 모델 추론과 Chrome 연결은 아직 구현·활성화하지 않았다.

사용자는 별도 로컬 LLM보다 ChatGPT나 Claude Desktop을 이용하기를 원한다. 기존 요구는 모든 제품 UI를 Chrome에 두고 실행과 저장은 사용자 PC에서 처리하는 것이다. 두 요구를 함께 만족하는 우선 검토안은 **Chrome의 ATHENA 대화창을 유지하고 ChatGPT 공식 계정 연결을 로컬 실행기에 붙이는 것**이다. Claude Desktop 자체를 이용하는 경우에는 **Desktop에서 대화하고 ATHENA를 로컬 MCP 도구로 호출하는 별도 구조**가 된다.

## 선택에 따른 차이

| 항목 | Chrome 대화창 + ChatGPT 공식 연결 | Claude Desktop 대화 + 로컬 MCP |
| --- | --- | --- |
| 사용자가 대화하는 곳 | Chrome의 ATHENA 패널 | Claude Desktop |
| 모델 연결 | 사용자 승인 OAuth와 로컬 실행기의 Responses API 연결 | Claude Desktop이 자신의 모델을 사용 |
| ATHENA가 받는 것 | 대화 응답과 검증할 명령 제안 | Desktop이 호출한 ATHENA 도구 요청 |
| WTS 실행·조회·저장 | 로컬 실행기와 Chrome 확장 | 로컬 실행기와 Chrome 확장 |
| 기존 Chrome UI 요구 | 유지 | 대화 UI 위치 변경 필요 |
| 현재 확인할 조건 | 앱 등록, 실제 자격·라이선스, OAuth 설정, 완료된 추론 검증 | Desktop MCP 설치·연결, 로컬 요청 통로, 실제 도구 호출 검증 |

이 문서는 Desktop 앱의 기존 대화나 모델 프로세스를 가져오는 기능을 약속하지 않는다. MCP는 모델을 빌려주는 API가 아니라 모델이 ATHENA의 도구를 호출하는 연결 방식이다.

## 공식 문서로 확인한 범위

OpenAI는 로컬·오픈소스 앱이 사용자 승인을 받아 ChatGPT 플랜을 사용하는 연결을 문서화하고 있다. 앱의 OAuth 액세스 토큰으로 Codex app-server를 실행하고 표준 입력·출력으로 대화를 전달할 수 있다. 모델 목록이 보이는 것만으로 사용 권한을 입증하지 못하며, 실제 추론 턴이 `completed`로 끝나야 해당 요청의 성공을 확인할 수 있다. [ChatGPT 플랜 연결 개요](https://developers.openai.com/siwc/token-sharing-open-source), [Codex app-server 연결](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server)

추가 확인 결과, Codex 실행기를 거치지 않고 로컬 실행기가 공식 Responses API를 직접 호출하는 방식도 지원된다. 이번 용도는 대화와 제한된 명령 제안이므로 **직접 Responses 연결을 우선 구현한다.** 별도 코딩 에이전트나 셸 도구를 실행하지 않아도 된다. 요청은 `store:false`, `stream:true`를 사용하고, 완료 이벤트와 결과 형식 검증을 모두 통과한 응답만 채택한다. [공식 모델 호출 방식](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference), [지원 범위와 제한](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)

단, **공개 Git 저장소라는 사실만으로 오픈소스 자격을 확정하지 않는다.** 현재 공식 안내에서는 개발 중인 오픈소스 로컬 앱이 동적 등록을 시도하기 전에 저장소 공개, OSI 라이선스 또는 별도 앱 심사를 완료해야 한다는 명시적 조건을 찾지 못했다. 루트 라이선스 파일의 부재나 `app/package.json`의 `license: ISC`, `private: true`만으로 연결 자격의 충족·미충족을 판정하지 않는다. 사용자가 승인한 실제 로그인과 반환 권한으로 해당 연결의 이용 가능 여부를 확인한다. 기존 Desktop의 인증 파일을 복사하지 않으며 이 연결은 기존 ChatGPT 대화 접근 권한을 주지 않는다. [등록·이용 안내](https://developers.openai.com/siwc/quickstart), [공식 동적 등록 절차](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), [연결 범위](https://developers.openai.com/siwc/token-sharing-open-source)

사용자의 공개 배포 계획은 확인했으며, 라이선스 파일을 임의로 추가하거나 배포 자격이 이미 확정됐다고 처리하지 않는다. 해당 조건을 충족하는 로컬 앱의 공식 동적 등록 흐름은 별도 클라이언트 비밀키를 요구하지 않는다. ATHENA가 직접 로그인 상태를 관리하고 사용자가 시스템 브라우저에서 계정·워크스페이스·플랜 사용을 승인하는 구조를 구현 대상으로 삼는다. 실제 로그인 실행 전에는 등록 조건과 반환된 권한을 확인한다. [공식 등록과 로그인 흐름](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)

Claude Desktop은 Windows에서 로컬 MCP 서버를 실행하고 도구를 호출할 수 있다. 공식 문서에서 ATHENA Chrome 확장이 Claude Desktop의 대화·모델을 호출하는 역방향 추론 API는 확인하지 못했다. 따라서 Desktop 연동은 사용자가 Desktop에서 대화하는 MCP 방식으로 설계한다. [Claude Desktop 로컬 MCP](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop), [Desktop·웹 연결 방식 비교](https://support.claude.com/en/articles/11725091-when-to-use-desktop-and-web-connectors)

Chrome의 ATHENA 대화창 안에서 Claude를 직접 모델로 사용하려면 제품용 Console API 또는 지원 클라우드 인증 경로를 검토해야 한다. 기존 Claude CLI 코드나 `claude -p`의 존재만으로 Desktop/Pro/Max 구독을 ATHENA 제품의 모델 서비스로 사용할 수 있다고 판단하지 않는다. 현재 공식 개발자 안내는 별도 앱·제품의 인증과 일반 Claude 앱 사용을 구분한다. [Claude 인증·자격 증명 안내](https://code.claude.com/docs/en/legal-and-compliance#authentication-and-credential-use), [계정 로그인과 외부 도구 안내](https://support.claude.com/en/articles/13189465-log-in-to-your-claude-account)

## 저장 위치와 전송 범위

- WTS 실행, 조회, 파일 저장과 결과 검증은 사용자 PC에서 처리한다.
- ChatGPT 또는 Claude가 분석할 대화와 선택된 화면 정보는 해당 서비스로 전송된다. 로컬 저장은 로컬 추론과 같은 뜻이 아니다.
- 로그인 토큰, 키움 인증 정보, 계좌 식별값을 모델 입력에 포함하지 않는다. 화면 전체 HTML이나 브라우저 프로필도 모델 문맥으로 보내지 않는다.
- 모델은 허용된 명령을 제안하고 로컬 실행기가 현재 화면·권한·명령 형식을 검증한다. 기존 클릭 중복 방지와 실행 영수증 검증을 유지한다.
- 실제 계좌 주문과 자동 매매는 제품 범위에 포함하지 않는다. 모의 주문은 기존 제품 계약에 따라 건별 확인이 필요하며 이번 모델 연결 범위에서 활성화하지 않는다.

## 재사용할 코드와 구현 순서

현재 Electron에는 `app/lib/main/codex-chat-runtime.js`, `codex-chat-session.js`와 Claude CLI 세션 코드가 있다. WTS의 `local-runtime/src/control-planner.mjs`는 고정된 명령을 해석하는 구현이며 이 제공자 세션과 아직 연결되지 않았다. 기존 코드는 재사용 후보이며 새 Chrome 연결의 성공 증거는 아니다.

기존 Codex 코드는 대화 생명주기 검토에 참고하되, 첫 구현에서는 Electron 코드나 Codex 프로세스를 가져오지 않는다. 로컬 Responses 클라이언트와 기존 WTS 명령 검증기를 연결하는 작은 모듈부터 검증한다.

첫 소스 범위인 Responses 클라이언트·명령 제안 검증기·planning client와 테스트 6개 파일은 독립 코드 검토를 통과했다. 최종 테스트 결과는 대상 31개, 로컬 실행기 전체 191개, 기존 Native 계약 30개 통과이며 대상 테스트는 전체 실행기 테스트에 포함된다. 실제 네트워크나 인증을 사용하지 않은 검증이다. 상세 범위와 한계는 [ChatGPT 제공자 소스 검증 기록](chatgpt-provider-v8-source-validation-20261019.md)에 정리했다.

1. 사용자 선택에 따라 Chrome의 ATHENA 대화창을 유지한다. ChatGPT 공식 연결의 인증 방식·자격·등록 조건을 먼저 확인한다. Claude Desktop MCP는 선택되지 않은 대안으로 남긴다.
2. 브라우저와 독립된 로컬 제공자 어댑터에 로그인 상태, 스트리밍 응답, 취소, 오류를 통합한다. 인증은 제공자의 공식 흐름을 사용하며 다른 앱의 쿠키·저장 토큰을 추출하지 않는다.
3. 초기 모델 입력은 사용자가 입력한 문장과 검증된 제어 목록으로 제한한다. 계좌 데이터 없이 문장 해석과 차트 명령 제안부터 검증한다.
4. 모델의 출력은 허용된 구조화 명령으로 검증한다. 임의 JavaScript·셀렉터·셸 실행을 WTS 명령으로 허용하지 않는다. 실제 화면 상태와 실행 후 영수증을 확인한다.
5. 연결 해제, 취소, 지연, 중복 응답, 잘못된 명령, 모델 사용 불가를 검증한 뒤 실제 사용자 Chrome에서 대화→제안→실행→결과 표시를 확인한다.

별도 Qwen/llama.cpp 다운로드·설치 요청은 이 방향 선택에 따라 보류한다. 설치를 승인받았거나 다운로드한 것으로 처리하지 않는다. LAYA 학습과 전체 WTS 제어가 완료됐다는 뜻도 아니다.

## 이번에 확인한 0.7 상태

사용자가 Chrome의 ATHENA 버전 0.7.0, 로컬 실행기 연결 및 화면 조사 성공을 확인했다. 2026-10-19 08:02:39 KST에 새 조사 파일 1개가 저장됐고 현재 소스 및 설치본의 protocol 7 계약 검증을 통과했다. 관찰 1개, 제목 요소 1개, 제어 요소 13개이며 프레임·캔버스는 0개다. 전체 WTS 화면 분석이 완료됐다는 증거는 아니다.

저장된 조사에는 확장 버전 필드가 없으므로 0.7.0 버전은 사용자 확인과 설치본 검증에 근거한다. 기존 파일 10개의 해시는 그대로였고 현재 저장소는 조사 7개·기존 실행 영수증 4개다. 새 명령 실행, 실제 금융 조회, 모델 추론 성공은 이번 조사로 입증하지 않았다.

설치된 0.7의 외부 AI 연결은 여전히 비활성이다. 이 문서는 새 선호를 반영한 연결 방향이며 설치 완료 보고가 아니다.
