@echo off
rem ============================================================
rem  Zet de automatische start aan: elke dinsdag 19:55 opent de
rem  laptop zelf de stream en start de transcriptie (AUTO-LIVE.cmd).
rem  Dubbelklik dit bestand een keer. Andere dag/tijd? Zie
rem  tools\live-bridge\register-autostart.ps1
rem ============================================================
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "tools\live-bridge\register-autostart.ps1" %*
pause
