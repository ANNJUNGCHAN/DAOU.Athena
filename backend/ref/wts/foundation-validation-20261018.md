# 2026-10-18 WTS 기반 검증 기록

## 현재 결과

로그인된 WTS의 53개 사이트맵 진입 항목과 별도 창·주요 보조 화면을 조사했다. Chrome MV3 확장 프로그램, 엄격한 공통 메시지 계약, 사용자 PC의 Native Messaging 호스트 소스를 구현했다. **대화에 의한 WTS 제어와 LAYA 연결/재학습은 아직 구현하지 않았다.** 실행기 응답에서도 해당 기능은 `false`다.

## 구현 위치

| 위치 | 구현한 기능 |
| --- | --- |
| `contracts/` | canonical JSON schema, 요청/응답/관찰 검증, 128 KiB 제한 |
| `extension/src/` | 한국어 Side Panel, WTS 탭 결합, DOM 구조 수집, native bridge, 보류 캡처 재시도 |
| `local-runtime/src/` | stdio framing, 호출 확장 ID 검증, 원자적 로컬 캡처 저장, 요약 |
| `local-runtime/scripts/` | 현재 Windows 사용자 설치/제거, 소유권 검사, 데이터를 보존하는 제거, 비변경 dry-run |
| `backend/ref/wts/` | 실제 UI 조사 목록과 제약·후속 실행 기준 |

확장 ID는 `mhbcjkjmgabekcakpilhgkgeedhkjfee`, native host 이름은 `com.athena.wts`다. 빌드에 필요한 외부 패키지를 추가하지 않았다. 생성한 `extension/dist/`와 사용자별 캡처 데이터는 Git에 올리는 소스가 아니다.

## 검증 수준

- 최종 테스트 **44/44 통과**: 공통 계약 11, 확장 14, 로컬 실행기/설치 19. skipped/todo는 0이다. 확장 빌드·정적 검사와 `git diff --check`도 통과했다. Node 호스트 프로세스를 실제로 실행하는 stdio·저장·재시작 테스트를 포함한다.
- 계좌번호 형식 가림, 인증 프레임 제외, 표 행/입력값 미수집, 잘못된 origin/프로토콜/크기 거부를 검사했다. 이것은 알려진 경로와 테스트 사례에 대한 검증이며 임의의 모든 웹 텍스트에서 개인정보가 사라진다는 보증은 아니다.
- 독립 리뷰에서 발견한 coalesced frame 오류, 부분 저장/재시도 중복, dry-run 덮어쓰기, 임시 파일 잔류 등을 수정했다. 같은 ID를 동시에 저장할 때 기존 캡처를 덮어쓰지 않고, 저장 도중 중단된 임시 파일을 완료 캡처로 세지 않는다. 호스트 종료 때 패널의 연결 상태도 갱신한다.
- Chrome 서비스 워커에서 허용되지 않는 최상위 `await`를 제거했다. canonical JSON에서 정적 ES 모듈을 생성해 동기 import하고, 네트워크 초기화 없이 이벤트 리스너가 등록되는지 검사한다. [Chromium 서비스 워커 모듈 로더](https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/modules/service_worker/service_worker_module_tree_client.cc), [Chrome의 동기 리스너 등록 지침](https://developer.chrome.com/docs/extensions/develop/migrate/to-service-workers#register-listeners-synchronously)을 확인했다.
- contracts, extension, local-runtime, 조사 문서에 gitleaks 디렉터리 검사를 실행해 통과했다. 확장 manifest의 공개 SPKI 키에는 **정확한 두 manifest 경로와 정확한 공개키 값 모두가 일치하는 경우에만** 예외를 추가했다. 긴 숫자 가림 회귀 테스트의 합성값에도 해당 테스트 파일과 scanner가 추출한 정확한 값만 허용했다. 비밀키를 저장하거나 일반 자격증명 검사를 끄지 않았다.
- Git commit/push, 원격 배포, LAYA 학습은 실행하지 않았다. 공개 저장소 전체 배포 게이트 통과나 Chrome 실사용 검증을 주장하지 않는다.

## 현재 PC 설치 결과

현재 Windows 사용자에 로컬 호스트를 설치했다. 첫 실제 설치에서 RegistryKey가 쓰기 불가능하게 열리는 문제를 발견해 Registry provider의 `Set-Item`과 정확한 재조회로 수정하고, 임시 HKCU 키에 대한 회귀 테스트를 추가했다. 실패한 시도에서 만든 값/하위 키가 없는 정확한 빈 키만 확인 후 정리했으며 기존 다른 등록을 변경하지 않았다.

- 설치: `%LOCALAPPDATA%\Athena\WtsNativeHost`
- 데이터: `%LOCALAPPDATA%\Athena\WtsData`
- 레지스트리: `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.athena.wts`의 기본값이 설치된 manifest 경로와 일치한다.
- 설치된 runtime/contract 소스 8개 SHA-256이 검토한 작업 트리 소스와 일치한다.
- 설치된 `.cmd` launcher에 framed `runtime.hello`, `inventory.summary`를 보냈고 둘 다 `ok:true`, 프로세스 종료 코드 0을 확인했다.
- 이 확인 시점의 저장된 캡처/관찰은 0/0이다. 합성 WTS 데이터를 실제 사용자 저장소에 넣지 않았다.
- 화면 제어, LAYA, local planner는 모두 `false`다. **이 결과는 설치된 실행 파일의 검증이며 Chrome이 시작한 연결의 증거는 아니다.**

## 실제 Chrome 검증 경계

자동화 도구가 `chrome://extensions/` 접근을 보안 정책으로 거부했다. 도구의 응답은 우회·간접 실행·다른 브라우저 경로·raw CDP를 통한 재시도를 금지한다. 이 제한을 우회하지 않았다. 따라서 압축 해제 확장 로드는 사용자가 직접 수행해야 한다.

독립 코드 리뷰는 PASS이며 열린 코드 지적사항은 0이다. 빌드와 로컬 설치가 끝난 패키지의 남은 확인 순서는 다음과 같다.

1. 로컬 호스트 설치는 완료했다. 위 설치 위치와 확장 ID로 등록되어 있다.
2. Chrome의 `chrome://extensions`에서 개발자 모드를 켜고 **압축해제된 확장 프로그램을 로드합니다**로 `C:\Projects\DAOU.Athena\extension\dist`를 선택한다.
3. WTS 탭에서 ATHENA 확장 버튼을 눌러 Side Panel을 연다.
4. **로컬 실행기 연결 → 현재 화면 조사**를 실행한다. 캡처/프레임 수가 증가하는지 확인한다.
5. 연결 해제/재연결 후 같은 요약을 확인한다. 브라우저 증거와 로컬 저장 증거를 대조하기 전에는 이 단계를 통과로 처리하지 않는다.

요청되는 권한은 WTS 호스트 접근, Side Panel, scripting, nativeMessaging, 보류 캡처용 확장 로컬 storage다. 모든 사이트 접근이나 원격 AI 권한은 요청하지 않는다. 현재 수집은 사용자의 조사 버튼 클릭에만 실행된다.

## 남은 범위

현재 조사 목록은 화면별 기본 레이아웃의 목록이다. 모든 필터 조합, 계좌 비밀번호 이후 조회, 오류/빈 결과/로딩, 새 창 수명, 뉴스 기사 iframe, canvas 내부 조작, 모의 주문의 개별 확인 동작은 추가 검증이 필요하다. 상세 순서는 [WTS 조사 보고서](README.md)에 있다.
