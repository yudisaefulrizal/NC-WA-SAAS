import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {db} from '../src/db.js';
import {TenantWebhooks} from '../src/webhooks.js';
const ids:string[]=[];
async function account(){const id=randomUUID();ids.push(id);await db.execute('INSERT INTO accounts(id,email,password_hash) VALUES (?,?,?)',[id,id+'@test.invalid','unused']);return id;}
after(async()=>{for(const id of ids)await db.execute('DELETE FROM accounts WHERE id=?',[id]);await db.end();});
test('Subscriptions deduplicate under concurrency, filter per tenant, survive restart and revoke queued retries',async()=>{
 const a=await account(),b=await account();let sends=0;let fail=true;const delivered:unknown[]=[];
 const worker=new TenantWebhooks(async(_url,payload)=>{sends++;delivered.push(payload);if(fail)throw Error('fixture failure');},a);
 try{
  const subscriptions=await Promise.all(Array.from({length:5},()=>worker.add(a,{url:'https://8.8.8.8/hook'},()=>{})));assert.equal(new Set(subscriptions.map(r=>r.id)).size,1);
  await worker.add(b,{url:'https://8.8.8.8/hook',sessionId:'shop'},()=>{});
  await assert.rejects(worker.remove(b,subscriptions[0].id),{code:'webhook_not_found'});
  await assert.rejects(worker.add(a,{url:'http://127.0.0.1/private'},()=>{}),{code:'invalid_request'});
  await worker.enqueue(a,{event:'message',sessionId:'shop',messageId:'only-a'});
  const [before]=await db.execute<any[]>('SELECT account_id,payload FROM webhook_deliveries WHERE account_id IN (?,?)',[a,b]);assert.equal(before.length,1);assert.equal(before[0].account_id,a);
  await worker.tick();assert.equal(sends,1);await worker.remove(a,subscriptions[0].id);await db.execute('UPDATE webhook_deliveries SET next_at=UTC_TIMESTAMP() WHERE account_id=?',[a]);await worker.tick();assert.equal(sends,1);
  await worker.add(a,{url:'https://8.8.8.8/new',sessionId:'shop'},()=>{});await worker.enqueue(a,{event:'message',sessionId:'other'});const [filtered]=await db.execute<any[]>('SELECT id FROM webhook_deliveries WHERE account_id=?',[a]);assert.equal(filtered.length,0);
  await worker.enqueue(a,{event:'message',sessionId:'shop',messageId:'persisted'});
  await worker.stop();fail=false;const restored=new TenantWebhooks(async(_url,payload)=>{delivered.push(payload);},a);try{await restored.tick();}finally{await restored.stop();}
  assert.equal((delivered.at(-1) as any).messageId,'persisted');const [remaining]=await db.execute<any[]>('SELECT id FROM webhook_deliveries WHERE account_id=?',[a]);assert.equal(remaining.length,0);
 }finally{await worker.stop();}
});
