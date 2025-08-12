# PowerShell launcher
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "Node.js not found. Install Node LTS from https://nodejs.org/" -ForegroundColor Yellow
  Read-Host "Press Enter to exit"
  exit 1
}
npm i
node server.js
Read-Host "Press Enter to exit"
