# Goal verification ledger

이 디렉터리는 카드 UI 전체 완료 목표의 현재 검증 장부다. 과거 PASS, 합성 fixture, 제한 관측을 현재 완료로 승격하지 않는다.

## 범위와 ID

- `current.json`: Paper 101, native 94, native 제외 7, additional 실행 30과 제외 `protected-action` 1.
- `validate.mjs`: 정본 집합, 실제 artifact/source 결속, 집계와 허위 PASS를 검사한다.
- 정본: `backend/ref/card-ui-questionnaire.json`, `backend/ref/card-surface-templates/index.json`.

초기값은 Paper 0/101, native 0/94, additional 0/30이고 `additional_flows.total`은 31이다. `expected_design_reference_id`와 `observed_runtime_template_id`는 별도다. runtime ID는 실제 metadata artifact가 있을 때만 기록하며, 보이지 않으면 null과 고유 `route_identity_assertions`를 사용한다. 현재 종목 순위 21개는 `AMBIGUOUS`, `15J9-2`는 `MISSING`이다. `seed_or_route`, expected card kind, 이름, scope, route source, design control inventory는 질문지 정본과 매번 대조하며 수정할 수 없다. 새 실제 관측 경로는 별도 `observed_route`와 evidence에 기록한다.

## Evidence root

실제 화면과 금융 정보는 공개 저장소에 넣지 않는다. 검증 시 로컬 evidence root만 전달한다.

```powershell
node backend/ref/card-ui-handoff-20261003/verification/goal-ledger/validate.mjs --evidence-root <private-evidence-directory>
```

로컬 root의 `manifest.json`은 다음 필드를 가진다.

```json
{
  "schema_version": 1,
  "cohort_id": "opaque-source-cohort",
  "source_commit_sha": "40-character-product-source-commit",
  "product_source_closure": [
    {
      "repo_path": "app/product-file.js",
      "sha256": "64-character-sha256"
    }
  ],
  "artifacts": [{
    "id": "opaque-artifact-id",
    "relative_path": "relative-file",
    "sha256": "64-character-sha256",
    "kind": "full-window-raster",
    "mime_type": "image/png",
    "item_id": "137X-2",
    "session_id": "opaque-session",
    "source_cohort": "opaque-source-cohort",
    "stage": "max",
    "metadata": {
      "full_window": true,
      "clipped": false,
      "card_instance_marker": "opaque-card",
      "device_scale_factor": 1,
      "asserted_checks": ["top", "core_content"],
      "window_outer_size": {"width": 2560, "height": 1392},
      "renderer_viewport_size": {"width": 2544, "height": 1300},
      "pixel_size": {"width": 2560, "height": 1392}
    }
  }]
}
```

공개 장부에는 로컬 절대 경로를 저장하지 않는다. `PRIVATE` 참조는 manifest의 artifact ID, 실제 파일 SHA-256, item, session, cohort, stage, kind에 결속된다. `REPO` 참조는 `backend/ref/card-ui-handoff-20261003/` 아래 실제 파일과 SHA-256이 일치해야 한다. 장부와 validator는 자기 증거가 될 수 없다.

`REPO` evidence는 JSON 본문에 `kind`, 해당되는 `item_id`, `session_id`, `source_cohort`, `stage`, 그리고 `metadata`를 직접 기록한다. validator는 참조 객체의 주장 대신 이 실제 JSON 본문을 대조한다. 세부 검사용 JSON과 PRIVATE manifest entry의 `metadata.asserted_checks`/`metadata.asserted_controls`는 실제로 증명하는 key만 열거한다.

## PASS 계약

native 94와 additional 30은 다음을 모두 충족해야 한다.

- runtime commit은 manifest의 제품 source commit과 같고 현재 HEAD의 유효한 조상이어야 한다. manifest의 전체 `product_source_closure`가 그 commit의 Git blob 및 현재 제품 파일과 동일해야 한다. 장부·검토 같은 audit-only 후속 commit은 제품 closure를 바꾸지 않으면 허용한다.
- source cohort, session receipt, item, call receipt, route signature가 같은 실행에 결속된다.
- outer window `2560×1392 → 1411×1166 → 2560×1392`와 별도 renderer viewport를 실제 측정한다.
- 세 단계는 같은 card marker를 사용한다. full-window raster는 실제 PNG signature/IHDR 픽셀, `device_scale_factor`, outer 크기, viewport, 잘림 없음 metadata가 서로 일치해야 한다. 1×1 또는 이미지가 아닌 파일은 통과하지 않는다.
- 단계 check key, `bottom/final_row/final_column`, 7개 content-state key를 정확히 유지한다. 각 artifact는 `asserted_checks` 또는 `asserted_controls`로 자신이 증명하는 세부 항목을 명시한다. 하나의 artifact가 여러 항목을 명시하면 재사용할 수 있지만 generic artifact 한 개로 선언되지 않은 항목을 통과시킬 수 없다.
- 모든 예상 control은 관측 증거가 필요하다. 예상 control이 0개여도 근거 있는 `NOT_APPLICABLE_VERIFIED` receipt가 필요하다.
- `recorded_outcome=PASS`, `freshness_status=CURRENT`, 열린 bug 0이어야 한다.
- 작성자와 다른 검토자의 JSON receipt가 실제 파일/hash, 제품 source commit, cohort, manifest hash, 승인 item 집합에 결속돼야 한다. review receipt는 manifest 밖의 `REPO` evidence로 유지해 manifest가 review 자체를 포함하는 순환 hash를 만들지 않는다.

Paper PASS의 수정 전·수정 후 snapshot은 manifest에 파일 SHA-256이 결속된 `PRIVATE` JSON이어야 한다. 두 파일은 `athena.paper-originals-live-snapshot.v1` 형식의 완전한 101개 캡처여야 하며 `complete=true`, `selfCheckOne=false`, `incompleteFlags=[]`, 각 item의 `complete=true`, `editable=true`, `unresolvedFrontier=[]`를 요구한다. root는 `card-ui-paper-baseline.json`의 board/page/artboard 101개와 정확히 같아야 한다.

Validator는 snapshot이 적어 둔 `structureHash`를 신뢰하지 않는다. 각 item의 전체 canonical node 목록에서 root, child edge, 단일 parent, ancestor chain, 순회 순서, 연결성, node count를 확인하고 SHA-256을 다시 계산한다. 101개 item의 aggregate hash도 다시 계산하며, 검증된 수정 전·수정 후 canonical structure hash와 artboard ID가 모두 같아야 한다. 따라서 동일한 임의 문자열 두 개만 넣어 Paper 보존 PASS를 만들 수 없다. mapping receipt의 정확한 101개 ID와 Paper reference, 공개 `paper.items[].actual_paper_reference`, 별도 독립 review receipt도 같은 after artboard에 결속돼야 한다.

## 상태와 한계

- `final_status`: `PASS`, `FAIL`, `NOT_RUN`, `BLOCKED_EXTERNAL`
- `freshness_status`: `CURRENT`, `REVALIDATE`
- lifecycle: `M2_INITIAL`, `ACTIVE`, `COMPLETE_REVIEWED`

Validator는 파일 존재, 해시, Git source, schema, session/item/cohort 결속을 확인하는 일관성 검사기다. 호스트 발급 신뢰 기관이나 위조 불가능한 증명 시스템은 아니다. 유효한 파일을 함께 위조한 행위의 정직성까지 단독으로 증명하지 않으므로 최종 독립 검토는 필수다.

## 검증

`<private-evidence-directory>`는 해당 실행 cohort의 `manifest.json`이 있는 실제 로컬 디렉터리로 바꾼다. 현재 ACTIVE 장부에는 PRIVATE runtime identity 참조가 있으므로 이 인수를 생략하면 검증이 실패하는 것이 정상이다.

```powershell
node backend/ref/card-ui-handoff-20261003/verification/goal-ledger/validate.mjs --evidence-root <private-evidence-directory>
node backend/ref/card-ui-handoff-20261003/verification/goal-ledger/validate.mjs --evidence-root <private-evidence-directory> --self-test
```

정상 초기 결과는 Paper 101, native 94, excluded 7, additional 31=30+1, 현재 PASS 0/0/0, route gaps 21+1, `GOAL_COMPLETE=false`다. `--init`은 기존 `current.json`을 `--force` 없이 덮어쓰지 않는다.
