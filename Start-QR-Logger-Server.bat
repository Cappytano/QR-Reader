@echo off
setlocal
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not found. Please install Node LTS from https://nodejs.org/
  pause
  exit /b 1
)
npm i
node server.js
pause
