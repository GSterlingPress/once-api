import http from 'node:http';
import crypto from 'node:crypto';
import { FileReceiptStore, OnceEngine } from './once.js';
import { FileApiKeyStore, FileUsageMeter, bearerToken } from './auth.js';
import { safeFetcher } from './net.js';

export const VERSION='0.6.0';
export const MCP_PROTOCOL_VERSION='2025-11-25';
const MCP_COMPATIBLE_VERSIONS=new Set(['2025-11-25','2025-03-26']);
const baseHeaders={'x-content-type-options':'nosniff','x-frame-options':'DENY','referrer-policy':'no-referrer','cache-control':'no-store'};

function send(res,status,body,headers={}){const json=JSON.stringify(body);res.writeHead(status,{'content-type':'application/json; charset=utf-8','content-length':Buffer.byteLength(json),...baseHeaders,...headers});res.end(json)}
function sendEmpty(res,status,headers={}){res.writeHead(status,{...baseHeaders,...headers});res.end()}
function rpcError(id,code,message,data){return {jsonrpc:'2.0',id:id??null,error:{code,message,...(data===undefined?{}:{data})}}}
async function readJson(req){let body='';for await(const c of req){body+=c;if(body.length>1_000_000)throw Object.assign(new Error('Request body too large'),{code:'ONCE_BAD_REQUEST'})}try{return body?JSON.parse(body):{}}catch{throw Object.assign(new Error('Invalid JSON'),{code:'ONCE_BAD_REQUEST'})}}
function limiter(limit=120){const m=new Map();return (id)=>{const now=Date.now(),minute=Math.floor(now/60000),k=`${id}:${minute}`,n=(m.get(k)||0)+1;m.set(k,n);return n<=limit}}
function originAllowed(req){const origin=req.headers.origin;if(!origin)return true;let parsed;try{parsed=new URL(origin)}catch{return false}const configured=String(process.env.ONCE_MCP_ALLOWED_ORIGINS||'').split(',').map(s=>s.trim()).filter(Boolean);if(configured.length)return configured.includes(parsed.origin);const host=String(req.headers.host||'').toLowerCase();return parsed.host.toLowerCase()===host}
function acceptsMcp(req){const accept=String(req.headers.accept||'');return accept.includes('application/json')&&accept.includes('text/event-stream')}
function validProtocolHeader(req){const v=req.headers['mcp-protocol-version'];return !v||MCP_COMPATIBLE_VERSIONS.has(String(v))}
function mcpTools(){return [
 {name:'once_demo',title:'ONCE Duplicate Suppression Demo',description:'Safely demonstrate exactly-once duplicate suppression without causing any external side effect. Call twice with the same id; the second call is suppressed.',inputSchema:{type:'object',properties:{id:{type:'string',description:'Stable demo identifier. Reuse the same value to prove duplicate suppression.'}},required:['id'],additionalProperties:false}},
 {name:'once_execute',title:'Execute Consequential Action Once',description:'Use for consequential external HTTP actions when a duplicate charge, refund, email, booking, order, ticket, webhook, resource, or record would be harmful. ONCE executes under a stable idempotency key, verifies authoritative post-state, and suppresses verified retries. Requires an ONCE API key in Authorization: Bearer or X-API-Key.',inputSchema:{type:'object',required:['idempotencyKey','action','verify'],properties:{idempotencyKey:{type:'string',description:'Stable identifier for the intended real-world action. Reuse across retries.'},action:{type:'object',required:['method','url'],properties:{method:{type:'string'},url:{type:'string'},headers:{type:'object'},body:{}},additionalProperties:true},verify:{type:'object',required:['url','path'],properties:{url:{type:'string'},path:{type:'string'},equals:{}},additionalProperties:true}},additionalProperties:false}}
]}

export function createRuntime({dataDir=process.env.ONCE_DATA_DIR,fetcher=safeFetcher()}={}){const opts=dataDir?{dataDir}:{};const store=new FileReceiptStore(opts);return {store,engine:new OnceEngine(store,fetcher),keyStore:new FileApiKeyStore(opts),meter:new FileUsageMeter(opts)}}

async function handleMcp(req,res,runtime,apiLimit){
 if(!originAllowed(req))return send(res,403,rpcError(null,-32000,'Forbidden Origin'));
 if(req.method==='GET')return sendEmpty(res,405,{'allow':'POST'});
 if(req.method==='DELETE')return sendEmpty(res,405,{'allow':'POST, GET'});
 if(req.method!=='POST')return sendEmpty(res,405,{'allow':'POST, GET'});
 if(!acceptsMcp(req))return send(res,406,rpcError(null,-32000,'MCP clients must accept both application/json and text/event-stream'));
 if(!validProtocolHeader(req))return send(res,400,rpcError(null,-32600,'Unsupported MCP-Protocol-Version',{supported:[...MCP_COMPATIBLE_VERSIONS]}));
 const b=await readJson(req);
 if(b?.jsonrpc!=='2.0'||typeof b?.method!=='string')return send(res,400,rpcError(b?.id,-32600,'Invalid Request'));
 const isNotification=b.id===undefined||b.id===null;
 if(b.method==='notifications/initialized'||b.method==='notifications/cancelled')return sendEmpty(res,202);
 if(isNotification)return sendEmpty(res,202);
 if(b.method==='initialize'){
  const requested=String(b.params?.protocolVersion||MCP_PROTOCOL_VERSION);
  const negotiated=MCP_COMPATIBLE_VERSIONS.has(requested)?requested:MCP_PROTOCOL_VERSION;
  return send(res,200,{jsonrpc:'2.0',id:b.id,result:{protocolVersion:negotiated,capabilities:{tools:{}},serverInfo:{name:'once',title:'ONCE',version:VERSION,description:'Exactly-once reliability and postcondition verification for consequential AI agent actions.',websiteUrl:'https://github.com/GSterlingPress/once-api'},instructions:'Use once_execute when retrying a consequential side effect could create a harmful duplicate. Use once_demo for a safe duplicate-suppression proof.'}});
 }
 if(b.method==='ping')return send(res,200,{jsonrpc:'2.0',id:b.id,result:{}});
 if(b.method==='tools/list')return send(res,200,{jsonrpc:'2.0',id:b.id,result:{tools:mcpTools()}});
 if(b.method==='tools/call'){
  const name=b.params?.name,args=b.params?.arguments||{};
  if(name==='once_demo'){
   const id=String(args.id||'mcp-demo'),key=`mcp:${id}`;
   const r=await runtime.store.runExclusive(key,async()=>{const old=await runtime.store.get(key);if(old?.status==='VERIFIED')return {...old,duplicateSuppressed:true};const x={receiptId:`once_${crypto.randomUUID()}`,idempotencyKey:key,status:'VERIFIED',createdAt:new Date().toISOString(),duplicateSuppressed:false};await runtime.store.put(key,x);return x});
   return send(res,200,{jsonrpc:'2.0',id:b.id,result:{content:[{type:'text',text:JSON.stringify(r)}],structuredContent:r,isError:false}});
  }
  if(name==='once_execute'){
   const token=bearerToken(req)??req.headers['x-api-key'];const key=await runtime.keyStore.authenticate(token);
   if(!key)return send(res,401,rpcError(b.id,-32001,'Valid ONCE API key required'),{'www-authenticate':'Bearer realm="ONCE"'});
   if(!apiLimit(key.id))return send(res,429,rpcError(b.id,-32002,'Rate limit exceeded'),{'retry-after':'60'});
   if(!args.idempotencyKey||!args.action?.url||!args.action?.method||!args.verify?.url||args.verify?.path===undefined)return send(res,200,{jsonrpc:'2.0',id:b.id,result:{content:[{type:'text',text:'idempotencyKey, action.method, action.url, verify.url and verify.path are required'}],isError:true}});
   await runtime.meter.reserve(key);const r=await runtime.engine.run(args);await runtime.meter.recordResult(key.id,r);
   return send(res,200,{jsonrpc:'2.0',id:b.id,result:{content:[{type:'text',text:JSON.stringify(r)}],structuredContent:r,isError:r.status!=='VERIFIED'}});
  }
  return send(res,200,rpcError(b.id,-32602,`Unknown tool: ${String(name||'')}`));
 }
 return send(res,200,rpcError(b.id,-32601,'Method not found'));
}

export function createServer({runtime=createRuntime()}={}){
 const apiLimit=limiter(Number(process.env.ONCE_RATE_LIMIT_PER_MINUTE||120)); const demoLimit=limiter(Number(process.env.ONCE_DEMO_RATE_LIMIT_PER_MINUTE||30)); const demoCounts=new Map();
 return http.createServer(async(req,res)=>{const requestId=req.headers['x-request-id']||crypto.randomUUID();res.setHeader('x-request-id',requestId);const url=new URL(req.url,'http://once.local');
  try{
   if(url.pathname==='/mcp')return await handleMcp(req,res,runtime,apiLimit);
   if(req.method==='GET'&&url.pathname==='/health')return send(res,200,{ok:true,service:'ONCE',version:VERSION});
   if(req.method==='GET'&&url.pathname==='/ready'){await runtime.store.init();return send(res,200,{ready:true,version:VERSION,durableStorage:true,mcpProtocol:MCP_PROTOCOL_VERSION});}
   if(req.method==='GET'&&url.pathname==='/version')return send(res,200,{service:'ONCE',version:VERSION,mcpProtocol:MCP_PROTOCOL_VERSION});
   if(req.method==='GET'&&url.pathname==='/')return send(res,200,{name:'ONCE',tagline:'Your agent says it worked. ONCE makes sure it actually did — once.',demo:'POST /v1/demo',api:'POST /v1/once',mcp:'POST /mcp',mcpProtocol:MCP_PROTOCOL_VERSION});
   if(req.method==='POST'&&url.pathname==='/v1/demo'){
    const ip=req.socket.remoteAddress||'unknown'; if(!demoLimit(ip))return send(res,429,{error:'Demo rate limit exceeded',code:'ONCE_RATE_LIMIT'});
    const b=await readJson(req),id=String(b.id||'demo'),key=`demo:${id}`;
    const receipt=await runtime.store.runExclusive(key,async()=>{const old=await runtime.store.get(key);if(old?.status==='VERIFIED')return {...old,duplicateSuppressed:true,demoExecutions:demoCounts.get(key)||1};const n=(demoCounts.get(key)||0)+1;demoCounts.set(key,n);const r={receiptId:`once_${crypto.randomUUID()}`,idempotencyKey:key,status:'VERIFIED',observed:'completed',expected:'completed',createdAt:new Date().toISOString(),duplicateSuppressed:false,demoExecutions:n};await runtime.store.put(key,r);return r});return send(res,200,receipt);
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
