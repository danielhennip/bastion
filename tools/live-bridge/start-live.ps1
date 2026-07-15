# Zuidplas Live-brug — starten. Voer uit in PowerShell:  .\start-live.ps1
# Leest .env (gemaakt door setup-windows.ps1) en start de transcriptie.
# Zorg dat de vergadering in je browser speelt met geluid aan.

$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot

$envFile = Join-Path $PSScriptRoot '.env'
if (-not (Test-Path $envFile)) {
  Write-Host "Geen .env gevonden. Draai eerst .\setup-windows.ps1" -ForegroundColor Red
  exit 1
}

# PATH verversen zodat node/ffmpeg zeker gevonden worden.
$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' +
            [System.Environment]::GetEnvironmentVariable('Path','User')

Write-Host "Live-brug starten... (stoppen: Ctrl + C)`n" -ForegroundColor Cyan
node transcribe.mjs

Pop-Location
