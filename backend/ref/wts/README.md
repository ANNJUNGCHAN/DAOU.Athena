# ATHENA WTS 이식: 화면 조사와 실행 기반

2026-10-18부터 2026-10-19까지 `https://wts.kiwoom.com/`의 로그인된 Chrome 화면을 직접 탐색했다. 현재 결과는 **사이트맵의 53개 진입 항목에 대한 구조 조사와 확장 프로그램/로컬 호스트 기반**이다. 모든 화면 상태·조회 결과·대화 제어·LAYA 재학습을 완료했다는 뜻은 아니다.

설치된 확장·실행기 파일은 **0.7.0 / 프로토콜 7**이다. 독립 설치 후 검사는 extension stage 48개와 설치본의 정확한 일치, host 23개(소스 19개·생성 control 4개), 불변이며 유효한 32/64-bit Registry, 당시 data 10개 불변, 이전 host 18개·extension 20개 rollback backup의 payload·private ACL·security metadata, owned process 0개를 확인했다. 설치된 Native subprocess의 실제 `runtime.hello`는 프로토콜 7, runtime 0.7.0과 금융 capability를 확인했고 stderr 0·exit 0으로 끝났다. 사용자는 Chrome 새로고침 뒤 `0.7.0이고 연결·화면 조사 성공`이라고 확인했다. 로컬 저장소에서 2026-10-19 08:02:39 KST의 새 캡처 1개를 찾아 파일 수가 10개에서 11개로 늘어난 것도 확인했다. 캡처에는 확장 버전 필드가 없으므로 0.7.0은 사용자 확인에 근거한다. 독립 검사는 현재 source와 설치본의 동일한 프로토콜 7 schema로 캡처가 유효하고 기존 10개 파일 hash가 모두 불변임을 확인했다. 최신 경계는 [금융 조회 source 0.7 검증](financial-read-v7-validation-20261019.md)에 구분한다.

실제 Chrome의 최신 버전·연결 증거는 사용자 확인 기준 0.7.0이며 화면 조사 성공도 보고됐다. 새 로컬 캡처는 관측 1개·heading 1개·control 13개·child frame 0개·canvas 0개·비절단 상태다. 이는 한 화면의 구조 관찰이지 전체 WTS inventory가 아니다. 검증된 화면 action 증거는 계속 0.2 단일 명령 파일럿의 `POSTCONDITION_MET` 영수증 4건으로, 종목시세 → 차트 열기 1건, 일봉 → 주봉 2건, 주봉 → 일봉 1건만 증명한다. 0.7 metadata 검색, 금융 UI, 생성형 계획기와 LAYA는 확인되지 않았다.

검증된 `0.4.0` / 프로토콜 4 metadata 기준선은 선택적으로 전용 Python backend를 지연 시작해 조회 기능의 이름·인자·응답 필드 **메타데이터만** 찾고 Chrome 카드 형태로 검증하는 경로를 추가했다. 실제 금융 조회, AI·모델·LAYA, LAYA 학습은 추가하지 않았다. 0.4.0 소스 bundle은 전체 JavaScript 검증과 각 소유 범위의 독립 검토를 통과했고 임시 격리 확장 package도 build·정적 검사를 통과했다. 당시 `extension/dist`와 설치본은 변경하지 않았고 Chrome에도 로드하지 않았다. 근거와 미검증 범위는 [source metadata v4 소스 검증](source-metadata-v4-validation-20261019.md)에 기록한다.

역사적 source `0.4.1`은 프로토콜 4의 catalog 2와 deterministic compiler 2에 월봉·년봉을 추가했다. legacy catalog 1 기록은 변환하지 않고, 복구를 먼저 끝낸 뒤 명시적 새 전송에서만 exact legacy ready task를 취소하고 같은 요청을 catalog 2로 시작했다. 계약 19, runtime 105, 확장 161의 전체 JavaScript 검증은 **285/285 통과**했고 다섯 독립 검토도 모두 APPROVE였다. 실제 metadata cross-layer smoke와 23파일 격리 build·정적 검사도 통과했다. 해당 검증 당시 설치본과 실제 Chrome 증거는 바뀌지 않았다. 해당 경계는 [차트 월봉·년봉 source 0.4.1 검증](chart-period-v2-validation-20261019.md)에 기록한다.

검증된 source `0.5.0` / 프로토콜 5는 하나의 Chrome composer에서 기존 고정 차트 문장과 정확한 `조회 기능 찾아줘: 검색어`만 로컬로 분류한다. 생성형 계획기, 실제 금융 query, LAYA와 주문은 추가하지 않는다. 검색 card와 상세는 session-only binding으로 제한하며 source/chart/capture/receipt/task recovery와 배타적으로 조정한다. 계약 20, runtime 109, 확장 198의 fresh 검증은 **327/327 통과**했고 실제 read-only Python까지 잇는 cross-layer smoke와 24파일 격리 build·정적 검사도 통과했다. 모든 독립 검토와 최종 보안·보존 검사도 통과했다. 해당 검증 당시 설치본과 실제 Chrome 증거는 바뀌지 않았다. [통합 대화 source 0.5 검증](unified-conversation-source-v5-validation-20261019.md) 참조.

역사적 source `0.6.0` / 프로토콜 6은 catalog `wts-main-control-3`와 deterministic compiler 3으로 `시장 메뉴 열어줘: 그룹 > 메뉴` 형식을 추가했다. 기록된 25개 목적지만 허용하며 사이트맵 열기와 P1 대상 선택을 각각 새 관찰·한 번의 클릭·후조건·영수증으로 처리한다. 계약 23, runtime 115, 확장 238의 전체 JavaScript 검증은 **376/376 통과**했고 25파일 격리 build·정적 검사, 실제 로컬 metadata smoke와 installer DryRun도 통과했다. 해당 검증 당시 설치본과 실제 Chrome 증거는 바뀌지 않았으며, 25개 직접 탐색 기록도 확장 영수증으로 집계하지 않는다. [시장 메뉴 source 0.6 검증](market-navigation-source-v6-validation-20261019.md) 참조.

현재 source `0.7.0` / 프로토콜 7은 기존 화면 제어와 metadata 경계를 유지하면서 별도의 로컬 금융 조회 경로를 추가한다. Chrome side panel에서 자격증명 설정, 조회 양식, 명시적 조회·취소·페이지·연속 조회와 네 카드 형식을 제공하고, 사용자 PC의 별도 financial child가 264개 read-only operation을 처리한다. 분류는 facts 114, table 114, compound 17, chart 19이고 양식 필드는 string 609개와 nullable string 88개, 합계 697개다. Native 공개 method는 자격증명 3개와 query 5개로 고정된다. 프로필은 Windows CurrentUser DPAPI로 보호하고 access token과 조회 결과는 메모리에만 둔다. 원격 AI, LAYA, 주문, websocket 또는 Electron UI는 추가하지 않는다.

계약 30, 독립 검토된 Native recovery 39, 독립 검토된 vault 33, 최종 runtime aggregate 160/160, 금융 aggregate 108/108이 통과했다. extension freeze는 281/281과 `npm check`, 독립 최종 검토를 통과했다. 계약·runtime·extension은 targeted subset을 중복하지 않고 현재 JavaScript 471건이다. 최신 backend 세 보수도 targeted 51건, Ruff·AST·diff와 독립 재검토를 zero finding으로 통과해 모든 구현 lane이 독립 승인됐다. 금융 aggregate에는 외부 Starlette/httpx deprecation warning 1건만 있었고 의존성 변경은 없었다. 초기 summary-only runtime 실패의 원인은 확인되지 않았으며 이후 157건 full run 두 번과 최종 160건 run이 통과했다. 실제 owned isolated Chrome에서는 네 카드와 chart mount·zoom·trusted pan·resize·prepend·destroy를 확인했다. ACL upgrade repair, package readiness, stage build/check와 실제 0.7 파일 설치가 통과했고, 사용자는 Chrome 0.7 연결·화면 조사 성공을 확인했다. 새 로컬 캡처는 schema·기존 파일 hash 독립 검사를 통과했다. metadata 검색, 자격증명과 Kiwoom live read는 아직 확인되지 않았다. [금융 조회 source 0.7 검증](financial-read-v7-validation-20261019.md) 참조.

## 실제 조사 범위

- [메뉴별 조사 목록](screen-inventory-20261018.json): 사이트맵 53개 항목을 각각 열어 입력 종류, 버튼, 표 제목, canvas/iframe 구조를 확인했다. 목록의 일련번호는 조사용이며 키움 공식 화면번호가 아니다.
- [사이트맵 실시간 UI 발견 목록](sitemap-inventory-20261019.md): 실제 사이트맵 modal의 17개 그룹과 닫기 제외 버튼 50개를 별도 분모로 기록했다. 53개 방문 조사와 단위가 달라 합산하지 않는다.
- [시장 메뉴 직접 탐색 검증](market-menu-navigation-20261019.md): 시장 분석 메뉴 25개가 P1의 기대 활성 상태로 전환되는지 직접 확인했다. 확장 action 지원 증거는 아니다.
- 별도 창 4종: 시장종합(`/marketinfo`), 차트(`/chart`), 뉴스(`/news`), 예약주문(`/reserve`). 예약주문은 초기 화면만 관찰했다.
- 추가 화면: 상세종목검색, 호가설정, 종목정보, 차트 설정, 일반설정, 티커설정, 홈페이지 연결 메뉴.
- 홈페이지 연결 메뉴 18개는 링크 명칭만 확인했다. 이체·청약·대출·비밀번호 변경 등의 외부 업무를 실행하지 않았다.
- 계좌번호, 비밀번호, 입력값, 보유 종목/잔고 수치, 주문/체결 행 데이터는 조사 산출물에 저장하지 않았다.

## WTS가 요구하는 제어 방식

메인 화면은 네 개 `article.article-area` 패널로 구성된다. 호가(P0), 관심/분석(P1), 주문/주문내역(P2), 종목상세/차트/뉴스/계좌조회(P3)가 동시에 존재한다. 같은 이름의 `조회`, `종목별투자자`, `차트` 등이 서로 다른 패널에 반복된다. 따라서 전역 버튼 이름이나 좌표만으로 제어하면 다른 패널을 조작할 수 있다.

수집 결과에서 확인한 제약은 다음과 같다.

1. 가격·수량 셀에도 `button`이 많이 사용된다. 단순 버튼 수집은 시장 데이터와 계좌 데이터를 섞는다. 현재 수집기는 표 데이터 셀을 제외한 구조 정보만 다룬다.
2. 입력과 SVG/체크박스 중 접근성 이름이 없는 요소가 있다. 임의의 숫자형 ID도 보인다. 향후 어댑터는 패널, 표 제목, 명시적 라벨, 활성 탭을 함께 사용해야 한다.
3. 차트는 canvas를 포함한다. DOM 메뉴 제어와 차트 내부 시각/좌표 제어는 별도 검증이 필요하다. 현재 기반은 canvas 개수만 기록한다.
4. 새 창은 클릭 직후 동기적으로 나타나지 않는다. tab/window/document 식별자와 로딩 후 조건을 확인해야 한다.
5. 계좌 비밀번호 요구 안내가 늦게 나타날 수 있다. 주문내역 및 직접 선택한 권리정보에서 실제 확인했다. 화면 틀이 열린 것과 계좌 조회가 성공한 것은 다르다.
6. 보안용 `yettie_library_iframe`(`/fsm/js/koscom/app/views/library.html`)은 수집·제어 대상에서 제외한다. 뉴스의 `if_news` iframe은 별도 컨텍스트로 다루며 기사 본문 동작은 아직 검증하지 않았다.

## 직접 확인한 동작과 불일치

| 동작 | 관찰한 결과 | 판정 범위 |
| --- | --- | --- |
| 사이트맵 53개 진입 | 각각 패널 또는 화면 구조를 관찰 | 메뉴 진입 조사 완료, 모든 상태 검증은 미완료 |
| 독립 차트 `일 → 주 → 일` | 활성 버튼 `주`, 이후 `일` 확인 | 가역적 기간 전환 확인 |
| 상세종목검색에 `삼성전자` 입력 | `005930 삼성전자`, `005935 삼성전자우` 필터 결과 표시 | 입력 시 자동 필터 확인, 종목 선택은 미실행 |
| 검색 팝업의 `검색` 클릭 시도 | 버튼 disabled, 클릭되지 않음 | 버튼 클릭을 성공으로 기록하지 않음 |
| 사이트맵 `잔고 → 권리정보` | 신용융자·대주 한도 관련 표 표시 | 메뉴 경로 불일치 관찰 |
| 패널의 `권리정보` 직접 선택 | 권리구분·기준일·청약·배정 관련 표 표시 | 직접 경로의 별도 화면 확인, 비밀번호 안내 발생 |
| 사이트맵 `잔고 → 신용한도조회` | 총매입·총평가·평가손익 표 표시 | 메뉴 경로 불일치 관찰 |
| 패널의 `신용한도조회` 직접 선택 | 신용융자·대주 한도 관련 표 표시 | 직접 경로의 별도 화면 확인 |

두 메뉴 불일치는 같은 세션에서 재현한 화면 관찰이다. WTS 내부 코드의 원인은 확인하지 않았으므로 서비스 결함의 원인까지 단정하지 않는다. 메뉴 클릭 성공을 도착 화면 성공으로 간주하지 않는 후조건 검증이 필요하다.

## Chrome UI와 사용자 PC의 경계

```text
Chrome: WTS 탭/창 + ATHENA Side Panel
  └─ MV3 service worker: 탭 연결, 제한된 DOM 구조 관찰, 메시지 상관관계
       └─ Chrome Native Messaging (stdio, 정확한 확장 ID 허용)
            └─ 사용자 PC Node 호스트
                 ├─ 프로토콜 검증 및 로컬 관찰·실행 기록 저장
                 ├─ 차트와 25개 시장 메뉴의 제한된 결정형 작업·동작 제안
                 ├─ 별도 metadata child와 financial-read child 지연 시작
                 ├─ CurrentUser DPAPI 프로필·메모리 전용 token/query 결과
                 └─ LAYA / planner / 기존 ATHENA 도구 (후속 연결, 현재 비활성)
```

UI는 Chrome 내부의 확장 side panel이며 별도 Electron UI를 실행하지 않는다. 호스트는 확장 연결에 따라 시작되는 사용자 PC 프로세스다. 공개 HTTP 포트를 열지 않는다. 설치본 프로토콜 7은 기존 조사·영수증·차트·시장 메뉴 계약을 유지하고 별도 owned financial child와 인증된 loopback 경계로 read-only 금융 조회를 추가한다. 화면 작업은 완전히 해석되는 한국어 문법과 등록 action catalog로 제한하며, 금융 호출은 고정 read allowlist와 정본 form 인자만 허용한다. 임의 JavaScript, 셸 실행, 주문, 모델 호출 명령은 없다. 모델·계획·도구의 연산을 브라우저로 옮기거나 원격 AI로 우회하지 않는다.

- [확장 프로그램 소스 및 실행 안내](../../../extension/README.md)
- [로컬 호스트 설치·제거 안내](../../../local-runtime/README.md)
- [공통 프로토콜](../../../contracts/README.md)
- [대화 작업 v3 검증 기록](chat-task-v3-validation-20261019.md)
- [source metadata v4 소스 검증](source-metadata-v4-validation-20261019.md)
- [차트 월봉·년봉 source 0.4.1 검증](chart-period-v2-validation-20261019.md)
- [통합 대화 source 0.5 검증](unified-conversation-source-v5-validation-20261019.md)
- [시장 메뉴 source 0.6 검증](market-navigation-source-v6-validation-20261019.md)
- [금융 조회 source 0.7 검증](financial-read-v7-validation-20261019.md)
- [현재 검증 및 남은 단계](chart-pilot-validation-20261018.md)
- [공식 설명서 기반 제어 맵](official-manual-control-map-20261018.md)
- [직접 브라우저 제어 검증](direct-control-validation-20261018.md): P1·P3와 시장종합·차트 독립 창의 제한된 브라우저 동작을 확인했다. 확장 지원은 기존 차트 열기·일봉·주봉 세 동작 그대로다.
- [로컬 실행기의 source-only 증거 감사](../../../local-runtime/README.md#offline-evidence-audit)
- [초기 기반 검증 기록](foundation-validation-20261018.md)

0.2 파일럿의 역사적 기준선은 계약 12, 확장 58, 로컬 실행기 51로 **121/121 통과**였다. 설치된 0.3의 검증 기준선은 계약 13, 확장 104, 로컬 실행기 65로 **182/182 통과**했고 실패·skip·todo는 0이다. 핵심 변경과 panel은 독립 검토에서 APPROVE를 받았다. CAS·두 host 경쟁·receipt 복구 반복 검사와 격리 build, 설치 파일 일치, 민감정보 누출 검사도 통과했다. 이는 0.3 소스·설치·로컬 stdio 증거이며 실제 Chrome 복합 작업의 성공 증거는 아니다.

v4 source metadata는 계약 17, runtime 100, 확장 142로 전체 JavaScript 검증 **259/259**를 통과했고 실패·취소·skip·todo는 0이다. backend 27, Node supervisor/bridge 28, runtime targeted 40, service worker targeted 33, panel targeted 31도 각 소유 범위에서 통과했으며 모든 독립 검토는 APPROVE였다. targeted 수치는 259개의 부분집합이므로 다시 더하지 않는다. 실제 backend를 사용한 native-process와 card-normalizer smoke도 통과했고, 임시 staging의 확장 23개 파일도 build·정적 검사를 통과해 기존 확장 ID를 유지했다. 이는 0.4.0 source bundle과 격리 package의 역사적 증거이며 설치·실제 Chrome 증거가 아니다.

0.4.1 월봉·년봉 bundle은 계약 19, runtime 105, 확장 161로 **285/285**를 통과했고 실패·취소·skip·todo는 0이다. 계약, runtime, extension lifecycle, adapter/UI와 통합의 다섯 독립 검토도 APPROVE였다. 초기 계약 HIGH finding은 exact task/proposal binding 수정 뒤 강제 재현 거부와 재검토를 통과했다. 새 auditor로 기존 로컬 기록을 읽은 결과는 legacy 3개 정상 경로만 완료됐고 `currentCatalogCoverage`의 역사적 catalog 2 차트 다섯 경로는 모두 미완료였다. 따라서 source bundle 승인과 audit pass도 catalog 2 또는 실제 Chrome 월봉·년봉 증거가 아니다.

0.5 통합 대화 source는 **327/327**, 실제 read-only cross-layer smoke, 24파일 격리 build·정적 검사, 모든 독립 검토와 최종 보안·보존 검사를 통과했다. 이 source 검증을 설치·실제 Chrome 증거로 집계하지 않으며, 통합 composer 자체도 생성형 대화, 금융 조회, LAYA, 주문 또는 23개 기능 완료를 의미하지 않는다.

0.6 시장 메뉴 source는 **376/376**, 실제 로컬 metadata smoke, installer DryRun과 25파일 격리 build·정적 검사를 통과했다. catalog 3의 25개 시장 목적지는 일반 브라우저에서 직접 확인한 경로를 고정 계약으로 옮긴 범위이며, source 검증을 설치·실제 Chrome 메뉴 실행이나 전체 WTS 제어 완료로 집계하지 않는다.

0.7 금융 조회는 264 operation과 697 form field, 8개 Native method, 별도 financial child, CurrentUser DPAPI vault와 네 card renderer를 구현했다. contract·Native recovery·vault·backend·extension 구현 lane은 모두 독립 승인됐고 runtime 160/160과 금융 108/108 aggregate도 통과했다. extension freeze는 281/281과 `npm check`, actual owned isolated Chrome cards/chart 검증을 통과했다. ACL upgrade repair, package readiness, stage build/check, 실제 0.7 파일 설치와 installed Native hello도 통과했다. 사용자는 실제 Chrome 0.7 연결·화면 조사 성공을 확인했고 새 로컬 캡처 메타데이터도 읽었다. 이 캡처는 전체 WTS inventory, control action, metadata 검색, 자격증명 입력, Kiwoom live read, LAYA 또는 주문 증거가 아니다.

## 다음 구현 순서와 완료 조건

1. **0.7 Chrome metadata 확인**: 새 캡처의 schema와 기존 10개 파일 hash 독립 검사는 통과했다. 같은 panel에서 비민감 metadata 검색의 목록 또는 명시적 오류 상태를 확인한다. Chrome 내부 페이지 식별 정책 때문에 panel 동작은 사용자가 직접 수행한다.
2. **자격증명·live read 인수**: 사용자가 trusted side panel에서 real/mock profile을 직접 설정한 뒤 환경별 token readiness, 공식 read 1건, chart/read page 1건, 출처·시각·취소·페이지 UI를 비식별 영수증으로 확인한다. 자격증명은 채팅에 보내지 않으며 real과 mock은 별도 증거로 남긴다.
3. **차트 파일럿 실패·보류 조건 검증**: 팝업, 오래된 화면 상태, 취소, 연결 상실, 실행기 재시작, 영수증 저장 재시도를 실제 Chrome에서 검증한다. 단위 테스트나 stdio 테스트만으로 실제 Chrome 동작을 대신하지 않는다.
4. **화면별 어댑터**: P0~P3와 별도 창별 식별자·준비 조건·후조건을 구현한다. 메뉴 불일치 경로는 차단하고 검증된 직접 경로만 사용한다.
5. **읽기 중심 대화 제어**: 화면 열기, 검색, 차트 기간, 조회 필터 등 승인 범위의 동작부터 `관찰 → 후보 계획 → 실행 → 후조건`으로 연결한다. 여러 동작을 한꺼번에 추측 실행하지 않는다.
6. **상태별 추가 조사**: 목록의 필터 조합, 빈 결과, 오류, 로딩, 페이지 이동, 팝업, 기사 iframe, 창 재연결을 수집한다. 계좌 조회는 사용자가 인증한 세션에서 구조와 데이터 접근 성공을 별도 판정한다.
7. **LAYA 데이터와 평가**: 사용자 발화·현재 화면/패널·가능 동작·정답 동작·후조건·실패/보류 이유를 연결한다. 날짜/화면 상태/발화 계열 단위로 train/test를 분리한다. 이번 수동 조사와 수집 파일은 학습 정답으로 자동 승인하지 않는다. 원본 개인정보·인증 프레임·실제 주문 데이터는 학습 자료에 넣지 않는다.
8. **로컬 모델 연결 후 회귀 검증**: 잘못된 패널, 모호한 지시, 오래된 document, 인증 팝업, 알려지지 않은 화면에서 실행을 보류하는지 확인한다. M-1 로컬 계획기 적합성은 아직 통과하지 않았고 GPU 실측용 추가 runtime 승인도 남아 있다. 기존 ATHENA LAYA를 WTS 제어 모델로 이미 사용할 수 있다고 가정하지 않는다.

실계좌 주문과 자동매매는 제품 범위 밖이다. 모의투자 주문은 향후 주문표마다 사용자가 개별 확인하는 경계에서만 다룬다. 현재 기반에는 어느 주문 실행 경로도 없다. ATHENA 23개 기능 중 완료된 기능은 여전히 0개이며, 좁은 차트 화면 호출만 부분 상태다.

## 참고한 공식 문서

- [Chrome Side Panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)
- [Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)
- [MV3 service worker 기본 구조](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/basics)
- [Service worker 수명](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- [Content script와 frame 경계](https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts)

WTS 사실 관찰의 출처는 로그인된 https://wts.kiwoom.com/ UI다. [현재 웹트레이딩 서비스 소개](https://www.kiwoom.com/h/help/channel/VHelpWtsInfoView?dummyVal=0)는 현재 서비스 범위와 접속 성격을 확인하는 참고자료로 사용했다. 2016년 종료 안내가 붙은 과거 JAVA WTS 문서는 현재 HTML WTS의 DOM·기능·제어 절차 증거로 사용하지 않는다. Chrome 문서는 확장 실행 구조 확인에만 사용했다.
