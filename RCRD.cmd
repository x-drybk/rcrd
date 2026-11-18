@echo off
setlocal
title RCRD

:menu
cls
echo RCRD
echo.
echo   Music discovery and record collecting
echo   -------------------------------------
echo.
echo   1. Start or open RCRD
echo   2. Restart RCRD
echo   3. Stop RCRD
echo   4. Show status
echo   5. Check setup and diagnostics
echo   6. Exit
echo.
echo   This window is the RCRD control panel. It is only needed when you
echo   want to restart, stop, or check the local server.
echo.
choice /C 123456 /N /M "Choose an option [1-6]: "

if errorlevel 6 exit /b 0
if errorlevel 5 goto check
if errorlevel 4 goto status
if errorlevel 3 goto stop
if errorlevel 2 goto restart
if errorlevel 1 goto start

:start
PowerShell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Start-RCRD.ps1" -Action start -RcrdChrome
goto done

:restart
PowerShell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Start-RCRD.ps1" -Action restart -NoBrowser
goto done

:stop
PowerShell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Start-RCRD.ps1" -Action stop
goto done

:status
PowerShell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Start-RCRD.ps1" -Action status
goto done

:check
PowerShell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Start-RCRD.ps1" -Action check

:done
echo.
pause
goto menu
