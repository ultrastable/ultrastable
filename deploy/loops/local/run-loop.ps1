# Windows host. Install once: schtasks /Create /SC HOURLY /TN "UltrastableLoop" /TR "powershell -File <repo>\deploy\loops\local\run-loop.ps1" /F
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..\..\..")
$env:ULTRASTABLE_HOST = "windows-task"
python -m foundation launch --failover --commit --push
