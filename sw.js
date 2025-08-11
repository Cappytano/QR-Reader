const CACHE_NAME='qr-logger-v5-1';
const ASSETS=['./','./index.html','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png','https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js','https://cdn.jsdelivr.net/npm/xlsx@0.19.3/dist/xlsx.full.min.js','https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(ASSETS)))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))))});
self.addEventListener('fetch',e=>{const url=new URL(e.request.url);if(ASSETS.some(a=>url.href.startsWith(a)||url.pathname.endsWith(a))){e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));return;}e.respondWith(fetch(e.request).then(resp=>{const copy=resp.clone();caches.open(CACHE_NAME).then(c=>c.put(e.request,copy));return resp;}).catch(()=>caches.match(e.request)));});
