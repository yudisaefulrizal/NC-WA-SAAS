// Explicit local-only bootstrap; never load development credentials into browser/runtime bundles.
import {readFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {db} from '../../src/libraries/db.js';
import {ai} from '../../src/components/ai/domain/service.js';
import {defaults} from '../../src/components/ai/domain/provider.js';
try{
 const current=await ai.configuration();
 if(!current.configured){
  const local=parseEnv(await readFile('.envpengembangan','utf8'));
  if(!local.apikey_ai)throw Error('missing_local_key');
  const [owners]=await db.query<any[]>("SELECT id FROM accounts WHERE role='owner' AND suspended=FALSE LIMIT 1");
  if(!owners[0])throw Error('missing_owner');
  await ai.configure(owners[0].id,{...defaults,endpoint:local.endpoint_ai??defaults.endpoint,model:local.model_ai??defaults.model,apiKey:local.apikey_ai});
  console.log('Konfigurasi AI lokal disimpan terenkripsi. Harga jual belum diaktifkan.');
 }else console.log('Konfigurasi AI sudah tersedia; tidak ditimpa.');
 if(process.argv.includes('--test'))console.log((await ai.test()).message);
}catch{console.error('Setup/tes AI belum berhasil. Periksa konfigurasi lokal, kunci enkripsi, akun pemilik, dan akses penyedia.');process.exitCode=1;}
finally{await db.end();}
