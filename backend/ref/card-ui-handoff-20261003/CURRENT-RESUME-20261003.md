# 2026-10-03 카드 UI 재개 기록

상태: **코드 수정과 아래 범위의 검증 완료 / 원래 UI 목표 미완료**.

재개 기준은 UI 브랜치 `codex/card-ui-resume-20261003`의 `1c0e7e7eb01d24b32f8b4bda2be432b4db9b830c`이다. 기존 checkout의 미커밋 변경은 보존하고 별도 worktree에서 작업했다. LAYA 브랜치는 변경하거나 합치지 않았다. 이 기록은 최초 `PLAN.md`, `STATE.json`, 후보 보고서 및 과거 거절 기록을 대체 삭제하지 않는다.

원래 범위는 Paper 편집 가능한 101개 상태 보존, 실제 앱 94개 상태 검증, 실제 주문 7개 상태 제외다. 이번 결과를 94개 전체 통과로 집계하지 않는다. 독립 판단과 검증 한계는 [독립 검토](reviews/RESUME-20261003-INDEPENDENT.md)를 함께 읽는다.

## 적용한 변경

| 변경 | 현재 제품 적용 및 검사 범위 |
| --- | --- |
| 전체 단위 검사 복구 | 기존 테스트 15개 파일의 VM 의존성, 비동기 대기, 현재 단위 및 선언 계약을 수정했다. 이 복구에서 제품 코드는 변경하지 않았다. 실패 테스트를 skip하거나 삭제하지 않았다. |
| 날짜축 V3 | `app/lib/chart-card.js`가 로컬 `lightweight-charts-axis.mjs`를 사용한다. 승인된 upstream 5.2.1의 두 좌표 정렬 수정과 LICENSE/NOTICE를 설치했다. 실제 축 메서드를 실행하는 회귀 검사 2개를 추가했다. |
| 기업정보 가격 이력 | `app/styles/board-surface.css`의 좁은 화면 간격과 줄바꿈을 수정했다. 값과 다른 카드의 기하는 유지했다. |
| REST 상태 카드 | `renderRestStateCard`에만 `data-rest-state`를 부여해 높이·버튼 CSS를 제한했다. retry 버튼은 기존 버튼 클래스를 사용한다. 최초 넓은 selector는 독립 검토에서 거절되어 수정 후 다시 검증했다. |
| 공개 질문지 | 관측 978–996을 반영하고 호출 상태, UI 관측 범위, 증거 제외 사유를 정정했다. 실제 템플릿 ID를 모르는 행은 null을 유지했다. |

## 검증 결과

| 검사 | 실제 결과 | 해석 한계 |
| --- | --- | --- |
| 최초 전체 단위 검사 | tests 798 / pass 751 / fail 46 / cancelled 1 / skipped 0 / todo 0 | 기존 인계 결과를 재현했다. |
| 수정 후 전체 단위 검사 | tests 800 / pass 800 / fail 0 / cancelled 0 / skipped 0 / todo 0 | 새 날짜축 검사 2개 포함. 독립 검토자가 전체 suite를 다시 실행했다. |
| 날짜축 공개 렌더러 | 월봉·주봉 × 최대·축소·재최대 × 처음·중간·최근 = 18개 상태. 151개 tick, 경계 이탈 0, 겹침 0, 최소 인접 간격 34.375px | 실제 금융 제공자 입력이나 네이티브 pan 전체를 검증한 결과가 아니다. |
| 기업정보 공개 렌더러 | 30개 case, issues 0. 20개 좁은 화면 값 보존, 비대상 카드 기하 보존 | 공개 합성 입력이다. 이 관측기는 PNG를 생성하지 않는다. |
| REST 공개 렌더러 | baseline 44개 / candidate 44개 상태 및 각각 PNG 44개. baseline issues 88개, candidate 0개 | baseline은 버튼 크기 36, disabled 스타일 36, 과도한 높이 16개 문제다. |
| REST 비대상 회귀 | 44개 상태 × event/action/status = 실행별 132개 기하 표본. baseline/candidate 불일치 0, REST marker 누출 0 | 다른 카드의 기하와 marker 적용 범위 검사다. 실제 주문은 실행하지 않았다. |
| 소스 일치 | `verify-current-source.cjs`의 `CURRENT_SOURCE_EXTRACTION_PASS` | fixture consumer 및 CSS가 설치된 소스와 일치한다. |
| 실제 앱 월봉 카드 | 동일 카드 최대 1920×1152 → 축소 954×1057 → 재최대 1920×1152 관측. 날짜축·거래량 하단·하단 조작 영역 확인, 독립 이미지 검토 통과 | 목표 크기 2560×1392 → 1411×1166이 아니다. 실제 템플릿 ID 미확인. 94개 전체 또는 해당 카드 모든 기능의 통과가 아니다. |
| 질문지 검토 | JSON 의미 일치, HTML candidate/live 일치, 978–996의 범위·호출 상태 정정 독립 승인 | 질문지 HTML 픽셀 검증은 NOT_RUN이다. 과거 file 프로토콜 차단을 우회하지 않았다. |
| 공개 저장소 보안 게이트 | `eval-security-gates.ps1` exit 0, `ALL_GATES_PASS` | gitleaks, 공개 저장소의 secret scanning 및 push protection, 훅·prompt marker·tracked keepset·live env 검사를 통과했다. |

공개 렌더러는 네트워크·provider 호출·private profile 읽기·제품 소스 쓰기·렌더러 예외가 없는 범위에서 실행했다. 날짜축과 REST 실행의 소유 프로세스 종료 및 `sourceUnchanged`도 확인했다. REST 최초 넓은 selector 결과는 로컬 `archive-broad-selector/`에 보존했다.

실제 앱 관측은 새 차트 호출로 도착한 카드에서 수행했다. 실제 금융 화면 5장은 Git 밖의 로컬 Codex 시각화 출력에만 보관했다. 금융 값, 인증 정보, 사용자 프로필, 대화 DB 및 해당 이미지를 공개 증거에 포함하지 않았다. 이 관측은 최종 REST marker 수정의 실제 앱 검증으로 사용하지 않는다.

## 질문지 증거 정정

- 978–996의 19개 행에서 실제 템플릿 ID는 모두 null이다.
- 979·982는 지정 단위, 981은 하단 경계, 985·990은 마지막 열 관측 범위만 인정한다. 전체 카드나 마지막 행 통과로 넓히지 않는다.
- 993·994의 오래된 이미지는 UI 증거에서 제외하고 window 참조는 null로 유지한다.
- 994의 실패 호출은 유지한다. 995·996은 그 요청의 오류 화면 재관측이며 새 호출이 아니므로 `call_status: not_run`, 기본 차트 UI NOT_RUN이다.
- 과거 `REVIEW-RECEIPT.json`의 REQUEST_CHANGES 기록은 변경하지 않았다. 새 승인 범위는 `verification/questionnaire/STATUS.md`와 독립 검토에 별도로 기록했다.

## 재현 명령과 증거 위치

```powershell
npm --prefix app ci --no-audit --no-fund
npm --prefix app run test:unit
node backend/ref/card-ui-handoff-20261003/verification/rest-state/verify-current-source.cjs
powershell -NoProfile -File scripts/security/eval-security-gates.ps1
```

Electron renderer 실행 절차는 각 `verification/` 하위 README를 따른다. 저장소에 소스·fixture·요약을 보존하며, 아래 생성 결과는 ignored 로컬 출력이다. 새 checkout에는 자동으로 존재하지 않는다.

| 로컬 출력 | SHA-256 |
| --- | --- |
| `.omc/artifacts/card-ui-handoff-resume/date-axis/runs/candidate/report.json` | `5c64ca739e3c79cdd54b8a6950298b5ab09c56c3c82a090d6e2f0d969b2cbb25` |
| `verification/company/renderer-output/result.json` | `88fa287188501a1318f3f06f2d527971b1d21fc2b96243e293a93521db80aa0a` |
| `.omc/artifacts/card-ui-handoff-resume/rest-state/runs/baseline/report.json` | `6475745e753176e62fb17e12ed44938ae49c9aad65cfaff6441f72706f7a790d` |
| `.omc/artifacts/card-ui-handoff-resume/rest-state/runs/candidate/report.json` | `4ea5b9ce18ca307b54bf42bbb80dd73caf5c770c4f281a6aa1186b087f7d0e27` |
| `.omc/artifacts/card-ui-handoff-resume/rest-state/runs/workflow-regression.json` | `d61134b2f22ebe40340628f03fa63919089178ca1b113b3dfdca8bfeae3a40d4` |

기업정보 출력 경로는 이 문서가 있는 디렉터리를 기준으로 한다. `.omc/` 출력 경로는 저장소 루트 기준이다. 전체 단위 검사 원본 로그는 `.omc/artifacts/card-ui-resume-20261003/`의 `unit-baseline.log`, `unit-fixed.log`, `unit-final.log`에 있다. 최종 소스의 재실행도 800/800 통과했다. 보안 게이트 원본 로그는 같은 디렉터리의 `security-final.log`에 있다.

| 제품 파일 | 적용 후 SHA-256 |
| --- | --- |
| `app/canvas.js` | `ef2e0a1c78ef1727296449a4e0af1d32ef5dcdbdb488efda6d20f30f9173df02` |
| `app/canvas.css` | `c828898524af6024735b61969d7d097799a0e2848db9acb136087ed601fe98b5` |
| `app/styles/board-surface.css` | `856413d2284684385bab453cbc97a387f6e98500c14a9af09a5b83d1c784c1f6` |
| `app/lib/chart-card.js` | `5d8c46389c95950083b34d7626a722f409d815b822cf105059ef198983d46e38` |
| `app/lib/lightweight-charts-axis.mjs` | `7ae82ad415d76d0e4926ac34b7711931a35ba9f28572639a1a12230569beac48` |

## 남은 작업

1. **Paper 접근과 101개 상태 재확인.** 사용자는 로그인 준비를 알렸으나 도구에 연결된 Paper 브라우저에는 새로고침 후에도 Log in / Sign up 안내가 남았다. 연결된 로그인 위치를 확인해야 한다. 현재 Paper 원본 개수를 재검증하거나 Paper를 수정하지 않았다.
2. **실제 앱 94개 상태 검증.** 목표 크기의 같은 카드 최대화→축소→재최대화, 하단·마지막 열·탭·정렬·펼침 검증을 계속한다. 이번 실행에서 모든 조건을 충족한 94개 상태 완료 수는 0이다. 일부 월봉 관측 통과를 완료 수로 바꾸지 않는다.
3. **실제 설치 소스 검증.** 계좌·기업정보·REST 오류 카드 등 각 후보 적용 후 실제 제공자 결과와 상태 전환을 확인한다. 입력 데이터가 없거나 카드가 도착하지 않으면 UI NOT_RUN으로 기록한다.
4. **Paper 개선안 및 종합 판정.** 원본 101개 편집 도면을 보존하며 개선안을 별도로 작성하고 독립 검토를 받는다. 필요한 공개 결과만 UI 브랜치에 기록하며 main에는 자동 병합하지 않는다.

실제 앱은 정상 창 닫기 시 트레이에 남는 동작을 확인했다. 검증 중 사용한 앱 프로세스를 강제 종료하거나 사용자 프로필을 지우지 않았다. 다음 검증에서는 창·프로세스·캡처 handle을 새로 확인하고 최종 설치 소스를 새로 로드한다.
