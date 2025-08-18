// QR-Reader Full v7.0.2 — ZXing detection patch
(function(){
  'use strict';
  const $=s=>document.querySelector(s);
  const video=$('#video'), overlay=$('#overlay'), octx=overlay.getContext('2d');
  const statusEl=$('#status'), cameraSelect=$('#cameraSelect'), prefFacing=$('#prefFacing'), scanEnginePill=$('#scanEngine'), permStateEl=$('#permState');
  const cooldownSecInput=$('#cooldownSec'), ignoreDupChk=$('#ignoreDup');
  const fileInput=$('#fileInput');
  const cameraSourceSel=$('#cameraSource');
  const delaySecInput=$('#delaySec'), scaleModeSel=$('#scaleMode');
  const ocrToggleBtn=$('#ocrToggle'), connectHIDBtn=$('#connectHID'), connectBLEBtn=$('#connectBLE');
  const serialBtn=$('#connectSerial'), serialState=$('#serialState');

  let stream=null, scanning=false, detector=null;
  let data=[]; const STORAGE_KEY='qrLoggerFull';
  let cooldownSec=5; let cooldownUntil=0; let ignoreDup=true; let lastContent=''; let lastAt=0;
  let zxingReader=null; let scanTimer=null;
  const roi = { x:0.6, y:0.6, w:0.38, h:0.35, show:false };

  // Web Serial (phone/BT feeding codes)
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
  function sizeOverlay(){ overlay.width=video.clientWidth; overlay.height=video.clientHeight; }
  window.addEventListener('resize', sizeOverlay);
  function stop(){ scanning=false; if(stream){ stream.getTracks().forEach(t=>t.stop()); stream=null; } if(octx){ octx.clearRect(0,0,overlay.width,overlay.height); } clearTimeout(scanTimer); }

  // Engines: BarcodeDetector → ZXing → jsQR
  async function initScanner(){
    clearTimeout(scanTimer);
    if(cameraSourceSel.value!=='local'){ if(scanEnginePill){ scanEnginePill.textContent='Engine: remote/serial'; } return; }
    if('BarcodeDetector' in window){
      try{
        let fmts=['qr_code','data_matrix','aztec','pdf417','code_128','code_39','codabar','itf','ean_13','ean_8','upc_a','upc_e'];
        try{ if(typeof BarcodeDetector.getSupportedFormats==='function'){ const got=await BarcodeDetector.getSupportedFormats(); fmts = got.filter(x=>fmts.includes(x)); if(!fmts.length) fmts=['qr_code']; } }catch(_e){}
        try{ detector = new BarcodeDetector({formats: fmts}); }
        catch(e1){ try{ detector=new BarcodeDetector({formats:['qr_code']}); }catch(e2){ detector=new BarcodeDetector(); } }
        if(scanEnginePill){ scanEnginePill.textContent='Engine: BarcodeDetector ('+fmts.join(', ')+')'; }
        scanning=true; loopBD(); return;
      }catch(e){ /* fallback */ }
    }
    if(setupZXing()){
      if(scanEnginePill){ scanEnginePill.textContent='Engine: ZXing (local)'; } scanning=true; loopZXing(); return;
    }
    if(window.jsQR){
      if(scanEnginePill){ scanEnginePill.textContent='Engine: jsQR (local)'; } scanning=true; loopJsQR(); return;
    }
    if(scanEnginePill){ scanEnginePill.textContent='Engine: none'; }
    setStatus('No scanning engine available. Populate /vendor via get-vendor script.');
  }
  const inCooldown=()=>Date.now()<cooldownUntil;
  let pendingWeightTimer=null;
  function handleDetection(text, format){
    const now=Date.now(); if(ignoreDup && text===lastContent && (now-lastAt)<cooldownSec*1000){ cooldownUntil=now+cooldownSec*1000; return; }
    lastContent=text; lastAt=now; cooldownUntil=now+cooldownSec*1000;
    const row = upsert(text, format||'qr_code', cameraSourceSel.value || 'camera');
    const delayMs = Math.max(0, Math.min(4000, Math.floor(parseFloat(delaySecInput.value||'2')*1000)));
    if(pendingWeightTimer){ clearTimeout(pendingWeightTimer); pendingWeightTimer=null; }
    pendingWeightTimer = setTimeout(()=>{ captureWeightAndPhoto(row); }, delayMs);
  }
  function loopBD(){
    if(!scanning || !video || video.readyState<2){ scanTimer=setTimeout(loopBD,120); return; }
    if(inCooldown()){ scanTimer=setTimeout(loopBD,280); return; }
    (async ()=>{
      try{
        let det=null;
        try{ det=await detector.detect(video); }catch(e){}
        if(det && det.length){ const c=det[0]; const text=c.rawValue||''; if(text){ handleDetection(text,c.format||'qr_code'); setTimeout(loopBD,200); return; } }
      }catch(e){}
      scanTimer=setTimeout(loopBD,140);
    })();
  }
  const sample=document.createElement('canvas'); const sctx=sample.getContext('2d',{willReadFrequently:true});

  function setupZXing(){
    if(window.__ZXDbg == null) window.__ZXDbg = {};
    const dbg = window.__ZXDbg;
    dbg.hasZXing = typeof window.ZXing !== 'undefined';
    dbg.hasZXingBrowser = typeof window.ZXingBrowser !== 'undefined';
    dbg.hasBMFReader = !!(window.ZXingBrowser && window.ZXingBrowser.BrowserMultiFormatReader);
    if (!dbg.hasZXing || !dbg.hasZXingBrowser || !dbg.hasBMFReader) {
      console.warn('ZXing wiring:', dbg);
      const hints = [];
      if (!dbg.hasZXing) hints.push('vendor/zxing.min.js missing or not loaded first');
      if (!dbg.hasZXingBrowser) hints.push('vendor/zxing-browser.min.js missing');
      if (!dbg.hasBMFReader) hints.push('BrowserMultiFormatReader not on ZXingBrowser (wrong file/version)');
      setStatus('ZXing not available: ' + hints.join(' | '));
      return false;
    }
    try{
      zxingReader=new window.ZXingBrowser.BrowserMultiFormatReader();
      return true;
    }catch(e){
      console.error('ZXing init error', e);
      setStatus('ZXing init error: ' + (e.message || e));
      return false;
    }
  }

  function loopZXing(){
    if(!scanning || !video || video.readyState<2){ scanTimer=setTimeout(loopZXing,180); return; }
    if(inCooldown()){ scanTimer=setTimeout(loopZXing,300); return; }
    const vw=video.videoWidth||0, vh=video.videoHeight||0; if(!vw||!vh){ scanTimer=setTimeout(loopZXing,180); return; }
    const MAXW=720; const scale = vw>MAXW ? (MAXW/vw) : 1;
    const sw=Math.max(1,Math.floor(vw*scale)), sh=Math.max(1,Math.floor(vh*scale));
    sample.width=sw; sample.height=sh; sctx.imageSmoothingEnabled=false; sctx.drawImage(video,0,0,sw,sh);
    try{
      if(!zxingReader){ scanTimer=setTimeout(loopZXing,200); return; }
      const resPromise = (zxingReader.decodeFromCanvas ? zxingReader.decodeFromCanvas(sample) : null);
      if(resPromise && typeof resPromise.then==='function'){
        resPromise.then(res=>{ if(res && res.text){ const fmt=(res.format || (res.barcodeFormat && res.barcodeFormat.toString())) || 'multi'; handleDetection(res.text, fmt); } })
        .catch(()=>{})
        .finally(()=>{ scanTimer=setTimeout(loopZXing, 160); });
      } else {
        if(scanEnginePill){ scanEnginePill.textContent='Engine: none'; }
        setStatus('ZXing not available (missing vendor files). Run get-vendor script.');
      }
    }catch(e){ scanTimer=setTimeout(loopZXing,200); }
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

  function ocrWeight(row){
    if(!(window.Tesseract && window.Tesseract.recognize)){ setStatus('Tesseract not loaded (populate /vendor).'); return; }
    try{
      const vw=video.videoWidth||0, vh=video.videoHeight||0; if(!vw||!vh) return;
      const c=document.createElement('canvas'); c.width=Math.max(1,Math.floor(vw*roi.w)); c.height=Math.max(1,Math.floor(vh*roi.h));
      const cx=c.getContext('2d');
      const sx=Math.floor(vw*roi.x), sy=Math.floor(vh*roi.y);
      cx.drawImage(video, sx, sy, Math.floor(vw*roi.w), Math.floor(vh*roi.h), 0, 0, c.width, c.height);
      window.Tesseract.recognize(c, 'eng', { logger:function(){} })
        .then(res=>{
          const txt=(res.data&&res.data.text)?res.data.text:'';
          const m=txt.replace(/[, ]/g,'').match(/[-+]?\\d*\\.?\\d+(?:kg|g|lb|lbs|oz)?/i);
          if(m){ row.weight=m[0]; save(); render(); setStatus('Weight OCR: '+m[0]); }
          else{ setStatus('No numeric weight detected via OCR.'); }
        }).catch(err=>{ setStatus('Tesseract error: '+(err.message||err)); });
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
      d.addEventListener('inputreport', e=>{
        const bytes = new Uint8Array(e.data.buffer);
        let str=''; for(let i=0;i<bytes.length;i++){ const c=bytes[i]; if(c>=32&&c<127) str+=String.fromCharCode(c); }
        const m=str.replace(/[, ]/g,'').match(/[-+]?\\d*\\.?\\d+\\s*(?:kg|g|lb|lbs|oz)?/i);
        if(m){ const weight=m[0]; row.weight=weight; save(); render(); setStatus('HID weight: '+weight); }
      });
    }catch(e){ setStatus('HID error: '+(e.message||e)); }
  }
  async function bleWeight(row){
    if(!('bluetooth' in navigator)){ setStatus('Web Bluetooth not supported.'); return; }
    try{
      const device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: ['device_information','battery_service'] });
      const server = await device.gatt.connect();
      setStatus('BLE connected: '+(device.name||'device'));
      // Implement device-specific weight characteristic parsing as needed.
    }catch(e){ setStatus('BLE error: '+(e.message||e)); }
  }

  function drawROI(){
    if(!octx) return; octx.clearRect(0,0,overlay.width,overlay.height);
    if(roi.show && video && video.readyState>=2){
      const sx=roi.x*overlay.width, sy=roi.y*overlay.height, sw=roi.w*overlay.width, sh=roi.h*overlay.height;
      octx.strokeStyle='rgba(255,255,255,0.7)'; octx.lineWidth=2; octx.setLineDash([6,4]); octx.strokeRect(sx, sy, sw, sh);
      octx.setLineDash([]);
    }
  }
  ocrToggleBtn.addEventListener('click', ()=>{ roi.show=!roi.show; drawROI(); });

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
  document.addEventListener('click', e=>{
    const btn=e.target.closest('button'); if(!btn) return;
    const tr=e.target.closest('tr'); const id=tr && tr.dataset ? tr.dataset.id : null;
    const act=btn.getAttribute('data-act');
    if(act==='delete' && id){ data = data.filter(r=>r.id!==id); save(); render(); }
    if(act==='edit' && id){ const row=data.find(r=>r.id===id); const nv=prompt('Edit content:', row?row.content:''); if(nv!==null && row){ row.content=nv; save(); render(); } }
  });
  document.addEventListener('blur', e=>{
    const c=e.target; if(!c.classList || !c.classList.contains('note-cell')) return;
    const tr=c.closest('tr'); const id=tr && tr.dataset ? tr.dataset.id : null;
    const row=data.find(r=>r.id===id);
    if(row){ row.notes=c.textContent; save(); }
  }, true);

  const manualInput=$('#manualInput');
  $('#addManualBtn').addEventListener('click', ()=>{ const v=manualInput && manualInput.value ? manualInput.value.trim() : ''; if(v){ upsert(v,'text','manual/keyboard'); manualInput.value=''; } });
  if(manualInput){ manualInput.addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); const v=manualInput.value.trim(); if(v){ upsert(v,'text','manual/keyboard'); manualInput.value=''; } } }); }

  // Built-in exporters + SheetJS override
  const Zip=(function(){function ct(){var t=new Uint32Array(256);for(var n=0;n<256;n++){var c=n;for(var k=0;k<8;k++){c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);}t[n]=c>>>0;}return t;}var TBL=ct();function crc32(u8){var c=~0>>>0;for(var i=0;i<u8.length;i++){c=TBL[(c^u8[i])&0xFF]^(c>>>8);}return(~c)>>>0;}function toU8(s){return new TextEncoder().encode(s);}function d2d(d){var dt=new Date(d||Date.now());var time=(dt.getHours()<<11)|(dt.getMinutes()<<5)|((Math.floor(dt.getSeconds()/2))&0x1F);var date=((dt.getFullYear()-1980)<<9)|((dt.getMonth()+1)<<5)|dt.getDate();return{time:time,date:date};}function w32(v,o,x){v.setUint32(o,x>>>0,true);}function w16(v,o,x){v.setUint16(o,x&0xFFFF,true);}function make(files){var parts=[],central=[],offset=0;var stamp=d2d(Date.now());files.forEach(function(f){var nameU8=toU8(f.name);var b=f.bytes instanceof Uint8Array?f.bytes:toU8(String(f.bytes||''));var crc=crc32(b);var hdr=new DataView(new ArrayBuffer(30));w32(hdr,0,0x04034b50);w16(hdr,4,20);w16(hdr,6,0);w16(hdr,8,0);w16(hdr,10,stamp.time);w16(hdr,12,stamp.date);w32(hdr,14,crc);w32(hdr,18,b.length);w32(hdr,22,b.length);w16(hdr,26,nameU8.length);w16(hdr,28,0);parts.push(new Uint8Array(hdr.buffer));parts.push(nameU8);parts.push(b);var cen=new DataView(new ArrayBuffer(46));w32(cen,0,0x02014b50);w16(cen,4,20);w16(cen,6,20);w16(cen,8,0);w16(cen,10,0);w16(cen,12,stamp.time);w16(cen,14,stamp.date);w32(cen,16,crc);w32(cen,20,b.length);w32(cen,24,b.length);w16(cen,28,nameU8.length);w16(cen,30,0);w16(cen,32,0);w16(cen,34,0);w16(cen,36,0);w32(cen,38,0);w32(cen,42,offset);central.push(new Uint8Array(cen.buffer));central.push(nameU8);offset+=30+nameU8.length+b.length;});var centralSize=central.reduce(function(a,u){return a+u.length;},0);var eocd=new DataView(new ArrayBuffer(22));w32(eocd,0,0x06054b50);w16(eocd,4,0);w16(eocd,6,0);w16(eocd,8,files.length);w16(eocd,10,files.length);w32(eocd,12,centralSize);w32(eocd,16,parts.reduce(function(a,u){return a+u.length;},0));w16(eocd,20,0);var totalLen=parts.reduce(function(a,u){return a+u.length;},0)+centralSize+eocd.byteLength;var out=new Uint8Array(totalLen);var p=0;parts.concat(central).forEach(function(u){out.set(u,p);p+=u.length;});out.set(new Uint8Array(eocd.buffer),p);return new Blob([out],{type:'application/zip'});}return{make:make,strToU8:toU8};})();
  function rowsForExport(){ return data.map(r=>({"Content":r.content,"Format":r.format,"Source":r.source,"Date":r.date||"","Time":r.time||"","Weight":r.weight||"","Photo":r.photo||"","Count":r.count,"Notes":r.notes||"","Timestamp":r.timestamp||""})); }
  function xlsxBuiltIn(rows,sheetName){sheetName=sheetName||'Log';function escXml(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;');}function colRef(n){let s='';while(n>0){const m=(n-1)%26;s=String.fromCharCode(65+m)+s;n=Math.floor((n-1)/26);}return s;}function escapeAttr(s){return String(s).replace(/&/g,'&amp;').replace(/\"/g,'&quot;').replace(/</g,'&lt;');}const cols=rows.length?Object.keys(rows[0]):[];const sheet=['<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>','<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetData>'];sheet.push('<row r=\"1\">');cols.forEach((c,i)=>{sheet.push('<c r=\"'+colRef(i+1)+'1\" t=\"inlineStr\"><is><t>'+escXml(c)+'</t></is></c>');});sheet.push('</row>');rows.forEach((r,idx)=>{const rr=idx+2;sheet.push('<row r=\"'+rr+'\">');cols.forEach((c,i)=>{const v=(r[c]==null?'':String(r[c]));sheet.push('<c r=\"'+colRef(i+1)+rr+'\" t=\"inlineStr\"><is><t>'+escXml(v)+'</t></is></c>');});sheet.push('</row>');});sheet.push('</sheetData></worksheet>');const sheetXml=sheet.join('');const parts=[{name:'[Content_Types].xml',text:'<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\\n<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">\\n<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>\\n<Default Extension=\"xml\" ContentType=\"application/xml\"/>\\n<Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/>\\n<Override PartName=\"/xl/worksheets/sheet1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>\\n<Override PartName=\"/docProps/core.xml\" ContentType=\"application/vnd.openxmlformats-package.core-properties+xml\"/>\\n<Override PartName=\"/docProps/app.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.extended-properties+xml\"/>\\n</Types>'},{name:'_rels/.rels',text:'<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\\n<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">\\n  <Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/>\\n  <Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties\" Target=\"docProps/core.xml\"/>\\n  <Relationship Id=\"rId3\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties\" Target=\"docProps/app.xml\"/>\\n</Relationships>'},{name:'docProps/core.xml',text:'<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\\n<cp:coreProperties xmlns:cp=\"http://schemas.openxmlformats.org/package/2006/metadata/core-properties\" xmlns:dc=\"http://purl.org/dc/elements/1.1/\">\\n  <dc:title>QR Log</dc:title><dc:creator>QR Logger</dc:creator>\\n</cp:coreProperties>'},{name:'docProps/app.xml',text:'<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\\n<Properties xmlns=\"http://schemas.openxmlformats.org/officeDocument/2006/extended-properties\"><Application>QR Logger</Application></Properties>'},{name:'xl/_rels/workbook.xml.rels',text:'<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\\n<Relationships xmlns=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">\\n  <Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet1.xml\"/>\\n</Relationships>'},{name:'xl/workbook.xml',text:'<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\\n<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">\\n  <sheets><sheet name=\"'+escapeAttr(sheetName)+'\" sheetId=\"1\" r:id=\"rId1\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"/></sheets>\\n</workbook>'},{name:'xl/worksheets/sheet1.xml',text:sheetXml}];const files=parts.map(p=>({name:p.name,bytes:Zip.strToU8(p.text)}));return Zip.make(files);}
  function exportXlsx(){ if(window.XLSX){ const ws=window.XLSX.utils.json_to_sheet(rowsForExport()); const wb=window.XLSX.utils.book_new(); window.XLSX.utils.book_append_sheet(wb, ws, 'Log'); const out = window.XLSX.write(wb, {bookType:'xlsx', type:'array'}); const blob=new Blob([out],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}); download(blob, 'qr-log-'+ts()+'.xlsx'); } else { const blob=xlsxBuiltIn(rowsForExport(),'Log'); download(blob, 'qr-log-'+ts()+'.xlsx'); } }
  function exportCsv(){ const headers=[\"Content\",\"Format\",\"Source\",\"Date\",\"Time\",\"Weight\",\"Photo\",\"Count\",\"Notes\",\"Timestamp\"]; const rows=[headers].concat(data.map(r=>[r.content,r.format,r.source,r.date||'',r.time||'',r.weight||'',r.photo||'',r.count,r.notes||'',r.timestamp||''])); const csv=rows.map(row=>row.map(f=>{const s=((f==null)?'':String(f)).replace(/\\\"/g,'\\\"\\\"');return /[\\\",\\n]/.test(s)?('\"'+s+'\"'):s;}).join(',')).join('\\n'); const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}); download(blob, 'qr-log-'+ts()+'.csv'); }
  function exportZip(){ const headers=[\"Content\",\"Format\",\"Source\",\"Date\",\"Time\",\"Weight\",\"Photo\",\"Count\",\"Notes\",\"Timestamp\"]; const rows=[headers].concat(data.map(r=>[r.content,r.format,r.source,r.date||'',r.time||'',r.weight||'',r.photo?('photo-'+(r.id||'')+'.jpg'):'',r.count,r.notes||'',r.timestamp||''])); const csv=rows.map(row=>row.map(f=>{const s=(f==null? '' : String(f)).replace(/\\\"/g,'\\\"\\\"');return /[\\\",\\n]/.test(s)?('\"'+s+'\"'):s;}).join(',')).join('\\n'); const files=[{name:'qr-log-'+ts()+'.csv',bytes:Zip.strToU8(csv)}]; for(let i=0;i<data.length;i++){ const r=data[i]; if(r.photo && r.photo.startsWith('data:image')){ try{ const b64=r.photo.split(',')[1]; const bytes=Uint8Array.from(atob(b64), c=>c.charCodeAt(0)); files.push({name:'photo-'+(r.id||('row'+i))+'.jpg', bytes:bytes}); }catch(e){} } } const blob=Zip.make(files); download(blob, 'qr-log-bundle-'+ts()+'.zip'); }
  const ts=()=>new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
  function download(blob, name){ const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),500); }

  $('#importFileBtn').addEventListener('click', ()=>{ if(fileInput) fileInput.click(); });
  fileInput.addEventListener('change', e=>{ const file=e.target.files[0]; if(!file) return; const ext=(file.name.split('.').pop()||'').toLowerCase(); if(ext==='csv'){ importCsv(file); } else { importXlsx(file); } e.target.value=''; });
  function importCsv(file){ file.text().then(text=>{ const rows=text.split(/\\r?\\n/).map(r=> r.split(/,(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)/) ); const body=rows.slice(1); for(let i=0;i<body.length;i++){ const cols=body[i]; if(!cols.length||!cols[0])continue; upsert(cols[0].replace(/\\\"/g,'\"'), cols[1]||'', cols[2]||'import'); const last=data[0]; last.date=cols[3]||last.date; last.time=cols[4]||last.time; last.weight=cols[5]||''; last.photo=''; last.count=parseInt(cols[7]||'1',10); last.notes=(cols[8]||'').replace(/^\"|\"$/g,''); last.timestamp=cols[9]||last.timestamp; } save(); render(); setStatus('Imported CSV.'); }).catch(err=>{ setStatus('CSV import failed: '+(err.message||err)); }); }
  function importXlsx(file){ if(!window.XLSX){ setStatus('XLSX import needs SheetJS. Populate /vendor.'); return; } const reader=new FileReader(); reader.onload=e=>{ const u8=new Uint8Array(e.target.result); const wb = window.XLSX.read(u8, {type:'array'}); const ws = wb.Sheets[wb.SheetNames[0]]; const json = window.XLSX.utils.sheet_to_json(ws, {defval:''}); for(let i=0;i<json.length;i++){ const r=json[i]; upsert(String(r.Content||r.content||''), String(r.Format||r.format||''), String(r.Source||r.source||'import')); const last=data[0]; last.date=String(r.Date||''); last.time=String(r.Time||''); last.weight=String(r.Weight||''); last.notes=String(r.Notes||''); last.timestamp=String(r.Timestamp||''); } save(); render(); setStatus('Imported XLSX.'); }; reader.readAsArrayBuffer(file); }

  if(cooldownSecInput){ cooldownSecInput.addEventListener('change', ()=>{ const v=parseFloat(cooldownSecInput.value); cooldownSec = Math.max(0, Math.min(10, isNaN(v)?5:v)); cooldownSecInput.value = String(cooldownSec); }); }
  if(ignoreDupChk){ ignoreDupChk.addEventListener('change', ()=>{ ignoreDup = !!ignoreDupChk.checked; }); }

  $('#permBtn').addEventListener('click', requestPermission);
  $('#startBtn').addEventListener('click', startFromSelection);
  $('#stopBtn').addEventListener('click', ()=>{ stop(); setStatus('Camera stopped.'); });
  $('#refreshBtn').addEventListener('click', enumerateCams);
  cameraSelect.addEventListener('change', startFromSelection);
  serialBtn.addEventListener('click', connectSerial);
  connectHIDBtn.addEventListener('click', ()=>{ setStatus('Select/attach a USB scale, then place an item. Weight will appear when the device reports digits.'); });
  connectBLEBtn.addEventListener('click', ()=>{ setStatus('Pair to a Bluetooth scale; specific services vary by device.'); });

  const installBtn=$('#installBtn'); let deferredPrompt=null;
  if('serviceWorker' in navigator){ navigator.serviceWorker.register('./sw.js'); }
  window.addEventListener('beforeinstallprompt', (e)=>{
    // Custom UX (native banner suppressed; console info is expected)
    e.preventDefault();
    deferredPrompt=e;
    if(installBtn) installBtn.style.display='inline-block';
  });
  installBtn && installBtn.addEventListener('click', async ()=>{ if(!deferredPrompt) return; deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt=null; installBtn.style.display='none'; });

  (function(){ const isAndroid = /Android/i.test(navigator.userAgent||''); const isSecure = location.protocol==='https:' || location.hostname==='localhost'; const banner=document.getElementById('androidBanner'); if(isAndroid && !isSecure){ banner.style.display='block'; banner.textContent='Android requires HTTPS (or localhost) for camera access. Use https:// or run locally via npm start.'; } })();

  load(); render(); updatePerm(); enumerateCams();
  if(document.visibilityState==='visible') setStatus('Ready. Engines: BarcodeDetector → ZXing (local) → jsQR (local).');
  window.addEventListener('resize', drawROI);
  function beep(){ try{ const a=new AudioContext(), o=a.createOscillator(), g=a.createGain(); o.type='square'; o.frequency.value=880; o.connect(g); g.connect(a.destination); g.gain.setValueAtTime(0.05,a.currentTime); o.start(); setTimeout(()=>{o.stop(); a.close();},90);}catch(e){} }
})();