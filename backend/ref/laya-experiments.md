# LAYA 실험 브랜치 통합 기록

`codex/laya-experiments-20261001`의 커밋 `41c8791`은 2026-10-01에 조회 후보 선택과 자연어 모의 백테스트를 분리해 보존한 실험이다. 2026-10-06 통합에서는 최신 LAYA 런타임을 유지하고 고유한 자연어 모의 백테스트 기능을 추가했다. 실험 작업 트리의 미커밋 전체 카탈로그 변경은 이번 커밋 통합에 포함하지 않고 그대로 보존했다.

## 통합 범위

| 경로 | 통합 결과 |
| --- | --- |
| 일반 요청 | 현재 ticket·lease 기반 LAYA API, CPU 런타임, 취소 처리와 문맥 축소를 유지한다. 구버전 후보 선택용 서비스와 전역 설정을 다시 활성화하지 않는다. |
| 자연어 전략 모의 실행 | 선택한 Codex/Claude가 판단 스키마를 작성하고 사용자가 검토한 뒤, 과거 봉을 순차 재생하는 별도 실험 UI·API·회계·테스트를 보존한다. 사용자가 명시적으로 시작하며 실제 주문은 실행하지 않는다. |

구버전 `laya/schemas.py`, `test_laya_decisions.py`, `selector-laya-routing.test.mjs`와 selector 후보 선택 확장은 현재 런타임 계약으로 대체되어 통합하지 않았다. 과거 `LayaDecisionService`와 `operation_selection` 인터페이스를 복원하면 현재 ticket 서비스와 API가 충돌한다. `ATHENA_LAYA_ENABLED`, `ATHENA_LAYA_BASE_URL`, 이전 confidence/circuit 설정도 현재 일반 요청 설정이 아니다. 기존 소스와 테스트는 실험 커밋에 남아 있다.

자연어 작성 프로세스의 빈 MCP 설정, 백테스트 엔진의 종가 판단 콜백, UI 스타일과 스크립트는 고유 기능의 의존 코드로 보존했다. 최신 카드 UI 스타일도 함께 유지한다.

## 실행 환경과 품질 한계

자연어 모의 백테스트의 `NaturalLayaClient`는 별도로 준비한 HTTP 루프백 서버 `http://127.0.0.1:8768`와 기존 multilingual 모델 계약을 사용한다. 일반 요청의 배포 manifest 기반 CPU 런타임(기본 8769)과 연결 규격이 다르며, 이번 병합으로 호환성을 추가하지 않았다. 사용자 프로필, 인증 정보, 대화 DB, 모델 파일과 설치 환경은 Git에 포함하지 않는다.

자연어 전략은 구조·입력 범위 검증을 통과해도 사용자의 조건 해석과 매 봉의 조건 준수를 보증하지 못한다. 기존 [평가 기록](natural-backtest.md)의 낮은 조건 정답률과 실패한 대조 전략을 보존한다. 실제 모델 평가나 학습을 이번 병합에서 실행하지 않는다. 과거 후보 선택 모델의 높은 선택 점수도 정답 보증으로 해석하지 않는다.

자연어 세션은 백엔드 메모리에만 있고 재시작하면 사라진다. 최대 512봉·8세션이며 순차 재생은 O(n²) 방식이다. 대규모 백테스트, 모델의 일반적 정확도, 수익성과 실시간 감시는 이 통합의 검증 범위가 아니다.

## 검증

원래 분리 시 Node 53개·Python 170개 통과 기록은 역사 기록이다. 통합 후 아래 명령은 현재 런타임과 보존한 자연어 기능의 입력 계약·취소·회계·표시 회귀를 검사한다. 테스트는 주입한 판단을 사용하며 실제 LAYA·CLI 호출이나 사용자 계좌 조회를 하지 않는다.

```powershell
node --test app/lib/backtest-natural-chart.test.mjs app/lib/backtest-natural.test.mjs app/lib/main/backtest-natural-bridge.test.mjs app/lib/main/claude-selector-worker-pool.test.mjs app/lib/main/laya-routing.test.mjs app/lib/main/natural-strategy-author.test.mjs

cd backend
.venv\Scripts\python.exe -m pytest verification/test_natural_api.py verification/test_natural_backtest.py verification/test_natural_laya.py verification/test_natural_schema.py -q
```
