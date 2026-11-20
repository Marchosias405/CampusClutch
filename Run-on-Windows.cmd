@echo off
setlocal
set "ADB="
if defined ANDROID_HOME if exist "%ANDROID_HOME%\platform-tools\adb.exe" set "ADB=%ANDROID_HOME%\platform-tools\adb.exe"
if not defined ADB if defined ANDROID_SDK_ROOT if exist "%ANDROID_SDK_ROOT%\platform-tools\adb.exe" set "ADB=%ANDROID_SDK_ROOT%\platform-tools\adb.exe"
if not defined ADB if exist "%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe" set "ADB=%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe"
if not defined ADB for %%I in (adb.exe) do set "ADB=%%~$PATH:I"
if not defined ADB (
  echo Drag CampusClutch-Preview.apk onto your running emulator to install it.
  goto failed
)
"%ADB%" -e get-state >nul 2>&1
if errorlevel 1 (
  echo Open one phone in Android Studio Device Manager and wait for its home screen.
  goto failed
)
"%ADB%" -e install -r "%~dp0CampusClutch-Preview.apk"
if errorlevel 1 goto failed
"%ADB%" -e shell am start -n com.marchosias405.campusclutch/.MainActivity
if errorlevel 1 goto failed
exit /b 0

:failed
pause
exit /b 1
