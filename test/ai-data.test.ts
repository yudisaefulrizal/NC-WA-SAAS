import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import request from 'supertest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {db} from '../src/db.js';
import {AIData,source,sourceInput,endpointUrl,callEndpoint,orderInput,type Product} from '../src/ai-data.js';
import {AIService} from '../src/ai.js';
import type {ToolContext} from '../src/ai-agents.js';
import {decrypt} from '../src/payments.js';
import {digest} from '../src/security.js';
const accounts:string[]=[];
const assistant=new AIService();
const product:Product={name:'Produk A',type:'product',description:'Produk ringan',price:125000,stock:10,active:true};
const input={items:[{product_name:'Produk A',quantity:2}],notes:'Tolong siapkan'};
async function fixture():Promise<ToolContext>{const account=randomUUID();accounts.push(account);await db.execute('INSERT INTO accounts(id,email,password_hash) VALUES (?,?,?)',[account,account+'@test.invalid','unused']);return {account,session:'shop',customer:'628123456789',requestId:'request-1',knowledge:'Knowledge '+account,behavior:'Ramah'};}
async function configure(scope:ToolContext,products:unknown,orders:unknown){return assistant.saveAssistant(scope.account,scope.session,{enabled:true,profile:{lainnya:scope.knowledge},behavior:scope.behavior,products_source:products,orders_source:orders});}
after(async()=>{for(const id of accounts){await db.execute('DELETE FROM audit_events WHERE account_id=?',[id]);await db.execute('DELETE FROM accounts WHERE id=?',[id]);}await db.end();});

test('Built-in product and order tables isolate tenant, session and customer; preserve price snapshots and status',async()=>{
 const a=await fixture(),b=await fixture(),data=new AIData();
 await data.saveProduct(a.account,a.session,'',product);await data.saveProduct(b.account,b.session,'',{...product,name:'Produk B',price:70000});
 assert.equal((await data.catalog(a,''))[0].name,'Produk A');assert.equal((await data.catalog(b,''))[0].name,'Produk B');assert.deepEqual(await data.catalog({...a,session:'other'},''),[]);
 const result=await data.execute('create_order',JSON.stringify(input),a) as any;
 assert.equal(result.order.total,250000);assert.equal(result.order.customer,a.customer);assert.equal(result.order.status,'baru');
 await data.saveProduct(a.account,a.session,product.name,{...product,price:200000});
 assert.equal((await new AIData().order(a.account,a.session,result.order.id,a.customer))?.total,250000);
 for(const scope of [b,{...a,session:'other'},{...a,customer:'628999999999'}])assert.deepEqual(await data.execute('check_order',result.order.id,scope),{order:null});
 await assert.rejects(data.updateOrder(b.account,b.session,result.order.id,{status:'selesai'}),{code:'not_found'});
 await data.updateOrder(a.account,a.session,result.order.id,{status:'diproses',notes:'Dikerjakan admin'});
 assert.equal((await data.execute('check_order',result.order.id,a) as any).order.status,'diproses');
});

test('Concurrent order creation is idempotent across restart and rejects conflicting payloads',async()=>{
 const scope=await fixture(),data=new AIData();await data.saveProduct(scope.account,scope.session,'',product);
 const orders=await Promise.all(Array.from({length:4},()=>data.createOrder(scope,input)));assert.equal(new Set(orders.map(o=>o.id)).size,1);
 await data.saveProduct(scope.account,scope.session,product.name,{...product,price:99,active:false});assert.deepEqual(await new AIData().createOrder(scope,input),orders[0]);
 assert.equal((await data.orders(scope.account,scope.session)).length,1);
 await assert.rejects(data.createOrder(scope,{...input,notes:'Changed'}),{code:'idempotency_conflict'});
 await assert.rejects(data.createOrder({...scope,customer:'628999999999'},input),{code:'idempotency_conflict'});
 await assert.rejects(data.createOrder({...scope,requestId:'new'},input),{code:'invalid_request'});
});

test('Product validation, insufficient stock and forged order prices or customer are rejected',async()=>{
 const scope=await fixture(),data=new AIData();
 for(const p of [{...product,price:-1},{...product,stock:1.5},{...product,active:'yes'},{...product,name:''}])await assert.rejects(data.saveProduct(scope.account,scope.session,'',p),{code:'invalid_request'});
 await data.saveProduct(scope.account,scope.session,'',product);
 for(const o of [{...input,customer:'628999999999'},{items:[{product_name:'Produk A',quantity:1,price:1}]},{items:[{product_name:'Produk A',quantity:0}]},{items:[{product_name:'Produk A',quantity:1},{product_name:'Produk A',quantity:1}]}])assert.throws(()=>orderInput(o),{code:'invalid_request'});
 await assert.rejects(data.execute('create_order',JSON.stringify({items:[{product_name:'Produk A',quantity:11}]}),scope),{code:'invalid_request'});
 assert.equal((await data.orders(scope.account,scope.session)).length,0);
});

test('Independent endpoint sources keep encrypted tokens private and preserve built-in data',async()=>{
 const scope=await fixture(),other=await fixture(),data=new AIData();await data.saveProduct(scope.account,scope.session,'',product);
 const config=await configure(scope,{mode:'endpoint',endpoint:'https://8.8.8.8/products',token:'private-token'},{mode:'builtin'});
 assert.equal(config.products_source.has_token,true);assert.equal(config.orders_source.mode,'builtin');assert.ok(!JSON.stringify(config).includes('private-token'));assert.ok(!JSON.stringify(config).includes('secret'));
 const saved=await source(scope.account,scope.session,'products');assert.notEqual(saved.secret,'private-token');assert.equal(decrypt(saved.secret),'private-token');assert.equal((await assistant.assistant(other.account,other.session)).products_source.mode,'builtin');
 await configure(scope,{mode:'endpoint',endpoint:'https://8.8.8.8/products',token:''},{mode:'builtin'});assert.equal((await source(scope.account,scope.session,'products')).secret,saved.secret);
 await configure(scope,{mode:'endpoint',endpoint:'https://8.8.8.8/other',token:''},{mode:'builtin'});assert.equal((await source(scope.account,scope.session,'products')).secret,'');
 await configure(scope,{mode:'builtin'},{mode:'builtin'});assert.equal((await data.catalog(scope,''))[0].name,product.name);
});

test('Custom products and built-in orders work together with the same normalized tool results',async()=>{
 const scope=await fixture();await configure(scope,{mode:'endpoint',endpoint:'https://8.8.8.8/products',token:'fixture'},{mode:'builtin'});
 let calls=0;const data=new AIData(async(config,payload,key)=>{calls++;assert.equal(config.endpoint,'https://8.8.8.8/products');assert.equal(decrypt(config.secret),'fixture');assert.equal(payload.action,'get_products');assert.deepEqual(payload.context,{account_id:scope.account,session_id:scope.session,customer:scope.customer,request_id:scope.requestId});assert.equal(key,digest(JSON.stringify([scope.account,scope.session,scope.customer,scope.requestId,'get_products',payload.query])));return {products:[product]};});
 assert.deepEqual(await data.execute('get_products','',scope),{products:[product]});const created=await data.execute('create_order',JSON.stringify(input),scope) as any;
 assert.equal(created.order.total,250000);assert.equal((await data.orders(scope.account,scope.session)).length,1);assert.equal(calls,2);
});

test('Built-in products and custom orders route independently, validate customer and pass priced items',async()=>{
 const scope=await fixture();await configure(scope,{mode:'builtin'},{mode:'endpoint',endpoint:'https://8.8.8.8/orders'});
 const order={id:'EXT-1',customer:scope.customer,items:[{product_name:product.name,quantity:2,price:product.price}],total:250000,status:'baru',notes:input.notes};
 const actions:string[]=[];const data=new AIData(async(config,payload)=>{assert.equal(config.endpoint,'https://8.8.8.8/orders');actions.push(String(payload.action));if(payload.action==='create_order')assert.deepEqual(payload.query,{...input,items:order.items});return {order};});await data.saveProduct(scope.account,scope.session,'',product);
 assert.deepEqual(await data.execute('create_order',JSON.stringify(input),scope),{order});assert.deepEqual(await data.execute('check_order','EXT-1',scope),{order});assert.deepEqual(actions,['create_order','check_order']);assert.deepEqual(await data.orders(scope.account,scope.session),[]);
 for(const bad of [{...order,customer:'628999999999'},{...order,id:'wrong'},{...order,total:1}])await assert.rejects(new AIData(async()=>({order:bad})).execute('check_order','EXT-1',scope));
 await assert.rejects(new AIData(async()=>{throw Error('endpoint_timeout');}).execute('check_order','EXT-1',scope),/endpoint_timeout/);
});

test('SSRF URLs, unsupported endpoint data and credentials in URLs are rejected',async()=>{
 for(const url of ['http://8.8.8.8/api','https://127.0.0.1/api','https://10.0.0.1/api','https://[::1]/api','https://user:secret@8.8.8.8/api','https://8.8.8.8/api?key=secret'])await assert.rejects(endpointUrl(url));
 await assert.rejects(callEndpoint({mode:'endpoint',endpoint:'https://127.0.0.1',secret:''},{},'test'));
 await assert.rejects(sourceInput({mode:'endpoint',endpoint:'https://8.8.8.8/api',token:'x\r\ny'}));
 const scope=await fixture();await configure(scope,{mode:'endpoint',endpoint:'https://8.8.8.8/products'},{mode:'builtin'});
 for(const data of [{products:'wrong'},{products:[{...product,price:-1}]},{products:[product,product]}])await assert.rejects(new AIData(async()=>data).catalog(scope,''));
});

test('Authenticated product/order APIs enforce ownership, CSRF and immutable order amounts',async()=>{
 const a=await fixture(),b=await fixture(),root=await mkdtemp(join(tmpdir(),'ncwa-data-test-'));
 const {createGateway}=await import('../src/gateway.js'),{createApp}=await import('../src/app.js');
 const gateway=createGateway(()=>async(_id,update)=>{update({status:'connected'});return {close(){},async logout(){}};},root);const app=createApp(gateway),origin=process.env.APP_ORIGIN??'http://127.0.0.1:8067';const tokens=[randomUUID(),randomUUID()];
 try{
  for(const [index,scope] of [a,b].entries()){await db.execute('INSERT INTO login_sessions VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR))',[digest(tokens[index]),scope.account]);await request(app).post('/sessions').set('Cookie','ncwa_session='+tokens[index]).set('Origin',origin).send({id:'shop'}).expect(200);}
  const cookie='ncwa_session='+tokens[0],other='ncwa_session='+tokens[1],base='/sessions/shop/ai';
  await request(app).post(base+'/products').set('Cookie',cookie).set('Origin',origin).send({...product,account_id:b.account}).expect(200);
  assert.deepEqual((await request(app).get(base+'/products').set('Cookie',other).expect(200)).body,[]);
  await request(app).put(base+'/products/'+encodeURIComponent(product.name)).set('Cookie',cookie).send(product).expect(403);
  await request(app).get('/sessions/missing/ai/products').set('Cookie',cookie).expect(404);
  const created=await request(app).post(base+'/orders').set('Cookie',cookie).set('Origin',origin).set('Idempotency-Key','manual-test').send({...input,customer:a.customer,account_id:b.account,total:1}).expect(200);
  assert.equal(created.body.total,250000);
  await request(app).put(base+'/orders/'+created.body.id).set('Cookie',other).set('Origin',origin).send({status:'selesai'}).expect(404);
  await request(app).put(base+'/orders/'+created.body.id).set('Cookie',cookie).set('Origin',origin).send({status:'diproses',notes:'Siap',total:1,customer:b.customer}).expect(200);
  const order=(await request(app).get(base+'/orders').set('Cookie',cookie).expect(200)).body[0];assert.equal(order.total,250000);assert.equal(order.customer,a.customer);assert.equal(order.status,'diproses');
  assert.deepEqual((await request(app).get(base+'/orders').set('Cookie',other).expect(200)).body,[]);
 }finally{await gateway.stop();await rm(root,{recursive:true,force:true});}
});
