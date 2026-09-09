import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const MAX_EVENTS=5000;
const TEST_RE=/(github-actions|registry-check|curl|railway|healthcheck|uptime|monitor|probe|statuscake|pingdom|better uptime|betteruptime)/i;
const KNOWN_VALIDATOR_RE=/(smithery|glama|pulsemcp|pulse-mcp|mcp[- ]?registry|registry\.modelcontextprotocol|modelcontextprotocol.*registry|verifymcp|mcp-verifier)/i;
const INTERACTIVE_CLIENT_RE=/(claude|cursor|windsurf|vscode|visual studio code|chatgpt|openai|cline|roo|zed)/i;
const DISCOVERY_METHODS=new Set(['initialize','notifications/initialized','tools/list','ping','resources/list','resources/templates/list','prompts/list','completion/complete','logging/setLevel']);
const CORE_METHODS=new Set(['tools/call:once_execute','POST /v1/once']);
const EASTERN_TZ='America/New_York';

function day(ts){return new Date(ts).toISOString().slice(0,10)}
function safe(v,max=256){const s=String(v||'').trim();return s?s.slice(0,max):null}
function dataDir(){return process.env.ONCE_DATA_DIR??(process.env.RAILWAY_ENVIRONMENT?'/data':null)}
function hmac(secret,value){return crypto.createHmac('sha256',secret).update(String(value||'unknown')).digest('hex').slice(0,16)}
function eastern(ts){return new Intl.DateTimeFormat('en-US',{timeZone:EASTERN_TZ,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',timeZoneName:'short'}).format(new Date(ts))}
function source(req){const explicit=safe(req.headers['x-once-source'],64);if(explicit)return explicit;const ua=String(req.headers['user-agent']||'');if(/modelcontextprotocol|mcp/i.test(ua))return 'mcp-client';if(req.headers.referer||req.headers.referrer)return 'referred';return 'direct'}
function botOrMonitor(req){const text=[req.headers['user-agent'],req.headers.via,req.headers['x-requested-with'],req.headers.referer,req.headers.referrer].filter(Boolean).join(' ');return String(req.headers['x-once-internal']||'')==='1'||TEST_RE.test(text)}
function validatorEvidence(e){return [e.audit?.userAgent,e.audit?.clientInfo?.name,e.audit?.clientInfo?.version,e.audit?.origin,e.audit?.referrer,e.audit?.via,e.source].filter(Boolean).join(' ')}
function methodToken(kind,result,req){if(kind==='mcp')return String(result||'mcp');if(kind==='once')return 'POST /v1/once';if(kind==='demo')return 'POST /v1/demo';if(kind==='trial')return 'POST /v1/trial';return `${String(req?.method||'').toUpperCase()} ${String(req?.url||'')}`.trim()}
function bucket(e){if(!e.external)return 'controlled';if(e.botMonitor)return 'monitoring';if(KNOWN_VALIDATOR_RE.test(validatorEvidence(e)))return 'validator';if(e.kind==='mcp'&&DISCOVERY_METHODS.has(String(e.result||'')))return 'discovery';if(CORE_METHODS.has(e.method))return 'core';if(e.kind==='demo'||e.kind==='trial')return 'evaluation';return 'other'}
function classify(e){
 if(!e.external)return {classification:'CONTROLLED_TEST',reasons:['internal/test marker']};
 if(e.botMonitor)return {classification:'BOT_OR_MONITOR',reasons:['bot/monitor fingerprint']};
 if(KNOWN_VALIDATOR_RE.test(validatorEvidence(e)))return {classification:'KNOWN_VALIDATOR',reasons:['known registry/directory/validator evidence']};
 if(e.trafficClass==='discovery')return {classification:'DISCOVERY_ONLY',reasons:['MCP discovery/control method only']};
 if(e.kind==='demo'||e.kind==='trial')return {classification:'CONTROLLED_TEST',reasons:['demo/trial path does not count as stranger production use']};
 if(e.kind==='mcp'&&e.result==='tools/call:once_execute'){
   const client=e.audit?.clientInfo?.name||'';
   if(INTERACTIVE_CLIENT_RE.test(client))return {classification:'PROBABLE_REAL_USE',reasons:[`interactive MCP client: ${client}`,'pre-auth core-tool attempt is not sufficient for verified stranger']};
   return {classification:'UNKNOWN_MACHINE',reasons:['pre-auth core ONCE tool attempt observed','insufficient evidence to prove successful genuine stranger use']};
 }
 if(e.kind==='once'){
   const explicit=safe(e.audit?.sourceHeader,64);
   const referred=Boolean(e.audit?.referrer||e.audit?.origin);
   if(explicit&&explicit.toLowerCase()!=='internal')return {classification:'CREDIBLE_REAL_USE',reasons:[`explicit external source attribution: ${explicit}`,'authenticated core ONCE execution']};
   if(referred)return {classification:'PROBABLE_REAL_USE',reasons:['authenticated core ONCE execution','external referral/origin present but not sufficient for verified stranger']};
   return {classification:'UNKNOWN_MACHINE',reasons:['authenticated core ONCE execution','authentication proves use, not stranger identity']};
 }
 if(e.trafficClass==='core')return {classification:'UNKNOWN_MACHINE',reasons:['core operation observed','insufficient evidence to prove genuine stranger']};
 return {classification:null,reasons:[]};
}
function atomicWrite(file,data){const tmp=`${file}.${process.pid}.tmp`;fs.writeFileSync(tmp,JSON.stringify(data),{mode:0o600});fs.renameSync(tmp,file)}
function countBy(events,key){const m=new Map();for(const e of events){const k=e[key]||'unknown';m.set(k,(m.get(k)||0)+1)}return [...m.entries()].map(([name,calls])=>({name,calls})).sort((a,b)=>b.calls-a.calls||a.name.localeCompare(b.name))}

export class ActivityStore{
 constructor({dataDir:dir=dataDir(),callerSecret=null}={}){this.dataDir=dir;this.file=dir?path.join(dir,'once-activity.json'):null;this.secretFile=dir?path.join(dir,'once-caller-hmac-secret'):null;this.events=[];this.clientInfo=new Map();this.secret=callerSecret||process.env.ONCE_CALLER_HMAC_SECRET||null;if(this.file)this.load();if(!this.secret)this.secret=this.loadOrCreateSecret()}
 loadOrCreateSecret(){if(!this.secretFile)return crypto.randomBytes(32).toString('hex');try{fs.mkdirSync(this.dataDir,{recursive:true});try{return fs.readFileSync(this.secretFile,'utf8').trim()}catch(e){if(e?.code!=='ENOENT')throw e}const x=crypto.randomBytes(32).toString('hex');fs.writeFileSync(this.secretFile,x,{mode:0o600});return x}catch{return crypto.randomBytes(32).toString('hex')}}
 load(){try{const d=JSON.parse(fs.readFileSync(this.file,'utf8'));this.events=Array.isArray(d.events)?d.events.slice(0,MAX_EVENTS):[];this.clientInfo=new Map(Array.isArray(d.clientInfo)?d.clientInfo:[])}catch(e){if(e?.code!=='ENOENT')console.error('ONCE activity load failed',e?.message)}}
 persist(){if(!this.file)return;try{fs.mkdirSync(this.dataDir,{recursive:true});atomicWrite(this.file,{version:3,events:this.events,clientInfo:[...this.clientInfo]})}catch(e){console.error('ONCE activity persist failed',e?.message)}}
 caller(req){const explicit=safe(req.headers['mcp-session-id']||req.headers['x-once-caller-id']||req.headers['x-client-id'],256);if(explicit)return hmac(this.secret,`client:${explicit}`);const ip=String(req.headers['x-forwarded-for']||'').split(',')[0].trim()||req.socket?.remoteAddress||'';return hmac(this.secret,[ip,req.headers['user-agent']||'',req.headers['accept-language']||''].join('|'))}
 record(req,{kind,status=200,result=null,clientInfo=null}={}){const caller=this.caller(req);if(clientInfo?.name)this.clientInfo.set(caller,{name:safe(clientInfo.name,80),version:safe(clientInfo.version,40)});const e={id:crypto.randomUUID(),at:new Date().toISOString(),kind,status,result,method:methodToken(kind,result,req),source:source(req),channel:kind==='mcp'?'mcp':'rest',caller,external:!String(req.headers['x-once-internal']||'').includes('1'),botMonitor:botOrMonitor(req),auditVersion:3,audit:{userAgent:safe(req.headers['user-agent'],512),acceptLanguage:safe(req.headers['accept-language'],128),origin:safe(req.headers.origin,256),referrer:safe(req.headers.referer||req.headers.referrer,256),via:safe(req.headers.via,128),forwardedHost:safe(req.headers['x-forwarded-host'],128),requestMethod:safe(req.method,16),requestPath:safe(req.url,128),sourceHeader:safe(req.headers['x-once-source'],64),clientInfo:this.clientInfo.get(caller)||null}};e.trafficClass=bucket(e);const c=classify(e);e.classification=c.classification;e.classificationReasons=c.reasons;e.verifiedStranger=e.classification==='CREDIBLE_REAL_USE';this.events.unshift(e);if(this.events.length>MAX_EVENTS)this.events.length=MAX_EVENTS;this.persist();return e}
 snapshot(){const now=new Date().toISOString(),today=day(now),external=this.events.filter(e=>e.external),todays=external.filter(e=>e.at.slice(0,10)===today),credible=external.filter(e=>e.classification==='CREDIBLE_REAL_USE'),core=todays.filter(e=>e.trafficClass==='core'),discovery=todays.filter(e=>e.trafficClass==='discovery'),monitoring=todays.filter(e=>e.trafficClass==='monitoring'),validators=todays.filter(e=>e.trafficClass==='validator'),evaluation=todays.filter(e=>e.trafficClass==='evaluation');return {service:'ONCE',generatedAt:now,displayTimeZone:EASTERN_TZ,generatedAtEastern:eastern(now),headline:{verifiedStrangers:new Set(credible.map(e=>e.caller)).size,coreToolCallsToday:core.length,discoveryCallsToday:discovery.length,monitoringCallsToday:monitoring.length,validatorCallsToday:validators.length,evaluationCallsToday:evaluation.length},external:{callsToday:todays.length,uniqueCallersToday:new Set(todays.map(e=>e.caller)).size,lastCall:external[0]?.at||null,lastCallEastern:external[0]?.at?eastern(external[0].at):null},traffic:{toolMethodCountsToday:countBy(todays,'method'),classesToday:countBy(todays,'trafficClass')},realUse:{verifiedStrangers:new Set(credible.map(e=>e.caller)).size,credibleCalls:credible.length,probableCalls:external.filter(e=>e.classification==='PROBABLE_REAL_USE').length,unknownCoreCalls:external.filter(e=>e.classification==='UNKNOWN_MACHINE'&&e.trafficClass==='core').length},verificationPolicy:{version:3,rule:'Fail closed. Discovery, monitoring, validators, demos, trials, pre-auth MCP tool attempts, authenticated-but-unattributed traffic, and unknown machine traffic never count as adoption. Only affirmative CREDIBLE_REAL_USE evidence advances verified strangers.',classes:['DISCOVERY_ONLY','BOT_OR_MONITOR','KNOWN_VALIDATOR','CONTROLLED_TEST','UNKNOWN_MACHINE','PROBABLE_REAL_USE','CREDIBLE_REAL_USE']},privacy:{rawIpStored:false,requestPayloadStored:false,credentialsStored:false,pseudonymousCallerIds:true,durableActivityStorage:Boolean(this.file)},all:{callsToday:this.events.filter(e=>e.at.slice(0,10)===today).length},feed:external.slice(0,100)}}
}
