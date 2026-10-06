# 공개 날짜축 fixture v2 실행 진입점 독립 검토

판정: **정확히 동결된 v2 source entry APPROVE**. 작성자는 chart_renderer_resume, 독립 검토자는 account_candidate_review이다. 승인 범위는 root가 이 공개 fixture를 격리된 renderer 한 개씩 순서대로 실행해 증거를 수집하는 진입점이다. 제품 날짜축 수정 승인이나 실제 렌더 결과 통과 판정이 아니다. 검토자의 제품·앱·renderer·native·provider·network 실행 및 변경은 0이다. 실제 날짜축 렌더 결과는 **NOT_RUN**이다.

## 정확한 입력과 실행 범위

실행 폴더: `.omc/artifacts/card-ui-audit/chart-date-axis-public-v2/`.

| 파일 | SHA256 |
| --- | --- |
| PREPARED-MANIFEST.json | cba0a3e8cddbbb229fae378c9e6f2a1d388651962fae262d352961bf610cf588 |
| SOURCE-RECEIPT.json | 0131dcd0975c9d69e364a26574fbd5f3a97ce76f0932f200b822372e55cc5bdf |
| EXECUTION-PROPOSAL.md | d4a0f5dbb39451a4b14f8a88152b052f80ae8fa32ac9f6e9b61f287752ad1921 |
| run.cjs | 2570c11cc924ea322fd1fcba8343acdf3556acdfbe48a87c32c7f634868e07ee |
| browser.js | 528167a5d42f6a2803d8d0a8b66195d547f87eeb2b2fc630b24476daec58f5f8 |
| baseline.html | ac95e002ed7035d4414e7eac4967de7ec7a1b640f79b88b70306a9877059ec71 |
| candidate.html | b6997cb389bf64befa418ac81f827e3f160a3485429eecf3daa52cb8f864ea78 |

독립 검사에서 phase6개, snapshot42개, live source13개의 정확한 핀이 모두 일치했다. 이전 v1 폴더는 보존됐고, v2의 snapshot42개와 browser 관찰자/합성 입력은 v1과 같다. 창 상태만 최대2560×1392, 축소1411×1166, 재최대2560×1392로 보완했고 run은 고정1080이 아닌 `entry.height`를 사용한다. 월봉·주봉 × 세 창 상태 × latest/first/middle의 정확18개 상태를 확인했다. Proposal과 receipt는 이전 앱 종료 및 현재 root 소유 앱을 구분하며 이 fixture가 해당 앱을 조작하지 않음을 명시한다.

독립 검토는 원본/후보 wrapper 전체를 읽고, `contract.public.js`의 JSON 할당을 파싱한 뒤 두 wrapper에 복원해 실제 HTML과 정확히 일치함을 확인했다. 계약은 공개137X-2 참조이며 사용자 프로필이나 실시간 결과가 아니다. baseline/candidate에서 관찰자와 입력이 같고 실제 차이만 `chart-card.js` timeScale의 `fixLeftEdge:true`, `fixRightEdge:true` 두 옵션임을 완전한 소스 문자열 비교로 확인했다. `ensureEdgeTickMarksVisible`을 날짜축 개선으로 잘못 대입하지 않는다.

## 격리와 실행 수명 검토

`run.cjs`는 명시적인 baseline/candidate 모드만 허용한다. 기동 전 frozen phase/snapshot 바이트를 검사하고 기존 runs 모드 폴더가 있으면 덮어쓰기나 재시도를 거부한다. 별도 app 이름, runs 안의 공개 전용 userData, 실행마다 고유한 비영구 session partition을 사용한다. 일반 앱 profile·main IPC·backend/provider 연결이 없다.

BrowserWindow는 show:false/offscreen:true, sandbox:true, contextIsolation:true, nodeIntegration:false이다. 새 창을 거부하며 http/https/ws/wss 요청을 취소한다. 필요한 리소스는 동결된 로컬 HTML/snapshot에서 로드한다. 하드웨어 가속 비활성화는 해당 fixture app에만 적용되며 v6와 같은 소프트웨어 합성 조건이다. 이것이 일반 native 앱의 렌더 조건과 같다는 주장은 하지 않는다.

정상 완료는 fixture session/adapter 정리와 관찰자 복원 → 보고서/PNG 보존 → BrowserWindow.destroy → app.quit 순서이다. 실패는 run-error를 보존하고 창 정리/exit1을 수행한다. 원본 실행 결과와 실제 소유 PID의 exit·absence를 확인한 뒤 후보를 순차 실행한다는 proposal을 승인한다. UNKNOWN 상태에서 중복 기동하거나 이전 결과를 덮어쓰는 방식은 승인 범위에 없다. 검토 시 v2 runs 폴더는 존재하지 않았다.

## 실제 마운트 및 측정 경로

Browser source는 실제 BoardMount.mountBoard → collapsePrimaryMockup → createAitsChartPanelAdapter.openPanel → ChartCard.createChartCard → snapshot의 vendored lightweight-charts5.2.1을 사용한다. 원본/후보 모두 동일한 공개 결정적 OHLCV를 생성한다. 이전 v6 요약 fixture의 UNMOUNTED 결과를 날짜축 성공 근거로 재사용하지 않는다.

측정 전 실제 chart root/날짜축 canvas, 비어 있지 않은 candles 및 실제 date tick draw가 필요하다. 하나라도 없으면 issues에 명시된다. Canvas fillText를 관찰하면서 실제 measureText 경계와 transform을 사용하고, 현재 canvas bitmap 크기 및 마지막 draw frame에 맞는 관측만 평가한다. 숫자/날짜 라벨을 교체하거나 숨기지 않는다. 유효하지 않은 경계와 좌우 canvas 이탈을 오류로 기록한다. 각 상태는 실제 viewport, axis canvas 크기, tick 경계, visible logical range, chart body 크기 및 fresh PNG를 남긴다.

이 source 승인은 관찰 설계와 실행 진입점에 대한 것이다. run의 프로세스 exit0이나 issues 배열만으로 UI PASS를 선언해서는 안 된다. Root는 실제18개 상태의 candles/axis/ticks/viewport/소스 불변/정리 결과 및 fresh PNG를 검토하고, first·middle·latest logical range가 요청한 구간에 접근하는지도 확인해야 한다. 특히 fixed-edge 옵션이 팬 범위에 영향을 주므로 중간/과거 접근 제한은 실패로 판단한다. 실제 native 카드와 공개 fixture 사이의 배치·합성 조건 차이도 구분한다.

## 독립 검증 결과와 제한

독립 `audit.cjs`는 정확한 핀, 이전 snapshot/observer 동일성, 새18개 크기, HTML 복원, 두 옵션만의 후보 차이, 격리 및 anti-UNMOUNTED 조건, run/browser/prepare의 node syntax, 실행 폴더 부재를 검사했다. Terminal `c1e4b9`가 **exit0**으로 완료됐다. 이 검사는 Electron을 require하거나 실행하지 않았고, browser 코드를 실제 렌더러에서 실행하지도 않았다.

원본 fixture entry/proposal/browser/prepare 및 v2 wrapper/entry/receipt를 모두 읽었다. v2 builder 파일명을 처음 `build-v2.cjs`로 추정한 읽기는 파일 부재였으며 실행되지 않았다. 이후 실제 동결 prepare와 source receipt 및 독립 바이트 검사를 근거로 판정했다. 해당 경로 읽기 오류를 후보 코드 결함이나 렌더 성공으로 취급하지 않았다.

제품 `chart-card.js`나 설치된 account78/회사 unit 코드는 이 검토에서 바뀌지 않았다. 날짜축 수정 제품 적용, chart/account 합성본, 원시 remote reload 오류 UI, 실제 provider/native 결과, 숨은 template ID, readiness 및 전체94개 카드 완료는 본 승인에 포함되지 않는다. 공개 렌더의 실제 결과를 수령한 뒤 별도의 결과 검토가 필요하다.
