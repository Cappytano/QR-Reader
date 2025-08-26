export function truncateFields(rows){
  for(let i=0;i<rows.length;i++){
    const r=rows[i];
    for(const k in r){
      const v=r[k];
      if(typeof v === 'string' && v.length>32760){
        r[k]=v.slice(0,32759)+'…';
      }
    }
  }
}
