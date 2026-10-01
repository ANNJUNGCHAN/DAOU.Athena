# LAYA 실험 브랜치

`codex/laya-experiments-20261001`은 `ac4f858`을 기준으로, 기존 작업 디렉터리에 있던 LAYA 후보 선택과 자연어 모의 백테스트 변경을 분리한 브랜치다. 분리 과정에서 모델의 판단 방식을 바꾸거나 실험을 기본 활성화하지 않았다. 카드 UI 개선은 기준 커밋에 들어 있는 상태를 유지한다.

## 보존한 두 실험

| 실험 | 실행 경로 | 기본 상태와 경계 |
| --- | --- | --- |
| 조회 후보 선택 | 기존 selector의 여러 조회 후보 중 하나를 로컬 LAYA가 선택하고, CLI가 선택된 계약의 자유 입력값을 추출한다. | `ATHENA_LAYA_ENABLED` 기본 꺼짐. 불확실하거나 서버가 없으면 기존 CLI 경로로 돌아간다. 스키마·조회계획 검증은 유지한다. |
| 자연어 전략 모의 실행 | 선택한 Codex/Claude가 제한된 판단 스키마를 작성하고 사용자가 검토한 뒤, LAYA가 과거 봉의 행동 후보를 선택한다. | 별도의 자연어 화면에서 명시적으로 시작한다. 합성 예제 또는 이미 저장된 수정주가 일봉만 순차 재생한다. 실제 주문을 실행하지 않는다. |

분리 범위에는 두 경로의 소스·테스트·UI 연결과 문서가 들어 있다. 자연어 작성 프로세스의 빈 MCP 설정, selector 후보 설명의 `group_title_ko/group_title_en`, 기존 백테스트 엔진의 종가 판단 콜백도 실험의 의존 코드로 함께 보존했다. 공용 HTML에서는 자연어 스타일 한 줄과 스크립트 두 줄만 추가한다.

사용자 프로필, 인증 정보, 대화 데이터베이스, 모델 파일, 로컬 서버, 설치 런타임과 개인 검증 산출물은 이 브랜치에 포함하지 않는다. 일반 프로젝트 의존성을 별도로 설치한 개발 환경에서 사용한다. 조회 후보 실험을 켜려면 앱과 백엔드를 `ATHENA_LAYA_ENABLED=true`로 시작하고, 기존 로컬 LAYA 서버를 준비해야 한다. 기본 주소는 `http://127.0.0.1:8768`이며 루프백 HTTP 주소만 허용한다. 분리 작업 자체는 서버를 시작하거나 모델을 호출하지 않았다.

## 현재 품질 한계

이 코드는 실험 보존본이다. 현재 LAYA의 높은 선택 점수는 정답을 보장하지 않으며, 후보 문구와 순서에 민감한 오답이 관찰됐다. 프롬프트 분량 감소가 정확도 유지나 전체 응답 시간 개선을 입증한 것은 아니다. 자동 라우팅 기본값은 계속 꺼져 있다.

자연어 전략은 구조·입력 범위 검증을 통과해도 사용자의 조건 해석과 매 봉의 조건 준수를 보증하지 못한다. 기존 [자연어 백테스트 평가 기록](natural-backtest.md)은 낮은 조건 정답률과 실패한 대조 전략을 그대로 기록한다. 분리 시 문서가 참조하는 로컬 평가 파일의 존재는 확인했지만, 실제 모델 평가를 다시 실행하거나 기존 수치를 새 검증 결과로 취급하지 않았다. 해당 산출물은 공개 소스에 추가하지 않는다.

자연어 세션은 백엔드 메모리에만 있고 재시작하면 사라진다. 최대 512봉·8세션이며 순차 재생은 O(n²) 방식이다. 화면에서 내보낸 기록은 사용자가 별도로 보관한다. 대규모 백테스트, 모델의 일반적 정확도, 수익성, 실시간 시장 감시, 실제 주문 실행은 이 실험의 검증 결과가 아니다.

## 분리 검증

분리된 작업 트리에서 합성 입력을 사용하는 Node 테스트 53개와 Python 테스트 170개가 통과했다. 실제 LAYA·CLI 모델 호출이나 사용자 계좌 조회는 하지 않았다. 이 결과는 입력 계약·취소·모의 회계·표시 동작의 회귀 검증이며 모델의 의미 판단 정확도 승인이 아니다.

```powershell
node --test app/lib/backtest-natural-chart.test.mjs app/lib/backtest-natural.test.mjs app/lib/main/backtest-natural-bridge.test.mjs app/lib/main/claude-selector-worker-pool.test.mjs app/lib/main/laya-routing.test.mjs app/lib/main/natural-strategy-author.test.mjs app/lib/main/selector-laya-routing.test.mjs

cd backend
.venv\Scripts\python.exe -m pytest verification/test_laya_decisions.py verification/test_natural_api.py verification/test_natural_backtest.py verification/test_natural_laya.py verification/test_natural_schema.py -q
```
