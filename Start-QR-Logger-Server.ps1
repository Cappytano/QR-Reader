# Start-QR-Logger-Server.ps1
# Starts a local HTTP server on http://localhost:5500 using Node if available;
# otherwise tries Python's http.server; finally prints instructions.
param(
  [int]$Port = 5500
)

function Open-Browser($url) {
  try { Start-Process $url } catch { Write-Host "Open this URL in your browser: $url" }
}

Write-Host "Starting local server for QR Logger on port $Port..."

# Try Node + our express server
if (Get-Command node -ErrorAction SilentlyContinue) {
  if (Test-Path -LiteralPath "package.json") {
    Write-Host "Node detected. Installing dependencies if needed..."
    npm install | Out-Null
    Write-Host "Launching Node server..."
    Start-Process -NoNewWindow -FilePath "node" -ArgumentList "server.js"
    Start-Sleep -Seconds 1
    Open-Browser "http://localhost:$Port"
    exit 0
  }
}

# Fallback: Python http.server
if (Get-Command python -ErrorAction SilentlyContinue) {
  Write-Host "Node not found. Using Python http.server as fallback."
  $script = "import http.server, socketserver; p=$env:PORT or str($Port); p=int(p); print('Serving at http://localhost:'+str(p)); http.server.SimpleHTTPRequestHandler.extensions_map.update({'.js':'application/javascript'}); socketserver.TCPServer(('',p), http.server.SimpleHTTPRequestHandler).serve_forever()"
  Start-Process -NoNewWindow -FilePath "python" -ArgumentList "-c", $script
  Start-Sleep -Seconds 1
  Open-Browser "http://localhost:$Port"
  exit 0
}

Write-Host "Neither Node nor Python was found. Install Node.js (Recommended) or Python 3."
Write-Host "Then run:  node server.js   or   python -m http.server 5500"
