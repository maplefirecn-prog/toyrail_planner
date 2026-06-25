@echo off
setlocal
cd /d "%~dp0"

set PORT=8765

py -3 --version >nul 2>nul
if %ERRORLEVEL%==0 (
  start "RailDesign Local MVP Server" cmd /k "cd /d ""%~dp0"" && py -3 -m http.server %PORT% --bind 127.0.0.1"
  timeout /t 2 /nobreak >nul
  start "" "http://127.0.0.1:%PORT%/"
  exit /b 0
)

python --version >nul 2>nul
if %ERRORLEVEL%==0 (
  start "RailDesign Local MVP Server" cmd /k "cd /d ""%~dp0"" && python -m http.server %PORT% --bind 127.0.0.1"
  timeout /t 2 /nobreak >nul
  start "" "http://127.0.0.1:%PORT%/"
  exit /b 0
)

echo Python was not found.
echo Opening index.html directly instead.
start "" "%~dp0index.html"
pause
