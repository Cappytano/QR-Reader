// QR Logger v6.1.2 — No external libs
(function(){
  'use strict';

  // ---------- utils ----------
  const $ = (s) => document.querySelector(s);
  const video = $('#video');
  const overlay = $('#overlay');
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

  const connectSerialBtn = $('#connectSerial');

  const cooldownSecInput = $('#cooldownSec');
  const ignoreDupChk = $('#ignoreDup');

  let stream = null, scanning = false, detector = null, usingBarcodeDetector=false;
  let data = []; const STORAGE_KEY='qrLoggerV1';

  // OCR box (visual only in this build)
  let ocrBox={x:0.6,y:0.65,w:0.35,h:0.25}, ocrBoxEnabled=false, isDragging=false, dragOffset={x:0,y:0};

  // cooldown & dup guard
  let cooldownSec=5; let cooldownUntil=0;
  let ignoreDup=true; let lastContent=''; let lastAt=0;

  // serial state
  let serialPort=null, serialReader=null, serialConnected=false;

  function setStatus(t){ statusEl.textContent = t || ''; }
  function setRemoteStatus(t){ remoteStatusEl.textContent = t || ''; }
  function setSerialState(t){ if(serialStateEl) serialStateEl.textContent = t || ''; }
  function save(){ try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }catch(e){} }
  function load(){ try{ data = JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]'); }catch(e){ data=[]; } }

  const isAndroid=/Android/i.test(navigator.userAgent);
  const isInApp=/FBAN|FBAV|Instagram|Line\/|WeChat|Twitter|Snapchat|DuckDuckGo/i.test(navigator.userAgent);
  function showAndroidBanner(){
    if(!isAndroid) return;
    const host=location.hostname;
    let msg='<b>Android tip:</b> ';
    msg+=isInApp?'You appear to be in an in‑app browser. Use menu → <b>Open in Chrome</b>.':'If no prompt: tap ⓘ/🔒 → <b>Permissions</b> → <b>Camera → Allow</b>, then reload.';
    msg+='<br/>System: Settings → Apps → <b>Chrome</b> → Permissions → Camera → Allow.';
    msg+='<br/>Site reset: Chrome ⋮ → Settings → Site settings → All sites → <b>'+host+'</b> → Clear & reset.';
    androidBanner.innerHTML=msg; androidBanner.style.display='block';
  }

  async function updatePerm(){ if(!('permissions' in navigator)) return; try{ const st=await navigator.permissions.query({name:'camera'}); permStateEl.textContent='Permission: '+st.state; st.onchange=()=>{ permStateEl.textContent='Permission: '+st.state; }; }catch(e){} }

  function decideFacing(){
    const p=prefFacing.value;
    if(p==='environment') return {facingMode:{ideal:'environment'}};
    if(p==='user') return {facingMode:{ideal:'user'}};
    return /Android/i.test(navigator.userAgent)?{facingMode:{ideal:'environment'}}:{facingMode:{ideal:'user'}};
  }

  async function enumerateCams(){
    try{
      const devs=await navigator.mediaDevices.enumerateDevices();
      const cams=devs.filter(d=>d.kind==='videoinput');
      cameraSelect.innerHTML='';
      if(!cams.length){
        const o=document.createElement('option'); o.value=''; o.textContent='No cameras detected'; cameraSelect.appendChild(o);
        return cams;
      }
      cams.forEach((c,i)=>{ const o=document.createElement('option'); o.value=c.deviceId||''; o.textContent=c.label||('Camera '+(i+1)); cameraSelect.appendChild(o); });
      return cams;
    }catch(e){ setStatus('enumerateDevices failed: '+e.message); return []; }
  }

  async function requestPermission(){
    try{
      setStatus('Requesting camera permission…');
      const s=await navigator.mediaDevices.getUserMedia({video:decideFacing(),audio:false});
      s.getTracks().forEach(t=>t.stop());
      setStatus('Permission granted.');
    }catch(e){
      setStatus('Permission request failed: '+(e.name||'')+' '+(e.message||e));
      showAndroidBanner();
    }
    await updatePerm();
    if(navigator.mediaDevices && navigator.mediaDevices.enumerateDevices){ await enumerateCams(); }
  }

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
  async function tryApplyDefaults(){
    try{
      const t=getTrack(); if(!t) return;
      const caps=t.getCapabilities ? t.getCapabilities() : {};
      const cons={advanced:[]};
      if(caps.focusMode && caps.focusMode.indexOf('continuous')>-1) cons.advanced.push({focusMode:'continuous'});
      if(caps.exposureMode && caps.exposureMode.indexOf('continuous')>-1) cons.advanced.push({exposureMode:'continuous'});
      if(cons.advanced.length) await t.applyConstraints(cons);
    }catch(e){}
  }
  function stop(){ scanning=false; if(stream){ stream.getTracks().forEach(t=>t.stop()); stream=null; } if(octx){ octx.clearRect(0,0,overlay.width,overlay.height); } }

  // ---------- Scanning via BarcodeDetector ----------
  let bdFailCount=0, scanTimer=null;
  const SUPPORTED_BD = ['qr_code','aztec','data_matrix','pdf417','code_128','code_39','code_93','codabar','itf','ean_13','ean_8','upc_a','upc_e'];
  async function initScanner(){
    clearTimeout(scanTimer); bdFailCount=0;
    usingBarcodeDetector = ('BarcodeDetector' in window);
    if(usingBarcodeDetector){
      try{
        let fmts = [];
        if (typeof BarcodeDetector.getSupportedFormats === 'function') {
          try { const got = await BarcodeDetector.getSupportedFormats(); fmts = Array.isArray(got) ? got : []; }
          catch(_e){ fmts = []; }
        } else {
          // Conservative default for widest compatibility
          fmts = ['qr_code'];
        }
        // Try to construct in decreasing strictness
        try {
          detector = fmts.length ? new BarcodeDetector({formats: fmts}) : new BarcodeDetector();
        } catch(e1){
          try { detector = new BarcodeDetector({formats:['qr_code']}); }
          catch(e2){ detector = new BarcodeDetector(); }
        }
        const pill = (fmts && fmts.length) ? ('(' + fmts.join(', ') + ')') : '(default)';
        scanEnginePill.textContent='Engine: BarcodeDetector ' + pill;
        scanning=true; loopDetector(); return;
      }catch(e){ /* fall through to unsupported */ }
    }
    scanEnginePill.textContent='Engine: unavailable';
    setStatus('BarcodeDetector unavailable. Ensure HTTPS (or localhost), up-to-date Chrome/Edge, and no enterprise policy disabling Shape Detection.');
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
        catch(e){
          try{ const bmp=await createImageBitmap(video); det=await detector.detect(bmp); }
          catch(e2){}
        }
        if(det && det.length){
          const c=det[0]; const text=c.rawValue || '';
          if(text){ const fmt=c.format||'unknown'; handleDetection(text, fmt, 'camera'); bdFailCount=0; setTimeout(loopDetector, 220); return; }
        }
        bdFailCount++;
      }catch(e){ bdFailCount++; }
      scanTimer=setTimeout(loopDetector, 140);
    })();
  }

  // ---------- Web Serial (phone via Bluetooth → COM) ----------
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
      (async function readLoop(){
        try{
          let buf='';
          while(true){
            const {value,done}=await reader.read();
            if(done) break;
            if(!value) continue;
            buf += value;
            let idx;
            while((idx=buf.indexOf('\n'))!==-1){
              const line=buf.slice(0,idx).trim(); buf=buf.slice(idx+1);
              if(!line) continue;
              if(line[0]==='{'){
                try{
                  const msg=JSON.parse(line);
                  if(msg.t==='qr' && msg.content){
                    handleDetection(String(msg.content),'from-phone','phone-bt');
                    if(msg.img){ attachLatestPhoto(msg.img); }
                  }
                }catch(e){
                  handleDetection(line,'from-phone','phone-bt');
                }
              } else {
                handleDetection(line,'from-phone','phone-bt');
              }
            }
          }
        }catch(e){
          setSerialState('Serial read error: '+(e.message||e));
        }
      })();
      port.addEventListener('disconnect', function(){ setSerialState('Disconnected.'); serialConnected=false; });
    }catch(err){
      setSerialState('Connect failed: '+(err.message||err));
    }
  }
  if(connectSerialBtn){ connectSerialBtn.addEventListener('click', connectSerial); }

  function attachLatestPhoto(imgDataUrl){
    const id = data.length ? data[0].id : null;
    if(!id) return;
    try{
      const list=JSON.parse(localStorage.getItem('qrLoggerV1')||'[]');
      for(let k=0;k<list.length;k++){ if(list[k].id===id){ list[k].photo=imgDataUrl; data[0].photo=imgDataUrl; break; } }
      localStorage.setItem('qrLoggerV1', JSON.stringify(list));
    }catch(e){}
  }

  // ---------- UI & table ----------
  const tbody=$('#logBody');
  function render(){
    tbody.innerHTML='';
    for(let i=0;i<data.length;i++){
      const r=data[i];
      const tr=document.createElement('tr');
      const dateStr=r.date||new Date(r.timestamp).toLocaleDateString();
      const timeStr=r.time||new Date(r.timestamp).toLocaleTimeString();
      const photoCell=r.photo?('<a href="'+r.photo+'" target="_blank" rel="noopener"><img class="thumb" src="'+r.photo+'" alt="photo"/></a>'):'';
      tr.innerHTML='<td class="muted">'+(i+1)+'</td><td>'+esc(r.content)+'</td><td><span class="pill">'+(r.format||'')+'</span></td><td class="muted">'+(r.source||'')+'</td><td class="muted">'+dateStr+'</td><td class="muted">'+timeStr+'</td><td>'+(r.weight||'')+'</td><td>'+photoCell+'</td><td><span class="count">× '+(r.count||1)+'</span></td><td class="note-cell" contenteditable="true">'+esc(r.notes||'')+'</td><td><button type="button" class="small" data-act="edit">Edit</button> <button type="button" class="small" data-act="delete">Delete</button></td>';
      tr.dataset.id=r.id;
      tbody.appendChild(tr);
    }
  }
  function esc(s){ s = (s==null)? '' : s; return (''+s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function upsert(content,format,source){
    if(!content) return;
    const now=new Date(); const iso=now.toISOString();
    const ex=data.find(x=>x.content===content);
    if(ex){ ex.count=(ex.count||1)+1; ex.timestamp=iso; ex.date=now.toLocaleDateString(); ex.time=now.toLocaleTimeString(); save(); render(); beep(); scheduleCapture(ex.id); return; }
    const row={id:(crypto.randomUUID?crypto.randomUUID():(Date.now()+Math.random().toString(36).slice(2))), content:content, format:format||'', source:source||'', timestamp: iso, date:now.toLocaleDateString(), time:now.toLocaleTimeString(), weight:'', photo:'', count:1, notes:''};
    data.unshift(row); save(); render(); beep(); scheduleCapture(row.id);
  }

  document.addEventListener('click', function(e){
    const btn=e.target.closest('button'); if(!btn) return;
    const tr=e.target.closest('tr'); const id=tr && tr.dataset ? tr.dataset.id : null;
    const act=btn.getAttribute('data-act');
    if(act==='delete' && id){ data = data.filter(r=>r.id!==id); save(); render(); }
    if(act==='edit' && id){ const row=data.find(r=>r.id===id); const nv=prompt('Edit content:', row?row.content:''); if(nv!==null && row){ row.content=nv; save(); render(); } }
  });
  document.addEventListener('blur', function(e){
    const c=e.target; if(!c.classList || !c.classList.contains('note-cell')) return;
    const tr=c.closest('tr'); const id=tr && tr.dataset ? tr.dataset.id : null;
    const row=data.find(r=>r.id===id);
    if(row){ row.notes=c.textContent; save(); }
  }, true);

  const manualInput=$('#manualInput');
  $('#addManualBtn').addEventListener('click', function(){ const v=manualInput && manualInput.value ? manualInput.value.trim() : ''; if(v){ upsert(v,'text','manual/keyboard'); manualInput.value=''; } });
  if(manualInput){ manualInput.addEventListener('keydown', function(e){ if(e.key==='Enter'){ e.preventDefault(); const v=manualInput.value.trim(); if(v){ upsert(v,'text','manual/keyboard'); manualInput.value=''; } } }); }

  // ---------- Exports (built-in) ----------
  // Minimal ZIP (store only) writer
  const Zip = (function(){
    function crcTable(){
      const t=new Uint32Array(256);
      for(let n=0;n<256;n++){
        let c=n;
        for(let k=0;k<8;k++){ c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); }
        t[n]=c>>>0;
      }
      return t;
    }
    const TBL = crcTable();
    function crc32(u8){
      let c=~0>>>0;
      for(let i=0;i<u8.length;i++){ c=TBL[(c^u8[i])&0xFF] ^ (c>>>8); }
      return (~c)>>>0;
    }
    function strToU8(s){ return new TextEncoder().encode(s); }
    function dateToDos(d){
      const dt=new Date(d||Date.now());
      const time = (dt.getHours()<<11) | (dt.getMinutes()<<5) | (Math.floor(dt.getSeconds()/2));
      const date = ((dt.getFullYear()-1980)<<9) | ((dt.getMonth()+1)<<5) | dt.getDate();
      return {time, date};
    }
    function writeUint32LE(view, offset, val){ view.setUint32(offset, val>>>0, true); }
    function writeUint16LE(view, offset, val){ view.setUint16(offset, val & 0xFFFF, true); }

    function make(files){
      // files: [{name, bytes(Uint8Array)}]
      const parts=[]; const central=[];
      let offset=0;
      const stamp=dateToDos(Date.now());
      files.forEach(f=>{
        const nameU8 = strToU8(f.name);
        const b = f.bytes instanceof Uint8Array ? f.bytes : strToU8(String(f.bytes||''));
        const crc = crc32(b);
        const comp = 0; // store
        const hdr = new DataView(new ArrayBuffer(30));
        writeUint32LE(hdr, 0, 0x04034b50);
        writeUint16LE(hdr, 4, 20);
        writeUint16LE(hdr, 6, 0);
        writeUint16LE(hdr, 8, comp);
        writeUint16LE(hdr,10, stamp.time);
        writeUint16LE(hdr,12, stamp.date);
        writeUint32LE(hdr,14, crc);
        writeUint32LE(hdr,18, b.length);
        writeUint32LE(hdr,22, b.length);
        writeUint16LE(hdr,26, nameU8.length);
        writeUint16LE(hdr,28, 0);
        parts.push(new Uint8Array(hdr.buffer)); parts.push(nameU8); parts.push(b);
        // central
        const cen = new DataView(new ArrayBuffer(46));
        writeUint32LE(cen, 0, 0x02014b50);
        writeUint16LE(cen, 4, 20); writeUint16LE(cen, 6, 20);
        writeUint16LE(cen, 8, 0); writeUint16LE(cen,10, comp);
        writeUint16LE(cen,12, stamp.time); writeUint16LE(cen,14, stamp.date);
        writeUint32LE(cen,16, crc); writeUint32LE(cen,20, b.length); writeUint32LE(cen,24, b.length);
        writeUint16LE(cen,28, nameU8.length); writeUint16LE(cen,30, 0); writeUint16LE(cen,32, 0);
        writeUint16LE(cen,34, 0); writeUint16LE(cen,36, 0);
        writeUint32LE(cen,38, 0);
        writeUint32LE(cen,42, offset);
        central.push(new Uint8Array(cen.buffer)); central.push(nameU8);
        offset += 30 + nameU8.length + b.length;
      });
      const centralSize = central.reduce((a,u)=>a+u.length,0);
      const eocd = new DataView(new ArrayBuffer(22));
      writeUint32LE(eocd,0,0x06054b50);
      writeUint16LE(eocd,4,0); writeUint16LE(eocd,6,0);
      writeUint16LE(eocd,8,len=files.length); writeUint16LE(eocd,10,len);
      writeUint32LE(eocd,12,centralSize);
      writeUint32LE(eocd,16,parts.reduce((a,u)=>a+u.length,0));
      writeUint16LE(eocd,20,0);
      const totalLen = parts.reduce((a,u)=>a+u.length,0) + centralSize + eocd.byteLength;
      const out = new Uint8Array(totalLen);
      let p=0;
      for(const u of parts){ out.set(u,p); p+=u.length; }
      for(const u of central){ out.set(u,p); p+=u.length; }
      out.set(new Uint8Array(eocd.buffer), p);
      return new Blob([out], {type:'application/zip'});
    }
    return { make, strToU8 };
  })();

  // Minimal XLSX writer (1 sheet) using our Zip
  function xlsxFromRows(rows, sheetName){
    sheetName = sheetName || 'Log';
    // Build worksheet with inline strings
    function escXml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    const cols = rows.length ? Object.keys(rows[0]) : [];
    let sheet = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'];
    // header row
    sheet.push('<row r="1">');
    cols.forEach((c,i)=>{ sheet.push(`<c r="${colRef(i+1)}1" t="inlineStr"><is><t>${escXml(c)}</t></is></c>`); });
    sheet.push('</row>');
    // data rows
    rows.forEach((r,idx)=>{
      const rr = idx+2;
      sheet.push(`<row r="${rr}">`);
      cols.forEach((c,i)=>{
        const v = (r[c]==null? '' : String(r[c]));
        sheet.push(`<c r="${colRef(i+1)}${rr}" t="inlineStr"><is><t>${escXml(v)}</t></is></c>`);
      });
      sheet.push('</row>');
    });
    sheet.push('</sheetData></worksheet>');
    const sheetXml = sheet.join('');

    const parts = [
      {name:'[Content_Types].xml', text:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`},
      {name:'_rels/.rels', text:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`},
      {name:'docProps/core.xml', text:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:title>QR Log</dc:title>
  <dc:creator>QR Logger</dc:creator>
</cp:coreProperties>`},
      {name:'docProps/app.xml', text:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
  <Application>QR Logger</Application>
</Properties>`},
      {name:'xl/_rels/workbook.xml.rels', text:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`},
      {name:'xl/workbook.xml', text:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheets>
    <sheet name="${escapeXmlAttr(sheetName)}" sheetId="1" r:id="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>
  </sheets>
</workbook>`},
      {name:'xl/worksheets/sheet1.xml', text:sheetXml}
    ];
    const files = parts.map(p => ({ name:p.name, bytes: Zip.strToU8(p.text) }));
    return Zip.make(files);
  }
  function colRef(n){
    let s=''; while(n>0){ const m=(n-1)%26; s=String.fromCharCode(65+m)+s; n=Math.floor((n-1)/26); } return s;
  }
  function escapeXmlAttr(s){ return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }

  // Export buttons
  $('#exportCsv').addEventListener('click', function(){
    const headers=["Content","Format","Source","Date","Time","Weight","Photo","Count","Notes","Timestamp"];
    const rows=[headers].concat(data.map(r=>[r.content,r.format,r.source,r.date||'',r.time||'',r.weight||'',r.photo||'',r.count,r.notes||'',r.timestamp||'']));
    const csv=rows.map(row=>row.map(f=>{ const s=((f==null)?'':String(f)).replace(/"/g,'""'); return /[",\n]/.test(s)?('"'+s+'"'):s; }).join(',')).join('\n');
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='qr-log-'+new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')+'.csv'; a.click(); URL.revokeObjectURL(a.href);
  });

  $('#exportXlsx').addEventListener('click', function(){
    const rows=data.map(r=>({"Content":r.content,"Format":r.format,"Source":r.source,"Date":r.date||"","Time":r.time||"","Weight":r.weight||"","Photo":r.photo||"","Count":r.count,"Notes":r.notes||"","Timestamp":r.timestamp||""}));
    const blob = xlsxFromRows(rows, 'Log');
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='qr-log-'+new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')+'.xlsx'; a.click(); URL.revokeObjectURL(a.href);
  });

  $('#exportZip').addEventListener('click', function(){
    const headers=["Content","Format","Source","Date","Time","Weight","Photo","Count","Notes","Timestamp"];
    const rows=[headers].concat(data.map((r,i)=>{
      let photoName='';
      if(r.photo && /^data:image\//.test(r.photo)){
        const ext=(r.photo.split(';')[0].split('/')[1]||'jpg').toLowerCase();
        const safe=(r.content||'').toString().slice(0,20).replace(/[^a-z0-9\-_]+/gi,'_');
        photoName='photos/'+String(i+1).padStart(4,'0')+'_'+safe+'.'+ext;
      }
      return [r.content,r.format,r.source,r.date||'',r.time||'',r.weight||'',photoName,r.count,r.notes||'',r.timestamp||''];
    }));
    const csv=rows.map(row=>row.map(f=>{ const s=(f==null? '' : String(f)).replace(/"/g,'""'); return /[",\n]/.test(s)?('"'+s+'"'):s; }).join(',')).join('\n');
    const files=[{name:'qr-log-'+new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')+'.csv', bytes:Zip.strToU8(csv)}];
    // photos
    for(let i=0;i<data.length;i++){
      const r=data[i];
      if(!r.photo || !/^data:image\//.test(r.photo)) continue;
      const m=r.photo.match(/^data:(image\/[^;]+);base64,(.*)$/);
      if(!m) continue;
      const ext=(m[1]||'image/jpeg').split('/')[1];
      const b64=m[2];
      const bin=atob(b64);
      const u8=new Uint8Array(len=bin.length);
      for(let j=0;j<len;j++){ u8[j]=bin.charCodeAt(j); }
      const safe=(r.content||'').toString().slice(0,20).replace(/[^a-z0-9\-_]+/gi,'_');
      const name='photos/'+String(i+1).padStart(4,'0')+'_'+safe+'.'+ext;
      files.push({name, bytes:u8});
    }
    const blob=Zip.make(files);
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='qr-log-bundle-'+new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')+'.zip'; a.click(); URL.revokeObjectURL(a.href);
  });

  $('#importFileBtn').addEventListener('click', function(){ const fi=$('#fileInput'); if(fi) fi.click(); });
  $('#fileInput').addEventListener('change', async function(e){
    const file=e.target.files[0]; if(!file) return;
    const text=await file.text();
    const rows=text.split(/\r?\n/).map(r=>r.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/));
    const b=rows.slice(1);
    for(let i=0;i<b.length;i++){
      const cols=b[i]; if(!cols.length||!cols[0])continue;
      upsert(cols[0].replace(/\\"/g,'"'), cols[1]||'', cols[2]||'import');
      const last=data[0]; last.date=cols[3]||last.date; last.time=cols[4]||last.time; last.weight=cols[5]||''; last.photo=cols[6]||''; last.count=parseInt(cols[7]||'1',10); last.notes=(cols[8]||'').replace(/^"|"$/g,''); last.timestamp=cols[9]||last.timestamp;
    }
    save(); render(); setStatus('Imported data from CSV.'); e.target.value='';
  });

  // Options
  if(cooldownSecInput){ cooldownSecInput.addEventListener('change', function(){ const v=parseFloat(cooldownSecInput.value); cooldownSec = Math.max(0, Math.min(10, isNaN(v)?5:v)); cooldownSecInput.value = String(cooldownSec); }); }
  if(ignoreDupChk){ ignoreDupChk.addEventListener('change', function(){ ignoreDup = !!ignoreDupChk.checked; }); }

  if(ocrToggleBtn && overlay){
    ocrToggleBtn.addEventListener('click', function(){
      ocrBoxEnabled = !ocrBoxEnabled;
      overlay.style.pointerEvents = ocrBoxEnabled ? 'auto' : 'none';
      drawOCRBox();
      if(ocrBoxEnabled){ setStatus('OCR box shown (OCR engine not bundled). Use HID/BLE or phone weight for now.'); }
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
      let x=e.clientX-r.left-dragOffset.x; let y=e.clientY-r.top-dragOffset.y;
      x=Math.max(0,Math.min(x, overlay.width-ocrBox.w*overlay.width));
      y=Math.max(0,Math.min(y, overlay.height-ocrBox.h*overlay.height));
      ocrBox.x = x/overlay.width; ocrBox.y = y/overlay.height; drawOCRBox();
    });
    window.addEventListener('mouseup', function(){ isDragging=false; });
  }

  $('#permBtn').addEventListener('click', requestPermission);
  $('#startBtn').addEventListener('click', startFromSelection);
  $('#stopBtn').addEventListener('click', function(){ stop(); setStatus('Camera stopped.'); });
  $('#refreshBtn').addEventListener('click', enumerateCams);
  cameraSelect.addEventListener('change', startFromSelection);

  load(); render(); updatePerm(); enumerateCams();
  if(document.visibilityState==='visible') setStatus('Ready. Local/Remote camera, or Phone via Bluetooth/Serial.');

  function beep(){ try{ const a=new AudioContext(), o=a.createOscillator(), g=a.createGain(); o.type='square'; o.frequency.value=880; o.connect(g); g.connect(a.destination); g.gain.setValueAtTime(0.05,a.currentTime); o.start(); setTimeout(()=>{o.stop(); a.close();},90);}catch(e){} }

  // Photo helper (host camera)
  async function capturePhoto(){
    const v=video; const w=v.videoWidth, h=v.videoHeight; if(!w||!h) return '';
    const c=document.createElement('canvas'); c.width=w; c.height=h; const cx=c.getContext('2d'); cx.drawImage(v,0,0,w,h); return c.toDataURL('image/jpeg',0.8);
  }

  function drawOCRBox(){
    try{
      octx.clearRect(0,0,overlay.width,overlay.height);
      if(!ocrBoxEnabled) return;
      const bx=(ocrBox.x||0.6)*overlay.width, by=(ocrBox.y||0.65)*overlay.height, bw=(ocrBox.w||0.35)*overlay.width, bh=(ocrBox.h||0.25)*overlay.height;
      octx.strokeStyle='#22c55e'; octx.lineWidth=3; octx.setLineDash([8,6]); octx.strokeRect(bx,by,bw,bh); octx.setLineDash([]); octx.fillStyle='rgba(34,197,94,0.08)'; octx.fillRect(bx,by,bw,bh);
    }catch(e){}
  }

  window.scheduleCapture = function(id){
    const ms = Math.round((parseFloat(delayInput && delayInput.value || '2')||2)*1000);
    setTimeout(async function(){
      try{
        const row=(function(){ try{ const d=JSON.parse(localStorage.getItem('qrLoggerV1')||'[]'); for(let i=0;i<d.length;i++){ if(d[i].id===id) return d[i]; } return null; }catch(e){ return null; } })();
        if(!row){ return; }
        let weight=''; // OCR engine not bundled; use HID/BLE/phone if available (set elsewhere).
        row.weight = weight;
        if(!row.photo){ row.photo = await capturePhoto(); }
        const list=JSON.parse(localStorage.getItem('qrLoggerV1')||'[]'); for(let k=0;k<list.length;k++){ if(list[k].id===id){ list[k]=row; break; } }
        localStorage.setItem('qrLoggerV1', JSON.stringify(list));
        setStatus('Captured delayed photo.');
        const ev = new Event('storage'); window.dispatchEvent(ev);
      }catch(err){ console.warn('capture failed', err); }
    }, ms);
  };
})();