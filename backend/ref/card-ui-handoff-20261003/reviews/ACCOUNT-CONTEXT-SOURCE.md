# 계좌 부분 미제공 안내와 가로 이동 안내: 독립 소스 검토

판정: **APPROVE — 정확 단일 파일의 소스 설치 범위**. 작성자와 별도 검토자가 동결 문서, 변경점, 실제 소비자 함수, 기존 CSS 및 mountBoard 호출 순서를 읽고 공개 합성 입력으로 재실행했다. 네이티브 개선 성공과 실제 템플릿 ID 확인은 승인 범위에 없다.

대상은 `account-context983-992-candidate/app/lib/board-mount.js` SHA256 `ec0da28041a2c93b96f914c1b72d758db10095070cccebc76b2fa5810d70edda` 하나다. 현재 제품의 원본 `app/lib/board-mount.js` SHA256 `b81a12d2d57efab1fb65af3cf6332baa3d7c07168bcc1738e5223b5578960b2c`가 설치 전 가드다. AUTHOR-FREEZE `9a26b72405208c820869a9c9935910e500a3d41f9269e1693b0f9ab0dd9c4b44`와 AUTHOR-PREPARATION `96ad7475968fd60fee9ec317f61a274f0c1f2d75c31896426a563d557f864d8a` 및 동결 파일 11개를 실제 바이트로 확인했다. 합성 chart main 또는 계좌 clarification 추가 변경을 승인하는 보고서가 아니다.

`updateAccountDetailSections`는 기존 missing 플래그와 대시/미제공 표시를 읽는다. 2SCE-1·133H-2에서 부분 누락이 있을 때 안내 하나를 표시하고 기존 전부 누락 접기와 수신 대기 구분을 보존한다. 숫자 0, 수신값, 표시값 노드, 슬롯 바인딩 및 API 호출을 변경하지 않는다. 안내가 있는 상태에서 부분 누락→전부 누락→0값 수신→누락 해소가 일어나도 안내를 중복 생성하지 않고 문구와 숨김을 갱신한다. 테이블, 다른 카드와 기존 내비게이션 보호를 유지한다. 미제공 값의 원인, 원래 요청의 페이로드 가용성, header 값을 상세에 복사할 근거를 증명하지 않는다.

가로 안내는 133H-2의 `14UQ-2`이면서 `bs-r-scroll-table`인 소유자 뒤에만 추가한다. 실제 제품 registry.boardHtml(133H-2)의 소유자 트레잇과 canonical board.html 전체 바이트 일치를 확인했다(HTML SHA256 `c0d1edbad865ceee5da3d81e13b0df4e1b25963e3cebf3ee95496e046f2896a8`). 133H-2는 rail 정리를 받지만 READABLE_TABLES 변환 대상은 아니다. 기존 relaxOverflowRows가 실제 clientWidth/scrollWidth로 안내 표시를 결정하며 같은 표면 폭에서도 안내 검사는 조기 반환 전에 실행한다. mountBoard는 실제 값을 적용한 뒤 이를 호출한다. 기존 CSS의 안내 기본 숨김/글자 크기를 재사용하고 열, 폭, 스크롤 위치와 값은 수정하지 않는다. 네이티브의 실제 템플릿 ID를 공개 reference ID로 대신하지 않는다.

검증 결과:

- terminal `117d11`, EXIT 0: 저자의 동결 소비자 검사 64 PASS를 검토자 출력 경로로 재실행했다. 실제 updateAccountDetailSections/applyResponsiveHooks/relaxOverflowRows 함수 몸체와 실제 제품 mountPlan을 실행한다. 무관한 geometry helper는 통제된 minimal DOM에서 no-op이므로 전체 브라우저 mount 검증으로 확대하지 않는다.
- 같은 실행: 검토자 추가 20 PASS. pending와 대시 혼합, 전부 누락 전환, 0값 수신, missing=false인 대시, 안내 유일성 및 같은 표면 폭에서 overflow 해소를 확인했다.
- terminal `3fc4ae`, EXIT 0: 실제 compiled owner, canonical HTML 일치, READABLE_TABLES 변환 제외 확인. 최신 git stage는 비어 있고 제품 git diff --check 진단은 없다.
- 단일 파일의 5개 치환을 역순으로 되돌리면 원본 전체 바이트가 정확히 복원된다. 원본 CRLF 127/단독 LF 3861, 후보 CRLF 131/단독 LF 3868이다. 광범위 EOL 정규화가 없다. node --check는 진단 없이 성공했다. 기본 no-index --check는 새 CRLF 7줄의 CR을 trailing whitespace로 표시했지만 `core.whitespace=cr-at-eol` 검사에서는 진단 0, 차이가 존재함을 뜻하는 EXIT 1이었다.

검토 중 실패도 보존한다. 첫 owner-check는 “applyReadableBoardLayout 함수 안에 133H-2 문자열이 없다”는 검토자 가정으로 실패했다(terminal `3d8215`). 실제 함수는 해당 rail 방향을 정리하므로 이 가정은 틀렸다. 제품 후보를 바꾸지 않고 실제 READABLE_TABLES 설정의 해당 항목 부재와 분기 구조를 검사하도록 검토 스크립트를 정정했다. 최종 공개 소비자 재현 결과가 위 승인 근거다.

검토자 산출물은 같은 ignored 폴더의 audit.cjs, AUDIT-RESULT.json, consumer-result.json, owner-check.cjs, PUBLIC-OWNER-RESULT.json이다. AUDIT-RESULT SHA256 `f57a260db911559766378eb61fda56e429efe0679ffbb8aab888f87a092ad9b9`.

제품 쓰기·stage·commit·앱 조작·네이티브 입력·provider 호출·network·private 읽기 0. 작성자의 983–992 원본 시각 판정을 새로 직접 승인한 보고서가 아니며 해당 후보의 네이티브 재검증은 NOT_RUN이다. 전체 94종, 모든 탭/펼침/정렬, 최대·축소 창의 전체 PASS를 주장하지 않는다. 설치 후 실제 계좌 카드의 최대→축소→가로 끝→하단→재최대화와 부분 미제공 안내 배치를 별도로 검증해야 한다.
