; Validate the final destination before electron-builder closes processes or
; runs the previous uninstaller. customInit is too early (directory page),
; and customInstall is too late (the previous version is already removed).
!ifndef BUILD_UNINSTALLER
  !include "LogicLib.nsh"
  !include "getProcessInfo.nsh"
  Var pid

  !macro AthenaRejectDataDirectory ROOT
    System::Call 'kernel32::GetFullPathNameW(w "${ROOT}", i ${NSIS_MAX_STRLEN}, w .r2, p 0)i.r3'
    StrCmp $0 $2 athena_invalid
    StrCpy $2 "$2\"
    StrLen $3 $2
    StrCpy $3 $0 $3
    StrCmp $3 $2 athena_invalid
  !macroend

  !macro customHeader
    Function AthenaValidateInstallDirectory
      Push $0
      Push $1
      Push $2
      Push $3
      Push $4
      System::Call 'kernel32::GetFullPathNameW(w "$INSTDIR", i ${NSIS_MAX_STRLEN}, w .r0, p 0)i.r1'
      IntCmp $1 0 athena_invalid
      ; Normalize the trailing separator before comparing registered paths.
      StrCpy $1 $0 1 -1
      ${If} $1 == "\"
        StrCpy $0 $0 -1
      ${EndIf}
      StrCmp $0 "" athena_invalid
      ; A drive root must never become a recursively removed installation.
      StrLen $1 $0
      IntCmp $1 2 athena_invalid athena_invalid
      System::Call 'shlwapi::PathIsRootW(w r0)i.r1'
      IntCmp $1 1 athena_invalid
      StrCmp $0 $APPDATA athena_invalid
      StrCmp $0 $LOCALAPPDATA athena_invalid
      ExpandEnvStrings $2 "%USERPROFILE%"
      StrCmp $0 $2 athena_invalid
      !insertmacro AthenaRejectDataDirectory "$APPDATA\Athena"
      !insertmacro AthenaRejectDataDirectory "$APPDATA\athena-shell"
      ExpandEnvStrings $2 "%USERPROFILE%"
      !insertmacro AthenaRejectDataDirectory "$2\.athena"
      System::Call 'kernel32::GetFileAttributesW(w r0)i.r1 ?e'
      Pop $4
      ${If} $1 == -1
        IntCmp $4 2 athena_valid
        IntCmp $4 3 athena_valid
        Goto athena_invalid
      ${EndIf}
      IntOp $2 $1 & 0x400
      IntCmp $2 0 +2
        Goto athena_invalid ; do not follow a junction/symlink as the install root
      IntOp $2 $1 & 0x10
      IntCmp $2 0 athena_invalid

      ; Capture Win32 errors in the same call: NSIS FindNext does not preserve
      ; GetLastError, so an unreadable directory must not look empty.
      System::Alloc 592 ; WIN32_FIND_DATAW
      Pop $4
      StrCmp $4 0 athena_invalid
      System::Call 'kernel32::FindFirstFileW(w "$0\*", p r4)p.r1 ?e'
      Pop $3
      ${If} $1 == -1
        System::Free $4
        IntCmp $3 2 athena_valid
        Goto athena_invalid
      ${EndIf}
      athena_next_entry:
        IntOp $2 $4 + 44 ; cFileName offset in WIN32_FIND_DATAW
        System::Call '*$2(&w260 .r2)'
        StrCmp $2 "." athena_skip_entry
        StrCmp $2 ".." athena_skip_entry
        System::Call 'kernel32::FindClose(p r1)'
        System::Free $4
        Goto athena_existing
      athena_skip_entry:
        System::Call 'kernel32::FindNextFileW(p r1, p r4)i.r3 ?e'
        Pop $2
        IntCmp $3 0 athena_find_end
        Goto athena_next_entry
      athena_find_end:
        System::Call 'kernel32::FindClose(p r1)'
        System::Free $4
        IntCmp $2 18 athena_valid
        Goto athena_invalid

      athena_existing:
        ReadRegStr $1 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation
        StrCmp $1 "" athena_invalid
        System::Call 'kernel32::GetFullPathNameW(w r1, i ${NSIS_MAX_STRLEN}, w .r1, p 0)i.r2'
        IntCmp $2 0 athena_invalid
        StrCpy $2 $1 1 -1
        ${If} $2 == "\"
          StrCpy $1 $1 -1
        ${EndIf}
        StrCmp $0 $1 0 athena_invalid
        IfFileExists "$0\${APP_EXECUTABLE_FILENAME}" 0 athena_invalid
        IfFileExists "$0\${UNINSTALL_FILENAME}" 0 athena_invalid
        IfFileExists "$0\resources\app\package.json" 0 athena_invalid
      athena_valid:
        StrCpy $0 1
        Goto athena_return
      athena_invalid:
        StrCpy $0 0
      athena_return:
        Pop $4
        Pop $3
        Pop $2
        Pop $1
        Exch $0
    FunctionEnd
  !macroend

  !macro customCheckAppRunning
    Call AthenaValidateInstallDirectory
    Pop $R0
    ${If} $R0 != 1
      IfSilent +2
        MessageBox MB_OK|MB_ICONSTOP "비어 있는 폴더 또는 기존 Athena 설치 폴더를 선택해 주세요. 사용자 데이터가 있는 폴더에는 설치할 수 없습니다."
      SetErrorLevel 2
      Quit
    ${EndIf}
    ; Preserve electron-builder 26.15.3's existing process-closing behavior.
    !insertmacro IS_POWERSHELL_AVAILABLE
    !insertmacro _CHECK_APP_RUNNING
  !macroend
!endif
