@echo off
rem ============================================================
rem  Zet een knop "Zuidplas LIVE" op je bureaublad.
rem  Een keer dubbelklikken op DIT bestand is genoeg.
rem  Daarna start een dubbelklik op de bureaublad-knop alles:
rem  stream openen + transcriptie + vanzelf stoppen (AUTO-LIVE.cmd).
rem ============================================================
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ws = New-Object -ComObject WScript.Shell;" ^
  "$desktop = [Environment]::GetFolderPath('Desktop');" ^
  "$sc = $ws.CreateShortcut((Join-Path $desktop 'Zuidplas LIVE.lnk'));" ^
  "$sc.TargetPath = '%~dp0AUTO-LIVE.cmd';" ^
  "$sc.WorkingDirectory = '%~dp0';" ^
  "$sc.IconLocation = '%%SystemRoot%%\System32\SHELL32.dll,246';" ^
  "$sc.Description = 'Start de Zuidplas live-transcriptie (stream + brug, stopt vanzelf)';" ^
  "$sc.Save();" ^
  "Write-Host '[ok] Knop \"Zuidplas LIVE\" staat op je bureaublad.' -ForegroundColor Green"
echo.
pause
