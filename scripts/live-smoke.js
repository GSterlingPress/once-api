const base=(process.env.ONCE_BASE_URL||'http://localhost:8787').replace(/\/$/,'');
const id=`launch-${Date.now()}`;
const headers={'content-type':'application/json','x-once-internal':'1','x-tollbooth-internal':'1','user-agent':'once-controlled-smoke/1.0'};
for(let i=0;i<2;i++){const r=await fetch(`${base}/v1/demo`,{method:'POST',headers,body:JSON.stringify({id})});const j=await r.json();console.log(i?'RETRY':'FIRST',r.status,j);if(!r.ok||j.status!=='VERIFIED'||(i===1&&!j.duplicateSuppressed))process.exit(1)}
console.log('ONCE live smoke passed as CONTROLLED_TEST:',base);
