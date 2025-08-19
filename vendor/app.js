// QR-Reader Full v7.1.5 — OCR live status + ROI highlight + global duplicate ignore
(function(){
  'use strict';
  const $=s=>document.querySelector(s);
  const video=$('#video'), overlay=$('#overlay'), octx=overlay.getContext('2d',{willReadFrequently:true});
  const statusEl=$('#status'), cameraSelect=$('#cameraSelect'), prefFacing=$('#prefFacing'), scanEnginePill=$('#scanEngine'), permStateEl=$('#permState');
  const cooldownSecInput=$('#cooldownSec'), ignoreDupChk=$('#ignoreDup'), resetDupBtn=$('#resetDup');
  const fileInput=$('#fileInput');
  const cameraSourceSel=$('#cameraSource');
  const delaySecInput=$('#delaySec'), scaleModeSel=$('#scaleMode');
  const ocrToggleBtn=$('#ocrToggle'), connectHIDBtn=$('#connectHID'), connectBLEBtn=$('#connectBLE');
  const serialBtn=$('#connectSerial'), serialState=$('#serialState');
  const exportXlsxBtn=$('#exportXlsx'), exportCsvBtn=$('#exportCsv'), exportZipBtn=$('#exportZip'), clearBtn=$('#clearBtn');
  const toastEl=$('#toast');

  let stream=null, scanning=false, detector=null;
  let data=[]; const STORAGE_KEY='qrLoggerFull';
  let cooldownSec=5; let cooldownUntil=0;
  let scanTimer=null;
  const roi = { x:0.58, y:0.58, w:0.40, h:0.38, show:false, hasText:false };
  let ocrPulseTimer=null;
  const seenEver = new Set();

  let zxwReady=false;
  let tessWorkerPromise=null;
  async function ensureTesseract(){
    if(!(window.Tesseract && window.Tesseract.createWorker)) return null;
    if(!tessWorkerPromise){
      tessWorkerPromise = window.Tesseract.createWorker({
        workerPath: 'vendor/worker.min.js',
        corePath: 'vendor/tesseract-core/tesseract-core.wasm.js',
        langPath: 'vendor/lang-data',
        logger: m => { }
      }).then(async (w)=>{
        await w.load();
        await w.loadLanguage('eng');
        await w.initialize('eng');
        try{
          await w.setParameters({
            tessedit_char_whitelist: '0123456789. kgKGlbLBozOZ',
            preserve_interword_spaces: '1'
          });
        }catch(_e){}
        return w;
      }).catch((e)=>{ setStatus('Tesseract init failed: '+(e.message||e)); tessWorkerPromise=null; return null; });
    }
    return tessWorkerPromise;
  }

  let serialPort=null, serialReader=null;
  async function connectSerial(){
    if(!('serial' in navigator)){ if(serialState) serialState.textContent='Web Serial not supported on this browser.'; return; }
    try{
      serialPort = await navigator.serial.requestPort({});
      await serialPort.open({ baudRate: 9600 });
      if(serialState) serialState.textContent='Serial connected.';
      const decoder = new TextDecoderStream();
      serialPort.readable.pipeTo(decoder.writable);
      serialReader = decoder.readable.getReader();
      readSerialLoop();
    }catch(e){ if(serialState) serialState.textContent='Serial failed: '+(e.message||e); }
  }
  async function readSerialLoop(){
    let buf='';
    while(serialReader){
      try{
        const {value, done} = await serialReader.read();
        if(done) break;
        if(value){ buf += value; const lines = buf.split(/\r?\n/); buf = lines.pop(); for(let i=0;i<lines.length;i++){ const t=lines[i].trim(); if(t){ handleDetection(t, 'serial'); } } }
      }catch(e){ break; }
    }
  }

  const setStatus=t=>{ if(statusEl) statusEl.textContent=t||''; };
  const toast=(t)=>{
    if(!toastEl) return;
    toastEl.textContent = t;
    toastEl.style.display = 'block';
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(()=>{ toastEl.style.display='none'; }, 1800);
  };
  const save=()=>{ try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }catch(e){} };
  const load=()=>{ try{ data=JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]'); }catch(e){ data=[]; } };
  async function updatePerm(){ if(!('permissions' in navigator)) return; try{ const st=await navigator.permissions.query({name:'camera'}); if(permStateEl){ permStateEl.textContent='Permission: '+st.state; } st.onchange=function(){ if(permStateEl){ permStateEl.textContent='Permission: '+st.state; } }; }catch(e){} }
  function decideFacing(){ const p=prefFacing.value; if(p==='environment') return {facingMode:{ideal:'environment'}}; if(p==='user') return {facingMode:{ideal:'user'}}; return {facingMode:{ideal:'user'}}; }

  async function enumerateCams(){
    try{
      const devs=await navigator.mediaDevices.enumerateDevices();
      const cams=devs.filter(d=>d.kind==='videoinput');
      cameraSelect.innerHTML='';
      if(!cams.length){ const o=document.createElement('option'); o.value=''; o.textContent='No cameras detected'; cameraSelect.appendChild(o); return cams; }
      cams.forEach((c,i)=>{ const oo=document.createElement('option'); oo.value=c.deviceId||''; oo.textContent=c.label||('Camera '+(i+1)); cameraSelect.appendChild(oo); });
      return cams;
    }catch(e){ setStatus('enumerateDevices failed: '+e.message); return []; }
  }

  async function requestPermission(){
    try{ setStatus('Requesting camera permission…'); const s=await navigator.mediaDevices.getUserMedia({video:decideFacing(),audio:false}); s.getTracks().forEach(t=>t.stop()); setStatus('Permission granted.'); }
    catch(e){ setStatus('Permission request failed: '+(e.name||'')+' '+(e.message||e)); }
    await updatePerm(); if(navigator.mediaDevices && navigator.mediaDevices.enumerateDevices){ await enumerateCams(); }
  }

  function useStream(s, label){
    stop();
    stream=s; video.srcObject=stream;
    video.play().then(()=>{ const track=stream.getVideoTracks()[0]; const st=track?track.getSettings():{}; setStatus((label||'Camera')+' started ('+(st.width||'?')+'×'+(st.height||'?')+')'); sizeOverlay(); initScanner(); }).catch(e=>{ setStatus('Video play failed: '+e.message); });
  }
  async function startFromSelection(){
    if(cameraSourceSel.value==='remote'){ setStatus('Remote camera active (see remote.js).'); return; }
    if(cameraSourceSel.value==='serial'){ setStatus('Listening on Serial for codes…'); return; }
    const errors=[];
    async function attempt(v){
      try{ stop(); setStatus('Starting camera…'); const s=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:1920},height:{ideal:1080},...v},audio:false}); useStream(s,'Camera'); return true; }
      catch(e){ errors.push(e.name+': '+e.message); return false; }
    }
    const id=cameraSelect.value;
    if(id && await attempt({deviceId:{exact:id}})) return true;
    if(await attempt(decideFacing())) return true;
    if(await attempt(true)) return true;
    setStatus('Failed to start camera. '+errors.join(' | ')); return false;
  }
  function sizeOverlay(){ overlay.width=video.clientWidth; overlay.height=video.clientHeight; drawROI(); }
  window.addEventListener('resize', sizeOverlay);
  function stop(){ scanning=false; if(stream){ stream.getTracks().forEach(t=>t.stop()); stream=null; } if(octx){ octx.clearRect(0,0,overlay.width,overlay.height); } clearTimeout(scanTimer); clearInterval(ocrPulseTimer); }

  async function initScanner(){
    clearTimeout(scanTimer);
    if(cameraSourceSel.value!=='local'){ if(scanEnginePill){ scanEnginePill.textContent='Engine: remote/serial'; } return; }
    if('BarcodeDetector' in window){
      try{
        let fmts=['qr_code','data_matrix','aztec','pdf417','code_128','code_39','code_93','codabar','itf','ean_13','ean_8','upc_a','upc_e'];
        try{ if(typeof BarcodeDetector.getSupportedFormats==='function'){ const got=await BarcodeDetector.getSupportedFormats(); fmts = got.filter(function(x){return fmts.indexOf(x)!==-1;}); if(!fmts.length) fmts=['qr_code']; } }catch(_e){}
        try{ detector = new BarcodeDetector({formats: fmts}); }
        catch(e1){ try{ detector=new BarcodeDetector({formats:['qr_code']}); }catch(e2){ detector=new BarcodeDetector(); } }
        if(scanEnginePill){ scanEnginePill.textContent='Engine: BarcodeDetector'; }
        scanning=true; loopBD(); return;
      }catch(e){}
    }
    if(setupZXingWasm()){
      if(scanEnginePill){ scanEnginePill.textContent='Engine: zxing-wasm'; } scanning=true; loopZXingWasm(); return;
    }
    if(window.jsQR){
      if(scanEnginePill){ scanEnginePill.textContent='Engine: jsQR'; } scanning=true; loopJsQR(); return;
    }
    if(scanEnginePill){ scanEnginePill.textContent='Engine: none'; }
    setStatus('No scanning engine available. Populate /vendor (zxing-wasm/jsQR).');
  }

  function inCooldown(){ return Date.now()<cooldownUntil; }
  let pendingWeightTimer=null;
  function handleDetection(text, format){
    const ignoreDup = !!(ignoreDupChk && ignoreDupChk.checked);
    if(ignoreDup && seenEver.has(text)){ return; }
    const now=Date.now();
    cooldownUntil=now+cooldownSec*1000;
    const row = upsert(text, format||'qr_code', cameraSourceSel.value || 'camera');
    if(ignoreDup) seenEver.add(text);
    const delayMs = Math.max(0, Math.min(4000, Math.floor(parseFloat(delaySecInput.value||'2')*1000)));
    if(pendingWeightTimer){ clearTimeout(pendingWeightTimer); pendingWeightTimer=null; }
    pendingWeightTimer = setTimeout(function(){ captureWeightAndPhoto(row); }, delayMs);
  }

  function loopBD(){
    if(!scanning || !video || video.readyState<2){ scanTimer=setTimeout(loopBD,120); return; }
    if(inCooldown()){ scanTimer=setTimeout(loopBD,280); return; }
    (async function(){
      try{
        let det=null;
        try{ det=await detector.detect(video); }catch(e){}
        if(det && det.length){ const c=det[0]; const text=c.rawValue||''; if(text){ handleDetection(text,c.format||'qr_code'); setTimeout(loopBD,220); return; } }
      }catch(e){}
      scanTimer=setTimeout(loopBD,140);
    })();
  }

  const sample=document.createElement('canvas'); const sctx=sample.getContext('2d',{willReadFrequently:true});

  function setupZXingWasm(){
    const g=window;
    const ok = !!(g.ZXingWASM && (typeof g.ZXingWASM.readBarcodes==='function' || typeof g.ZXingWASM.readBarcodesFromImageData==='function'));
    g.__ZXWasm = { ok: ok, keys: g.ZXingWASM ? Object.keys(g.ZXingWASM) : [] };
    if(!ok){ setStatus('zxing-wasm not available. Ensure vendor/zxing-wasm-reader.iife.js and vendor/zxing_reader.wasm are present and loaded before app.js'); return false; }
    zxwReady=true; return true;
  }

  function loopZXingWasm(){
    if(!scanning || !video || video.readyState<2){ scanTimer=setTimeout(loopZXingWasm,180); return; }
    if(inCooldown()){ scanTimer=setTimeout(loopZXingWasm,300); return; }
    const vw=video.videoWidth||0, vh=video.videoHeight||0; if(!vw||!vh){ scanTimer=setTimeout(loopZXingWasm,160); return; }
    const MAXW=720; const scale = vw>MAXW ? (MAXW/vw) : 1;
    sample.width=Math.max(1,Math.floor(vw*scale)); sample.height=Math.max(1,Math.floor(vh*scale));
    sctx.imageSmoothingEnabled=false; sctx.drawImage(video,0,0,sample.width,sample.height);
    try{
      const id=sctx.getImageData(0,0,sample.width,sample.height);
      const opts={ tryHarder:true, formats:['QRCode','DataMatrix','Aztec','PDF417','Code128','Code39','Code93','ITF','Codabar','EAN-8','EAN-13','UPC-A','UPC-E','DataBar','DataBarLimited','DataBarExpanded'], maxNumberOfSymbols:1 };
      const API = window.ZXingWASM;
      const fn = API.readBarcodes || API.readBarcodesFromImageData;
      if(typeof fn!=='function'){ throw new Error('zxing-wasm API missing readBarcodes'); }
      Promise.resolve(fn.call(API, id, opts)).then(function(results){
        if(results && results.length){
          const r=results[0];
          if(r && r.text){ handleDetection(r.text, r.format||'multi'); }
        }
      }).catch(function(){ }).finally(function(){ scanTimer=setTimeout(loopZXingWasm,160); });
    }catch(e){ scanTimer=setTimeout(loopZXingWasm,200); }
  }

  function loopJsQR(){
    if(!scanning || !video || video.readyState<2){ scanTimer=setTimeout(loopJsQR,180); return; }
    if(inCooldown()){ scanTimer=setTimeout(loopJsQR,300); return; }
    const vw=video.videoWidth||0, vh=video.videoHeight||0; if(!vw||!vh){ scanTimer=setTimeout(loopJsQR,180); return; }
    const MAXW=640; const scale = vw>MAXW ? (MAXW/vw) : 1; const sw=Math.max(1,Math.floor(vw*scale)), sh=Math.max(1,Math.floor(vh*scale));
    sample.width=sw; sample.height=sh; sctx.imageSmoothingEnabled=false; sctx.drawImage(video,0,0,sw,sh);
    try{ if(window.jsQR){ const id=sctx.getImageData(0,0,sw,sh); const q=jsQR(id.data, sw, sh, { inversionAttempts:'attemptBoth' }); if(q && q.data){ handleDetection(q.data,'qr_code'); scanTimer=setTimeout(loopJsQR,220); return; } } }catch(e){}
    scanTimer=setTimeout(loopJsQR,160);
  }

  function drawROI(){
    if(!octx) return;
    octx.clearRect(0,0,overlay.width,overlay.height);
    if(!roi.show){ overlay.style.pointerEvents='none'; return; }
    overlay.style.pointerEvents='auto';
    const x=roi.x*overlay.width, y=roi.y*overlay.height, w=roi.w*overlay.width, h=roi.h*overlay.height;
    octx.save();
    octx.strokeStyle = roi.hasText ? 'rgba(34,197,94,0.95)' : 'rgba(139,139,139,0.95)';
    octx.lineWidth=2; octx.setLineDash([6,4]); octx.strokeRect(Math.round(x),Math.round(y),Math.round(w),Math.round(h));
    octx.setLineDash([]);
    const s=9; const pts=[ [x,y], [x+w,y], [x,y+h], [x+w,y+h] ];
    octx.fillStyle= roi.hasText ? 'rgba(34,197,94,0.95)' : 'rgba(139,139,139,0.95)';
    octx.strokeStyle='#000'; octx.lineWidth=1;
    for(const p of pts){ octx.fillRect(Math.round(p[0]-s/2),Math.round(p[1]-s/2),s,s); octx.strokeRect(Math.round(p[0]-s/2),Math.round(p[1]-s/2),s,s); }
    octx.restore();
  }
  function startOcrPulse(){
    clearInterval(ocrPulseTimer);
    ocrPulseTimer = setInterval(async function(){
      if(!(roi.show && scaleModeSel && scaleModeSel.value==='ocr')){ roi.hasText=false; drawROI(); return; }
      if(!(video && video.readyState>=2)){ roi.hasText=false; drawROI(); return; }
      const wpr = await ensureTesseract(); if(!wpr){ roi.hasText=false; drawROI(); return; }
      try{
        const vw=video.videoWidth||0, vh=video.videoHeight||0; if(!vw||!vh){ roi.hasText=false; drawROI(); return; }
        const sx=Math.floor(vw*roi.x), sy=Math.floor(vh*roi.y), sw=Math.floor(vw*roi.w), sh=Math.floor(vh*roi.h);
        const c=document.createElement('canvas'); c.width=Math.max(1,Math.floor(sw)); c.height=Math.max(1,Math.floor(sh));
        const cx=c.getContext('2d'); cx.drawImage(video, sx, sy, sw, sh, 0, 0, c.width, c.height);
        const res=await (await wpr).recognize(c);
        const txt=(res.data&&res.data.text)?res.data.text:'';
        const hasDigits = /\d/.test(txt);
        roi.hasText = !!hasDigits;
        if(hasDigits){ setStatus('OCR live: text detected in ROI'); } else { setStatus('OCR live: no text detected'); }
      }catch(e){ roi.hasText=false; }
      drawROI();
    }, 900);
  }

  function captureWeightAndPhoto(row){
    if(!row) return;
    try{
      if(video && video.readyState>=2){
        const vw=video.videoWidth||0, vh=video.videoHeight||0;
        const c=document.createElement('canvas'); c.width=vw; c.height=vh;
        const cx=c.getContext('2d'); cx.drawImage(video,0,0);
        row.photo = c.toDataURL('image/jpeg', 0.8);
      }
    }catch(e){}
    const mode = (scaleModeSel && scaleModeSel.value) ? scaleModeSel.value : 'none';
    if(mode==='ocr'){ ocrWeight(row); }
    else if(mode==='hid'){ hidWeight(row); }
    else if(mode==='ble'){ bleWeight(row); }
    save(); render();
  }

  function toGramsString(txt){
    if(!txt) return '';
    const raw = String(txt).trim();
    const m = raw.match(/([-+]?\d*\.?\d+)\s*(kg|g|gram|grams|lb|lbs|oz)?/i);
    if(!m) return '';
    const val = parseFloat(m[1]);
    const unit = (m[2]||'g').toLowerCase();
    let grams = val;
    if(unit==='kg'){ grams = val*1000; }
    else if(unit==='lb' || unit==='lbs'){ grams = val*453.59237; }
    else if(unit==='oz'){ grams = val*28.349523125; }
    const s = Math.round(grams*100)/100;
    return (Math.abs(s - Math.round(s)) < 1e-9) ? String(Math.round(s)) : String(s);
  }

  async function ocrWeight(row){
    const wpr = await ensureTesseract();
    if(!wpr){ setStatus('Tesseract not loaded (populate /vendor then reload).'); return; }
    try{
      const vw=video.videoWidth||0, vh=video.videoHeight||0; if(!vw||!vh){ setStatus('OCR: video not ready'); return; }
      const sx=Math.floor(vw*roi.x), sy=Math.floor(vh*roi.y), sw=Math.floor(vw*roi.w), sh=Math.floor(vh*roi.h);
      const c=document.createElement('canvas'); c.width=Math.max(1,sw); c.height=Math.max(1,sh);
      const cx=c.getContext('2d'); cx.drawImage(video, sx, sy, sw, sh, 0, 0, c.width, c.height);
      setStatus('OCR scanning…');
      const res = await (await wpr).recognize(c);
      const txt=(res.data&&res.data.text)?res.data.text:'';
      const grams = toGramsString(txt);
      if(grams){ row.weight=grams; save(); render(); setStatus('Weight OCR: '+grams+' g'); toast('Captured weight (OCR): '+grams+' g'); }
      else{ setStatus('OCR: no numeric weight found.'); toast('OCR: no numeric weight found'); }
    }catch(e){ setStatus('OCR error: '+(e.message||e)); }
  }
  async function hidWeight(row){
    if(!('hid' in navigator)){ setStatus('WebHID not supported.'); return; }
    try{
      let devices = await navigator.hid.getDevices();
      if(!devices.length){ devices = await navigator.hid.requestDevice({ filters: [] }); }
      if(!devices.length){ setStatus('No HID device selected.'); return; }
      const d=devices[0]; await d.open();
      setStatus('Reading HID… place item on scale.');
      d.addEventListener('inputreport', function(e){
        const bytes = new Uint8Array(e.data.buffer);
        let str=''; for(let i=0;i<bytes.length;i++){ const c=bytes[i]; if(c>=32&&c<127) str+=String.fromCharCode(c); }
        const grams = toGramsString(str);
        if(grams){ row.weight=grams; save(); render(); setStatus('HID weight: '+grams+' g'); toast('Captured weight: '+grams+' g'); }
      });
    }catch(e){ setStatus('HID error: '+(e.message||e)); }
  }
  async function bleWeight(row){
    if(!('bluetooth' in navigator)){ setStatus('Web Bluetooth not supported.'); return; }
    try{
      const device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: ['device_information','battery_service'] });
      await device.gatt.connect();
      setStatus('BLE connected: '+(device.name||'device'));
    }catch(e){ setStatus('BLE error: '+(e.message||e)); }
  }

  let drag=null;
  function norm(ev){ const rect=overlay.getBoundingClientRect(); const pt=('touches' in ev && ev.touches.length)?ev.touches[0]:ev; let nx=(pt.clientX-rect.left)/rect.width, ny=(pt.clientY-rect.top)/rect.height; nx=Math.max(0,Math.min(1,nx)); ny=Math.max(0,Math.min(1,ny)); return {nx,ny}; }
  function hit(nx,ny){ const m=0.02; const inBox=nx>=roi.x && ny>=roi.y && nx<=roi.x+roi.w && ny<=roi.y+roi.h; const near=(ax,ay)=>Math.abs(nx-ax)<=m && Math.abs(ny-ay)<=m; if(near(roi.x,roi.y))return'nw'; if(near(roi.x+roi.w,roi.y))return'ne'; if(near(roi.x,roi.y+roi.h))return'sw'; if(near(roi.x+roi.w,roi.y+roi.h))return'se'; if(inBox)return'move'; return null; }
  function startDrag(ev){ if(!roi.show) return; const p=norm(ev); const mode=hit(p.nx,p.ny); if(!mode) return; ev.preventDefault && ev.preventDefault(); drag={mode:mode, ox:p.nx, oy:p.ny, rx:roi.x, ry:roi.y, rw:roi.w, rh:roi.h}; }
  function moveDrag(ev){ if(!drag) return; const p=norm(ev); let dx=p.nx-drag.ox, dy=p.ny-drag.oy; const minW=0.08, minH=0.08; if(drag.mode==='move'){ roi.x=Math.max(0,Math.min(1-drag.rw,drag.rx+dx)); roi.y=Math.max(0,Math.min(1-drag.rh,drag.ry+dy)); } else { let x=drag.rx, y=drag.ry, w=drag.rw, h=drag.rh; if(drag.mode.indexOf('n')>=0){ y=Math.max(0,Math.min(drag.ry+dy,drag.ry+drag.rh-minH)); h=(drag.ry+drag.rh)-y; } if(drag.mode.indexOf('s')>=0){ h=Math.max(minH,Math.min(1-drag.ry,drag.rh+dy)); } if(drag.mode.indexOf('w')>=0){ x=Math.max(0,Math.min(drag.rx+dx,drag.rx+drag.rw-minW)); w=(drag.rx+drag.rw)-x; } if(drag.mode.indexOf('e')>=0){ w=Math.max(minW,Math.min(1-drag.rx,drag.rw+dx)); } roi.x=x; roi.y=y; roi.w=w; roi.h=h; } drawROI(); ev.preventDefault && ev.preventDefault(); }
  function endDrag(ev){ if(!drag) return; drag=null; ev.preventDefault && ev.preventDefault(); }
  overlay.addEventListener('mousedown', startDrag); overlay.addEventListener('mousemove', moveDrag); window.addEventListener('mouseup', endDrag); overlay.addEventListener('touchstart', startDrag, {passive:false}); overlay.addEventListener('touchmove', moveDrag, {passive:false}); overlay.addEventListener('touchend', endDrag, {passive:false}); overlay.addEventListener('touchcancel', endDrag, {passive:false});

  const tbody=$('#logBody');
  function render(){
    tbody.innerHTML='';
    for(let i=0;i<data.length;i++){
      const r=data[i];
      const tr=document.createElement('tr');
      const dateStr=r.date||new Date(r.timestamp).toLocaleDateString();
      const timeStr=r.time||new Date(r.timestamp).toLocaleTimeString();
      const photoHtml = r.photo ? '<img class="thumb" alt="photo" src="'+r.photo+'"/>' : '';
      tr.innerHTML='<td class="muted">'+(i+1)+'</td><td>'+esc(r.content)+'</td><td><span class="pill">'+(r.format||'')+'</span></td><td class="muted">'+(r.source||'')+'</td><td class="muted">'+dateStr+'</td><td class="muted">'+timeStr+'</td><td>'+(r.weight||'')+'</td><td>'+photoHtml+'</td><td><span class="count">× '+(r.count||1)+'</span></td><td class="note-cell" contenteditable="true">'+esc(r.notes||'')+'</td><td><button type="button" class="small" data-act="edit">Edit</button> <button type="button" class="small" data-act="delete">Delete</button></td>';
      tr.dataset.id=r.id; tbody.appendChild(tr);
    }
    drawROI();
  }
  const esc=s=>(s==null?'':String(s)).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  function upsert(content,format,source){
    if(!content) return;
    const now=new Date(); const iso=now.toISOString();
    let ex=null; for(let j=0;j<data.length;j++){ if(data[j].content===content){ ex=data[j]; break; } }
    if(ex){ ex.count=(ex.count||1)+1; ex.timestamp=iso; ex.date=now.toLocaleDateString(); ex.time=now.toLocaleTimeString(); save(); render(); beep(); return ex; }
    const row={id:(crypto.randomUUID?crypto.randomUUID():(Date.now()+Math.random().toString(36).slice(2))), content:content, format:format||'', source:source||'', timestamp: iso, date:now.toLocaleDateString(), time:now.toLocaleTimeString(), weight:'', photo:'', count:1, notes:''};
    data.unshift(row); save(); render(); beep(); return row;
  }
  document.addEventListener('click', function(e){
    const btn=e.target.closest && e.target.closest('button'); if(!btn) return;
    const tr=e.target.closest && e.target.closest('tr'); const id=tr && tr.dataset ? tr.dataset.id : null;
    const act=btn.getAttribute('data-act');
    if(act==='delete' && id){ data = data.filter(function(r){return r.id!==id;}); save(); render(); }
    if(act==='edit' && id){ const row=data.find(function(r){return r.id===id;}); const nv=prompt('Edit content:', row?row.content:''); if(nv!==null && row){ row.content=nv; save(); render(); } }
  });
  document.addEventListener('blur', function(e){
    const c=e.target; if(!c.classList || !c.classList.contains('note-cell')) return;
    const tr=c.closest('tr'); const id=tr && tr.dataset ? tr.dataset.id : null;
    const row=data.find(function(r){return r.id===id;});
    if(row){ row.notes=c.textContent; save(); }
  }, true);

  const manualInput=$('#manualInput');
  $('#addManualBtn').addEventListener('click', function(){ const v=manualInput && manualInput.value ? manualInput.value.trim() : ''; if(v){ handleDetection(v,'text'); manualInput.value=''; } });
  if(manualInput){ manualInput.addEventListener('keydown', function(e){ if(e.key==='Enter'){ e.preventDefault(); const v=manualInput.value.trim(); if(v){ handleDetection(v,'text'); manualInput.value=''; } } }); }

  const EXCEL_MAX=32760;
  function clampCell(s){
    s = (s==null?'':String(s));
    if(s.length>EXCEL_MAX) return s.slice(0,EXCEL_MAX-1)+'…';
    return s;
  }
  function rowsForExport(includePhotoName){
    return data.map(function(r){
      const photoName = r.photo ? ('photo-'+(r.id||'')+'.jpg') : '';
      return {
        "Content": clampCell(r.content),
        "Format": clampCell(r.format),
        "Source": clampCell(r.source),
        "Date": clampCell(r.date||""),
        "Time": clampCell(r.time||""),
        "Weight": clampCell(r.weight||""),
        "Photo": includePhotoName ? photoName : (r.photo||""),
        "Count": r.count,
        "Notes": clampCell(r.notes||""),
        "Timestamp": clampCell(r.timestamp||"")
      };
    });
  }
  function rowsForCsv(){
    return data.map(function(r){
      return {
        "Content": r.content,
        "Format": r.format,
        "Source": r.source,
        "Date": r.date||"",
        "Time": r.time||"",
        "Weight": r.weight||"",
        "Photo": r.photo||"",
        "Count": r.count||1,
        "Notes": r.notes||"",
        "Timestamp": r.timestamp||""
      };
    });
  }

  const Zip=(function(){
    function crcTable(){ const t=new Uint32Array(256); for(let n=0;n<256;n++){ let c=n; for(let k=0;k<8;k++){ c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1); } t[n]=c>>>0; } return t; }
    const TBL=crcTable();
    function crc32(u8){ let c=~0>>>0; for(let i=0;i<u8.length;i++){ c=TBL[(c^u8[i])&0xFF]^(c>>>8); } return (~c)>>>0; }
    function u16(n){ return new Uint8Array([n&255,(n>>>8)&255]); }
    function u32(n){ return new Uint8Array([n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255]); }
    function strU8(s){ return new TextEncoder().encode(String(s)); }
    function dosStamp(d){ const dt=new Date(d||Date.now()); const time=(dt.getHours()<<11)|(dt.getMinutes()<<5)|((Math.floor(dt.getSeconds()/2))&31); const date=((dt.getFullYear()-1980)<<9)|((dt.getMonth()+1)<<5)|dt.getDate(); return {time,date}; }
    function concat(arrs){ let len=0; for(const a of arrs) len+=a.length; const out=new Uint8Array(len); let p=0; for(const a of arrs){ out.set(a,p); p+=a.length; } return out; }
    function make(files){
      const stamp=dosStamp(Date.now());
      const locals=[]; const centrals=[];
      let offset=0;
      for(const f of files){
        const name=strU8(f.name);
        const bytes=(f.bytes instanceof Uint8Array)?f.bytes:strU8(f.bytes||"");
        const crc=crc32(bytes);
        const lfh=concat([ u32(0x04034b50), u16(20), u16(0), u16(0), u16(stamp.time), u16(stamp.date), u32(crc), u32(bytes.length), u32(bytes.length), u16(name.length), u16(0), name, bytes ]);
        locals.push(lfh);
        const cdf=concat([ u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(stamp.time), u16(stamp.date), u32(crc), u32(bytes.length), u32(bytes.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name ]);
        centrals.push(cdf);
        offset += lfh.length;
      }
      const centralBlob=concat(centrals);
      const localsBlob=concat(locals);
      const eocd=concat([ u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(centralBlob.length), u32(localsBlob.length), u16(0) ]);
      return new Blob([localsBlob, centralBlob, eocd], {type:'application/zip'});
    }
    function strToU8(s){ return strU8(s); }
    return { make, strToU8 };
  })();

  function exportXlsx(){
    const rows = rowsForExport(true);
    if(window.XLSX){
      const ws=window.XLSX.utils.json_to_sheet(rows);
      const wb=window.XLSX.utils.book_new();
      window.XLSX.utils.book_append_sheet(wb, ws, 'Log');
      const out = window.XLSX.write(wb, {bookType:'xlsx', type:'array'});
      const blob=new Blob([out],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
      download(blob, 'qr-log-'+ts()+'.xlsx');
    } else {
      const blob=xlsxBuiltIn(rows,'Log');
      download(blob, 'qr-log-'+ts()+'.xlsx');
    }
  }
  function exportCsv(){
    const rows = rowsForCsv();
    const headers=["Content","Format","Source","Date","Time","Weight","Photo","Count","Notes","Timestamp"];
    const r2=[headers].concat(rows.map(function(r){return [r.Content||r.content||'', r.Format||r.format||'', r.Source||r.source||'', r.Date||r.date||'', r.Time||r.time||'', r.Weight||r.weight||'', r.Photo||r.photo||'', r.Count||r.count||'', r.Notes||r.notes||'', r.Timestamp||r.timestamp||''];}));
    const csv=r2.map(function(row){return row.map(function(f){const s=((f==null)?'':String(f)).replace(/\"/g,'\"\"');return /[\",\n]/.test(s)?('\"'+s+'\"'):s;}).join(',');}).join('\n');
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}); download(blob, 'qr-log-'+ts()+'.csv');
  }
  function exportZip(){
    const headers=["Content","Format","Source","Date","Time","Weight","Photo","Count","Notes","Timestamp"];
    const rows = data.map(function(r){ return [r.content,r.format,r.source,r.date||'',r.time||'',r.weight||'', r.photo?('photo-'+(r.id||'')+'.jpg'):'', r.count, r.notes||'', r.timestamp||'']; });
    const csv=[headers].concat(rows).map(function(row){return row.map(function(f){const s=(f==null? '' : String(f)).replace(/\"/g,'\"\"');return /[\",\n]/.test(s)?('\"'+s+'\"'):s;}).join('\n');}).join('\n');
    const files=[{name:'qr-log-'+ts()+'.csv',bytes:Zip.strToU8(csv)}];
    for(let i=0;i<data.length;i++){
      const r=data[i];
      if(r.photo && r.photo.startsWith('data:image')){
        try{ const b64=r.photo.split(',')[1]; const bytes=Uint8Array.from(atob(b64), c=>c.charCodeAt(0)); files.push({name:'photo-'+(r.id||('row'+i))+'.jpg', bytes:bytes}); }catch(e){}
      }
    }
    const blob=Zip.make(files); download(blob, 'qr-log-bundle-'+ts()+'.zip');
  }
  const ts=()=> new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
  function download(blob, name){ const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),500); }

  function xlsxBuiltIn(rows,sheetName){sheetName=sheetName||'Log';function escXml(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;');}function colRef(n){let s='';while(n>0){const m=(n-1)%26;s=String.fromCharCode(65+m)+s;n=Math.floor((n-1)/26);}return s;}function escapeAttr(s){return String(s).replace(/&/g,'&amp;').replace(/\"/g,'&quot;').replace(/</g,'&lt;');}const cols=rows.length?Object.keys(rows[0]):[];const sheet=['<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>','<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetData>'];sheet.push('<row r=\"1\">');cols.forEach(function(c,i){sheet.push('<c r=\"'+colRef(i+1)+'1\" t=\"inlineStr\"><is><t>'+escXml(c)+'</t></is></c>');});sheet.push('</row>');rows.forEach(function(r,idx){const rr=idx+2;sheet.push('<row r=\"'+rr+'\">');cols.forEach(function(c,i){const v=(r[c]==null?'':String(r[c]));sheet.push('<c r=\"'+colRef(i+1)+rr+'\" t=\"inlineStr\"><is><t>'+escXml(v)+'</t></is></c>');});sheet.push('</row>');});sheet.push('</sheetData></worksheet>');const sheetXml=sheet.join('');const parts=[{name:'[Content_Types].xml',text:'<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">\n<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>\n<Default Extension=\"xml\" ContentType=\"application/xml\"/>\n<Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/>\n<Override PartName=\"/xl/worksheets/sheet1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>\n<Override PartName=\"/docProps/core.xml\" ContentType=\"application/vnd.openxmlformats-package.core-properties+xml\"/>\n<Override PartName=\"/docProps/app.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.extended-properties+xml\"/>\n</Types>'},{name:'_rels/.rels',text:'<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">\n  <Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/>\n  <Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties\" Target=\"docProps/core.xml\"/>\n  <Relationship Id=\"rId3\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" Target=\"docProps/app.xml\"/>\n</Relationships>'},{name:'docProps/core.xml',text:'<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<cp:coreProperties xmlns:cp=\"http://schemas.openxmlformats.org/package/2006/metadata/core-properties\" xmlns:dc=\"http://purl.org/dc/elements/1.1/\">\n  <dc:title>QR Log</dc:title><dc:creator>QR Logger</dc:creator>\n</cp:coreProperties>'},{name:'docProps/app.xml',text:'<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<Properties xmlns=\"http://schemas.openxmlformats.org/officeDocument/2006/extended-properties\"><Application>QR Logger</Application></Properties>'},{name:'xl/_rels/workbook.xml.rels',text:'<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<Relationships xmlns=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">\n  <Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet1.xml\"/>\n</Relationships>'},{name:'xl/workbook.xml',text:'<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">\n  <sheets><sheet name=\"'+escapeAttr(sheetName)+'\" sheetId=\"1\" r:id=\"rId1\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"/></sheets>\n</workbook>'},{name:'xl/worksheets/sheet1.xml',text:sheetXml}];const files=parts.map(function(p){return {name:p.name,bytes:Zip.strToU8(p.text)};});return Zip.make(files);}

  $('#importFileBtn').addEventListener('click', function(){ if(fileInput) fileInput.click(); });
  fileInput.addEventListener('change', function(e){ const file=e.target.files[0]; if(!file) return; const ext=(file.name.split('.').pop()||'').toLowerCase(); if(ext==='csv'){ importCsv(file); } else { importXlsx(file); } e.target.value=''; });
  function importCsv(file){ file.text().then(function(text){ const rows=text.split(/\r?\n/).map(function(r){ return r.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/); }); const body=rows.slice(1); for(let i=0;i<body.length;i++){ const cols=body[i]; if(!cols.length||!cols[0])continue; handleDetection(cols[0].replace(/\\"/g,'"'), cols[1]||''); const last=data[0]; last.source=cols[2]||'import'; last.date=cols[3]||last.date; last.time=cols[4]||last.time; last.weight=cols[5]||''; last.photo=''; last.count=parseInt(cols[7]||'1',10); last.notes=(cols[8]||'').replace(/^"|"$/g,''); last.timestamp=cols[9]||last.timestamp; } save(); render(); setStatus('Imported CSV.'); }).catch(function(err){ setStatus('CSV import failed: '+(err.message||err)); }); }
  function importXlsx(file){ if(!window.XLSX){ setStatus('XLSX import needs SheetJS. Populate /vendor.'); return; } const reader=new FileReader(); reader.onload=function(e){ const u8=new Uint8Array(e.target.result); const wb = window.XLSX.read(u8, {type:'array'}); const ws = wb.Sheets[wb.SheetNames[0]]; const json = window.XLSX.utils.sheet_to_json(ws, {defval:''}); for(let i=0;i<json.length;i++){ const r=json[i]; handleDetection(String(r.Content||r.content||''), String(r.Format||r.format||'')); const last=data[0]; last.source=String(r.Source||'import'); last.date=String(r.Date||''); last.time=String(r.Time||''); last.weight=String(r.Weight||''); last.notes=String(r.Notes||''); last.timestamp=String(r.Timestamp||''); } save(); render(); setStatus('Imported XLSX.'); }; reader.readAsArrayBuffer(file); }

  if(exportXlsxBtn) exportXlsxBtn.addEventListener('click', exportXlsx);
  if(exportCsvBtn) exportCsvBtn.addEventListener('click', exportCsv);
  if(exportZipBtn) exportZipBtn.addEventListener('click', exportZip);
  if(clearBtn) clearBtn.addEventListener('click', function(){ if(confirm('Clear all rows?')){ data=[]; save(); render(); seenEver.clear(); } });
  if(resetDupBtn) resetDupBtn.addEventListener('click', function(){ seenEver.clear(); toast('Duplicate memory cleared'); });

  if(cooldownSecInput){ cooldownSecInput.addEventListener('change', function(){ const v=parseFloat(cooldownSecInput.value); cooldownSec = Math.max(0, Math.min(10, isNaN(v)?5:v)); cooldownSecInput.value = String(cooldownSec); }); }

  $('#permBtn').addEventListener('click', requestPermission);
  $('#startBtn').addEventListener('click', startFromSelection);
  $('#stopBtn').addEventListener('click', function(){ stop(); setStatus('Camera stopped.'); });
  $('#refreshBtn').addEventListener('click', enumerateCams);
  cameraSelect.addEventListener('change', startFromSelection);
  serialBtn.addEventListener('click', connectSerial);
  connectHIDBtn.addEventListener('click', function(){ setStatus('Select/attach a USB scale, then place an item. Weight will appear when the device reports digits.'); });
  connectBLEBtn.addEventListener('click', function(){ setStatus('Pair to a Bluetooth scale; specific services vary by device.'); });

  const installBtn=$('#installBtn'); let deferredPrompt=null;
  if('serviceWorker' in navigator){ navigator.serviceWorker.register('./sw.js'); }
  window.addEventListener('beforeinstallprompt', function(e){
    e.preventDefault();
    deferredPrompt=e;
    if(installBtn) installBtn.style.display='inline-block';
  });
  if(installBtn){ installBtn.addEventListener('click', function(){ if(!deferredPrompt) return; deferredPrompt.prompt(); deferredPrompt.userChoice.then(function(){ deferredPrompt=null; installBtn.style.display='none'; }); }); }

  (function(){ const isAndroid = /Android/i.test(navigator.userAgent||''); const isSecure = location.protocol==='https:' || location.hostname==='localhost'; const banner=document.getElementById('androidBanner'); if(isAndroid && !isSecure){ banner.style.display='block'; banner.textContent='Android requires HTTPS (or localhost) for camera access. Use https:// or run locally via npm start.'; } })();

  load(); render(); updatePerm(); enumerateCams();
  if(document.visibilityState==='visible') setStatus('Ready. Engines: BD → zxing-wasm → jsQR');
  window.addEventListener('resize', drawROI);
  function beep(){ try{ const a=new AudioContext(), o=a.createOscillator(), g=a.createGain(); o.type='square'; o.frequency.value=880; o.connect(g); g.connect(a.destination); g.gain.setValueAtTime(0.05,a.currentTime); o.start(); setTimeout(()=>{o.stop(); a.close();},90);}catch(e){} }

  ocrToggleBtn.addEventListener('click', function(){
    roi.show=!roi.show;
    drawROI();
    if(roi.show){
      setStatus('OCR box enabled. Set Scale source to "OCR from camera".');
      startOcrPulse();
    }else{
      clearInterval(ocrPulseTimer); roi.hasText=false; drawROI();
    }
  });
})();