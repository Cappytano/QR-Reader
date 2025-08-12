// QR Logger v6.1.1 — Local vendor libs + Multi‑format scanning + BT/Serial phone
(function(){
  const $ = s => document.querySelector(s);
  const video = $('#video');
  const canvas = $('#canvas');
  const overlay = $('#overlay');
  const ctx = canvas.getContext('2d', { willReadFrequently:true });
  const octx = overlay.getContext('2d');
  const statusEl = $('#status');
  const remoteStatusEl = $('#remoteStatus');
  const serialStateEl = $('#serialState');
  const cameraSelect = $('#cameraSelect');
  const prefFacing = $('#prefFacing');
  const scanEnginePill = $('#scanEngine');
  const permStateEl = $('#permState');
  const androidBanner = $('#androidBanner');

  const scaleModeSel = $('#scaleMode');
  const delayInput = $('#delaySec');
  const connectHIDBtn = $('#connectHID');
  const connectBLEBtn = $('#connectBLE');
  const ocrToggleBtn = $('#ocrToggle');

  const cameraSourceSel = $('#cameraSource');
  const connectSerialBtn = $('#connectSerial');

  const cooldownSecInput = $('#cooldownSec');
  const ignoreDupChk = $('#ignoreDup');
  const enhancedChk = $('#enhancedDecoder');
  const preferZXingChk = $('#preferZXing');

  let stream = null, scanning = false, detector = null, usingBarcodeDetector=false;
  let data = []; const STORAGE_KEY='qrLoggerV1';

  // scale & OCR state
  let ocrBox={x:0.6,y:0.65,w:0.35,h:0.25}, ocrBoxEnabled=false, isDragging=false, dragOffset={x:0,y:0};

  // cooldown & dup guard
  let cooldownSec=5; let cooldownUntil=0;
  let ignoreDup=true; let lastContent=''; let lastAt=0;
  let enhanced=false; let preferZXing=false;

  // serial state
  let serialPort=null, serialReader=null, serialConnected=false;

  function setStatus(t){ statusEl.textContent = t || ''; }
  function setRemoteStatus(t){ remoteStatusEl.textContent = t || ''; }
  function setSerialState(t){ if(serialStateEl) serialStateEl.textContent = t || ''; }
  function save(){ try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }catch(e){} }
  function load(){ try{ data = JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]'); }catch(e){ data=[]; } }

  // Android banner (unchanged)
  const isAndroid=/Android/i.test(navigator.userAgent);
  const isInApp=/FBAN|FBAV|Instagram|Line\/|WeChat|Twitter|Snapchat|DuckDuckGo/i.test(navigator.userAgent);
  function showAndroidBanner(){ if(!isAndroid) return; const host=location.hostname; let msg='<b>Android tip:</b> '; msg+=isInApp?'You appear to be in an in‑app browser. Use menu → <b>Open in Chrome</b>.':'If no prompt: tap ⓘ/🔒 → <b>Permissions</b> → <b>Camera → Allow</b>, then reload.'; msg+='<br/>System: Settings → Apps → <b>Chrome</b> → Permissions → Camera → Allow.'; msg+='<br/>Site reset: Chrome ⋮ → Settings → Site settings → All sites → <b>'+host+'</b> → Clear & reset.'; androidBanner.innerHTML=msg; androidBanner.style.display='block'; }

  async function updatePerm(){ permStateEl.textContent=''; if(!('permissions' in navigator)) return; try{ const st=await navigator.permissions.query({name:'camera'}); permStateEl.textContent='Permission: '+st.state; st.onchange=()=>{ permStateEl.textContent='Permission: '+st.state; }; }catch(e){} }

  function decideFacing(){ const p=prefFacing.value; if(p==='environment') return {facingMode:{ideal:'environment'}}; if(p==='user') return {facingMode:{ideal:'user'}}; return /Android/i.test(navigator.userAgent)?{facingMode:{ideal:'environment'}}:{facingMode:{ideal:'user'}}; }

  async function enumerateCams(){ try{ const devs=await navigator.mediaDevices.enumerateDevices(); const cams=devs.filter(d=>d.kind==='videoinput'); cameraSelect.innerHTML=''; if(!cams.length){ const o=document.createElement('option'); o.value=''; o.textContent='No cameras detected'; cameraSelect.appendChild(o); return cams; } cams.forEach((c,i)=>{ const o=document.createElement('option'); o.value=c.deviceId||''; o.textContent=c.label||('Camera '+(i+1)); cameraSelect.appendChild(o); }); return cams; }catch(e){ setStatus('enumerateDevices failed: '+e.message); return []; } }

  async function requestPermission(){ try{ setStatus('Requesting camera permission…'); const s=await navigator.mediaDevices.getUserMedia({video:decideFacing(),audio:false}); s.getTracks().forEach(t=>t.stop()); setStatus('Permission granted.'); }catch(e){ setStatus('Permission request failed: '+(e.name||'')+' '+(e.message||e)); showAndroidBanner(); } await updatePerm(); if(navigator.mediaDevices && navigator.mediaDevices.enumerateDevices){ await enumerateCams(); } }

  function useStream(s, sourceLabel){
    stop();
    stream=s;
    video.srcObject=stream;
    video.play().then(()=>{
      const track=stream.getVideoTracks()[0]; const st=track?track.getSettings():{};
      setStatus((sourceLabel||'Camera')+' started ('+(st.width||'?')+'×'+(st.height||'?')+')');
      sizeOverlay(); initScanner(); tryApplyDefaults();
    }).catch(e=> setStatus('Video play failed: '+e.message));
  }

  async function startFromSelection(){
    if(serialConnected){ setStatus('Using phone via Bluetooth/Serial. Camera not required.'); return true; }
    let errors=[];
    async function attempt(v){
      try{
        stop();
        setStatus('Starting camera…');
        const s=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:1920},height:{ideal:1080},focusMode:'continuous',advanced:[{focusMode:'continuous'}],...v},audio:false});
        useStream(s, 'Camera');
        return true;
      }catch(e){
        errors.push(e.name+': '+e.message);
        return false;
      }
    }
    const id=cameraSelect.value;
    if(id && await attempt({deviceId:{exact:id}})) return true;
    if(await attempt(decideFacing())) return true;
    const opp=prefFacing.value==='user'?{facingMode:{ideal:'environment'}}:{facingMode:{ideal:'user'}};
    if(await attempt(opp)) return true;
    if(await attempt(true)) return true;
    setStatus('Failed to start camera. '+errors.join(' | ')); showAndroidBanner(); return false;
  }

  function getTrack(){ if(!stream) return null; const tracks=stream.getVideoTracks(); return tracks && tracks[0] ? tracks[0] : null; }
  function sizeOverlay(){ overlay.width=video.clientWidth; overlay.height=video.clientHeight; drawOCRBox(); }
  window.addEventListener('resize', sizeOverlay);
  async function tryApplyDefaults(){ try{ const t=getTrack(); if(!t) return; const caps=t.getCapabilities ? t.getCapabilities() : {}; const cons={advanced:[]}; if(caps.focusMode && caps.focusMode.indexOf('continuous')>-1) cons.advanced.push({focusMode:'continuous'}); if(caps.exposureMode && caps.exposureMode.indexOf('continuous')>-1) cons.advanced.push({exposureMode:'continuous'}); if(cons.advanced.length) await t.applyConstraints(cons); }catch(e){} }
  function stop(){ scanning=false; if(stream){ stream.getTracks().forEach(t=>t.stop()); stream=null; } if(octx){ octx.clearRect(0,0,overlay.width,overlay.height); } }

  // ---- Scanning with multi-format + cooldown/dup ----
  let bdFailCount=0, scanTimer=null, zxingReader=null, zxingBusy=false, lastZxingTry=0;
  const SUPPORTED_BD = ['qr_code','aztec','data_matrix','pdf417','code_128','code_39','code_93','codabar','itf','ean_13','ean_8','upc_a','upc_e']; // MaxiCode/MicroQR not commonly exposed
  async function initScanner(){
    clearTimeout(scanTimer); bdFailCount=0;
    usingBarcodeDetector = ('BarcodeDetector' in window);
    if(usingBarcodeDetector){
      try{
        let fmts = SUPPORTED_BD.slice(0);
        if(typeof BarcodeDetector.getSupportedFormats === 'function'){
          try{ const got = await BarcodeDetector.getSupportedFormats(); fmts = got && got.length ? got : fmts; }catch(e){}
        }
        detector=new BarcodeDetector({formats:fmts});
        scanEnginePill.textContent='Engine: BarcodeDetector ('+fmts.length+' types)';
        scanning=true;
        if(preferZXing && setupZXing()){ scanEnginePill.textContent='Engine: ZXing (preferred)'; loopZXing(); }
        else loopDetector();
        return;
      }catch(e){ usingBarcodeDetector=false; }
    }
    if(setupZXing()){ scanEnginePill.textContent='Engine: ZXing'; scanning=true; loopZXing(); return; }
    scanEnginePill.textContent='Engine: jsQR (QR only)';
    scanning=true; loopJsQR();
  }

  function inCooldown(){ const now=Date.now(); return now<cooldownUntil; }
  function handleDetection(text, format, source){
    const now=Date.now();
    if(ignoreDup && lastContent===text && (now-lastAt)<cooldownSec*1000){ cooldownUntil = now + cooldownSec*1000; return; }
    lastContent=text; lastAt=now; cooldownUntil = now + cooldownSec*1000;
    upsert(text, format||'qr_code', source);
  }

  function loopDetector(){
    if(!scanning || !video || video.readyState<2){ scanTimer=setTimeout(loopDetector, 120); return; }
    if(inCooldown()){ scanTimer=setTimeout(loopDetector, 280); return; }
    (async function(){
      try{
        let det=null;
        try{ det=await detector.detect(video); }
        catch(e){ try{ const bmp=await createImageBitmap(video); det=await detector.detect(bmp); }catch(e2){} }
        if(det && det.length){
          const c=det[0]; const text=c.rawValue || '';
          if(text){ const fmt=c.format||'unknown'; handleDetection(text, fmt, 'camera'); bdFailCount=0; setTimeout(loopDetector, 220); return; }
        }
        bdFailCount++; 
        if(bdFailCount>12 && setupZXing()){ scanEnginePill.textContent='Engine: ZXing (fallback)'; loopZXing(); return; }
      }catch(e){ bdFailCount++; }
      scanTimer=setTimeout(loopDetector, 120);
    })();
  }

  const sampleCanvas=document.createElement('canvas');
  const sctx=sampleCanvas.getContext('2d', { willReadFrequently:true });
  function loopJsQR(){
    if(!scanning || !video || video.readyState<2){ scanTimer=setTimeout(loopJsQR, 180); return; }
    if(inCooldown()){ scanTimer=setTimeout(loopJsQR, 300); return; }
    const vw=video.videoWidth||0, vh=video.videoHeight||0; if(!vw||!vh){ scanTimer=setTimeout(loopJsQR, 180); return; }
    const MAXW=640; const scale = vw>MAXW ? (MAXW/vw) : 1;
    const sw=Math.max(1, Math.floor(vw*scale)), sh=Math.max(1, Math.floor(vh*scale));
    sampleCanvas.width=sw; sampleCanvas.height=sh; sctx.imageSmoothingEnabled=false; sctx.drawImage(video, 0, 0, sw, sh);
    try{
      const id=sctx.getImageData(0,0,sw,sh);
      if(window.jsQR){ const q=jsQR(id.data, sw, sh, { inversionAttempts:'attemptBoth' }); if(q && q.data){ handleDetection(q.data,'qr_code','camera'); scanTimer=setTimeout(loopJsQR, 220); return; } }
    }catch(e){}
    scanTimer=setTimeout(loopJsQR, 160);
  }

  function setupZXing(){
    if(zxingReader) return true;
    try{
      // Needs vendor/zxing*.min.js UMD builds
      const ZX = window.ZXing || window.ZXingBrowser || window.BrowserMultiFormatReader || (window.ZXing && window.ZXing.BrowserMultiFormatReader);
      const ZXBrowser = window.ZXingBrowser || window;
      if(ZXBrowser && ZXBrowser.BrowserMultiFormatReader){
        zxingReader = new ZXBrowser.BrowserMultiFormatReader();
        return true;
      }
    }catch(e){}
    return false;
  }

  function loopZXing(){
    if(!scanning || !video || video.readyState<2){ scanTimer=setTimeout(loopZXing, 180); return; }
    if(inCooldown()){ scanTimer=setTimeout(loopZXing, 300); return; }
    const vw=video.videoWidth||0, vh=video.videoHeight||0; if(!vw||!vh){ scanTimer=setTimeout(loopZXing, 180); return; }
    const MAXW=720; const scale = vw>MAXW ? (MAXW/vw) : 1;
    const sw=Math.max(1, Math.floor(vw*scale)), sh=Math.max(1, Math.floor(vh*scale));
    sampleCanvas.width=sw; sampleCanvas.height=sh; sctx.imageSmoothingEnabled=false; sctx.drawImage(video, 0, 0, sw, sh);
    try{
      if(!zxingReader){ scanTimer=setTimeout(loopZXing, 200); return; }
      const resPromise = (zxingReader.decodeFromCanvas ? zxingReader.decodeFromCanvas(sampleCanvas) : null);
      if(resPromise && typeof resPromise.then==='function'){
        resPromise.then(function(res){
          if(res && res.text){ const fmt=(res.format || (res.barcodeFormat && res.barcodeFormat.toString())) || 'multi'; handleDetection(res.text, fmt, 'camera'); }
        }).catch(function(){ /* no result */ }).finally(function(){ scanTimer=setTimeout(loopZXing, 160); });
      } else {
        // If API not present, stop ZXing loop
        scanEnginePill.textContent='Engine: BarcodeDetector'; loopDetector(); return;
      }
    }catch(e){ scanTimer=setTimeout(loopZXing, 200); }
  }

  // ---- Web Serial (Bluetooth/Serial over Windows COM) ----
  async function connectSerial(){
    try{
      if(!('serial' in navigator)){ setSerialState('Web Serial not supported. Use Chrome/Edge desktop.'); return; }
      const port = await navigator.serial.requestPort({});
      await port.open({ baudRate: 115200 });
      serialPort = port; serialConnected = true; setSerialState('Connected. Waiting for phone…');
      stop();
      const decoder = new TextDecoderStream();
      const reader = decoder.readable.getReader();
      port.readable.pipeTo(decoder.writable);
      (async function readLoop(){ try{ let buf=''; while(true){ const {value,done}=await reader.read(); if(done) break; if(!value) continue; buf += value; let idx; while((idx=buf.indexOf('\n'))!==-1){ const line=buf.slice(0,idx).trim(); buf=buf.slice(idx+1); if(!line) continue; if(line[0]==='{'){ try{ const msg=JSON.parse(line); if(msg.t==='qr' && msg.content){ handleDetection(String(msg.content),'from-phone','phone-bt'); if(msg.img){ const id=data.length?data[0].id:null; if(id){ try{ var list=JSON.parse(localStorage.getItem('qrLoggerV1')||'[]'); for(var k=0;k<list.length;k++){ if(list[k].id===id){ list[k].photo=msg.img; data[0].photo=msg.img; break; } } localStorage.setItem('qrLoggerV1', JSON.stringify(list)); }catch(e){} } } }catch(e){ handleDetection(line,'from-phone','phone-bt'); } } else { handleDetection(line,'from-phone','phone-bt'); } } } }catch(e){ setSerialState('Serial read error: '+(e.message||e)); } })();
      port.addEventListener('disconnect', function(){ setSerialState('Disconnected.'); serialConnected=false; });
    }catch(err){ setSerialState('Connect failed: '+(err.message||err)); }
  }
  if(connectSerialBtn){ connectSerialBtn.addEventListener('click', connectSerial); }

  // ---- UI & table ----
  const tbody=$('#logBody');
  function render(){
    tbody.innerHTML='';
    for(var i=0;i<data.length;i++){
      var r=data[i];
      var tr=document.createElement('tr');
      var dateStr=r.date||new Date(r.timestamp).toLocaleDateString();
      var timeStr=r.time||new Date(r.timestamp).toLocaleTimeString();
      var photoCell=r.photo?('<a href="'+r.photo+'" target="_blank" rel="noopener"><img class="thumb" src="'+r.photo+'" alt="photo"/></a>'):'';
      tr.innerHTML='<td class="muted">'+(i+1)+'</td><td>'+esc(r.content)+'</td><td><span class="pill">'+(r.format||'')+'</span></td><td class="muted">'+(r.source||'')+'</td><td class="muted">'+dateStr+'</td><td class="muted">'+timeStr+'</td><td>'+(r.weight||'')+'</td><td>'+photoCell+'</td><td><span class="count">× '+(r.count||1)+'</span></td><td class="note-cell" contenteditable="true">'+esc(r.notes||'')+'</td><td><button type="button" class="small" data-act="edit">Edit</button> <button type="button" class="small" data-act="delete">Delete</button></td>';
      tr.dataset.id=r.id;
      tbody.appendChild(tr);
    }
  }
  function esc(s){ s = (s==null)? '' : s; return (''+s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function upsert(content,format,source){
    if(!content) return;
    const now=new Date(); const iso=now.toISOString();
    const ex=data.find(function(x){return x.content===content;});
    if(ex){ ex.count=(ex.count||1)+1; ex.timestamp=iso; ex.date=now.toLocaleDateString(); ex.time=now.toLocaleTimeString(); save(); render(); beep(); scheduleCapture(ex.id); return; }
    const row={id:(crypto.randomUUID?crypto.randomUUID():(Date.now()+Math.random().toString(36).slice(2))), content:content, format:format||'', source:source||'', timestamp: iso, date:now.toLocaleDateString(), time:now.toLocaleTimeString(), weight:'', photo:'', count:1, notes:''};
    data.unshift(row); save(); render(); beep(); scheduleCapture(row.id);
  }

  document.addEventListener('click', function(e){
    const btn=e.target.closest('button'); if(!btn) return;
    const tr=e.target.closest('tr'); const id=tr && tr.dataset ? tr.dataset.id : null;
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
  $('#addManualBtn').addEventListener('click', function(){ const v=manualInput && manualInput.value ? manualInput.value.trim() : ''; if(v){ upsert(v,'text','manual/keyboard'); manualInput.value=''; } });
  if(manualInput){ manualInput.addEventListener('keydown', function(e){ if(e.key==='Enter'){ e.preventDefault(); const v=manualInput.value.trim(); if(v){ upsert(v,'text','manual/keyboard'); manualInput.value=''; } } }); }

  // Exports (local vendor if present)
  $('#exportCsv').addEventListener('click', function(){
    const headers=["Content","Format","Source","Date","Time","Weight","Photo","Count","Notes","Timestamp"];
    const rows=[headers].concat(data.map(function(r){ return [r.content,r.format,r.source,r.date||'',r.time||'',r.weight||'',r.photo||'',r.count,r.notes||'',r.timestamp||'']; }));
    const csv=rows.map(function(row){ return row.map(function(f){ const s=((f==null)?'':String(f)).replace(/\"/g,'\"\"'); return /[\",\n]/.test(s)?('\"'+s+'\"'):s; }).join(','); }).join('\n');
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='qr-log-'+new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')+'.csv'; a.click(); URL.revokeObjectURL(a.href);
  });
  $('#exportXlsx').addEventListener('click', function(){
    if(!window.XLSX){ setStatus('Excel lib not found locally (vendor/xlsx.full.min.js). Use CSV or run the vendor script.'); return; }
    const rows=data.map(function(r){ return {"Content":r.content,"Format":r.format,"Source":r.source,"Date":r.date||'',"Time":r.time||'',"Weight":r.weight||'',"Photo":r.photo||'',"Count":r.count,"Notes":r.notes||'',"Timestamp":r.timestamp||''}; });
    const ws=XLSX.utils.json_to_sheet(rows); const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'Log'); XLSX.writeFile(wb,'qr-log-'+new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')+'.xlsx');
  });
  $('#exportZip').addEventListener('click', async function(){
    if(!window.JSZip){ setStatus('JSZip not found locally (vendor/jszip.min.js). Use CSV or run the vendor script.'); return; }
    try{
      const zip=new JSZip();
      const headers=["Content","Format","Source","Date","Time","Weight","Photo","Count","Notes","Timestamp"];
      const rows=[headers].concat(data.map(function(r,i){
        var photoName='';
        if(r.photo && /^data:image\//.test(r.photo)){
          const m1=r.photo.match(/^data:(image\/[^;]+)/); const mt=(m1 && m1[1]) ? m1[1] : 'image/jpeg'; const ext=mt.split('/')[1];
          const safe=(r.content||'').toString().slice(0,20).replace(/[^a-z0-9\-_]+/gi,'_');
          photoName='photos/'+String(i+1).padStart(4,'0')+'_'+safe+'.'+ext;
        }
        return [r.content,r.format,r.source,r.date||'',r.time||'',r.weight||'',photoName,r.count,r.notes||'',r.timestamp||''];
      }));
      const csv=rows.map(function(row){ return row.map(function(f){ const s=(f==null? '' : String(f)).replace(/\"/g,'\"\"'); return /[\",\n]/.test(s)?('\"'+s+'\"'):s; }).join(','); }).join('\n');
      const ts=new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
      zip.file('qr-log-'+ts+'.csv', csv);
      var anyPhoto=false;
      for(var i=0;i<data.length;i++){
        var r=data[i];
        if(!r.photo || !/^data:image\//.test(r.photo)) continue;
        const m2=r.photo.match(/^data:(image\/[^;]+);base64,(.*)$/); if(!m2) continue;
        const b64=m2[2]; const bin=atob(b64);
        const u8=new Uint8Array(bin.length); for(var j=0;j<bin.length;j++) u8[j]=bin.charCodeAt(j);
        const ext=(m2[1]||'image/jpeg').split('/')[1];
        const safe=(r.content||'').toString().slice(0,20).replace(/[^a-z0-9\-_]+/gi,'_');
        const name='photos/'+String(i+1).padStart(4,'0')+'_'+safe+'.'+ext;
        zip.file(name, u8); anyPhoto=true;
      }
      const blob=await zip.generateAsync({type:'blob'});
      const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='qr-log-bundle-'+ts+'.zip'; a.click(); URL.revokeObjectURL(a.href);
      setStatus(anyPhoto? 'Exported ZIP with CSV + photos.' : 'Exported ZIP (CSV only).');
    }catch(err){ setStatus('ZIP export failed: '+(err.message||err)); }
  });

  $('#importFileBtn').addEventListener('click', function(){ const fi=$('#fileInput'); if(fi) fi.click(); });
  $('#fileInput').addEventListener('change', async function(e){
    const file=e.target.files[0]; if(!file) return;
    const name=(file.name||'').toLowerCase();
    if(name.slice(-4)==='.csv'){
      const text=await file.text();
      const rows=text.split(/\r?\n/).map(function(r){ return r.split(/,(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)/); });
      const b=rows.slice(1);
      for(var i=0;i<b.length;i++){
        const cols=b[i]; if(!cols.length||!cols[0])continue;
        upsert(cols[0].replace(/\\"/g,'\"'), cols[1]||'', cols[2]||'import');
        const last=data[0]; last.date=cols[3]||last.date; last.time=cols[4]||last.time; last.weight=cols[5]||''; last.photo=cols[6]||''; last.count=parseInt(cols[7]||'1',10); last.notes=(cols[8]||'').replace(/^\"|\"$/g,''); last.timestamp=cols[9]||last.timestamp;
      }
    } else {
      if(!window.XLSX){ setStatus('Excel import requires vendor/xlsx.full.min.js'); return; }
      const buf=await file.arrayBuffer();
      const wb=XLSX.read(buf,{type:'array'}); const ws=wb.Sheets[wb.SheetNames[0]]; const rows2=XLSX.utils.sheet_to_json(ws);
      for(var j=0;j<rows2.length;j++){
        const o=rows2[j]; upsert(o['Content'], o['Format']||'', o['Source']||'import');
        const last2=data[0]; last2.date=o['Date']||last2.date; last2.time=o['Time']||last2.time; last2.weight=o['Weight']||''; last2.photo=o['Photo']||''; last2.count=parseInt(o['Count']||'1',10); last2.notes=o['Notes']||''; last2.timestamp=o['Timestamp']||last2.timestamp;
      }
    }
    save(); render(); setStatus('Imported data from file.'); e.target.value='';
  });

  $('#clearBtn').addEventListener('click', function(){ if(!confirm('Clear all rows?')) return; data=[]; save(); render(); setStatus('Log cleared.'); });

  // Options
  if(cooldownSecInput){ cooldownSecInput.addEventListener('change', function(){ const v=parseFloat(cooldownSecInput.value); cooldownSec = Math.max(0, Math.min(10, isNaN(v)?5:v)); cooldownSecInput.value = String(cooldownSec); }); }
  if(ignoreDupChk){ ignoreDupChk.addEventListener('change', function(){ ignoreDup = !!ignoreDupChk.checked; }); }
  if(enhancedChk){ enhancedChk.addEventListener('change', function(){ enhanced = !!enhancedChk.checked; setStatus(enhanced? 'Enhanced decoder enabled' : 'Enhanced decoder disabled'); }); }
  if(preferZXingChk){ preferZXingChk.addEventListener('change', function(){ preferZXing = !!preferZXingChk.checked; if(preferZXing){ initScanner(); } }); }

  if(ocrToggleBtn && overlay){
    ocrToggleBtn.addEventListener('click', function(){
      ocrBoxEnabled = !ocrBoxEnabled;
      overlay.style.pointerEvents = ocrBoxEnabled ? 'auto' : 'none';
      drawOCRBox();
    });
    overlay.addEventListener('mousedown', function(e){
      if(!ocrBoxEnabled) return;
      const r=overlay.getBoundingClientRect();
      const x=e.clientX-r.left, y=e.clientY-r.top;
      const bx=ocrBox.x*overlay.width, by=ocrBox.y*overlay.height, bw=ocrBox.w*overlay.width, bh=ocrBox.h*overlay.height;
      if(x>bx && x<bx+bw && y>by && y<by+bh){ isDragging=true; dragOffset.x=x-bx; dragOffset.y=y-by; }
    });
    window.addEventListener('mousemove', function(e){
      if(!isDragging) return;
      const r=overlay.getBoundingClientRect();
      var x=e.clientX-r.left-dragOffset.x; var y=e.clientY-r.top-dragOffset.y;
      x=Math.max(0,Math.min(x, overlay.width-ocrBox.w*overlay.width));
      y=Math.max(0,Math.min(y, overlay.height-ocrBox.h*overlay.height));
      ocrBox.x = x/overlay.width; ocrBox.y = y/overlay.height; drawOCRBox();
    });
    window.addEventListener('mouseup', function(){ isDragging=false; });
  }

  $('#permBtn').addEventListener('click', requestPermission);
  $('#startBtn').addEventListener('click', initScanner);
  $('#stopBtn').addEventListener('click', function(){ stop(); setStatus('Camera stopped.'); });
  $('#refreshBtn').addEventListener('click', enumerateCams);
  cameraSelect.addEventListener('change', startFromSelection);

  load(); render(); updatePerm(); enumerateCams();
  if(document.visibilityState==='visible') setStatus('Ready. Local/Remote camera, or Phone via Bluetooth/Serial.');

  function beep(){ try{ var a=new AudioContext(), o=a.createOscillator(), g=a.createGain(); o.type='square'; o.frequency.value=880; o.connect(g); g.connect(a.destination); g.gain.setValueAtTime(0.05,a.currentTime); o.start(); setTimeout(function(){o.stop(); a.close();},90);}catch(e){} }

  // Photo & OCR helpers
  async function capturePhoto(){ const v=video; const w=v.videoWidth, h=v.videoHeight; if(!w||!h) return ''; const c=document.createElement('canvas'); c.width=w; c.height=h; const cx=c.getContext('2d'); cx.drawImage(v,0,0,w,h); return c.toDataURL('image/jpeg',0.8); }
  async function ensureTesseract(){ if(window.Tesseract) return true; setStatus('Tesseract not found locally (vendor/tesseract.min.js).'); return false; }
  async function captureOCRWeight(){ const ok=await ensureTesseract(); if(!ok) return ''; const v=video; const w=v.videoWidth, h=v.videoHeight; if(!w||!h) return ''; const rx=Math.floor((ocrBox.x||0.6)*w), ry=Math.floor((ocrBox.y||0.65)*h), rw=Math.floor((ocrBox.w||0.35)*w), rh=Math.floor((ocrBox.h||0.25)*h); const c=document.createElement('canvas'); c.width=rw; c.height=rh; const cctx=c.getContext('2d', {willReadFrequently:true}); cctx.drawImage(v, rx, ry, rw, rh, 0, 0, rw, rh); const r=await Tesseract.recognize(c, 'eng', { tessedit_char_whitelist:'0123456789.-', classify_bln_numeric_mode:1 }); const text=(r && r.data && r.data.text)? r.data.text : ''; const m=(text||'').replace(/[, ]/g,'').match(/-?\d+(?:\.\d+)?/); return m?m[0]:''; }

  function drawOCRBox(){ try{ const octx=overlay.getContext('2d'); octx.clearRect(0,0,overlay.width,overlay.height); if(!ocrBoxEnabled) return; const bx=(ocrBox.x||0.6)*overlay.width, by=(ocrBox.y||0.65)*overlay.height, bw=(ocrBox.w||0.35)*overlay.width, bh=(ocrBox.h||0.25)*overlay.height; octx.strokeStyle='#22c55e'; octx.lineWidth=3; octx.setLineDash([8,6]); octx.strokeRect(bx,by,bw,bh); octx.setLineDash([]); octx.fillStyle='rgba(34,197,94,0.08)'; octx.fillRect(bx,by,bw,bh); }catch(e){} }

  window.scheduleCapture = function(id){
    const ms = Math.round((parseFloat(delayInput && delayInput.value || '2')||2)*1000);
    setTimeout(async function(){
      try{
        const row=(function(){ try{ const d=JSON.parse(localStorage.getItem('qrLoggerV1')||'[]'); for(var i=0;i<d.length;i++){ if(d[i].id===id) return d[i]; } return null; }catch(e){ return null; } })();
        if(!row){ return; }
        var weight='';
        const sm = scaleModeSel ? scaleModeSel.value : 'none';
        if(sm==='ocr'){ weight = await captureOCRWeight(); }
        else if(sm==='hid' || sm==='ble'){ weight = window.__lastKnownWeight||''; }
        row.weight = weight;
        if(!row.photo){ row.photo = await capturePhoto(); }
        var list=JSON.parse(localStorage.getItem('qrLoggerV1')||'[]'); for(var k=0;k<list.length;k++){ if(list[k].id===id){ list[k]=row; break; } }
        localStorage.setItem('qrLoggerV1', JSON.stringify(list));
        setStatus('Captured delayed weight/photo.');
        const ev = new Event('storage'); window.dispatchEvent(ev);
      }catch(err){ console.warn('capture failed', err); }
    }, ms);
  };
})();