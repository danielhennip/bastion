# Registreert (of verwijdert) de geplande Windows-taak die op vergaderavonden
# automatisch AUTO-LIVE.cmd start: stream openen + transcriberen + vanzelf
# stoppen. De laptop hoeft alleen aan te staan (en jij ingelogd te zijn).
#
# Gebruik (via INSTALL-AUTOSTART.cmd in de hoofdmap, of los):
#   register-autostart.ps1                     -> elke dinsdag 19:55
#   register-autostart.ps1 -Day Monday -Time 19:25
#   register-autostart.ps1 -Remove             -> taak weer verwijderen

param(
  [string]$Day = 'Tuesday',
  [string]$Time = '19:55',
  [switch]$Remove
)

$ErrorActionPreference = 'Stop'
$taskName = 'Zuidplas Live-brug'
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$cmdPath  = Join-Path $repoRoot 'AUTO-LIVE.cmd'

if ($Remove) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "[ok] Geplande taak '$taskName' verwijderd (als die bestond)." -ForegroundColor Green
  exit 0
}

if (-not (Test-Path $cmdPath)) {
  Write-Host "FOUT: $cmdPath niet gevonden." -ForegroundColor Red
  exit 1
}

$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek $Day -At $Time
$action  = New-ScheduledTaskAction -Execute $cmdPath -WorkingDirectory $repoRoot
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable `
  -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Hours 11)

Register-ScheduledTask -TaskName $taskName -Trigger $trigger -Action $action `
  -Settings $settings -Description 'Start automatisch de Zuidplas live-transcriptie op vergaderavond.' -Force | Out-Null

Write-Host "[ok] Geplande taak '$taskName' ingesteld: elke $Day om $Time." -ForegroundColor Green
Write-Host "     De laptop moet dan aanstaan en jij ingelogd zijn." -ForegroundColor Cyan
Write-Host "     Aanpassen: dit script opnieuw draaien met -Day/-Time." -ForegroundColor Cyan
Write-Host "     Verwijderen: dit script draaien met -Remove." -ForegroundColor Cyan
