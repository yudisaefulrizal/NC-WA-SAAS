import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {db} from '../src/db.js';
import {createAutoShare,contactInput,templateInput,jobInput,nextSchedule,randomDelay} from '../src/auto-share.js';
import {decodeHeaders,mediaVariable,parsePlaceholders,renderTemplate,validateHeaders,validateSourceData,validateSourceMedia} from '../src/auto-share-source.js';
import {acceptTidyResult,defaultTidyPrompt,tidyMessage,tidyMessages,tidyNoteInput} from '../src/auto-share-tidy.js';
import {migrateAutoShare} from '../src/auto-share-schema.js';
import {AssetStore} from '../src/engine/assets.js';
import {SessionManager,ApiError} from '../src/engine/sessions.js';
import {basicWallet} from '../src/plans.js';
import type {RowDataPacket} from 'mysql2/promise';
if(process.env.AUTO_SHARE_ISOLATED==='1')await migrateAutoShare();
const integration=(name:string,fn:()=>Promise<void>)=>test(name,{skip:process.env.AUTO_SHARE_ISOLATED!=='1'},fn);
const accounts:string[]=[],events:string[]=[],delays:number[]=[];
const payloads:any[]=[];
const managers=new Map<string,SessionManager>();
async function manager(account:string){if(!managers.has(account)){const m=new SessionManager(async(_id,update)=>{update({status:'connected'});return {close(){},async logout(){},async exists(jid){return !jid.startsWith('620000000000');},async typing(jid,state){events.push(state+':'+jid);},async send(jid,payload){payloads.push(payload);events.push('send:'+jid);return randomUUID();}};});await m.create('shop');managers.set(account,m);}return managers.get(account)!;}
const assetsRoot=await mkdtemp(join(tmpdir(),'nc-wa-share-assets-'));
const assets=new AssetStore(assetsRoot,db);
// Minimal valid PNG (1x1 transparent pixel) so AssetStore's magic-byte sniff accepts it as image/png.
const pngFixture=Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000050001ba86fe0e0000000049454e44ae426082','hex');
// Fake source transport and media download: the substitution rules are exercised without a network.
let sourceReply:unknown={data:{jumlah:247,sisa_kuota:53,buka:true}};
let sourceError:Error|null=null;
const sourceCalls:{endpoint:string;headers:Record<string,string>}[]=[];
const fakeSource=async(endpoint:string,headers:Record<string,string>)=>{sourceCalls.push({endpoint,headers});if(sourceError)throw sourceError;return sourceReply;};
const fakeDownload=async(url:string)=>{const dir=await mkdtemp(join(tmpdir(),'nc-wa-src-'));const path=join(dir,'media');await writeFile(path,pngFixture);return {path,mimetype:'image/png',cleanup:async()=>{await rm(dir,{recursive:true,force:true});}};};
// Tidying is optional decoration, so the fake transport can fail freely: the send must survive it.
let tidyReply='Peserta 1.247 orang.\n\nSisa kuota 53.';
let tidyError:Error|null=null;
const tidyCalls:string[]=[];
const fakeTidyTransport=async(_config:any,messages:any[])=>{tidyCalls.push(messages.at(-1).content);if(tidyError)throw tidyError;return tidyReply;};
const tidyConfig={endpoint:'https://ai.test/v1/chat/completions',model:'m',model_cheap:'m-cheap',secret:'x',input_rate:1,output_rate:1,memory_limit:60,context_memory_limit:6,trace_enabled:false,credit_price:0,tidy_prompt:''} as any;
const service=createAutoShare(manager,assets,async(ms:number)=>{delays.push(ms);},fakeSource,fakeDownload as any,async()=>tidyConfig);
const app=express();app.use(express.json());
app.get('/public/assets/:token',async(req,res)=>{const file=await assets.getByToken(req.params.token);res.set('Content-Type',file.mimetype).sendFile(file.path);});
app.use((req,res,next)=>{res.locals.accountId=req.get('account');next();});app.use(service.router);app.use((e:Error,_req:express.Request,res:express.Response,_next:express.NextFunction)=>res.status(e instanceof ApiError?e.status:500).json({message:e.message}));
const content=new Map<string,string>();
async function uploadAsset(account:string,filename='promo.png'){
 return (await request(app).post('/assets').set('account',account).set('X-Filename',filename).set('Content-Type','application/octet-stream').send(pngFixture).expect(201)).body;
}
async function user(){const id=randomUUID();accounts.push(id);await db.execute('INSERT INTO accounts(id,email,password_hash) VALUES (?,?,?)',[id,id+'@test.invalid','unused']);await basicWallet(id);content.set(id,(await request(app).post('/templates').set('account',id).send({name:'Pesan',message:'Halo'}).expect(201)).body.id);return id;}
const data=(account:string,contacts:string[]=[],groups:string[]=[])=>({name:'Promo',template_ids:[content.get(account)||'fixture'],session_id:'shop',contacts,groups,enabled:false,interval_minutes:0,next_at:null});
after(async()=>{await service.stop();for(const m of managers.values())await m.stop();for(const id of accounts)await db.execute('DELETE FROM accounts WHERE id=?',[id]);await rm(assetsRoot,{recursive:true,force:true});await db.end();});
test('validation canonicalizes numbers and checks schedules',()=>{
 assert.equal(templateInput({name:'Gambar',media_type:'image',asset_id:randomUUID(),message:''}).type,'image');
 assert.throws(()=>templateInput({name:'Bad',media_type:'image'}));
 assert.throws(()=>templateInput({name:'Empty',message:''}));
 assert.equal(contactInput({nomor:'628123456789@s.whatsapp.net'}).nomor,'628123456789@s.whatsapp.net');
 assert.equal(contactInput({nomor:'123456789@g.us'}).nomor,'123456789@g.us');
 assert.throws(()=>contactInput({nomor:'abc'}));assert.throws(()=>jobInput(data('x')));
 assert.throws(()=>jobInput({...data('x',['a']),enabled:true,next_at:'2000-01-01'}));
 assert.throws(()=>jobInput({...data('x',['a']),interval_minutes:1.5}));
 assert.equal(nextSchedule(new Date('2026-01-01T00:00:00Z'),60,new Date('2026-01-01T03:15:00Z'))?.toISOString(),'2026-01-01T04:00:00.000Z');
 assert.equal(nextSchedule(new Date(),0,new Date()),null);
 for(let i=0;i<100;i++){const ms=randomDelay();assert.ok(ms>=1000&&ms<=3000);}
});
integration('asset upload enforces quota, magic-byte sniffing, and tenant isolation',async()=>{
 const a=await user(),b=await user();
 const asset=await uploadAsset(a);
 assert.equal(asset.media_type,'image');assert.equal(asset.mimetype,'image/png');
 const list=(await request(app).get('/assets').set('account',a).expect(200)).body;
 assert.equal(list.used_count,1);assert.equal(list.max_count,10);assert.equal(list.assets[0].id,asset.id);
 assert.equal((await request(app).get('/assets').set('account',b).expect(200)).body.used_count,0);
 await request(app).get('/assets/'+asset.id+'/file').set('account',b).expect(404);
 await request(app).get('/assets/'+asset.id+'/file').set('account',a).expect(200);
 await request(app).post('/assets').set('account',a).set('X-Filename','bad.txt').send(Buffer.from('not a real media file')).expect(400);
 for(let i=0;i<9;i++)await uploadAsset(a,`extra-${i}.png`);
 await request(app).post('/assets').set('account',a).set('X-Filename','over.png').set('Content-Type','application/octet-stream').send(pngFixture).expect(409);
 await request(app).delete('/assets/'+asset.id).set('account',b).expect(404);
 await request(app).delete('/assets/'+asset.id).set('account',a).expect(200);
});
integration('plan quota is read live from the account\'s current plan, and downgrading blocks new uploads without deleting existing assets',async()=>{
 const a=await user(),tightPlan='tight-'+randomUUID().replaceAll('-','').slice(0,20);
 for(let i=0;i<3;i++)await uploadAsset(a,`before-${i}.png`);
 assert.equal((await request(app).get('/assets').set('account',a).expect(200)).body.used_count,3);
 // Downgrade to a plan whose asset limit (2) is already below what the account holds (3).
 await db.execute('INSERT INTO plans (id,name,price,credits,session_limit,active,max_share_assets,max_share_storage_bytes) VALUES (?,?,0,0,1,TRUE,2,52428800)',[tightPlan,'Ketat']);
 await db.execute('UPDATE wallets SET plan_id=? WHERE account_id=?',[tightPlan,a]);
 const overLimit=(await request(app).get('/assets').set('account',a).expect(200)).body;
 assert.equal(overLimit.used_count,3);assert.equal(overLimit.max_count,2);assert.equal(overLimit.assets.length,3);
 // Existing assets stay usable (readable, deletable) even while over the new limit; only new uploads are blocked.
 await request(app).get('/assets/'+overLimit.assets[0].id+'/file').set('account',a).expect(200);
 await request(app).post('/assets').set('account',a).set('X-Filename','blocked.png').set('Content-Type','application/octet-stream').send(pngFixture).expect(409);
 await request(app).delete('/assets/'+overLimit.assets[0].id).set('account',a).expect(200);
 // Upgrading back takes effect immediately (no re-login/reset needed) since quota is read live per request.
 await db.execute('UPDATE wallets SET plan_id=? WHERE account_id=?',['basic',a]);
 await uploadAsset(a,'after-upgrade.png');
 assert.equal((await request(app).get('/assets').set('account',a).expect(200)).body.used_count,3);
 await db.execute('DELETE FROM plans WHERE id=?',[tightPlan]);
});
integration('public link toggle exposes anonymous access without leaking via the asset id',async()=>{
 const a=await user(),b=await user();
 const asset=await uploadAsset(a);
 await request(app).get('/public/assets/'+asset.id).expect(404);
 await request(app).put('/assets/'+asset.id+'/public').set('account',b).send({public:true}).expect(404);
 const enabled=(await request(app).put('/assets/'+asset.id+'/public').set('account',a).send({public:true}).expect(200)).body;
 assert.ok(enabled.public_token);
 const [listed]=(await request(app).get('/assets').set('account',a).expect(200)).body.assets;
 assert.equal(listed.public_token,enabled.public_token);
 const publicFile=await request(app).get('/public/assets/'+enabled.public_token).expect(200);
 assert.equal(publicFile.headers['content-type'],'image/png');
 const disabled=(await request(app).put('/assets/'+asset.id+'/public').set('account',a).send({public:false}).expect(200)).body;
 assert.equal(disabled.public_token,null);
 await request(app).get('/public/assets/'+enabled.public_token).expect(404);
});
integration('tenant isolation, deduplication, typing, delay, billing and history',async()=>{
 const a=await user(),b=await user();
 const contact=(await request(app).post('/contacts').set('account',a).send({nomor:'628123456789',kelompkontak:'Pelanggan'}).expect(201)).body;
 await request(app).post('/contacts').set('account',a).send({nomor:contact.nomor}).expect(409);
 await request(app).post('/contacts').set('account',a).send({nomor:'123456789@g.us',kelompkontak:'Pelanggan'}).expect(201);
 assert.equal((await request(app).get('/contacts').set('account',b)).body.length,0);
 await request(app).put('/contacts/'+contact.id).set('account',b).send({nomor:'628999999999'}).expect(404);
 await request(app).post('/jobs').set('account',b).send(data(b,[contact.id])).expect(400);
 const t=(await request(app).post('/jobs').set('account',a).send(data(a,[contact.id],['Pelanggan'])).expect(201)).body;
 await request(app).post('/jobs/'+t.id+'/send').set('account',b).send({template_id:content.get(a)}).expect(404);
 const result=(await request(app).post('/jobs/'+t.id+'/send').set('account',a).send({template_id:content.get(a)}).expect(202)).body;assert.equal(result.total,2);
 await request(app).post('/jobs/'+t.id+'/send').set('account',a).send({template_id:content.get(a)}).expect(409);
 await service.tick();
 const rows=(await request(app).get('/runs/'+result.id).set('account',a)).body;
 assert.equal(rows.length,2);assert.ok(rows.every((r:any)=>r.status==='sent'));
 assert.equal((await request(app).get('/runs/'+result.id).set('account',b)).body.length,0);
 assert.equal(events.filter(e=>e.startsWith('send:')).length,2);assert.equal(events.filter(e=>e.startsWith('composing:')).length,2);
 assert.equal(delays.length,3);assert.equal(delays[0],1000);assert.ok(delays[1]>=1000&&delays[1]<=3000);
 assert.equal((await basicWallet(a)).balance,98);
});
integration('scheduled groups resolve current members and one-time schedule disables',async()=>{
 const a=await user();await request(app).post('/contacts').set('account',a).send({nomor:'628123456788',kelompkontak:'Tim'}).expect(201);
 const t=(await request(app).post('/jobs').set('account',a).send({...data(a,[],['Tim']),enabled:true,next_at:new Date(Date.now()+60000).toISOString()}).expect(201)).body;
 await request(app).post('/contacts').set('account',a).send({nomor:'628123456787',kelompkontak:'Tim'}).expect(201);
 await db.execute('UPDATE auto_share_jobs SET next_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 MINUTE) WHERE id=?',[t.id]);await service.tick();
 const templates=(await request(app).get('/jobs').set('account',a)).body;assert.equal(templates[0].enabled,false);
 const runs=(await request(app).get('/runs').set('account',a)).body;assert.equal(runs.length,1);assert.equal(runs[0].source,'schedule');assert.equal(runs[0].total,2);
});
integration('crash recovery does not resend an uncertain target, and continues pending ones',async()=>{
 const a=await user();const c=(await request(app).post('/contacts').set('account',a).send({nomor:'628123456786'})).body;
 const t=(await request(app).post('/jobs').set('account',a).send(data(a,[c.id]))).body;
 const run=(await request(app).post('/jobs/'+t.id+'/send').set('account',a).send({template_id:content.get(a)})).body;
 await db.execute("UPDATE auto_share_runs SET status='running' WHERE id=?",[run.id]);await db.execute("UPDATE auto_share_deliveries SET status='sending' WHERE run_id=?",[run.id]);
 await db.execute('INSERT INTO auto_share_deliveries(id,run_id,nomor,position) VALUES (?,?,?,1)',[randomUUID(),run.id,'628123456785@s.whatsapp.net']);
 const before=events.filter(e=>e.startsWith('send:')).length;await service.recover();await service.tick();assert.equal(events.filter(e=>e.startsWith('send:')).length,before+1);
 const [rows]=await db.execute<RowDataPacket[]>('SELECT status FROM auto_share_deliveries WHERE run_id=? ORDER BY position',[run.id]);assert.equal(rows[0].status,'unknown');
});

integration('failed target refunds credit, continues other targets, and recurring schedule advances',async()=>{
 const a=await user();for(const nomor of ['620000000000','628123456784'])await request(app).post('/contacts').set('account',a).send({nomor,kelompkontak:'Uji'}).expect(201);
 const t=(await request(app).post('/jobs').set('account',a).send({...data(a,[],['Uji']),enabled:true,next_at:new Date(Date.now()+60000).toISOString(),interval_minutes:60}).expect(201)).body;
 await db.execute('UPDATE auto_share_jobs SET next_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 125 MINUTE) WHERE id=?',[t.id]);
 await service.tick();const templates=(await request(app).get('/jobs').set('account',a)).body;
 assert.equal(templates[0].enabled,true);assert.ok(new Date(templates[0].next_at).getTime()>Date.now());
 const runs=(await request(app).get('/runs').set('account',a)).body;assert.equal(runs[0].status,'completed_with_errors');assert.equal(Number(runs[0].sent),1);assert.equal(Number(runs[0].failed),1);assert.equal((await basicWallet(a)).balance,99);
 await service.tick();assert.equal((await request(app).get('/runs').set('account',a)).body.length,1);
});

integration('persistent rotation, independent manual selection, media snapshots and template ownership',async()=>{
 const a=await user(),b=await user(),first=content.get(a)!;
 const contact=(await request(app).post('/contacts').set('account',a).send({nomor:'628123456783'}).expect(201)).body;
 const promoAsset=await uploadAsset(a,'promo.png');
 const second=(await request(app).post('/templates').set('account',a).send({name:'Gambar',media_type:'image',asset_id:promoAsset.id,message:'Promo https://example.com'}).expect(201)).body.id;
 const config={...data(a,[contact.id]),template_ids:[first,second],enabled:true,next_at:new Date(Date.now()+60000).toISOString(),interval_minutes:1440};
 await request(app).post('/jobs').set('account',b).send({...config,contacts:[],groups:['missing']}).expect(400);
 const job=(await request(app).post('/jobs').set('account',a).send(config).expect(201)).body;
 await request(app).delete('/templates/'+first).set('account',a).expect(409);
 await request(app).put('/templates/'+first).set('account',b).send({name:'Wrong',message:'Wrong'}).expect(404);
 await request(app).post('/jobs/'+job.id+'/send').set('account',a).send({template_id:content.get(b)}).expect(400);
 for(const expected of [first,second,first]){
  await db.execute('UPDATE auto_share_jobs SET next_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 MINUTE) WHERE id=?',[job.id]);await service.tick();
  const runs=(await request(app).get('/runs').set('account',a)).body;assert.equal(runs[0].template_id,expected);assert.equal(runs[0].status,'completed');
  await service.recover();
 }
 const before=(await request(app).get('/jobs').set('account',a)).body[0].rotation_index;
 const run=(await request(app).post('/jobs/'+job.id+'/send').set('account',a).send({template_id:second}).expect(202)).body;
 const newAsset=await uploadAsset(a,'new.png');
 await request(app).put('/templates/'+second).set('account',a).send({name:'Changed',media_type:'image',asset_id:newAsset.id,message:'New caption'}).expect(200);
 await service.tick();assert.equal((await request(app).get('/jobs').set('account',a)).body[0].rotation_index,before);
 // The run snapshot keeps the asset that was current when it was enqueued (promoAsset), not the
 // template's later edit (newAsset); sendBilled reads it straight off disk via AssetStore.get.
 assert.equal(payloads.at(-1).type,'image');assert.equal(payloads.at(-1).caption,'Promo https://example.com');assert.equal(payloads.at(-1).url,assets.path(a,promoAsset.id));
 assert.equal((await request(app).get('/runs/'+run.id).set('account',a)).body[0].status,'sent');
 await request(app).delete('/jobs/'+job.id).set('account',a).expect(200);await request(app).delete('/templates/'+second).set('account',a).expect(200);
 assert.ok((await request(app).get('/runs').set('account',a)).body.some((r:any)=>r.id===run.id));
});
integration('legacy migration preserves schedules and is repeatable without resurrecting deleted jobs',async()=>{
 const a=await user(),id=randomUUID();await db.execute("INSERT INTO auto_share_templates(id,account_id,name,session_id,message,contacts,groups_json,enabled,next_at,interval_minutes) VALUES (?,?,'Lama','shop','Isi lama',JSON_ARRAY(),JSON_ARRAY('Tim'),TRUE,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 DAY),1440)",[id,a]);
 await migrateAutoShare();await migrateAutoShare();const jobs=(await request(app).get('/jobs').set('account',a)).body;assert.equal(jobs.length,1);assert.equal(jobs[0].id,id);assert.deepEqual(jobs[0].template_ids,[id]);assert.equal(jobs[0].enabled,true);
 const templates=(await request(app).get('/templates').set('account',a)).body;assert.equal(templates.find((t:any)=>t.id===id).message,'Isi lama');
 await request(app).delete('/jobs/'+id).set('account',a);await migrateAutoShare();assert.equal((await request(app).get('/jobs').set('account',a)).body.length,0);
});
test('template source substitution formats values and refuses gaps',()=>{
 assert.deepEqual(parsePlaceholders('Halo {{jumlah}} dan {{ sisa }} lalu {{jumlah}}'),['jumlah','sisa']);
 // camelCase keys are common in existing APIs, so uppercase is allowed in names.
 assert.deepEqual(parsePlaceholders('Total {{totalPeserta}}'),['totalPeserta']);
 assert.deepEqual(parsePlaceholders('Tanpa variabel'),[]);
 // {{{{ is the escape for a literal {{, so it is not collected as a placeholder.
 assert.deepEqual(parsePlaceholders('Kurung {{{{jumlah}}}}'),[]);
 assert.equal(renderTemplate('Kurung {{{{ tutup }}}}',{}),'Kurung {{ tutup }}');
 const data=validateSourceData({data:{jumlah:1247,buka:true,tutup:false,nama:'Gelombang 2'}});
 assert.equal(data.jumlah,'1.247');assert.equal(data.buka,'Ya');assert.equal(data.tutup,'Tidak');assert.equal(data.nama,'Gelombang 2');
 assert.equal(renderTemplate('Pendaftar {{jumlah}} · {{nama}}',data),'Pendaftar 1.247 · Gelombang 2');
 assert.throws(()=>renderTemplate('Sisa {{tidak_ada}}',data),/tidak tersedia/);
 // An endpoint that answers with its own flat object needs no "data" wrapper.
 const bare=validateSourceData({cabang_utama:'Cabang Utama: total 102 transaksi',cabang_kedua:'Cabang Kedua: total 91 transaksi'});
 assert.equal(bare.cabang_utama,'Cabang Utama: total 102 transaksi');
 assert.equal(validateSourceData({totalPeserta:102}).totalPeserta,'102');
 // A wrapper still wins when present, so "data" is never mistaken for a variable.
 assert.deepEqual(Object.keys(validateSourceData({data:{jumlah:1},lain:'abaikan'})),['jumlah']);
 // Sentences assembled server-side are common, so the value cap is generous.
 assert.equal(validateSourceData({kalimat:'x'.repeat(1000)}).kalimat.length,1000);
 assert.throws(()=>validateSourceData([1,2]),/objek JSON/);
 assert.throws(()=>validateSourceData({}),/tidak memuat satu variabel/);
 assert.throws(()=>validateSourceData({data:{nested:{a:1}}}),/harus teks/);
 assert.throws(()=>validateSourceData({data:{kosong:null}}),/harus teks/);
 assert.throws(()=>validateSourceData({data:{'Tanda-Hubung':1}}),/Nama variabel/);
 assert.throws(()=>validateSourceData({data:{panjang:'x'.repeat(1001)}}),/melebihi 1000/);
 assert.throws(()=>validateSourceData({data:Object.fromEntries([...Array(51)].map((_,i)=>['k'+i,1]))}),/maksimal 50/);
 // A template without a source would send "{{jumlah}}" verbatim, so it is rejected up front.
 assert.throws(()=>templateInput({name:'Lupa',message:'Ada {{jumlah}}'}),/sumber data endpoint/);
 assert.throws(()=>templateInput({name:'Audio',media_type:'audio',asset_id:randomUUID(),message:'',source_mode:'endpoint',source_endpoint:'https://a.test/x'}),/audio tidak mendukung/);
 assert.throws(()=>templateInput({name:'Media',media_type:'image',media_source:'endpoint',message:'x'}),/memerlukan sumber data/);
 assert.throws(()=>templateInput({name:'Http',message:'x',source_mode:'endpoint',source_endpoint:'http://a.test/x'}),/HTTPS/);
 assert.equal(templateInput({name:'Ok',message:'Ada {{jumlah}}',source_mode:'endpoint',source_endpoint:'https://a.test/x'}).source.mode,'endpoint');
});
test('custom source headers are validated and legacy tokens still decode',()=>{
 assert.deepEqual(validateHeaders([{name:'X-API-Key',value:'abc'},{name:'Authorization',value:'Bearer xyz'}]),{'X-API-Key':'abc',Authorization:'Bearer xyz'});
 assert.deepEqual(validateHeaders(undefined),{});
 // Blank names are dropped so an empty row in the form is simply ignored.
 assert.deepEqual(validateHeaders([{name:'  ',value:'x'}]),{});
 assert.throws(()=>validateHeaders([{name:'Host',value:'evil.test'}]),/diatur otomatis/);
 assert.throws(()=>validateHeaders([{name:'Content-Length',value:'0'}]),/diatur otomatis/);
 assert.throws(()=>validateHeaders([{name:'Bad Header',value:'x'}]),/hanya boleh huruf/);
 // A newline would let the value inject a second header into the request.
 assert.throws(()=>validateHeaders([{name:'X-Key',value:'a\r\nX-Evil: 1'}]),/baris baru/);
 assert.throws(()=>validateHeaders([{name:'X-Key',value:'a'},{name:'x-key',value:'b'}]),/lebih dari sekali/);
 assert.throws(()=>validateHeaders([...Array(11)].map((_,i)=>({name:'X-H'+i,value:'v'}))),/maksimal 10/);
 assert.throws(()=>validateHeaders([{name:'X-Key',value:'x'.repeat(1025)}]),/maksimal 1024/);
 // Templates saved before custom headers existed stored a bare token.
 assert.deepEqual(decodeHeaders('rahasia-lama'),{Authorization:'Bearer rahasia-lama'});
 assert.deepEqual(decodeHeaders('{"X-API-Key":"abc"}'),{'X-API-Key':'abc'});
 assert.deepEqual(decodeHeaders(''),{});
});
integration('endpoint-sourced templates substitute live values and never touch the gallery quota',async()=>{
 const a=await user();
 sourceError=null;sourceReply={jumlah:1247,sisa_kuota:53,poster:'https://example.com/poster.png'};
 await request(app).post('/contacts').set('account',a).send({nomor:'628111000111'}).expect(201);
 const contacts=(await request(app).get('/contacts').set('account',a)).body;
 const template=(await request(app).post('/templates').set('account',a).send({name:'Promo',media_type:'image',media_source:'endpoint',media_variable:'poster',message:'Peserta {{jumlah}}, sisa {{sisa_kuota}}',source_mode:'endpoint',source_endpoint:'https://data.test/statistik',source_headers:[{name:'X-API-Key',value:'rahasia'}]}).expect(201)).body;
 // Header values never reach the browser; only their names come back so the form can render rows.
 const listed=(await request(app).get('/templates').set('account',a)).body.find((t:any)=>t.id===template.id);
 assert.deepEqual(listed.source_header_names,['X-API-Key']);assert.equal(listed.source_secret,undefined);
 sourceCalls.length=0;
 const quotaBefore=(await request(app).get('/assets').set('account',a)).body;
 const job=(await request(app).post('/jobs').set('account',a).send({...data(a,[contacts[0].id]),template_ids:[template.id]}).expect(201)).body;
 const run=(await request(app).post('/jobs/'+job.id+'/send').set('account',a).send({template_id:template.id}).expect(202)).body;
 // Temporary run media stays out of the gallery listing and its usage totals.
 const quotaDuring=(await request(app).get('/assets').set('account',a)).body;
 assert.equal(quotaDuring.used_count,quotaBefore.used_count);assert.equal(quotaDuring.used_bytes,quotaBefore.used_bytes);
 assert.equal(sourceCalls.at(-1)?.headers['X-API-Key'],'rahasia');
 await service.tick();
 assert.equal(payloads.at(-1).caption,'Peserta 1.247, sisa 53');
 assert.equal(payloads.at(-1).type,'image');
 const [rows]=await db.execute<RowDataPacket[]>('SELECT source_data FROM auto_share_runs WHERE id=?',[run.id]);
 assert.equal((typeof rows[0].source_data==='string'?JSON.parse(rows[0].source_data):rows[0].source_data).jumlah,'1.247');
 // Settling the run removes its temporary media from both the table and disk.
 const [left]=await db.execute<RowDataPacket[]>('SELECT id FROM share_assets WHERE run_id=?',[run.id]);
 assert.equal(left.length,0);
});
integration('a failing source cancels the run, records why, and still advances the schedule',async()=>{
 const a=await user();
 sourceError=null;sourceReply={data:{jumlah:10}};
 await request(app).post('/contacts').set('account',a).send({nomor:'628111000222'}).expect(201);
 const contacts=(await request(app).get('/contacts').set('account',a)).body;
 const template=(await request(app).post('/templates').set('account',a).send({name:'Statistik',message:'Ada {{jumlah}} orang',source_mode:'endpoint',source_endpoint:'https://data.test/statistik'}).expect(201)).body;
 const job=(await request(app).post('/jobs').set('account',a).send({...data(a,[contacts[0].id]),template_ids:[template.id],enabled:true,interval_minutes:1440,next_at:new Date(Date.now()+60000).toISOString()}).expect(201)).body;
 await db.execute('UPDATE auto_share_jobs SET next_at=UTC_TIMESTAMP(3) WHERE id=?',[job.id]);
 sourceError=new ApiError(400,'invalid_request','Sumber data tidak dapat dihubungi');
 await service.tick();
 const runs=(await request(app).get('/runs').set('account',a)).body;
 assert.equal(runs[0].status,'failed');
 assert.match((await request(app).get('/runs/'+runs[0].id).set('account',a)).body[0].error,/tidak dapat dihubungi/);
 // The schedule must keep moving so one dead endpoint does not stall the job forever.
 const after=(await request(app).get('/jobs').set('account',a)).body[0];
 assert.ok(new Date(after.next_at).getTime()>Date.now());
 // A missing variable is treated the same way: nothing is sent at all.
 sourceError=null;sourceReply={data:{lain:1}};
 await db.execute('UPDATE auto_share_jobs SET next_at=UTC_TIMESTAMP(3) WHERE id=?',[job.id]);
 await service.tick();
 const second=(await request(app).get('/runs').set('account',a)).body[0];
 assert.equal(second.status,'failed');
 assert.match((await request(app).get('/runs/'+second.id).set('account',a)).body[0].error,/tidak tersedia/);
 sourceReply={data:{jumlah:247,sisa_kuota:53,buka:true}};
});
test('media comes from a chosen variable holding a link',async()=>{
 const data={poster:'https://example.com/poster.png',jumlah:'247',kosong:'',bukan:'bukan alamat'};
 assert.equal((await validateSourceMedia(data,'poster')).url,'https://example.com/poster.png');
 // The filename is derived from the link so the endpoint need not supply one.
 assert.equal((await validateSourceMedia(data,'poster')).filename,'poster.png');
 await assert.rejects(()=>validateSourceMedia(data,'tidak_ada'),/tidak tersedia/);
 await assert.rejects(()=>validateSourceMedia(data,'kosong'),/kosong/);
 await assert.rejects(()=>validateSourceMedia(data,'bukan'),/alamat HTTPS/);
 // A variable holding a plain number is a common mistake worth a clear message.
 await assert.rejects(()=>validateSourceMedia(data,'jumlah'),/alamat HTTPS/);
 assert.throws(()=>mediaVariable(''),/Pilih variabel media/);
 assert.throws(()=>mediaVariable('nama-salah'),/Pilih variabel media/);
 assert.equal(mediaVariable('poster'),'poster');
 // Picking endpoint media without naming the variable must not save.
 assert.throws(()=>templateInput({name:'M',media_type:'image',media_source:'endpoint',message:'x',source_mode:'endpoint',source_endpoint:'https://a.test/x'}),/Pilih variabel media/);
});

test('tidy results are accepted only when they still look like the message',()=>{
 const original='Peserta 1247 orang. Sisa kuota 53.';
 assert.equal(acceptTidyResult(original,'  Peserta 1.247 orang.\n\nSisa kuota 53.  '),'Peserta 1.247 orang.\n\nSisa kuota 53.');
 assert.equal(acceptTidyResult(original,'   '),null);
 // A rewrite that drops most of the text means the model summarised instead of reformatting.
 assert.equal(acceptTidyResult(original,'Oke.'),null);
 assert.equal(acceptTidyResult(original,'x'.repeat(10001)),null);
 assert.ok(defaultTidyPrompt.includes('Pertahankan seluruh angka'));
 // Tidying is offered only where a source supplies the text.
 assert.throws(()=>templateInput({name:'Statis',message:'Halo',tidy:true}),/sumber data endpoint/);
 assert.throws(()=>templateInput({name:'Audio',media_type:'audio',asset_id:randomUUID(),message:'',tidy:true,source_mode:'endpoint',source_endpoint:'https://a.test/x'}),/audio tidak mendukung|tidak memiliki teks/);
 assert.equal(templateInput({name:'Ok',message:'Ada {{jumlah}}',tidy:true,source_mode:'endpoint',source_endpoint:'https://a.test/x'}).tidy,true);
});
integration('a failing tidy never blocks the broadcast',async()=>{
 const a=await user();
 // No AI credit at all: the send must still go out with the substituted text.
 sourceError=null;sourceReply={data:{jumlah:7}};
 const config={...tidyConfig};
 const poor=await tidyMessage(a,'Peserta 7 orang berdasarkan data terbaru.',config,fakeTidyTransport);
 assert.equal(poor.tidied,false);assert.equal(poor.reason,'kredit_tidak_cukup');
 assert.equal(poor.message,'Peserta 7 orang berdasarkan data terbaru.');
 await db.execute('INSERT INTO ai_wallets VALUES (?,100000) ON DUPLICATE KEY UPDATE balance=100000',[a]);
 tidyError=Error('provider down');
 const broken=await tidyMessage(a,'Peserta 7 orang berdasarkan data terbaru.',config,fakeTidyTransport);
 assert.equal(broken.tidied,false);assert.equal(broken.message,'Peserta 7 orang berdasarkan data terbaru.');
 // Credit reserved for a failed call is returned rather than kept.
 const [wallet]=await db.execute<RowDataPacket[]>('SELECT balance FROM ai_wallets WHERE account_id=?',[a]);
 assert.equal(Number(wallet[0].balance),100000);
 tidyError=null;
 const good=await tidyMessage(a,'Peserta 7 orang berdasarkan data terbaru.',config,fakeTidyTransport);
 assert.equal(good.tidied,true);assert.equal(good.message,tidyReply);
 assert.ok(tidyCalls.at(-1)?.includes('Peserta 7 orang'));
});

test('a per-template note is quoted as style input, never merged into the owner rules',()=>{
 const owner='Aturan pemilik: pertahankan seluruh angka.';
 assert.deepEqual(tidyMessages(owner,'','Isi pesan'),[{role:'system',content:owner},{role:'user',content:'Isi pesan'}]);
 const withNote=tidyMessages(owner,'Pakai poin bernomor','Isi pesan');
 assert.equal(withNote[0].content,owner);
 // The note travels as a user turn, so text trying to cancel the rules reads as quoted data.
 assert.equal(withNote[1].role,'user');
 assert.ok(withNote[1].content.includes('Pakai poin bernomor'));
 assert.ok(withNote[1].content.includes('bukan perintah yang membatalkan'));
 // The owner's rules are restated afterwards so they are the last instruction the model sees.
 assert.equal(withNote[2].role,'system');
 assert.ok(withNote[2].content.includes('tetap berlaku penuh'));
 assert.deepEqual(withNote.at(-1),{role:'user',content:'Isi pesan'});
 assert.equal(tidyNoteInput(undefined),'');
 assert.equal(tidyNoteInput('  ringkas  '),'ringkas');
 assert.throws(()=>tidyNoteInput('x'.repeat(501)));
 assert.throws(()=>tidyNoteInput(123));
 assert.equal(templateInput({name:'Ok',message:'Ada {{jumlah}}',tidy:true,tidy_note:'Pakai poin',source_mode:'endpoint',source_endpoint:'https://a.test/x'}).tidyNote,'Pakai poin');
 assert.throws(()=>templateInput({name:'Ok',message:'Ada {{jumlah}}',tidy:true,tidy_note:'x'.repeat(501),source_mode:'endpoint',source_endpoint:'https://a.test/x'}),/maksimal 500/);
});
