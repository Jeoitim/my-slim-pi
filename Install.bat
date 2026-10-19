@echo off
setlocal
where pwsh.exe >nul 2>&1
if errorlevel 1 (echo PowerShell 7 is required. & pause & exit /b 1)
pwsh.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Install-MySlimPi.ps1" %*
set "result=%errorlevel%"
if not "%result%"=="0" pause
exit /b %result%
