import {test} from 'node:test';
import assert from 'node:assert/strict';
import {agents,runAgents,updateRouterContext,defaultTools,permissions,type AgentName,type ToolContext} from '../src/ai-agents.js';
import {defaults,type AIMessage,type AITransport} from '../src/ai.js';
const context:ToolContext={account:'tenant-a',session:'shop',customer:'628123456789',requestId:'message-1',knowledge:'Bisnis A buka jam 9',behavior:'Ramah'};
const messages:AIMessage[]=[{role:'system',content:'Bisnis A'},{role:'user',content:'Saya mencari frame ringan'},{role:'assistant',content:'Frame Basic tersedia'},{role:'user',content:'Saya ingin memesan itu'}];
const route=(agent:AgentName,input=messages.at(-1)!.content)=>JSON.stringify({sub_agent:agent,s_p_o_konteks:'Pelanggan memesan frame',isi_pesan:input});
// Reply of the Pesanan node and the JSON create_order then receives.
const frameOrder={items:[{product_name:'Frame Basic',quantity:1}],notes:''};
const pesanan=(order:object|null=frameOrder)=>JSON.stringify(order?{lengkap:true,...order}:{lengkap:false,items:[],notes:''});
const catalog={products:[{name:'Frame Basic'},{name:'Frame Pro'}]};
test('Router selects pending tickets and only selected questions reach the specialist',async()=>{
 const pendingFallbacks=[{id:'FB-A',question:'Persetujuan diskon khusus'},{id:'FB-B',question:'Penggantian bingkai rusak'}];
 for(const selected of [[],['FB-A']]){
  await runAgents(async(c,m)=>{
   if(c.call_role==='router'){
    assert.ok(m[1].content.includes('FB-A'));assert.ok(m[1].content.includes('FB-B'));
    return JSON.stringify({...JSON.parse(route('profil_perusahaan')),fallback_terkait:selected});
   }
   const prompt=m.map(x=>x.content).join('\n');
   assert.equal(prompt.includes('Persetujuan diskon khusus'),selected.length>0);
   assert.equal(prompt.includes('Penggantian bingkai rusak'),false);
   return JSON.stringify({answer:'Baik'});
  },defaults,messages,300,{...context,pendingFallbacks});
 }
});
test('Router cannot reference unavailable tickets, duplicate IDs, or omit selection with pending tickets',async()=>{
 for(const selected of [['FB-OTHER'],['FB-A','FB-A'],'FB-A',undefined]){
  let calls=0;
  await assert.rejects(runAgents(async(c)=>{
   assert.equal(c.call_role,'router');calls++;
   return JSON.stringify({...JSON.parse(route('profil_perusahaan')),fallback_terkait:selected});
  },defaults,messages,300,{...context,pendingFallbacks:[{id:'FB-A',question:'Diskon'}]}),/ai_invalid_route/);
  assert.equal(calls,2);
 }
});
test('Specialists receive shared history while router receives only latest input and separate context',async()=>{
 for(const agent of Object.keys(agents) as AgentName[]){
  let calls=0;
  const result=await runAgents(async(_c,m)=>{
   if(calls++===0){assert.deepEqual(m.slice(1),[{role:'user',content:'Konteks S-P-O sebelumnya: null'},messages.at(-1)]);assert.ok(m[0].content.includes(context.behavior!));return route(agent);}
   assert.deepEqual(m.slice(0,messages.length),messages);assert.ok(m.at(-1)!.content.startsWith(agents[agent]));return JSON.stringify({answer:'Baik, saya bantu.'});
  },defaults,messages,300,context);
  assert.equal(result.agent,agent);assert.equal(result.answer,'Baik, saya bantu.');assert.equal(calls,2);
 }
 assert.equal(messages.length,4);
});
test('Tool loop passes trusted scope, shares results, and deduplicates identical calls',async()=>{
 let calls=0,executions=0,nodeCalls=0;
 const result=await runAgents(async(c,m)=>{
  if(c.call_role==='pesanan'){nodeCalls++;assert.deepEqual(JSON.parse(m[1].content),{permintaan:'Frame Basic untuk pelanggan',produk:['Frame Basic','Frame Pro']});return pesanan();}
  calls++;if(calls===1)return route('layanan');
  if(calls<=3)return JSON.stringify({tool:'create_order',query:'Frame Basic untuk pelanggan'});
  assert.equal(m.filter(x=>x.content.includes('Tool result create_order')).length,2);
  return JSON.stringify({answer:'Pesanan simulasi dibuat.'});
 },defaults,messages,300,context,{async execute(name,query,scope){assert.deepEqual(scope,context);assert.equal(Object.isFrozen(scope),true);if(name==='get_products')return catalog;executions++;assert.equal(name,'create_order');assert.deepEqual(JSON.parse(query),frameOrder);return {order_id:'SIM-test',simulasi:true};}});
 assert.equal(executions,1);assert.equal(nodeCalls,1);assert.equal(result.agent,'layanan');
});
test('Invalid routes cannot dispatch agents or tools',async()=>{
 for(const raw of ['not JSON',route('profil_perusahaan','changed input'),JSON.stringify({sub_agent:'unknown',s_p_o_konteks:'S P O',isi_pesan:messages.at(-1)!.content}),JSON.stringify({sub_agent:'profil_perusahaan',s_p_o_konteks:'   ',isi_pesan:messages.at(-1)!.content})]){
  let calls=0;await assert.rejects(runAgents(async()=>{calls++;return raw;},defaults,messages,300,context));assert.equal(calls,2);
 }
});
test('Tool permissions and strict arguments reject attempts to change tenant identity',async()=>{
 for(const agent of Object.keys(agents) as AgentName[]){
  for(const tool of ['get_knowledge','get_products','check_order','create_order'] as const){
   if(permissions[agent].includes(tool))continue;
   let calls=0;await assert.rejects(runAgents(async()=>++calls===1?route(agent):JSON.stringify({tool,query:'x'}),defaults,messages,300,context,{execute:async()=>{assert.fail('Forbidden tool executed');}}),/ai_invalid_tool/);
  }
 }
 let calls=0;await assert.rejects(runAgents(async()=>++calls===1?route('layanan'):JSON.stringify({tool:'check_order',query:'ORD-1',account:'tenant-b'}),defaults,messages,300,context),/ai_invalid_tool/);
});
test('Tool errors, oversized results and endless loops fail with bounded execution',async()=>{
 const call=():AITransport=>{let n=0;return async()=>++n===1?route('layanan'):JSON.stringify({tool:'get_products',query:String(n)});};
 await assert.rejects(runAgents(call(),defaults,messages,300,context,{async execute(){throw Error('adapter_failed');}}),/adapter_failed/);
 await assert.rejects(runAgents(call(),defaults,messages,300,context,{async execute(){return 'x'.repeat(16001);}}),/ai_tool_result_limit/);
 let executions=0;await assert.rejects(runAgents(call(),defaults,messages,300,context,{async execute(){executions++;return [];}}),/ai_invalid_tool/);assert.equal(executions,4);
});
test('Knowledge comes directly from the client',async()=>{
 assert.deepEqual(await defaultTools.execute('get_knowledge','',context),{knowledge:context.knowledge});
 assert.deepEqual(await defaultTools.execute('get_knowledge','',{...context,account:'tenant-b',knowledge:'Bisnis B'}),{knowledge:'Bisnis B'});
});

test('Agent Lainnya can read knowledge, products, and order status without creating orders',async()=>{
 assert.deepEqual(permissions.lainnya,['get_knowledge','get_products','check_order']);
 let calls=0;const tools:string[]=[];
 const result=await runAgents(async(c)=>{
  if(c.call_role==='router')return route('lainnya');
  if(calls++===0)return JSON.stringify({tool:'get_products',query:'produk termurah'});
  return JSON.stringify({answer:'Produk yang tersedia sudah saya tampilkan.'});
 },defaults,messages,300,context,{async execute(name){tools.push(name);return [];}});
 assert.equal(result.agent,'lainnya');assert.deepEqual(tools,['get_products']);
});

test('A specialist can correct invalid order input without repeating a successful mutation',async()=>{
 const {ApiError}=await import('../src/engine/sessions.js');let calls=0,mutations=0;
 const result=await runAgents(async(c,m)=>{
  if(c.call_role==='pesanan')return JSON.parse(m[1].content).permintaan==='unclear'?pesanan(null):JSON.parse(m[1].content).permintaan==='rejected'?pesanan({items:[{product_name:'Frame Pro',quantity:1}],notes:''}):pesanan();
  calls++;if(calls===1)return route('layanan');
  if(calls===2)return JSON.stringify({tool:'create_order',query:'unclear'});
  if(calls===3){assert.ok(m.at(-1)!.content.includes('order_unclear'));return JSON.stringify({tool:'create_order',query:'rejected'});}
  if(calls===4){assert.ok(m.at(-1)!.content.includes('Pilih produk dahulu'));return JSON.stringify({tool:'create_order',query:'corrected'});}
  if(calls===5)return JSON.stringify({tool:'create_order',query:'different'});
  return JSON.stringify({answer:'Pesanan tercatat'});
 },defaults,messages,300,context,{async execute(name,query){if(name==='get_products')return catalog;if(JSON.parse(query).items[0].product_name==='Frame Pro')throw new ApiError(400,'invalid_request','Pilih produk dahulu');mutations++;return {order:{id:'ORD-1'}};}});
 assert.equal(result.answer,'Pesanan tercatat');assert.equal(mutations,1);
});

test('Short replies and topic changes are routed with previous SPO, without old chat history',async()=>{
 for(const input of ['ya','yang itu','cukup','Saya ingin komplain']){
  let calls=0;
  await runAgents(async(_c,m)=>{
   if(calls++===0){assert.equal(m.length,3);assert.equal(m[1].content,'Konteks S-P-O sebelumnya: "pelanggan-mengonfirmasi-pesanan"');assert.equal(m[2].content,input);return route('layanan',input);}
   return JSON.stringify({answer:'Baik'});
  },defaults,[...messages,{role:'user',content:input}],300,context,defaultTools,'pelanggan-mengonfirmasi-pesanan');
 }
});
test('Context Agent summarizes latest exchange and strictly validates SPO',async()=>{
 const result=await updateRouterContext(async(_c,m)=>{assert.equal(m.length,2);assert.deepEqual(JSON.parse(m[1].content),{riwayat_sebelumnya:[],pesan_pelanggan:'ya',jawaban_agent:'Berapa jumlah pesanan?'});return 'pelanggan-menentukan-jumlah';},defaults,'ya','Berapa jumlah pesanan?');
 assert.equal(result,'pelanggan-menentukan-jumlah');
 for(const raw of ['', 'pelanggan memesan barang','a-b-c\npenjelasan','a-b','{"context":"a-b-c"}','a-'.repeat(101)+'b'])await assert.rejects(updateRouterContext(async()=>raw,defaults,'ya','Baik'),/ai_invalid_context/);
});

test('Three model tiers select by role across routing, specialist tools and context',async()=>{
 const config={...defaults,model_cheap:'cheap-test',model_medium:'medium-test',model_smart:'smart-test'};
 for(const agent of Object.keys(agents) as AgentName[]){
  const selected:{model:string;role:string|undefined}[]=[];let calls=0;
  const transport:AITransport=async(c)=>{selected.push({model:c.model,role:c.call_role});if(c.call_role==='context')return 'pelanggan-menunggu-layanan';if(calls++===0)return route(agent);if(agent==='layanan'&&calls===2)return JSON.stringify({tool:'get_products',query:''});return JSON.stringify({answer:'Baik'});};
  await runAgents(transport,config,messages,300,context,{execute:async()=>[]});
  await updateRouterContext(transport,config,'ya','Baik');
  assert.deepEqual(selected[0],{model:'cheap-test',role:'router'});
  assert.deepEqual(selected.at(-1),{model:'cheap-test',role:'context'});
  const expected=agent==='lainnya'?'smart-test':['pembuka','penutup'].includes(agent)?'cheap-test':'medium-test';
  assert.ok(selected.slice(1,-1).every(c=>c.model===expected&&c.role===agent));
 }
});

test('Invalid router and specialist output is repaired once without replaying a successful order',async()=>{
 let routerCalls=0,specialistCalls=0,mutations=0;
 const result=await runAgents(async(c,m)=>{
  if(c.call_role==='router'){if(routerCalls++===0)return 'invalid';assert.ok(m.at(-1)!.content.includes('Output sebelumnya'));return route('layanan');}
  if(c.call_role==='pesanan')return pesanan();
  specialistCalls++;
  if(specialistCalls===1)return JSON.stringify({tool:'create_order',query:'one'});
  if(specialistCalls===2)return '{broken';
  assert.ok(m.some(x=>x.content.includes('ORD-1')));assert.ok(m.at(-1)!.content.includes('Output sebelumnya'));
  return JSON.stringify({answer:'Pesanan tercatat'});
 },defaults,messages,300,context,{execute:async name=>{if(name==='get_products')return catalog;mutations++;return {id:'ORD-1'};}});
 assert.equal(result.answer,'Pesanan tercatat');assert.equal(routerCalls,2);assert.equal(specialistCalls,3);assert.equal(mutations,1);
});

test('Context repair retains the customer exchange and stops after one correction',async()=>{
 let calls=0;
 const result=await updateRouterContext(async(_c,m)=>{calls++;if(calls===1)return 'invalid';assert.equal(JSON.parse(m[1].content).pesan_pelanggan,'ya');return 'pelanggan-menunggu-pesanan';},defaults,'ya','Baik');
 assert.equal(calls,2);assert.equal(result,'pelanggan-menunggu-pesanan');
 calls=0;await assert.rejects(updateRouterContext(async()=>{calls++;return 'invalid';},defaults,'ya','Baik'));assert.equal(calls,2);
});

test('Pesanan runs on the Terstruktur tier with provider schema, and in prompt mode on other tiers',async()=>{
 const {aiRequestPayload}=await import('../src/ai.js');const {defaultWorkflow}=await import('../src/ai-workflow.js');
 const run=async(config:any,reply:(c:any)=>string)=>{let node:any,specialist=0;
  await runAgents(async(c,m)=>{
   if(c.call_role==='router')return route('layanan');
   if(c.call_role==='pesanan'){node={config:c,messages:m};return reply(c);}
   specialist++;
   if(specialist===1)return JSON.stringify({tool:'get_products',query:'frame'});
   if(specialist===2)return JSON.stringify({tool:'create_order',query:'satu frame yang karbon'});
   return JSON.stringify({answer:'Pesanan dibuat'});
  },config,messages,300,context,{async execute(name,query){if(name==='get_products')return query?{products:[{name:'Frame Karbon'}]}:catalog;assert.deepEqual(JSON.parse(query),{items:[{product_name:'Frame Karbon',quantity:1}],notes:''});return {order:{id:'ORD-1'}};}});
  return node;};
 const answer=JSON.stringify({lengkap:true,items:[{product_name:'Frame Karbon',quantity:1}],notes:''});
 const config={...defaults,model_cheap:'cheap-test',model_medium:'medium-test',model_structured:'structured-test'};
 // Default: the Terstruktur tier model, with the schema sent to the provider.
 const strict=await run(config,()=>answer);
 assert.equal(strict.config.model,'structured-test');assert.equal((aiRequestPayload(strict.config,[]).response_format as any).json_schema.strict,true);
 // Products the specialist already looked up count as candidates even beyond the default listing.
 assert.ok(strict.messages[0].content.includes('"enum":["Frame Karbon","Frame Basic","Frame Pro"]'));
 // On another tier the schema only lives in the prompt, unless structured_output is switched on.
 const cheap=defaultWorkflow();cheap.nodes.pesanan.tier='cheap';
 const prompt=await run({...config,workflow:cheap},()=>answer);
 assert.equal(prompt.config.model,'cheap-test');assert.equal(aiRequestPayload(prompt.config,[]).response_format,undefined);
 const cheapStrict=defaultWorkflow();cheapStrict.nodes.pesanan.tier='cheap';cheapStrict.nodes.pesanan.structured_output=true;
 assert.equal((aiRequestPayload((await run({...config,workflow:cheapStrict},()=>answer)).config,[]).response_format as any).json_schema.strict,true);
 // A model without JSON Schema support rejects the request; the node retries once in prompt mode.
 const events:any[]=[];
 const fallback=await run({...config,onTrace:(e:any)=>events.push(e)},c=>{if(c.response_format)throw Error('ai_provider_http_400');return answer;});
 assert.equal(fallback.config.response_format,undefined);assert.equal(fallback.config.model,'structured-test');assert.ok(events.some(e=>e.node==='pesanan'&&e.error==='structured_output_unsupported'));
});
test('Orders in the line format skip the Pesanan model entirely',async()=>{
 let nodeCalls=0,specialist=0,created:unknown;const events:any[]=[];
 await runAgents(async(c)=>{
  if(c.call_role==='router')return route('layanan');
  if(c.call_role==='pesanan')nodeCalls++;
  if(++specialist===1)return JSON.stringify({tool:'create_order',query:'2 x frame basic; 1 x Frame Pro; catatan: bungkus kado'});
  return JSON.stringify({answer:'Pesanan dibuat'});
 },{...defaults,onTrace:e=>events.push(e)},messages,300,context,{async execute(name,query){if(name==='get_products')return catalog;created=JSON.parse(query);return {order:{id:'ORD-1'}};}});
 assert.equal(nodeCalls,0);assert.deepEqual(created,{items:[{product_name:'Frame Basic',quantity:2},{product_name:'Frame Pro',quantity:1}],notes:'bungkus kado'});
 assert.equal(events.find(e=>e.node==='pesanan').input.metode,'parser');
});
test('Pesanan output outside the catalog never reaches create_order',async()=>{
 let mutations=0,nodeCalls=0,specialist=0;
 await assert.rejects(runAgents(async(c,m)=>{
  if(c.call_role==='router')return route('layanan');
  if(c.call_role==='pesanan'){nodeCalls++;return pesanan({items:[{product_name:'Frame Palsu',quantity:1}],notes:''});}
  if(++specialist===2)assert.ok(m.at(-1)!.content.includes('order_invalid'));
  return JSON.stringify({tool:'create_order',query:'Frame Palsu '+specialist});
 },defaults,messages,300,context,{async execute(name){if(name==='get_products')return catalog;mutations++;return {};}}),/ai_invalid_tool/);
 assert.equal(mutations,0);assert.equal(nodeCalls,8);
});
test('Pesanan is skipped when there is nothing to order',async()=>{
 let nodeCalls=0,specialist=0;
 const result=await runAgents(async(c,m)=>{
  if(c.call_role==='router')return route('layanan');
  if(c.call_role==='pesanan')nodeCalls++;
  if(++specialist===1)return JSON.stringify({tool:'create_order',query:'1 Frame Basic'});
  assert.ok(m.at(-1)!.content.includes('order_unavailable'));return JSON.stringify({answer:'Produk belum tersedia'});
 },defaults,messages,300,context,{async execute(name){assert.equal(name,'get_products');return {products:[]};}});
 assert.equal(result.answer,'Produk belum tersedia');assert.equal(nodeCalls,0);
});
