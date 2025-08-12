// Core app for QR Logger (v6.0.2) — Cooldown, duplicate guard, enhanced decoder
(async function(){
  await (window.libsReady || Promise.resolve());

  const $ = s => document.querySelector(s);
  const video = $('#video');
  const canvas = $('#canvas');
  const overlay = $('#overlay');
  const ctx = canvas.getContext('2d', { willReadFrequently:true });
  const octx = overlay.getContext('2d');
  const statusEl = $('#status');
  const remoteStatusEl = $('#remoteStatus');
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
  const hostBtn = $('#remoteHostBtn');
  const joinBtn = $('#remoteJoinBtn');
  const codeInput = $('#remoteCodeInput');

  const cooldownInput = $('#cooldownSec');
  const ignoreDupChk = $('#ignoreDup');
  const enhancedChk = $('#enhancedDecoder');

  let stream = null, scanning = false, detector = null, usingBarcodeDetector=false;
  let data = []; const STORAGE_KEY='qrLoggerV1';

  // scale & OCR state
  let scaleMode='none', delaySec=2;
  let ocrBox={x:0.6,y:0.65,w:0.35,h:0.25}, ocrBoxEnabled=false, isDragging=false, dragOffset={x:0,y:0};

  // cooldown & dup guard
  let cooldownSec=5; let cooldownUntil=0;
  let ignoreDup=true; let lastContent=''; let lastAt=0;
  let enhanced=false; let zxingBusy=false; let lastZxingTry=0;

  const isAndroid=/Android/i.test(navigator.userAgent);
  const isInApp=/FBAN|FBAV|Instagram|Line\/|WeChat|Twitter|Snapchat|DuckDuckGo/i.test(navigator.userAgent);

  function setStatus(t){ statusEl.textContent = t || ''; }
  function setRemoteStatus(t){ remoteStatusEl.textContent = t || ''; }
  function save(){ try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }catch(e){} }
  function load(){ try{ data = JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]'); }catch(e){ data=[]; } }

  function showAndroidBanner(){ if(!isAndroid) return; const host=location.hostname; let msg='<b>Android tip:</b> '; msg+=isInApp?'You appear to be in an in‑app browser. Use menu → <b>Open in Chrome</b>.':'If no prompt: tap ⓘ/🔒 → <b>Permissions</b> → <b>Camera → Allow</b>, then reload.'; msg+='<br/>System: Settings → Apps → <b>Chrome</b> → Permissions → Camera → Allow.'; msg+='<br/>Site reset: Chrome ⋮ → Settings → Site settings → All sites → <b>'+host+'</b> → Clear & reset.'; androidBanner.innerHTML=msg; androidBanner.style.display='block'; }

  async function updatePerm(){ permStateEl.textContent=''; if(!('permissions' in navigator)) return; try{ const st=await navigator.permissions.query({name:'camera'}); permStateEl.textContent='Permission: '+st.state; st.onchange=()=>{ permStateEl.textContent='Permission: '+st.state; }; }catch(e){} }

  function decideFacing(){ const p=prefFacing.value; if(p==='environment') return {facingMode:{ideal:'environment'}}; if(p==='user') return {facingMode:{ideal:'user'}}; return isAndroid?{facingMode:{ideal:'environment'}}:{facingMode:{ideal:'user'}}; }

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
    if(cameraSourceSel && cameraSourceSel.value==='remote'){
      if(window.QRRemote && window.QRRemote.getHostState && window.QRRemote.getJoinState){
        if(window.QRRemote.getHostState()==='connected' || window.QRRemote.getJoinState()==='connected'){
          const s = window.QRRemote.getRemoteStream();
          if(s){ useStream(s, 'Remote camera'); return true; }
        }
        setRemoteStatus('Remote camera not connected yet. Use Create or Join.');
        return false;
      } else {
        setRemoteStatus('Remote module not ready or pairing-config disabled.');
        return false;
      }
    }

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

  // ---- Scanning with cooldown / duplicate guard ----
  let bdFailCount=0, scanTimer=null;
  function initScanner(){
    clearTimeout(scanTimer); bdFailCount=0;
    usingBarcodeDetector = ('BarcodeDetector' in window);
    if(usingBarcodeDetector){
      try{
        detector=new BarcodeDetector({formats:['qr_code','aztec','data_matrix','pdf417']});
        scanEnginePill.textContent='Engine: BarcodeDetector';
        scanning=true; loopDetector();
        return;
      }catch(e){ usingBarcodeDetector=false; }
    }
    scanEnginePill.textContent='Engine: jsQR';
    scanning=true; loopJsQR();
  }

  function inCooldown(){
    const now=Date.now();
    if(now<cooldownUntil){
      const left=Math.max(0, Math.ceil((cooldownUntil-now)/1000));
      setStatus('In pause… scanning resumes in '+left+'s');
      return true;
    }
    return false;
  }

  function handleDetection(text, format, source){
    const now=Date.now();
    if(ignoreDup && lastContent===text && (now-lastAt)<cooldownSec*1000){
      cooldownUntil = now + cooldownSec*1000; // extend pause
      return; // omit duplicate
    }
    lastContent=text; lastAt=now;
    cooldownUntil = now + cooldownSec*1000;
    upsert(text, format||'qr_code', source);
  }

  function loopDetector(){
    if(!scanning || !video || video.readyState<2){ scanTimer=setTimeout(loopDetector, 120); return; }
    if(inCooldown()){ scanTimer=setTimeout(loopDetector, 300); return; }
    (async function(){
      try{
        let det=null;
        try{ det=await detector.detect(video); }
        catch(e){ try{ const bmp=await createImageBitmap(video); det=await detector.detect(bmp); }catch(e2){} }
        if(det && det.length){
          const c=det[0]; const text=c.rawValue || '';
          if(text){ handleDetection(text, c.format||'qr_code', (cameraSourceSel.value==='remote'?'remote':'camera')); bdFailCount=0; setTimeout(loopDetector, 200); return; }
        }
        bdFailCount++; if(bdFailCount>15){ usingBarcodeDetector=false; scanEnginePill.textContent='Engine: jsQR (fallback)'; loopJsQR(); return; }
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
    sampleCanvas.width=sw; sampleCanvas.height=sh;
    sctx.imageSmoothingEnabled=false;
    sctx.drawImage(video, 0, 0, sw, sh);
    try{
      const id=sctx.getImageData(0,0,sw,sh);
      const q= window.jsQR ? jsQR(id.data, sw, sh, { inversionAttempts:'attemptBoth' }) : null;
      if(q && q.data){
        handleDetection(q.data,'qr_code', (cameraSourceSel.value==='remote'?'remote':'camera'));
        scanTimer=setTimeout(loopJsQR, 220); return;
      }
    }catch(e){}

    // Enhanced decoder (qr-scanner) — attempt after jsQR miss
    if(enhanced && window.QrScanner && !zxingBusy){
      const now=Date.now();
      if(now - lastZxingTry > 280){ // rate limit
        zxingBusy=true; lastZxingTry=now;
        window.QrScanner.scanImage(sampleCanvas, { returnDetailedScanResult:true }).then(function(res){
          if(res && res.data){ handleDetection(res.data,'qr_code', (cameraSourceSel.value==='remote'?'remote':'camera')); }
        }).catch(function(){ /* no result */ }).finally(function(){ zxingBusy=false; });
      }
    }

    scanTimer=setTimeout(loopJsQR, 160);
  }

  const tbody=$('#logBody');
  function render(){
    tbody.innerHTML='';
    for(var i=0;i<data.length;i++){
      var r=data[i];
      var tr=document.createElement('tr');
      var dateStr=r.date||new Date(r.timestamp).toLocaleDateString();
      var timeStr=r.time||new Date(r.timestamp).toLocaleTimeString();
      var photoCell=r.photo?('<a href="'+r.photo+'" target="_blank" rel="noopener"><img class="thumb" src="'+r.photo+'" alt="photo"/></a>'):'';
      tr.innerHTML='<td class="muted">'+(i+1)+'</td><td>'+esc(r.content)+'</td><td><span class="pill">'+(r.format||'QR')+'</span></td><td class="muted">'+(r.source||'camera')+'</td><td class="muted">'+dateStr+'</td><td class="muted">'+timeStr+'</td><td>'+(r.weight||'')+'</td><td>'+photoCell+'</td><td><span class="count">× '+(r.count||1)+'</span></td><td class="note-cell" contenteditable="true">'+esc(r.notes||'')+'</td><td><button type="button" class="small" data-act="edit">Edit</button> <button type="button" class="small" data-act="delete">Delete</button></td>';
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
    const row={id:(crypto.randomUUID?crypto.randomUUID():(Date.now()+Math.random().toString(36).slice(2))), content:content, format:format||'qr_code', source:source||'camera', timestamp: iso, date:now.toLocaleDateString(), time:now.toLocaleTimeString(), weight:'', photo:'', count:1, notes:''};
    data.unshift(row); save(); render(); beep(); scheduleCapture(row.id);
  }

  document.addEventListener('click', function(e){
    const btn=e.target.closest('button'); if(!btn) return;
    const tr=e.target.closest('tr'); const id=tr && tr.dataset ? tr.dataset.id : null;
    const act=btn.getAttribute('data-act');
    if(act==='delete' && id){ data = data.filter(function(r){return r.id!==id;}); save(); render(); }
    if(act==='edit' && id){ const row=data.find(function(r){return r.id===id;}); const nv=prompt('Edit QR content:', row?row.content:''); if(nv!==null && row){ row.content=nv; save(); render(); } }
  });
  document.addEventListener('blur', function(e){
    const c=e.target; if(!c.classList || !c.classList.contains('note-cell')) return;
    const tr=c.closest('tr'); const id=tr && tr.dataset ? tr.dataset.id : null;
    const row=data.find(function(r){return r.id===id;});
    if(row){ row.notes=c.textContent; save(); }
  }, true);

  const manualInput=$('#manualInput');
  $('#addManualBtn').addEventListener('click', function(){
    const v=manualInput && manualInput.value ? manualInput.value.trim() : '';
    if(v){ upsert(v,'text','manual/keyboard'); manualInput.value=''; }
  });
  if(manualInput){ manualInput.addEventListener('keydown', function(e){ if(e.key==='Enter'){ e.preventDefault(); const v=manualInput.value.trim(); if(v){ upsert(v,'text','manual/keyboard'); manualInput.value=''; } } }); }

  function ensureXLSX(){
    if(window.XLSX) return true;
    setStatus('Excel library not loaded; trying fallback…');
    const fallback = ['https://unpkg.com/xlsx@0.19.3/dist/xlsx.full.min.js','https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.19.3/xlsx.full.min.js'];
    var p = Promise.resolve();
    for(var i=0;i<fallback.length;i++){
      (function(u){
        p = p.then(function(){ return new Promise(function(res){ var s=document.createElement('script'); s.src=u; s.onload=function(){res(true)}; s.onerror=function(){res(true)}; document.head.appendChild(s); }); });
      })(fallback[i]);
    }
    return false;
  }

  $('#exportCsv').addEventListener('click', function(){
    const headers=["QR Content","Format","Source","Date","Time","Weight","Photo","Count","Notes","Timestamp"];
    const rows=[headers].concat(data.map(function(r){ return [r.content,r.format,r.source,r.date||'',r.time||'',r.weight||'',r.photo||'',r.count,r.notes||'',r.timestamp||'']; }));
    const csv=rows.map(function(row){ return row.map(function(f){ const s=((f==null)?'':String(f)).replace(/\"/g,'\"\"'); return /[\",\n]/.test(s)?('\"'+s+'\"'):s; }).join(','); }).join('\n');
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='qr-log-'+new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')+'.csv'; a.click(); URL.revokeObjectURL(a.href);
  });
  $('#exportXlsx').addEventListener('click', function(){
    if(!window.XLSX){ if(!ensureXLSX()){ return; } }
    if(!window.XLSX){ setStatus('Excel export unavailable; use CSV.'); return; }
    const rows=data.map(function(r){ return {"QR Content":r.content,"Format":r.format,"Source":r.source,"Date":r.date||'',"Time":r.time||'',"Weight":r.weight||'',"Photo":r.photo||'',"Count":r.count,"Notes":r.notes||'',"Timestamp":r.timestamp||''}; });
    const ws=XLSX.utils.json_to_sheet(rows); const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'QR Log'); XLSX.writeFile(wb,'qr-log-'+new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')+'.xlsx');
  });
  $('#exportZip').addEventListener('click', async function(){
    if(!window.JSZip){ setStatus('Zip library missing (network blocked?)'); return; }
    try{
      const zip=new JSZip();
      const headers=["QR Content","Format","Source","Date","Time","Weight","Photo","Count","Notes","Timestamp"];
      const rows=[headers].concat(data.map(function(r,i){
        var photoName='';
        if(r.photo && /^data:image\//.test(r.photo)){
          const m1=r.photo.match(/^data:(image\/[^;]+)/);
          const mt=(m1 && m1[1]) ? m1[1] : 'image/jpeg';
          const ext=mt.split('/')[1];
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
        const m2=r.photo.match(/^data:(image\/[^;]+);base64,(.*)$/);
        if(!m2) continue;
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
        upsert(cols[0].replace(/\\"/g,'\"'), cols[1]||'qr_code', cols[2]||'import');
        const last=data[0]; last.date=cols[3]||last.date; last.time=cols[4]||last.time; last.weight=cols[5]||''; last.photo=cols[6]||''; last.count=parseInt(cols[7]||'1',10); last.notes=(cols[8]||'').replace(/^\"|\"$/g,''); last.timestamp=cols[9]||last.timestamp;
      }
    } else {
      if(!window.XLSX){ if(!ensureXLSX()){ return; } }
      if(!window.XLSX){ setStatus('Excel import unavailable; use CSV.'); return; }
      const buf=await file.arrayBuffer();
      const wb=XLSX.read(buf,{type:'array'}); const ws=wb.Sheets[wb.SheetNames[0]]; const rows2=XLSX.utils.sheet_to_json(ws);
      for(var j=0;j<rows2.length;j++){
        const o=rows2[j]; upsert(o['QR Content'], o['Format']||'qr_code', o['Source']||'import');
        const last2=data[0]; last2.date=o['Date']||last2.date; last2.time=o['Time']||last2.time; last2.weight=o['Weight']||''; last2.photo=o['Photo']||''; last2.count=parseInt(o['Count']||'1',10); last2.notes=o['Notes']||''; last2.timestamp=o['Timestamp']||last2.timestamp;
      }
    }
    save(); render(); setStatus('Imported data from file.'); e.target.value='';
  });

  $('#clearBtn').addEventListener('click', function(){ if(!confirm('Clear all rows?')) return; data=[]; save(); render(); setStatus('Log cleared.'); });

  if(scaleModeSel){ scaleModeSel.addEventListener('change', function(){ scaleMode = scaleModeSel.value; }); }
  if(delayInput){ delayInput.addEventListener('change', function(){ const v=parseFloat(delayInput.value); delaySec = Math.max(0, Math.min(4, isNaN(v)?2:v)); delayInput.value = String(delaySec); }); }

  if(cooldownInput){ cooldownInput.addEventListener('change', function(){ const v=parseFloat(cooldownInput.value); cooldownSec = Math.max(0, Math.min(10, isNaN(v)?5:v)); cooldownInput.value = String(cooldownSec); }); }
  if(ignoreDupChk){ ignoreDupChk.addEventListener('change', function(){ ignoreDup = !!ignoreDupChk.checked; }); }
  if(enhancedChk){ enhancedChk.addEventListener('change', function(){ enhanced = !!enhancedChk.checked; setStatus(enhanced? 'Enhanced decoder enabled' : 'Enhanced decoder disabled'); }); }

  if(ocrToggleBtn && overlay){
    ocrToggleBtn.addEventListener('click', function(){
      ocrBoxEnabled = !ocrBoxEnabled;
      window.ocrBoxEnabledGlobal = ocrBoxEnabled;
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
      ocrBox.x = x/overlay.width; ocrBox.y = y/overlay.height; window.ocrBox = ocrBox; drawOCRBox();
    });
    window.addEventListener('mouseup', function(){ isDragging=false; });
  }
  if(connectHIDBtn){ connectHIDBtn.addEventListener('click', connectHID); }
  if(connectBLEBtn){ connectBLEBtn.addEventListener('click', connectBLE); }

  $('#permBtn').addEventListener('click', requestPermission);
  $('#startBtn').addEventListener('click', startFromSelection);
  $('#stopBtn').addEventListener('click', function(){ stop(); setStatus('Camera stopped.'); });
  $('#refreshBtn').addEventListener('click', enumerateCams);
  cameraSelect.addEventListener('change', startFromSelection);

  // Remote buttons are wired in remote.js

  load(); render(); updatePerm(); enumerateCams();
  if(document.visibilityState==='visible') setStatus('Ready. Choose Local/Remote → Request Permission → Start Camera.');

  function beep(){ try{ var a=new AudioContext(), o=a.createOscillator(), g=a.createGain(); o.type='square'; o.frequency.value=880; o.connect(g); g.connect(a.destination); g.gain.setValueAtTime(0.05,a.currentTime); o.start(); setTimeout(function(){o.stop(); a.close();},90);}catch(e){} }
  window.beep = beep; // expose for remote

  // ---- Scale/OCR helpers ----
  window.scheduleCapture = function(id){
    const ms = Math.round((window.delaySecGlobal||2)*1000);
    setTimeout(async function(){
      try{
        const row=(function(){ try{ const d=JSON.parse(localStorage.getItem('qrLoggerV1')||'[]'); for(var i=0;i<d.length;i++){ if(d[i].id===id) return d[i]; } return null; }catch(e){ return null; } })();
        if(!row){ return; }
        var weight='';
        if(window.scaleModeGlobal==='ocr'){ weight = await captureOCRWeight(); }
        else if(window.scaleModeGlobal==='hid' || window.scaleModeGlobal==='ble'){ weight = window.lastKnownWeightGlobal || ''; }
        row.weight = weight; row.photo = await capturePhoto();
        var list=JSON.parse(localStorage.getItem('qrLoggerV1')||'[]'); for(var k=0;k<list.length;k++){ if(list[k].id===id){ list[k]=row; break; } }
        localStorage.setItem('qrLoggerV1', JSON.stringify(list));
        setStatus('Captured delayed weight/photo.');
        const ev = new Event('storage'); window.dispatchEvent(ev);
      }catch(err){ console.warn('capture failed', err); }
    }, ms);
  };
  window.scaleModeGlobal='none'; window.delaySecGlobal=2; window.lastKnownWeightGlobal='';
  setInterval(function(){ try{ const s=scaleModeSel; if(s) window.scaleModeGlobal=s.value; const d=delayInput; if(d) window.delaySecGlobal=parseFloat(d.value)||2; window.lastKnownWeightGlobal = window.__lastKnownWeight||''; }catch(e){} }, 500);

  async function ensureTesseract(){ if(window.Tesseract) return true; return await new Promise(function(res){ const s=document.createElement('script'); s.src='https://cdn.jsdelivr.net/npm/tesseract.js@5.1.0/dist/tesseract.min.js'; s.onload=function(){res(true)}; s.onerror=function(){res(false)}; document.head.appendChild(s); }); }
  async function captureOCRWeight(){ const ok=await ensureTesseract(); if(!ok) return ''; const v=video; const w=v.videoWidth, h=v.videoHeight; if(!w||!h) return ''; const rx=Math.floor((window.ocrBox?window.ocrBox.x:0.6)*w), ry=Math.floor((window.ocrBox?window.ocrBox.y:0.65)*h), rw=Math.floor((window.ocrBox?window.ocrBox.w:0.35)*w), rh=Math.floor((window.ocrBox?window.ocrBox.h:0.25)*h); const c=document.createElement('canvas'); c.width=rw; c.height=rh; const cctx=c.getContext('2d', {willReadFrequently:true}); cctx.drawImage(v, rx, ry, rw, rh, 0, 0, rw, rh); const r=await Tesseract.recognize(c, 'eng', { tessedit_char_whitelist:'0123456789.-', classify_bln_numeric_mode:1 }); const text=(r && r.data && r.data.text)? r.data.text : ''; const m=(text||'').replace(/[, ]/g,'').match(/-?\d+(?:\.\d+)?/); return m?m[0]:''; }
  async function capturePhoto(){ const v=video; const w=v.videoWidth, h=v.videoHeight; if(!w||!h) return ''; const c=document.createElement('canvas'); c.width=w; c.height=h; const cx=c.getContext('2d'); cx.drawImage(v,0,0,w,h); return c.toDataURL('image/jpeg',0.8); }

  function drawOCRBox(){ try{ const octx=overlay.getContext('2d'); octx.clearRect(0,0,overlay.width,overlay.height); if(!window.ocrBoxEnabledGlobal) return; const bx=(window.ocrBox?window.ocrBox.x:0.6)*overlay.width, by=(window.ocrBox?window.ocrBox.y:0.65)*overlay.height, bw=(window.ocrBox?window.ocrBox.w:0.35)*overlay.width, bh=(window.ocrBox?window.ocrBox.h:0.25)*overlay.height; octx.strokeStyle='#22c55e'; octx.lineWidth=3; octx.setLineDash([8,6]); octx.strokeRect(bx,by,bw,bh); octx.setLineDash([]); octx.fillStyle='rgba(34,197,94,0.08)'; octx.fillRect(bx,by,bw,bh); }catch(e){} }
  window.ocrBoxEnabledGlobal=false; window.ocrBox={x:0.6,y:0.65,w:0.35,h:0.25};

  // HID / BLE
  async function connectHID(){ try{ if(!('hid' in navigator)) { setStatus('WebHID not supported.'); return; } const devices = await navigator.hid.requestDevice({ filters: [] }); if(!devices.length){ setStatus('No HID device chosen.'); return; } const dev=devices[0]; await dev.open(); dev.oninputreport = function(e){ try{ let ascii=''; for(let i=0;i<e.data.byteLength;i++){ const ch=e.data.getUint8(i); if(ch>=32 && ch<=126) ascii += String.fromCharCode(ch); } const m = ascii.replace(/[, ]/g,'').match(/-?\d+(?:\.\d+)?/); if(m){ window.__lastKnownWeight=m[0]; return; } if(e.data.byteLength>=4){ const dv=new DataView(e.data.buffer); const grams=dv.getInt16(2,true); if(!Number.isNaN(grams)) window.__lastKnownWeight = String(grams/1000); } }catch(err){} }; setStatus('HID connected: '+(dev.productName||'Scale')); }catch(err){ setStatus('HID connect failed: '+err.message); } }
  async function connectBLE(){ try{ if(!('bluetooth' in navigator)){ setStatus('WebBluetooth not supported.'); return; } let dev = await navigator.bluetooth.requestDevice({ acceptAllDevices:true, optionalServices:[0x181D, '6e400001-b5a3-f393-e0a9-e50e24dcca9e'] }); const server = await dev.gatt.connect(); try{ const svc = await server.getPrimaryService(0x181D); const ch = await svc.getCharacteristic(0x2A9D); await ch.startNotifications(); ch.addEventListener('characteristicvaluechanged', function(ev){ const dv=ev.target.value; if(dv.byteLength>=4){ const flags=dv.getUint8(0); const unitLbs = (flags & 0x01)!==0; const weight = dv.getUint16(1, true) / 200; window.__lastKnownWeight = unitLbs ? String((weight*0.45359237).toFixed(3)) : String(weight.toFixed(3)); } }); setStatus('BLE: Weight Scale connected'); return; }catch(_e){} try{ const nus = await server.getPrimaryService('6e400001-b5a3-f393-e0a9-e50e24dcca9e'); const rx = await nus.getCharacteristic('6e400003-b5a3-f393-e0a9-e50e24dcca9e'); await rx.startNotifications(); rx.addEventListener('characteristicvaluechanged', function(ev){ const v=new TextDecoder().decode(ev.target.value||new DataView(new ArrayBuffer(0))); const m=v.replace(/[, ]/g,'').match(/-?\d+(?:\.\d+)?/); if(m) window.__lastKnownWeight=m[0]; }); setStatus('BLE: UART connected'); }catch(err){ setStatus('BLE connect failed: '+err.message); } }catch(err){ setStatus('BLE connect failed: '+err.message); } }

  window.connectHID = connectHID;
  window.connectBLE = connectBLE;
})();