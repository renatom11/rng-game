@echo off
REM Summit setup for Windows. Double-click this file, or run  .\setup.cmd
REM It calls node directly, so PowerShell's script-execution policy (which
REM blocks npm's .ps1 shim on a default Windows install) never comes up.
setlocal

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed, or not on your PATH.
  echo   Install the LTS build from https://nodejs.org and run this again.
  echo.
  pause
  exit /b 1
)

node "%~dp0scripts\setup-cloudflare.mjs" %*
set EXITCODE=%ERRORLEVEL%

REM Keep the window open when double-clicked, so the result stays readable.
echo %cmdcmdline% | find /i "%~nx0" >nul
if not errorlevel 1 pause
exit /b %EXITCODE%
