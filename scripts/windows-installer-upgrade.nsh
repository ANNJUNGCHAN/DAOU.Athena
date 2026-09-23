!include "FileFunc.nsh"
!define ATHENA_UPGRADE_SCRIPT "${__FILEDIR__}\windows-installer-upgrade.ps1"
!ifndef BUILD_UNINSTALLER
  Var AthenaOldInstallRoot
  Var AthenaKeepOldShortcuts
  Var AthenaHadDesktopShortcut
  Var AthenaHadStartShortcut
!endif

!macro AthenaUpgradeFailure
  ReadEnvStr $R8 ATHENA_UPGRADE_BACKUP
  StrCpy $R7 "기존 Athena 설치를 안전하게 확인하거나 보존하지 못했습니다. 설치를 중단합니다."
  ${If} $R8 != ""
  ${AndIf} ${FileExists} "$R8\*"
    SetDetailsPrint both
    DetailPrint "복구용 백업 폴더: $R8"
    SetDetailsPrint lastused
    StrCpy $R7 "$R7$\r$\n복구용 백업 폴더: $R8"
  ${EndIf}
  IfSilent +2
    MessageBox MB_OK|MB_ICONSTOP "$R7"
  SetErrorLevel 2
  Quit
!macroend

!macro AthenaRunUpgradeHelper ACTION
  nsExec::Exec '"$AthenaPowerShell" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\athena-upgrade.ps1" -Action ${ACTION}'
  Pop $R0
!macroend

!ifndef BUILD_UNINSTALLER
  !macro customInit
    ${If} $installMode != "CurrentUser"
      IfSilent +2
        MessageBox MB_OK|MB_ICONSTOP "이 설치 파일은 현재 사용자용 설치만 지원합니다. 모든 사용자용 Athena 설치는 변경하지 않습니다."
      SetErrorLevel 2
      Quit
    ${EndIf}
    ; Do not enter the stock silent migration/elevation branch for an HKLM
    ; installation. This package only upgrades the current user's install.
    StrCpy $hasPerMachineInstallation "0"
  !macroend

  !macro customInstallMode
    StrCpy $isForceCurrentInstall "1"
  !macroend

  !macro AthenaInspectUpgrade
    InitPluginsDir
    File /oname=$PLUGINSDIR\athena-upgrade.ps1 "${ATHENA_UPGRADE_SCRIPT}"
    System::Call 'kernel32::SetEnvironmentVariableW(w "ATHENA_UPGRADE_INSTALL_KEY", w "${INSTALL_REGISTRY_KEY}")i'
    System::Call 'kernel32::SetEnvironmentVariableW(w "ATHENA_UPGRADE_UNINSTALL_KEY", w "${UNINSTALL_REGISTRY_KEY}")i'
    !ifdef UNINSTALL_REGISTRY_KEY_2
      System::Call 'kernel32::SetEnvironmentVariableW(w "ATHENA_UPGRADE_UNINSTALL_KEY_2", w "${UNINSTALL_REGISTRY_KEY_2}")i'
    !else
      System::Call 'kernel32::SetEnvironmentVariableW(w "ATHENA_UPGRADE_UNINSTALL_KEY_2", w "")i'
    !endif
    System::Call 'kernel32::SetEnvironmentVariableW(w "ATHENA_UPGRADE_RESULT", w "$PLUGINSDIR\athena-upgrade-result.ini")i'
    System::Call 'kernel32::SetEnvironmentVariableW(w "ATHENA_UPGRADE_BACKUP", w "")i'
    !insertmacro AthenaRunUpgradeHelper Inspect
    StrCpy $AthenaOldInstallRoot ""
    ${If} $R0 == 0
      ReadINIStr $AthenaOldInstallRoot "$PLUGINSDIR\athena-upgrade-result.ini" upgrade Root
      ReadINIStr $R2 "$PLUGINSDIR\athena-upgrade-result.ini" upgrade Backup
      System::Call 'kernel32::SetEnvironmentVariableW(w "ATHENA_UPGRADE_BACKUP", w "$R2")i'
      ${If} $AthenaOldInstallRoot == ""
        !insertmacro AthenaUpgradeFailure
      ${EndIf}
    ${ElseIf} $R0 != 1
      !insertmacro AthenaUpgradeFailure
    ${EndIf}
  !macroend

  !macro AthenaPerformUpgrade
    ${If} $AthenaOldInstallRoot != ""
      ; The final installer embeds its freshly built safe uninstaller. The
      ; registered legacy executable is only an identity marker, never run.
      File /oname=$PLUGINSDIR\athena-safe-uninstaller.exe "${UNINSTALLER_OUT_FILE}"
      System::Call 'kernel32::SetEnvironmentVariableW(w "ATHENA_UPGRADE_EXPECTED_ROOT", w "$AthenaOldInstallRoot")i'
      StrCpy $R2 "/S /KEEP_APP_DATA /currentuser --updated /ATHENA-PRESERVE-UPGRADE"
      StrCpy $AthenaKeepOldShortcuts "false"
      !insertmacro setIsTryToKeepShortcuts
      ${If} $isTryToKeepShortcuts == "true"
        ReadRegStr $R3 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" KeepShortcuts
        ${If} $R3 == "true"
        ${AndIf} ${FileExists} "$appExe"
          StrCpy $R2 "$R2 --keep-shortcuts"
          StrCpy $AthenaKeepOldShortcuts "true"
          StrCpy $AthenaHadDesktopShortcut "false"
          StrCpy $AthenaHadStartShortcut "false"
          ${If} ${FileExists} "$oldDesktopLink"
            StrCpy $AthenaHadDesktopShortcut "true"
            ClearErrors
            CopyFiles /SILENT "$oldDesktopLink" "$PLUGINSDIR\athena-old-desktop.lnk"
            ${If} ${Errors}
              !insertmacro AthenaUpgradeFailure
            ${EndIf}
          ${EndIf}
          ${If} ${FileExists} "$oldStartMenuLink"
            StrCpy $AthenaHadStartShortcut "true"
            ClearErrors
            CopyFiles /SILENT "$oldStartMenuLink" "$PLUGINSDIR\athena-old-start.lnk"
            ${If} ${Errors}
              !insertmacro AthenaUpgradeFailure
            ${EndIf}
          ${EndIf}
        ${EndIf}
      ${EndIf}
      ; The parent installer can also hold the old directory as its CWD.
      SetOutPath $TEMP
      ClearErrors
      ExecWait '"$PLUGINSDIR\athena-safe-uninstaller.exe" $R2 _?=$AthenaOldInstallRoot' $R0
      ${If} ${Errors}
        !insertmacro AthenaUpgradeFailure
      ${EndIf}
      ${If} $R0 != 0
        !insertmacro AthenaUpgradeFailure
      ${EndIf}
      ; Fail before the stock fallback can execute any legacy binary.
      !insertmacro AthenaRunUpgradeHelper VerifyRemoved
      ${If} $R0 != 0
        !insertmacro AthenaUpgradeFailure
      ${EndIf}
      ReadINIStr $R2 "$PLUGINSDIR\athena-upgrade-result.ini" upgrade Backup
      ReadINIStr $R3 "$PLUGINSDIR\athena-upgrade-result.ini" upgrade Receipt
      ${If} $R2 == ""
      ${OrIf} $R3 == ""
        !insertmacro AthenaUpgradeFailure
      ${EndIf}
      SetDetailsPrint both
      DetailPrint "기존 설치와 모든 파일을 보존했습니다: $R2"
      DetailPrint "백업은 자동 삭제되지 않으며 기존 설치 용량을 사용합니다. 안내 파일: $R3"
      SetDetailsPrint lastused
    ${EndIf}
  !macroend

  !macro customInstall
    ; Registry removal makes the stock shortcut calculation look like a fresh
    ; install. Restore the previous update preference after its shortcut step.
    ${If} $AthenaKeepOldShortcuts == "true"
      ClearErrors
      ${If} $AthenaHadDesktopShortcut == "true"
        CopyFiles /SILENT "$PLUGINSDIR\athena-old-desktop.lnk" "$newDesktopLink"
        ${IfNot} ${Errors}
        ${AndIf} $oldDesktopLink != $newDesktopLink
          Delete "$oldDesktopLink"
        ${EndIf}
      ${Else}
        ${If} ${FileExists} "$newDesktopLink"
          Delete "$newDesktopLink"
        ${EndIf}
      ${EndIf}
      ${If} ${Errors}
        !insertmacro AthenaUpgradeFailure
      ${EndIf}
      ClearErrors
      ${If} $AthenaHadStartShortcut == "true"
        CopyFiles /SILENT "$PLUGINSDIR\athena-old-start.lnk" "$newStartMenuLink"
        ${IfNot} ${Errors}
        ${AndIf} $oldStartMenuLink != $newStartMenuLink
          Delete "$oldStartMenuLink"
          ${IfNot} ${Errors}
          ${AndIf} $oldMenuDirectory != ""
            ${GetParent} "$oldStartMenuLink" $R4
            RMDir "$R4"
            ClearErrors ; a shared nonempty menu folder is preserved
          ${EndIf}
        ${EndIf}
      ${Else}
        ${If} ${FileExists} "$newStartMenuLink"
          Delete "$newStartMenuLink"
        ${EndIf}
      ${EndIf}
      ${If} ${Errors}
        !insertmacro AthenaUpgradeFailure
      ${EndIf}
    ${EndIf}
  !macroend
!else
  !macro AthenaValidateUpgradeUninstallerRoot
    ${GetParameters} $R0
    ClearErrors
    ${GetOptions} $R0 "/ATHENA-PRESERVE-UPGRADE" $R1
    ${IfNot} ${Errors}
      ReadEnvStr $R2 ATHENA_UPGRADE_EXPECTED_ROOT
      ${If} $R2 == ""
      ${OrIf} $INSTDIR != $R2
        !insertmacro AthenaUpgradeFailure
      ${EndIf}
    ${EndIf}
  !macroend

  !macro customUnInit
    ${GetParameters} $R0
    ClearErrors
    ${GetOptions} $R0 "/ATHENA-PRESERVE-UPGRADE" $R1
    ${IfNot} ${Errors}
      ; initMultiUser can replace _?= when a legacy install has no
      ; InstallLocation. The initial process check already validated this root.
      ReadEnvStr $INSTDIR ATHENA_UPGRADE_EXPECTED_ROOT
      ${If} $INSTDIR == ""
        !insertmacro AthenaUpgradeFailure
      ${EndIf}
    ${EndIf}
  !macroend

  !macro customRemoveFiles
    ${GetParameters} $R0
    ClearErrors
    ${GetOptions} $R0 "/ATHENA-PRESERVE-UPGRADE" $R1
    ${IfNot} ${Errors}
      ${IfNot} ${isUpdated}
        !insertmacro AthenaUpgradeFailure
      ${EndIf}
      !insertmacro AthenaValidateUpgradeUninstallerRoot
      ; The executable runs from the parent's plugin directory. Move our CWD
      ; too before atomically renaming the entire previous install directory.
      SetOutPath $TEMP
      InitPluginsDir
      File /oname=$PLUGINSDIR\athena-upgrade.ps1 "${ATHENA_UPGRADE_SCRIPT}"
      !insertmacro AthenaRunUpgradeHelper Preserve
      ${If} $R0 != 0
        !insertmacro AthenaUpgradeFailure
      ${EndIf}
    ${Else}
      ; Preserve the pinned builder's normal direct-uninstall behavior.
      ${If} ${isUpdated}
        CreateDirectory "$PLUGINSDIR\old-install"
        Push ""
        Call un.atomicRMDir
        Pop $R0
        ${If} $R0 != 0
          DetailPrint "File is busy, aborting: $R0"
          Push ""
          Call un.restoreFiles
          Pop $R0
          Abort 'Cannot move previous installation files.'
        ${EndIf}
      ${EndIf}
      SetOutPath $TEMP
      RMDir /r $INSTDIR
    ${EndIf}
  !macroend
!endif
