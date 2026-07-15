@echo off
rem ============================================================
rem  Zuidplas Live-brug - START (dubbelklik dit bestand)
rem  Werkt de code bij, en start daarna de live-transcriptie.
rem  Stoppen: Ctrl + C in dit venster.
rem ============================================================
setlocal
cd /d "%~dp0"

echo.
echo [1/3] Code bijwerken vanaf GitHub...
git fetch origin claude/read-other-chat-3rr64o
if errorlevel 1 (
  echo   Kon GitHub niet bereiken - ik ga door met de huidige versie.
) else (
  rem Bewaar eventuele lokale wijzigingen zodat de update nooit iets wist.
  git add -A >nul 2>&1
  git diff --cached --quiet >nul 2>&1 || git -c user.name="Zuidplas Live-brug" -c user.email="live-bridge@bastion.local" commit -m "wip: lokale wijzigingen bewaard voor update" --quiet
  git checkout claude/read-other-chat-3rr64o >nul 2>&1 || git checkout -b claude/read-other-chat-3rr64o origin/claude/read-other-chat-3rr64o
  git pull --rebase origin claude/read-other-chat-3rr64o
)

echo.
echo [2/3] Controle van de installatie...
where node >nul 2>&1 || (echo   FOUT: Node.js niet gevonden. Zie tools\live-bridge\WINDOWS.md & pause & exit /b 1)
where ffmpeg >nul 2>&1 || (echo   FOUT: ffmpeg niet gevonden. Zie tools\live-bridge\WINDOWS.md & pause & exit /b 1)
if not exist "tools\live-bridge\.env" (
  echo   FOUT: tools\live-bridge\.env ontbreekt. Zie tools\live-bridge\WINDOWS.md
  pause
  exit /b 1
)

echo.
echo [3/3] Live-brug starten. Zet de vergadering aan in je browser
echo       met het geluid AAN. Stoppen: Ctrl + C.
echo.
cd tools\live-bridge
node transcribe.mjs

echo.
echo Live-brug gestopt.
pause
