// Drives the Auto Share job dialog: every rejection jobInput() can produce must be visible before
// the request, the reach summary must count unique recipients, and contacts must be searchable.
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
const temporary=await mkdtemp(join(tmpdir(),'ncwa-job-form-'));
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
 const {basicWallet}=await import('../src/plans.js');await basicWallet(account);
 // Two contacts share the "Wali" group, so picking that group plus one of them must still count
 // three unique recipients, not four.
 const contacts=[['628111000001','Wali'],['628111000002','Wali'],['628111000003','']];
 for(const [nomor,group] of contacts)await db.execute('INSERT INTO daftar_kontak(id,account_id,nomor,kelompkontak) VALUES (?,?,?,?)',[randomUUID(),account,nomor,group]);
 for(const name of ['Promo Pagi','Info Promo'])await db.execute("INSERT INTO auto_share_templates(id,account_id,name,message,media_type,session_id,contacts,groups_json,content_migrated) VALUES (?,?,?,?,'text','',JSON_ARRAY(),JSON_ARRAY(),TRUE)",[randomUUID(),account,name,'Isi '+name]);

 browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH});
 for(const viewport of [{width:1280,height:900},{width:390,height:780}]){
  const context=await browser.newContext({viewport});
  await context.addCookies([{name:'ncwa_session',value:token,url:origin}]);
  // A job needs a sender session; the fake gateway reports it connected straight away.
  await context.request.post(origin+'/sessions',{headers:{Origin:origin},data:{id:'shop'}});
  const page=await context.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/dashboard/auto-share');
  await page.locator('[data-share-tab="jobs"]').click();
  await page.locator('#share-add-job').click();
  await page.locator('#share-job-dialog[open]').waitFor();

  // A fresh form cannot be saved, and says exactly what is missing instead of failing server-side.
  assert.equal(await page.locator('#share-job-save').isDisabled(),true,'tombol simpan aktif padahal form kosong');
  const blocker=page.locator('#share-job-blocker');
  assert.match(await blocker.innerText(),/pilih minimal satu template/,'template kosong tidak diberitahukan');
  assert.match(await blocker.innerText(),/pilih kontak atau kelompok tujuan/,'tujuan kosong tidak diberitahukan');
  assert.match(await page.locator('#share-target-summary').innerText(),/Belum ada tujuan/,'ringkasan tujuan tidak menyebut kondisi kosong');

  await page.locator('#share-job-form [name="name"]').fill('Jadwal Promo');
  await page.locator('#share-job-next').click();
  assert.equal(await page.locator('[data-share-job-step="2"]').isHidden(),false,'langkah template dan tujuan tidak terbuka');

  // Adding a second template reveals the rotation order.
  assert.equal(await page.locator('#share-rotation-preview').isHidden(),true,'pratinjau rotasi tampil untuk satu template');
  await page.locator('#share-choose-template').selectOption({label:'Promo Pagi'});
  await page.locator('#share-append-template').click();
  await page.locator('#share-choose-template').selectOption({label:'Info Promo'});
  await page.locator('#share-append-template').click();
  assert.match(await page.locator('#share-rotation-preview').innerText(),/Promo Pagi → Info Promo/,'urutan rotasi tidak ditampilkan');

  // Contacts are checkboxes and searchable, so no Ctrl/Cmd and no unbounded list.
  assert.equal(await page.locator('#share-target-contacts .check-row').count(),3,'daftar kontak tidak lengkap');
  await page.locator('#share-contact-search').fill('000003');
  assert.equal(await page.locator('#share-target-contacts .check-row').count(),1,'pencarian kontak tidak menyaring');
  await page.locator('#share-contact-search').fill('');
  // Contacts are listed by group then number, so this is a member of "Wali" — the overlap case.
  await page.locator('#share-target-contacts .check-row').filter({hasText:'628111000001'}).locator('input').check();
  assert.match(await page.locator('#share-target-summary').innerText(),/1 tujuan unik/,'ringkasan tidak menghitung kontak terpilih');

  // The overlap between a picked contact and its group must be stated, not silently deduplicated.
  await page.locator('#share-target-groups').selectOption(['Wali']);
  const summary=await page.locator('#share-target-summary').innerText();
  assert.match(summary,/2 tujuan unik/,'tujuan unik salah dihitung: '+summary);
  assert.match(summary,/1 nomor tumpang tindih/,'tumpang tindih tidak diberitahukan: '+summary);
  assert.equal(await page.locator('#share-job-save').isDisabled(),false,'tombol simpan masih terkunci padahal lengkap');

  // Enabling the schedule demands a time, and a past time is refused in the form itself.
  await page.locator('#share-job-next').click();
  assert.equal(await page.locator('[data-share-job-step="3"]').isHidden(),false,'langkah jadwal tidak terbuka');
  await page.locator('#share-job-form [name="enabled"]').check();
  assert.match(await blocker.innerText(),/isi waktu pengiriman pertama/,'waktu kosong tidak diberitahukan');
  assert.equal(await page.locator('#share-job-save').isDisabled(),true,'simpan aktif padahal waktu kosong');
  assert.ok(await page.locator('#share-job-form [name="next_at"]').getAttribute('min'),'input waktu tidak membatasi masa lalu');
  await page.locator('#share-job-form [name="next_at"]').fill('2020-01-01T08:00');
  assert.match(await blocker.innerText(),/waktu pengiriman harus di masa depan/,'waktu lampau tidak ditolak di form');

  const future=new Date(Date.now()+86400000);
  await page.locator('#share-job-form [name="next_at"]').fill(new Date(future.getTime()-future.getTimezoneOffset()*60000).toISOString().slice(0,16));
  assert.equal(await page.locator('#share-job-blocker').isHidden(),true,'peringatan masih tampil padahal form lengkap');

  // Saving must round-trip: reopening shows the same contacts, groups and rotation.
  await page.locator('#share-job-save').click();
  await page.locator('#message:popover-open').waitFor();
  assert.match(await page.locator('#message').innerText(),/Pengiriman tersimpan/,'simpan pengiriman gagal');
  await page.locator('#share-job-list').getByText('Jadwal Promo',{exact:true}).waitFor();
  await page.locator('#share-job-list').getByRole('button',{name:'Ubah',exact:true}).first().click();
  await page.locator('#share-job-dialog[open]').waitFor();
  await page.locator('[data-share-job-step-indicator="2"]').click();
  assert.equal(await page.locator('#share-target-contacts input:checked').count(),1,'kontak terpilih tidak dipulihkan');
  assert.deepEqual(await page.locator('#share-target-groups').inputValue(),'Wali','kelompok terpilih tidak dipulihkan');
  assert.equal(await page.locator('#share-order li').count(),2,'urutan template tidak dipulihkan');

  assert.deepEqual(errors,[],'error JavaScript di halaman: '+errors.join(' | '));
  await page.locator('#share-job-dialog [data-close="share-job-dialog"]').click();
  // The saved job is removed so the phone-sized pass starts from the same state as the desktop one.
  await db.execute('DELETE FROM auto_share_jobs WHERE account_id=?',[account]);
  await context.close();
 }
 console.log('Pemeriksaan browser form pengiriman/jadwal lulus (desktop dan ponsel).');
}finally{
 await browser?.close();
 await new Promise<void>(r=>{server.close(()=>r());});
 await db.execute('DELETE FROM accounts WHERE id=?',[account]).catch(()=>{});
 await db.end().catch(()=>{});
 await rm(temporary,{recursive:true,force:true});
}
