@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy RemoteSigned -File "%~dp0tools\Start-Preview.ps1"
exit /b %errorlevel%
