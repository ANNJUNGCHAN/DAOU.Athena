# WTS 금융 조회 source 0.7 검증 기록

기준일: 2026-10-19

판정: **source 검증·package readiness·실제 설치·독립 post-install 보존 검사 통과, 사용자 Chrome 0.7 연결·화면 조사와 새 캡처 독립 검증 확인**. source 0.7.0 / 프로토콜 7의 구현 lane과 aggregate가 통과했고, 첫 설치 시도에서 발견한 ACL 결함을 fixture로 재현·수정·독립 검토한 뒤 재시도에 성공했다. 사용자는 Chrome에서 `0.7.0이고 연결·화면 조사 성공`이라고 확인했다. 새 로컬 캡처는 동일한 current/installed protocol 7 schema 검증과 기존 10개 baseline hash 보존 검사를 통과했다. metadata 검색, 자격증명과 Kiwoom live read 증거는 남아 있다.

## 구현 범위

source 0.7은 기존 화면 조사, 결정형 차트·시장 메뉴 제어, metadata 검색을 보존하고 별도 `wts-financial-read-v1` profile을 추가한다.

| 경계 | 현재 source 동작 |
|---|---|
| Chrome UI | trusted side panel에서 profile 상태·설정·삭제, 정본 조회 양식, 명시적 조회·취소·페이지·연속 조회, facts/table/compound/chart card를 다룬다. |
| Native Messaging | 자격증명 3개와 query 5개, 합계 8개 고정 method만 금융 경계에 공개한다. |
| 로컬 process | 기존 metadata child와 별도의 financial child를 필요할 때만 시작한다. financial child 시작·OAuth·query 동안 같은 Native port의 metadata와 화면 제어를 막지 않는다. |
| operation | current generic query 264개를 facts 114, table 114, compound 17, chart 19로 모두 매핑한다. 미지원 operation은 0개다. |
| form | 697개 string field를 전달한다. 609개는 direct string, 88개는 nullable string이며 omitted, explicit `null`, empty string을 구분한다. |
| 결과 | page당 최대 96 KiB, whole Native response 최대 128 KiB, retained result 최대 2 MiB를 적용한다. local page와 broker continuation을 분리하고 continuation은 명시적 클릭으로만 시작한다. |
| 자격증명 | Chrome의 transient masked input을 로컬로 전달하고, profile snapshot은 Windows CurrentUser DPAPI와 제한된 ACL로 보호한다. access token은 memory-only다. |
| reconnect | query와 mutation의 비밀이 아닌 ID·revision만 보존해 status를 한 번 조회한다. 결과가 없으면 unknown으로 남기며 credential이나 query payload를 자동 재전송하지 않는다. |

기존 metadata profile은 metadata-only로 유지된다. 금융 route는 fixed real/mock read-only TR·endpoint allowlist만 사용한다. 임의 URL, header, JavaScript, shell, selector 또는 executable string을 Chrome이 지정할 수 없다.

## 검증된 증거

| 범위 | 결과 | 이 결과가 증명하지 않는 것 |
|---|---|---|
| 프로토콜 contract | 30 tests 통과, financial wire·semantic binding과 pre-v7 기준선 보존을 독립 검토했다. | backend 실행, 설치, Chrome UI, live API |
| metadata → form carrier | 실제 local readonly backend부터 Native framing과 extension normalizer/form compiler까지 264 operation, 697 field, 264 Native round-trip을 확인했다. integration 1건과 source/control 17건을 독립 재실행했다. | 금융 query 실행, live Chrome |
| Native recovery | 최신 repair의 targeted 39 tests와 독립 검토가 통과했다. metadata/control continuity, shared deadline, pending marker latch, nonblocking owned-child stop을 검증했다. | 자격증명, Kiwoom network, Chrome |
| DPAPI vault | bounded commit·rollback·path/ACL/reparse·pending marker·unknown outcome 범위의 33 tests와 독립 검토가 통과했다. | 실제 사용자 key 저장 또는 live OAuth |
| local runtime aggregate | 최종 root run에서 160/160 통과했고 failure·cancelled·skipped·todo는 0이다. 앞선 상세 유실 실패의 원인은 확인되지 않았다. 이후 157건 full run 두 번과 최종 160건 run이 통과했다. | live Chrome |
| backend final freeze | 마지막 residual 3건 보수 뒤 targeted 51 tests와 Ruff·AST·diff가 통과했고 독립 재검토는 zero finding으로 승인됐다. | live API |
| financial aggregate | latest frozen backend/vault 기준 108/108 tests가 통과했다. 외부 Starlette/httpx deprecation warning 1건이 있었고 의존성 변경은 없었다. | 설치, user Chrome, live API |
| extension final freeze | 최신 UI generation/revision/journal과 scoped chart lifecycle 보수 뒤 281/281 tests와 `npm check`, 독립 최종 검토가 통과했다. | 설치, user Chrome, live WTS |
| isolated Chrome renderer | owned isolated headless Chrome에서 실제 built facts/table/compound card와 chart mount, wheel zoom, trusted three-move pan, resize, older-page prepend, destroy를 확인했다. | 사용자 Chrome, 로그인 WTS, Kiwoom data |
| upgrade helper | 첫 실제 시도에서 inherited child ACL rollback-snapshot 결함이 드러났다. 동일 조건을 fixture로 재현·수정했고 독립 검토와 재시도 설치가 통과했다. | 새 사용자 환경의 전체 release lifecycle |
| package·installation | 격리 stage build/check와 package readiness가 stage 48개, 참조 53개, vendor 18개와 digest closure를 확인했다. 실제 재시도는 extension 48개와 host 23개를 설치했고 installed Native hello와 독립 post-install 보존 검사를 통과했다. | credential-gated live read |
| 사용자 Chrome 0.7 | 사용자는 버전 0.7.0, 로컬 연결과 화면 조사 성공을 확인했다. 새 캡처는 2026-10-19 08:02:39 KST, 관측 1개, heading 1개, control 13개, child frame 0개, canvas 0개, `truncated=false`다. 파일 수는 10개에서 11개로 늘었고 기존 receipt 4건은 그대로다. | 캡처 자체의 확장 버전, 전체 WTS inventory, control action, metadata·금융 query |

현재 contract 30, local runtime 160, extension 281을 합친 JavaScript suite는 **471 tests**다. targeted subset은 이 합계에 다시 더하지 않는다. backend 최신 보수는 별도 Python targeted 51건이며 독립 승인됐다.

## 2026-10-19 실제 설치와 ACL 보수

package readiness 통과 뒤 첫 실제 host upgrade는 `contracts` 자식 항목이 상속한 ACL을 rollback snapshot으로 검증하는 단계에서 실패했다. upgrade helper는 host와 Native Messaging Registry를 이전 상태로 복원했고, extension도 기존 20개 파일의 hash set으로 복원했다.

이 실패는 source 0.7의 contract, backend, runtime, extension 및 격리 package 검증을 무효화하지 않았다. 실패 후 독립 보존 검사는 `extension/dist` 20개, host 18개, data 10개의 baseline digest와 Registry 32/64-bit 값을 모두 불변으로 확인했고 owned host·descendant process가 0개임을 확인했다. 실패 candidate와 security metadata도 보존됐다.

작성자는 같은 inherited child ACL 조건을 fixture에서 재현해 repair를 적용했고 독립 검토가 이를 승인했다. 재시도는 extension stage 48개와 host 23개(소스 19개·생성 control 4개)를 설치했다. 설치된 실제 Native subprocess의 `runtime.hello`는 protocol 7, runtime 0.7.0과 금융 capability를 확인했고 stderr 0·exit 0으로 끝났다.

독립 post-install 검사는 설치된 extension 48개가 stage와 정확히 일치하고 host 23개가 runtime 0.7.0임을 확인했다. 32/64-bit Registry는 모두 불변이며 유효했고 data 10개도 불변이었다. 이전 extension 20개와 host 18개 rollback backup은 payload가 정확히 일치하고 private ACL과 security metadata를 유지했다. owned process는 0개였다.

두 설치 시도와 post-install 검증 중 자격증명 입력, Kiwoom API 호출, Chrome reload 또는 WTS 실행은 없었다. 이후 사용자가 별도로 Chrome 확장을 새로고침하고 연결·화면 조사를 수행했다.

로컬 저장소에서 그 뒤 생성된 새 캡처를 확인했다. `capturedAt`은 2026-10-18T23:02:39.450Z(2026-10-19 08:02:39 KST)이고 관측 1개·heading 1개·control 13개·child frame 0개·canvas 0개·비절단 상태다. SHA-256은 `85C2CCDF7E5C403A27009B9CD1B2F4F12515713658D736E5A43E6A511292C329`다. 데이터 파일 수는 10개에서 11개로 늘었고 기존 receipt 4건은 바뀌지 않았다. 캡처에는 확장 버전 필드가 없어 0.7.0은 사용자 확인에 근거한다. 독립 검사는 동일한 current/installed protocol 7 schema의 `inventory.record`로 캡처가 유효하고 기존 10개 baseline hash가 모두 불변임을 확인했다. 이 한 캡처는 전체 WTS inventory나 control action, metadata·금융 query 증거가 아니다.

form carrier 증거는 [현재 integration artifact](../../../.omx/artifacts/wts-financial-form-carrier-integration-20261019.json)에 기록돼 있다. 구현 기준은 다음 승인 문서와 세 보정 문서다.

- [금융 조회 v7 계획](../../../.omx/plans/wts-financial-query-v7-20261019.md)
- [form carrier 보정](../../../.omx/plans/wts-financial-v7-form-carrier-amendment-20261019.md)
- [mutation commit 보정](../../../.omx/plans/wts-financial-v7-mutation-commit-amendment-20261019.md)
- [card renderer 보정](../../../.omx/plans/wts-financial-v7-card-renderer-amendment-20261019.md)

## 아직 열려 있는 인수 게이트

1. 현재 Chrome panel에서 비민감 metadata 검색, 기존 chart·시장 메뉴·metadata 회귀, credential-unconfigured 금융 readiness와 네 card UI를 확인한다. Chrome 내부 페이지 식별 정책 때문에 panel 동작은 사용자가 직접 수행해야 한다.
2. 사용자가 trusted side panel에 profile을 직접 설정한 뒤 real/mock 각각 token readiness, 공식 read 1건과 chart/read page 1건을 검증한다. 자격증명은 채팅에 보내지 않으며 이 단계 전에는 live Kiwoom 성공을 주장하지 않는다.

## 설치·제품 판정

- 설치된 host와 `extension/dist`는 0.7.0 / 프로토콜 7이다.
- 실제 사용자 Chrome의 최신 버전·연결 증거는 사용자 확인 기준 0.7.0 연결·화면 조사와 새 로컬 캡처다. 검증된 action receipt는 계속 0.2.0의 4건이다.
- 첫 0.7 설치 시도는 ACL 결함으로 rollback됐고 보존 검사를 통과했다. fixture repair와 독립 검토 뒤 재시도 설치와 post-install 검사가 통과했다.
- 설치 직후까지 기존 capture 6건, observation 6건, verified receipt 4건과 task 0건은 변경되지 않았다. 사용자 화면 조사 뒤 capture·observation은 각각 7건, 데이터 파일은 11개가 됐고 receipt 4건은 그대로다. 새 캡처 schema와 기존 10개 baseline hash의 독립 검사가 통과했다.
- 실제 자격증명 파일, access token, 계좌 데이터 또는 live Kiwoom 응답을 이 검증에 사용하지 않았다.
- source 0.7은 LAYA, 생성형 planner, 원격 AI fallback, 주문, websocket, Electron UI 또는 전체 ATHENA 이식을 완료하지 않는다.
- 전체 이식 판정은 계속 **0개 완료 / 화면 호출 1개 부분 / 22개 미완료**다.

따라서 이 문서는 source 구현·격리 package 검증, 실패 후 rollback된 첫 설치 시도, 보수 뒤 성공한 실제 설치·독립 post-install 검사, 사용자 확인 및 독립 검증된 새 화면 캡처를 구분한다. metadata·금융 UI 검증과 credential-gated live read가 끝나기 전에는 source 0.7을 제품 완료나 금융 조회 운영 증거로 승격하지 않는다.
