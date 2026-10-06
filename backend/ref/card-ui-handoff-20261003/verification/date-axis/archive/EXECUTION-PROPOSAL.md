# V3 execution proposal

NOT_EXECUTED; independent source review and root renderer slot required. Existing V2 baseline18/18captures reused, not fresh. Candidate alone uses identical run/observer/input/states at2560x1392/1411x1166.

```powershell
$axisOwned = Start-Process -FilePath 'C:\Projects\DAOU.Athena\app\node_modules\electron\dist\electron.exe' -ArgumentList @('C:\Projects\DAOU.Athena\.omc\artifacts\card-ui-audit\chart-date-axis-public-v3\run.cjs','--fixture-mode=candidate') -WindowStyle Hidden -PassThru
$axisOwned.WaitForExit()
[pscustomobject]@{pid=$axisOwned.Id; exit=$axisOwned.ExitCode; absent=($null -eq (Get-Process -Id $axisOwned.Id -ErrorAction SilentlyContinue))} | ConvertTo-Json -Compress
```

normal require_escalated context, no PS-File/ExecutionPolicy/feature flags. Output only this folder/runs/candidate public-profile/report18/18PNG; unknown run prevents another launch. Product/native/provider/private0. Exact source/candidate pins are in manifest; candidate library bundle survives reinstall as repository app/lib source, not a node_modules edit.
