import {test} from 'node:test';
import assert from 'node:assert/strict';
import {agents,runAgents,defaultTools,permissions,type AgentName,type ToolContext} from '../src/ai-agents.js';
import {defaults,type AIMessage,type AITransport} from '../src/ai.js';
const context:ToolContext={account:'tenant-a',session:'shop',customer:'628123456789',requestId:'message-1',knowledge:'Bisnis A buka jam 9',behavior:'Ramah'};
const messages:AIMessage[]=[{role:'system',content:'Bisnis A'},{role:'user',content:'Saya mencari frame ringan'},{role:'assistant',content:'Frame Basic tersedia'},{role:'user',content:'Saya ingin memesan itu'}];
const route=(agent:AgentName,input=messages.at(-1)!.content)=>JSON.stringify({sub_agent:agent,s_p_o_konteks:'Pelanggan memesan frame',isi_pesan:input});
test('All eight specialists and router receive shared history and client behavior',async()=>{
 for(const agent of Object.keys(agents) as AgentName[]){
  let calls=0;
  const result=await runAgents(async(_c,m)=>{
   if(calls++===0){assert.deepEqual(m.slice(1),messages.filter(x=>x.role!=='system'));assert.ok(m[0].content.includes(context.behavior!));return route(agent);}
   assert.deepEqual(m.slice(0,messages.length),messages);assert.ok(m.at(-1)!.content.startsWith(agents[agent]));return JSON.stringify({answer:'Baik, saya bantu.'});
  },defaults,messages,300,context);
  assert.equal(result.agent,agent);assert.equal(result.answer,'Baik, saya bantu.');assert.equal(calls,2);
 }
 assert.equal(messages.length,4);
});
test('Tool loop passes trusted scope, shares results, and deduplicates identical calls',async()=>{
 let calls=0,executions=0;
 const result=await runAgents(async(_c,m)=>{
  calls++;if(calls===1)return route('transaksi');
  if(calls<=3)return JSON.stringify({tool:'create_order',query:'Frame Basic untuk pelanggan'});
  assert.equal(m.filter(x=>x.content.includes('Tool result create_order')).length,2);
  return JSON.stringify({answer:'Pesanan simulasi dibuat.'});
 },defaults,messages,300,context,{async execute(name,query,scope){executions++;assert.equal(name,'create_order');assert.equal(query,'Frame Basic untuk pelanggan');assert.deepEqual(scope,context);assert.equal(Object.isFrozen(scope),true);return {order_id:'SIM-test',simulasi:true};}});
 assert.equal(executions,1);assert.equal(result.agent,'transaksi');
});
test('Invalid routes cannot dispatch agents or tools',async()=>{
 for(const raw of ['not JSON',route('informasi','changed input'),JSON.stringify({sub_agent:'unknown',s_p_o_konteks:'S P O',isi_pesan:messages.at(-1)!.content}),JSON.stringify({sub_agent:'informasi',s_p_o_konteks:'too short',isi_pesan:messages.at(-1)!.content})]){
  let calls=0;await assert.rejects(runAgents(async()=>{calls++;return raw;},defaults,messages,300,context));assert.equal(calls,1);
 }
});
test('Tool permissions and strict arguments reject attempts to change tenant identity',async()=>{
 for(const agent of Object.keys(agents) as AgentName[]){
  for(const tool of ['get_knowledge','get_products','check_order','create_order'] as const){
   if(permissions[agent].includes(tool))continue;
   let calls=0;await assert.rejects(runAgents(async()=>++calls===1?route(agent):JSON.stringify({tool,query:'x'}),defaults,messages,300,context,{execute:async()=>{assert.fail('Forbidden tool executed');}}),/ai_invalid_tool/);
  }
 }
 let calls=0;await assert.rejects(runAgents(async()=>++calls===1?route('transaksi'):JSON.stringify({tool:'check_order',query:'ORD-1',account:'tenant-b'}),defaults,messages,300,context),/ai_invalid_tool/);
});
test('Tool errors, oversized results and endless loops fail with bounded execution',async()=>{
 const call=():AITransport=>{let n=0;return async()=>++n===1?route('transaksi'):JSON.stringify({tool:'get_products',query:String(n)});};
 await assert.rejects(runAgents(call(),defaults,messages,300,context,{async execute(){throw Error('adapter_failed');}}),/adapter_failed/);
 await assert.rejects(runAgents(call(),defaults,messages,300,context,{async execute(){return 'x'.repeat(16001);}}),/ai_tool_result_limit/);
 let executions=0;await assert.rejects(runAgents(call(),defaults,messages,300,context,{async execute(){executions++;return [];}}),/ai_invalid_tool/);assert.equal(executions,4);
});
test('Knowledge comes directly from the client',async()=>{
 assert.deepEqual(await defaultTools.execute('get_knowledge','',context),{knowledge:context.knowledge});
 assert.deepEqual(await defaultTools.execute('get_knowledge','',{...context,account:'tenant-b',knowledge:'Bisnis B'}),{knowledge:'Bisnis B'});
});

test('A specialist can correct invalid order input without repeating a successful mutation',async()=>{
 const {ApiError}=await import('../src/engine/sessions.js');let calls=0,mutations=0;
 const result=await runAgents(async()=>{
  calls++;if(calls===1)return route('transaksi');
  if(calls<=4)return JSON.stringify({tool:'create_order',query:calls===2?'invalid':calls===3?'corrected':'different'});
  return JSON.stringify({answer:'Pesanan tercatat'});
 },defaults,messages,300,context,{async execute(_name,query){if(query==='invalid')throw new ApiError(400,'invalid_request','Pilih produk dahulu');mutations++;return {order:{id:'ORD-1'}};}});
 assert.equal(result.answer,'Pesanan tercatat');assert.equal(mutations,1);
});
