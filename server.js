const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;
const ROOT = __dirname;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.gz': 'application/gzip'
};

http.createServer(function (req, res) {
  try {
    var urlPath = (req.url || '').split('?')[0] || '/';
    if (urlPath === '/') {
      urlPath = '/index.html';
    }

    // Normalize and prevent directory traversal
    var safePath = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
    var filePath = path.join(ROOT, safePath);

    fs.readFile(filePath, function (err, data) {
      if (err) {
        res.statusCode = err.code === 'ENOENT' ? 404 : 500;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end(err.code === 'ENOENT' ? 'Not found' : 'Server error');
        return;
      }

      var ext = path.extname(filePath).toLowerCase();
      res.statusCode = 200;
      res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
      // We don't differentiate GET/HEAD; browsers will discard the body for HEAD.
      res.end(data);
    });
  } catch (e) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Server error');
  }
}).listen(PORT, function () {
  console.log('Dev server on http://localhost:' + PORT);
});
