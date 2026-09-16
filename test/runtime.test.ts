import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {acquireEngineLock} from '../src/runtime.js';
import {db} from '../src/db.js';
after(()=>db.end());
test('Database lock excludes another worker and releases cleanly',async()=>{
 const name='test-'+randomUUID();const first=await acquireEngineLock(name);try{await assert.rejects(acquireEngineLock(name),/Engine sudah berjalan/);}finally{await first.release();}
 const second=await acquireEngineLock(name);await second.release();
});
