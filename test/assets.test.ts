// A browser reusing a stale app.js after a deploy looks exactly like a broken feature, so every
// page must hand out asset URLs that change whenever the file behind them changes.
import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import request from 'supertest';
import {app} from '../src/app.js';
import {db} from '../src/db.js';

after(async()=>{await db.end();});

const hashOf=(name:string)=>createHash('sha256').update(readFileSync('public/'+name)).digest('hex').slice(0,12);

test('pages reference assets by content hash and hashed URLs are cached immutably',async()=>{
 const page=(await request(app).get('/dashboard').expect(200)).text;
 const script=page.match(/\/app\.js\?v=([a-f0-9]{12})/);
 const style=page.match(/\/style\.css\?v=([a-f0-9]{12})/);
 assert.ok(script,'halaman tidak merujuk app.js berversi');
 assert.ok(style,'halaman tidak merujuk style.css berversi');
 // The stamp must be derived from the file, otherwise a deploy would not invalidate anything.
 assert.equal(script[1],hashOf('app.js'));
 assert.equal(style[1],hashOf('style.css'));
 // No unversioned reference may survive, or that one request keeps serving a stale copy.
 assert.doesNotMatch(page,/["'(]\/app\.js(?!\?v=)/,'masih ada rujukan app.js tanpa versi');
 assert.doesNotMatch(page,/["'(]\/style\.css(?!\?v=)/,'masih ada rujukan style.css tanpa versi');

 const asset=await request(app).get(script[0]).expect(200);
 assert.match(asset.headers['cache-control'],/immutable/,'aset berhash tidak dicache permanen');
 assert.match(asset.headers['cache-control'],/max-age=31536000/);
 // Without the stamp the file must keep revalidating, so an old link never sticks forever.
 const plain=await request(app).get('/app.js').expect(200);
 assert.doesNotMatch(plain.headers['cache-control']??'',/immutable/,'aset tanpa versi ikut dicache permanen');
});

test('the AI Studio page is versioned with its own assets', async()=>{
 const page=(await request(app).get('/dashboard/admin/ai-studio').expect(200)).text;
 assert.match(page,new RegExp('/ai-studio\\.js\\?v='+hashOf('ai-studio.js')));
 assert.match(page,new RegExp('/ai-studio\\.css\\?v='+hashOf('ai-studio.css')));
});
