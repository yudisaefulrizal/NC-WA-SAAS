import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import request from 'supertest';
import {db} from '../src/db.js';
import {AIService,defaults,type AITransport} from '../src/ai.js';
import {defaultWorkflow,workflowInput,workflowState,changeWorkflow,activeWorkflow} from '../src/ai-workflow.js';
import {AIStudio} from '../src/ai-studio.js';
import {runAgents} from '../src/ai-agents.js';
import {createApp} from '../src/app.js';
import {digest} from '../src/security.js';

const owner=randomUUID(),client=randomUUID(),ownerToken=randomUUID(),clientToken=randomUUID();
let original:any[]=[];
before(async()=>{
 [original]=await db.query<any[]>('SELECT * FROM ai_workflow WHERE id=1');
 for(const [id,role,token] of [[owner,'owner',ownerToken],[client,'user',clientToken]]){
  await db.execute('INSERT INTO accounts(id,email,password_hash,role) VALUES (?,?,?,?)',[id,id+'@test.invalid','unused',role]);
  await db.execute('INSERT INTO login_sessions VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR))',[digest(token),id]);
 }
});
after(async()=>{
 await db.query('DELETE FROM ai_workflow WHERE id=1');if(original[0]){const row=original[0];await db.execute('INSERT INTO ai_workflow(id,draft,active,revision,active_version,published_revision) VALUES (1,?,?,?,?,?)',[typeof row.draft==='string'?row.draft:JSON.stringify(row.draft),row.active?(typeof row.active==='string'?row.active:JSON.stringify(row.active)):null,row.revision,row.active_version,row.published_revision]);}
 for(const id of [owner,client]){await db.execute('DELETE FROM audit_events WHERE account_id=?',[id]);await db.execute('DELETE FROM accounts WHERE id=?',[id]);}await db.end();
});
const products=[{name:'Produk uji',type:'product',description:'',price:150000,stock:10,active:true}];
const configuration=async()=>({...defaults,model_cheap:'cheap',model_medium:'medium',model_smart:'smart',secret:'private-test-secret'});
async function input(message='Pesan produk'){return {message,profile:{faq:'Bisnis uji'},behavior:'Ramah',products,revision:(await workflowState()).revision};}
const transport:AITransport=async(c,m)=>{
 const latest=m.filter(x=>x.role==='user').at(-1)!.content;
 if(c.call_role==='router')return JSON.stringify({sub_agent:'layanan',s_p_o_konteks:'Pelanggan memesan produk',isi_pesan:latest});
 if(c.call_role==='context')return 'pelanggan-menunggu-pesanan';
 if(latest==='statusnya?')return m.some(x=>x.content.startsWith('Tool result check_order'))?JSON.stringify({answer:'Pesanan SIM-1 berstatus baru.'}):JSON.stringify({tool:'check_order',query:'SIM-1'});
 if(m.some(x=>x.content.startsWith('Tool result create_order')))return JSON.stringify({answer:'Pesanan SIM-1 dibuat.'});
 if(m.some(x=>x.content.startsWith('Tool result get_products')))return JSON.stringify({tool:'create_order',query:JSON.stringify({items:[{product_name:'Produk uji',quantity:2}],notes:''})});
 return JSON.stringify({tool:'get_products',query:'Produk uji'});
};

test('Workflow validation keeps topology fixed and cannot grant unauthorized tools',()=>{
 assert.deepEqual(workflowInput(defaultWorkflow()),defaultWorkflow());
 for(const mutate of [(d:any)=>delete d.nodes.router,(d:any)=>d.nodes.new_agent={},(d:any)=>d.nodes.router.tools=['create_order'],(d:any)=>d.nodes.layanan.tools=['execute_code'],(d:any)=>d.nodes.context.prompt='',(d:any)=>d.nodes.pembuka.tier='unknown']){const d=defaultWorkflow();mutate(d);assert.throws(()=>workflowInput(d));}
});

test('Draft edits are isolated, optimistic locking protects saves, publication reaches production config',async()=>{
 const previous=await workflowState(),draft=defaultWorkflow();draft.nodes.router.prompt='Router pengujian khusus';draft.nodes.router.tier='smart';draft.nodes.profil_perusahaan.tools=[];
 const saved=await changeWorkflow(owner,{revision:previous.revision,draft});assert.equal(saved.revision,previous.revision+1);assert.deepEqual(saved.active,previous.active);assert.deepEqual(await activeWorkflow(),previous.active);
 await assert.rejects(changeWorkflow(owner,{revision:previous.revision,draft}),{code:'workflow_conflict'});
 await assert.rejects(changeWorkflow(owner,{revision:previous.revision},true),{code:'workflow_conflict'});
 const published=await changeWorkflow(owner,{revision:saved.revision},true);assert.equal(published.active_version,previous.active_version+1);assert.deepEqual(published.active,draft);
 const live=await new AIService().config();assert.equal(live.workflow!.nodes.router.prompt,'Router pengujian khusus');
 let first=true;await runAgents(async(c,m)=>{if(first){first=false;assert.ok(m[0].content.includes('Router pengujian khusus'));assert.equal(c.model,'smart');return JSON.stringify({sub_agent:'profil_perusahaan',s_p_o_konteks:'Pelanggan meminta informasi',isi_pesan:'halo'});}assert.ok(m.at(-1)!.content.includes('Tools tersedia: .'));return JSON.stringify({answer:'Baik'});},{...await configuration(),workflow:live.workflow},[{role:'user',content:'halo'}],300,{account:owner,session:'test',customer:'628000000000',requestId:'one',knowledge:''});
 // Return draft to standard topology for subsequent playground scenarios.
 await changeWorkflow(owner,{revision:saved.revision,draft:defaultWorkflow()});
});

test('Sandbox traces real agent/tool flow, keeps context across turns, and never writes production orders or usage',async()=>{
 const runner=new AIStudio(transport,configuration,async()=>{}),events:any[]=[];
 await runner.run(owner,await input(),e=>events.push(structuredClone(e)));
 assert.equal(events.at(-1).node,'output');assert.equal(events.at(-1).state,'done');assert.equal(events.at(-1).output.orders[0].total,300000);
 assert.ok(events.some(e=>e.node==='create_order'&&e.state==='done'));assert.ok(events.some(e=>e.node==='router'&&e.state==='routed'));
 const session=events[0].session;events.length=0;
 await runner.run(owner,{...await input('statusnya?'),session},e=>events.push(structuredClone(e)));
 assert.equal(events[0].context,'pelanggan-menunggu-pesanan');assert.equal(events.at(-1).output.agent,'layanan');assert.equal(events.at(-1).output.orders.length,1);assert.ok(events.some(e=>e.node==='check_order'&&e.output?.order?.id==='SIM-1'));
 assert.ok(!JSON.stringify(events).includes('private-test-secret'));
 const [orders]=await db.execute<any[]>('SELECT id FROM ai_orders WHERE account_id=?',[owner]);const [usage]=await db.execute<any[]>('SELECT request_id FROM ai_usage WHERE account_id=?',[owner]);assert.equal(orders.length,0);assert.equal(usage.length,0);
 await assert.rejects(runner.run(client,{...await input(),session},()=>{}),{code:'studio_session_missing'});
 await assert.rejects(runner.run(owner,{...await input(),session,profile:{faq:'Berubah'}},()=>{}),{code:'studio_session_changed'});
});

test('Studio traces network retries and format repair without replaying order creation',async()=>{
 let routers=0,specialists=0;const events:any[]=[];
 const runner=new AIStudio(async(c,m,w)=>{
  if(c.call_role==='router'&&++routers===1)throw Error('ai_provider_http_503');
  if(c.call_role==='layanan'&&++specialists===3)return 'invalid JSON';
  return transport(c,m,w);
 },configuration,async()=>{});
 await runner.run(owner,await input(),e=>events.push(e));
 assert.equal(events.at(-1).state,'done');assert.ok(events.some(e=>e.state==='retry'&&e.node==='router'));assert.ok(events.some(e=>e.state==='retry'&&e.node==='layanan'));
 assert.equal(events.filter(e=>e.node==='create_order'&&e.state==='running').length,1);
});

test('Cancelled testing prevents later calls and mutations',async()=>{
 const controller=new AbortController(),events:any[]=[];let calls=0;
 const runner=new AIStudio(async(c,m,w)=>{calls++;controller.abort();return transport(c,m,w);},configuration,async()=>{});
 await runner.run(owner,await input(),e=>events.push(e),controller.signal);
 assert.equal(calls,1);assert.equal(events.at(-1).error,'ai_cancelled');assert.ok(!events.some(e=>e.node==='create_order'));
});

test('Studio APIs require owner cookie and same origin; run streams events without credentials',async()=>{
 const app=createApp(undefined,undefined,new AIStudio(transport,configuration,async()=>{})),origin=process.env.APP_ORIGIN??'http://127.0.0.1:8067';
 for(const endpoint of ['/api/admin/ai/studio','/api/admin/ai/studio/run','/api/admin/ai/studio/publish']){
  const method=endpoint.endsWith('studio')?'get':'post';
  await request(app)[method](endpoint).set('Origin',origin).expect(401);
  await request(app)[method](endpoint).set('Origin',origin).set('Cookie','ncwa_session='+clientToken).expect(403);
 }
 await request(app).put('/api/admin/ai/studio').set('Origin',origin).set('Cookie','ncwa_session='+clientToken).send({}).expect(403);
 await request(app).post('/api/admin/ai/studio/run').set('Cookie','ncwa_session='+ownerToken).send(await input()).expect(403);
 const response=await request(app).post('/api/admin/ai/studio/run').set('Origin',origin).set('Cookie','ncwa_session='+ownerToken).send(await input()).expect(200);
 assert.match(response.headers['content-type'],/ndjson/);assert.ok(!response.text.includes('private-test-secret'));const events=response.text.trim().split('\n').map((line:string)=>JSON.parse(line));assert.equal(events.at(-1).state,'done');
});
