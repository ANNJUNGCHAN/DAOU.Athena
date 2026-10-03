# 계좌78·차트 V4 합성본 독립 코드 검토

판정: **정확한 4파일 합성 소스 APPROVE**. 계좌의 기존 승인 기능을 보존한 상태에서 차트 V4 변경만 설치하는 범위이다. 작성자는 chart_renderer_resume, 독립 검토자는 account_candidate_review이다. 검토자의 제품·앱·renderer·native·provider·network 실행 및 변경은 0이다. 실제 native 차트/계좌 UI 검증은 **NOT_RUN**이다.

## 설치 승인 범위와 정확한 핀

후보 폴더 `.omc/artifacts/card-ui-audit/chart-account-composed-v4/`의 동결된 후보를 대상으로 한다.

| 설치 파일 | 승인 SHA256 |
| --- | --- |
| app/main.js | 0216ae705929ce60536125b50540bbc7c437872bf432f923a601dd2e27e02d27 |
| app/canvas.js | 4d91c637c5411c0d50adb1583261d3caf41e088452cbb98a35026674803e1940 |
| app/preload.js | bca098ca3afdf5b29f2d1b7ec2d92558f4566b4353e1539a5ae7c67f84f33be0 |
| app/lib/main/chart-remount.js | 603f12b898fcfa7b41b3e375d6ec36bc7fdf77a8030ace9df8b285f3f12e3e4c |

AUTHOR-FREEZE.json은 `68931ee68ccdb0e77421b76d13375b8b7d1c4205a4a304455020f2a040fced50`, AUTHOR-PREPARATION.md는 `fb0af8345d439891ed2357185af521ebd99fcd25c34fa792a5e3a71a6bdec1da`이다. 모든 frozen 파일을 검사한 뒤 reviewer 폴더로 복사했다. 독립 V4 소스 승인25866e와 계좌 source 승인470368/설치7b5b의 범위를 합성 코드의 새 핀으로 검증한 것이며, 이전 standalone main7b9803을 계좌 main 위에 덮는 승인이 아니다.

설치 전 원본 main은 계좌78 `78f680293c7cd53521f98f13269109b7dca5562f17c5bd85fdc4852e5778fc57`, canvas는 `a0cca491cabdc425d31d77f9739a18229ffd5d52ba8771b9dab0e46784dfc317`, preload는 `a862f8a79e6285f11093b199bd538aa639318aae787fb8ebd5f86d99cfd23ce5`이어야 한다. 새로운 chart-remount 제품 파일에 기존 작업이 있으면 덮지 말고 별도 대조해야 한다. 원본이 다르면 이 보고서의 자동 덮어쓰기 승인 범위가 아니다.

계좌 auxiliary3은 교체 범위가 아니다. selector `8559ee623b5fe178f74efd5ad6d48abbd90345c765a1f2fbf9739b29c6d6f5de`, helper `0f135119650095ce5a0bf3d799484539388f49649c019a6303fd774a5b71f014`, test `4d117be257ae7d97946d6b744b5e4e12978de70cb9376c0b5a4586deca406f11`을 그대로 유지한다. 설치된 회사 단위3과 질문지2는 후보 범위 밖이며 이 합성으로 변경되지 않는다.

## 합성 소스와 소유 경계 검토

계좌78 대비 전체 main diff와 실제 patcher를 읽었다. 변경은 차트 remount import/종료 정리, 기존 panel retire, paint owner/authority 검증과 기억, hydrate의 source envelope 기록, remount IPC, accepted reload의 generation/body 갱신이다. 계좌 요청 본문이나 abort 소유 보호를 수정한 hunk는 없다. 공유 emit 함수의 `paintOnly` 기본값은 false이고 remount에서만 true이므로 일반 계좌 전달을 생략하지 않는다.

V4 patcher와 합성 patcher의 차이는 읽을 원본 main 경로 하나뿐이다. 독립 VM에서 실제 patcher를 실행하되 파일 쓰기를 메모리 Map으로 대체하고, 생성한 main/canvas/preload 전체가 동결된 합성 후보와 일치함을 확인했다. 실제 제품 파일에 쓰지 않았다. canvas/preload/chart helper는 독립 승인된 V4와 바이트가 같다.

계좌의 실제 `runLiveQueryInnerBody` 전체와 `abortRuntimeWork` source slice는 승인된 설치 main78과 byte-exact이다. witness SHA는 각각 `492526d65254525ae86b10afe2f9efd8c81edeee93b044b6dd804b4a5ac562fb`, `8ff1c5db0f54385b1aaf4c8e9a0e69af7b845650e0df9b301646e801a5338ded`이다. 새 controller/pending account 보존, submit-only/current-context 경계와 graph/stock await 후 stale 보호가 유지된다. auxiliary3의 제품 핀도 fresh 확인했다.

차트는 V4의 await/연결성 보호를 유지한다. 특히 첫 remount IPC reject에 mountPoint 연결 검사를 포함한다. 늦은 mount/paint 성공·실패는 로컬 session/body만 정리하고 새 owner marker/상태를 덮지 않는다. 실제 accepted generation2/body 기억 뒤 자식 파괴와 부모 remount는 새 panel identity와 verified paint 권한으로 연결된다. Cold memory가 비어 있으면 복원 권한을 얻지 못한다.

원본 mixed EOL을 유지하며 main은 계좌 baseline CRLF6612/bareLF1856에서 후보 CRLF6602/bareLF1926이다. 원 offset patcher의 실제 생성 일치와 동결된 수치로 확인했다. main/canvas/preload no-index whitespace 검사는 exit1/진단0으로 통과했다. Exit1은 파일 차이를 뜻한다. 전체 파일 EOL 정규화나 이전 실패 three-way merge를 사용하지 않았다.

## 독립 실제 소비자 검증

Reviewer 복사본에서 합성 main을 읽는 actual chart 소비자, await4, 원문9, 계좌 실제 test module을 실행했다. 기존 session89758만 끝까지 추적해 terminal `ef727a`의 **전체 exit0**을 확인했다. 네 child 단계도 모두 exit0이었다.

- 실제 main IPC/authority 검사: 원본 missing-authority 실패 재현, 합성본의 fresh remount 권한, 13개 소유/paint 거부 검사, accepted week generation2/body → 자식 파괴 → 부모 fresh remount/day request, cold memory-clear 거부.
- 실제 renderer 함수 await4 및 V3에서 보존한 원문9: stale invoke/mount/paint 경계·로컬 정리·current-owner 실패 표시가 유지되며 원문9는 9PASS/0FAIL이다.
- 계좌 실제18 검사: 합성 candidate main과 정확 selector/helper를 읽고 public source 의존성으로 실행한다. 실제 후속 selector resolve와 명시적 선택, default 무추정/provider 보존, 대화·계좌·취소·stale controller/pending/await 보호를 함께 검사한다.

독립 검사에서 재생성한 chart AUTHOR-CHECKS와 AWAIT-BOUNDARIES는 동결 출력 핀과 일치했다. Syntax4도 actual chart checker에 포함되어 exit0이다. Fake provider/native 실행을 성공으로 계산하지 않는다. 실행 중 root의 native 캡처 보류 요청을 받은 뒤 새 shell을 시작하지 않았고, 이미 제출된 handle만 추적했다.

과거 실패 freezer의 TAP 출력 가정 오류는 author가 보존한 별도 역사이며 후보 코드를 수정해 숨긴 실패가 아니다. 본 판정은 frozen 소스와 reviewer 실제 실행 결과를 근거로 한다. 이전 V1/V2/V3 실패 보고와 V4 standalone 보고는 보존되어 있다.

## 실제 출력과 최종 원본 guard

Native 구간 보류가 해제된 뒤 terminal `1fd35f`에서 실제 계좌 출력 전체18행과 요약을 직접 읽었다: tests18/pass18/fail0/cancelled0/skipped0/todo0이다. 동일 검사 결과의 집계를 추정하거나 TAP 형식을 강제하지 않았다. AUDIT-RESULT.json도 전체 읽었다. 같은 fresh 검사의 제품 main/canvas/preload는 위 설치 baseline3 핀과 일치했고 chart-remount 제품 경로는 아직 존재하지 않았다. Staged diff는 비어 있다. 검토자 제품쓰기는 0이며 root는 이 승인본을 아직 설치하지 않은 상태로 확인했다.

| 독립 증거 | SHA256 |
| --- | --- |
| audit.cjs | ac0d9ec750ef5be3dbdce0f94ecc5a1694818995ee0821c0b5da3ccee83a10ea |
| AUDIT-RESULT.json | c83eee328ebe6baf4ea54a1c3ebdec7f3d084b062b9e19c1c2922de7a6eda609 |
| account-actual-eighteen.txt | c62fb3724d7de71e82beed97ebb9b1f0932f9a7763401da9f33573e400e08f18 |

## 승인 한계

승인은 위 exact4의 설치 가능한 합성 코드에 한정한다. 설치 후 정확 바이트와 변경 범위, 정상 소유 앱 재기동 및 실제 차트/계좌 UI 증거는 별도 확인해야 한다. 날짜축 endpoint clipping, 일반 remote reload 오류 노출, 실제 provider/native 결과, 숨은 template ID, readiness 및 전체94개 카드 완료를 승인하지 않는다. 공개 날짜축 fixture의 source entry 승인을 이 합성 코드가 실제 앱에서 렌더됐다는 증거로 사용하지 않는다.
