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
rem LIVE_URL uit tools\live-bridge\.env lezen; anders de Notubiz-portal.
set "LIVE_URL=https://zuidplas.notubiz.nl"
for /f "usebackq tokens=1,* delims==" %%a in ("tools\live-bridge\.env") do (
  if /i "%%a"=="LIVE_URL" set "LIVE_URL=%%b"
)
start "" msedge --autoplay-policy=no-user-gesture-required --new-window "%LIVE_URL%"

echo [3/4] 45 seconden wachten tot de stream speelt...
timeout /t 45 /nobreak >nul

echo [4/4] Live-brug starten (stopt vanzelf na afloop)...
cd tools\live-bridge
if not defined MAX_MINUTES set "MAX_MINUTES=240"
node transcribe.mjs

echo Klaar. Venster sluit over 30 seconden.
timeout /t 30 >nul
