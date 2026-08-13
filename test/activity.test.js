import test from 'node:test';
import assert from 'node:assert/strict';
import {ActivityStore} from '../src/activity.js';
function req({ua='mcp-client',ip='203.0.113.1'}={}){return{method:'POST',url:'/mcp',headers:{'user-agent':ua,'x-forwarded-for':ip},socket:{remoteAddress:ip}}}
test('MCP demo invocation does not count as verified stranger',()=>{const a=new ActivityStore();const r=req();a.record(r,{kind:'mcp',result:'tools/call:once_demo'});const s=a.snapshot();assert.equal(s.realUse.verifiedStrangers,0);assert.equal(s.feed[0].classification,'UNKNOWN_MACHINE')});
test('interactive MCP once_execute counts as credible real use',()=>{const a=new ActivityStore();const r=req({ua:'modelcontextprotocol-client'});a.record(r,{kind:'mcp',result:'initialize',clientInfo:{name:'Claude Desktop',version:'1.0'}});a.record(r,{kind:'mcp',result:'tools/call:once_execute'});const s=a.snapshot();assert.equal(s.realUse.verifiedStrangers,1);assert.equal(s.feed[0].classification,'CREDIBLE_REAL_USE')});
test('known validator never counts as stranger',()=>{const a=new ActivityStore();const r=req({ua:'Smithery MCP validator'});a.record(r,{kind:'mcp',result:'tools/call:once_execute'});const s=a.snapshot();assert.equal(s.realUse.verifiedStrangers,0);assert.equal(s.feed[0].classification,'KNOWN_VALIDATOR')});
test('authenticated production API call is credible real use',()=>{const a=new ActivityStore();const r=req({ua:'production-agent'});a.record(r,{kind:'once',result:'VERIFIED'});assert.equal(a.snapshot().realUse.verifiedStrangers,1)});
