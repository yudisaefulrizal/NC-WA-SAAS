// Drives the Auto Share template dialog in a real browser: the source picker must reshape the form,
// custom header rows must be addable, and variables from a test call must insert into the message.
import {chromium} from 'playwright';
import {randomUUID} from 'node:crypto';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import {db} from '../src/db.js';
import {digest} from '../src/security.js';
import {createGateway} from '../src/gateway.js';

if(process.env.AUTO_SHARE_ISOLATED!=='1')throw Error('Jalankan melalui scripts/test-auto-share.ts agar antrean terisolasi.');
const temporary=await mkdtemp(join(tmpdir(),'ncwa-template-source-'));
const slot=net.createServer();await new Promise<void>(r=>slot.listen(0,'127.0.0.1',r));
const port=(slot.address() as net.AddressInfo).port;await new Promise<void>(r=>slot.close(()=>r()));
const origin='http://127.0.0.1:'+port;process.env.APP_ORIGIN=origin;
const {createApp}=await import('../src/app.js');
const gateway=createGateway(()=>async(_id,update)=>{update({status:'connected'});return {close(){},async logout(){},async typing(){},async send(){return randomUUID();}};},temporary);
const server=createApp(gateway).listen(port,'127.0.0.1');
const account=randomUUID(),token=randomUUID();
let browser;
try{
 await db.execute('INSERT INTO accounts(id,email,password_hash) VALUES (?,?,?)',[account,account+'@test.invalid','unused']);
 await db.execute('INSERT INTO login_sessions VALUES (?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR))',[digest(token),account]);
 browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});
 for(const viewport of [{width:1280,height:900},{width:390,height:780}]){
  const context=await browser.newContext({viewport});
  await context.addCookies([{name:'ncwa_session',value:token,url:origin}]);
  const page=await context.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  // validatePublicUrl rightly refuses a loopback endpoint, so the real transport is covered by the
  // backend tests and the dialog's own call is answered here.
  let sentHeaders:{name:string;value:string}[]=[];
  await page.route('**/auto-share/templates/test-source',async route=>{
   sentHeaders=JSON.parse(route.request().postData()??'{}').source_headers??[];
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,variables:{jumlah:'247',sisa_kuota:'53',poster:'https://example.com/poster.png'},media:null,raw:'{\n "jumlah": 247\n}'})});
  });
  await page.goto(origin+'/dashboard/auto-share');
  await page.locator('[data-share-tab="templates"]').click();
  await page.locator('#share-add-template').click();
  await page.locator('#share-template-dialog[open]').waitFor();

  // Step 1: with no source, the form stays exactly as it was before this feature.
  assert.equal(await page.locator('#share-source-fields').isHidden(),true,'blok sumber tampil padahal sumber data kosong');
  assert.equal(await page.locator('#share-variable-bar').isHidden(),true,'baris variabel tampil tanpa sumber data');
  await page.locator('#share-media-type').selectOption('image');
  assert.equal(await page.locator('#share-asset-field').isHidden(),false,'pilihan asset hilang untuk template gambar');
  // The endpoint media option must not even be offered until a data source exists.
  assert.equal(await page.locator('#share-media-source option[value="endpoint"]').evaluate(o=>(o as HTMLOptionElement).hidden),true,'opsi media endpoint tampil tanpa sumber data');

  // Step 2: choosing the endpoint source reveals the extra fields.
  await page.locator('#share-source-mode').selectOption('endpoint');
  assert.equal(await page.locator('#share-source-fields').isHidden(),false,'blok sumber tidak muncul setelah dipilih');
  assert.equal(await page.locator('#share-media-source option[value="endpoint"]').evaluate(o=>(o as HTMLOptionElement).hidden),false,'opsi media endpoint tidak muncul setelah sumber dipilih');

  // Step 3: custom headers are addable and removable.
  await page.locator('#share-header-add').click();
  await page.locator('#share-header-rows .header-row').first().waitFor();
  assert.equal(await page.locator('#share-header-rows .header-row').count(),1,'baris header tidak bertambah');
  await page.locator('#share-header-rows .header-row [data-header-name]').fill('X-API-Key');
  await page.locator('#share-header-rows .header-row [data-header-value]').fill('rahasia');

  // Step 4: testing the endpoint lists the variables and shows the raw response.
  await page.locator('[name="source_endpoint"]').fill('https://ppdb.example.com/statistik');
  await page.locator('#share-source-test').click();
  await page.locator('#share-source-vars button').first().waitFor();
  assert.equal(await page.locator('#share-source-vars button').count(),3,'variabel tidak lengkap');
  assert.match(await page.locator('#share-source-result').innerText(),/3 variabel tersedia/);
  assert.equal(await page.locator('#share-variable-bar').isHidden(),false,'baris variabel tidak muncul setelah tes');
  assert.deepEqual(sentHeaders,[{name:'X-API-Key',value:'rahasia'}],'header custom tidak dikirim ke server');
  assert.match(await page.locator('#share-source-result').innerText(),/Lihat respons endpoint/,'respons mentah tidak ditawarkan');

  // Step 5: media from the endpoint is picked by variable name, not a dedicated media block.
  await page.locator('#share-media-source').selectOption('endpoint');
  assert.equal(await page.locator('#share-media-variable-field').isHidden(),false,'pemilih variabel media tidak muncul');
  assert.equal(await page.locator('#share-asset-field').isHidden(),true,'pilihan galeri masih tampil untuk media endpoint');
  assert.deepEqual(await page.locator('#share-media-variable option').allTextContents(),['jumlah','sisa_kuota','poster'],'daftar variabel media tidak terisi dari hasil tes');
  await page.locator('#share-media-variable').selectOption('poster');
  await page.locator('#share-media-source').selectOption('asset');
  assert.equal(await page.locator('#share-media-variable-field').isHidden(),true,'pemilih variabel media tidak tersembunyi kembali');

  // Step 6: clicking a variable inserts it into the message at the caret.
  await page.locator('[name="message"]').fill('Pendaftar ');
  await page.locator('#share-source-vars button').first().click();
  assert.match(await page.locator('[name="message"]').inputValue(),/\{\{jumlah\}\}/,'variabel tidak tersisip ke pesan');

  // Step 7: switching back to no source collapses everything again.
  await page.locator('#share-source-mode').selectOption('none');
  assert.equal(await page.locator('#share-source-fields').isHidden(),true,'blok sumber tidak tersembunyi kembali');
  assert.equal(await page.locator('#share-variable-bar').isHidden(),true,'baris variabel tidak tersembunyi kembali');
  assert.equal(await page.locator('#share-media-source').inputValue(),'asset','sumber media tidak kembali ke galeri');

  // Step 8: saving works end to end, and the notification must clear the open dialog. A dialog from
  // showModal() lives in the top layer, so a plain z-index would leave the banner hidden behind it.
  // The gallery is empty in this fixture, so a media template could not be saved here anyway.
  await page.locator('#share-media-type').selectOption('text');
  await page.locator('#share-template-form [name="name"]').fill('Template Sumber');
  await page.locator('#share-template-form [name="message"]').fill('Halo tanpa variabel');
  await page.locator('#share-template-form button:not([type=button])').click();
  await page.locator('#message:popover-open').waitFor();
  assert.match(await page.locator('#message').innerText(),/Template tersimpan/,'simpan template gagal');
  const covered=await page.locator('#message').evaluate(el=>{
   const box=el.getBoundingClientRect();
   const hit=document.elementFromPoint(box.left+box.width/2,box.top+box.height/2);
   return !(hit===el||el.contains(hit));
  });
  assert.equal(covered,false,'notifikasi tertutup elemen lain meski dialog sudah ditutup');

  // Nothing above may rely on a thrown-away page error.
  assert.deepEqual(errors,[],'error JavaScript di halaman: '+errors.join(' | '));
  await context.close();
 }
 console.log('Pemeriksaan browser form sumber data template lulus (desktop dan ponsel).');
}finally{
 await browser?.close();
 await new Promise<void>(r=>{server.close(()=>r());});
 await db.execute('DELETE FROM accounts WHERE id=?',[account]).catch(()=>{});
 await db.end().catch(()=>{});
 await rm(temporary,{recursive:true,force:true});
}
