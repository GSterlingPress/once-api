const base=(process.env.ONCE_BASE_URL||'http://localhost:8787').replace(/\/$/,'');
const id=`launch-${Date.now()}`;
for(let i=0;i<2;i++){const r=await fetch(`${base}/v1/demo`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id})});const j=await r.json();console.log(i?'RETRY':'FIRST',r.status,j);if(!r.ok||j.status!=='VERIFIED'||(i===1&&!j.duplicateSuppressed))process.exit(1)}
console.log('ONCE live smoke passed:',base);
