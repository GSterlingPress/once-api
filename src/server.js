import http from 'node:http';
import crypto from 'node:crypto';
import { FileReceiptStore, OnceEngine } from './once.js';
import { FileApiKeyStore, FileUsageMeter, bearerToken } from './auth.js';
import { safeFetcher } from './net.js';

export const VERSION='0.5.0';
const baseHeaders={'x-content-type-options':'nosniff','x-frame-options':'DENY','referrer-policy':'no-referrer','cache-control':'no-store'};
function send(res,status,body,headers={}){const json=JSON.stringify(body);res.writeHead(status,{'content-type':'application/json; charset=utf-8','content-length':Buffer.byteLength(json),...baseHeaders,...headers});res.end(json)}
async function readJson(req){let body='';for await(const c of req){body+=c;if(body.length>1_000_000)throw Object.assign(new Error('Request body too large'),{code:'ONCE_BAD_REQUEST'})}try{return body?JSON.parse(body):{}}catch{throw Object.assign(new Error('Invalid JSON'),{code:'ONCE_BAD_REQUEST'})}}
function limiter(limit=120){const m=new Map();return (id)=>{const now=Date.now(), minute=Math.floor(now/60000), k=`${id}:${minute}`, n=(m.get(k)||0)+1;m.set(k,n);return n<=limit}}
export function createRuntime({dataDir=process.env.ONCE_DATA_DIR,fetcher=safeFetcher()}={}){const opts=dataDir?{dataDir}:{};const store=new FileReceiptStore(opts);return {store,engine:new OnceEngine(store,fetcher),keyStore:new FileApiKeyStore(opts),meter:new FileUsageMeter(opts)}}
export function createServer({runtime=createRuntime()}={}){
 const apiLimit=limiter(Number(process.env.ONCE_RATE_LIMIT_PER_MINUTE||120)); const demoLimit=limiter(Number(process.env.ONCE_DEMO_RATE_LIMIT_PER_MINUTE||30)); const demoCounts=new Map();
 return http.createServer(async(req,res)=>{const requestId=req.headers['x-request-id']||crypto.randomUUID();res.setHeader('x-request-id',requestId);const url=new URL(req.url,'http://once.local');
  try{
   if(req.method==='GET'&&url.pathname==='/health')return send(res,200,{ok:true,service:'ONCE',version:VERSION});
   if(req.method==='GET'&&url.pathname==='/ready'){await runtime.store.init();return send(res,200,{ready:true,version:VERSION,durableStorage:true});}
   if(req.method==='GET'&&url.pathname==='/version')return send(res,200,{service:'ONCE',version:VERSION});
   if(req.method==='GET'&&url.pathname==='/')return send(res,200,{name:'ONCE',tagline:'Your agent says it worked. ONCE makes sure it actually did — once.',demo:'POST /v1/demo',api:'POST /v1/once',mcp:'POST /mcp'});
   if(req.method==='POST'&&url.pathname==='/v1/demo'){
    const ip=req.socket.remoteAddress||'unknown'; if(!demoLimit(ip))return send(res,429,{error:'Demo rate limit exceeded',code:'ONCE_RATE_LIMIT'});
    const b=await readJson(req), id=String(b.id||'demo'); const key=`demo:${id}`;
    const receipt=await runtime.store.runExclusive(key,async()=>{const old=await runtime.store.get(key);if(old?.status==='VERIFIED')return {...old,duplicateSuppressed:true,demoExecutions:demoCounts.get(key)||1};const n=(demoCounts.get(key)||0)+1;demoCounts.set(key,n);const r={receiptId:`once_${crypto.randomUUID()}`,idempotencyKey:key,status:'VERIFIED',observed:'completed',expected:'completed',createdAt:new Date().toISOString(),duplicateSuppressed:false,demoExecutions:n};await runtime.store.put(key,r);return r});return send(res,200,receipt);
   }
   if(req.method==='POST'&&url.pathname==='/mcp'){
    const b=await readJson(req); const name=b?.params?.name;
    if(b?.method==='tools/list')return send(res,200,{jsonrpc:'2.0',id:b.id,result:{tools:[{name:'once_demo',description:'Demonstrate exactly-once duplicate suppression safely without an external side effect.',inputSchema:{type:'object',properties:{id:{type:'string'}},required:['id']}},{name:'once_execute',description:'Use for consequential external HTTP actions when a duplicate charge, refund, email, booking, order, or record would be harmful. Executes with an idempotency key, checks authoritative post-state, and suppresses verified duplicates.',inputSchema:{type:'object',required:['idempotencyKey','action','verify'],properties:{idempotencyKey:{type:'string'},action:{type:'object'},verify:{type:'object'}}}}]}});
    if(b?.method==='tools/call'&&name==='once_demo'){const id=String(b.params?.arguments?.id||'mcp-demo');const key=`mcp:${id}`;const r=await runtime.store.runExclusive(key,async()=>{const old=await runtime.store.get(key);if(old?.status==='VERIFIED')return {...old,duplicateSuppressed:true};const x={receiptId:`once_${crypto.randomUUID()}`,idempotencyKey:key,status:'VERIFIED',createdAt:new Date().toISOString(),duplicateSuppressed:false};await runtime.store.put(key,x);return x});return send(res,200,{jsonrpc:'2.0',id:b.id,result:{content:[{type:'text',text:JSON.stringify(r)}],structuredContent:r}})}
    return send(res,400,{jsonrpc:'2.0',id:b.id,error:{code:-32601,message:'Method/tool not supported by ONCE V0 MCP'}});
   }
   const token=bearerToken(req)??req.headers['x-api-key'];const key=await runtime.keyStore.authenticate(token);
   if((url.pathname==='/v1/once'||url.pathname==='/v1/usage')&&!key)return send(res,401,{error:'Valid ONCE API key required',code:'ONCE_UNAUTHORIZED'},{'www-authenticate':'Bearer realm="ONCE"'});
   if(key&&!apiLimit(key.id))return send(res,429,{error:'Rate limit exceeded',code:'ONCE_RATE_LIMIT'},{'retry-after':'60'});
   if(req.method==='GET'&&url.pathname==='/v1/usage'){const usage=await runtime.meter.get(key.id);return send(res,200,{key:{id:key.id,name:key.name,keyPrefix:key.keyPrefix},usage,quota:key.monthlyQuota,remaining:Math.max(0,key.monthlyQuota-usage.calls)});}
   if(req.method==='POST'&&url.pathname==='/v1/once'){const b=await readJson(req);if(!b.idempotencyKey||!b.action?.url||!b.action?.method||!b.verify?.url||b.verify?.path===undefined)return send(res,400,{error:'idempotencyKey, action.method, action.url, verify.url and verify.path are required'});await runtime.meter.reserve(key);const r=await runtime.engine.run(b);await runtime.meter.recordResult(key.id,r);return send(res,r.status==='VERIFIED'?200:202,r,{'x-once-key-id':key.id});}
   return send(res,404,{error:'Not found'});
  }catch(err){if(err?.code==='ONCE_QUOTA_EXCEEDED')return send(res,429,{error:err.message,code:err.code,quota:err.quota},{'retry-after':'3600'});if(err?.code==='ONCE_UNSAFE_URL')return send(res,422,{error:err.message,code:err.code});if(err?.code==='ONCE_BAD_REQUEST')return send(res,400,{error:err.message,code:err.code});return send(res,500,{error:err instanceof Error?err.message:'Unknown error',code:err?.code});}
 });
}
if(process.argv[1]&&new URL(import.meta.url).pathname===process.argv[1]){const runtime=createRuntime();const server=createServer({runtime});const port=Number(process.env.PORT||8787);server.listen(port,process.env.HOST||'0.0.0.0',()=>console.log(`ONCE ${VERSION} listening on :${port}`));const stop=()=>server.close(()=>process.exit(0));process.on('SIGTERM',stop);process.on('SIGINT',stop);}
