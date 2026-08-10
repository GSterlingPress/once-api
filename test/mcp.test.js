import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRuntime, createServer, MCP_PROTOCOL_VERSION, VERSION } from '../src/server.js';
import { FileApiKeyStore } from '../src/auth.js';

async function withServer(fn){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'once-mcp-'));
 const runtime=createRuntime({dataDir:dir,fetcher:async()=>new Response(JSON.stringify({status:'done'}),{status:200,headers:{'content-type':'application/json'}})});
 const server=createServer({runtime});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{await fn(`http://127.0.0.1:${server.address().port}`,dir)}finally{await new Promise(r=>server.close(r));await fs.rm(dir,{recursive:true,force:true})}
}
const h={'content-type':'application/json','accept':'application/json, text/event-stream'};
const post=(base,body,headers={})=>fetch(base+'/mcp',{method:'POST',headers:{...h,...headers},body:JSON.stringify(body)});

test('MCP initialize negotiates protocol and declares tools',()=>withServer(async base=>{
 const r=await post(base,{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:MCP_PROTOCOL_VERSION,capabilities:{},clientInfo:{name:'test',version:'1'}}});
 assert.equal(r.status,200);const j=await r.json();assert.equal(j.result.protocolVersion,MCP_PROTOCOL_VERSION);assert.equal(j.result.serverInfo.version,VERSION);assert.deepEqual(j.result.capabilities,{tools:{}});
}));

test('MCP initialized notification returns 202 with empty body and ping works',()=>withServer(async base=>{
 let r=await post(base,{jsonrpc:'2.0',method:'notifications/initialized'});assert.equal(r.status,202);assert.equal(await r.text(),'');
 r=await post(base,{jsonrpc:'2.0',id:2,method:'ping',params:{}},{'mcp-protocol-version':MCP_PROTOCOL_VERSION});assert.equal(r.status,200);assert.deepEqual((await r.json()).result,{});
}));

test('MCP GET returns valid 405 when server does not offer SSE stream',()=>withServer(async base=>{
 const r=await fetch(base+'/mcp',{headers:{accept:'text/event-stream'}});assert.equal(r.status,405);assert.match(r.headers.get('allow'),/POST/);
}));

test('MCP rejects invalid Origin',()=>withServer(async base=>{
 const r=await post(base,{jsonrpc:'2.0',id:1,method:'ping'},{origin:'https://evil.example'});assert.equal(r.status,403);
}));

test('MCP rejects incomplete Accept header',()=>withServer(async base=>{
 const r=await fetch(base+'/mcp',{method:'POST',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'ping'})});assert.equal(r.status,406);
}));

test('MCP tools/list is deterministic and once_demo suppresses duplicate',()=>withServer(async base=>{
 let r=await post(base,{jsonrpc:'2.0',id:3,method:'tools/list',params:{}},{'mcp-protocol-version':MCP_PROTOCOL_VERSION});let j=await r.json();assert.deepEqual(j.result.tools.map(x=>x.name),['once_demo','once_execute']);
 const body={jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'once_demo',arguments:{id:'same'}}};r=await post(base,body);const first=await r.json();r=await post(base,{...body,id:5});const second=await r.json();assert.equal(first.result.structuredContent.duplicateSuppressed,false);assert.equal(second.result.structuredContent.duplicateSuppressed,true);
}));

test('MCP once_execute requires key and works with authenticated key',()=>withServer(async(base,dir)=>{
 const args={idempotencyKey:'mcp-action-1',action:{method:'POST',url:'https://example.com/action'},verify:{url:'https://example.com/status',path:'status',equals:'done'}};
 let r=await post(base,{jsonrpc:'2.0',id:6,method:'tools/call',params:{name:'once_execute',arguments:args}});assert.equal(r.status,401);
 const issued=await new FileApiKeyStore({dataDir:dir}).issue({name:'mcp-test',monthlyQuota:10});
 r=await post(base,{jsonrpc:'2.0',id:7,method:'tools/call',params:{name:'once_execute',arguments:args}},{authorization:`Bearer ${issued.apiKey}`});assert.equal(r.status,200);const j=await r.json();assert.equal(j.result.structuredContent.status,'VERIFIED');
}));
