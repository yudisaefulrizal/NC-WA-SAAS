import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseOrderText,validateOrderOutput,extractOrderJson,catalogName} from '../src/ai-order-schema.js';
const names=['Kopi Susu','Teh Manis','Xiaomi Redmi','Roti, Keju','3 Second Coffee'];
const order=(items:[string,number][],notes='')=>({items:items.map(([product_name,quantity])=>({product_name,quantity})),notes});

test('Parser reads the fixed line format and its common variants',()=>{
 assert.deepEqual(parseOrderText('2 x Kopi Susu; 1 x Teh Manis; catatan: kurang manis',names),order([['Kopi Susu',2],['Teh Manis',1]],'kurang manis'));
 assert.deepEqual(parseOrderText('2x kopi  susu\n1 Teh Manis',names),order([['Kopi Susu',2],['Teh Manis',1]]));
 assert.deepEqual(parseOrderText('Kopi Susu x 3',names),order([['Kopi Susu',3]]));
 assert.deepEqual(parseOrderText('2 Kopi Susu, 1 x Teh Manis, catatan: antar sore; bayar tunai',names),order([['Kopi Susu',2],['Teh Manis',1]],'antar sore; bayar tunai'));
 // Names that start with x, contain commas, or start with a number keep their exact spelling.
 assert.deepEqual(parseOrderText('2 Xiaomi Redmi',names),order([['Xiaomi Redmi',2]]));
 assert.deepEqual(parseOrderText('1 x Roti, Keju',names),order([['Roti, Keju',1]]));
 assert.deepEqual(parseOrderText('1 x 3 Second Coffee',names),order([['3 Second Coffee',1]]));
 assert.deepEqual(parseOrderText('2 x Kopi Susu; 2 x kopi susu',names),order([['Kopi Susu',2]]));
});
test('Parser returns null instead of guessing',()=>{
 for(const text of ['','Kopi Susu','dua kopi susu','2 x Kopi','2 x Es Teh','2 x Kopi Susu; 3 x Kopi Susu','0 x Kopi Susu','3 Second Coffee','catatan: kurang manis'])assert.equal(parseOrderText(text,names),null,text);
});
test('Catalog names match loosely but only when exactly one product fits',()=>{
 assert.equal(catalogName('  KOPI   susu ',names),'Kopi Susu');
 assert.equal(catalogName('Kopi',names),undefined);
 assert.equal(catalogName('kopi susu',['Kopi Susu','KOPI SUSU']),undefined);
});
test('AI replies are repaired deterministically, then validated against the catalog',()=>{
 assert.deepEqual(validateOrderOutput(extractOrderJson('Berikut hasilnya:\n```json\n{"lengkap":true,"items":[{"product_name":"kopi susu","quantity":"2"}],"notes":"kurang manis"}\n```'),names),order([['Kopi Susu',2]],'kurang manis'));
 assert.deepEqual(validateOrderOutput({lengkap:true,items:[{product_name:'Kopi Susu',quantity:2},{product_name:'Kopi Susu',quantity:2}]},names),order([['Kopi Susu',2]]));
 assert.equal(validateOrderOutput({lengkap:false,items:[],notes:''},names),null);
 for(const value of [{lengkap:true,items:[{product_name:'Es Teh',quantity:1}],notes:''},{lengkap:true,items:[{product_name:'Kopi Susu',quantity:1},{product_name:'Kopi Susu',quantity:2}],notes:''},{lengkap:true,items:[{product_name:'Kopi Susu',quantity:'dua'}],notes:''},{lengkap:true,items:[],notes:''},{lengkap:'ya',items:[],notes:''},{lengkap:true,items:[{product_name:'Kopi Susu',quantity:1}],notes:'',extra:1}])assert.throws(()=>validateOrderOutput(value as any,names),/ai_invalid_order/);
 for(const raw of ['tidak ada JSON','{rusak}','[1,2]'])assert.throws(()=>extractOrderJson(raw),/ai_invalid_order/);
});
