import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import request from 'supertest';
import {app} from '../src/app.js';
import {db} from '../src/db.js';
import {hashPassword,verifyPassword,credentials} from '../src/security.js';
const origin=process.env.APP_ORIGIN??'http://127.0.0.1:8067';
const emails:string[]=[];
after(async()=>{for(const email of emails){await db.execute('DELETE e FROM audit_events e JOIN accounts a ON a.id=e.account_id WHERE a.email=?',[email]);await db.execute('DELETE FROM accounts WHERE email=?',[email]);}await db.end();});
test('Password hashed with unique salt; malformed credentials rejected',async()=>{const a=await hashPassword('password-aman-123');const b=await hashPassword('password-aman-123');assert.notEqual(a,b);assert.equal(await verifyPassword('password-aman-123',a),true);assert.equal(await verifyPassword('salah',a),false);assert.equal(credentials({email:{},password:'a'}),null);});
test('Registration cannot set owner; cookie auth, CSRF, cross-account key deletion and logout',async()=>{
 const email=`test-${randomUUID()}@example.test`;const other=`test-${randomUUID()}@example.test`;emails.push(email,other);const password='test-password-long-123';
 await request(app).post('/api/auth/register').set('Origin','https://evil.example').send({email,password}).expect(403);
 await request(app).post('/api/auth/register').set('Origin',origin).send({email,password,role:'owner'}).expect(201);
 await request(app).post('/api/auth/register').set('Origin',origin).send({email:other,password}).expect(201);
 const a=request.agent(app),b=request.agent(app);
 await a.post('/api/auth/login').set('Origin',origin).send({email,password:'wrong-password-123'}).expect(401);
 const login=await a.post('/api/auth/login').set('Origin',origin).send({email,password}).expect(200);
 assert.match(login.headers['set-cookie'][0],/HttpOnly/);
 await b.post('/api/auth/login').set('Origin',origin).send({email:other,password}).expect(200);
 assert.equal((await a.get('/api/me').expect(200)).body.role,'user');
 await a.get('/api/admin/accounts').expect(403);
 const key=(await a.post('/api/keys').set('Origin',origin).expect(201)).body;
 assert.match(key.key,/^ncwa_/);
 assert.equal((await request(app).get('/api/client/me').set('X-API-Key',key.key).expect(200)).body.email,email);
 await request(app).get('/api/admin/accounts').set('X-API-Key',key.key).expect(401);
 assert.equal((await a.get('/api/keys')).body[0].key,undefined);
 await b.delete('/api/keys/'+key.id).set('Origin',origin).expect(200);
 assert.equal((await a.get('/api/keys')).body.length,1);
 await a.delete('/api/keys/'+key.id).set('Origin',origin).expect(200);
 assert.equal((await a.get('/api/keys')).body.length,0);
 await request(app).get('/api/client/me').set('X-API-Key',key.key).expect(401);
 await a.post('/api/auth/logout').set('Origin','https://evil.example').expect(403);
 await a.post('/api/auth/logout').set('Origin',origin).expect(200);
 await a.get('/api/me').expect(401);
});

test('Key rotation is atomic, revokes old credentials and denies another account',async()=>{
 const email='test-'+randomUUID()+'@example.test';emails.push(email);const password='rotation-password-long';await request(app).post('/api/auth/register').set('Origin',origin).send({email,password}).expect(201);
 const a=request.agent(app);await a.post('/api/auth/login').set('Origin',origin).send({email,password}).expect(200);
 const old=(await a.post('/api/keys').set('Origin',origin).expect(201)).body;const results=await Promise.all([1,2].map(()=>a.post('/api/keys/'+old.id+'/rotate').set('Origin',origin)));
 assert.deepEqual(results.map(r=>r.status).sort(),[200,404]);const next=results.find(r=>r.status===200)!.body;await request(app).get('/api/client/me').set('X-API-Key',old.key).expect(401);await request(app).get('/api/client/me').set('X-API-Key',next.key).expect(200);
 assert.equal((await a.get('/api/keys').expect(200)).body.length,1);
});

test('Owner can replace a customer password, revoking their login sessions',async()=>{
 const owner='test-'+randomUUID()+'@example.test',customer='test-'+randomUUID()+'@example.test',oldPassword='customer-password-old',newPassword='customer-password-new';emails.push(owner,customer);
 await request(app).post('/api/auth/register').set('Origin',origin).send({email:owner,password:'owner-password-long'}).expect(201);await request(app).post('/api/auth/register').set('Origin',origin).send({email:customer,password:oldPassword}).expect(201);await db.execute("UPDATE accounts SET role='owner' WHERE email=?",[owner]);
 const ownerAgent=request.agent(app),customerAgent=request.agent(app);await ownerAgent.post('/api/auth/login').set('Origin',origin).send({email:owner,password:'owner-password-long'}).expect(200);await customerAgent.post('/api/auth/login').set('Origin',origin).send({email:customer,password:oldPassword}).expect(200);
 const [rows]=await db.execute<any[]>('SELECT id FROM accounts WHERE email=?',[customer]);const id=rows[0].id;
 await ownerAgent.put('/api/admin/accounts/'+id+'/password').set('Origin',origin).send({password:'short'}).expect(400);await ownerAgent.put('/api/admin/accounts/'+id+'/password').set('Origin',origin).send({password:newPassword}).expect(200);
 await customerAgent.get('/api/me').expect(401);await request(app).post('/api/auth/login').set('Origin',origin).send({email:customer,password:oldPassword}).expect(401);await request(app).post('/api/auth/login').set('Origin',origin).send({email:customer,password:newPassword}).expect(200);
 const [ownerRow]=await db.execute<any[]>('SELECT id FROM accounts WHERE email=?',[owner]);await ownerAgent.put('/api/admin/accounts/'+ownerRow[0].id+'/password').set('Origin',origin).send({password:newPassword}).expect(409);await request(app).put('/api/admin/accounts/'+id+'/password').set('Origin',origin).send({password:newPassword}).expect(401);
});

test('An account can change its own password and retains only its current session',async()=>{
 const email='test-'+randomUUID()+'@example.test',oldPassword='self-password-old',newPassword='self-password-new';emails.push(email);await request(app).post('/api/auth/register').set('Origin',origin).send({email,password:oldPassword}).expect(201);
 const active=request.agent(app),other=request.agent(app);await active.post('/api/auth/login').set('Origin',origin).send({email,password:oldPassword}).expect(200);await other.post('/api/auth/login').set('Origin',origin).send({email,password:oldPassword}).expect(200);
 await active.put('/api/auth/password').set('Origin',origin).send({currentPassword:'wrong-password',password:newPassword}).expect(401);await active.put('/api/auth/password').set('Origin',origin).send({currentPassword:oldPassword,password:newPassword}).expect(200);
 await active.get('/api/me').expect(200);await other.get('/api/me').expect(401);const [rows]=await db.execute<any[]>('SELECT password_hash FROM accounts WHERE email=?',[email]);assert.equal(await verifyPassword(oldPassword,rows[0].password_hash),false);assert.equal(await verifyPassword(newPassword,rows[0].password_hash),true);
});
