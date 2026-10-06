# GOAL-LEDGER-20261004 독립 검토

## 2RBO-1 runtime identity 추가분 검토

**판정: SCOPED PASS — 두 번째 runtime identity 부분증거의 결속만 승인한다.**

검토 직후 고정한 SHA-256:

- `current.json`: `f4a7cad7ff64bcf91979870dea8f6620b6fa9076c103911b75e32a047b12a958`
- private `manifest.json`: `c2b3b7096d3db2040feea92edafdaaddc164a0888ddeb1e14ffeeb861a99af11`
- `goal-20261004-company-identity.json`: `03d034f90bfb3820fdb46a2deac0414ace607af50574a34a32aea9ca33879cc9`

manifest와 장부의 artifact 참조, 실제 identity 파일 해시가 일치한다. artifact는 `kind=runtime-metadata`, `item_id=2RBO-1`, session `native-quote-sequence-20261004-01`, cohort `card-ui-native-20261004`에 결속됐다.

비공개 metadata를 독립 대조한 결과 runtime ID `2RBO-1`, card ID `CC-03`, card kind `instrument`, `visible=true`, renderer viewport `1920×1152`, device scale factor `1.5`가 일치했다. `time_basis`는 2026-10-04 관측임을 밝히면서 정확한 wall-clock timestamp는 수집하지 않았고 파일 생성 시각을 관측 시각으로 주장하지 않는다고 명시한다.

identity 파일의 숫자 필드는 schema version, viewport, DPR뿐이며 금융값 필드·사용자 프로필·인증정보·비밀 패턴은 없다. manifest에는 identity JSON 두 개만 등록됐고 기존 screenshot 등록은 0개다.

현재 non-null runtime ID는 정확히 `2R3M-1`과 `2RBO-1` 두 건이다. 두 행 모두 질문지 정본 name/scope/card/seed route/design controls를 보존하며 `route_status=UNCONFIRMED`, `observed_route` empty, `call_status=NOT_RUN`, 세 resize 측정 null, `recorded_outcome=NOT_RUN`, `final_status=NOT_RUN`이다. 재실행한 validator는 `VALIDATION=PASS`, native PASS 0, `GOAL_COMPLETE=false`였다. self-test도 16/16을 통과했다.

이 판정은 실제 UI에서 읽은 identity 두 건의 부분 기록만 승인한다. 호출 성공, 고유 route, 목표 크기 동일 카드 순환, UI·콘텐츠 검사 또는 native 완료를 승인하지 않는다.

## 2R3M-1 runtime identity 부분증거 검토

**판정: SCOPED PASS — 실제 runtime identity 한 건의 결속만 승인한다.**

- 검토한 `current.json` SHA-256은 `832b81b61146f2cc708c838b9da0c44eeb67e3c7aea15490edbe90309ba31de6`이다.
- lifecycle은 `ACTIVE`이고 `2R3M-1` 한 행만 cohort/session/runtime identity PRIVATE 참조를 가진다.
- manifest에는 `goal-20261004-quote-identity` artifact 한 개만 등록되어 있으며 기존 PNG·JPG 등 실제 화면 파일은 등록되지 않았다.
- identity 파일의 실제 SHA-256 `0cc110aef559a2dcc48cafdd9c8014d17645917d7256a72e25d266f0d6ba1c2d`가 manifest와 장부 참조에 모두 일치한다.
- artifact `kind=runtime-metadata`, `item_id=2R3M-1`, session, cohort가 장부 행과 일치한다.
- 비공개 metadata의 runtime ID `2R3M-1`, card ID `CC-03`, card kind `instrument`, visible 상태, renderer viewport `1920×1152`, device scale factor `1.5`를 독립 대조했다.
- 질문지 정본의 name/scope/card kind/seed route/design controls는 변경되지 않았다. `route_status=UNCONFIRMED`이고 별도 `observed_route`도 비어 있다.
- `call_status=NOT_RUN`, max/narrow/remax 측정값 null, `recorded_outcome=NOT_RUN`, `final_status=NOT_RUN`이다.
- 전체 집계는 Paper 0/101, native PASS 0/94, additional PASS 0/30, `GOAL_COMPLETE=false`다.
- identity JSON의 key 범위에는 금융값·계좌값·사용자 프로필·인증 정보가 없고, 공개 장부에는 개인 절대 경로가 없다.
- 실제 evidence root로 실행한 validator와 self-test가 각각 exit 0이었으며 음성·양성 검사 16/16을 통과했다.

이 승인은 실제 앱의 runtime metadata에서 읽은 identity를 한 행에 부분 기록한 것이 정확하다는 뜻이다. 호출 성공, 고유 route 확정, 목표 크기 동일 카드 순환, UI 영역·상호작용, 독립 최종 검토 또는 native 완료 수를 승인하지 않는다.

## 최종 교정본 재검토

**판정: VALIDATOR-SCOPED PASS**

검토한 고정본:

- `validate.mjs`: `73c8c4fc776801f201598b591e8512e948bb6055651b2a718b1bf0a3ed7880d5`
- `current.json`: `1781b8896dd8f4ac878a2f6cf620ae8140a8e32a74e9ba4b2fa8f697fc62d0e2`

정상 초기 검증은 Paper 101, native 94, native 제외 7, additional 31=30+1, 현재 PASS 0, `GOAL_COMPLETE=false`를 유지했다. `--self-test`는 음성·양성 검사 16/16을 통과했다.

이전 반례도 별도로 다시 실행했다.

- `133H-2`의 card kind, seed/source route, control baseline을 바꾼 장부는 exit 1로 거절됐고 세 canonical drift 오류가 확인됐다.
- 기존 REPO JSON을 raster/evidence로 가장한 입력은 실제 JSON 본문의 item, session, cohort, stage 불일치로 exit 1이 됐다.
- generic subcheck 재사용은 artifact가 해당 `asserted_checks` 또는 `asserted_controls` key를 명시한 경우에만 허용된다.
- 이미지가 아닌 파일과 실제 1×1 PNG는 PNG signature/IHDR 실제 크기, device scale, outer 크기 결속에서 거절된다.
- 제품 source commit은 현재 HEAD와 같을 필요 없이 유효한 조상이면 되며, commit blob·manifest closure·현재 제품 파일이 모두 같은 경우 audit-only 후속 commit을 허용한다. 양성 검사 `allow-audit-descendant-commit`이 통과했다.
- independent review는 manifest artifact로 포함할 수 없고 별도 REPO JSON receipt로 manifest hash와 제품 source commit을 승인하므로 review-manifest 순환이 없다.
- Paper의 각 `actual_paper_reference`는 before/after snapshot과 mapping receipt의 동일 참조와 직접 비교된다.

현재 명시된 consistency validator 범위에서 남은 재현 가능한 false PASS 또는 audit-only false block은 없다. 이 승인은 **완료 원장의 스키마·파일/hash·정본·증거 결속 판정기**에 한정된다. 실제 Paper 101개 보존·개선이나 native 앱 94개 전체 사이클이 완료됐다는 뜻은 아니며, 현재 완료 수는 계속 0/101 및 0/94다.

## Schema 2 재검토

**판정: PARTIAL / REQUEST CHANGES — 이전 forged completion은 차단됐지만 정본 route 귀속과 최종 기록 workflow에 차단 결함이 남아 있다.**

직접 실행 결과:

```text
CANONICAL_COUNTS paper=101 native=94 excluded=7 additional_total=31 additional_in_scope=30 additional_excluded=1
CURRENT_COUNTS paper_confirmed=0 native_pass=0 additional_pass=0 route_ambiguous=21 route_missing=1
GOAL_COMPLETE=false
VALIDATION=PASS
NEGATIVE_FALSE_PASS_CHECKS=11/11
```

이전 검토의 전체 위조 입력을 다시 CLI로 전달한 결과는 `PREVIOUS_FORGERY_EXIT=1`, 오류 4,072줄이었다. 존재하지 않는 증거, 0 해시, 빈 필수 객체, 중복 route, 임의 freshness, 자기 검토 및 forged completion은 이제 거절된다. additional total도 31=30+1로 수정됐다.

다만 다음 네 항목은 완료 판정 전에 보완해야 한다.

1. **정본 route/card 계약이 장부와 대조되지 않는다.** `133H-2`의 `expected_card_kind`, seed, prompt, steps, route source를 모두 가짜 값으로 바꾸고 `control_inventory.design_expected=[]`로 맞춘 임시 장부가 `CANONICAL_ROUTE_DRIFT_EXIT=0`, `VALIDATION=PASS`였다. validator는 item ID 집합만 정본과 비교하고 각 행의 카드 종류·route·control·scope/name을 질문지 원본과 비교하지 않는다. 향후 가짜 route에 실제 증거를 붙이면 다른 상태를 검증하고도 해당 item을 PASS로 만들 수 있다.
2. **region/content/control 증거가 세부 검사 항목에 결속되지 않는다.** `checked()`와 개별 control 검사는 artifact의 item/session/cohort만 확인하고 `bottom`, `final_row`, `missing`, `error`, 특정 control 같은 subcheck key·kind·metadata를 확인하지 않는다. 같은 generic artifact 하나를 세 region과 7개 content-state에 반복 사용할 수 있다. manifest entry에 check key/control signature를 넣고 호출 지점의 기대값과 비교해야 한다.
3. **full raster의 실제 파일 형식과 픽셀 크기를 확인하지 않는다.** validator는 파일 바이트 해시와 manifest의 `pixel_size.width/height > 0` 자기 선언만 본다. README 예시는 목표 크기 raster를 요구하지만 1x1 또는 이미지가 아닌 파일도 metadata만 맞추면 raster 단계가 통과할 수 있다. PNG 등 허용 형식의 실제 header dimensions를 읽고, 기록한 device scale factor와 outer size에 맞는 전체 raster인지 확인해야 한다.
4. **완료 장부·검토 기록을 Git에 남기는 절차가 current HEAD 결속과 순환한다.** 모든 PASS 행과 review receipt가 현재 `HEAD`를 가리켜야 하는데, 완료된 `current.json`이나 독립 검토서를 commit하면 HEAD가 바뀌어 즉시 stale이 된다. PRIVATE review receipt는 자신의 hash가 들어간 manifest hash를 receipt 안에 요구하면 순환하고, REPO receipt도 commit하는 순간 reviewed HEAD가 바뀐다. 제품 source commit을 별도 immutable cohort commit으로 검증하고 audit-only ledger/review commit은 그 뒤에 기록할 수 있도록 해야 한다. 그렇지 않으면 최종 장부·독립 검토·clean remote sync를 동시에 만족할 수 없다.

추가로 Paper snapshot은 101개 대응을 검사하지만 각 `paper.items[].actual_paper_reference`는 snapshot/mapping과 비교하지 않는다. 행별 공개 대응 필드를 유지할 목적이라면 after/mapping의 reference와 같음을 검증해야 한다.

**Schema 2 승인 범위:** 초기 0건 장부, canonical ID 집합 101/94/7/30+1, 과거 PASS 비승격, enum·non-vacuous key, 실제 파일/hash/source/session/card/raster metadata 및 독립 검토 receipt의 기본 결속은 승인한다. 이는 실제 UI·Paper·금융 데이터 완료 증거가 아니라 validator 구현에 대한 제한적 판정이다.

**재검토 조건:** 위 1~4를 수정하고, canonical route drift 음성 검사와 subcheck evidence 재사용·1x1/non-image raster·audit commit sequencing 검사를 추가해야 한다. 그 후 정상 초기 장부, 11개 기존 음성 검사, 이전 forged completion 거부가 계속 유지되어야 한다.

검토일: 2026-10-04
기준: `7e69c995c5c04d3d0eac602e4d379d2e0ed35e99` 위 목표 원장 초안
범위: `verification/goal-ledger/current.json`, `README.md`, `validate.mjs`

## 판정

**FAIL — 초기값은 정직하지만 validator가 위조된 전체 완료를 허용한다.**

초기 장부는 정본의 Paper 101개, native 94개, native 제외 7개, additional flow 30개와 제외 1개를 정확히 나눈다. 과거 PASS를 승격하지 않고 Paper 0/101, native 0/94, additional 0/30으로 시작하며, 21개 모호 route와 `15J9-2` 누락 route, runtime ID null도 유지한다.

그러나 증거의 존재·내용·해시·현재 소스 귀속을 검사하지 않아 형식이 맞는 문자열과 빈 객체만으로 `GOAL_COMPLETE=true`를 만들 수 있다.

## 직접 증거

```powershell
node backend/ref/card-ui-handoff-20261003/verification/goal-ledger/validate.mjs
node backend/ref/card-ui-handoff-20261003/verification/goal-ledger/validate.mjs --self-test
```

정상 초기 결과는 canonical 101/94/7/30+1, current 0/0/0, ambiguous 21, missing 1, goal false였고 내장 음성 검사 3/3도 통과했다.

이어 현재 장부를 메모리에서만 복제해 모든 행에 다음 가짜 값을 넣은 임시 파일을 같은 validator로 검사했다.

- 존재하지 않는 evidence/report 경로와 source 경로
- 0으로만 된 commit SHA, source/raster hash
- 모든 상태에 동일한 route assertion과 card marker
- 목표 outer 크기를 측정값으로 단순 복사하고 viewport를 1x1로 기록
- resize checks, regions, content-state 필수 항목을 빈 객체로 교체
- observed controls를 빈 배열로 교체
- 존재하지 않는 독립 검토 report와 `reviewer_is_author=false`
- `recorded_outcome=NOT_RUN`, `freshness_status=STALE_BUT_ACCEPTED`
- 모든 Paper/native/additional status와 aggregate를 완료로 기입

```text
FORGED_EXIT=0
CURRENT_COUNTS paper_confirmed=101 native_pass=94 additional_pass=30 route_ambiguous=0 route_missing=0
GOAL_COMPLETE=true
VALIDATION=PASS
```

제품·Electron·Paper·provider·프로필은 이 공격 검사에서 접근하지 않았다.

## 차단 결함

1. `evidence_refs`, call/route/raster/Paper/review 증거가 실제로 존재하는지, 선언 SHA-256이 파일 바이트와 일치하는지 검사하지 않는다.
2. 임의의 40자리 SHA와 임의 repo path/64자리 해시가 통과한다. `source_cohort`는 판정에 쓰이지 않고 commit과 제품 파일의 현재 해시도 대조하지 않는다.
3. 빈 `checks`, 빈 `regions`, `{status:"CONFIRMED"}`뿐인 content inventory, 빈 observed controls가 공집합 `every()`로 통과한다. bottom/final row/final column, control, missing/error 등 필수 검사가 없어도 PASS다.
4. 전 행에 같은 route assertion과 증거를 넣어도 고유 route로 인정한다. assertion이 item ID, 카드 종류, 탭·정렬 또는 runtime metadata에 결합되지 않는다.
5. 같은 임의 card marker를 전 행에 재사용할 수 있고 `sha256:<64hex>` 문자열만으로 full raster를 인정한다. raster 존재·실제 픽셀 크기·동일 실행 receipt 귀속이 없다.
6. 디자인 ID의 정확한 복사 한 경우만 막는다. 다른 임의 runtime ID, 존재하지 않는 metadata 증거와 임의 capture hash는 통과할 수 있다.
7. `REVALIDATE` 외 임의 freshness가 허용되고 `recorded_outcome=NOT_RUN`도 PASS를 막지 않는다. lifecycle도 enum 검사가 없다.
8. 존재하지 않는 report와 `reviewer_is_author=false` 자기 선언만으로 독립 검토가 승인된다. 작성자·검토자, report hash, 검토 cohort가 없다.
9. 임의 Paper surface/page 문자열과 가짜 증거만으로 Paper 101개 PASS가 가능하다. 수정 전후 ID·부모 구조·편집 가능 snapshot을 읽지 않는다.
10. `makeAggregates()`에서 31이 `counts()`의 `total:30`으로 덮여 현재 `additional_flows.total`이 30이다. 집합은 30+1이지만 공개 aggregate가 틀렸다.

## 승인에 필요한 보완

1. 타입이 있는 evidence manifest를 쓰고 validator가 허용된 repo-relative receipt/report의 존재와 실제 SHA-256을 확인한다. 비공개 화면은 Git에 넣지 않되 최종 로컬 검증에서는 opaque artifact ID가 실제 저장물·해시·raster metadata에 해소되어야 한다.
2. runtime commit을 검증 대상 Git commit과 비교하고 source path가 저장소 안의 실제 파일인지와 파일 SHA-256 일치를 확인한다. PASS를 동일 source cohort 실행 receipt에 묶는다.
3. resize check key, `bottom/final_row/final_column`, 7개 content-state key를 정확히 요구한다. 예상 control 각각에 관측 또는 근거 있는 `NOT_APPLICABLE_VERIFIED`를 요구하고 빈 배열·빈 객체 통과를 막는다.
4. route assertion을 item ID와 관측 signature에 묶어 전체 장부에서 구분되는지 검사한다. 21개 ambiguity와 `15J9-2`는 각 해소 receipt가 없으면 미완료로 둔다.
5. 세 resize 단계의 marker·outer·viewport·raster를 한 session receipt에 결합하고 artifact hash·픽셀 크기·잘림 없음·상태 간 marker 오용을 검사한다.
6. freshness, recorded outcome, lifecycle, review status enum을 강제하고 PASS에는 `freshness_status=CURRENT`를 명시적으로 요구한다.
7. 작성자 ID, 검토자 ID, report 경로·해시, 검토한 commit/source/evidence cohort를 기록해 실제 독립 검토인지 확인한다.
8. Paper PASS는 수정 전후 snapshot receipt를 읽어 101개 ID·부모 구조·편집 가능 여부와 대응표를 검사한다.
9. additional total을 31로 계산하고 in-scope 30/excluded 1을 별도 유지한다.
10. self-test에 존재하지 않는 증거, 해시·commit 불일치, 빈 필수 객체, 중복 route, raster 불일치, 임의 freshness, 가짜/자기 검토, 전체 forged completion 거부를 추가한다.

## 재검토 조건

초기 수량·0건 상태·범위 분리는 승인한다. 완료 판정 계약은 승인하지 않는다. 위 보완 후 전체 forged-completion 검사가 비영 종료하고 정상 초기 장부가 계속 0/101·0/94·0/30 및 `GOAL_COMPLETE=false`로 통과할 때 재검토한다.
