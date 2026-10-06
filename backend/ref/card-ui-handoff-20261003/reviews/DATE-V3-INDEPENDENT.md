# 날짜축 V3 독립 검토

판정: **APPROVE — 아래 정확한 4개 소스 파일의 독립 설치 범위. 공개 renderer fixture의 날짜축 18개 상태도 scoped PASS.** 실제 Athena provider 호출 성공, native 계좌/차트 표시, 전체 카드 94종 또는 Paper 101개 상태의 완료를 승인하는 보고서는 아니다.

검토자는 후보 저자와 다르며 제품 파일, 앱, renderer, provider, 네트워크를 실행하거나 수정하지 않았다. root가 순차 실행하고 정상 종료한 공개 fixture의 동결 결과를 독립 검증했다. 금융값이나 사적 화면 내용을 전사하지 않았다.

## 정확한 승인 파일

후보 루트는 `.omc/artifacts/card-ui-audit/chart-date-axis-public-v3/candidate/app/lib/`이다.

| 설치 대상 | SHA256 |
|---|---|
| `app/lib/chart-card.js` | `5d8c46389c95950083b34d7626a722f409d815b822cf105059ef198983d46e38` |
| `app/lib/lightweight-charts-axis.mjs` | `7ae82ad415d76d0e4926ac34b7711931a35ba9f28572639a1a12230569beac48` |
| `app/lib/lightweight-charts-axis.LICENSE.txt` | `70c9d5382506dd184465425c08a99ad9bd6d9ac1313c252968ba0b585e5ef823` |
| `app/lib/lightweight-charts-axis.NOTICE.txt` | `0113d041489a7d311dc241018d213f2b16f7977f6def008def32c77d0afbde30` |

LICENSE/NOTICE 이름은 실제 후보 디렉터리에서 확인했다. 이 표의 정확한 경로와 해시가 승인 범위다.

준비 manifest SHA256 `67f7db0fc973c2ccf1a0ea5cdba577c706cf3985785b00d1e5cff8075228df87`, AUTHOR-PREPARATION `f21edd5476b1d8d640b7311832cc857976c62d6b9d1c33f5cea95c4606878f9b`, EXECUTION-PROPOSAL `78202b8431cfb5ef7888c5719a463d5b1ca8bb3c54a212b646b48debc3d86cb2`를 읽었다. SOURCE-RECEIPT, 실제 실행 receipt, 실제 소비자 검사 코드와 결과도 읽었다.

## 소스 의미와 변경 범위

기존 `chart-card.js` SHA256 `42c7b6df0441260b47f8ccc3056b06893fe22f6631394c1984561a0ea999b084`에서 모듈 URL 한 곳만 저장소 내 `./lightweight-charts-axis.mjs`로 변경했다. fixLeftEdge/fixRightEdge 옵션이나 논리적 범위, 데이터, 글꼴을 바꾸지 않는다. 기존 chart-card 전체 바이트를 기준으로 해당 URL 한 번 치환한 결과와 후보 전체 바이트가 일치한다.

새 모듈은 실제 사용 중인 Lightweight Charts 5.2.1 배포 파일 SHA256 `1bb1ee79f9d4dd17261b53d930f7a8995748276f80e7ba0e24412b5068062f5f`에서 정확한 두 offset 127868, 128048의 `e.needAlignCoordinate?this.tg(t,e.coord,e.label):e.coord`를 `this.tg(t,e.coord,e.label)`로 변경한 파일이다. 기존 TimeAxisWidget Jn의 실제 Bm 그리기 경로에서 일반/굵은 라벨 모두 기존 tg 경계 정렬 함수를 사용한다. 캔버스 밖에 걸친 글자 중심만 내부로 이동하며, 원래 내부 라벨의 위치·문자·날짜·글꼴·순서·y 좌표는 보존한다. 기존 정렬이 필요한 라벨의 동작도 동일하다. 원본 tg 함수 자체는 byte 동일하다. 노드 모듈이나 전역 canvas 메서드를 수정하는 방식이 아니다.

원본 Apache LICENSE의 정확한 바이트를 유지하고 NOTICE에 수정과 출처를 기록한다. 저장소 안에 별도 배포 파일을 두므로 npm 재설치에 의해 변경이 없어지지 않는다. 향후 upstream 버전 갱신 시 이 두 수정의 유효성을 다시 검토해야 한다.

## 독립 실제 소비자 검사

독립 audit는 원본/후보 실제 모듈에 테스트 export 한 줄만 덧붙인 소비자 파일이 정확히 일치하는지 확인한 뒤 실제 Jn.prototype.Bm을 호출했다. 테스트는 정렬 수식을 별도로 구현한 stub을 사용하지 않는다. 제어된 measureText 캔버스 입력으로 양 경계, 내부 위치, 일반/굵은 라벨, 기존 needAlignCoordinate 경로를 검사한다. 원본의 경계 밖 라벨 2개가 후보에서는 0개이며 내부 라벨과 나머지 표시 속성은 그대로였다. 실제 소비자 PASS 결과 SHA256 `3565de704a127ababc34351103baa9584cfc3631196c5523e45c694ea3337614`.

저자의 소비자 코드를 재실행할 때 생성 파일과 결과 경로만 검토자 폴더로 변경하여 저자 동결 자료를 덮어쓰지 않았다. 준비 단계의 이전 offset 역변환 실패는 보존되어 있으며 최종 정확한 offset 역변환과 전체 바이트 대조로 해결됐음을 확인했다.

## 공개 renderer 및 픽셀 결과

root가 실행한 후보 PID21840의 실행 receipt, EXIT0 및 종료 후 absent=true를 읽었다. 후보 보고서 SHA256 `405b7f9072bb99febcd8791a20806d4cc18a004bf51ff2b748d2443a6f990760`. 새로운 후보 캡처 18개를 모두 직접 시각 확인했다. 월/주 × 최대 2560×1392·축소 1411×1166·재최대화 2560×1392 × 처음·중간·최신 범위이다. 날짜축 라벨은 모두 완전하게 보였고 겹침이 없었다.

실제 draw 측정값도 독립 재계산했다. mounted=true, 캔들 수 월193/주835, 실제 viewport와 PNG 크기, 비어 있지 않은 tick 목록, 캡처 SHA, 새 paint 순서, glyph의 경계 오차 0.5px 이하, 인접 라벨 간 겹침 없음이 모두 맞았다. 최소 라벨 간격은 34.05921052631584px였다. 18개 상태의 논리적 범위는 비교 기준과 모두 동일하므로 잘림을 없애기 위해 표시 범위를 바꾸지 않았다. issues/network/errors는 빈 배열, cleanup adapterSize=0, sourceUnchanged=true였다.

비교 기준은 **새 V3 baseline 실행이 아니라 기존 V2 baseline 18개 결과의 재사용**이다. 그 보고서 SHA256 `d20d19ff40fa4d685ff1ab4859c12b1e33161e754b3196f4f8fcc2748b91426d`를 확인했다. V2의 독립 결과는 baseline18 FAIL → V2 후보8 FAIL로 기록돼 있고, V3에서 남은 8개를 포함한 새18개 모두 날짜축 scoped PASS다. 기존 보고서를 덮어쓰거나 V2를 PASS로 재분류하지 않았다.

## 실행 경계와 재현 증거

V3의 run/browser/HTML wrapper 전체 바이트는 승인된 V2 실행 경로와 같다. 비영속 isolated session, 별도 공개 userData, contextIsolation/sandbox, nodeIntegration=false, 네트워크·새 창 차단, 기존 runs 디렉터리 재사용 거부, 실제 mount와 paint 검사, 정리와 종료 처리를 확인했다. 43개 snapshot, 15개 phase 파일, 13개 live source pin 모두 일치했다. 검토자는 새 renderer를 실행하지 않았다.

독립 `audit.cjs` SHA256 `a32585c15c32d79df6edbda51c8540e6c15e0bd470c0e1548446b8bd6efadd7b`; `AUDIT-RESULT.json` SHA256 `fcf0d6d7043eaccf7837d0cd431837fc4c944163bee108e541ce7a1bd3424e4d`. 동일 session64322의 최종 terminal008412 EXIT0에서 INTEGRITY_PASS, 실제 소비자 PASS, overlappingStates=[]를 확인했다. 후속 read-only session20743의 terminal4efcd8 EXIT0에서 해시, 43/15/13 개수 및 18개 범위 일치를 확인했다.

검토 시점 실제 제품 chart-card는 기존 42c7b6… 그대로이며 새 모듈/라이선스/NOTICE 3개 제품 파일은 존재하지 않았다. 따라서 위 승인은 root의 검토 후 정확한 4파일 설치를 허용하는 소스 승인이다. 설치 사후 해시/소비자 검증 및 실제 앱 새 runtime 검증은 별도 단계다. 공개 fixture는 실제 native Computer Use 입력·스크롤·provider 성공을 대신하지 않는다. 실제 카드 ID, 계좌의 금융값, 전체 footer/UI 또는 전체 94종 PASS를 주장하지 않는다.
