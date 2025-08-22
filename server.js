
// Minimal local dev server (http). For camera, prefer https or http://localhost in Chrome/Edge.
const http = require('http');
const fs = require('fs');
const path = require('path');
const PORT = process.env.PORT || 8080;
const mime = { ".html":"text/html", ".js":"text/javascript", ".css":"text/css", ".json":"application/json", ".png":"image/png", ".webmanifest":"application/manifest+json" };
http.createServer((req,res)=>{
  let p = req.url.split('?')[0];
  if(p==='/'||p==='') p='/index.html';
  const fp = path.join(__dirname, p);
  fs.readFile(fp, (err,buf)=>{
    if(err){ res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(fp).toLowerCase();
    res.writeHead(200, {'Content-Type': mime[ext]||'application/octet-stream'});
    res.end(buf);
  });
}).listen(PORT, ()=> console.log('Dev server on http://localhost:'+PORT));
