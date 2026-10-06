# GOAL-PLAN-20261004 독립 검토

## 2026-10-04 수정본 재검토

**APPROVE**

**Justification**: 초기 REJECT의 필수 수정 5건이 모두 실행 가능한 선행 게이트와 기계 판정 규칙으로 반영됐다. M1은 미해결 route를 허용하지 않고, 21개 모호 경로마다 고유 assertion을 요구하며, `15J9-2`는 최소 입력 또는 검증된 부모 이동을 확보하기 전 `NOT_RUN`으로 남긴다. additional flow는 실행 30개와 `protected-action` reference-only 1개로 분리됐다. M2는 디자인 참조 ID와 관측 runtime ID를 분리하고 ID 복사를 거절하며, runtime ID가 실제 UI에서 관측되지 않으면 null을 유지한 채 고유 route assertion만 허용한다. M0는 outer window를 크기 계약으로 고정하고 viewport와 전체 raster를 함께 요구한다. M2/M4의 `final_status`와 `freshness_status`가 분리되어 수정 뒤 stale PASS가 완료 수에 남지 않는다. native Paper 표면에서 수정 전후 101개 ID·부모 구조·편집 가능 여부 snapshot을 비교한다.

**Summary**:

- Clarity: Pass. 101=94+7 범위, 30+1 보조 흐름, route 선행조건, 크기 기준, Paper 표면이 구체적이다.
- Verifiability: Pass. 사람의 PASS 직접 입력을 금지하고 validator가 같은 카드, 3개 outer 크기, viewport, 전체 raster, 고유 route, source hash와 CURRENT freshness로만 PASS를 계산한다.
- Completeness: Pass. route 복구, native 실행, 수정·재검증, Paper 동기화, 독립 전수 검토, 테스트·보안·push까지 이어진다.
- Big Picture: Pass. 합성/public renderer는 회귀 증거로만 쓰며 native 94개 완료를 대체하지 않는다. 실제 주문 7개와 `protected-action`은 실행 큐에서 제외한다.
- Principle/Option Consistency (ralplan): Pass. fail-closed 데이터, 개인정보, 브랜치, 비실거래 경계가 일관된다.
- Alternatives Depth (ralplan): Pass. 실제 디스플레이·배율 또는 BrowserWindow 경로를 먼저 증명하고, 목표 outer 크기와 전체 raster를 달성하지 못하면 요구사항을 임의로 낮추지 않는다.
- Risk/Verification Rigor (ralplan): Pass. route 오귀속, ID 날조, 잘린 창, stale PASS, Paper 구조 손실을 각각 validator 또는 snapshot 비교로 차단한다.
- Deliberate Additions (if required): 해당 없음. deliberate ralplan으로 선언된 계획은 아니다.

대표 실행 재시뮬레이션에서도 `15J9-2`는 route 복구 전 M1을 통과할 수 없고, `2VDA-0`/`32XM-0`은 고유 assertion 없이는 증거를 귀속할 수 없으며, 일반 native 행은 2560x1392→1411x1166→2560x1392 outer 크기와 전체 raster·같은 카드 marker가 모두 있어야 PASS가 된다. 실제 runtime template ID가 보이지 않는 경우에도 디자인 ID를 발명하거나 복사하지 않고 null을 유지한다.

계획 승인과 현재 실행 환경 통과는 구분한다. native Paper 접근·편집 권한과 목표 logical outer 크기 전체 raster는 M0에서 실제로 입증해야 한다. 둘 중 하나라도 실패하면 목표는 ACTIVE이고 해당 조건은 차단 상태로 남으며, 디자인 개선 완료로 보고할 수 없다.

**Stop condition**: 이 계획으로 실행을 시작할 수 있다. 최종 종료는 M6의 Paper 101/101, native 앱 94/94, 열린 결함·REVALIDATE·외부 차단 0건, 전체 검사 green, 보안 `ALL_GATES_PASS`, 원격 동기화가 동시에 성립할 때뿐이다.

## 초기 검토 기록 — 수정 전 REJECT 보존

**REJECT**

**Justification**: 전체 범위, 증거 층위, 개인정보 경계, 실제 앱 94개를 fixture로 대체하지 않는 원칙은 명확하다. 그러나 현재 계획만으로는 실행자가 일부 상태의 고유 경로와 목표 창 크기 측정 방식을 추측해야 한다. 질문지 실측 결과는 `templates=101`, `in_scope=94`, `reference_only=7`, `observed_template_id` 비-null 0개, 현재 전체 responsive 완료 0개다. 또한 21개 항목의 첫 UI 이동에 복수 후보가 있고, `15J9-2`는 `prompt: null`, `ui_steps: []`인 채 과거 시각 참조만 남아 있다. M1이 이런 “확인 가능한 미해결 route”도 통과로 허용하므로 M3의 94개 실제 실행과 M6의 94/94 판정을 결정적으로 수행할 수 없다.

**Summary**:

- Clarity: 범위 101=94+7, 비실거래 경계, 같은 카드 리사이즈 순서, 증거 공개 제한은 명확하다. 상태별 고유 route와 크기 측정 기준은 불충분하다.
- Verifiability: 장부와 기계 계산 방향은 좋다. 다만 상태 enum에는 없는 `REVALIDATE`가 M4 완료 조건에 등장하고, 실제 창의 outer bounds와 renderer viewport 중 무엇을 2560x1392/1411x1166로 판정할지 정의되지 않았다.
- Completeness: Paper, native 앱, 회귀 검사, 독립 검토, 보안, push까지 포함한다. 물리 디스플레이는 2560x1440/2880x1800으로 확인됐지만 목표 logical window를 실제로 만들고 전체를 관측하는 경로와 route 해소 선행 단계가 빠졌다.
- Big Picture: 원래 계획과 `CURRENT-RESUME-20261003.md`의 미완료 범위를 정확히 이어받았고, 합성 18/44/30 상태나 제한 크기 월봉 관측을 native 94 완료로 올리지 않는다.
- Principle/Option Consistency (ralplan): Pass. 증거 층위, fail-closed 금융 데이터 원칙, main/LAYA 비변경 원칙이 일관된다.
- Alternatives Depth (ralplan): Fail. 물리 디스플레이 해상도는 충분하지만 2560x1392 logical window와 1411x1166 축소를 정확히 만드는 가용 경로가 아직 입증되지 않았고, 실패 시 대안은 “검증 환경으로 이동”으로만 제시되어 있다.
- Risk/Verification Rigor (ralplan): Fail. route 모호성, 크기 측정 정의, 재검증 상태 모델이 해결되지 않아 94/94 계산이 거짓 양성 또는 영구 정지로 갈 수 있다.
- Deliberate Additions (if required): 해당 없음. deliberate ralplan으로 선언된 계획은 아니다.

## 실행 전 필수 수정

1. **M1 통과 조건에서 미해결 route를 제거한다.** 94개 모두 `seed_or_route`가 실제로 실행 가능하고 상태를 고유하게 식별해야 M1을 통과하도록 바꾼다. 현재 21개 ambiguity 항목은 클릭 뒤 보이는 카드 종류, 탭/정렬 선택값, operation 결과 형태 또는 제품이 노출하는 runtime metadata 중 하나로 목표를 구분하는 assertion을 각 행에 넣는다. `15J9-2`는 별도 최소 입력 또는 검증된 부모 상태부터의 UI 이동을 먼저 확보한다. 확보 전 상태는 `NOT_RUN`이며 94/94에 포함하지 않는다. `additional_flows` 31개는 실행 범위 30개와 `reference_only`인 `protected-action` 1개로 나눠, line 85의 재사용 수를 30개로 고치고 제외 흐름이 native 실행 큐에 들어가지 않게 validator로 막는다.

2. **디자인 참조 ID와 런타임 ID를 스키마에서 분리하고 복사 방지 검사를 추가한다.** 장부에 `expected_design_reference_id`와 `observed_runtime_template_id`를 별도 필드로 두고, 질문지의 `template_id`/Paper ID를 runtime ID로 복사해 채우지 못하게 validator가 검사해야 한다. runtime ID가 null이면 `route_identity_assertions`가 상태를 고유하게 식별할 때만 route 근거로 허용한다. 현재 94개 `observed_template_id`가 모두 null인 사실을 M2 시작 receipt에 고정한다.

3. **목표 크기의 실행 가능 경로와 판정 대상을 M0에 확정한다.** 이전 native 관측 최대는 1920x1152였고, 이번 장비에는 2560x1440/2880x1800 물리 디스플레이가 있지만 2560x1392 logical window 달성은 아직 입증되지 않았다. 실제 디스플레이/배율 조합 또는 전체 창 raster와 입력 좌표를 보장하는 BrowserWindow 제어 중 사용할 하나를 M0 산출물로 지정한다. `window_outer_size`와 `renderer_viewport_size`를 모두 기록하고 어떤 값을 요구사항의 크기로 판정하는지 고정한다. 화면 밖으로 잘린 창이나 부분 캡처는 PASS로 인정하지 않는다. 정확한 목표 환경을 확보하지 못하면 크기 조건을 임의로 낮추지 말고 목표 계약 변경 여부를 요구사항 소유자에게 확인하는 차단 조건으로 남긴다.

4. **상태 머신을 일관되게 만든다.** M2의 enum에 M4가 사용하는 `REVALIDATE`를 추가하거나 `final_status`와 별도 `freshness_status`로 분리한다. PASS는 필수 크기 3단계, 같은 `card_instance_marker`, route 고유성, 해당 상태의 필수 영역/상호작용, 최종 source hash가 모두 채워졌을 때만 validator가 생성하도록 한다. 사람이 직접 `final_status: PASS`를 입력하는 방식은 금지한다.

5. **Paper 표면 선택을 실제 접근 증거로 고정한다.** 브라우저 Paper 로그인 실패를 전체 Paper 접근 실패로 일반화하지 않는다. 현재 열려 있는 native Paper 문서를 먼저 관측해 파일 ID, 편집 권한, 페이지/도면 수, 101개 참조를 읽을 수 있는지 확인하고, 읽기 가능한 표면 하나를 작업 표면으로 고정한다. 수정 전 101개 목록과 구조 snapshot, 수정 후 101개 대응 및 원본 보존 비교를 M1/M5의 기계 확인 산출물로 지정한다.

## 대표 실행 시뮬레이션

- `15J9-2`: 현 계획은 질문/이동이 없어 호출할 수 없고, 과거 도착 화면도 actual ID가 null이다. 위 1번 수정 전에는 M3가 시작돼도 이 행을 독립 재현할 수 없다.
- `2VDA-0`/`32XM-0`: 같은 “순위” 이동에서 복수 후보가 기록되어 있다. 클릭 후 실제 보드 ID가 보이지 않는 현재 계약에서는 카드 내용/operation 결과에 대한 고유 assertion이 없으면 두 행의 증거가 서로 바뀔 수 있다.
- 일반 native 행: 목표 outer/viewport 크기 정의와 전체 창 캡처 방법이 없으면 작은 데스크톱에서 2560x1392를 설정했다는 API 값만으로 오른쪽 끝과 하단을 실제 관측했다고 판단할 수 없다.

**Stop condition**: 위 5개가 계획에 반영되고, route 검증기가 94개 전부를 고유 실행 경로 또는 명시적 미완료로 판정하며, M0에서 목표 크기 두 개의 전체 창 관측이 실제로 입증될 때 실행 계획을 승인할 수 있다.
