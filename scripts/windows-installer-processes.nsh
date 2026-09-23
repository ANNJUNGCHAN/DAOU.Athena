!include "LogicLib.nsh"
!define ATHENA_PROCESS_SCRIPT "${__FILEDIR__}\windows-installer-processes.ps1"
Var AthenaPowerShell

!macro AthenaRunProcessAction ACTION
  nsExec::Exec '"$AthenaPowerShell" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\athena-processes.ps1" -Action ${ACTION}'
  Pop $R0
  ${If} $R0 != 0
  ${AndIf} $R0 != 1
    IfSilent +2
      MessageBox MB_OK|MB_ICONSTOP "Athena 실행 상태를 확인할 수 없습니다. Athena를 종료하고 Windows PowerShell을 사용할 수 있는지 확인한 뒤 다시 시도해 주세요."
    SetErrorLevel 2
    Quit
  ${EndIf}
!macroend

!macro AthenaCheckProcesses
  InitPluginsDir
  File /oname=$PLUGINSDIR\athena-processes.ps1 "${ATHENA_PROCESS_SCRIPT}"
  ; Environment values are data, including apostrophes and non-ASCII paths.
  System::Call 'kernel32::SetEnvironmentVariableW(w "ATHENA_INSTALLER_PROCESS_ROOT", w "$INSTDIR")i'
  System::Call 'kernel32::SetEnvironmentVariableW(w "ATHENA_INSTALLER_PROCESS_STATE", w "$PLUGINSDIR\athena-process-state.json")i'
  System::Call 'kernel32::GetCurrentProcessId()i.r9'
  System::Call 'kernel32::SetEnvironmentVariableW(w "ATHENA_INSTALLER_PROCESS_PID", w r9)i'
  ${If} ${isUpdated}
    Sleep 300
  ${EndIf}
  !insertmacro AthenaRunProcessAction Find
  ${If} $R0 == 0
    ${If} ${isUpdated}
      Sleep 1000
    ${Else}
      MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" /SD IDOK IDOK athena_process_close
      SetErrorLevel 2
      Quit
    ${EndIf}
    athena_process_close:
    DetailPrint "$(appClosing)"
    !insertmacro AthenaRunProcessAction Close
    ; CloseMainWindow may minimize Athena to its tray. Force remains bounded
    ; and follows the existing close consent/update flow; it is not a flush.
    StrCpy $R1 0
    athena_process_retry:
      Sleep 1000
      !insertmacro AthenaRunProcessAction Find
      StrCmp $R0 1 athena_process_done
      !insertmacro AthenaRunProcessAction Force
      Sleep 300
      !insertmacro AthenaRunProcessAction Find
      StrCmp $R0 1 athena_process_done
      IntOp $R1 $R1 + 1
      ${If} $R1 > 1
        MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY athena_process_retry
        SetErrorLevel 2
        Quit
      ${EndIf}
      Goto athena_process_retry
    athena_process_done:
  ${EndIf}
!macroend
