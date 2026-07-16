@echo off
rem ============================================================
rem  Zuidplas Live-brug - ONBEMANDE START (voor de geplande taak)
rem  Opent zelf de stream in de browser (autoplay aan), start de
rem  transcriptie, en stopt automatisch na MAX_MINUTES (std. 240).
rem  Handmatig starten kan ook: gewoon dubbelklikken.
rem ============================================================
setlocal
cd /d "%~dp0"

echo [1/4] Code bijwerken vanaf GitHub...
git fetch origin claude/read-other-chat-3rr64o
if not errorlevel 1 (
  git add -A >nul 2>&1
  git diff --cached --quiet >nul 2>&1 || git -c user.name="Zuidplas Live-brug" -c user.email="live-bridge@bastion.local" commit -m "wip: lokale wijzigingen bewaard voor update" --quiet
  git checkout claude/read-other-chat-3rr64o >nul 2>&1 || git checkout -b claude/read-other-chat-3rr64o origin/claude/read-other-chat-3rr64o
  git pull --rebase origin claude/read-other-chat-3rr64o
)

echo [2/4] Stream openen in de browser (autoplay aan)...
rem LIVE_URL/LIVE_BROWSER uit tools\live-bridge\.env lezen.
set "LIVE_URL=https://zuidplas.notubiz.nl"
set "LIVE_BROWSER="
for /f "usebackq tokens=1,* delims==" %%a in ("tools\live-bridge\.env") do (
  if /i "%%a"=="LIVE_URL" set "LIVE_URL=%%b"
  if /i "%%a"=="LIVE_BROWSER" set "LIVE_BROWSER=%%b"
)
rem Geen voorkeur ingesteld? Kijk welke browser de standaard is in Windows.
set "PROGID="
for /f "tokens=3" %%i in ('reg query "HKCU\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\https\UserChoice" /v ProgId 2^>nul') do set "PROGID=%%i"
if not defined LIVE_BROWSER echo %PROGID% | findstr /i chrome  >nul && set "LIVE_BROWSER=chrome"
if not defined LIVE_BROWSER echo %PROGID% | findstr /i brave   >nul && set "LIVE_BROWSER=brave"
if not defined LIVE_BROWSER echo %PROGID% | findstr /i edge    >nul && set "LIVE_BROWSER=msedge"
if defined LIVE_BROWSER (
  rem Chromium-browsers: autoplay afdwingen zodat de stream vanzelf speelt.
  start "" %LIVE_BROWSER% --autoplay-policy=no-user-gesture-required --new-window "%LIVE_URL%"
) else (
  rem Onbekende/andere standaardbrowser (bijv. Firefox): gewoon openen.
  start "" "%LIVE_URL%"
)

echo [3/4] 45 seconden wachten tot de stream speelt...
timeout /t 45 /nobreak >nul

echo [4/4] Live-brug starten (stopt vanzelf na afloop)...
cd tools\live-bridge
if not defined MAX_MINUTES set "MAX_MINUTES=240"
node transcribe.mjs

echo Klaar. Venster sluit over 30 seconden.
timeout /t 30 >nul
