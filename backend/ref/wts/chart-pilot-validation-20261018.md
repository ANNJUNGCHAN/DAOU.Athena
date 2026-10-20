# WTS 차트 파일럿 구현 및 연결 진단

## 현재 상태

Codex의 파일시스템 리디렉션 때문에 설치 파일의 실제 위치와 Chrome에 등록된 경로가 달랐던 문제를 복구했다. 이후 사용자가 실제 Chrome 연결·현재 화면 조사 완료를 확인했다. 현재 로컬 저장소에는 캡처 6건·관측 6건이 있으며, v2 연결 후 새 캡처 1건이 추가됐다. 기존 5건의 해시는 유지됐다. 별도 실행기 프로세스도 같은 결과를 읽었다. 이는 연결과 저장 검증이며 전체 WTS 분석이나 화면 제어 완료를 의미하지 않는다.

사용자가 연결 해제를 확인한 뒤, 실행 중인 호스트가 없는 것을 검사하고 확장 파일과 로컬 호스트를 0.2.0 / 프로토콜 v2로 함께 업데이트했다. 원래 v1 코드 파일은 로컬에 백업했고, 기존 캡처 5건은 유지했다. 이후 사용자가 **버전 0.2.0과 Chrome 연결 성공**을 확인했다. 실제 실행 기록 4건에서 **종목시세 → 차트 열기 1건, 일봉 → 주봉 2건, 주봉 → 일봉 1건**의 화면 변화·저장을 검증했다. 네 기록은 모두 같은 종목·브라우저 컨텍스트에서 `POSTCONDITION_MET`로 끝났다. 이로써 세 지원 명령의 좁은 정상 경로는 실제 Chrome에서 확인됐다. 실패·보류 조건과 전체 WTS 제어의 실사용 검증은 남아 있다.

## 초기 연결 진단 근거

아래는 원인 확정 전 검사 기록이다. 당시 파일 존재·읽기 검사는 Codex 실행 환경의 파일 뷰에서 수행했으며, Chrome에서 같은 경로로 파일이 보인다는 증거가 아니었다. 이후 확인한 물리 경로 차이는 아래의 최신 진단에 기록한다.

- HKCU 32비트·64비트 뷰의 `Software\Google\Chrome\NativeMessagingHosts\com.athena.wts` 기본값은 REG_SZ이며 설치된 manifest의 절대 경로와 일치한다.
- 설치된 manifest는 BOM 없는 JSON이며 호스트명·stdio 타입·허용된 확장 origin이 맞고, 지정된 launcher 파일도 존재한다.
- 읽은 로컬 정책 레지스트리에는 NativeMessagingAllowed, NativeMessagingUserLevelHosts, 허용/차단 목록 정책이 없었다. 이는 Chrome의 모든 런타임 관리 정책까지 확인했다는 뜻은 아니다.
- 이전 설치 launcher의 stdio hello/summary 검증은 통과했지만, Chrome의 호스트 발견·시작 검증을 대신하지 않는다.
- 사용자가 Chrome을 완전히 종료·재실행했지만 동일 오류가 유지됐다. 자동화 브라우저 목록에서도 재시작된 세션을 확인했다. 강제 종료, 안랩 비활성화, 관리자 정책 변경, HKLM 등록은 하지 않았다.
- `chrome://policy` 접근도 자동화 도구의 URL 정책에서 거부됐다. 이를 다른 도구나 CDP로 우회하지 않고, 사용자가 직접 확인했다. **NativeMessaging 관련 정책이 없다는 사용자 확인을 받았다.**
- 재확인에서 Chrome 주 프로세스와 진단 프로세스의 Windows 사용자 SID·세션이 같았고, 두 레지스트리 뷰의 기본값은 NUL로 끝나는 정상 REG_SZ 바이트였다. manifest와 launcher는 현재 사용자에게 읽기 가능했다.
- 현재 Chromium 소스에서 이 오류는 manifest 검색·파싱·이름 일치·실행 파일 경로 존재 확인 실패로 좁혀진다. `.cmd`는 지원되는 실행 경로이며, 실행 자체의 실패는 다른 오류로 보고된다. 현재 설치 검사는 통과했으므로 Chrome 내부에서 실패한 분기는 아직 확인되지 않았다.
- 표준 Chrome 오류 로그는 없었다. 다음 진단은 실제 연결 시 Chrome이 남기는 Native Messaging 오류 로그를 수집하는 것이다. 로그 수집 전까지 안랩 또는 정책 차단을 원인으로 단정하지 않는다.

Chrome 공식 문서는 이 오류를 이름·등록 경로·manifest 형식·실행 파일 존재 여부와 연결한다. 현재 확인한 설치 상태만으로 실행 중 Chrome의 실패 원인을 확정할 수 없다. [Native Messaging 디버깅](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging#native-messaging-debugging), [Chromium native process launcher](https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/extensions/api/messaging/native_process_launcher.cc).

오류 분기와 Windows 실행 방식은 [Chromium launch context](https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/extensions/api/messaging/launch_context.cc), [Windows host lookup and launch](https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/extensions/api/messaging/launch_context_win.cc), [manifest parser](https://chromium.googlesource.com/chromium/src/+/main/chrome/browser/extensions/api/messaging/native_messaging_host_manifest.cc)에서 확인했다.

## 파일럿 범위

메인 WTS `/`의 네 번째 패널(P3)에서 두 동작만 다룬다.

| 동작 | 지원 문장 | 결과 확인 |
| --- | --- | --- |
| 차트 열기 | `차트 열어줘`, `차트 열기` | P3 활성 탭과 고유한 차트 canvas |
| 기간 바꾸기 | `일봉으로`, `일봉으로 바꿔줘`, `주봉으로`, `주봉으로 바꿔줘` | 차트의 일/주 버튼 선택 상태 |

문장 해석은 PC의 고정 문법 처리기에서 한다. LAYA, 생성형 계획기, 복합 지시, 원격 AI는 연결하지 않는다. 다른 화면·새 창·검색·canvas 내부 조작·주문은 이 파일럿의 지원 동작이 아니다.

확장은 같은 탭·창·문서와 최신 화면 상태를 검사하고, 고정된 action ID에 대응하는 DOM 동작만 수행한다. 임의 selector나 코드를 로컬 호스트가 전달하지 않는다. 표 행, 계좌 값, 입력 값, 인증 iframe을 제어 근거로 사용하지 않는다. 종목은 보이는 종목 라벨의 해시로 변화 여부를 비교하며 원문을 제어 관측에 담지 않는다.

제어 시작에는 정확한 v2/capability/catalog 계약과 최소 한 건의 실제 로컬 캡처 저장이 필요하다. 팝업, 모호한 화면 구조, 바뀐 종목·문서, 비활성 버튼, 유효기간 경과는 실행을 차단한다. 클릭은 한 번만 수행하고 결과만 다시 관찰한다. 결과 저장 재시도는 동일 영수증만 다시 저장하며 클릭을 반복하지 않는다.

실행 중에는 연결 해제를 서비스와 UI 양쪽에서 막는다. 실행기 재시작으로 제안 식별자가 소실되어 영수증 저장이 불가능하면 사용자가 명시적으로 미확인 결과를 Chrome 로컬 저장소에 보관할 수 있다. 원본 JSON을 최대 50건·512 KiB 안에 보존한 뒤 대기 상태를 해제하며, 이 보관본은 실행 성공·실행기 영수증·학습 자료로 인정하지 않는다. 공간 부족·충돌·저장 실패 시 대기 결과를 지우지 않는다.

## 초기 파일럿 소스 검증 결과 (설치 전)

- 테스트 **88/88 통과**: 계약 12, 확장 51, 로컬 실행기 25. 실패·skip·todo는 0이다.
- 문서 교체, 실행 중 종목 변경, 해시 계산 중 팝업 생성, 클릭 뒤 문서 상실, 후조건 시간 초과, 정확한 영수증 재시도와 보관, 연결 해제 거부 시 UI 상태 보존을 포함한다.
- 임시 경로로 빌드한 v2 확장의 정적 검사와 Node 구문 검사, PowerShell 파서 검사, `git diff --check`가 통과했다. 로드된 v1 `dist`를 빌드로 덮어쓰지 않았다.
- 독립 코드 리뷰는 **APPROVE**, 남은 지적사항은 0이다. 이는 소스 검토 승인이며 실제 Chrome 연결이나 WTS 실행 승인이 아니다.
- contracts/extension/local-runtime/WTS 문서의 비밀정보 검사에서 발견 항목은 0이다. 공개 빈 문자열 SHA-256 테스트의 오탐은 기대값을 Node crypto로 계산하도록 고쳤고 검사 예외를 늘리지 않았다.
- commit/push/원격 배포, 실계좌·모의계좌 주문, LAYA 학습은 실행하지 않았다.

당시 검증된 v2 임시 빌드는 `%TEMP%\athena-wts-extension-verified-f5dcec4e1e8141e9b06288b1aeba6bc7`이며, 당시 설치된 v1 호스트와 함께 로드하지 않았다. 이후 확장과 호스트를 함께 v2로 교체한 결과는 아래에 기록한다.

`chrome.scripting.executeScript`의 `documentIds`는 조사 결과에서 얻은 문서 ID로 실행 대상을 고정한다. 동일 URL 새로고침도 다른 문서로 취급한다. `ISOLATED` 실행과 문서 ID 지원, 주입 함수의 직렬화 제약은 [Chrome Scripting API](https://developer.chrome.com/docs/extensions/reference/api/scripting)와 [Content Scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)에서 확인했다. DOM의 `.click()`은 신뢰된 사용자 입력과 같지 않으므로 실제 WTS 적용 여부는 별도 후조건 검증이 필요하다.

## 실제 WTS 관찰과 검증 경계

초기에는 일반 브라우저 도구로 메인 P3 차트 열기와 `일 → 주 → 일` 전환을 수행했고 선택된 `.on` 버튼이 각각 바뀌는 것을 확인했다. 그 관찰은 DOM 구조와 일반 UI 동작의 근거였으며, 당시에는 ATHENA 확장의 실행 증거가 없었다. 이후 확장을 통한 실제 일봉 → 주봉 전환을 확인한 근거는 아래의 v2 기간 전환 검증에 기록한다.

53개 사이트맵 항목의 기본 레이아웃 조사는 이전 [화면 목록](screen-inventory-20261018.json)에 있다. 이 파일럿은 전체 WTS 화면·상태·동작 분석의 완료를 의미하지 않는다. LAYA 학습 자료로 승인된 실행 기록도 아직 없다.

## 후속 실사용 검증

Chrome 연결 오류를 구분하기 위한 [진단 실행기](../../../local-runtime/scripts/diagnose-chrome-native-host.cmd)와 [사용 안내](../../../local-runtime/README.md)를 추가했다. Chrome이 실행 중이면 시작을 거부하며, 사용자가 종료한 뒤 기존 Chrome 프로필에서 경고·오류 로그를 켠다. 로그는 `%LOCALAPPDATA%\Athena\WtsDiagnostics`에 저장된다. 원본에는 다른 Chrome 경고·오류도 포함될 수 있으므로 로컬에 보관한다. 수집 모드는 Chrome을 열어 둔 상태에서 읽기만 하고 로그 위치·Native Messaging 오류 분류·횟수·줄 번호를 반환하며, 로그 본문과 그 안의 개인 경로·다른 호스트명은 출력하지 않는다.

진단 도구 검증을 포함한 로컬 실행기 테스트는 **29/29 통과**(기존 25 + 진단 4), 실패·skip·todo 0이다. `Launch -DryRun` 무변경, 소유 경로 밖의 로그 거부, 호스트명 경계, 원문 비공개, 쓰기 중인 로그 읽기를 검증했다. PowerShell 구문 검사와 비밀정보 검사도 통과했다. 이 검증은 Chrome 연결 성공을 의미하지 않는다.

별도 검토자는 공백이 포함된 로그 경로의 인용 처리를 수정·회귀 검증한 뒤 진단 도구 소스에 **APPROVE**, 남은 지적사항 0을 보고했다. 이후 사용자가 실제 진단 Chrome을 실행하고 같은 연결 오류를 재현했다. 로그 파일은 생성됐지만 첫 설정에서는 Native Messaging 진단이 남지 않았다.

### Chrome 155 로그 설정 수정

실제 Chrome 버전은 `155.0.8059.82`이며, 주 프로세스에 첫 진단 옵션과 지정 로그 경로가 전달된 것을 확인했다. 첫 로그는 158바이트, Native Messaging과 무관한 INFO 1건뿐이었다. 확장 설치본의 재시도 경로도 확인했으며, 실패 뒤 다시 누르면 `connectNative('com.athena.wts')`를 새로 호출하고 이전 오류를 지운다.

첫 진단 설정은 최신 Chromium의 `NM_LOG` 구현에 근거한 `--log-level=3`과 `--vmodule` 조합이었다. 하지만 [설치 버전 155의 launch_context.cc](https://chromium.googlesource.com/chromium/src/+/155.0.8059.82/chrome/browser/extensions/api/messaging/launch_context.cc)는 해당 실패를 일반 `LOG(WARNING)`으로 기록한다. 따라서 첫 설정이 필요한 경고를 제외했다. 이는 진단 설정의 버전 불일치이며, 네이티브 호스트 연결 오류 자체의 원인은 아직 미확정이다.

진단 옵션을 `--enable-logging --log-file=<절대 경로> --log-level=1`로 수정하고 `--vmodule`은 제거했다. 수정 후 진단 테스트 4/4와 PowerShell 구문 검사, 비밀정보 검사가 통과했고 독립 검토는 APPROVE/지적사항 0이다. 이 설정으로 다시 시작한 Chrome에서 연결 실패를 재현한 뒤 manifest 검색·파싱·경로 검사 중 실패 분기를 확인해야 한다.

### 패널의 실제 연결 요청 식별

수정한 옵션으로 사용자가 두 번째 연결을 재현했다. 새 로그는 2,058바이트이며 일반 경고·오류는 있었지만 Native Messaging 관련 분류는 여전히 0건이었다. Chrome 155의 정상 코드 경로에서는 해당 오류가 경고를 남기므로, 이 결과만으로 등록 정보를 더 바꾸거나 같은 재시작을 반복하지 않는다. 사용자가 제공한 화면에서 WTS 주소와 FOUNDATION 패널, 연결 오류를 확인했지만 확장 ID·버전·요청 시각은 기존 UI에 없었다. 제공된 화면 이미지는 저장소에 복사하지 않았다.

설치된 v1의 패널 파일과 v2 소스 패널에 `nm-diag-1` 진단 영역을 추가했다. 실제 `chrome.runtime.id`·manifest 버전·요청 호스트·시도 ID·ISO 시각을 표시하며, 늦게 도착한 이전 결과가 최신 시도를 덮지 않도록 결과를 시도 ID에 묶었다. 별도의 `직접 연결 진단` 버튼은 확장 페이지에서 `connectNative`를 직접 호출하고 `runtime.hello`만 확인한 뒤 임시 연결을 닫는다. 이 결과는 기존 연결 상태나 캡처·제어 가능 상태를 바꾸지 않는다.

확장 전체 테스트 **57/57**, 진단 회귀 테스트 **6/6**, source/dist 구문 검사, 임시 빌드·정적 검사, 비밀정보 검사가 통과했다. 설치 manifest는 `0.1.0`, native 호스트는 v1을 유지했다. v2 빌드로 설치 폴더를 덮어쓰지 않았다. 패널을 닫았다 다시 열어 `빌드: nm-diag-1` 표시를 확인하고 직접 진단 결과를 받아 실제 Chrome 동작을 확인해야 한다.

진단 패치의 독립 검토는 **APPROVE**, 남은 지적사항 0이다. 이전 성공·실패의 지연 응답, 직접 진단의 단일 hello 요청과 연결 정리, 기존 연결 상태와의 분리, source/dist 버전 유지가 검토됐다.

### 최신 진단: 설치 경로 리디렉션 확인

사용자가 전달한 `nm-diag-1` 결과에서 실제 확장 ID `mhbcjkjmgabekcakpilhgkgeedhkjfee`, 버전 `0.1.0`, 호스트 `com.athena.wts`, `direct-panel` 경로와 새 연결 시도를 확인했다. `2026-10-18T12:20:35.892Z`의 실패와 같은 시각에 Chrome 로그에 `Failed to load manifest for native messaging host com.athena.wts: File doesn't exist.`가 기록됐다. 해당 로그에는 같은 유형의 ATHENA 경고가 6건 있었다. 원본 Chrome 로그는 저장소에 복사하지 않았다.

[Chrome 155의 JSON 파일 읽기 구현](https://chromium.googlesource.com/chromium/src/+show/refs/tags/155.0.8059.82/base/json/json_file_value_serializer.cc)에 따르면 이 오류는 선택된 manifest 경로의 파일 존재 확인 실패에 해당한다. manifest JSON 검증, 허용 origin 확인, launcher 실행보다 앞 단계다. HKCU 32비트·64비트 등록값은 같은 정상 REG_SZ였고, HKLM 두 뷰에는 등록이 없었다.

`GetFinalPathNameByHandleW`로 실제 파일 핸들을 조사한 결과, 일반 `%LOCALAPPDATA%\Athena\WtsNativeHost` 경로가 Codex 패키지의 `LocalCache\Local\Athena\WtsNativeHost`로 해석됐다. 경로의 파일·디렉터리에는 junction 또는 reparse point가 없었다. 설치 파일은 Codex의 리디렉션된 위치에 쓰였지만 공유 HKCU에는 일반 AppData 경로가 기록된 것이다. Chrome의 파일 뷰에서는 그 일반 경로에 manifest가 없어 연결에 실패했다. 안랩 차단을 원인으로 지목할 근거는 없다.

복구 스크립트의 테스트와 독립 검토 APPROVE/지적사항 0을 확인한 뒤 실제 복구를 적용했다. 기존 설치된 v1 파일을 `%USERPROFILE%\.athena\WtsNativeHost`로 복사하고 데이터 경로를 별도 `%USERPROFILE%\.athena\WtsData`로 설정했다. 변경하지 않는 9개 코드·계약 파일의 SHA-256을 원본과 대조했으며, 경로를 담는 manifest·launcher·config·소유 표시 파일만 다시 작성했다. 기존 설치와 데이터는 지우지 않았다. HKCU 32비트·64비트의 이전 등록은 설치 폴더 바깥의 고유한 로컬 복구 기록에 보존했다.

등록 후 두 HKCU 뷰가 새 manifest를 가리키는 정상 REG_SZ인지, manifest와 데이터 폴더의 핸들 경로가 요청 경로와 일치하는지 재확인했다. 새 launcher의 실제 stdio `runtime.hello`와 `inventory.summary` 왕복은 종료 코드 0으로 통과했다. 실행기 버전은 `0.1.0`, 프로토콜은 1, 캡처·관측 수는 모두 0이었다. 설치된 Chrome 확장도 `0.1.0`을 유지한다. **이는 로컬 프로세스 검증이며 Chrome 연결 성공 증거는 아니다.** 사용자의 기존 패널에서 정상 연결과 현재 화면 조사 한 건을 확인하는 단계가 남아 있다. Chrome 재시작은 요청하지 않았다.

[경로 복구 스크립트](../../../local-runtime/scripts/repair-native-host-path.ps1)는 기본값이 DryRun이며, 비어 있지 않은 기존 데이터를 발견하면 중단한다. 양쪽 HKCU 갱신 중 실패하면 이전 등록을 복원한다. 임시 설치·임시 HKCU만 사용한 집중 테스트 2/2와 PowerShell·JavaScript 구문 검사가 통과했다. 새 소스 v2 설치와 Chrome 연결 성공은 별도 검증 단계로 유지한다.

일반 설치기도 기본 경로를 `%USERPROFILE%\.athena`로 변경했다. 기존 쓰기 대상의 실제 경로·타입·링크를 복사 전에 검사하고, 생성한 파일도 등록 전에 다시 검사한다. 삭제 도구는 v1/v2의 정확한 파일 목록만 취급하며, 다른 파일이나 경로 리디렉션이 있으면 등록·파일을 바꾸기 전에 중단한다. 재귀 삭제는 제거했다. 실제 hard link 외부 파일의 내용 보존, junction 외부 파일·임시 등록 보존, 알 수 없는 파일 보존 회귀를 포함해 최종 로컬 실행기 테스트 **37/37 통과**, 실패·skip·todo 0을 확인했다. 독립 검토 APPROVE/남은 지적 0, 구문 검사, `git diff --check`, 비밀정보 검사도 통과했다. 새 v1 설치에 대한 삭제 DryRun 역시 소유권을 정상 확인했고 실제 삭제는 수행하지 않았다.

로그 분류기는 이 정확한 경고를 `HOST_MANIFEST_FILE_NOT_FOUND`로 구분하도록 수정했다. 대상 호스트의 접미사가 붙은 다른 호스트는 제외하며, 일반 manifest 실패를 곧바로 형식 오류라고 표현하지 않는다. 회귀 테스트 4/4와 PowerShell 파서 검사, 독립 검토 APPROVE/지적사항 0을 통과했다.

### v1 실제 연결 확인과 v2 업데이트

사용자 확인 후 실제 저장 결과는 캡처 5건·관측 5건, 마지막 관측 시각 `2026-10-18T12:46:17.959Z`였다. 각 캡처는 같은 시점의 전체 WTS 분석이 아니라 개별 화면 관측이다. 합산 제어 요소 수는 410개이며 중복을 포함한다. 잘림 표시된 관측은 0건이었다. 저장된 원문이나 계좌 정보는 보고서에 옮기지 않았다.

사용자가 기존 연결 해제를 확인했고, 설치 경로의 호스트 프로세스가 0개인 상태에서 v2를 적용했다. 업데이트 전 확장·실행기 코드 26개 파일을 사용자 PC의 별도 백업 폴더에 복사해 해시를 대조했다. 확장 57/57, 계약 12/12, 로컬 실행기 37/37로 총 106개 테스트가 통과했으며, 임시 확장 빌드와 정적 검사를 통과했다. 실제 빌드는 같은 확장 ID를 출력했다.

업데이트 후 CLI hello에서 버전 `0.2.0`, 프로토콜 2, catalog `wts-chart-pilot-1`, 지원 action 2개를 확인했고 기존 저장 요약 5건을 읽었다. LAYA·생성형 계획기는 비활성이다. 사용자에게 Chrome 확장 관리 화면에서 ATHENA를 새로고침한 뒤 연결·조사를 요청했으나, 새로고침 버튼을 찾지 못했다. 최신 패널 진단의 `0.1.0`은 Chrome이 기존 manifest/서비스 워커 상태를 계속 사용하는 근거다. 패널 일부 파일의 새 차트 UI 표시만으로 확장 전체 업데이트 완료로 보지 않는다.

별도 검증자는 설치된 실행기 파일 9개·계약 파일 2개, 확장 dist와 소스·생성 schema의 해시 일치, 양쪽 HKCU 등록과 경로 일치, 기존 조사 파일 5개의 해시 보존을 확인했다. 설치 산출물은 PASS, Chrome v2 재연결·차트 실행은 미검증으로 분리해 보고했다. [Chrome 공식 안내](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#reload-the-extension)에 따라 확장 관리 화면의 개발자 모드를 켜고 ATHENA 카드의 켜짐 스위치 옆 새로고침 아이콘을 누르도록 구체적으로 안내했다.

### 실제 v2 차트 정상 경로 검증

사용자가 버전 0.2.0과 연결 성공을 확인했다. 로컬에 저장된 `wts.main.p3.chart.period.set` 실행 기록 3건과 `wts.main.p3.chart.open` 실행 기록 1건은 canonical protocol 검증을 통과했고, 모두 `status: verified`, `reason: POSTCONDITION_MET`였다.

| 완료 시각 | 실행 ID | 동작 | 검증된 전환 |
| --- | --- | --- | --- |
| `2026-10-18T13:00:06.958Z` | `426a70ff-9a31-446c-bb5b-a8f58091ba9a` | `wts.main.p3.chart.period.set` | 일봉 → 주봉 |
| `2026-10-18T13:17:46.316Z` | `58f1ba62-a5d7-447b-9525-dd8c043d626c` | `wts.main.p3.chart.period.set` | 주봉 → 일봉 |
| `2026-10-18T13:17:56.291Z` | `12631b12-682e-42b0-81ff-791015d68708` | `wts.main.p3.chart.period.set` | 일봉 → 주봉 |
| `2026-10-18T14:32:02.028Z` | `b3a6d5aa-76df-412e-a524-397d1ffae2b5` | `wts.main.p3.chart.open` | P3 종목시세 → 차트 |

네 기록의 전후 상태에서 종목 토큰·탭·창·문서 식별자가 유지됐고 차단 상태는 false였다. 시간 순서도 같은 종목·브라우저 컨텍스트에서 연속됐다. 차트 열기 기록은 `main-other`의 종목시세 탭에서 `main-chart`의 차트 탭으로 바뀐 후조건을 확인했다. 읽기 전용 검증 스크립트도 `chartOpen`, `dayToWeek`, `weekToDay` 세 범위를 모두 true로 판정했다.

현재 캡처는 6건·관측은 6건이다. `2026-10-18T13:17:26.814Z`에 저장된 새 캡처 `c2804473-8d4e-4c4a-a33c-429b661cf993`은 canonical schema와 개인정보 제외 형태 검사를 통과했다. 기존 5건의 SHA-256도 기준값과 일치했다. 캡처 원문과 계좌 데이터는 저장소 문서로 복사하지 않았다.

사용자는 현재 화면 조사 뒤 `차트 열어줘`, `주봉으로`, `일봉으로` 세 명령이 모두 성공했다고 보고했다. 첫 시도의 차트 열기는 이미 열린 차트를 확인한 `satisfied` 결과일 수 있어 당시에는 실제 탭 전환 증거로 인정하지 않았다. 이후 일반 WTS UI에서 P3를 종목시세 탭으로 옮기고 `차트 열어줘`를 다시 실행해 별도의 차트 열기 영수증과 후조건을 확보했다.

차트 열기 영수증 `b3a6d5aa-76df-412e-a524-397d1ffae2b5`은 `2026-10-18T14:32:02.028Z`에 완료됐다. SHA-256은 `29bb49d2f69bf04f2d6f038075ebd2cc60bebd5ba572457b2024ceb3ffabd423`이며, 검증 결과는 `status: verified`, `reason: POSTCONDITION_MET`, `sameContext: true`다. 원본 영수증이나 화면의 개인 데이터는 문서로 복사하지 않았다.

1. 팝업, 오래된 화면 상태, 취소, 연결 상실, 영수증 저장 재시도에서 실행 보류·복구 동작을 실제 Chrome에서 확인한다.
2. P0~P3, iframe, canvas, 새 창을 포함한 전체 W1 대표 제어 모드를 구현·검증한다.
3. 전체 WTS 화면·상태 조사를 확장하고, 검토된 실행 기록만 LAYA 학습 후보로 분리한다.

현재 완료 판정은 세 지원 명령의 **좁은 정상 경로**에 한정한다. 실패·보류·복구 조건까지 포함한 전체 차트 파일럿, 전체 W1 대표 제어 모드, 전체 WTS 이식은 완료로 표시하지 않는다. LAYA·생성형 계획기·학습은 계속 비활성 상태이며, 현재 수집 자료를 학습 정답으로 승인하지 않는다.
