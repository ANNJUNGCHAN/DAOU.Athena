# 계좌·차트 합성본 설치 사후 독립 검토

판정: **설치된 exact4 source APPROVE**. 기존 합성 소스 보고서 `655c2277dbd73f909e7bc085312ca2aac5d5d0b5626fd72e55c26c37f5febfd5`의 승인 핀과 실제 제품 바이트가 일치하고, 설치된 소스를 직접 읽는 실제 소비자 검사가 통과했다. 검토자 제품쓰기·앱·renderer·native·provider·network 실행은0이다. Native 검증은 **NOT_RUN**이며 검사 당시 소유 앱은 이전 source33을 로드한 상태라는 root receipt와 구분한다.

## 설치 확인

Fresh terminal `cf59c5` exit0에서 제품 핀과 root receipt 전체를 직접 확인했다.

| 제품 파일 | SHA256 |
| --- | --- |
| app/main.js | 0216ae705929ce60536125b50540bbc7c437872bf432f923a601dd2e27e02d27 |
| app/canvas.js | 4d91c637c5411c0d50adb1583261d3caf41e088452cbb98a35026674803e1940 |
| app/preload.js | bca098ca3afdf5b29f2d1b7ec2d92558f4566b4353e1539a5ae7c67f84f33be0 |
| app/lib/main/chart-remount.js | 603f12b898fcfa7b41b3e375d6ec36bc7fdf77a8030ace9df8b285f3f12e3e4c |

계좌 auxiliary3·회사 unit3·질문지2의 보존 핀8도 실제 실행 전/후 모두 일치했다. Git status는 요청한 branch에서 정확12파일의 변경이며 단계에 올린 파일은 없었다. 최종 terminal `3c7fe3` exit0의 staged diff 역시 비었고 `git diff --check` 진단도0이다. 사용자 global ignore 파일 permission warning은 이 scoped 출력에 영향을 주지 않았다.

Root의 `.omc/artifacts/card-ui-audit/chart-account-composed-v4/ROOT-INSTALL-RECEIPT.json` SHA는 `1ccbbd97d47db3de0ff2cd650c79305714fed3abc13a67ebb35c8132ddfa7e89`이다. 해당 receipt와 fresh 실제 제품 핀을 별도로 읽었다.

## 실제 제품 소비자 검증

독립 checker는 frozen 소비자의 assertion 본문을 보존하고 로더/구문검사 경로5개만 제품 경로로 바꾼다. 실제 focused 소비자는 제품 main·chart-remount를 직접 읽고, 생성된 renderer probe는 `app/canvas.js`에서 actual mountBoardPrimary를 추출한다. Accepted generation2 테스트도 제품 main을 직접 읽으며 syntax4는 제품 main/canvas/preload/helper를 직접 검사한다. Local source alias 복사본은 메타데이터/원본 대조용이고 제품 소비자의 main/canvas/helper 로더를 대신하지 않는다. `LOADER-CHANGES.json` 전체와 생성된 renderer source loader를 직접 검토했다.

계좌 검사는 수정한 테스트가 아닌 실제 제품 `app/lib/main/account-holdings-clarification.test.mjs`를 직접 실행한다. 해당 모듈은 설치된 main·selector·helper를 읽고 public 의존성만 사용한다. Artifact 출력은 ignored reviewer 폴더에만 쓴다.

기존 session58739를 끝까지 추적한 terminal `5bf694`가 전체 exit0이다. 실제 제품 chart 소비자/await4/원문9/account18의 네 child도 모두 exit0이다. 차트의 보호13·fresh authority·accepted generation2/body 복원/day request·cold 거부·V4 await/connectivity 경계를 유지하며 원문9는9PASS/0FAIL이다. 최종 `3c7fe3`에서 actual 계좌 출력 요약을 직접 읽었다: tests18/pass18/fail0/cancelled0/skipped0/todo0. 실제제품 syntax4도 checker에서 exit0이다.

수정 범위는 source loading과 syntax path뿐이며 테스트 assertion을 삭제·skip하거나 바꾸지 않았다. 설치4+보존8 실제 핀은 전후 일치했다. Node memory 소비자 성공을 provider나 native UI 성공으로 해석하지 않는다.

| 독립 증거 | SHA256 |
| --- | --- |
| audit.cjs | 73f7b437f731b2b5d65c27a5521a96679e6d5e60dfc883702e1094a9b3089d1d |
| AUDIT-RESULT.json | 568aa5864187fcfbf10ccc60252dcc9d54d2fde881844e14c671988bae71073f |
| LOADER-CHANGES.json | 51c93d98cd4ebef8a2d57c874ad08c2de672ec2269c5f465d9daa22f6b2a5069 |
| actual-installed-account-eighteen.txt | 078c0a1b7f38202890cdd012f6f7885581331c4cdf1f2e3f8da95133d0135727 |

승인은 설치 소스 사후 확인에 한정한다. Root의 source35 전체 핀과 정상 소유 앱 종료·부재·새 실행, 실제 native 차트/계좌 점검은 별도 절차이다. 날짜축8개 잔존 실패나 remote reload 오류 UI, 실제 template ID, readiness, 전체94개 카드 완료를 승인하지 않는다.
