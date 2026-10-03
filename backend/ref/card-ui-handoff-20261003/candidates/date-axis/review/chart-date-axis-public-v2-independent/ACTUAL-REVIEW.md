# 날짜축 V2 공개 renderer 결과 독립 검토

판정: **수집된 증거는 유효하며 후보 전체 UI는 FAIL**. V2의 후보 18개 상태 중 8개에 날짜 글자 경계 잘림이 남는다. 제품 날짜축 변경 설치를 승인하지 않는다. 앞선 source-entry 승인 `791e3be5d4dc8eb6d3c894141829b2c2b53772d9fc7ccf66430f2f810817b823`은 격리된 공개 renderer 증거 수집 승인으로 한정된다.

검토자는 `chart-date-axis-public-v2/runs/baseline` 및 `runs/candidate`의 원본 PNG 각 18개, 합계 36개를 모두 직접 열어 보았다. view_image의 original 옵션을 사용했으나 2560×1392 이미지는 도구 결과에서 2048×1114로 축소되었다. 따라서 세부 픽셀 수치 판정은 원본 PNG의 hash·헤더 크기와 renderer가 측정한 tick bounds를 같이 사용했다. 1411×1166 축소 창 PNG는 원래 크기로 확인했다. 공개 합성 데이터만 포함된 격리 fixture로서 사용자 실제 계좌·종목 입력 또는 네이티브 앱 성공을 의미하지 않는다.

독립 `actual-audit.cjs`는 두 원본 report.json을 읽고 모든 36개 PNG의 SHA256 및 실제 PNG 헤더 크기를 대응 capture와 대조했다. 각 run의 상태·capture 18개, 실제 mounted=true, 월 193/주 835개의 candle, 비어 있지 않은 tick, viewport 일치, max/remax 2560×1392와 narrow 1411×1166, capture의 새 paint 증가를 확인했다. 각 tick의 left < -0.5 또는 right > canvasWidth + 0.5를 독립적으로 계산하고 원본 issues 유무와 대조했다. terminal `4c9c87` EXIT 0: baseline 18개 실패, 후보 8개 실패. 두 보고서의 network/errors 빈 배열, cleanup.adapterSize=0, sourceUnchanged=true, productWrites/privateReads=0도 확인했다. root가 별도 실행한 프로세스 종료·absence 관측은 root 보고에 속하며 검토자가 프로세스를 실행하거나 종료하지 않았다.

후보의 잔존 실패:

- 월봉 middle의 max/narrow/remax: 왼쪽 첫 연도 `2019년`이 canvas 밖으로 나간다. max/remax left 약 -15.724, narrow 약 -16.846이다.
- 주봉 middle의 max/narrow/remax: 왼쪽 `2019년`이 canvas 밖으로 나간다. max/remax left 약 -17.252, narrow 약 -17.318이다.
- 주봉 latest의 max/remax: 왼쪽 `10월` left 약 -2.313으로 일부 경계 잘림이 남는다.

시각적으로도 middle의 첫 연도가 일부만 남는 모습은 baseline·candidate에서 동일하다. first 구간의 첫 연도와 월봉 latest 오른쪽 끝 연도는 후보에서 완전히 표시되는 개선이 보인다. 주봉 narrow/latest는 후보에서 오른쪽 날짜가 완전히 표시되고 bounds 기준 통과한다. 8개 잔존 실패를 제외한 10개 상태의 통과는 해당 날짜축 실측 범위에 한정된다. 최대와 재최대에서 같은 문제가 반복되므로 축소 창 하나의 통과로 전체를 승인할 수 없다.

계좌·회사 units, header·footer의 전체 품질이나 모든 카드 94종 및 101개 상태의 PASS를 이 결과로 확대하지 않는다. narrow 캡처는 상단 위치이며 전체 하단 UI 검증이 아니다. 자동 visible logical range 설정으로 first/middle/latest를 측정한 공개 fixture이므로 네이티브 computer use에서 사용자가 실제 pan한 검증과 구분한다. 제품 renderer/Paper/app/provider/network/private 조작 0. 보고서와 검토 스크립트만 ignored 폴더에 작성했다.

원본 결과 전체의 독립 projection과 36개 이미지 핀은 같은 폴더의 `ACTUAL-AUDIT-RESULT.json`에 보존된다. 후속 V3는 별도 소스·실제 결과로 평가해야 하며 V2에서 완전 해결됐다는 주장은 허용되지 않는다.
