
// QR-Reader v7.1.7 CORE (no vendor) — ROI overlay fixed (z-index, DPR, resize)
(function(){
  'use strict';

  function $(s){ return document.querySelector(s); }
  var video=$('#video'), overlay=$('#overlay'), octx=overlay.getContext('2d',{willReadFrequently:true});
  var statusEl=$('#status'), cameraSelect=$('#cameraSelect'), prefFacing=$('#prefFacing'), enginePill=$('#scanEngine'), permStateEl=$('#permState');
  var cooldownSecInput=$('#cooldownSec'), ignoreDupChk=$('#ignoreDup'), resetDupBtn=$('#resetDup');
  var fileInput=$('#fileInput');
  var cameraSourceSel=$('#cameraSource');
  var delaySecInput=$('#delaySec'), scaleModeSel=$('#scaleMode');
  var ocrToggleBtn=$('#ocrToggle'), connectHIDBtn=$('#connectHID'), connectBLEBtn=$('#connectBLE');
  var exportXlsxBtn=$('#exportXlsx'), exportCsvBtn=$('#exportCsv'), exportZipBtn=$('#exportZip'), clearBtn=$('#clearBtn');
  var toastEl=$('#toast');

  var stream=null, scanning=false, detector=null;
  var data=[]; var STORAGE_KEY='qrLoggerV7';
  var cooldownUntil=0, scanTimer=null;
  var roi = { x:0.58, y:0.58, w:0.40, h:0.38, show:false, hasText:false };
  var ocrPulseTimer=null;
  var seenEver = new Set();

  function setStatus(t){ if(statusEl){ statusEl.textContent=t||''; } }
  function toast(t){
    if(!toastEl) return;
    toastEl.textContent = t;
    toastEl.style.display = 'block';
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(function(){ toastEl.style.display='none'; }, 1800);
  }
  function save(){ try{ localStorage.setItem(STORAGE_KEY, JSON.stringify({rows:data,seen:Array.from(seenEver)})); }catch(e){} }
  function load(){ try{ var raw=localStorage.getItem(STORAGE_KEY)||'{}'; var p=JSON.parse(raw); data=p.rows||[]; (p.seen||[]).forEach(function(v){seenEver.add(v)}); }catch(e){ data=[]; } }
  function esc(s){ if(s==null) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function ts(){ return new Date().toISOString().slice(0,19).replace(/[:T]/g,'-'); }

  function decideFacing(){
    var p=prefFacing.value;
    if(p==='environment') return {facingMode:{ideal:'environment'}};
    if(p==='user') return {facingMode:{ideal:'user'}};
    return {facingMode:{ideal:'user'}};
  }
  function updatePerm(){
    if(!('permissions' in navigator)) return;
    try{
      navigator.permissions.query({name:'camera'}).then(function(st){
        if(permStateEl){ permStateEl.textContent='Permission: '+st.state; }
        st.onchange = function(){ if(permStateEl){ permStateEl.textContent='Permission: '+st.state; } };
      });
    }catch(e){}
  }
  function enumerateCams(){
    if(!(navigator.mediaDevices && navigator.mediaDevices.enumerateDevices)) return Promise.resolve([]);
    return navigator.mediaDevices.enumerateDevices().then(function(devs){
      var cams=[];
      for(var i=0;i<devs.length;i++){ if(devs[i].kind==='videoinput') cams.push(devs[i]); }
      cameraSelect.innerHTML='';
      if(!cams.length){
        var o=document.createElement('option'); o.value=''; o.textContent='No cameras detected'; cameraSelect.appendChild(o); return cams;
      }
      for(var j=0;j<cams.length;j++){
        var c=cams[j]; var oo=document.createElement('option');
        oo.value=c.deviceId||''; oo.textContent=c.label||('Camera '+(j+1)); cameraSelect.appendChild(oo);
      }
      return cams;
    }).catch(function(e){ setStatus('enumerateDevices failed: '+e.message); return []; });
  }
  function requestPermission(){
    try{
      setStatus('Requesting camera permission…');
      navigator.mediaDevices.getUserMedia({video:decideFacing(),audio:false}).then(function(s){
        var tracks=s.getTracks(); for(var i=0;i<tracks.length;i++) tracks[i].stop();
        setStatus('Permission granted.');
        updatePerm(); enumerateCams();
      }).catch(function(e){ setStatus('Permission request failed: '+(e.name||'')+' '+(e.message||e)); });
    }catch(e){ setStatus('Permission error: '+(e.message||e)); }
  }

  // === Overlay sizing (DPR-aware) ===
  function sizeOverlay(){
    if(!video || !overlay || !octx) return;
    const r = video.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    overlay.style.width  = r.width + 'px';
    overlay.style.height = r.height + 'px';
    overlay.width  = Math.max(1, Math.round(r.width  * dpr));
    overlay.height = Math.max(1, Math.round(r.height * dpr));
    octx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS pixels
    drawROI();
  }
  window.addEventListener('resize', sizeOverlay);

  function useStream(s,label){
    stop();
    stream=s; video.srcObject=stream;
    video.play().then(function(){
      var track=stream.getVideoTracks()[0]; var st=track?track.getSettings():{};
      setStatus((label||'Camera')+' started ('+(st.width||'?')+'×'+(st.height||'?')+')');
      sizeOverlay(); initScanner();
    }).catch(function(e){ setStatus('Video play failed: '+e.message); });
  }
  function startFromSelection(){
    if(cameraSourceSel.value==='remote'){ setStatus('Remote camera active (see remote.js).'); return; }
    if(cameraSourceSel.value==='serial'){ setStatus('Listening on Serial for codes…'); return; }
    var id=cameraSelect.value;
    try{
      navigator.mediaDevices.getUserMedia({video:id?{deviceId:{exact:id}}:decideFacing(),audio:false})
        .then(function(s){ useStream(s,'Camera'); })
        .catch(function(e){ setStatus('getUserMedia error: '+e.message); });
    }catch(e){ setStatus('Camera start error: '+(e.message||e)); }
  }
  function stop(){
    scanning=false;
    if(stream){ try{ stream.getTracks().forEach(function(t){t.stop();}); }catch(_e){} stream=null; }
    if(scanTimer) clearTimeout(scanTimer);
    try{ octx.clearRect(0,0,overlay.width,overlay.height); }catch(_e){}
    if(ocrPulseTimer) clearInterval(ocrPulseTimer);
  }

  function initScanner(){
    // Engine 1: BarcodeDetector
    if('BarcodeDetector' in window){
      try{
        var fmts=['qr_code','data_matrix','aztec','pdf417','code_128','code_39','code_93','codabar','itf','ean_13','ean_8','upc_a','upc_e'];
        if(window.BarcodeDetector.getSupportedFormats){
          window.BarcodeDetector.getSupportedFormats().then(function(list){
            var f=list.filter(function(x){return fmts.indexOf(x)!==-1;}); if(!f.length) f=['qr_code'];
            detector=new window.BarcodeDetector({formats:f}); if(enginePill) enginePill.textContent='Engine: BarcodeDetector'; scanning=true; loopBD();
          }).catch(function(){ detector=new window.BarcodeDetector({formats:['qr_code']}); if(enginePill) enginePill.textContent='Engine: BarcodeDetector'; scanning=true; loopBD(); });
        } else {
          detector=new window.BarcodeDetector({formats:fmts}); if(enginePill) enginePill.textContent='Engine: BarcodeDetector'; scanning=true; loopBD();
        }
        return;
      }catch(e){ /* continue */ }
    }
    // Engine 2: jsQR fallback (optional — requires vendor/jsQR.js)
    if(window.jsQR){ if(enginePill) enginePill.textContent='Engine: jsQR'; scanning=true; loopJsQR(); return; }
    if(enginePill) enginePill.textContent='Engine: none'; setStatus('No scanning engine available (need BarcodeDetector or jsQR).');
  }

  function inCooldown(){ return Date.now()<cooldownUntil; }
  var pendingWeightTimer=null;

  function handleDetection(text, fmt){
    if(!text) return;
    var ignoreDup=ignoreDupChk&&ignoreDupChk.checked;
    if(ignoreDup&&seenEver.has(text)) return;
    var now=new Date();
    var existing=null;
    for(var i=0;i<data.length;i++){ if(data[i].content===text){ existing=data[i]; break; } }
    if(existing){
      existing.count=(existing.count||1)+1;
      existing.timestamp=now.toISOString(); existing.date=now.toLocaleDateString(); existing.time=now.toLocaleTimeString();
      save(); render();
    }else{
      var row={id:String(Date.now())+Math.random().toString(36).slice(2), content:text, format:fmt||'qr_code', source:'camera', timestamp:now.toISOString(), date:now.toLocaleDateString(), time:now.toLocaleTimeString(), weight:'', photo:'', count:1, notes:''};
      data.unshift(row); save(); render();
    }
    if(ignoreDup) seenEver.add(text);
    var cd=parseFloat(cooldownSecInput.value||'5'); if(isNaN(cd)) cd=5; cd=Math.max(0,Math.min(10,cd)); cooldownUntil=Date.now()+Math.floor(cd*1000);

    var delayMs=Math.max(0,Math.min(4000,Math.floor(parseFloat(delaySecInput.value||'2')*1000)));
    if(pendingWeightTimer){ clearTimeout(pendingWeightTimer); }
    var last=data[0];
    pendingWeightTimer=setTimeout(function(){ captureWeightAndPhoto(last); }, delayMs);
  }

  function loopBD(){
    if(!scanning||!video||video.readyState<2){ scanTimer=setTimeout(loopBD,160); return; }
    if(inCooldown()){ scanTimer=setTimeout(loopBD,260); return; }
    detector.detect(video).then(function(res){
      if(res&&res.length){
        var c=res[0]; var text=c.rawValue||'';
        if(text){ handleDetection(text, c.format||'qr_code'); scanTimer=setTimeout(loopBD,220); return; }
      }
      scanTimer=setTimeout(loopBD,140);
    }).catch(function(){ scanTimer=setTimeout(loopBD,160); });
  }
  var sample=document.createElement('canvas'), sctx=sample.getContext('2d',{willReadFrequently:true});
  function loopJsQR(){
    if(!scanning||!video||video.readyState<2){ scanTimer=setTimeout(loopJsQR,180); return; }
    if(inCooldown()){ scanTimer=setTimeout(loopJsQR,300); return; }
    var vw=video.videoWidth||0, vh=video.videoHeight||0; if(!vw||!vh){ scanTimer=setTimeout(loopJsQR,160); return; }
    var MAXW=640, scale=vw>MAXW?(MAXW/vw):1, sw=Math.max(1,Math.floor(vw*scale)), sh=Math.max(1,Math.floor(vh*scale));
    sample.width=sw; sample.height=sh; sctx.imageSmoothingEnabled=false; sctx.drawImage(video,0,0,sw,sh);
    try{
      var id=sctx.getImageData(0,0,sw,sh);
      var q=window.jsQR && window.jsQR(id.data, sw, sh, {inversionAttempts:'attemptBoth'});
      if(q&&q.data){ handleDetection(q.data,'qr_code'); scanTimer=setTimeout(loopJsQR,220); return; }
    }catch(e){}
    scanTimer=setTimeout(loopJsQR,160);
  }

  // === ROI drawing (with subtle fill & handles), uses CSS px thanks to setTransform ===
  function drawROI(){
    if(!octx) return;
    octx.clearRect(0,0,overlay.width,overlay.height);
    if(!roi.show){ overlay.style.pointerEvents='none'; return; }
    overlay.style.pointerEvents='auto';

    const cssW = overlay.clientWidth, cssH = overlay.clientHeight;
    const x=roi.x*cssW, y=roi.y*cssH, w=roi.w*cssW, h=roi.h*cssH;

    octx.save();
    octx.fillStyle   = roi.hasText ? 'rgba(34,197,94,0.10)' : 'rgba(255,255,255,0.06)';
    octx.strokeStyle = roi.hasText ? 'rgba(34,197,94,0.95)' : 'rgba(139,139,139,0.95)';
    octx.lineWidth   = 2;
    octx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
    octx.setLineDash([6,4]);
    octx.strokeRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
    octx.setLineDash([]);
    const s=9, pts=[[x,y],[x+w,y],[x,y+h],[x+w,y+h]];
    octx.fillStyle = octx.strokeStyle; octx.lineWidth=1;
    for(var i=0;i<pts.length;i++){
      var p=pts[i];
      octx.fillRect(Math.round(p[0]-s/2), Math.round(p[1]-s/2), s, s);
      octx.strokeRect(Math.round(p[0]-s/2), Math.round(p[1]-s/2), s, s);
    }
    octx.restore();
  }

  function ensureTesseract(){
    if(!(window.Tesseract&&window.Tesseract.createWorker)) return Promise.resolve(null);
    if(ensureTesseract._p) return ensureTesseract._p;
    ensureTesseract._p = window.Tesseract.createWorker({
      workerPath:'vendor/worker.min.js',
      corePath:'vendor/tesseract-core/tesseract-core.wasm.js',
      langPath:'vendor/lang-data'
    }).then(function(w){
      return w.load().then(function(){return w.loadLanguage('eng');}).then(function(){return w.initialize('eng');}).then(function(){ try{ return w.setParameters({tessedit_char_whitelist:'0123456789. kgKGlbLBozOZ',preserve_interword_spaces:'1'}).then(function(){return w;}); }catch(e){ return w; } });
    }).catch(function(){ ensureTesseract._p=null; return null; });
    return ensureTesseract._p;
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
    try{
      if(video&&video.readyState>=2){
        var c=document.createElement('canvas'); c.width=video.videoWidth||0; c.height=video.videoHeight||0; c.getContext('2d').drawImage(video,0,0);
        row.photo=c.toDataURL('image/jpeg',0.8);
      }
    }catch(e){}
    var mode=(scaleModeSel&&scaleModeSel.value)||'none';
    if(mode==='ocr'){ ensureTesseract().then(function(w){
      if(!w){ setStatus('Tesseract not loaded (add vendor files).'); return; }
      var vw=video.videoWidth||0, vh=video.videoHeight||0; if(!vw||!vh){ setStatus('OCR: video not ready'); return; }
      var sx=Math.floor(vw*roi.x), sy=Math.floor(vh*roi.y), sw=Math.floor(vw*roi.w), sh=Math.floor(vh*roi.h);
      var c=document.createElement('canvas'); c.width=Math.max(1,sw); c.height=Math.max(1,sh); c.getContext('2d').drawImage(video, sx, sy, sw, sh, 0, 0, c.width, c.height);
      w.recognize(c).then(function(res){ var txt=res&&res.data&&res.data.text?res.data.text:''; var grams=toGramsString(txt); if(grams){ row.weight=grams; save(); render(); setStatus('Weight OCR: '+grams+' g'); toast('Captured weight: '+grams+' g'); } else { setStatus('OCR: no numeric weight found'); } });
    }); }
    save(); render();
  }
  function startOcrPulse(){
    if(ocrPulseTimer) clearInterval(ocrPulseTimer);
    ocrPulseTimer=setInterval(function(){
      if(!(roi.show && scaleModeSel && scaleModeSel.value==='ocr')){ roi.hasText=false; drawROI(); return; }
      if(!(video && video.readyState>=2)){ roi.hasText=false; drawROI(); return; }
      ensureTesseract().then(function(w){
        if(!w){ roi.hasText=false; drawROI(); return; }
        try{
          var vw=video.videoWidth||0, vh=video.videoHeight||0; if(!vw||!vh){ roi.hasText=false; drawROI(); return; }
          var sx=Math.floor(vw*roi.x), sy=Math.floor(vh*roi.y), sw=Math.floor(vw*roi.w), sh=Math.floor(vh*roi.h);
          var c=document.createElement('canvas'); c.width=Math.max(1,sw); c.height=Math.max(1,sh); c.getContext('2d').drawImage(video, sx, sy, sw, sh, 0, 0, c.width, c.height);
          w.recognize(c).then(function(res){ var txt=(res&&res.data&&res.data.text)||''; var has=/\d/.test(txt); roi.hasText=!!has; drawROI(); if(has){ setStatus('OCR live: text in ROI'); } });
        }catch(e){ roi.hasText=false; drawROI(); }
      });
    }, 900);
  }

  function drawReady(){ setStatus('Ready. Engines: BD → jsQR. Populate /vendor for OCR/XLSX/ZIP.'); }

  function ocrToggle(){
    roi.show=!roi.show;
    sizeOverlay();  // ensure canvas is sized before drawing
    drawROI();
    if(roi.show){
      startOcrPulse();
      setStatus('OCR box enabled. Set Scale source to OCR.');
    } else {
      if(ocrPulseTimer) clearInterval(ocrPulseTimer);
      roi.hasText=false;
      drawROI();
    }
  }

  // ROI interactions
  $('#ocrToggle').addEventListener('click', ocrToggle);
  var dragging=null;
  function norm(ev){ var r=overlay.getBoundingClientRect(); var p=('touches' in ev && ev.touches.length)?ev.touches[0]:ev; var nx=(p.clientX-r.left)/r.width, ny=(p.clientY-r.top)/r.height; return {nx:Math.max(0,Math.min(1,nx)),ny:Math.max(0,Math.min(1,ny))}; }
  function hit(nx,ny){ var m=0.02, inBox=(nx>=roi.x && ny>=roi.y && nx<=roi.x+roi.w && ny<=roi.y+roi.h); function near(ax,ay){return Math.abs(nx-ax)<=m&&Math.abs(ny-ay)<=m;} if(near(roi.x,roi.y))return'nw'; if(near(roi.x+roi.w,roi.y))return'ne'; if(near(roi.x,roi.y+roi.h))return'sw'; if(near(roi.x+roi.w,roi.y+roi.h))return'se'; if(inBox)return'move'; return null; }
  function startDrag(ev){ if(!roi.show) return; var p=norm(ev); var mode=hit(p.nx,p.ny); if(!mode) return; if(ev.preventDefault) ev.preventDefault(); dragging={mode:mode, ox:p.nx, oy:p.ny, rx:roi.x, ry:roi.y, rw:roi.w, rh:roi.h}; }
  function moveDrag(ev){ if(!dragging) return; var p=norm(ev), dx=p.nx-dragging.ox, dy=p.ny-dragging.oy, minW=0.08, minH=0.08; if(dragging.mode==='move'){ roi.x=Math.max(0,Math.min(1-dragging.rw,dragging.rx+dx)); roi.y=Math.max(0,Math.min(1-dragging.rh,dragging.ry+dy)); } else { var x=dragging.rx, y=dragging.ry, w=dragging.rw, h=dragging.rh; if(dragging.mode.indexOf('n')>=0){ y=Math.max(0,Math.min(dragging.ry+dy,dragging.ry+dragging.rh-minH)); h=(dragging.ry+dragging.rh)-y; } if(dragging.mode.indexOf('s')>=0){ h=Math.max(minH,Math.min(1-dragging.ry,dragging.rh+dy)); } if(dragging.mode.indexOf('w')>=0){ x=Math.max(0,Math.min(dragging.rx+dx,dragging.rx+dragging.rw-minW)); w=(dragging.rx+dragging.rw)-x; } if(dragging.mode.indexOf('e')>=0){ w=Math.max(minW,Math.min(1-dragging.rx,dragging.rw+dx)); } roi.x=x; roi.y=y; roi.w=w; roi.h=h; } drawROI(); if(ev.preventDefault) ev.preventDefault(); }
  function endDrag(ev){ if(!dragging) return; dragging=null; if(ev.preventDefault) ev.preventDefault(); }
  overlay.addEventListener('mousedown', startDrag); overlay.addEventListener('mousemove', moveDrag); window.addEventListener('mouseup', endDrag);
  overlay.addEventListener('touchstart', startDrag, {passive:false}); overlay.addEventListener('touchmove', moveDrag, {passive:false}); overlay.addEventListener('touchend', endDrag, {passive:false}); overlay.addEventListener('touchcancel', endDrag, {passive:false});

  var tbody=$('#logBody');
  function render(){
    tbody.innerHTML='';
    for(var i=0;i<data.length;i++){
      var r=data[i];
      var photo=r.photo?'<img class="thumb" alt="photo" src="'+r.photo+'"/>':'';
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
    if(act==='edit'&&id){
      for(var i=0;i<data.length;i++){ if(data[i].id===id){ var row=data[i]; var nv=prompt('Edit content:', row.content); if(nv!==null){ row.content=nv; save(); render(); } break; } }
    }
  });
  document.addEventListener('blur', function(e){
    var c=e.target; if(!(c&&c.classList&&c.classList.contains('note-cell'))) return;
    var tr=c.closest?c.closest('tr'):null; var id=tr&&tr.dataset?tr.dataset.id:null; if(!id) return;
    for(var i=0;i<data.length;i++){ if(data[i].id===id){ data[i].notes=c.textContent; break; } } save();
  }, true);

  // Import/Export
  function rowsForExport(){ var out=[]; for(var i=0;i<data.length;i++){ var r=data[i]; out.push({"Content":r.content,"Format":r.format,"Source":r.source,"Date":r.date||"","Time":r.time||"","Weight":r.weight||"","Photo":r.photo?('photo-'+(r.id||'')+'.jpg'):"","Count":r.count||1,"Notes":r.notes||"","Timestamp":r.timestamp||""}); } return out; }
  function rowsForCsv(){ var out=[]; for(var i=0;i<data.length;i++){ var r=data[i]; out.push({"Content":r.content,"Format":r.format,"Source":r.source,"Date":r.date||"","Time":r.time||"","Weight":r.weight||"","Photo":r.photo||"","Count":r.count||1,"Notes":r.notes||"","Timestamp":r.timestamp||""}); } return out; }

  function download(blob,name){ var a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; a.click(); setTimeout(function(){URL.revokeObjectURL(a.href);},500); }
  function exportCsv(){ var rows=rowsForCsv(), cols=["Content","Format","Source","Date","Time","Weight","Photo","Count","Notes","Timestamp"]; var out=[cols]; for(var i=0;i<rows.length;i++){ var r=rows[i]; var line=[]; for(var j=0;j<cols.length;j++){ var v=r[cols[j]]; v=(v==null?'':String(v)).replace(/\"/g,'\"\"'); line.push(/[\",\\n]/.test(v)?('\"'+v+'\"'):v); } out.push(line); } var csv=out.map(function(a){return a.join(',')}).join('\\n'); download(new Blob([csv],{type:'text/csv;charset=utf-8'}),'qr-log-'+ts()+'.csv'); }

  function xlsxBuiltIn(rows,sheetName){
  function escXml(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;');}
  function colRef(n){var s='';while(n>0){var m=(n-1)%26;s=String.fromCharCode(65+m)+s;n=Math.floor((n-1)/26);}return s;}
  function attr(s){return String(s).replace(/&/g,'&amp;').replace(/\"/g,'&quot;').replace(/</g,'&lt;');}
  var cols=rows.length?Object.keys(rows[0]):[];

  var sheet=['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>','<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'];
  sheet.push('<row r="1">');
  for(var i=0;i<cols.length;i++){ var c=cols[i]; sheet.push('<c r="'+colRef(i+1)+'1" t="inlineStr"><is><t>'+escXml(c)+'</t></is></c>'); }
  sheet.push('</row>');
  for(var ri=0;ri<rows.length;ri++){ var r=rows[ri]; var rr=ri+2; sheet.push('<row r="'+rr+'">'); for(var ci=0;ci<cols.length;ci++){ var cc=cols[ci]; var v=(r[cc]==null?'':String(r[cc])); if(v.length>32760) v=v.slice(0,32759)+'…'; sheet.push('<c r="'+colRef(ci+1)+rr+'" t="inlineStr"><is><t>'+escXml(v)+'</t></is></c>'); } sheet.push('</row>'); }
  sheet.push('</sheetData></worksheet>');

  var parts=[
    {'name':'[Content_Types].xml','text':'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n<Default Extension="xml" ContentType="application/xml"/>\n<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>\n<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>\n<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>\n<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>\n</Types>'},
    {'name':'_rels/.rels','text':'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>\n  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>\n  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships" Target="docProps/app.xml"/>\n</Relationships>'},
    {'name':'docProps/core.xml','text':'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">\n  <dc:title>QR Log</dc:title><dc:creator>QR Logger</dc:creator>\n</cp:coreProperties>'},
    {'name':'docProps/app.xml','text':'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>QR Logger</Application></Properties>'},
    {'name':'xl/_rels/workbook.xml.rels','text':'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/officeDocument/2006/relationships">\n  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>\n</Relationships>'},
    {'name':'xl/workbook.xml','text':'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">\n  <sheets><sheet name="'+attr(sheetName)+'" sheetId="1" r:id="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></sheets>\n</workbook>'},
    {'name':'xl/worksheets/sheet1.xml','text':sheet.join('')}
  ];

  function strU8(s){ return new TextEncoder().encode(String(s)); }
  function concat(arrs){ var len=0; for(var i=0;i<arrs.length;i++){ len+=arrs[i].length; } var out=new Uint8Array(len),p=0; for(var j=0;j<arrs.length;j++){ out.set(arrs[j],p); p+=arrs[j].length; } return out; }
  function crc32(data){ var c=~0>>>0; for(var i=0;i<data.length;i++){ c=c^data[i]; for(var k=0;k<8;k++){ c=(c>>>1) ^ (0xEDB88320 & (-(c & 1))); } } return (~c)>>>0; }

  function fileRec(name, bytes){
    var head=[0x50,0x4b,0x03,0x04, 20,0, 0,0, 0,0, 0,0, 0,0,0,0, 0,0,0,0, 0,0, 0,0, 0,0];
    head=Uint8Array.from(head);
    var nm=new TextEncoder().encode(name);
    var crc=crc32(bytes);
    var csz=bytes.length, usz=bytes.length;
    head[14]=crc&255; head[15]=(crc>>8)&255; head[16]=(crc>>16)&255; head[17]=(crc>>24)&255;
    head[18]=csz&255; head[19]=(csz>>8)&255; head[20]=(csz>>16)&255; head[21]=(csz>>24)&255;
    head[22]=usz&255; head[23]=(usz>>8)&255; head[24]=(usz>>16)&255; head[25]=(usz>>24)&255;
    head[26]=nm.length&255; head[27]=(nm.length>>8)&255; head[28]=0; head[29]=0;
    return concat([head,nm,bytes]);
  }
  function centralRec(name, bytes){
    var nm=new TextEncoder().encode(name);
    var crc=crc32(bytes);
    var csz=bytes.length, usz=bytes.length;
    var h=[0x50,0x4b,0x01,0x02, 0x14,0x00, 0x14,0x00, 0,0, 0,0,
      crc&255,(crc>>8)&255,(crc>>16)&255,(crc>>24)&255,
      csz&255,(csz>>8)&255,(csz>>16)&255,(csz>>24)&255,
      usz&255,(usz>>8)&255,(usz>>16)&255,(usz>>24)&255,
      nm.length&255,(nm.length>>8)&255, 0,0, 0,0, 0,0, 0,0, 0,0, 0,0];
    return new Uint8Array(h.concat(Array.from(nm)));
  }

  var files=[
    {'name':'xl/worksheets/sheet1.xml','bytes':strU8(sheet.join(''))},
    {'name':'xl/_rels/workbook.xml.rels','bytes':strU8(parts[4]['text'])},
    {'name':'xl/workbook.xml','bytes':strU8(parts[5]['text'])},
    {'name':'docProps/core.xml','bytes':strU8(parts[2]['text'])},
    {'name':'docProps/app.xml','bytes':strU8(parts[3]['text'])},
    {'name':'_rels/.rels','bytes':strU8(parts[1]['text'])},
    {'name':'[Content_Types].xml','bytes':strU8(parts[0]['text'])}
  ];

  var offset=0, locals=[], centrals=[];
  for(var i=0;i<files.length;i++){
    var rec=fileRec(files[i].name, files[i].bytes);
    locals.push(rec);
    centrals.push(centralRec(files[i].name, files[i].bytes));
    offset += rec.length;
  }
  var cen = concat(centrals);
  var endSig = Uint8Array.from([0x50,0x4b,0x05,0x06, 0,0, 0,0,
    (files.length)&255,((files.length)>>8)&255, (files.length)&255,((files.length)>>8)&255,
    cen.length&255,(cen.length>>8)&255,(cen.length>>16)&255,(cen.length>>24)&255,
    offset&255,(offset>>8)&255,(offset>>16)&255,(offset>>24)&255, 0,0]);
  var blob=new Blob([concat(locals), cen, endSig],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  return blob;
}
  function exportXlsx(){
    var rows=rowsForExport();
    if(window.XLSX){ var ws=window.XLSX.utils.json_to_sheet(rows); var wb=window.XLSX.utils.book_new(); window.XLSX.utils.book_append_sheet(wb, ws, 'Log'); var out=window.XLSX.write(wb,{bookType:'xlsx',type:'array'}); download(new Blob([out],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),'qr-log-'+ts()+'.xlsx'); }
    else{ download(xlsxBuiltIn(rows,'Log'),'qr-log-'+ts()+'.xlsx'); }
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
      }else{
        toast('XLSX import needs SheetJS (vendor/xlsx.full.min.js).');
      }
      return;
    }
    toast('Unsupported file type.');
  }
  function importCsvText(text){
    var lines=text.split(/\\r?\\n/); if(!lines.length) return;
    var cols=lines[0].split(',');
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

  // Keep overlay in sync with video lifecycle & layout
  video.addEventListener('loadedmetadata', sizeOverlay);
  video.addEventListener('playing',        sizeOverlay);
  window.addEventListener('resize',        sizeOverlay);
  if ('ResizeObserver' in window) {
    var ro = new ResizeObserver(function(){ sizeOverlay(); });
    ro.observe(video);
  }

  if('serviceWorker' in navigator){ navigator.serviceWorker.register('./sw.js'); }

  load(); render(); enumerateCams(); drawReady();
})();
