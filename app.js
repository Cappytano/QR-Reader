// QR-Reader v7.3.3a PATCH (app.js only) — Robust Tesseract init across versions; keep ZXing WASM + red OCR boxes
(function(){
  'use strict';
  function $(s){ return document.querySelector(s); }
  var video=$('#video'), overlay=$('#overlay'), octx=overlay.getContext('2d',{willReadFrequently:true});
  var statusEl=$('#status'), cameraSelect=$('#cameraSelect'), prefFacing=$('#prefFacing'), enginePill=$('#scanEngine'), permStateEl=$('#permState');
  var cooldownSecInput=$('#cooldownSec'), ignoreDupChk=$('#ignoreDup'), resetDupBtn=$('#resetDup');
  var fileInput=$('#fileInput');
  var cameraSourceSel=$('#cameraSource');
  var delaySecInput=$('#delaySec'), scaleModeSel=$('#scaleMode');
  var exportXlsxBtn=$('#exportXlsx'), exportCsvBtn=$('#exportCsv'), exportZipBtn=$('#exportZip'), clearBtn=$('#clearBtn');
  var toastEl=$('#toast'), ocrStatus=$('#ocrStatus'), testOCRBtn=$('#testOCR'), ocrToggleBtn=$('#ocrToggle');

  var stream=null, scanning=false, detector=null;
  var data=[]; var STORAGE_KEY='qrLoggerV7', PREF_KEY='qrPrefsV1';
  var cooldownUntil=0, scanTimer=null;
  var roi = { x:0.58, y:0.58, w:0.40, h:0.38, show:false, hasText:false };
  var ocrPulseTimer=null;
  var seenEver = new Set();
  var lastOCRBoxes=[];
  var ocr = { worker:null, ready:false, usingWorker:false, failedWorker:false };

  function setStatus(t){ if(statusEl){ statusEl.textContent=t||''; } }
  function setOCRStatus(t){ if(ocrStatus){ ocrStatus.textContent='OCR: '+t; } }
  function toast(t){
    if(!toastEl) return;
    toastEl.textContent=t;
    toastEl.style.display='block';
    clearTimeout(toastEl._t);
    toastEl._t=setTimeout(function(){ toastEl.style.display='none'; }, 1800);
  }
  function save(){ try{ localStorage.setItem(STORAGE_KEY, JSON.stringify({rows:data,seen:Array.from(seenEver)})); }catch(e){} }
  function savePrefs(obj){ try { var p=loadPrefs(); for(var k in obj){ p[k]=obj[k]; } localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch(e){} }
  function loadPrefs(){ try { return JSON.parse(localStorage.getItem(PREF_KEY)||'{}'); } catch(e){ return {}; } }
  function load(){ try{ var p=JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}'); data=p.rows||[]; (p.seen||[]).forEach(function(v){seenEver.add(v)});}catch(e){ data=[]; } }
  function esc(s){ if(s==null) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function ts(){ return new Date().toISOString().slice(0,19).replace(/[:T]/g,'-'); }

  // dynamic loader
  function loadScript(src){ return new Promise(function(res,rej){ var s=document.createElement('script'); s.src=src; s.onload=function(){res();}; s.onerror=function(){rej(new Error('Failed to load '+src));}; document.head.appendChild(s); }); }
  function ensureJsQR(){ if(window.jsQR) return Promise.resolve(true); return loadScript('vendor/jsQR.js').then(function(){ return !!window.jsQR; }).catch(function(e){ console.warn(e); return false; }); }

  // === ZXing WASM loader ===
  var ZXING_WASM_LOADED=false;
  function ensureZXingWASM(){
    if (ZXING_WASM_LOADED || (window.ZXingWASM && (window.ZXingWASM.readBarcodesFromImageData || window.ZXingWASM.instantiate))) {
      ZXING_WASM_LOADED=true; return Promise.resolve(true);
    }
    return loadScript('vendor/zxing-wasm-reader.iife.js').then(function(){
      try{
        if (window.ZXingWASM && typeof window.ZXingWASM.setWasmUrl==='function'){
          window.ZXingWASM.setWasmUrl('vendor/zxing_reader.wasm');
        } else if (window.ZXingWASM && typeof window.ZXingWASM.instantiate==='function'){
          if (!window.ZXingWASM._instantiating){
            window.ZXingWASM._instantiating = true;
            return window.ZXingWASM.instantiate({locateFile:function(path){ return path.endsWith('.wasm')?'vendor/zxing_reader.wasm':path; }}).then(function(){
              ZXING_WASM_LOADED=true; return true;
            }).catch(function(e){ console.warn('ZXingWASM instantiate failed', e); return false; });
          }
        }
      }catch(e){ console.warn('ZXingWASM config', e); }
      ZXING_WASM_LOADED=true; return true;
    }).catch(function(e){ console.warn('ZXing WASM load error', e); return false; });
  }

  // === OCR (Tesseract) ===
  function ensureTesseract(){ if(window.Tesseract) return Promise.resolve(true); return loadScript('vendor/tesseract.min.js').then(function(){ return !!window.Tesseract; }).catch(function(e){ console.warn(e); return false; }); }
  function tesseractOpts(){ return { workerPath:'vendor/worker.min.js', corePath:'vendor/tesseract-core/tesseract-core.wasm.js', langPath:'vendor/lang-data', gzip:true }; }

  function ensureWorker(){
    if(ocr.ready || ocr.failedWorker) return Promise.resolve(ocr.ready);
    return ensureTesseract().then(function(ok){
      if(!ok || !window.Tesseract || typeof window.Tesseract.createWorker!=='function'){
        // No worker API in this build; skip to simple mode
        ocr.failedWorker = true; return false;
      }
      var created;
      try{ created = window.Tesseract.createWorker(tesseractOpts()); }
      catch(e){ console.warn('createWorker threw', e); ocr.failedWorker = true; return false; }

      // Some builds return a Promise<worker>, others return worker directly
      var prom = (created && typeof created.then==='function') ? created : Promise.resolve(created);
      return prom.then(function(w){
        if(!w || typeof w.load!=='function'){ ocr.failedWorker = true; return false; }
        ocr.worker = w;
        return ocr.worker.load()
          .then(function(){ return ocr.worker.loadLanguage('eng'); })
          .then(function(){ return ocr.worker.initialize('eng'); })
          .then(function(){
            // setParameters may not exist on older builds
            if (typeof ocr.worker.setParameters==='function'){
              return ocr.worker.setParameters({
                tessedit_char_whitelist:'0123456789.kggrmlbozOZ',
                tessedit_pageseg_mode:'7',
                preserve_interword_spaces:'1',
                user_defined_dpi:'300'
              }).catch(function(){ /* ignore */ });
            }
          })
          .then(function(){ ocr.ready=true; ocr.usingWorker=true; setOCRStatus('Ready (worker)'); return true; })
          .catch(function(err){ console.warn('worker init error', err); ocr.worker=null; ocr.ready=false; ocr.usingWorker=false; ocr.failedWorker=true; return false; });
      }).catch(function(err){ console.warn('createWorker promise failed', err); ocr.failedWorker=true; return false; });
    });
  }

  function recognizeSimple(canvas){
    return ensureTesseract().then(function(ok){
      if(!ok || !window.Tesseract || typeof window.Tesseract.recognize!=='function') return { text:'', boxes:[] };
      // Try v2+ signature first: (image, 'eng', options)
      return window.Tesseract.recognize(canvas, 'eng', tesseractOpts())
        .then(extractTextAndBoxes)
        .catch(function(){
          // Fallback to v1 signature: (image, options) with {lang:'eng'}
          try{
            return window.Tesseract.recognize(canvas, { lang:'eng' }).then(extractTextAndBoxes).catch(function(){ return { text:'', boxes:[] }; });
          }catch(_e){
            return { text:'', boxes:[] };
          }
        });
    });
  }

  function extractTextAndBoxes(res){
    var txt=(res && res.data && res.data.text)||'';
    var boxes=[];
    function pushBox(b){
      if(!b) return;
      var bb=b.bbox||b;
      var x0=(bb.x0!=null)?bb.x0:bb.left, y0=(bb.y0!=null)?bb.y0:bb.top, x1=(bb.x1!=null)?bb.x1:bb.right, y1=(bb.y1!=null)?bb.y1:bb.bottom;
      if([x0,y0,x1,y1].some(function(v){return typeof v!=='number'||isNaN(v);})){ return; }
      boxes.push({x0:x0,y0:y0,x1:x1,y1:y1});
    }
    var d=res && res.data;
    var arrays=[(d&&d.words)||[], (d&&d.lines)||[], (d&&d.blocks)||[], (d&&d.symbols)||[]];
    for(var a=0;a<arrays.length && boxes.length<60;a++){
      var arr=arrays[a]; if(!Array.isArray(arr)||!arr.length) continue;
      for(var i=0;i<arr.length && boxes.length<60;i++){ pushBox(arr[i]); }
      if(boxes.length) break;
    }
    return { text:txt, boxes:boxes };
  }

  function upscaleForOCR(src){
    var scale=(src.width*src.height<180*120)?3:2;
    var w=Math.max(1,src.width*scale), h=Math.max(1,src.height*scale);
    var c=document.createElement('canvas'); c.width=w; c.height=h;
    var ctx=c.getContext('2d', { willReadFrequently:true });
    ctx.imageSmoothingEnabled=false; ctx.drawImage(src, 0,0,w,h);
    try{ var img=ctx.getImageData(0,0,w,h), d=img.data, n=d.length, thresh=150, contrast=1.35, bias=12;
      for(var i=0;i<n;i+=4){ var y=0.2126*d[i]+0.7152*d[i+1]+0.0722*d[i+2]; y=(y-128)*contrast+128; var v=(y>thresh?255:0); if(v===0 && y>thresh-bias) v=255; d[i]=d[i+1]=d[i+2]=v; d[i+3]=255; }
      ctx.putImageData(img,0,0);
    }catch(e){}
    return c;
  }

  function recognizeCanvasSmart(canvas, cb){
    setOCRStatus('Loading…');
    ensureWorker().then(function(ok){
      var pre=upscaleForOCR(canvas);
      if(ok && ocr.worker && typeof ocr.worker.recognize==='function'){
        ocr.worker.recognize(pre).then(function(res){ var out=extractTextAndBoxes(res); cb&&cb(out.text,out.boxes); })
          .catch(function(){ recognizeSimple(pre).then(function(out){ cb&&cb(out.text,out.boxes); }); });
      } else {
        recognizeSimple(pre).then(function(out){ cb&&cb(out.text,out.boxes); });
      }
    });
  }

  function decideFacing(){
    var p=prefFacing.value;
    if(p==='environment') return {facingMode:{ideal:'environment'}};
    if(p==='user') return {facingMode:{ideal:'user'}};
    return {facingMode:{ideal:'user'}};
  }
  function updatePerm(){
    if(!('permissions' in navigator)) return;
    try{ navigator.permissions.query({name:'camera'}).then(function(st){ if(permStateEl){ permStateEl.textContent='Permission: '+st.state; } st.onchange=function(){ if(permStateEl){ permStateEl.textContent='Permission: '+st.state; } }; }); }catch(e){}
  }
  function enumerateCams(){
    if(!(navigator.mediaDevices && navigator.mediaDevices.enumerateDevices)) return Promise.resolve([]);
    return navigator.mediaDevices.enumerateDevices().then(function(devs){
      var cams=[]; for(var i=0;i<devs.length;i++){ if(devs[i].kind==='videoinput') cams.push(devs[i]); }
      cameraSelect.innerHTML='';
      if(!cams.length){ var o=document.createElement('option'); o.value=''; o.textContent='No cameras detected'; cameraSelect.appendChild(o); return cams; }
      for(var j=0;j<cams.length;j++){ var c=cams[j]; var oo=document.createElement('option'); oo.value=c.deviceId||''; oo.textContent=c.label||('Camera '+(j+1)); cameraSelect.appendChild(oo); }
      return cams;
    }).catch(function(e){ setStatus('enumerateDevices failed: '+e.message); return []; });
  }
  function requestPermission(){
    try{ setStatus('Requesting camera permission…'); navigator.mediaDevices.getUserMedia({video:decideFacing(),audio:false}).then(function(s){ var tracks=s.getTracks(); for(var i=0;i<tracks.length;i++) tracks[i].stop(); setStatus('Permission granted.'); updatePerm(); enumerateCams(); }).catch(function(e){ setStatus('Permission request failed: '+(e.name||'')+' '+(e.message||e)); }); }catch(e){ setStatus('Permission error: '+(e.message||e)); }
  }

  // === Overlay sizing (DPR-aware) ===
  function sizeOverlay(){
    if(!video || !overlay || !octx) return;
    const r=video.getBoundingClientRect(), dpr=window.devicePixelRatio||1;
    overlay.style.width=r.width+'px'; overlay.style.height=r.height+'px';
    overlay.width=Math.max(1,Math.round(r.width*dpr)); overlay.height=Math.max(1,Math.round(r.height*dpr));
    octx.setTransform(dpr,0,0,dpr,0,0); drawROI();
  }
  window.addEventListener('resize', sizeOverlay);

  function useStream(s,label){
    stop(); stream=s; video.srcObject=stream;
    video.play().then(function(){ var track=stream.getVideoTracks()[0], st=track?track.getSettings():{}; setStatus((label||'Camera')+' started ('+(st.width||'?')+'×'+(st.height||'?')+')'); sizeOverlay(); initScanner(); }).catch(function(e){ setStatus('Video play failed: '+e.message); });
  }
  function startFromSelection(){
    if(cameraSourceSel.value==='remote'){ setStatus('Remote camera active (see remote.js).'); return; }
    if(cameraSourceSel.value==='serial'){ setStatus('Listening on Serial for codes…'); return; }
    var id=cameraSelect.value;
    try{ navigator.mediaDevices.getUserMedia({video:id?{deviceId:{exact:id}}:decideFacing(),audio:false}).then(function(s){ useStream(s,'Camera'); }).catch(function(e){ setStatus('getUserMedia error: '+e.message); }); }catch(e){ setStatus('Camera start error: '+(e.message||e)); }
  }
  function stop(){
    scanning=false;
    if(stream){ try{ stream.getTracks().forEach(function(t){t.stop();}); }catch(_e){} stream=null; }
    if(scanTimer) clearTimeout(scanTimer);
    try{ octx.clearRect(0,0,overlay.width,overlay.height); }catch(_e){}
    if(ocrPulseTimer) clearInterval(ocrPulseTimer);
    lastOCRBoxes=[];
    setOCRStatus('Off');
  }

  // === ENGINE SELECTION: BD → ZXing WASM → jsQR ===
  function initScanner(){
    if('BarcodeDetector' in window){
      try{
        var desired=['qr_code','data_matrix','aztec','pdf417','code_128','code_39','code_93','codabar','itf','ean_13','ean_8','upc_a','upc_e'];
        if(window.BarcodeDetector.getSupportedFormats){
          window.BarcodeDetector.getSupportedFormats().then(function(supported){
            var fmts=desired.filter(function(f){ return supported.indexOf(f)!==-1; });
            detector=new window.BarcodeDetector({formats: fmts.length?fmts:['qr_code']});
            if(enginePill) enginePill.textContent='Engine: BarcodeDetector';
            scanning=true; loopBD();
          }).catch(function(){
            detector=new window.BarcodeDetector({formats: desired});
            if(enginePill) enginePill.textContent='Engine: BarcodeDetector';
            scanning=true; loopBD();
          });
        } else {
          detector=new window.BarcodeDetector({formats: desired});
          if(enginePill) enginePill.textContent='Engine: BarcodeDetector';
          scanning=true; loopBD();
        }
        return;
      }catch(e){ /* go to WASM */ }
    }
    ensureZXingWASM().then(function(ok){
      if(ok){
        if(enginePill) enginePill.textContent='Engine: ZXing WASM';
        scanning=true; loopWASM(); return;
      }
      ensureJsQR().then(function(ok2){
        if(ok2 && window.jsQR){ if(enginePill) enginePill.textContent='Engine: jsQR'; scanning=true; loopJsQR(); return; }
        if(enginePill) enginePill.textContent='Engine: none';
        setStatus('No scanning engine available. Add vendor files or enable Shape Detection.');
      });
    });
  }

  // === BD loop ===
  function inCooldown(){ return Date.now()<cooldownUntil; }
  var pendingWeightTimer=null;
  function loopBD(){
    if(!scanning||!video||video.readyState<2){ scanTimer=setTimeout(loopBD,160); return; }
    if(inCooldown()){ scanTimer=setTimeout(loopBD,260); return; }
    detector.detect(video).then(function(res){
      if(res&&res.length){ var c=res[0]; var text=c.rawValue||''; if(text){ handleDetection(text, c.format||''); scanTimer=setTimeout(loopBD,220); return; } }
      scanTimer=setTimeout(loopBD,140);
    }).catch(function(){ scanTimer=setTimeout(loopBD,160); });
  }

  // === ZXing WASM loop ===
  var sample=document.createElement('canvas'), sctx=sample.getContext('2d',{willReadFrequently:true});
  function wasmDecodeFromImageData(imgData){
    try{
      if (window.ZXingWASM && typeof window.ZXingWASM.readBarcodesFromImageData==='function'){
        return window.ZXingWASM.readBarcodesFromImageData(imgData, {
          tryHarder:true,
          formats:['qr_code','data_matrix','aztec','pdf417','code_128','code_39','code_93','codabar','itf','ean_13','ean_8','upc_a','upc_e'],
          maxNumberOfSymbols:1
        });
      }
      if (window.ZXingWASM && typeof window.ZXingWASM.decode==='function'){
        return Promise.resolve(window.ZXingWASM.decode(imgData.data, imgData.width, imgData.height));
      }
    }catch(e){}
    return Promise.reject(new Error('ZXingWASM API not found'));
  }
  function loopWASM(){
    if(!scanning||!video||video.readyState<2){ scanTimer=setTimeout(loopWASM,160); return; }
    if(inCooldown()){ scanTimer=setTimeout(loopWASM,260); return; }
    var vw=video.videoWidth||0, vh=video.videoHeight||0; if(!vw||!vh){ scanTimer=setTimeout(loopWASM,160); return; }
    var MAXW=1024, scale=vw>MAXW?(MAXW/vw):1, sw=Math.max(1,Math.floor(vw*scale)), sh=Math.max(1,Math.floor(vh*scale));
    sample.width=sw; sample.height=sh; sctx.imageSmoothingEnabled=false; sctx.drawImage(video,0,0,sw,sh);
    var id; try{ id=sctx.getImageData(0,0,sw,sh); }catch(_e){ scanTimer=setTimeout(loopWASM,140); return; }
    wasmDecodeFromImageData(id).then(function(res){
      var arr = Array.isArray(res)?res:(res&&res.barcodes?res.barcodes:[]);
      if(arr && arr.length){
        var r=arr[0]; var txt=r.text||r.rawValue||r.data||''; var fmt=r.format||r.symbology||'';
        if(txt){ handleDetection(txt, fmt); scanTimer=setTimeout(loopWASM,220); return; }
      }
      scanTimer=setTimeout(loopWASM,140);
    }).catch(function(){ scanTimer=setTimeout(loopWASM,140); });
  }

  // === jsQR loop (QR-only) ===
  function loopJsQR(){
    if(!scanning||!video||video.readyState<2){ scanTimer=setTimeout(loopJsQR,180); return; }
    if(inCooldown()){ scanTimer=setTimeout(loopJsQR,300); return; }
    var vw=video.videoWidth||0, vh=video.videoHeight||0; if(!vw||!vh){ scanTimer=setTimeout(loopJsQR,160); return; }
    var MAXW=640, scale=vw>MAXW?(MAXW/vw):1, sw=Math.max(1,Math.floor(vw*scale)), sh=Math.max(1,Math.floor(vh*scale));
    sample.width=sw; sample.height=sh; sctx.imageSmoothingEnabled=false; sctx.drawImage(video,0,0,sw,sh);
    try{ var id=sctx.getImageData(0,0,sw,sh); var q=window.jsQR && window.jsQR(id.data, sw, sh, {inversionAttempts:'attemptBoth'}); if(q&&q.data){ handleDetection(q.data,'qr_code'); scanTimer=setTimeout(loopJsQR,220); return; } }catch(e){}
    scanTimer=setTimeout(loopJsQR,160);
  }

  // Handle a detection → log + cooldown + delayed weight/photo
  function handleDetection(text, fmt){
    if(!text) return;
    var ignoreDup=ignoreDupChk&&ignoreDupChk.checked;
    if(ignoreDup&&seenEver.has(text)) return;
    var now=new Date(), existing=null;
    for(var i=0;i<data.length;i++){ if(data[i].content===text){ existing=data[i]; break; } }
    if(existing){
      existing.count=(existing.count||1)+1;
      existing.timestamp=now.toISOString(); existing.date=now.toLocaleDateString(); existing.time=now.toLocaleTimeString();
      save(); render();
    } else {
      var row={ id:String(Date.now())+Math.random().toString(36).slice(2),
        content:text, format:fmt||'', source:'camera', timestamp: now.toISOString(),
        date:now.toLocaleDateString(), time:now.toLocaleTimeString(), weight:'', photo:'', count:1, notes:'' };
      data.unshift(row); save(); render();
    }
    if(ignoreDup) seenEver.add(text);
    var cd=parseFloat(cooldownSecInput.value||'5'); if(isNaN(cd)) cd=5; cd=Math.max(0,Math.min(10,cd)); cooldownUntil=Date.now()+Math.floor(cd*1000);
    var delayMs=Math.max(0,Math.min(4000,Math.floor(parseFloat(delaySecInput.value||'2')*1000)));
    if(pendingWeightTimer){ clearTimeout(pendingWeightTimer); }
    var last=data[0]; pendingWeightTimer=setTimeout(function(){ captureWeightAndPhoto(last); }, delayMs);
  }

  // === ROI drawing with red OCR outlines ===
  function drawROI(){
    if(!octx) return;
    octx.clearRect(0,0,overlay.width,overlay.height);
    if(!roi.show){ overlay.style.pointerEvents='none'; return; }
    overlay.style.pointerEvents='auto';
    const cssW = overlay.clientWidth, cssH = overlay.clientHeight;
    const x=roi.x*cssW, y=roi.y*cssH, w=roi.w*cssW, h=roi.h*cssH;
    octx.save();
    // ROI panel & border
    octx.fillStyle   = roi.hasText ? 'rgba(34,197,94,0.10)' : 'rgba(255,255,255,0.06)';
    octx.strokeStyle = roi.hasText ? 'rgba(34,197,94,0.95)' : 'rgba(139,139,139,0.95)';
    octx.lineWidth   = 2;
    octx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
    octx.setLineDash([6,4]); octx.strokeRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); octx.setLineDash([]);

    // draggable corners
    const s=9, pts=[[x,y],[x+w,y],[x,y+h],[x+w,y+h]];
    octx.fillStyle = octx.strokeStyle; octx.lineWidth=1;
    for(var i=0;i<pts.length;i++){ var p=pts[i]; octx.fillRect(Math.round(p[0]-s/2), Math.round(p[1]-s/2), s, s); octx.strokeRect(Math.round(p[0]-s/2), Math.round(p[1]-s/2), s, s); }

    // OCR boxes (red outline only)
    if (lastOCRBoxes && lastOCRBoxes.length){
      var vw = video.videoWidth||0, vh = video.videoHeight||0;
      var sw = Math.max(1, Math.floor(vw*roi.w));
      var sh = Math.max(1, Math.floor(vh*roi.h));
      octx.strokeStyle = 'rgba(239,68,68,0.98)';
      octx.lineWidth   = 2;
      octx.shadowColor = 'rgba(0,0,0,0.55)';
      octx.shadowBlur  = 2;
      octx.shadowOffsetX = 0;
      octx.shadowOffsetY = 0;
      for(var b=0;b<lastOCRBoxes.length;b++){
        var bb = lastOCRBoxes[b];
        var rx0 = x + (bb.x0/sw)*w;
        var ry0 = y + (bb.y0/sh)*h;
        var rw  = ((bb.x1-bb.x0)/sw)*w;
        var rh  = ((bb.y1-bb.y0)/sh)*h;
        octx.strokeRect(Math.round(rx0), Math.round(ry0), Math.round(rw), Math.round(rh));
      }
      setOCRStatus('Text ('+lastOCRBoxes.length+')');
    }
    octx.restore();
  }

  function getRoiSnapshot(){
    var vw=video.videoWidth||0, vh=video.videoHeight||0; if(!vw||!vh) return null;
    var sx=Math.floor(vw*roi.x), sy=Math.floor(vh*roi.y), sw=Math.floor(vw*roi.w), sh=Math.floor(vh*roi.h);
    var c=document.createElement('canvas'); c.width=Math.max(1,sw); c.height=Math.max(1,sh); c.getContext('2d').drawImage(video, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return c;
  }

  function toGramsString(txt){
    if(!txt) return '';
    var m=String(txt).match(/([-+]?\d*\.?\d+)\s*(kg|g|gram|grams|lb|lbs|oz)?/i);
    if(!m) return '';
    var v=parseFloat(m[1]), u=(m[2]||'g').toLowerCase(); var g=v;
    if(u==='kg') g=v*1000; else if(u==='lb'||u==='lbs') g=v*453.59237; else if(u==='oz') g=v*28.349523125;
    var s=Math.round(g*100)/100; return (Math.abs(s-Math.round(s))<1e-9)?String(Math.round(s)):String(s);
  }

  function captureWeightAndPhoto(row){
    if(!row) return;
    try{ if(video&&video.readyState>=2){ var c=document.createElement('canvas'); c.width=video.videoWidth||0; c.height=video.videoHeight||0; c.getContext('2d').drawImage(video,0,0); row.photo=c.toDataURL('image/jpeg',0.8); } }catch(e){}
    var mode=(scaleModeSel&&scaleModeSel.value)||'none';
    if(mode==='ocr'){
      var snap=getRoiSnapshot(); if(!snap){ setStatus('OCR: video not ready'); save(); render(); return; }
      setOCRStatus('Loading…');
      recognizeCanvasSmart(snap, function(txt, boxes){
        var grams=toGramsString(txt);
        if(grams){ row.weight=grams; save(); render(); setStatus('Weight OCR: '+grams+' g'); toast('Captured weight: '+grams+' g'); }
        else { setStatus('OCR: no numeric weight found'); }
        roi.hasText=/\S/.test(txt); lastOCRBoxes=boxes||[]; drawROI();
      });
    }
    save(); render();
  }

  // ROI + interactions
  function startOcrPulse(){
    if(ocrPulseTimer) clearInterval(ocrPulseTimer);
    ocrPulseTimer=setInterval(function(){
      if(!(roi.show && (scaleModeSel && scaleModeSel.value==='ocr'))){ roi.hasText=false; lastOCRBoxes=[]; drawROI(); setOCRStatus('On (idle)'); return; }
      if(!(video && video.readyState>=2)){ roi.hasText=false; lastOCRBoxes=[]; drawROI(); setOCRStatus('Video not ready'); return; }
      var snap=getRoiSnapshot(); if(!snap){ roi.hasText=false; lastOCRBoxes=[]; drawROI(); return; }
      recognizeCanvasSmart(snap, function(txt, boxes){
        var has=/\S/.test(txt); roi.hasText=!!has; lastOCRBoxes = boxes || []; drawROI(); if(has){ setOCRStatus('Text ('+lastOCRBoxes.length+')'); } else { setOCRStatus('On'); }
      });
    }, 1500);
  }
  function ensureROIOn(){ if(!roi.show){ roi.show=true; sizeOverlay(); drawROI(); } startOcrPulse(); }
  function ocrToggle(){ roi.show=!roi.show; sizeOverlay(); drawROI(); if(roi.show){ startOcrPulse(); setStatus('OCR box enabled. Set Scale source to OCR.'); setOCRStatus('On'); } else { if(ocrPulseTimer) clearInterval(ocrPulseTimer); roi.hasText=false; lastOCRBoxes=[]; setOCRStatus('Off'); drawROI(); } }
  var dragging=null;
  function norm(ev){ var r=overlay.getBoundingClientRect(); var p=('touches' in ev && ev.touches.length)?ev.touches[0]:ev; var nx=(p.clientX-r.left)/r.width, ny=(p.clientY-r.top)/r.height; return {nx:Math.max(0,Math.min(1,nx)),ny:Math.max(0,Math.min(1,ny))}; }
  function hit(nx,ny){ var m=0.02, inBox=(nx>=roi.x && ny>=roi.y && nx<=roi.x+roi.w && ny<=roi.y+roi.h); function near(ax,ay){return Math.abs(nx-ax)<=m&&Math.abs(ny-ay)<=m;} if(near(roi.x,roi.y))return'nw'; if(near(roi.x+roi.w,roi.y))return'ne'; if(near(roi.x,roi.y+roi.h))return'sw'; if(near(roi.x+roi.w,roi.y+roi.h))return'se'; if(inBox)return'move'; return null; }
  function startDrag(ev){ if(!roi.show) return; var p=norm(ev); var mode=hit(p.nx,p.ny); if(!mode) return; if(ev.preventDefault) ev.preventDefault(); dragging={mode:mode, ox:p.nx, oy:p.ny, rx:roi.x, ry:roi.y, rw:roi.w, rh:roi.h}; }
  function moveDrag(ev){ if(!dragging) return; var p=norm(ev), dx=p.nx-dragging.ox, dy=p.ny-dragging.oy, minW=0.08, minH=0.08;
    if(dragging.mode==='move'){ roi.x=Math.max(0,Math.min(1-dragging.rw,dragging.rx+dx)); roi.y=Math.max(0,Math.min(1-dragging.rh,dragging.ry+dy)); }
    else {
      var x=dragging.rx, y=dragging.ry, w=dragging.rw, h=dragging.rh;
      if(dragging.mode.indexOf('n')>=0){ y=Math.max(0,Math.min(dragging.ry+dy,dragging.ry+dragging.rh-minH)); h=(dragging.ry+dragging.rh)-y; }
      if(dragging.mode.indexOf('s')>=0){ h=Math.max(minH,Math.min(1-dragging.ry,dragging.rh+dy)); }
      if(dragging.mode.indexOf('w')>=0){ x=Math.max(0,Math.min(dragging.rx+dx,dragging.rx+dragging.rw-minW)); w=(dragging.rx+dragging.rw)-x; }
      if(dragging.mode.indexOf('e')>=0){ w=Math.max(minW,Math.min(1-dragging.rx,dragging.rw+dx)); }
      roi.x=x; roi.y=y; roi.w=w; roi.h=h;
    }
    lastOCRBoxes=[]; drawROI(); if(ev.preventDefault) ev.preventDefault();
  }
  function endDrag(ev){ if(!dragging) return; dragging=null; if(ev.preventDefault) ev.preventDefault(); }
  overlay.addEventListener('mousedown', startDrag); overlay.addEventListener('mousemove', moveDrag); window.addEventListener('mouseup', endDrag);
  overlay.addEventListener('touchstart', startDrag, {passive:false}); overlay.addEventListener('touchmove', moveDrag, {passive:false}); overlay.addEventListener('touchend', endDrag, {passive:false}); overlay.addEventListener('touchcancel', endDrag, {passive:false});

  // Render table
  var tbody=$('#logBody');
  function render(){
    tbody.innerHTML='';
    for(var i=0;i<data.length;i++){
      var r=data[i];
      var photo=r.photo?'<img class="thumb" alt="photo" src="'+r.photo+'"/>' : '';
      var tr=document.createElement('tr'); tr.dataset.id=r.id;
      tr.innerHTML='<td class="muted">'+(i+1)+'</td><td>'+esc(r.content)+'</td><td><span class="pill">'+esc(r.format||'')+'</span></td><td class="muted">'+esc(r.source||'')+'</td><td class="muted">'+esc(r.date||'')+'</td><td class="muted">'+esc(r.time||'')+'</td><td>'+(r.weight||'')+'</td><td>'+photo+'</td><td><span class="count">× '+(r.count||1)+'</span></td><td class="note-cell" contenteditable="true">'+esc(r.notes||'')+'</td><td><button type="button" data-act="edit" class="small">Edit</button> <button type="button" data-act="delete" class="small">Delete</button></td>';
      tbody.appendChild(tr);
    }
    drawROI();
  }
  function upsert(content,format,source){
    var now=new Date();
    for(var i=0;i<data.length;i++){ if(data[i].content===content){ var e=data[i]; e.count=(e.count||1)+1; e.timestamp=now.toISOString(); e.date=now.toLocaleDateString(); e.time=now.toLocaleTimeString(); save(); render(); return e; } }
    var r={id:String(Date.now())+Math.random().toString(36).slice(2), content:content, format:format||'', source:source||'', timestamp:now.toISOString(), date:now.toLocaleDateString(), time:now.toLocaleTimeString(), weight:'', photo:'', count:1, notes:''}; data.unshift(r); save(); render(); return r;
  }
  document.addEventListener('click', function(e){
    var b=e.target; if(!b||b.tagName!=='BUTTON') return;
    var tr=b.closest?b.closest('tr'):null; var id=tr&&tr.dataset?tr.dataset.id:null; var act=b.getAttribute('data-act');
    if(act==='delete'&&id){ data=data.filter(function(r){return r.id!==id;}); save(); render(); }
    if(act==='edit'&&id){ for(var i=0;i<data.length;i++){ if(data[i].id===id){ var row=data[i]; var nv=prompt('Edit content:', row.content); if(nv!==null){ row.content=nv; save(); render(); } break; } } }
  });
  document.addEventListener('blur', function(e){
    var c=e.target; if(!(c&&c.classList&&c.classList.contains('note-cell'))) return;
    var tr=c.closest?c.closest('tr'):null; var id=tr&&tr.dataset?tr.dataset.id:null; if(!id) return;
    for(var i=0;i<data.length;i++){ if(data[i].id===id){ data[i].notes=c.textContent; break; } } save();
  }, true);

  // Import/Export helpers
  function rowsForExport(){ var out=[]; for(var i=0;i<data.length;i++){ var r=data[i]; out.push({"Content":r.content,"Format":r.format,"Source":r.source,"Date":r.date||"","Time":r.time||"","Weight":r.weight||"","Photo":r.photo?('photo-'+(r.id||'')+'.jpg'):"","Count":r.count||1,"Notes":r.notes||"","Timestamp":r.timestamp||""}); } return out; }
  function rowsForCsv(){ var out=[]; for(var i=0;i<data.length;i++){ var r=data[i]; out.push({"Content":r.content,"Format":r.format,"Source":r.source,"Date":r.date||"","Time":r.time||"","Weight":r.weight||"","Photo":r.photo||"","Count":r.count||1,"Notes":r.notes||"","Timestamp":r.timestamp||""}); } return out; }
  function download(blob,name){ var a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; a.click(); setTimeout(function(){URL.revokeObjectURL(a.href);},500); }
  function exportCsv(){ var rows=rowsForCsv(), cols=["Content","Format","Source","Date","Time","Weight","Photo","Count","Notes","Timestamp"]; var out=[cols]; for(var i=0;i<rows.length;i++){ var r=rows[i]; var line=[]; for(var j=0;j<cols.length;j++){ var k=cols[j]; var v=r[k]; v=(v==null?'':String(v)).replace(/\"/g,'\"\"'); line.push(/[\",\\n]/.test(v)?('\"'+v+'\"'):v); } out.push(line); } var csv=out.map(function(a){return a.join(',')}).join('\\n'); download(new Blob([csv],{type:'text/csv;charset=utf-8'}),'qr-log-'+ts()+'.csv'); }
  function exportXlsx(){
    var rows=rowsForExport();
    if(window.XLSX){
      var cols=Object.keys(rows[0]||{});
      for(var i=0;i<rows.length;i++){
        for(var j=0;j<cols.length;j++){
          var k=cols[j]; var v=rows[i][k];
          if(typeof v==='string' && v.length>32760){ rows[i][k]=v.slice(0,32759)+'…'; }
        }
      }
      var ws=window.XLSX.utils.json_to_sheet(rows);
      var wb=window.XLSX.utils.book_new();
      window.XLSX.utils.book_append_sheet(wb, ws, 'Log');
      var out=window.XLSX.write(wb,{bookType:'xlsx',type:'array'});
      download(new Blob([out],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),'qr-log-'+ts()+'.xlsx');
    } else { toast('XLSX export needs SheetJS (vendor/xlsx.full.min.js).'); }
  }
  function exportZip(){ if(!(window.JSZip&&window.JSZip.external)) { toast('ZIP export needs JSZip (vendor/jszip.min.js).'); return; } }

  function importFile(f){
    var name=(f&&f.name)||'';
    if(/\.csv$/i.test(name)){ f.text().then(importCsvText); return; }
    if(/\.xlsx?$/i.test(name)){
      if(window.XLSX){
        var reader=new FileReader();
        reader.onload=function(e){ var wb=window.XLSX.read(new Uint8Array(e.target.result), {type:'array'}); var ws=wb.Sheets[wb.SheetNames[0]]; var rows=window.XLSX.utils.sheet_to_json(ws,{defval:''}); for(var i=0;i<rows.length;i++){ var r=rows[i]; var row=upsert(r.Content||r.content||'', r.Format||r.format||'', r.Source||r.source||''); row.date=r.Date||row.date; row.time=r.Time||row.time; row.weight=r.Weight||row.weight; row.notes=r.Notes||row.notes; row.timestamp=r.Timestamp||row.timestamp; } save(); render(); setStatus('Imported XLSX.'); };
        reader.readAsArrayBuffer(f);
      }else{ toast('XLSX import needs SheetJS (vendor/xlsx.full.min.js).'); }
      return;
    }
    toast('Unsupported file type.');
  }
  function importCsvText(text){
    var lines=text.split(/\\r?\\n/); if(!lines.length) return;
    for(var i=1;i<lines.length;i++){
      var L=lines[i]; if(!L) continue;
      var cells=L.match(/("([^"]|"")*"|[^,]+)/g) || [];
      for(var j=0;j<cells.length;j++){ var v=cells[j]; if(/^".*"$/.test(v)) cells[j]=v.slice(1,-1).replace(/""/g,'"'); }
      var obj={"Content":cells[0]||"","Format":cells[1]||"","Source":cells[2]||"","Date":cells[3]||"","Time":cells[4]||"","Weight":cells[5]||"","Photo":cells[6]||"","Count":cells[7]||"","Notes":cells[8]||"","Timestamp":cells[9]||""};
      var row=upsert(obj.Content, obj.Format, obj.Source); row.date=obj.Date||row.date; row.time=obj.Time||row.time; row.weight=obj.Weight||row.weight; row.notes=obj.Notes||row.notes; row.timestamp=obj.Timestamp||row.timestamp;
    }
    save(); render(); setStatus('Imported CSV.');
  }

  // UI bindings
  $('#permBtn').addEventListener('click', requestPermission);
  $('#refreshBtn').addEventListener('click', enumerateCams);
  $('#startBtn').addEventListener('click', startFromSelection);
  $('#stopBtn').addEventListener('click', function(){ stop(); setStatus('Camera stopped.'); });
  $('#addManualBtn').addEventListener('click', function(){ var v=$('#manualInput').value.trim(); if(!v) return; handleDetection(v,'manual'); $('#manualInput').value=''; });
  $('#manualInput').addEventListener('keydown', function(e){ if(e.key==='Enter'){ e.preventDefault(); $('#addManualBtn').click(); } });

  if(resetDupBtn){ resetDupBtn.addEventListener('click', function(){ seenEver.clear(); toast('Duplicate memory cleared.'); }); }
  exportCsvBtn.addEventListener('click', exportCsv);
  exportXlsxBtn.addEventListener('click', exportXlsx);
  exportZipBtn.addEventListener('click', exportZip);
  $('#importFileBtn').addEventListener('click', function(){ fileInput.click(); });
  fileInput.addEventListener('change', function(e){ var f=e.target.files[0]; if(!f) return; importFile(f); e.target.value=''; });
  clearBtn.addEventListener('click', function(){ if(confirm('Clear all rows?')){ data=[]; save(); render(); seenEver.clear(); }});

  if (testOCRBtn){
    testOCRBtn.addEventListener('click', function(){
      ensureROIOn();
      var snap=getRoiSnapshot(); if(!snap){ toast('Video not ready.'); return; }
      setOCRStatus('Loading…');
      recognizeCanvasSmart(snap, function(txt, boxes){
        roi.hasText=/\S/.test(txt);
        lastOCRBoxes = boxes || [];
        drawROI();
        var msg = txt.trim()? txt.trim().slice(0,120).replace(/\\s+/g,' ') : '(no text)';
        toast('OCR sample: '+msg);
      });
    });
  }

  // Keep overlay in sync
  video.addEventListener('loadedmetadata', sizeOverlay);
  video.addEventListener('playing',        sizeOverlay);
  window.addEventListener('resize',        sizeOverlay);
  if ('ResizeObserver' in window) { var ro = new ResizeObserver(function(){ sizeOverlay(); }); ro.observe(video); }

  if('serviceWorker' in navigator){ navigator.serviceWorker.register('./sw.js'); }

  // Prefs: default OCR
  var prefs = loadPrefs();
  var initialScale = prefs.scaleMode || 'ocr';
  if(scaleModeSel){ scaleModeSel.value = initialScale; }
  if(initialScale === 'ocr'){ if(!roi.show){ roi.show=true; } sizeOverlay(); drawROI(); setOCRStatus('On'); startOcrPulse(); }
  if(scaleModeSel){
    scaleModeSel.addEventListener('change', function(){
      savePrefs({scaleMode: scaleModeSel.value});
      if(scaleModeSel.value==='ocr'){ if(!roi.show){ roi.show=true; } sizeOverlay(); drawROI(); setOCRStatus('On'); startOcrPulse(); }
      else { if(ocrPulseTimer) clearInterval(ocrPulseTimer); roi.hasText=false; lastOCRBoxes=[]; drawROI(); setOCRStatus('Off'); }
    });
  }

  load(); render(); enumerateCams(); setTimeout(function(){ setStatus('Ready. Engines: BD → ZXing WASM → jsQR'); }, 0);

})();