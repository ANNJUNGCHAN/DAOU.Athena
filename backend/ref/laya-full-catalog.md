# LAYA 전체 조회 카탈로그 선택

2026-10-07 현재 인증 런타임으로 포팅한 옵트인 기능이다.
원본 토너먼트 실험은 `644f156` 커밋에 보존되어 있다. 이 구현은 원본의
동적 criteria, 구형 LayaDecisionService 또는 8768 HTTP 서버를 복원하지 않는다.

## 설정과 호출 경계

`ATHENA_LAYA_CATALOG_ENABLED=false`가 기본값이다. 앱과 백엔드에서 명시적으로
활성화할 때만 사용하며, 이번 변경은 실행 환경·배포 파일·모델 가중치를 수정하지 않는다.
기존 CPU worker, runtime bearer token, deployment SHA 검증을 그대로 사용한다.

`POST /api/v1/laya/select-operation`은 로컬 bearer와 loopback 연결을 요구하며
LLM 공개 도구 목록에 노출하지 않는다. 입력은 `text`(1–4000자)와
`catalog_version`뿐이다. 호출자가 후보 목록·선택 지시문·스키마를 덮어쓸 수 없다.
이 API는 선택 후보만 반환한다. 도구 실행이나 주문 권한을 부여하지 않는다.

## 전체 범위와 수락 기준

대상은 현재 canonical `OperationCatalog.visible_for(QUERY)` 중
`generic_callable`인 모든 기능이다. 현재 266개(일반 조회 264개와 기존 읽기 전용
조건검색 2개: ka10171, ka10172)이며, detail projection 115개를 각각 포함한다.
주문, OAuth, 구독 등록용 websocket, 실행할 수 없는 분할 base는 포함하지 않는다.

선택 전에 배포에 고정된 `query_candidates`와 canonical 카탈로그의 버전을
확인하고, 전체 후보의 operation_ref·고유 candidate_id·name·kind·domain을 대조한다.
누락·중복·버전 또는 정체성 불일치가 있으면 모델을 호출하지 않고 폴백한다.
일부 후보만 평가하고 이를 전체 카탈로그 선택으로 보고하지 않는다.

현재 `query.operation_relevance` 고정 task로 최대 32개씩 순차 평가한다.
모델에 보내는 항목은 task_id, 배포 candidate_id, 원래 사용자 문장, 빈 context다.
instructions·criteria·후보 설명은 기존 런타임이 해시로 고정된 배포 계약에서 읽는다.
현재 266개를 모두 평가하면 9개 배치이며 question_count는 266이다.

모든 후보가 임계값을 통과하고, 정확히 하나가 relevant이며 나머지 전부가
not_relevant일 때만 선택한다. defer, 거절, 잘못된 응답, 후보 누락은 폴백한다.
force-choice 배포가 원래 defer를 강제로 다른 label로 바꾼
`defer_override`/`original_top_label=defer` 응답도 수락하지 않는다.
여러 relevant 또는 relevant가 없는 경우도 폴백한다.

이 기준은 과거 정방향·역방향 9개 묶음 토너먼트와 다르다. 여러 질문의
확률을 비교해 전체 순위를 만들지 않으며, 옛 알고리즘과 동일한 정확도나 속도를
주장하지 않는다. 실제 모델 품질과 전체 CPU 지연은 별도 평가 대상이다.

## 인자 계약과 폴백

수락한 candidate는 모델 출력으로 구성하지 않는다. 서버의 describe 결과와
현재 request model JSON Schema에서 필수·선택 속성, required, $defs를 가져오고
additionalProperties=false로 전달한다. 앱은 그 후보의 정확한 계약만 인자 추출기에
전달한 뒤 기존 selector dispatch가 원래 질문, 입력값, 계좌 범위를 다시 검증하게 한다.
기존 코드의 즉시 결정 경로는 유지한다. 실패하면 기존 3개 후보 분류 경로를 사용한다.
전체 카탈로그 선택 결과는 기존 3개 후보 fingerprint 캐시에 저장하지 않는다.

considered_count는 전체 대상 수, evaluated_count는 인식 가능한 label을 받은 수,
question_count는 시도한 개별 후보 평가 수다. 모델 거절도 label이 유효하면 평가 수에
포함하지만 선택을 수락하지 않는다. 전송 실패나 중간 제한 시간 초과의 부분 결과는
선택 후보로 반환하지 않는다.

## 제한 시간과 취소

백엔드 전체 평가 제한 시간은 `ATHENA_LAYA_CATALOG_TIMEOUT_SECONDS` 기본 5초
(0.1–15초)다. 모든 배치를 하나의 제한 시간으로 묶으며 동시에 한 전체 평가만
진행한다. 이미 평가 중이면 busy 폴백한다. timeout·잘못된 결과도 기존 분류 경로로
돌아간다. 호출자 취소는 삼키지 않고 런타임 요청에 전파한다.

앱의 전체 요청 제한 시간은 기본 5.5초이며 응답 JSON 읽기까지 포함한다. 백엔드에
더 긴 제한 시간을 설정하더라도 앱이 먼저 중단할 수 있다. 앱 signal/isCurrent와
백엔드 until_disconnect가 종료된 요청의 결과를 적용하지 않도록 유지한다.
기존 turn ticket·lease·generation 수명과 worker 취소 처리, CPU용 runtime timeout,
athena_search/resolve의 1.5초 의미 보완 제한 시간은 변경하지 않는다.

## 검증 범위

현 RuntimeClient를 통과하는 합성 응답으로 전체 범위, 32개 배치 경계,
유일 선택과 모호성, 강제 defer 거부, 후보 drift, 제한 시간·취소·busy,
로컬 인증, 정확한 인자 계약 및 앱의 원래 폴백을 검사한다.
합성 검사 통과는 실제 모델의 정답률이나 현재 설치 환경의 성능 측정이 아니다.
