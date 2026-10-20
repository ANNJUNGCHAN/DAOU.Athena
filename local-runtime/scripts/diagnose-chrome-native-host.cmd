@echo off
setlocal
powershell.exe -NoLogo -NoProfile -File "%~dp0diagnose-chrome-native-host.ps1" -Mode Launch -OpenWts
echo.
if errorlevel 1 (
  echo ATHENA diagnostic Chrome could not be started.
) else (
  echo Keep the logPath shown above. Reproduce the ATHENA connection error, then run Collect.
)
pause
endlocal
