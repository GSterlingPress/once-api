import crypto from 'node:crypto';
const MAX_EVENTS=5000;
const TEST_RE=/(github-actions|registry-check|curl|railway|healthcheck)/i;
function day(ts){return new Date(ts).toISOString().slice(0,10)}
function hash(value){return crypto.createHash('sha256').update(String(value||'unknown')).digest('hex').slice(0,12)}
function source(req){const explicit=String(req.headers['x-once-source']||'').trim();if(explicit)return explicit.slice(0,64);const ua=String(req.headers['user-agent']||'');if(/modelcontextprotocol|mcp/i.test(ua))return 'mcp-client';return 'direct'}
function internal(req){const ua=String(req.headers['user-agent']||'');return String(req.headers['x-once-internal']||'')==='1'||TEST_RE.test(ua)}
export class ActivityStore{
 constructor(){this.events=[]}
 record(req,{kind,status=200,result=null}={}){const ip=String(req.headers['x-forwarded-for']||'').split(',')[0].trim()||req.socket?.remoteAddress||req.headers['user-agent'];const e={id:crypto.randomUUID(),at:new Date().toISOString(),kind,status,result,source:source(req),caller:hash(ip),external:!internal(req)};this.events.unshift(e);if(this.events.length>MAX_EVENTS)this.events.length=MAX_EVENTS;return e}
 snapshot(){const today=day(Date.now()),external=this.events.filter(e=>e.external),todays=external.filter(e=>e.at.slice(0,10)===today);return {service:'ONCE',generatedAt:new Date().toISOString(),external:{callsToday:todays.length,uniqueCallersToday:new Set(todays.map(e=>e.caller)).size,mcpCallsToday:todays.filter(e=>e.kind==='mcp').length,apiCallsToday:todays.filter(e=>e.kind==='once').length,demoCallsToday:todays.filter(e=>e.kind==='demo').length,trialKeysToday:todays.filter(e=>e.kind==='trial').length,lastCall:external[0]?.at||null},all:{callsToday:this.events.filter(e=>e.at.slice(0,10)===today).length},feed:external.slice(0,50)}}
}
