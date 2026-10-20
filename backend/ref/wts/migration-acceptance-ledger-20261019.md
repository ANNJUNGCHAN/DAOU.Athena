# ATHENA → Chrome 이식 인수 대장

기준일: 2026-10-19

범위: WTS 대화 제어와 ATHENA 상세 기능 23개의 Chrome UI·로컬 실행 이식

이 문서는 승인된 Chrome UI와 로컬 AI 전면 제어 목표의 완료 판정표다. 기존 기능 이식 대장은 Electron/FastAPI 코드와 제안 계약의 위치를 추적하며, 이 문서는 설치된 제품에서 실제로 확인해야 할 증거를 추적한다.

## 판정 규칙

- `부분`: 설치된 현재 버전에서 기능의 일부 정상 경로를 실제 Chrome으로 실행하고 관찰 가능한 후조건과 영수증을 확인했다. 그 기능 전체가 완료됐다는 뜻은 아니다.
- `미완료`: 소스 위치, 제안 계약, 단위 테스트, 일반 브라우저 제어 또는 UI 초안만 있거나, 설치본의 실제 실행·렌더링·실패 복구 증거가 부족하다.
- `완료`: Chrome에서 렌더링된 사용자 흐름, 사용자 PC의 로컬 계산, 실제 데이터·도구 연결, 후조건, 실패·취소·복구, 설치본 회귀 검증을 모두 확인한 경우에만 사용한다.

소스 테스트와 오프라인 감사는 회귀 증거다. 설치된 확장과 로컬 실행기의 실제 제품 동작을 대신하지 않는다. 일반 브라우저 자동화로 WTS를 직접 조작한 결과도 선택자와 후조건 설계 근거일 뿐 ATHENA 확장 기능의 실행 증거가 아니다. 화면, 카드 또는 버튼만 존재하고 실제 작업이 이어지지 않으면 완료로 판정하지 않는다.

## 고정 제품 경계

| 항목 | 인수 조건 |
|---|---|
| UI | 대화 패널, 오브, 설정, 그래프, 전략, 작업·알림 이력과 모든 확인 화면은 Chrome에서 동작한다. Electron 창을 제품 UI로 요구하지 않는다. |
| 실행 위치 | 대화·계획, LAYA, selector, 그래프, 문서 처리, 백테스트, 루틴, 도구와 저장은 사용자 PC에서 실행한다. |
| 원격 AI | 대화나 화면 캡처를 원격 AI로 보내는 fallback이 없다. 필요한 WTS·금융 데이터 서비스 통신은 허용하되 모델 추론을 원격으로 우회하지 않는다. |
| WTS 실행 | Chrome은 등록된 `action_id`와 검증된 인자만 적용하고, 관찰 revision·권한·위험 등급·후조건·receipt를 검사한다. 모델이 만든 CSS·JavaScript·셸 문자열을 실행하지 않는다. |
| 계좌 범위 | 실계좌 조회는 허용한다. 모의투자 주문은 확장-origin 주문표마다 사용자가 개별 확인하고 로컬 실행기가 계좌·환경·payload·만료·일회성을 다시 검사할 때만 허용한다. |
| 제외 범위 | 실계좌 주문, 자동매매, 비밀번호·OTP 자동 입력, 보안 경고 우회는 실행 후보에 등록하지 않는다. 제외 동작을 성공 수나 미완료 기능 수에 넣지 않는다. |
| 개인정보 | 원본 인증값·계좌값·쿠키·전체 HTML을 학습 자료나 공개 기록에 넣지 않는다. 근거에 필요한 최소 구조와 비식별 실행 기록만 보존한다. |

## 현재 확인된 기반

| 주장 | 현재 증거 | 판정 한계 |
|---|---|---|
| Chrome ↔ 로컬 연결 | 확장·로컬 실행기 파일은 `0.7.0` / 프로토콜 7로 설치됐다. 설치된 실제 host의 stdio `runtime.hello`가 runtime 0.7.0, 금융 capability, stderr 0, exit 0을 확인했다. 사용자는 Chrome에서 `0.7.0이고 연결·화면 조사 성공`이라고 확인했고 새 로컬 캡처도 독립 검증됐다. | 캡처에는 확장 버전 필드가 없어 0.7.0은 사용자 확인에 근거한다. metadata 검색과 금융 UI·query는 아직 확인하지 않았다. |
| WTS 화면 조사 | 설치 직후 독립 검사는 당시 로컬 data 10개의 digest 불변, 유효한 32/64-bit Registry, owned process 0개를 확인했다. 이후 2026-10-19 08:02:39 KST의 새 캡처 1개가 추가돼 파일 수가 11개가 됐다. 새 캡처는 관측 1개·heading 1개·control 13개·child frame 0개·canvas 0개·비절단 상태다. 현재 source와 설치본의 프로토콜 7 schema는 동일하고 `inventory.record` 검증을 통과했으며 기존 10개 baseline hash도 모두 불변이다. | 이 한 캡처는 전체 WTS 화면·상태·동작의 고정 분모나 control action·금융 query 증거가 아니다. |
| 확장 화면 제어 | 사용자 확인 기준 Chrome 0.7 연결·화면 조사가 성공했다. 검증된 action 영수증은 계속 0.2 파일럿 4건으로, `종목시세 → 차트`, `일봉 → 주봉` 2건, `주봉 → 일봉` 1건의 정상 경로를 증명한다. | 0.7의 차트·시장 메뉴·metadata·금융 action과 실패·복구는 미검증이다. 화면 조사를 action 실행 증거로 세지 않는다. |
| 0.4.0 소스 회귀 기준선 | 역사적 0.3 기준선은 계약 13, 확장 104, 로컬 실행기 65로 182/182 통과했다. source 0.4.0은 계약 17, runtime 100, 확장 142로 259/259 통과했고 실패·취소·skip·todo는 0이다. backend 27, Node helper 28, runtime targeted 40, service worker targeted 33, panel targeted 31의 범위별 검증과 모든 독립 검토도 통과했다. 임시 staging의 확장 23개 파일도 build·정적 검사를 통과했다. | targeted 수치는 259개의 부분집합이다. 이 결과는 당시 source bundle·격리 build 증거다. 현재 설치된 0.7에서도 Chrome metadata UI가 아직 확인되지 않았으므로 실제 제품 완료로 집계하지 않는다. |
| 차트 기간 source 0.4.1 | 프로토콜 4의 catalog 2·compiler 2가 일·주·월·년을 엄격히 결합한다. 계약 19, runtime 105, 확장 161로 285/285 통과했고 실패·취소·skip·todo는 0이다. 다섯 독립 검토, 실제 metadata cross-layer smoke와 23파일 격리 build·정적 검사도 통과했다. | 현재 Chrome 0.7 연결·화면 조사는 사용자 확인됐지만 최신 action 영수증은 0.2다. source bundle·staging·설치를 실제 월봉·년봉 실행으로 세지 않는다. [0.4.1 검증 기록](chart-period-v2-validation-20261019.md) 참조. |
| 통합 대화 source 0.5 | 프로토콜 5의 local deterministic router가 기존 차트 전체 문장과 정확한 `조회 기능 찾아줘: 검색어` 두 route만 분류한다. 계약 20, runtime 109, 확장 198의 **327/327**, 실제 read-only Python까지 잇는 cross-layer smoke, 24파일 격리 build·정적 검사, 모든 독립 검토와 최종 보안·보존 검사를 통과했다. | 설치·live Chrome, 생성형 대화, 금융 query, LAYA 또는 주문 증거로 세지 않는다. [0.5 검증 기록](unified-conversation-source-v5-validation-20261019.md) 참조. |
| 시장 메뉴 source 0.6 | 프로토콜 6의 catalog `wts-main-control-3`와 compiler 3이 정확한 `시장 메뉴 열어줘: 그룹 > 메뉴`를 기록된 25개 목적지로 제한한다. 각 명령은 사이트맵 열기와 P1 대상 선택의 두 단계이며, 단계마다 새 관찰·한 번의 클릭·후조건·영수증을 요구한다. 전체 JavaScript 검증, 실제 로컬 metadata smoke, installer DryRun과 25파일 격리 build·정적 검사를 통과했다. | 현재 Chrome 0.7 연결·화면 조사는 사용자 확인됐지만 최신 action 영수증은 0.2다. 25개 직접 탐색은 설계 근거이며 확장 영수증이 아니다. source 검증과 설치를 실제 메뉴 실행, 전체 WTS 제어 또는 기능 완료로 세지 않는다. [0.6 검증 기록](market-navigation-source-v6-validation-20261019.md) 참조. |
| 금융 조회 source 0.7 | 프로토콜 7이 별도 financial child, CurrentUser DPAPI profile, 고정 8개 Native method, 264개 read-only operation과 697개 정본 form field, facts/table/compound/chart renderer를 추가한다. 계약 30, 독립 검토된 Native recovery 39와 vault 33, 최종 runtime aggregate 160/160, financial aggregate 108/108이 통과했다. 초기 summary-only runtime 실패 원인은 확인되지 않았으며 이후 157건 full run 두 번과 최종 160건 run이 통과했다. extension freeze는 281/281과 `npm check`, 독립 최종 검토를 통과했다. 최신 backend 세 보수도 targeted 51건, Ruff·AST·diff와 독립 재검토를 zero finding으로 통과했다. package readiness, 설치, 독립 post-install 보존 검사와 installed Native hello도 통과했다. 사용자는 Chrome 0.7 연결·화면 조사 성공을 확인했고 새 로컬 캡처는 schema·baseline hash 독립 검사를 통과했다. | metadata 검색, 자격증명, 금융 UI·Kiwoom live read가 남았다. LAYA·주문 증거로 세지 않는다. [0.7 검증 기록](financial-read-v7-validation-20261019.md) 참조. |
| catalog별 증거 감사 | 새 auditor가 기존 캡처 6건과 verified receipt 4건을 오류 없이 읽어 `legacyComplete=true`, `currentComplete=false`를 보고했다. 기존 10개 기록은 변경되지 않았고 설치된 task는 0건이다. | pass는 legacy 기록 무결성과 저장된 세 후조건만 뜻한다. `currentCatalogCoverage`의 역사적 catalog 2 차트 다섯 항목, 0.4.1 실행, 실제 Chrome failure guard나 학습 자료 승인을 증명하지 않는다. |
| source metadata v4 | 실제 backend → Node bridge → wire 4 → 정본 card validator smoke가 operation 264개, 검색 결과 1개, 상세 필드 7개를 확인했고 종료 뒤 owned child가 남지 않았다. | 현재 Chrome 0.7 연결·화면 조사는 사용자 확인됐지만 metadata 검색과 목록·상세 카드는 미확인이다. 금융 조회, AI·모델·LAYA 기능도 증명하지 않는다. [v4 소스 검증](source-metadata-v4-validation-20261019.md) 참조. |
| 더 넓은 WTS 조작 | 일반 HTTPS 브라우저 제어로 월·년 주기, 차트 설정, 뉴스·시세·빅데이터, 검색 팝업과 별도 차트 창의 일부 선택자·후조건을 확인했다. | [직접 브라우저 제어 기록](direct-control-validation-20261018.md)은 새 확장 action, 영수증, LAYA 정답 또는 제품 기능 완료 증거가 아니다. |
| 로컬 AI·LAYA | 제한된 합성 입력의 CPU probe에서 4B 후보 6/6은 57.932–96.126초, 1.7B 후보 1/1은 21.749초로 끝났다. | 소수 합성 사례의 실행 가능성 자료일 뿐 M-1 적합성·품질·재배포·자원 기준을 충족하지 않는다. 모델을 제품 후보로 승격하지 않았고 WTS용 LAYA 학습도 시작하지 않았다. |

현재 전체 판정은 **화면 호출 1개 기능의 좁은 일부만 `부분`, 나머지 22개 기능은 `미완료`**다. 23개 중 완료된 기능은 0개다.

## 전역 인수 게이트

| 게이트 | 현재 주장 | 완료에 필요한 증거 |
|---|---|---|
| M-1 로컬 계획기 적합성 | 미완료 — 4B 6건과 1.7B 1건의 제한된 CPU 합성 probe만 통과 | 재배포 가능한 로컬 모델/runtime 후보를 대상 CPU/GPU에서 외부 AI endpoint를 차단한 채 비교한다. 한국어 복합 목표 분해, 수정 대화, schema action 제안, 도구 결과 처리, context 한도, 취소, p50/p95 지연, RAM/VRAM을 기록하고 선정 모델과 지원 한계를 확정한다. |
| L0 로컬 실행 경계 | 부분 — 0.7 파일 설치, 독립 post-install 보존 검사와 실제 host stdio 프로토콜 7 왕복이 통과했다. 사용자는 Chrome 0.7 연결·화면 조사 성공을 확인했고 새 로컬 캡처는 schema·baseline hash 독립 검사를 통과했다. | 실제 Chrome에서 routing, metadata, 월봉·년봉, 25개 시장 메뉴, 금융 readiness/forms/cards, source/chart/query 상호 배제, 취소·연결 해제·reconnect·legacy recovery를 검증한다. 제품 UI가 Chrome에만 있고 계산·도구·저장이 로컬이며 원격 fallback이 없음을 실제 turn으로 확인한다. |
| W0 전체 조사 | 부분 | 메뉴·사이트맵·검색·팝업·새 창을 대조해 버전이 있는 화면/상태/action 분모를 고정한다. 인증 때문에 접근하지 못한 상태와 `unknown/blocked/unsupported`도 남긴다. |
| W1 대표 실행기 | 부분 | DOM, cross-origin iframe, canvas/시각 입력, 별도 tab/window의 각 제어 유형에서 등록 action을 실제 확장으로 실행하고 후조건·receipt를 확인하거나 명시적인 `unsupported` 판정을 남긴다. |
| D0 학습 자료·평가 기반 | 미완료 | `지시 + 목표 + observation_t + 후보 + 검수된 action/인자 + receipt + observation_t+1 + 종료/복구 label` episode를 비식별로 검수한다. 화면 상태·날짜·발화 계열 누수를 막은 고정 test와 offline replay 기준 성능을 만든다. |
| M0 LAYA 재학습 | 미완료 | WTS task/context/candidate catalog와 checkpoint를 만들고 후보 recall, 선택, 인자, defer, 전체 목표 성공률을 분리 평가한다. 기존 LAYA와 규칙 baseline 대비 개선, 기존 task 회귀, calibration/threshold를 통과한다. |
| W2 WTS 전 범위 | 미완료 | 고정 inventory의 모든 허용 동작에 관찰·실행·대화·후조건·회귀 증거가 있거나 명시적 미지원 판정이 있어야 한다. 미분류 동작과 근거 없는 성공 항목이 0이어야 한다. |
| A0 ATHENA 23개 기능 | 미완료 | 아래 23개 행이 각각 설치본의 Chrome UI와 로컬 실행으로 실제 동작하고, WTS context와 같은 작업 세션에서 이어지며, 실패·취소·복구까지 검증돼야 한다. |
| G0 실사용 guard | 미완료 | 팝업, stale observation/document, 모호한 지시, 종목·탭 변경, 취소, Native 연결 상실, 실행기 재시작, 후조건 시간 초과, 영수증 저장 재시도, 권한 취소, DOM drift를 실제 Chrome에서 검증한다. 저장 재시도는 클릭을 반복하지 않아야 한다. |
| R0 설치·릴리스 | 미완료 | 확장 package, 로컬 runtime, 모델·catalog·policy bundle을 새 사용자 환경에 설치해 연결·재시작·업데이트·rollback·삭제·권한 회수·건강검사와 CPU/GPU별 자원 사용을 독립 검증한다. |

source 0.4.0 metadata와 source 0.4.1 월봉·년봉 bundle·격리 build는 검증과 독립 검토를 통과했고 현재 0.7 설치본에 포함됐다. 실제 Chrome 실행 전이므로 어느 결과도 제품 인수 완료로 집계하지 않는다.

source 0.5 통합 대화는 source 검증·smoke·격리 build, 모든 독립 검토와 최종 보안·보존 검사를 통과했고 현재 0.7 설치본에 포함됐다. 실제 Chrome 인수가 남아 있어 제품 완료 증거로 집계하지 않는다.

source 0.6 시장 메뉴는 고정된 25개 목적지와 두 단계 후조건을 source에서 검증했고 현재 0.7 설치본에 포함됐다. 실제 Chrome 인수가 남아 있어 제품 완료 증거로 집계하지 않는다. 일반 브라우저의 25개 직접 전환 기록도 확장 action이나 영수증 증거로 승격하지 않는다.

source 0.7 금융 조회는 264개 operation과 697개 form field가 local metadata → Native → Chrome form까지 보존되는 것을 독립 검토된 integration으로 확인했다. contract·Native recovery·vault·backend·extension 구현 lane, runtime·financial·extension aggregate, package readiness, 설치와 독립 post-install 보존 검사도 통과했다. 사용자는 actual Chrome 0.7 연결·화면 조사 성공을 확인했고 새 로컬 캡처는 schema·기존 파일 hash 독립 검사를 통과했다. metadata 검색, 실제 자격증명과 Kiwoom 호출은 남아 있다. isolated owned Chrome card/chart proof를 사용자 WTS 금융 실행 증거로 승격하지 않는다.

## ATHENA 23개 기능

| # | 기능 | 상태 | 현재 주장과 증거 | 완료에 필요한 설치본 증거 |
|---:|---|---|---|---|
| 1 | 화면 호출 | 부분 | 사용자는 Chrome 0.7 연결·화면 조사 성공을 확인했다. 검증된 action 영수증은 확장 `0.2.0`의 차트 열기·일봉·주봉 네 건이며, 설치된 source `0.7`의 월봉·년봉과 25개 시장 메뉴 영수증은 아직 없다. | 고정 WTS inventory의 허용 화면 이동과 인자 입력을 대화로 실행하고 화면군·제어 유형별 후조건을 확인한다. 월봉·년봉과 25개 시장 메뉴를 포함해 팝업·stale·취소·연결 상실·legacy recovery·저장 재시도 guard와 실제 rendered 진행/오류/복구 UI를 검증한다. |
| 2 | 화면 대화 | 미완료 | 설치된 source 0.7의 결정형 composer는 고정 차트 문장, 정확한 25개 시장 메뉴 문장과 명시적 metadata 검색을 분류한다. Chrome 0.7 연결·화면 조사는 사용자 확인됐지만 대화 명령 실행, metadata 검색, 생성형 대화, 모호성 질문, 자유 형식 복합 계획은 확인되지 않았다. | M-1을 통과한 로컬 계획기로 복합 지시, 수정 대화, 모호성 질문, 중단·재개, 여러 action의 연속 후조건을 Chrome 대화 UI에서 외부 AI 없이 검증한다. |
| 3 | 대화주문 | 미완료 | 기존 `executeOrderRequest`와 계좌/order client 위치만 조사했다. 현재 확장에는 주문 action이 없다. | 모의투자 환경에서 확장-origin 주문표, 주문별 사용자 확인, 로컬 재검증, 만료·변경 티켓 거부, 일회성 실행, unknown 결과 재전송 금지를 실제 응답으로 검증한다. 실계좌 주문과 자동매매가 후보에서 차단됨을 함께 증명한다. |
| 4 | 자료 대화 | 미완료 | 기존 파일 선택·provider·`api/projects.py` 위치만 조사했다. Chrome 문서 흐름과 로컬 처리 증거가 없다. | Chrome에서 사용자가 고른 파일을 로컬에서 파싱·색인하고 인용 위치가 있는 답을 렌더링한다. 파싱 실패·근거 없음·취소를 표시하고 원문을 원격 AI로 보내지 않음을 검증한다. |
| 5 | 대화 설정 | 미완료 | 기존 model/prefs IPC와 provider 설정 위치만 조사했다. | Chrome 설정에서 설치된 로컬 모델과 실제 capability만 노출하고 선택·저장·복원·업데이트·rollback을 검증한다. 사용할 수 없는 모델 선택을 막고 원격 fallback 부재를 표시한다. |
| 6 | 활동 기억 | 미완료 | 기존 brain history와 chat-history store 위치만 조사했다. | opt-in 상태에서 허용된 WTS·확장 활동만 로컬에 기록·조회하고 출처·시점을 렌더링한다. 수집 OFF, 삭제, 재시작 후 보존, 민감정보 제외를 실제 저장소로 검증한다. |
| 7 | 지식 대화 | 미완료 | 기존 brain projection/analysis와 graph chat 경로만 조사했다. | 로컬 graph·문서 근거를 WTS context와 함께 조회해 Chrome에서 출처를 표시하고, 근거 부족·접근 불가·stale revision을 정확히 처리하는 실제 다중 turn을 검증한다. |
| 8 | 맞춤 추천 | 미완료 | 기존 suggested questions·surprising connections 분석 위치만 조사했다. | 사용자 허용 기억에서 로컬로 추천을 만들고 근거·시점을 Chrome에 표시한다. 기억 부족 때 일반 추천으로 조용히 바꾸지 않고 미지원 상태를 렌더링한다. |
| 9 | 클러스터 | 미완료 | 기존 cluster map projection과 renderer 위치만 조사했다. | 버전이 있는 로컬 graph projection으로 Chrome 그래프를 렌더링하고 선택·필터·재계산·대용량 한계·실패 상태를 실제 데이터로 검증한다. |
| 10 | 기억 수정 | 미완료 | 기존 manual/confirm/retract relation과 승인 UI 위치만 조사했다. | Chrome에서 수정 제안·명시 확인·revision 충돌·철회·undo를 실행하고 로컬 graph의 전후 상태와 receipt를 검증한다. |
| 11 | 맞춤 알람 | 미완료 | 기존 routine draft/confirm/event와 scheduler 경로만 조사했다. | Chrome에서 조건을 대화로 작성·확인하고 로컬 scheduler가 공식 데이터로 평가한 이벤트·근거·이력을 표시한다. stale·미연결·평가 실패와 PC/runtime 종료 상태를 구분한다. |
| 12 | 대화형 자동화 | 미완료 | 기존 routine update/pause/resume/cancel과 job 도구 위치만 조사했다. | 승인된 조회·분석·보고 작업을 Chrome에서 시작·진행·일시정지·재개·취소하고 로컬 작업 상태와 복구를 검증한다. 자동 주문이 action catalog에 없음을 증명한다. |
| 13 | 통합 감시 | 미완료 | 기존 routine feed, stream, account sync와 event fanout 위치만 조사했다. | 실제 허용 시세·실계좌 조회 구독을 로컬에서 유지하고 Chrome에 snapshot·증분·gap·stale·재동기화·연결 복구를 표시한다. PC/runtime가 멈추면 감시 중단을 정확히 표시한다. |
| 14 | 투자정보 연동 | 미완료 | source 0.7은 264개 generic read operation, 697개 정본 form field, real/mock profile 설정, query lifecycle, facts/table/compound/chart card를 구현했고 모든 구현 lane이 독립 승인됐다. package readiness, 설치와 독립 post-install 보존 검사도 통과했다. 사용자는 Chrome 0.7 연결·화면 조사 성공을 확인했지만 metadata 검색, 금융 readiness·form·card, 자격증명과 Kiwoom live read 증거는 없다. | 설치된 0.7 Chrome에서 metadata 목록·상세, profile readiness, form presence semantics, 명시적 조회·취소·page·continue, 네 실제 card, reconnect unknown, real/mock 환경별 공식 read를 출처·시점과 함께 검증한다. source·fixture·isolated Chrome 증거만으로 완료 처리하지 않는다. |
| 15 | 서비스 연동 | 미완료 | 기존 plugin 승인·거부·audit와 registry 위치만 조사했다. | 서비스별 승인·철회·재인증·credential 격리를 Chrome에서 수행하고 로컬 registry·audit와 일치함을 검증한다. 다른 사용자 credential 재사용과 권한 없는 호출을 차단한다. |
| 16 | 도구 호출 | 미완료 | 기존 provider runtime, `api/llm_tools.py`, MCP server 위치만 조사했다. | 로컬 계획기가 허용 목록과 사용자·도구·행동 권한을 검사해 실제 도구를 호출하고 구조화 결과·진행·취소·실패를 Chrome에 표시한다. 웹/문서의 문자열이 권한을 바꾸지 못하는 prompt injection 회귀를 통과한다. |
| 17 | 바이브코딩 | 미완료 | 기존 backtest chat, projects, user strategy/codegen 위치만 조사했다. | Chrome 전략 작업공간에서 자연어 요구를 로컬 코드/spec으로 만들고 diff·검증·격리 실행·취소·자원 한도·오류를 실제 파일과 작업 receipt로 확인한다. |
| 18 | 노드 대화 | 미완료 | 기존 technique node 모듈과 backtest chat action 위치만 조사했다. | Chrome 노드 편집 화면에서 대화로 node/spec을 수정하고 schema·revision·연결 유효성을 로컬에서 검사한다. 충돌·invalid spec을 거부하고 렌더링 상태와 저장 상태가 일치함을 검증한다. |
| 19 | 백테스트 | 미완료 | 기존 plan/run/status/result/trades handler와 엔진 위치만 조사했다. | Chrome에서 실제 전략·데이터 버전·수수료 가정을 선택하고 로컬 격리 작업을 실행한다. 진행·취소·재시작·결과·거래 내역·결측/실패를 렌더링하며 fixture를 실제 결과로 표시하지 않는다. |
| 20 | 투자 진단 | 미완료 | `api/backtest.py`의 `/diagnose` 후보만 확인했고 renderer IPC는 아직 확정되지 않았다. | 실제 입력과 거래·진단 근거를 사용하는 계약을 먼저 확정하고 Chrome에서 실행·결과·근거를 렌더링한다. 입력 부족, handler 미연결, 실패를 완료로 집계하지 않는 실제 흐름을 검증한다. |
| 21 | 조건 탐색 | 미완료 | backtest 조건과 키움 조건검색 후보 경로만 조사했으며 두 의미의 제품 계약이 확정되지 않았다. | 연구용 전략 조건과 키움 공식 조건검색을 별도 action·권한·결과 schema로 확정한다. 각 실제 데이터 흐름의 검색·선택·적용·실패를 Chrome과 로컬 실행기로 검증한다. |
| 22 | 미니 대화 | 미완료 | 기존 orb submit과 shared provider pipeline 위치만 조사했다. WTS 안 Chrome 오브는 구현 증거가 없다. | WTS 안 Chrome UI에서 같은 로컬 turn을 시작하고 패널 열기, WTS context 전달, 카드 결과, 중단·오류를 검증한다. Electron/OS 오브를 Chrome 구현 증거로 세지 않는다. |
| 23 | 능동 알림 | 미완료 | 기존 app notification, routine event/missed와 OS 창 경로만 조사했다. | 로컬 scheduler의 실제 영속 이벤트를 Chrome 오브·패널에 표시하고 확인·미확인·재접속 이력을 검증한다. Chrome 종료 중 화면 표시를 약속하지 않고 재개 뒤 누락·중복·gap 처리를 확인한다. |

## 실사용 guard 증거표

다음 항목은 관련 기능의 정상 경로가 통과해도 별도로 확인한다. 최소 증거는 설치된 확장의 전후 관찰, action/proposal 식별자, 한 번의 실행, 후조건, 불변 receipt 또는 명시적 defer/blocked 기록이다.

| 상황 | 기대 결과 |
|---|---|
| 인증·확인 modal 또는 차단 popup | 화면 상태를 `blocked`로 판정하고 클릭하지 않는다. |
| 오래된 observation·document·tab·instrument | 실행 전에 거부하고 새 관찰을 요구한다. |
| 모호한 지시·복수 후보·알 수 없는 화면 | 임의 선택하지 않고 질문하거나 `defer/unsupported`를 반환한다. |
| 사용자의 취소 | 대기·계획·장기 작업을 중단하고 후속 action을 시작하지 않는다. |
| Native 연결 상실·실행기 재시작 | 성공을 추정하지 않고 `unknown` 또는 복구 가능 상태를 보존한다. |
| 클릭 뒤 후조건 시간 초과 | 자동으로 클릭을 반복하지 않고 결과 불명확 상태를 표시한다. |
| receipt 저장 실패·재시도 | 같은 receipt만 재저장하며 WTS action을 다시 실행하지 않는다. |
| 권한 철회·capability 변경 | 이전 승인과 오래된 plan을 무효화하고 실행을 막는다. |
| WTS DOM·iframe·canvas·새 창 구조 변경 | adapter/version 불일치를 감지하고 근거 없는 성공을 기록하지 않는다. |
| 로컬 모델 미가동·부적합 출력 | 원격 AI로 우회하지 않고 지원 불가 또는 재연결 상태를 표시한다. |

## 릴리스 판정

전체 이식 완료는 다음 항목이 모두 충족될 때만 선언한다.

1. 전역 게이트 M-1, L0, W0, W1, D0, M0, W2, A0, G0, R0의 미해결 항목이 없다.
2. 위 23개 기능이 모두 `완료`이고, 각 행에 설치본 버전·실행 receipt·렌더링된 Chrome 흐름·실패/복구 증거가 연결돼 있다.
3. 확장, 로컬 runtime, 모델, action catalog, policy가 하나의 호환 bundle로 검증되고 새 사용자 Windows + Chrome 환경에서 설치·업데이트·rollback·삭제를 통과한다.
4. 외부 AI endpoint를 차단하고 필요한 WTS·금융 데이터 연결만 허용한 환경에서 로컬 처리 조건과 자원 사용을 재현한다.
5. 실계좌 주문·자동매매·인증값 자동 입력·보안 우회가 실행 후보에 없고, 모의 주문의 건별 확인과 실계좌 조회 경계가 실제 제품에서 유지된다.

현재는 이 조건을 충족하지 않는다. 다음 구현은 M-1/L0/W0를 병행하면서 대표 제어 유형의 W1·D0 증거를 만든 뒤 LAYA M0와 23개 기능 A0로 확장한다. 좁은 차트 정상 경로, 0.3 기준선, 0.4.0 metadata, 0.4.1 월봉·년봉, 0.5 통합 대화 또는 source 검증 단계의 0.6 시장 메뉴를 전체 완료로 승격하지 않는다.
