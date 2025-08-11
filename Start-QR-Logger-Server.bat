@echo off
REM Start local server for QR Logger (prefers Node, falls back to Python)
set PORT=5500
where node >nul 2>nul
if %ERRORLEVEL%==0 (
  echo Node detected. Installing dependencies (if needed)...
  call npm install >nul
  echo Starting Node server...
  start "" node server.js
  timeout /t 1 >nul
  start "" http://localhost:%PORT%
  exit /b 0
)
where python >nul 2>nul
if %ERRORLEVEL%==0 (
  echo Node not found. Using Python http.server...
  start "" python -m http.server %PORT%
  timeout /t 1 >nul
  start "" http://localhost:%PORT%
  exit /b 0
)
echo Neither Node nor Python found. Please install Node.js or Python 3.
echo Then run: node server.js   or   python -m http.server 5500
pause
