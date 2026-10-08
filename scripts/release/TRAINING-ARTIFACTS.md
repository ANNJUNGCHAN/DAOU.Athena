# LAYA 학습 산출물 보존·공개 지침

앞으로 Athena의 모델과 학습 상태를 공개할 때 적용한다. **큰 파일은 GitHub Release에, 공개 가능한 작은 학습 기록은 Git에** 보관하고 서로 연결한다.
GitHub를 기본 공개 위치로 사용한다. 별도 요청 없이 Google Drive 등 외부 저장소에 백업을 만들지 않는다.

## 무엇을 어디에 보관하는가

| 자료 | 위치와 원칙 |
|---|---|
| 모델 weights, 추론에 필요한 config·tokenizer·policy·catalog·의존성·고지 묶음 | Release의 버전별 bundle. 실제 실행에 필요한 파일과 해시를 함께 제공한다. |
| 사용자가 보존·공개를 요청한 `trainer_state.pt` | Release의 별도 첨부. 앱 실행 필수 파일로 취급하지 않는다. |
| 학습 설정·실제 코드 커밋·환경·데이터 버전/분할/count/hash·평가·선택 근거 | 공개 검토한 작은 기록을 Git에 커밋한다. 예: `backend/ref/laya-training/<version>/<run-id>/`. |
| raw data·원본 로그·상세 내부 증거 | 원본을 그대로 보존한다. 공개 가능한 요약만 선별하며 원본 전체를 자동 업로드하지 않는다. |

동일 weights가 이미 bundle에 있으면 별도 weights 파일을 중복 첨부하지 않고 해당 bundle·내부 경로·SHA를 참조한다.
GitHub의 일반 Git 저장소는 100 MiB보다 큰 파일을 차단하므로 모델·대형 state를 커밋하지 않는다. [GitHub의 파일 크기 안내](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github)

## 작은 학습 기록이 연결해야 할 내용

각 run의 README 또는 manifest가 **모델 SHA ↔ run ↔ 실제 학습 코드 ↔ 데이터 버전·분할 ↔ 평가**를 연결하도록 작성한다.
기록을 만들기 위해 지금 확인한 HEAD를 과거 학습 코드 커밋인 것처럼 사용하지 않는다. 확인할 수 없는 값은 `unknown`과 확인 범위를 적는다.

| 항목 | 기록할 내용 |
|---|---|
| 모델·run | run ID, 부모/base 모델 SHA, best/latest/배포 모델의 구분, 선택 checkpoint SHA와 Release asset 링크 |
| 학습 코드 | 실제 사용한 repository·commit, 당시 미커밋 변경 여부와 확인 가능한 공개 코드 snapshot/hash |
| 설정·환경 | 학습 인수·config, seed, optimizer/scheduler, Python·SDK·프레임워크·장치, lock 또는 dependency 버전 |
| 데이터 | version, 각 train/validation/calibration/test split의 역할·행 수·파일 SHA, 전처리/선택 규칙과 source·family 식별 방식 |
| 진행 상태 | 완료 epoch/update, best 선택 시점과 마지막 저장 시점, 완료·중단 여부, 실제 남아 있는 weights/state |
| 평가·선택 | 평가 데이터 버전/SHA, 평가 코드·설정, 지표, 비교 기준, 모델 선택 및 보정/배포 정책 변경 근거 |
| 연결·한계 | 공개 기록과 Release tag/asset/전체 SHA의 연결, 누락 의존성, 실행하지 않은 검증과 재현 한계 |

새 데이터 학습인지 기존 run 재개인지, 기존 데이터 재사용·epoch·replay 범위를 같은 기록에 구분한다.
데이터 파일을 지우는 것으로 중복 학습을 방지하지 않는다. 공개 요약에 식별자·내용을 실을 수 없다면 안전한 집계와 해시를 쓰고 원본 근거는 따로 유지한다.
당시 기록과 나중에 수행한 복원·재평가 기록은 시점과 근거를 구분해 연결한다. 과거 평가 결과를 새 모델의 평가 결과로 바꾸어 적지 않는다.

## trainer state가 보장하는 범위

`trainer_state.pt`는 해당 trainer가 저장한 model·optimizer·scheduler·progress·RNG 상태다. 실제 저장 항목을 확인해 설명한다.
**이미 학습한 모든 데이터를 판별하는 중복 방지 원장이 아니다.** 노출 데이터와 재학습 정책은 run·데이터 기록으로 관리한다.
정확한 재개에는 state 외에도 실제 코드·데이터·base checkpoint·config·환경이 필요하다. 누락된 의존성을 복구 가능한 것처럼 설명하지 않는다.
완료한 epoch와 같은 인수로 재개하면 더 학습하지 않을 수 있다. 새 데이터 후속 학습과 중단 run 재개를 별도로 기록한다.
state의 바이트 복원 성공, 모델의 로드·추론 성공, optimizer 재개 성공, 모델 정확도 검증은 서로 다른 결과다.

## 큰 파일을 나누어 첨부할 때

Release의 **각 asset은 2 GiB 미만**이어야 한다. 분할이 필요하면 기본 part 크기는 **2,000,000,000 bytes**, 마지막 part는 나머지로 한다. [GitHub Release 제한](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)
순서대로 결합하면 원본 바이트가 되는 raw binary parts를 사용하고, 모델/version/run을 포함한 고유 prefix로 이름을 정한다.
단일 원본 파일의 첨부 세트에는 다음을 함께 제공한다.

- `.part01`, `.part02`, …: 순서가 명확한 원본 조각.
- `.manifest.json`: 원본 파일명·전체 bytes·SHA-256, 각 part의 순서·파일명·bytes·SHA-256, 대응 run/checkpoint 및 모델 SHA.
- `.README.md`: 목적, 필요한 파일, 복원 명령·추가 디스크 공간, 검증 범위와 재개 한계, 출처·이용조건.
- `.restore.py`: Python 표준 라이브러리만으로 결합·검증하며 pickle/PyTorch 객체를 실행하거나 로드하지 않는 도구.

복원 도구는 part 순서·크기·SHA와 전체 SHA를 모두 확인하고 기존 출력 파일을 덮어쓰지 않아야 한다.
검증 전에는 임시 파일에 쓰고, 성공한 완성 파일만 원자적으로 게시한다. 실패 시 임시 파일의 보존·정리 상태를 명확히 알려준다.
원본을 수정하지 않고 분할하며 원본·조각 해시를 확인한다. 공개 전에 **실제 전체 결합 1회와 복원 파일의 크기·SHA 검증**을 완료한다.
순서 오류·손상·기존 출력 보호도 확인한다. 이 검증을 학습 정확도나 실제 resume 검증으로 표시하지 않는다.

## 공개와 업로드 검증

공개 파일은 라이선스·재배포 조건·원저자·upstream revision·변경 고지를 확인한다. 필요한 고지 원문을 첨부하거나 bundle에 포함하고 관련 Release 고지를 연결한다.
모델 tensor 외의 직렬화 metadata, 설정·로그·README도 확인한다. 비밀·토큰·계정·대화 DB·사용자 프로필·로컬 사용자명·개인 절대경로를 공개하지 않는다.
공개를 위해 만든 요약/수정본은 보존한 원본과 구분하고 해시·출처를 연결한다. 원본 로그를 덮어쓰며 지우지 않는다.

1. 공개할 파일의 정확한 이름·크기·SHA와 대응 Git 기록을 고정하고, 복원·필요한 모델 검증 결과를 기록한다.
2. 사용자 요청 범위에서 Release에 업로드한다. 기존 asset이나 tag를 덮어쓰거나 이동하지 않고 새 버전 또는 새 이름을 사용한다. 기존 Release에 추가할 때도 이름 충돌을 피한다.
3. 업로드 후 원격 asset의 **크기와 digest**를 로컬 값과 대조한다. digest가 없으면 실제 내려받은 파일의 SHA를 확인한다. 업로드 명령 성공만으로 검증을 끝내지 않는다.
4. Git의 공개 기록에서 Release와 검증 결과를 찾을 수 있게 연결하고, 완료한 검증과 남은 한계를 설명한다.

`origin/main` push 전에는 기존 `powershell -File scripts/security/eval-security-gates.ps1`이 `ALL_GATES_PASS`를 출력해야 한다. `--no-verify`로 우회하지 않는다. [기존 보안 절차](../security/README.md)를 따른다.
공개 완료가 로컬 모델·데이터·원본 기록 삭제를 뜻하지 않는다. 공간 정리는 별도 지정한 범위로 다루며 자동 삭제하지 않는다.

## 실제 예: v0.1.5의 v018 block002

[Athena v0.1.5 Release](https://github.com/ANNJUNGCHAN/DAOU.Athena/releases/tag/v0.1.5)의 `Athena-LAYA-v018-cpu-bundle.zip`에 현재 weights가 있다.
추가 보존 요청을 받은 **단일 `trainer_state.pt`(3,861,546,610 B)**는 다음 5개 asset으로 첨부했다. 같은 weights를 별도 파일로 다시 첨부하지 않았다.

공통 prefix: `Athena-LAYA-v018-block002-trainer_state.pt`

| 접미사 | 내용 |
|---|---|
| `.part01` | 2,000,000,000 B |
| `.part02` | 1,861,546,610 B |
| `.manifest.json` | 원본·각 조각의 크기·SHA와 순서 |
| `.README.md` | 목적·출처·고지·복원법·당시 재개 한계 |
| `.restore.py` | 실행 없이 결합하고 해시를 확인하는 복원기 |

이 state는 epoch 1을 완료한 시점의 자료이며, 당시 CLI의 재개에 필요한 원래 B1 base weights는 과거 모델 정리에서 삭제됐다. state만으로 완전한 legacy resume를 보장하지 않는다.
정확한 당시 상태와 복원법은 [첨부 README](https://github.com/ANNJUNGCHAN/DAOU.Athena/releases/download/v0.1.5/Athena-LAYA-v018-block002-trainer_state.pt.README.md), 모델 구성은 [LAYA bundle 안내](LAYA.md)를 참조한다.
