# WTS 시장 메뉴 source 0.6 검증

검증일: 2026-10-19

상태: **SOURCE VALIDATION AND STAGING PASS — INSTALLATION/LIVE CHROME PENDING**

대상: 소스 `0.6.0` / Native Messaging 프로토콜 6 / current catalog `wts-main-control-3`의 결정형 시장 메뉴 제어

## 현재 판정

source 0.6은 기존 통합 대화에 다음 정확한 형식을 추가한다.

```text
시장 메뉴 열어줘: <그룹> > <메뉴>
```

입력 전체가 고정 catalog의 25개 목적지 중 하나와 일치해야 한다. 허용된 명령은 `wts.main.sitemap.open`과 `wts.main.p1.market.navigate` 두 단계로 확장된다. 각 단계는 새 관찰, 최대 한 번의 클릭, 독립 후조건과 영수증을 사용한다. 기존 차트 문장과 `조회 기능 찾아줘: 검색어` route는 유지한다.

전체 JavaScript 검증, 실제 로컬 metadata smoke, installer DryRun과 격리 extension build는 통과했다. 설치된 host와 `extension/dist`는 `0.3.0` / 프로토콜 3 그대로다. 실제 Chrome에서 확인된 최신 제어 증거도 `0.2.0` 차트 영수증 4건이다. source 0.6을 설치하거나 실제 WTS에서 확장으로 실행하지 않았으며 전체 기능 판정은 완료 0개, 부분 1개, 미완료 22개를 유지한다.

## 고정된 25개 목적지

25개 목적지는 [시장 메뉴 직접 탐색 검증](market-menu-navigation-20261019.md)의 기록을 고정 catalog로 옮긴 것이다.

| 사이트맵 그룹 | 허용 메뉴 |
|---|---|
| 시세분석 | 급등락, VI발동종목, 거래량급증, 관리종목, 상하한가, 신규상장, 신고신저가, 증거금률별, 거래량갱신 |
| 순위 | 전일대비 등락률 순위, 당일 거래상위 |
| 테마/업종 | 인포스탁섹터그룹, 인포스탁섹터구성종목, 전업종지수, 업종현재가 |
| 외국인/거래원 | 외국인 기간별매매 상위, 외국인 연속순매매 상위, 종목별 증권사 순위, 거래원 순간 거래량 |
| 투자자별/프로그램 | 투자자별매매동향, 투자자별매매일별, 종목별투자자, 프로그램매매, 프로그램종목별매매 |
| 빅데이터 | 실시간종목조회순위 |

예를 들어 `시장 메뉴 열어줘: 시세분석 > 급등락`은 허용되지만, catalog에 없는 그룹·메뉴 조합, 부분 문장, 임의 selector, 좌표, URL 또는 스크립트는 작업으로 만들지 않는다. 완전히 해석된 복합 입력도 실제 action으로 확장한 단계 수가 12개를 넘으면 거부한다.

## 관찰과 실행 경계

사이트맵이 닫혀 있을 때는 대상 메뉴가 DOM에 보이지 않는 상태를 정상으로 취급한다. 이 상태에서는 다음 조건을 모두 만족할 때만 사이트맵 열기 proposal을 만든다.

- WTS top frame과 P1 시장 영역을 유일하게 식별한다.
- P3의 현재 종목을 차트 어댑터와 같은 visible text 기준으로 hash한다.
- 사이트맵 opener가 보이고 활성화되어 있다.
- 다른 modal이나 인증·보안 차단 상태가 없다.

사이트맵을 연 뒤에는 같은 요청의 목적지가 실제로 보이고 활성화 가능한지 다시 관찰한다. 다음 단계로 넘어갈 때는 이전 관찰을 재사용하지 않는다. Native `control.task.next`는 한 번에 만족된 단계 하나만 소비하고 `ready` 상태를 돌려주며, Chrome coordinator는 task ID, catalog, revision, cursor와 step 진행을 확인하고 Stop 상태를 다시 검사한 뒤 다음 action/target을 새로 관찰한다.

사이트맵 열기 영수증은 요청한 목적지가 보이고 available인 상태를 요구한다. 메뉴 이동 영수증은 사이트맵이 닫히고 정확한 `targetId`가 활성화된 상태를 요구한다. 두 영수증 모두 같은 tab, window, document, instrument와 source proposal binding을 유지해야 한다. 이미 같은 대상이 활성화돼 있으면 클릭 없이 각 단계를 한 번씩 만족 처리할 수 있다.

## 이번 검토에서 수정한 실패 경계

- 시장 어댑터의 instrument hash를 접근성 라벨이 아니라 차트 어댑터와 같은 visible `innerText`/`textContent`에서 계산하도록 맞췄다.
- opener, P1, 대상 또는 modal의 조상에 `hidden`, `aria-hidden`, `display:none`, `visibility:hidden`이 있으면 보이지 않는 것으로 처리한다. computed style을 읽지 못해도 실행 가능으로 추정하지 않는다.
- strict DOM fixture의 도착 상태를 주입한 catalog가 아니라 별도의 정본 기대값으로 구성해 잘못된 catalog mapping이 스스로 성공을 증명하지 못하게 했다.
- 이미 만족된 단계는 Native 호출 한 번에 하나만 진행하고, 다음 단계 전에는 action별 관찰을 새로 얻도록 했다.
- task 진행 중 catalog가 바뀌거나 Stop이 비동기 경계 사이에 들어오면 다음 클릭을 시작하지 않도록 했다.
- panel reopen과 이후 `native.status`에서 authoritative `controlBlockedReason`을 다시 표시하도록 했다.
- 오프라인 auditor는 catalog 3 영수증을 엄격히 검증하되, 역사적 catalog 1·2 차트 coverage에는 합산하지 않는다.

## 호환성과 저장

catalog 1의 일·주 차트 기록과 catalog 2의 일·주·월·년 차트 기록은 원래 schema와 compiler identity로 계속 읽는다. source 0.6은 이 기록을 catalog 3으로 다시 쓰지 않는다. ready 상태의 이전 catalog task는 복구와 미결 영수증 정리를 먼저 마친 뒤, 사용자의 새 명시적 전송에서 같은 task가 authoritative cancellation 된 경우에만 현재 catalog로 새 작업을 시작한다.

오프라인 감사의 `currentCatalogCoverage`는 역사적으로 catalog 2의 차트 다섯 경로를 뜻한다. catalog 3의 차트·시장 영수증은 strict validation을 거치지만 이 역사적 coverage에는 `non-applicable`로 별도 집계한다. 이번 기준 저장소에는 catalog 3 영수증이 없어서 `nonApplicableVerifiedReceiptCount=0`이다.

## 공식 도움말과 실측의 구분

[키움증권 웹트레이딩 서비스 소개](https://www.kiwoom.com/h/help/channel/VHelpWtsInfoView?dummyVal=0), 이용방법과 주요화면 페이지는 현재 WTS가 브라우저 서비스이고 시장종합·뉴스·순위분석·빅데이터 등의 주요 화면을 제공한다는 범위를 확인하는 데 사용했다. 공식 도움말은 현재 사이트맵 DOM, P1 article binding, 25개 메뉴의 selector나 후조건을 규정하지 않는다.

2016년 서비스 종료 안내가 붙은 과거 JAVA WTS 문서는 명칭과 과거 화면 개념을 해석할 때만 참고했다. 현재 HTML WTS의 DOM·기능 존재·제어 절차에 대한 증거로 사용하지 않았다. 25개 mapping과 후조건은 로그인된 현재 WTS에서 별도로 기록한 직접 관찰에서 가져왔다.

## source 검증 결과

root의 마지막 수정 뒤 fresh 전체 JavaScript 실행은 계약 23개, runtime 115개, extension 238개로 **376/376**을 통과했다. 실패·취소·skip·todo는 모두 0이다.

- 계약·runtime 독립 검토는 catalog 3 감사 분류를 수정한 뒤 **APPROVE, open finding 0건**으로 끝났다.
- extension driver 독립 검토는 catalog drift와 비동기 Stop 경계를 수정한 뒤 **APPROVE, open finding 0건**으로 끝났다.
- panel과 public keep-set 검토는 **APPROVE**였다.
- 시장 DOM 어댑터 독립 검토는 지적한 세 문제의 수정과 24개 집중 검사, adapter/chart 합동 42개 검사, 구문 검사를 확인해 open finding 0건을 보고했다. 해당 reviewer 환경에 LSP 도구가 없어 최종 형식은 `COMMENT`였으며, LSP 검증을 수행했다고 주장하지 않는다.
- catalog 1·2의 고정 schema 정의 25개는 승인된 source 0.5 기준과 모두 일치했다. public keep-set은 88/88, placeholder·`test.skip`·`test.only`는 0건, 계약·runtime·extension 범위의 secret scan은 finding 0건이었다.
- 실제 로컬 Python metadata smoke가 통과했다. Chrome transport나 금융 조회를 포함하지 않으며 `financialQuery=false`, `externalAi=false`를 유지한다.
- backend 설정을 포함한 installer DryRun이 통과했고 `filesWritten=false`, `registryUpdated=false`를 확인했다. 실제 설치나 registry 변경은 하지 않았다.
- source `0.6.0`의 25파일 격리 extension package가 build와 정적 검사를 통과하고 stable extension identity를 유지했다. 현재 `extension/dist`는 바꾸지 않았다.

읽기 전용 보존 검사는 설치된 dist 20개 파일과 기존 비공개 기록 10개의 기준 hash가 모두 그대로임을 확인했다. task 파일은 0건이다. 최종 오프라인 감사는 캡처 6건, 관측 6건, verified receipt 4건을 오류 없이 읽고 `diagnostics=[]`, `legacyComplete=true`, `currentComplete=false`, `nonApplicableVerifiedReceiptCount=0`을 보고했다. training, LAYA, live guard 완료 플래그는 모두 false다.

## 설치·실제 Chrome 경계

25개 메뉴의 직접 브라우저 관찰은 24개 group/child 활성 상태와 빅데이터 top-active 상태 1개, modal 닫힘 25회를 확인했다. 이는 고정 catalog와 테스트 후조건의 설계 근거다. ATHENA 확장, Native task, receipt 또는 실제 데이터 정확성을 증명하지 않는다.

이번 source 검증 중 Computer Use는 Windows에서 현재 Chrome URL을 정책 적용에 충분한 신뢰도로 식별하지 못해 중단됐다. 클릭이나 입력은 발생하지 않았고, URL 확인 정책을 우회하거나 UI 실행을 다시 시도하지 않았다. 따라서 source 0.6의 실제 Chrome 메뉴 제어 증거는 없다.

설치된 0.3의 `차트 열고 주봉으로` 실제 Chrome 확인과 source 0.6의 설치·25개 메뉴 인수는 계속 남아 있다. 로컬 LAYA 후보 runtime을 추가로 설치하는 별도 승인도 아직 대기 중이며, 이 source slice가 그 승인을 대신하지 않는다.

## 제공하지 않는 기능

이 slice는 다음을 제공하지 않는다.

- 생성형 대화, 자유 형식 목표 계획 또는 LAYA 추론·재학습
- 실제 금융 query, 계좌 조회 또는 metadata에 적힌 operation 실행
- 실계좌 주문, 모의투자 주문 또는 자동매매
- 임의 CSS selector, JavaScript, shell, URL 또는 좌표 실행
- canvas 내부 시각 제어, cross-origin iframe 기사 동작 또는 별도 창 전체 제어
- 전체 WTS나 ATHENA 23개 기능 완료

전체 이식 완료 조건은 [ATHENA → Chrome 이식 인수 대장](migration-acceptance-ledger-20261019.md)에서 관리한다.
