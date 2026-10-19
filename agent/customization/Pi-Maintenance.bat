@echo off
setlocal
chcp 65001 >nul
where pwsh.exe >nul 2>&1
if errorlevel 1 (
  set "PI_MAINT_PS=powershell.exe"
) else (
  set "PI_MAINT_PS=pwsh.exe"
)
"%PI_MAINT_PS%" -NoLogo -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0Maintain-Pi.ps1" %*
set "PI_MAINT_EXIT=%ERRORLEVEL%"
if not "%PI_MAINT_EXIT%"=="0" pause
exit /b %PI_MAINT_EXIT%
