# Zuidplas Live-brug — eenmalige installatie voor Windows.
# Voer uit in PowerShell:  .\setup-windows.ps1
# Installeert Node.js, ffmpeg en Git (via winget), doet npm install,
# vraagt je OpenAI-sleutel, en helpt je de juiste audiobron te kiezen.

$ErrorActionPreference = 'Stop'
Write-Host "`n=== Zuidplas Live-brug installatie ===`n" -ForegroundColor Cyan

function Have($cmd) { $null -ne (Get-Command $cmd -ErrorAction SilentlyContinue) }

# 1. winget aanwezig?
if (-not (Have winget)) {
  Write-Host "winget ontbreekt. Installeer 'App Installer' uit de Microsoft Store en start opnieuw." -ForegroundColor Red
  exit 1
}

# 2. Node, ffmpeg, git installeren (slaat over wat er al is).
$pkgs = @(
  @{ id = 'OpenJS.NodeJS.LTS'; cmd = 'node' },
  @{ id = 'Gyan.FFmpeg';       cmd = 'ffmpeg' },
  @{ id = 'Git.Git';           cmd = 'git' }
)
foreach ($p in $pkgs) {
  if (Have $p.cmd) {
    Write-Host ("[ok] {0} is al aanwezig." -f $p.cmd) -ForegroundColor Green
  } else {
    Write-Host ("[..] {0} installeren..." -f $p.id) -ForegroundColor Yellow
    winget install --id $p.id -e --source winget --accept-package-agreements --accept-source-agreements
  }
}

# 3. PATH verversen in dit venster.
$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' +
            [System.Environment]::GetEnvironmentVariable('Path','User')

# 4. npm install in deze map.
Push-Location $PSScriptRoot
Write-Host "`n[..] npm install..." -ForegroundColor Yellow
npm install
Pop-Location

# 5. OpenAI-sleutel opvragen en in .env zetten.
$envFile = Join-Path $PSScriptRoot '.env'
$key = Read-Host "`nPlak je OpenAI API-sleutel (begint met sk-...). Enter om over te slaan"
if ($key) {
  "OPENAI_API_KEY=$key" | Out-File -FilePath $envFile -Encoding utf8
  Write-Host "[ok] Sleutel opgeslagen in .env (wordt niet meegecommit)." -ForegroundColor Green
}

# 6. Audio-apparaten tonen zodat je de juiste kiest.
Write-Host "`n=== Beschikbare audio-invoerapparaten ===" -ForegroundColor Cyan
Write-Host "Zoek hieronder een naam met '(audio)', bijv. 'Stereo Mix' of 'CABLE Output'.`n"
& ffmpeg -hide_banner -list_devices true -f dshow -i dummy 2>&1 | Select-String '\(audio\)'

Write-Host "`nGeen 'Stereo Mix'? Zet 'm aan via: rechtsklik luidspreker-icoon >" -ForegroundColor Yellow
Write-Host "Geluidsinstellingen > Meer geluidsinstellingen > tab Opnemen >" -ForegroundColor Yellow
Write-Host "rechtsklik > 'Uitgeschakelde apparaten weergeven' > Stereo Mix > Inschakelen." -ForegroundColor Yellow
Write-Host "Of installeer gratis VB-CABLE (https://vb-audio.com/Cable/).`n"

$dev = Read-Host "Typ de exacte apparaatnaam (zonder aanhalingstekens), bijv. Stereo Mix (Realtek(R) Audio)"
if ($dev) {
  Add-Content -Path $envFile -Value "FFMPEG_FORMAT=dshow"
  Add-Content -Path $envFile -Value ("FFMPEG_INPUT=audio={0}" -f $dev)
  Add-Content -Path $envFile -Value "PUSH=1"
  Write-Host "[ok] Audiobron opgeslagen in .env." -ForegroundColor Green
}

Write-Host "`n=== Klaar! ===" -ForegroundColor Green
Write-Host "Start de vergadering in je browser (geluid aan) en dubbelklik daarna" -ForegroundColor Cyan
Write-Host "    START-LIVE.cmd  (in de hoofdmap van de repo)`n" -ForegroundColor White
