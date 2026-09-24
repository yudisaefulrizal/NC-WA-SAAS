const $=id=>document.getElementById(id),fields=id=>Object.fromEntries(new FormData($(id)));
async function api(path,method='GET',body,headers={}){const response=await fetch(path,{method,headers:{'Content-Type':'application/json',...headers},body:body?JSON.stringify(body):undefined});const data=await response.json().catch(()=>({error:'rate_limited'}));if(!response.ok){const messages={invalid_request:'Periksa isian formulir.',unauthorized:'Email, password, atau kredensial tidak valid.',account_exists:'Email sudah terdaftar.',invalid_origin:'Buka alamat aplikasi yang dikonfigurasi.',forbidden:'Akses tidak diizinkan.',internal_error:'Terjadi gangguan server.',rate_limited:'Terlalu banyak permintaan; coba lagi nanti.'};const e=Error(data.message||messages[data.error]||data.error);e.status=response.status;throw e;}return data;}
async function run(fn){$('message').textContent='';try{await fn();}catch(e){$('message').textContent=e.message;}}
// A dialog opened with showModal() sits in the browser's top layer, above every z-index, so the
// notification has to join that layer to stay visible. It is a popover, shown and hidden here
// centrally: the 35 call sites keep assigning textContent as before.
{const banner=$('message');
 const sync=()=>{const wanted=Boolean(banner.textContent.trim());
  // Both calls throw if the state already matches, and hidePopover() also throws when the element
  // is not connected, so each is guarded rather than tracked with a flag.
  try{if(wanted)banner.showPopover();else banner.hidePopover();}catch{}};
 new MutationObserver(sync).observe(banner,{childList:true,characterData:true,subtree:true});
 sync();}
// type='button' is essential: these buttons render inside #ai-form (Kelola/Edit rows, etc.) and a
// bare <button> defaults to type=submit, which used to be harmless only because the old "Simpan
// semua tab" submit handler called preventDefault() on every submit of that form. Now that submit
// handler is gone (autosave replaced it), a submit-type button here would trigger a native GET
// form submission — a full page reload with every field dumped into the URL query string.
function button(title,action){const b=document.createElement('button');b.type='button';b.textContent=title;b.onclick=()=>run(async()=>{b.disabled=true;try{await action();}finally{b.disabled=false;}});return b;}
function list(id,items,render){if(!items.length){const li=document.createElement('li');li.className='empty';li.textContent=({sessions:'Belum ada nomor. Hubungkan sesi pertama Anda di atas.',keys:'Belum ada API key. Buat saat Anda siap menghubungkan aplikasi.',webhooks:'Belum ada webhook manual.',usage:'Belum ada pengiriman. Riwayat akan muncul setelah Anda mengirim pesan.',payments:'Belum ada pembayaran.',adminpayments:'Belum ada transaksi.',audit:'Belum ada aktivitas.'})[id]||'Belum ada data.';$(id).replaceChildren(li);return;}$(id).replaceChildren(...items.map(item=>{const li=document.createElement('li');render(li,item);return li;}));}
function table(id,columns,items,render){let host=$(id);if(host.tagName==='UL'){const replacement=document.createElement('div');replacement.id=id;host.replaceWith(replacement);host=replacement;}host.className='table-wrap';const t=document.createElement('table'),head=document.createElement('thead'),hr=document.createElement('tr'),body=document.createElement('tbody');for(const title of columns){const th=document.createElement('th');th.scope='col';th.textContent=title;hr.append(th);}head.append(hr);if(!items.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=columns.length;td.className='empty';td.textContent='Belum ada data.';tr.append(td);body.append(tr);}for(const item of items){const tr=document.createElement('tr');for(const value of render(item)){const td=document.createElement('td');if(value instanceof Node)td.append(value);else td.textContent=value??'—';tr.append(td);}body.append(tr);}t.append(head,body);host.replaceChildren(t);}
function form(id,action){$(id).onsubmit=e=>{e.preventDefault();const submit=$(id).querySelector('button[type="submit"],button:not([type])');void run(async()=>{submit.disabled=true;try{await action(fields(id));}finally{submit.disabled=false;}});};}
const money=n=>new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(n);
async function keys(){table('keys',['ID API key','Tindakan'],await api('/api/keys'),key=>{const actions=document.createElement('div');actions.className='row-actions';actions.append(button('Ganti key',async()=>{const replacement=await api('/api/keys/'+key.id+'/rotate','POST');$('secret').textContent='Simpan key pengganti: '+replacement.key;await keys();}),button('Cabut',async()=>{await api('/api/keys/'+key.id,'DELETE');await keys();}));return [key.id,actions];});}
let activePlanId;
async function wallet(){const w=await api('/api/wallet');activePlanId=w.plan_id;updateActivePlan();$('stat-credit').textContent=w.balance;$('stat-limit').textContent=w.session_limit;$('stat-plan').textContent=w.plan_id==='basic'?'Gratis':w.plan_id;$('stat-period').textContent=w.expires_at?'Berakhir '+new Date(w.expires_at).toLocaleDateString('id-ID'):'Reset setiap tanggal 1';$('wallet').textContent=`${w.plan_id} · ${w.balance} kredit tersedia · ${w.session_limit} nomor · ${w.expires_at?'berakhir '+new Date(w.expires_at).toLocaleString('id-ID'):'reset tanggal 1, 00.00 WIB'}`;}
function updateActivePlan(){document.querySelectorAll('#catalog [data-plan-id]').forEach(card=>{const active=card.dataset.planId===activePlanId;const label=card.querySelector('.active-plan-label');label.hidden=!active;const free=card.querySelector('.free-plan-action');if(free)free.textContent=active?'Paket aktif':'Paket dasar';});}
async function catalog(id,authenticated=false){const data=await api('/public/plans');const creditCard=authenticated&&id==='catalog'&&$('ai-credit-card-template')?$('ai-credit-card-template').content.cloneNode(true):null;$(id).replaceChildren(...[...(creditCard?[creditCard]:[]),...data.map(p=>{
 const article=document.createElement('article'),h=document.createElement('h3'),description=document.createElement('p');h.textContent=p.name;
 if(!authenticated){description.textContent=`${money(p.price)} / bulan · ${p.credits} kredit · ${p.session_limit} nomor`;article.append(h,description);return article;}
 article.className='package-card'+(p.price>0?' paid-package':'');article.dataset.planId=p.id;
 const head=document.createElement('div');head.className='package-card-head';const icon=document.createElement('span');icon.className='package-icon';icon.textContent=p.price>0?'♛':'♧';icon.setAttribute('aria-hidden','true');const heading=document.createElement('div');description.textContent=p.price>0?'Untuk kebutuhan bisnis dan alur kerja Anda.':'Cocok untuk mencoba dan penggunaan ringan.';heading.append(h,description);head.append(icon,heading);
 const active=document.createElement('span');active.className='active-plan-label';active.textContent='Paket aktif';active.hidden=true;
 const price=document.createElement('div');price.className='package-price';const amount=document.createElement('strong');amount.textContent=money(p.price);const period=document.createElement('span');period.textContent=' / bulan';price.append(amount,period);
 const features=document.createElement('ul');features.className='package-features';for(const text of [`${new Intl.NumberFormat('id-ID').format(p.credits)} kredit per bulan`,`${p.session_limit} nomor WhatsApp`,'Integrasi API dan webhook','Terhubung dengan workflow n8n']){const li=document.createElement('li');const check=document.createElement('span');check.textContent='✓';check.setAttribute('aria-hidden','true');li.append(check,document.createTextNode(text));features.append(li);}
 article.append(head,active,price,features);
 if(p.price>0){const buy=button('Beli paket',async()=>{selectedPlan=p;$('purchase-summary').textContent=`${p.name} · ${money(p.price)} · ${p.credits} kredit · ${p.session_limit} nomor`;$('purchase-modal').showModal();});buy.className='buy-package';buy.setAttribute('aria-label','Beli paket');article.append(buy);}else{const free=document.createElement('div');free.className='free-plan-action';free.textContent='Paket dasar';article.append(free);}
 return article;
})]);if(authenticated)updateActivePlan();if(creditCard)$('ai-buy').onclick=()=>{$('ai-credit-units').value='1';aiCreditSummary();$('ai-credit-modal').showModal();};}
async function usage(){list('usage',await api('/api/usage'),(li,r)=>{li.textContent=`${new Date(r.created_at).toLocaleString('id-ID')} · ${r.status} · ${r.request_id}${r.message_id?' · '+r.message_id:''}`;});}
async function webhooks(){table('webhooks',['URL webhook','Sesi','Tindakan'],await api('/webhooks'),w=>[w.url,w.sessionId||'Semua sesi',button('Cabut',async()=>{await api('/webhooks/'+w.id,'DELETE');await webhooks();})]);}
let shareRealtime;
function startShareRealtime(){if(shareRealtime||typeof EventSource==='undefined')return;shareRealtime=new EventSource('/events');shareRealtime.onmessage=event=>{let data;try{data=JSON.parse(event.data);}catch{return;}if(data.event==='message')recordReceivedTest(data);chatRealtime(data);if(data.event!=='auto_share.contact_added'||$('dashboard').hidden||$('auto-share').hidden)return;void run(async()=>{await loadAutoShare();$('message').textContent=(data.isGroup?'Grup ':'Kontak ')+(data.nama?data.nama+' · ':'')+data.nomor+' ditambahkan otomatis.';});};}
async function show(){
 document.body.classList.remove('workspace','client-workspace');$('siteheader').hidden=false;if(location.pathname==='/'){$('landing').hidden=false;$('autharea').hidden=true;$('dashboard').hidden=true;await Promise.all([landingAuth(),catalog('publicplans')]);return;}
 let me;try{me=await api('/api/me');}catch(e){if(e.status!==401)throw e;$('autharea').hidden=false;$('dashboard').hidden=true;setAuthMode(location.pathname==='/register');return;}
 document.body.classList.add('workspace');$('siteheader').hidden=true;$('landing').hidden=true;$('autharea').hidden=true;$('dashboard').hidden=false;$('welcome').textContent=me.email;$('role').textContent=me.role==='owner'?'Pemilik layanan':'Pengguna';$('admin').hidden=$('adminlink').hidden=me.role!=='owner';$('baseurl').textContent=location.origin;document.querySelectorAll('.api-origin').forEach(el=>el.textContent=location.origin);
 const owner=me.role==='owner';document.body.classList.toggle('client-workspace',!owner);if(!owner){const nav=$('docslink').parentElement;nav.insertBefore($('docslink'),nav.querySelector('a[href="/dashboard/paket"]'));wrapClientNav(nav);}else addAdminMenuToggle($('docslink').parentElement);$('wallet').hidden=owner;document.querySelectorAll('.tabs > a:not(.sidebar-brand):not(#adminlink):not(#docslink),.tabs .nav-links > a:not(#docslink)').forEach(a=>a.hidden=owner);navigate();if(owner)await admin();else{startShareRealtime();await catalog('catalog',true);await Promise.all([keys(),sessions(),wallet(),usage(),webhooks(),paymentList(),loadAI(),loadAutoShare(),loadReferral()]);}
}
async function landingAuth(){
 const login=document.querySelector('#siteheader a[href="/login"]'),signup=document.querySelector('#siteheader .button'),cta=document.querySelector('#landing .hero .button');
 login.hidden=signup.hidden=cta.hidden=true;
 let authenticated=false;
 try{await api('/api/me');authenticated=true;}catch(e){if(e.status!==401)$('message').textContent=e.message;}
 login.hidden=authenticated;
 signup.textContent=authenticated?'Dashboard':'Buat akun';signup.href=authenticated?'/dashboard':'/register';
 cta.textContent=authenticated?'Buka dashboard':'Mulai dengan paket gratis';cta.href=authenticated?'/dashboard':'/register';
 signup.hidden=cta.hidden=false;
}
let registering=false;
function setAuthMode(value){registering=value;$('authtitle').textContent=value?'Buat akun Anda':'Masuk ke akun Anda';$('authintro').textContent=value?'Mulai dengan paket dasar gratis.':'Kelola WhatsApp dan integrasi Anda dalam satu tempat.';$('authsubmit').textContent=value?'Buat akun':'Masuk';$('register').textContent=value?'Sudah punya akun? Masuk':'Belum punya akun? Daftar';$('auth').elements.password.autocomplete=value?'new-password':'current-password';}
form('auth',async data=>{if(registering){await api('/api/auth/register','POST',data);setAuthMode(false);history.replaceState(null,'','/login');$('message').textContent='Akun berhasil dibuat. Silakan masuk.';return;}await api('/api/auth/login','POST',data);$('auth').reset();history.replaceState(null,'','/dashboard');await show();});
$('register').onclick=()=>{setAuthMode(!registering);history.replaceState(null,'',registering?'/register':'/login');};
function navigate(){const owner=!$('adminlink').hidden;const allowed=owner?['admin','dokumentasi']:['nomor','uji-pesan','ai','auto-share','integrasi','dokumentasi','paket','referral'];const requested=location.pathname.split('/')[2]||location.hash.slice(1);const page=allowed.includes(requested)?requested:allowed[0];if(requested!==page)history.replaceState(null,'','/dashboard/'+page);$('pagetitle').textContent=({'auto-share':'Auto Share',ai:'Asisten AI',nomor:'Session WhatsApp',integrasi:'Integrasi',pemakaian:'Riwayat pemakaian',paket:'Pembelian',referral:'Referral','uji-pesan':'Uji Pesan',admin:'Pengelolaan layanan',dokumentasi:'Dokumentasi API'})[page];for(const id of ['nomor','uji-pesan','ai','auto-share','integrasi','paket','referral','admin','dokumentasi'])$(id).hidden=id!==page;const subpages={ai:'Pengaturan AI',profiles:'Profil AI',plans:'Paket & Harga',accounts:'Akun pelanggan',settings:'Pengaturan pembayaran',payments:'Semua pembayaran',referral:'Referral',failures:'Log Kegagalan Agent',trace:'Log Lengkap',health:'Status layanan & audit'};const requestedSub=location.pathname.split('/')[3];const sub=Object.hasOwn(subpages,requestedSub)?requestedSub:'plans';$('adminsubmenu').hidden=!owner;$('ownerdocs').hidden=!owner;for(const id of Object.keys(subpages))$('admin-'+id).hidden=id!==sub;if(page==='admin')$('pagetitle').textContent=subpages[sub];document.querySelectorAll('#adminsubmenu a').forEach(a=>{if(a.pathname==='/dashboard/admin/'+sub)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});document.querySelectorAll('.tabs > a,.tabs .nav-links > a').forEach(a=>{if(a.pathname==='/dashboard/'+page)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});$('pageintro').textContent=page==='paket'?'':page==='admin'?({ai:'Kelola koneksi, tarif kata, harga kredit, dan memori AI global.',profiles:'Atur profil AI mana yang tersedia untuk semua klien.',plans:'Kelola pilihan paket, harga, dan kapasitas untuk pelanggan Anda.',accounts:'Kelola akun pelanggan, status akses, dan penyesuaian kredit.',settings:'Siapkan pembayaran paket melalui Midtrans.',payments:'Pantau transaksi pembelian paket pelanggan.',referral:'Kelola program referral, permintaan pencairan, dan Agen Resmi.',failures:'Telusuri kegagalan asisten AI per agent untuk menyesuaikan prompt.',trace:'Rekaman lengkap tiap langkah proses AI untuk debugging mendalam.',health:'Pantau kondisi layanan dan aktivitas pengelolaan.'}[sub]):({nomor:'Hubungkan nomor WhatsApp dan pantau koneksi Anda.',integrasi:'Sambungkan WhatsApp ke aplikasi dan workflow Anda.',dokumentasi:'Panduan untuk membangun integrasi WhatsApp Anda.','uji-pesan':'Coba pengiriman dan lihat riwayat pemakaian kredit.',referral:'Bagikan kode referral dan pantau bonus serta komisi Anda.'}[page]||'');$('userstats').hidden=owner||page!=='nomor';if(page!=='nomor')closeQr();}
document.querySelectorAll('#admin > details, #nomor > details').forEach(panel=>panel.addEventListener('toggle',()=>{if(panel.open)for(const other of panel.parentElement.querySelectorAll(':scope > details'))if(other!==panel)other.open=false;}));
document.querySelectorAll('.tabs a:not(.sidebar-brand):not([data-studio])').forEach(a=>a.addEventListener('click',event=>{if(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;event.preventDefault();history.pushState(null,'',a.pathname);navigate();if(a.pathname==='/dashboard/ai')void run(loadAI);if(a.pathname==='/dashboard/auto-share')void run(loadAutoShare);if(a.pathname==='/dashboard/referral')void run(loadReferral);if(a.pathname==='/dashboard/admin/referral')void run(loadAdminReferral);$('message').textContent='';window.scrollTo(0,0);}));
window.addEventListener('popstate',()=>{if(!$('dashboard').hidden)navigate();});
window.addEventListener('hashchange',()=>{if(!$('dashboard').hidden)navigate();});
$('newkey').type='button';$('newkey').onclick=()=>run(async()=>{const data=await api('/api/keys','POST');$('secret').textContent='Simpan key ini: '+data.key;await keys();});
const settingsMenu=document.querySelector('.settings-menu');
function closeSettingsMenu(){$('settings-menu-list').hidden=true;$('settings-toggle').setAttribute('aria-expanded','false');}
$('settings-toggle').onclick=()=>{const open=!$('settings-menu-list').hidden;if(open)closeSettingsMenu();else{$('settings-menu-list').hidden=false;$('settings-toggle').setAttribute('aria-expanded','true');}};
$('logout').onclick=()=>run(async()=>{closeSettingsMenu();await api('/api/auth/logout','POST');location.assign('/login');});
$('open-password').onclick=()=>{closeSettingsMenu();$('self-password-form').reset();$('self-password-dialog').showModal();};
form('self-password-form',async data=>{if(data.password!==data.confirmPassword)throw Error('Ulangi password baru harus sama.');await api('/api/auth/password','PUT',{currentPassword:data.currentPassword,password:data.password});$('self-password-dialog').close();$('message').textContent='Password berhasil diganti. Sesi login lain telah dicabut.';});
document.addEventListener('click',e=>{if(!$('settings-menu-list').hidden&&!settingsMenu.contains(e.target))closeSettingsMenu();});
let qrTimer,qrGeneration=0;
function closeQr(){qrGeneration++;clearTimeout(qrTimer);$('pairing').close();$('qrimage').removeAttribute('src');}
async function sessions(){const data=await api('/sessions');$('stat-active').textContent=data.filter(s=>s.status==='connected'&&s.serviceActive!==false).length;for(const [id,label] of [['sendconnection','Pilih sesi'],['hookconnection','Semua sesi']]){const select=$(id),current=select.value;select.replaceChildren(new Option(label,''),...data.filter(s=>s.serviceActive!==false).map(s=>new Option(s.id+(s.phone?' · '+s.phone:''),s.id)));select.value=current;}table('sessions',['Sesi','Pesan','Nomor WhatsApp','Status','Tindakan'],data,s=>{const badge=document.createElement('span');badge.className='badge '+(s.serviceActive===false?'inactive':s.status);badge.textContent=s.serviceActive===false?'Nonaktif (batas paket)':({connected:'Terhubung',qr_required:'Menunggu QR',connecting:'Menghubungkan',logged_out:'Terputus'})[s.status]||s.status;const actions=document.createElement('div');actions.className='row-actions';if(s.serviceActive!==false&&s.status!=='connected')actions.append(button(s.status==='logged_out'?'Pasang ulang':'Lihat QR',async()=>{if(s.status==='logged_out')await api('/sessions/'+encodeURIComponent(s.id)+'/reconnect','POST');await pair(s.id);}));actions.append(button('Logout',async()=>{if(!confirm('Putuskan perangkat WhatsApp ini?'))return;await api('/sessions/'+encodeURIComponent(s.id)+'/logout','POST');await sessions();}),button('Hapus',async()=>{if(!confirm('Hapus sesi dan data koneksi perangkat ini?'))return;await api('/sessions/'+encodeURIComponent(s.id),'DELETE');await sessions();}));const filters=document.createElement('div');filters.className='session-filters';filters.setAttribute('role','radiogroup');filters.setAttribute('aria-label','Filter pesan '+s.id);for(const [value,label] of Object.entries({private:'pribadi',group:'grup',all:'semua'})){const choice=document.createElement('label'),input=document.createElement('input');input.type='radio';input.name='session-filter-'+s.id;input.value=value;input.checked=s.filter===value;input.disabled=s.serviceActive===false;input.onchange=()=>run(()=>api('/sessions/'+encodeURIComponent(s.id)+'/filter','PUT',{filter:value}));choice.append(input,document.createTextNode(label));filters.append(choice);}return [s.id,filters,s.phone||'—',badge,actions];});}
async function pair(id){closeQr();const generation=qrGeneration;$('pairing').showModal();const poll=async()=>{try{const state=await api('/sessions/'+encodeURIComponent(id)+'/qr');if(generation!==qrGeneration)return;$('qrstatus').textContent=state.status==='connected'?'WhatsApp tersambung.':'Scan QR melalui WhatsApp → Perangkat tertaut.';$('qrimage').hidden=!state.qr;if(state.qr)$('qrimage').src=state.qr;if(state.status==='connected'){await sessions();if(!$('ai').hidden)await loadAI();return;}qrTimer=setTimeout(poll,3000);}catch(e){if(generation===qrGeneration)$('qrstatus').textContent=e.message;}};await poll();}
$('pairing').addEventListener('cancel',e=>{e.preventDefault();closeQr();});$('closeqr').onclick=closeQr;$('refreshsessions').onclick=()=>run(sessions);$('refreshusage').onclick=()=>run(usage);
form('sessionform',async data=>{await api('/sessions','POST',data);await sessions();$('sessionform').reset();$('addconnection').close();await pair(data.id);});
let sendAttempt;
form('sendform',async data=>{const sessionId=$('ai-session').value;if(!sessionId)throw Error('Pilih sesi melalui card di halaman Asisten AI terlebih dahulu.');const payload=JSON.stringify({sessionId,to:data.to,text:data.text});if(!sendAttempt||sendAttempt.payload!==payload)sendAttempt={payload,id:crypto.randomUUID()};await api('/sessions/'+encodeURIComponent(sessionId)+'/messages/text','POST',{to:data.to,text:data.text},{'Idempotency-Key':sendAttempt.id});sendAttempt=undefined;$('sendform').reset();await Promise.all([wallet(),usage()]);});
form('webhookform',async data=>{$('webhook-error').textContent='';try{await api('/webhooks','POST',{url:data.url,...(data.sessionId?{sessionId:data.sessionId}:{})});}catch(e){$('webhook-error').textContent=e.message;return;}$('webhookform').reset();$('webhook-modal').close();await webhooks();});
$('webhookform').addEventListener('reset',()=>{$('webhook-error').textContent='';});
let currentPayment,selectedPlan,paymentOrder,paymentTimer,paymentBusy=false;
const pendingPayment=p=>['creating','pending','unknown'].includes(p.status);
const paymentLabels={creating:'Menyiapkan pembayaran',pending:'Menunggu pembayaran',unknown:'Memeriksa transaksi',settlement:'Pembayaran berhasil',expire:'Pembayaran kedaluwarsa',deny:'Pembayaran ditolak',cancel:'Pembayaran dibatalkan',not_found:'Transaksi tidak ditemukan'};
function paymentCountdown(){
 if(!paymentOrder||!pendingPayment(paymentOrder)){$('paymentcountdown').textContent='';return;}
 const expiry=paymentOrder.expires_at?new Date(paymentOrder.expires_at).getTime():NaN;
 if(!Number.isFinite(expiry)){$('paymentcountdown').textContent='Batas pembayaran sedang dikonfirmasi.';return;}
 const seconds=Math.max(0,Math.ceil((expiry-Date.now())/1000));
 $('paymentcountdown').textContent=seconds?`Sisa waktu ${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')} · Bayar sebelum ${new Date(expiry).toLocaleString('id-ID')}`:'Batas waktu telah lewat. Menunggu konfirmasi status dari Midtrans; jangan bayar QR ini.';
 if(!seconds){$('paymentqr').hidden=true;$('paymentinstructions').hidden=true;}
}
function renderPayment(order){
 paymentOrder=order;$('checkout').hidden=false;
 $('checkoutinfo').textContent=`${order.plan_name} · Harga ${money(order.price)} + biaya ${money(order.fee)} · Total ${money(order.total)} · ID ${order.id}${order.environment==='sandbox'?' · Mode pengujian Sandbox':''}`;
 const messages={settlement:'Pembayaran berhasil. Paket sudah aktif dan kredit telah ditambahkan.',pending:'Menunggu pembayaran. Jika sudah membayar, tunggu sebentar; status akan diperbarui otomatis.',creating:'Pembayaran sedang disiapkan. Jangan membuat pembayaran lain dahulu.',unknown:'Hasil transaksi belum terkonfirmasi. Kami sedang memeriksa; jangan membayar ulang.',expire:'Pembayaran kedaluwarsa. Silakan pilih paket lagi untuk membuat pembayaran baru.',deny:'Pembayaran ditolak. Periksa kembali atau pilih paket untuk mencoba lagi.',cancel:'Pembayaran telah dibatalkan.',not_found:'Transaksi tidak ditemukan setelah pemeriksaan. Anda dapat memilih paket lagi.'};
 $('paymentstatus').textContent=(order.kind==='ai'&&order.status==='settlement'?'Pembayaran berhasil. Saldo kredit AI telah ditambahkan.':messages[order.status])||'Status sedang diperiksa.';
 const showQr=order.status==='pending'&&Boolean(order.qr_url)&&(!order.expires_at||new Date(order.expires_at).getTime()>Date.now());
 $('paymentqr').hidden=$('paymentinstructions').hidden=!showQr;$('qrerror').hidden=!(order.status==='pending'&&!order.qr_url);if(!$('qrerror').hidden)$('qrerror').textContent='QR sedang disiapkan. Periksa status untuk memuatnya kembali.';
 if(showQr){const path='/api/payments/'+encodeURIComponent(order.id)+'/qr';if($('paymentqr').getAttribute('src')!==path)$('paymentqr').src=path;$('downloadqr').href=path;}else $('paymentqr').removeAttribute('src');
 $('cancelpayment').hidden=order.status!=='pending';$('checkpayment').hidden=!pendingPayment(order);paymentCountdown();
}
async function checkout(id){currentPayment=id;clearTimeout(paymentTimer);const order=await api('/api/payments/'+encodeURIComponent(id));if(currentPayment!==id)return;renderPayment(order);if(order.status==='settlement')await Promise.all([wallet(),sessions(),loadAI()]);$('checkout').scrollIntoView({behavior:'smooth',block:'start'});schedulePayment();}
function schedulePayment(){clearTimeout(paymentTimer);if(paymentOrder&&pendingPayment(paymentOrder))paymentTimer=setTimeout(()=>{if(document.hidden||$('paket').hidden){schedulePayment();return;}void run(()=>refreshPayment(false));},10000);}
async function refreshPayment(manual=true){
 if(!currentPayment||paymentBusy)return;const id=currentPayment;paymentBusy=true;$('checkpayment').disabled=$('cancelpayment').disabled=true;
 try{const order=await api('/api/payments/'+encodeURIComponent(id)+'/check','POST');if(currentPayment!==id)return;renderPayment(order);await paymentList();if(order.status==='settlement')await Promise.all([wallet(),sessions(),loadAI()]);if(manual)$('message').textContent=$('paymentstatus').textContent;}
 finally{paymentBusy=false;$('checkpayment').disabled=$('cancelpayment').disabled=false;schedulePayment();}
}
let paymentHistory=[],showAllPayments=false;
function renderPaymentHistory(){const rows=showAllPayments?paymentHistory:paymentHistory.slice(0,4);table('payments',['Tanggal','Paket','Jumlah','Status','Aksi'],rows,p=>{const status=document.createElement('span');status.className='payment-badge '+({settlement:'success',cancel:'cancelled',deny:'cancelled',expire:'expired'}[p.status]||'waiting');status.textContent=({settlement:'Berhasil',cancel:'Dibatalkan',deny:'Ditolak',expire:'Kedaluwarsa'}[p.status]||paymentLabels[p.status]||p.status);const action=button(pendingPayment(p)?'Lanjut bayar':'Lihat detail',()=>checkout(p.id));action.className='payment-detail';return [p.created_at?new Date(p.created_at).toLocaleString('id-ID',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}):'—',p.plan_name,money(p.total),status,action];});$('allpayments').hidden=paymentHistory.length<=4;$('allpayments').textContent=showAllPayments?'Tampilkan ringkas':'Lihat semua';}
async function paymentList(){paymentHistory=await api('/api/payments');renderPaymentHistory();}
$('allpayments').onclick=()=>{showAllPayments=!showAllPayments;renderPaymentHistory();};
$('confirmpurchase').onclick=()=>run(async()=>{if(!selectedPlan)return;const control=$('confirmpurchase');control.disabled=true;try{const order=await api('/api/payments','POST',{planId:selectedPlan.id});$('purchase-modal').close();await checkout(order.id);await paymentList();}finally{control.disabled=false;}});
$('checkpayment').onclick=()=>run(()=>refreshPayment());
$('cancelpayment').onclick=()=>run(async()=>{if(paymentBusy||!currentPayment||!confirm('Batalkan pembayaran ini? Status akan diperiksa kembali sebelum pembatalan.'))return;const id=currentPayment;paymentBusy=true;$('cancelpayment').disabled=$('checkpayment').disabled=true;try{const order=await api('/api/payments/'+encodeURIComponent(id)+'/cancel','POST');if(currentPayment!==id)return;renderPayment(order);await Promise.all([paymentList(),wallet(),sessions()]);$('message').textContent=$('paymentstatus').textContent;}finally{paymentBusy=false;$('cancelpayment').disabled=$('checkpayment').disabled=false;schedulePayment();}});
$('paymentqr').onerror=()=>{$('qrerror').textContent='QR belum berhasil dimuat. Periksa status untuk mencoba lagi.';$('qrerror').hidden=false;$('paymentqr').removeAttribute('src');};
setInterval(()=>{if(!document.hidden&&!$('paket').hidden)paymentCountdown();},1000);
async function plans(){table('plans',['Nama paket','Harga / bulan','Kredit','Batas nomor','Batas asset','Status','Tindakan'],await api('/api/admin/plans'),p=>{
 const actions=document.createElement('div');actions.className='row-actions';
 actions.append(button('Edit',async()=>{for(const name of ['id','name','price','credits','session_limit','max_share_assets'])$('planform').elements.namedItem(name).value=p[name];$('planform').elements.namedItem('max_share_storage_mb').value=Math.round(p.max_share_storage_bytes/1048576);$('planform').elements.namedItem('active').checked=Boolean(p.active);$('planform-modal').showModal();}));
 if(p.id!=='basic')actions.append(button('Hapus',async()=>{if(!confirm(`Hapus paket "${p.name}" dari katalog? Kredit pelanggan dan riwayat pembayaran tetap tersimpan.`))return;await api('/api/admin/plans/'+encodeURIComponent(p.id),'DELETE');await plans();$('message').textContent='Paket berhasil dihapus.';}));
 return [p.name,money(p.price),p.credits,p.session_limit,`${p.max_share_assets} asset · ${Math.round(p.max_share_storage_bytes/1048576)} MB`,p.active?'Aktif':'Nonaktif',actions];
});}
form('planform',async p=>{await api('/api/admin/plans/'+encodeURIComponent(p.id),'PUT',{name:p.name,price:Number(p.price),credits:Number(p.credits),session_limit:Number(p.session_limit),max_share_assets:Number(p.max_share_assets),max_share_storage_bytes:Number(p.max_share_storage_mb)*1048576,active:p.active==='on'});await plans();$('planform-modal').close();$('message').textContent='Paket tersimpan.';});
const passwordModal=document.createElement('dialog'),passwordForm=document.createElement('form'),passwordTitle=document.createElement('h2'),passwordInput=document.createElement('input'),passwordClose=document.createElement('button');passwordModal.append(passwordTitle,passwordForm);passwordForm.method='dialog';passwordForm.append(document.createElement('label'));passwordForm.firstChild.textContent='Password baru ';passwordInput.type='password';passwordInput.minLength=6;passwordInput.maxLength=128;passwordInput.autocomplete='new-password';passwordInput.required=true;passwordForm.firstChild.append(passwordInput);const passwordSave=document.createElement('button');passwordSave.textContent='Ganti password';passwordClose.type='button';passwordClose.className='secondary';passwordClose.textContent='Tutup';passwordForm.append(passwordSave,passwordClose);document.body.append(passwordModal);passwordClose.onclick=()=>passwordModal.close();let passwordAccount;function changePassword(account){passwordAccount=account;passwordTitle.textContent='Ganti password · '+account.email;passwordInput.value='';passwordModal.showModal();passwordInput.focus();}passwordForm.onsubmit=e=>{e.preventDefault();void run(async()=>{passwordSave.disabled=true;try{await api('/api/admin/accounts/'+encodeURIComponent(passwordAccount.id)+'/password','PUT',{password:passwordInput.value});passwordModal.close();$('message').textContent='Password berhasil diganti; semua sesi login akun tersebut telah dicabut.';}finally{passwordSave.disabled=false;}});};
async function admin(){await plans();await loadAIConfig();await loadAdminProfiles();await loadModelUsage();await loadFailures();await loadTraceRequests();const accounts=await api('/api/admin/accounts');$('ai-adjust-account').replaceChildren(new Option('Pilih akun',''),...accounts.map(u=>new Option(u.email,u.id)));const selected=$('adjustaccount').value;$('adjustaccount').replaceChildren(new Option('Pilih akun',''),...accounts.map(u=>new Option(u.email,u.id)));$('adjustaccount').value=selected;$('referral-agent-account').replaceChildren(new Option('Pilih akun',''),...accounts.map(u=>new Option(u.email,u.id)));table('accounts',['Email','Peran','Status','Paket aktif','Sisa kredit','Tindakan'],accounts,u=>{if(u.role==='owner')return [u.email,'Pemilik',u.suspended?'Nonaktif':'Aktif',u.plan_name,new Intl.NumberFormat('id-ID').format(u.balance),'—'];const actions=document.createElement('div');actions.className='row-actions';actions.append(button(u.suspended?'Aktifkan':'Nonaktifkan',async()=>{await api('/api/admin/accounts/'+u.id+'/status','PUT',{suspended:!u.suspended});await admin();}),button('Ganti password',async()=>changePassword(u)));return [u.email,'Pengguna',u.suspended?'Nonaktif':'Aktif',u.plan_name,new Intl.NumberFormat('id-ID').format(u.balance),actions];});const config=await api('/api/admin/midtrans');$('midtransstatus').textContent=`${config.configured?'Terkonfigurasi: '+config.environment+' · '+config.serverKey:'Belum dikonfigurasi'} · URL notifikasi: ${config.notificationUrl}`;await loadAudit();await loadAdminPayments();const health=await api('/api/admin/health');table('health',['Komponen','Status'],Object.entries(health),([key,value])=>[({database:'Database',engine:'WhatsApp',uptime:'Waktu aktif'})[key]||key,typeof value==='object'?JSON.stringify(value):key==='uptime'?Math.floor(value)+' detik':String(value)]);await loadAdminReferral();}
let auditPage=1,auditLoading=false;
async function loadAudit(page=auditPage){
 if(auditLoading)return;auditLoading=true;$('audit-prev').disabled=$('audit-next').disabled=true;
 try{const result=await api('/api/admin/audit?page='+page);auditPage=result.page;
 table('audit',['Waktu','Aktivitas','Email'],result.items,a=>[new Date(a.created_at).toLocaleString('id-ID'),a.action,a.account_email]);
 $('audit-page').textContent='Halaman '+result.page+' dari '+result.pages+' · '+result.total+' aktivitas';
 $('audit-prev').disabled=result.page<=1;$('audit-next').disabled=result.page>=result.pages;
 }catch(error){$('audit-prev').disabled=auditPage<=1;$('audit-next').disabled=false;throw error;}finally{auditLoading=false;}
}
$('audit-prev').onclick=()=>run(()=>loadAudit(auditPage-1));
$('audit-next').onclick=()=>run(()=>loadAudit(auditPage+1));
let adminPaymentsPage=1,adminPaymentsLoading=false;
async function loadAdminPayments(page=adminPaymentsPage){
 if(adminPaymentsLoading)return;adminPaymentsLoading=true;$('adminpayments-prev').disabled=$('adminpayments-next').disabled=true;
 try{const result=await api('/api/admin/payments?page='+page);adminPaymentsPage=result.page;
 table('adminpayments',['ID pembayaran','Email','Total','Status'],result.items,p=>[p.id,p.account_email,money(p.total),p.status]);
 $('adminpayments-page').textContent='Halaman '+result.page+' dari '+result.pages+' · '+result.total+' pembayaran';
 $('adminpayments-prev').disabled=result.page<=1;$('adminpayments-next').disabled=result.page>=result.pages;
 }catch(error){$('adminpayments-prev').disabled=adminPaymentsPage<=1;$('adminpayments-next').disabled=false;throw error;}finally{adminPaymentsLoading=false;}
}
$('adminpayments-prev').onclick=()=>run(()=>loadAdminPayments(adminPaymentsPage-1));
$('adminpayments-next').onclick=()=>run(()=>loadAdminPayments(adminPaymentsPage+1));
form('midtransform',async data=>{await api('/api/admin/midtrans','PUT',data);$('midtransform').reset();$('midtransform-modal').close();await admin();});
$('testmidtrans').onclick=()=>run(async()=>{$('message').textContent=(await api('/api/admin/midtrans/test','POST')).message;});
let adjustment;
form('adjustform',async data=>{const payload=JSON.stringify(data);if(!adjustment||adjustment.payload!==payload)adjustment={payload,id:crypto.randomUUID()};await api('/api/admin/accounts/'+encodeURIComponent(data.accountId)+'/credits','POST',{amount:Number(data.amount),reason:data.reason,requestId:adjustment.id});adjustment=undefined;await admin();$('adjustform-modal').close();$('adjustform').reset();$('message').textContent='Penyesuaian tersimpan.';});
document.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>{const modal=$(b.dataset.open);modal.querySelector('form').reset();modal.showModal();});
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());

const aiTabNames=['knowledge','orders','conversations','usage','trial','integrasi'];
function aiTab(tab){for(const name of aiTabNames){const section=$('ai-tab-'+name);if(section)section.hidden=name!==tab;}document.querySelectorAll('[data-ai-tab]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.aiTab===tab)));if(tab==='knowledge')knowledgeTab('usaha');if(tab==='conversations'&&$('ai-session').value&&aiView==='sessions')void run(loadConversations);}
document.querySelectorAll('[data-ai-tab]').forEach(b=>b.onclick=()=>aiTab(b.dataset.aiTab));
const knowledgeTabNames=['usaha','products','behavior','cara_pemesanan','pembayaran','kebijakan','faq','fallback'];
function knowledgeTab(tab){$('ai-knowledge-select').value=tab;for(const name of knowledgeTabNames)$('ai-knowledge-tab-'+name).hidden=name!==tab;document.querySelectorAll('[data-knowledge-tab]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.knowledgeTab===tab)));}
document.querySelectorAll('[data-knowledge-tab]').forEach(b=>b.onclick=()=>knowledgeTab(b.dataset.knowledgeTab));
$('ai-knowledge-select').onchange=e=>knowledgeTab(e.target.value);
aiTab('knowledge');
{const icon=document.querySelector('.ai-hero-icon'),plan=document.createElement('div'),label=document.createElement('span');plan.className='ai-hero-plan';label.id='ai-active-plan';label.className='ai-active-plan';label.textContent='—';icon.before(plan);plan.append(icon,label);}
$('ai-hero-buy').onclick=()=>{$('ai-credit-units').value='1';aiCreditSummary();$('ai-credit-modal').showModal();};
let aiUsagePage=1,aiUsageLoading=false,aiCreditPrice=0;
// Pulls fresh connection status (and aiEnabled) for the carousel cards without touching knowledge,
// products, orders, etc. — cheap enough to poll periodically so a phone-side logout or a QR scan
// completed elsewhere shows up without the user having to reload the page.
async function refreshSessionCards(){
 const sessionRows=await api('/sessions');
 const selected=$('ai-session').value;
 aiSessions=sessionRows;
 if(!aiSessions.some(s=>s.id===selected))$('ai-session').value=aiSessions[0]?.id??'';
 aiSessionIndex=Math.max(0,aiSessions.findIndex(s=>s.id===$('ai-session').value));
 renderSessionCards();
 renderAISessionFilters();
 renderProfileStrip();renderAITabs();
}
async function loadAI(){
 const [w,waWallet,types]=await Promise.all([api('/api/ai/wallet'),api('/api/wallet'),api('/ai/profile-types'),loadAIUsage()]);
 aiProfileTypes=types;
 aiSessionLimit=waWallet.session_limit;
 await refreshSessionCards();
 $('ai-balance').textContent=`${w.balance} kredit`;
 $('wa-balance').textContent=`${new Intl.NumberFormat('id-ID').format(waWallet.balance)} pesan`;
 $('ai-active-plan').textContent=waWallet.plan_id==='basic'?'Gratis':waWallet.plan_id;
 aiCreditPrice=w.credit_price;
 $('ai-hero-buy').disabled=!w.credit_price;
 if($('ai-credit-rate')){
  const rows=[`${w.balance} kredit AI tersedia`,`Input ${w.input_rate} kredit/kata · Output ${w.output_rate} kredit/kata`,'Tidak kedaluwarsa, dipakai lintas semua nomor layanan'];
  $('ai-credit-rate').replaceChildren(...rows.map(text=>{const li=document.createElement('li');const check=document.createElement('span');check.textContent='✓';check.setAttribute('aria-hidden','true');li.append(check,document.createTextNode(text));return li;}));
  $('ai-buy').disabled=!w.credit_price;
 }
 await loadAssistant();
}
// Poll session status every 12s while the Asisten AI tab is open, so a WhatsApp logout from the
// phone or a QR scan finished in another tab/device reflects on the carousel without a reload.
setInterval(()=>{if(!document.hidden&&!$('ai').hidden)void run(refreshSessionCards);},12000);
// A neutral signal-bars icon instead of the WhatsApp glyph — repeated across every carousel card
// (including the loop's duplicate copies), a row of WhatsApp logos read as visual noise.
const connectedIcon='<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="2" y="14" width="4" height="8" rx="1"/><rect x="10" y="10" width="4" height="12" rx="1"/><rect x="18" y="5" width="4" height="17" rx="1"/></svg>';
const qrIcon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v3M14 20h3M20 20v.01"/></svg>';
// qr_required/logged_out need the user to actually do something (scan or reconnect), so the status
// icon becomes a clickable QR glyph there; connecting is a passive wait, so it stays signal-bars.
const sessionStatusMeta={
 connected:{cls:'online',icon:connectedIcon,label:'WhatsApp terhubung',clickable:false},
 connecting:{cls:'connecting',icon:connectedIcon,label:'Menghubungkan…',clickable:false},
 qr_required:{cls:'offline',icon:qrIcon,label:'Menunggu scan QR — klik untuk menampilkan QR',clickable:true},
 logged_out:{cls:'offline',icon:qrIcon,label:'WhatsApp terputus — klik untuk memasang ulang',clickable:true},
};
let aiSessions=[],aiSessionIndex=0,aiSessionLimit=1;
// Multi-profile: a profile is a pipeline shipped by NC-WA (CS Usaha, …); a data profile is this account's
// content for one profile, attachable to any session. "Sesi" edits the data profile attached to the selected
// session; "Data Profil" lists every data profile and can manage one directly, attached or not.
let aiView='sessions',aiManaged=null,aiProfileTypes=[],aiDataProfiles=[];
const profileType=id=>aiProfileTypes.find(t=>t.id===id);
const selectedSession=()=>aiSessions.find(s=>s.id===$('ai-session').value);
// The data profile being edited: the managed one, or the one attached to the selected session.
const aiTarget=()=>aiView==='profiles'?aiManaged?.id??'':selectedSession()?.aiProfile?.id??'';
const profileBase=(id=aiTarget())=>'/ai/data-profiles/'+encodeURIComponent(id);
// Session view keeps using the session routes, so orders remember which number they came from.
const dataBase=()=>aiView==='profiles'?profileBase():'/sessions/'+encodeURIComponent($('ai-session').value)+'/ai';
// Percakapan, Uji Pesan and Integrasi belong to every session; the profile adds its own tabs.
function allowedAITabs(){
 if(aiView==='profiles')return aiManaged?['knowledge','orders','trial']:[];
 const session=selectedSession();if(!session)return [];
 const type=session.aiProfile&&profileType(session.aiProfile.profile_type);
 return ['conversations','trial','integrasi',...(type?type.tabs:[])];
}
function renderAITabs(){
 const allowed=allowedAITabs();
 document.querySelectorAll('[data-ai-tab]').forEach(b=>b.hidden=!allowed.includes(b.dataset.aiTab));
 const current=[...document.querySelectorAll('[data-ai-tab]')].find(b=>b.getAttribute('aria-pressed')==='true')?.dataset.aiTab;
 if(allowed.length&&!allowed.includes(current))aiTab(aiTabNames.find(t=>allowed.includes(t)));
 // Uji Pesan sends a real WhatsApp message from the session; Uji AI Asisten needs a data profile.
 const trials={message:aiView==='sessions',assistant:Boolean(aiTarget())};
 document.querySelectorAll('[data-ai-trial-tab]').forEach(b=>b.hidden=!trials[b.dataset.aiTrialTab]);
 const trial=[...document.querySelectorAll('[data-ai-trial-tab]')].find(b=>b.getAttribute('aria-pressed')==='true')?.dataset.aiTrialTab;
 if(document.querySelector('[data-ai-trial-tab]')&&!trials[trial])aiTrialTab(trials.assistant?'assistant':'message');
 // Fallback tickets belong to a session's customers; a managed data profile only sets the team number.
 for(const el of [$('ai-fallbacks'),$('ai-fallbacks').previousElementSibling,$('ai-fallbacks').nextElementSibling])el.hidden=aiView==='profiles';
}
function renderAIView(){
 const sessions=aiView==='sessions',managing=aiView==='profiles'&&Boolean(aiManaged);
 document.querySelectorAll('[data-ai-view]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.aiView===aiView)));
 $('ai-session-picker').hidden=!sessions;$('ai-profiles-view').hidden=sessions||managing;$('ai-manage-head').hidden=!managing;
 $('ai-session-placeholder').hidden=!sessions||Boolean($('ai-session').value);
 $('ai-session-detail').hidden=sessions?!$('ai-session').value:!managing;
 $('ai-session-filters').hidden=!sessions||!selectedSession();
 if(managing){const type=profileType(aiManaged.profile_type);$('ai-manage-name').textContent=aiManaged.name;$('ai-manage-meta').textContent=(type?.name??aiManaged.profile_type)+' · '+(aiManaged.sessions.length?'dipasang di '+aiManaged.sessions.join(', '):'belum dipasang ke sesi mana pun');}
 renderProfileStrip();renderAITabs();
}
function setAIView(view){if(aiView===view&&!aiManaged)return;aiView=view;aiManaged=null;renderAIView();run(async()=>{if(view==='profiles')await loadDataProfiles();await loadAssistant();});}
document.querySelectorAll('[data-ai-view]').forEach(b=>b.onclick=()=>setAIView(b.dataset.aiView));
$('ai-manage-back').onclick=()=>{aiManaged=null;renderAIView();run(loadDataProfiles);};
function manageProfile(profile,tab='knowledge'){aiManaged=profile;renderAIView();aiTab(tab);run(loadAssistant);}
async function loadProfileCatalog(){[aiProfileTypes,aiDataProfiles]=await Promise.all([api('/ai/profile-types'),api('/ai/data-profiles')]);}
async function loadDataProfiles(){await loadProfileCatalog();renderDataProfiles();}
const profileIcon='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 9l1.5-5h15L21 9"/><path d="M4 9v11h16V9"/><path d="M9 20v-6h6v6"/></svg>';
const chatIcon='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/></svg>';
// Client menu links sit in one wrapper: display:contents on wide screens (layout unchanged), a single row that
// scrolls sideways under the brand on phones.
// Phones show the owner menu as a header with a menu button instead of a bottom panel covering the page.
function addAdminMenuToggle(nav){if($('admin-menu-toggle'))return;const toggle=element('button','secondary admin-menu-toggle');toggle.type='button';toggle.id='admin-menu-toggle';toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-label','Buka menu admin');toggle.innerHTML='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>';toggle.onclick=()=>{const open=nav.classList.toggle('menu-open');toggle.setAttribute('aria-expanded',String(open));toggle.setAttribute('aria-label',open?'Tutup menu admin':'Buka menu admin');};nav.querySelector(':scope > .sidebar-brand').after(toggle);nav.addEventListener('click',e=>{if(e.target.closest('a:not(.sidebar-brand)')&&nav.classList.contains('menu-open'))toggle.click();});}
function wrapClientNav(nav){if(nav.querySelector(':scope > .nav-links'))return;const links=element('div','nav-links');links.append(...nav.querySelectorAll(':scope > a:not(.sidebar-brand)'));nav.querySelector(':scope > .sidebar-brand').after(links);}
function element(tag,className,text){const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;}
function sessionChips(sessions){const chips=element('div','ai-session-chips');for(const id of sessions)chips.append(element('span','ai-session-chip',id));return chips;}
function renderDataProfiles(){
 const list=$('ai-profiles-list');list.replaceChildren();
 if(!aiDataProfiles.length)list.append(element('p','empty','Belum ada data profil. Buat data profil, lalu pasang ke sesi di tab Sesi.'));
 for(const p of aiDataProfiles){
  const card=element('article','ai-profile-card'),head=element('div','ai-profile-card-head'),icon=element('span','ai-profile-card-icon'),title=element('div','ai-profile-card-title');
  icon.innerHTML=profileIcon;title.append(element('strong','',p.name),element('span','ai-profile-type'+(p.profile_enabled?'':' disabled'),p.profile_name+(p.profile_enabled?'':' · nonaktif')));
  const menu=element('details','ai-card-menu'),summary=element('summary','','⋮'),items=element('div','ai-card-menu-items');summary.setAttribute('aria-label','Menu '+p.name);
  items.append(button('Ganti nama',async()=>{menu.open=false;const name=prompt('Nama baru untuk data profil ini:',p.name);if(!name?.trim()||name.trim()===p.name)return;await api(profileBase(p.id),'PATCH',{name:name.trim()});await loadDataProfiles();$('message').textContent='Nama data profil diperbarui.';}),
   button('Duplikat',async()=>{menu.open=false;const name=prompt('Nama untuk salinan data profil ini:','Salinan '+p.name);if(!name?.trim())return;await api('/ai/data-profiles','POST',{name:name.trim(),copy_from:p.id});await loadDataProfiles();$('message').textContent='Data profil diduplikat beserta produk dan fotonya.';}),
   button('Hapus',async()=>{menu.open=false;if(p.sessions.length){$('message').textContent='Cabut data profil ini dari sesi '+p.sessions.join(', ')+' sebelum menghapusnya.';return;}if(!confirm('Hapus data profil '+p.name+'? Knowledge, produk, foto, dan pesanannya ikut terhapus.'))return;await api(profileBase(p.id),'DELETE');await loadDataProfiles();$('message').textContent='Data profil dihapus.';}));
  items.lastElementChild.classList.add('danger');menu.append(summary,items);
  head.append(icon,title,menu);
  const stats=element('div','ai-profile-stats');stats.append(element('span','',p.products+' produk'),element('span','',p.orders+' pesanan'),element('span','','Diubah '+new Date(p.updated_at).toLocaleDateString('id-ID',{day:'numeric',month:'short'})));
  const used=element('div','ai-profile-used');used.append(element('small','','DIPASANG DI'),p.sessions.length?sessionChips(p.sessions):element('span','ai-profile-idle','Belum dipasang ke sesi mana pun'));
  const actions=element('div','ai-profile-actions');actions.append(button('Kelola isi',()=>manageProfile(p)),button('Uji Coba',()=>manageProfile(p,'trial')));actions.lastElementChild.classList.add('secondary');
  card.append(head,stats,used,actions);list.append(card);
 }
 const enabled=aiProfileTypes.filter(t=>t.enabled);
 $('ai-profile-types-info').textContent=enabled.length?'Profil tersedia: '+enabled.map(t=>t.name).join(', ')+'. Profil adalah alur AI siap pakai dari NC-WA; setiap data profil dibuat untuk satu profil. Profil lain muncul di sini setelah diaktifkan admin.':'Belum ada profil AI yang diaktifkan admin.';
 $('ai-profile-new').disabled=!enabled.length;
}
$('ai-profile-new').onclick=()=>{const f=$('ai-profile-create-form');f.reset();$('ai-profile-create-error').textContent='';$('ai-profile-create-type').replaceChildren(...aiProfileTypes.filter(t=>t.enabled).map(t=>new Option(t.name,t.id)));$('ai-profile-create-dialog').showModal();};
form('ai-profile-create-form',async data=>{$('ai-profile-create-error').textContent='';try{const created=await api('/ai/data-profiles','POST',{profile_type:data.profile_type,name:data.name.trim()});$('ai-profile-create-dialog').close();await loadDataProfiles();manageProfile(aiDataProfiles.find(p=>p.id===created.id)??{...created,products:0,orders:0});$('message').textContent='Data profil dibuat. Isi knowledge dan produknya, lalu pasang ke sesi.';}catch(e){$('ai-profile-create-error').textContent=e.message;throw e;}});
// The selected session's profile: what it runs, who shares that content, and how to switch or detach it.
function renderProfileStrip(){
 const strip=$('ai-profile-strip'),session=selectedSession();strip.hidden=aiView!=='sessions'||!session;strip.replaceChildren();strip.classList.toggle('is-empty',!session?.aiProfile);if(strip.hidden)return;
 const profile=session.aiProfile,type=profile&&profileType(profile.profile_type),icon=element('span','ai-profile-strip-icon'),body=element('div','ai-profile-strip-body'),actions=element('div','ai-profile-strip-actions');
 icon.innerHTML=profile?chatIcon:addIcon;
 if(!profile){body.append(element('strong','','Sesi ini belum memakai profil AI'),element('small','','AI tidak membalas pesan di sesi ini. Riwayat chat tetap tercatat di tab Percakapan.'));actions.append(button('Pasang profil',()=>openAttach(session)));}
 else{
  const line=element('span','ai-profile-strip-line');line.append(element('strong','',session.id),document.createTextNode(' memakai profil '),element('strong','',type?.name??profile.profile_type),document.createTextNode(' dengan data profil '),element('strong','',profile.name));body.append(line);
  if(type&&!type.enabled)body.append(element('small','ai-warning','Profil ini sedang dinonaktifkan admin; AI tidak membalas sampai diaktifkan kembali.'));
  const shared=aiSessions.filter(s=>s.id!==session.id&&s.aiProfile?.id===profile.id).map(s=>s.id);
  if(shared.length)body.append(element('small','ai-warning','Data profil ini dipakai juga oleh '+shared.join(', ')+'. Perubahan knowledge dan produk berlaku untuk semua sesi tersebut.'));
  actions.append(button('Ganti data profil',()=>openAttach(session,true)),button('Cabut',async()=>{if(!confirm('Cabut profil dari sesi '+session.id+'? AI berhenti membalas di sesi ini dan memori AI-nya dikosongkan. Data profil '+profile.name+' tetap tersimpan.'))return;await api('/sessions/'+encodeURIComponent(session.id)+'/ai/profile','PUT',{data_profile_id:null});await refreshSessionCards();await loadAssistant();$('message').textContent='Profil dicabut dari sesi '+session.id+'.';}));
  actions.firstElementChild.classList.add('secondary');actions.lastElementChild.classList.add('danger');
 }
 strip.append(icon,body,actions);
}
let attachSession=null;
async function openAttach(session,switching=false){
 attachSession=session;await loadProfileCatalog();
 $('ai-attach-title').textContent=(switching?'Ganti data profil ':'Pasang profil ke ')+session.id;
 $('ai-attach-error').textContent='';$('ai-attach-form').reset();
 const types=aiProfileTypes.filter(t=>t.enabled),current=session.aiProfile;
 $('ai-attach-types').replaceChildren(...types.map(t=>{const label=element('label','ai-choice'),input=document.createElement('input'),text=element('span');input.type='radio';input.name='profile_type';input.value=t.id;input.checked=t.id===(current?.profile_type??types[0].id);input.onchange=renderAttachProfiles;text.append(element('strong','',t.name),element('small','',t.description));label.append(input,text);return label;}));
 if(!types.length)$('ai-attach-types').append(element('p','empty','Belum ada profil AI yang diaktifkan admin.'));
 $('ai-attach-submit').disabled=!types.length;$('ai-attach-submit').textContent=switching?'Ganti data profil':'Pasang profil';
 renderAttachProfiles();$('ai-attach-dialog').showModal();
}
function renderAttachProfiles(){
 const f=$('ai-attach-form'),type=f.elements.profile_type?.value??f.querySelector('[name=profile_type]:checked')?.value,current=attachSession?.aiProfile;
 const options=aiDataProfiles.filter(p=>p.profile_type===type),chosen=current&&options.some(p=>p.id===current.id)?current.id:options[0]?.id??'new';
 $('ai-attach-profiles').replaceChildren(...options.map(p=>{const label=element('label','ai-choice'),input=document.createElement('input'),text=element('span');input.type='radio';input.name='data_profile';input.value=p.id;input.checked=p.id===chosen;input.onchange=attachWarning;const where=p.sessions.length?'Dipasang di '+p.sessions.length+' sesi':'Belum dipasang';text.append(element('strong','',p.name),element('small','',where+' · '+p.products+' produk'));label.append(input,text);return label;}));
 f.querySelector('[name=data_profile][value=new]').checked=chosen==='new';f.querySelector('[name=data_profile][value=new]').onchange=attachWarning;
 attachWarning();
}
function attachWarning(){
 const f=$('ai-attach-form'),value=f.querySelector('[name=data_profile]:checked')?.value,current=attachSession?.aiProfile,profile=aiDataProfiles.find(p=>p.id===value);
 $('ai-attach-new-name').hidden=value!=='new';f.elements.name.required=value==='new';
 const notes=[];const others=profile?.sessions.filter(s=>s!==attachSession?.id)??[];
 if(others.length)notes.push(profile.name+' dipakai juga oleh '+others.join(', ')+'. Produk, knowledge, dan pesanannya dibagi bersama; memori AI dan percakapan tetap terpisah per sesi.');
 if(current&&value!==current.id)notes.push('Memori AI sesi '+attachSession.id+' akan dikosongkan karena berasal dari data profil lain. Riwayat chat tetap tersimpan.');
 $('ai-attach-warning').textContent=notes.join(' ');$('ai-attach-warning').hidden=!notes.length;
}
form('ai-attach-form',async data=>{$('ai-attach-error').textContent='';const session=attachSession;try{
 let id=data.data_profile;
 if(id==='new')id=(await api('/ai/data-profiles','POST',{profile_type:data.profile_type,name:(data.name||'').trim()})).id;
 await api('/sessions/'+encodeURIComponent(session.id)+'/ai/profile','PUT',{data_profile_id:id});
 $('ai-attach-dialog').close();await refreshSessionCards();aiTab('knowledge');await loadAssistant();
 $('message').textContent=session.aiEnabled?'Data profil sesi '+session.id+' diganti.':'Profil terpasang di '+session.id+'. Aktifkan AI Asisten di kartu sesi saat knowledge sudah siap.';
}catch(e){$('ai-attach-error').textContent=e.message;throw e;}});
function renderAISessionFilters(){
 const filters=$('ai-session-filters'),session=aiSessions.find(s=>s.id===$('ai-session').value);
 filters.hidden=!session||aiView!=='sessions';filters.replaceChildren();if(!session)return;
 filters.setAttribute('aria-label','Filter pesan '+session.id);
 for(const [value,label] of Object.entries({private:'pribadi',group:'grup',all:'semua'})){
  const choice=document.createElement('label'),input=document.createElement('input');
  input.type='radio';input.name='ai-session-filter-'+session.id;input.value=value;input.checked=session.filter===value;input.disabled=session.serviceActive===false;
  input.onchange=()=>run(async()=>{await api('/sessions/'+encodeURIComponent(session.id)+'/filter','PUT',{filter:value});session.filter=value;renderAISessionFilters();});
  choice.append(input,document.createTextNode(label));filters.append(choice);
 }
}
const addIcon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
const upgradeIcon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
// Carousel slots beyond the real sessions: "add" (still within session_limit, opens the connect
// modal) vs "upgrade" (past session_limit, sends to /dashboard/paket). Slot count is always at
// least 5 — a small plan (limit<5) fills the remainder up to 5 with upgrade slots; a plan already
// at/above 5 shows only its real "add" slots, plus exactly one upgrade slot once the quota is full.
function buildSessionSlots(){
 const used=aiSessions.length,limit=Math.max(1,aiSessionLimit);
 const slots=aiSessions.slice();
 if(limit<5){
  for(let i=used;i<limit;i++)slots.push({placeholder:'add'});
  for(let i=Math.max(limit,used);i<5;i++)slots.push({placeholder:'upgrade'});
 }else{
  for(let i=used;i<limit;i++)slots.push({placeholder:'add'});
  if(used>=limit)slots.push({placeholder:'upgrade'});
 }
 return slots;
}
function selectSession(id){if($('ai-session').value===id)return;$('ai-session').value=id;clearReceivedTest();const index=aiSessions.findIndex(s=>s.id===id);if(index>=0)aiSessionIndex=index;renderSessionCards();renderAISessionFilters();run(async()=>{aiTab('knowledge');for(const dialog of ['ai-product-dialog','ai-order-dialog','ai-order-edit-dialog'])$(dialog).close();aiFallbacksPage=1;await loadAssistant();});}
// Placeholder slot beyond the real sessions: "add" opens the connect modal (still within
// session_limit), "upgrade" sends to the purchase page (quota exhausted). Kept visually close to a
// real session card (same class, depth fade, selectable-looking) but with no status/toggle/id.
function buildPlaceholderCard(kind,offset){
 const card=document.createElement('article');card.className='ai-session-card placeholder placeholder-'+kind;card.setAttribute('role','button');card.tabIndex=0;
 card.classList.add('ai-session-depth-'+Math.min(2,Math.abs(offset)));
 const icon=document.createElement('span');icon.className='ai-session-placeholder-icon';icon.innerHTML=kind==='add'?addIcon:upgradeIcon;
 const label=document.createElement('strong');label.textContent=kind==='add'?'+ Tambah sesi':'Tingkatkan paket';
 card.append(icon,label);
 const activate=()=>{if(kind==='add'){$('sessionform').reset();$('addconnection').showModal();}else{history.pushState(null,'','/dashboard/paket');navigate();window.scrollTo(0,0);}};
 card.onclick=activate;
 card.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();activate();}};
 return card;
}
// offset is the card's distance from the centered (active) card: 0 = active/editable, ±1/±2 = neighbors
// shown for context only, faded out and with their controls disabled so they can't be edited by accident.
function buildSessionCard(s,offset){
 if(s.placeholder)return buildPlaceholderCard(s.placeholder,offset);
 const card=document.createElement('article');card.className='ai-session-card';card.setAttribute('role','button');card.tabIndex=0;
 const active=offset===0;card.setAttribute('aria-pressed',String(active));if(active)card.classList.add('selected');
 card.classList.add('ai-session-depth-'+Math.min(2,Math.abs(offset)));
 const head=document.createElement('div');head.className='ai-session-card-head';
 const meta=sessionStatusMeta[s.status]??sessionStatusMeta.logged_out;
 const status=document.createElement(meta.clickable?'button':'span');status.className='ai-session-status '+meta.cls;status.innerHTML=meta.icon;status.setAttribute('aria-label',meta.label);
 if(meta.clickable){
  status.type='button';
  status.onclick=e=>{e.stopPropagation();run(async()=>{if(s.status==='logged_out')await api('/sessions/'+encodeURIComponent(s.id)+'/reconnect','POST');await pair(s.id);});};
 }
 const nameBlock=document.createElement('div');nameBlock.className='ai-session-card-name';
 const name=document.createElement('strong');name.textContent=s.id;
 const phone=document.createElement('small');phone.textContent=s.phone||'—';
 nameBlock.append(name,phone);
 head.append(status,nameBlock);
 const foot=document.createElement('div');foot.className='ai-session-card-foot';
 const toggle=document.createElement('label');toggle.className='ai-toggle'+(s.aiEnabled?' active':'');
 // Not a <span> — the global .ai-toggle span selector styles the switch pill itself, and would
 // otherwise paint this label the same way, making it look like a second toggle next to the real one.
 const robot=document.createElement('strong');robot.className='ai-session-robot';robot.textContent='AI Asisten';
 const input=document.createElement('input');input.type='checkbox';input.checked=Boolean(s.aiEnabled);input.disabled=!active;
 input.onclick=e=>e.stopPropagation();
 input.onchange=()=>run(async()=>{const desired=input.checked;input.disabled=true;
  try{await api('/sessions/'+encodeURIComponent(s.id)+'/ai/enabled','PATCH',{enabled:desired});s.aiEnabled=desired;if(s.id===$('ai-session').value)$('ai-session-enabled-field').value=desired?'on':'';}
  catch(e){input.disabled=false;throw e;}
  // Re-render so every duplicate card for this same session (when fewer real sessions than slots
  // means one session appears more than once) reflects the new state, not just this one. This
  // replaces `input` in the DOM, so re-enabling it here would touch a now-detached element.
  renderSessionCards();
 });
 toggle.append(robot,input,document.createElement('span'));
 // The card shows which data profile the session runs; without one there is no AI switch, only "Pasang profil".
 if(s.aiProfile){const chip=element('span','ai-session-profile');chip.append(element('small','',(profileType(s.aiProfile.profile_type)?.name??s.aiProfile.profile_type).toUpperCase()),element('strong','',s.aiProfile.name));foot.append(chip,toggle);}
 else{const attach=button('Pasang profil',async()=>{selectSession(s.id);await openAttach(s);});attach.classList.add('ai-session-attach');attach.addEventListener('click',e=>e.stopPropagation());attach.disabled=!active;foot.append(element('span','ai-session-noprofile','Belum ada profil AI'),attach);}
 card.append(head,foot);
 card.onclick=()=>selectSession(s.id);
 card.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selectSession(s.id);}};
 return card;
}
// Infinite loop: render extra copies before/after the real list so sliding past either end
// always has a next card, then snap (no transition) back into the middle copy once we pass it.
// 3 full cards visible (the center one editable), plus a half-card peek on each side — but on
// phone-width viewports (matching the 760px breakpoint used elsewhere for the AI tab), just 1 card
// filling the viewport edge-to-edge, since 3 cards at the 120px floor don't fit a phone screen.
function aiSessionFullCardsFor(viewport){return viewport<760?1:3;}
// aiSessionIndex indexes into the slot list (real sessions + placeholders), not just aiSessions —
// selectSession() passes the real session's position in aiSessions, which is always <= its
// position in slots since real sessions are placed first by buildSessionSlots().
function renderSessionCards(){
 const slots=buildSessionSlots(),count=slots.length;
 $('ai-session-prev').disabled=$('ai-session-next').disabled=count===0;
 if(!count){$('ai-session-track').replaceChildren();$('ai-session-dots').replaceChildren();return;}
 const track=$('ai-session-track');
 const gap=12,viewport=$('ai-session-cards').getBoundingClientRect().width;
 // Bail out while the carousel's container is hidden (width 0 — e.g. the AI tab isn't the active
 // one yet, so a width-based layout computed now would be garbage). The ResizeObserver below
 // re-triggers this once the container actually gets measured, so nothing is lost by waiting.
 if(viewport<=0)return;
 // N full slots + half a slot peeking on each side = N+1 slots' worth of width — except at 1 full
 // card (phone width), where the single card fills the viewport edge-to-edge with no peek at all.
 const aiSessionFullCards=aiSessionFullCardsFor(viewport);
 const visibleCards=aiSessionFullCards===1?1:aiSessionFullCards+1;
 const cardWidth=Math.max(120,Math.floor((viewport-gap*(visibleCards-1))/visibleCards));
 document.documentElement.style.setProperty('--ai-card-width',cardWidth+'px');
 // Repeat the slot list enough times that sliding to either edge of the visible window, from
 // any starting position, always lands inside the buffer — not just 3x, which isn't enough slack
 // when there are fewer slots than visible cards (e.g. 1-4 slots shown across 5 visible positions).
 const copies=Math.max(3,Math.ceil((visibleCards*2+2)/count));
 const middleBlock=Math.floor(copies/2);
 // The active card sits at flat-array index (middleBlock*count + aiSessionIndex) in the middle
 // block; every other card's offset from it is just its own flat index minus that center index.
 const centerFlatIndex=middleBlock*count+aiSessionIndex;
 track.replaceChildren(...Array.from({length:copies},()=>slots).flat().map((s,i)=>buildSessionCard(s,i-centerFlatIndex)));
 // Leading peek: leave a sliver of empty space on each side so the previous card peeks in on the
 // left and two upcoming cards are visible on the right — half/ACTIVE/full/full/half. The active
 // card sits right after the left sliver (the first of the 3 full slots), favoring a look-ahead
 // layout over a strictly centered one.
 const sliver=Math.max(0,viewport-aiSessionFullCards*cardWidth-(aiSessionFullCards-1)*gap)/2;
 track.style.transition='none';
 track.style.transform='translateX(-'+(centerFlatIndex*(cardWidth+gap)-sliver)+'px)';
 track.offsetHeight; // force reflow so the next transform change animates
 track.style.transition='';
 $('ai-session-dots').replaceChildren(...slots.map((_,i)=>{
  const dot=document.createElement('button');dot.type='button';dot.className='ai-session-dot'+(i===((aiSessionIndex%count)+count)%count?' active':'');
  dot.setAttribute('aria-label','Slot '+(i+1));dot.onclick=()=>{aiSessionIndex=i;renderSessionCards();settleSession();};
  return dot;
 }));
}
// Makes the centered slot (after a prev/next slide or a dot click) actually become the active
// session, instead of just looking centered while the form below still shows whichever session
// was active before. A real session centers → selectSession() (same as clicking its card
// directly): syncs $('ai-session').value and reloads its knowledge/products/orders tabs. A
// placeholder centers → no session is active, so the form hides like the zero-sessions state.
function settleSession(){
 const slots=buildSessionSlots();if(!slots.length)return;
 const index=((aiSessionIndex%slots.length)+slots.length)%slots.length;
 const slot=slots[index];
 if(slot.placeholder){if($('ai-session').value){$('ai-session').value='';renderAISessionFilters();run(loadAssistant);}}
 else if(slot.id!==$('ai-session').value)selectSession(slot.id);
}
function slideSession(delta){const count=buildSessionSlots().length;if(!count)return;aiSessionIndex+=delta;renderSessionCards();
 // After the slide animation, if we've drifted into the buffer copies, snap back to the middle
 // copy at the equivalent position without animating, so the loop never runs out of cards. Settling
 // which session is active is debounced the same way, so rapid clicks don't fire a request per click.
 clearTimeout(slideSession.snapTimer);
 slideSession.snapTimer=setTimeout(()=>{const count=buildSessionSlots().length;if(aiSessionIndex<0||aiSessionIndex>=count){aiSessionIndex=((aiSessionIndex%count)+count)%count;renderSessionCards();}settleSession();},360);
}
$('ai-session-prev').onclick=()=>slideSession(-1);
$('ai-session-next').onclick=()=>slideSession(1);
// A plain 'resize' listener misses the case that actually matters here: the AI tab going from
// display:none to visible (its container has zero width while hidden, so the width-dependent card
// sizing computed at that point is garbage). ResizeObserver fires whenever the box actually changes
// size for any reason, including becoming visible, so the carousel re-measures correctly every time.
new ResizeObserver(()=>renderSessionCards()).observe($('ai-session-cards'));
async function loadAIUsage(page=aiUsagePage){
 if(aiUsageLoading)return;aiUsageLoading=true;$('ai-usage-prev').disabled=$('ai-usage-next').disabled=true;
 try{const result=await api('/api/ai/usage?page='+page);aiUsagePage=result.page;const rows=result.items;
 table('ai-usage',['Waktu','Sesi','Pelanggan','Status','Kata input','Kata output','Kredit dipotong'],rows,r=>[new Date(r.created_at).toLocaleString('id-ID'),r.session_id,r.customer,({fallback_sent:'Pesan bantuan terkirim',fallback_generated:'Menyiapkan pesan bantuan',fallback_send_failed:'Pesan bantuan gagal terkirim',fallback_send_unknown:'Pengiriman bantuan belum pasti',sent:'Terkirim',generating:'Memproses',generated:'Menunggu pengiriman',cancelled:'Dibatalkan',provider_failed:'AI gagal / hasil tidak valid',interrupted:'Terhenti saat restart',send_failed:'WhatsApp gagal',send_unknown:'Pengiriman belum pasti'})[r.status]||r.status,r.input_words,r.output_words,r.charged]);
 $('ai-usage-page').textContent='Halaman '+result.page+' dari '+result.pages+' · '+result.total+' riwayat';
 $('ai-usage-prev').disabled=result.page<=1;$('ai-usage-next').disabled=result.page>=result.pages;
 }catch(error){$('ai-usage-prev').disabled=aiUsagePage<=1;$('ai-usage-next').disabled=false;throw error;}finally{aiUsageLoading=false;}
}
$('ai-usage-prev').onclick=()=>run(()=>loadAIUsage(aiUsagePage-1));
$('ai-usage-next').onclick=()=>run(()=>loadAIUsage(aiUsagePage+1));
let assistantLoad=0;
const sourceKinds=['products','orders'];
const profileFields=['usaha','cara_pemesanan','pembayaran','kebijakan','faq'];
function sourceVisibility(){for(const kind of sourceKinds){const external=$('ai-form').elements[kind+'_mode'].value==='endpoint';$('ai-'+kind+'-endpoint').hidden=!external;$('ai-form').elements[kind+'_endpoint'].required=external;if(external)$('ai-'+kind+'-endpoint').closest('details').open=true;}}

// Autosave: each field saves itself, debounced, instead of one big "Simpan semua tab" submit.
// A per-element timer means typing in one textarea never resets another field's pending save.
const autosaveTimers=new WeakMap();
let autosaveStatusToken=0;
// Shown as a small pinned icon badge (see .ai-save-status in style.css), not inline text, so it
// never pushes the header layout around. The wording is kept as visually-hidden text inside it so
// aria-live still announces it to assistive tech, and as a title attribute for a mouse tooltip.
function autosaveStatus(state,text){const el=$('ai-save-status');const token=++autosaveStatusToken;el.className='ai-save-status '+state;el.title=text;el.innerHTML='';const label=document.createElement('span');label.className='sr-only';label.textContent=text;el.append(label);if(state==='saved')setTimeout(()=>{if(token===autosaveStatusToken){el.className='ai-save-status';el.title='';el.innerHTML='';}},2500);}
async function autosaveField(field,value){const target=aiTarget(),base=dataBase();if(!target)return;
 autosaveStatus('saving','Menyimpan…');
 try{const config=await api(base+'/field','PATCH',{field,value});
  if(target!==aiTarget())return; // user switched sessions or data profiles while this was in flight
  applyAssistantConfig(config,{keepFocus:true});
  autosaveStatus('saved','Tersimpan');
 }catch(e){autosaveStatus('error',e.message);throw e;}
}
function debounceAutosave(el,field,value,delay=800){clearTimeout(autosaveTimers.get(el));autosaveTimers.set(el,setTimeout(()=>run(()=>autosaveField(field,value)),delay));}
for(const field of profileFields){const el=$('ai-form').elements['profile_'+field];el.oninput=()=>debounceAutosave(el,field,el.value);}
{const el=$('ai-form').elements.behavior;el.oninput=()=>debounceAutosave(el,'behavior',el.value);}
{const el=$('ai-form').elements.fallback_number;el.oninput=()=>debounceAutosave(el,'fallback_number',el.value);}
$('ai-form').elements.fallback_notify.onchange=e=>run(()=>autosaveField('fallback_notify',e.target.checked));
for(const kind of sourceKinds){
 const sourceValue=()=>({mode:$('ai-form').elements[kind+'_mode'].value,endpoint:$('ai-form').elements[kind+'_endpoint'].value,token:$('ai-form').elements[kind+'_token'].value||undefined,clear_token:$('ai-form').elements[kind+'_clear_token'].checked});
 $('ai-form').elements[kind+'_mode'].onchange=()=>{sourceVisibility();run(()=>autosaveField(kind+'_source',sourceValue()));};
 $('ai-form').elements[kind+'_clear_token'].onchange=()=>run(()=>autosaveField(kind+'_source',sourceValue()));
 const endpointEl=$('ai-form').elements[kind+'_endpoint'];endpointEl.oninput=()=>debounceAutosave(endpointEl,kind+'_source',sourceValue());
 const tokenEl=$('ai-form').elements[kind+'_token'];tokenEl.oninput=()=>{if(tokenEl.value)debounceAutosave(tokenEl,kind+'_source',sourceValue());};
}
// keepFocus:true (autosave response) skips whichever field the user is actively typing in, so a
// round-trip triggered by their own keystrokes never overwrites what they're still typing.
function applyAssistantConfig(config,{keepFocus=false}={}){
 const active=keepFocus?document.activeElement:null;
 const setValue=(el,value)=>{if(el!==active)el.value=value;};
 for(const field of profileFields)setValue($('ai-form').elements['profile_'+field],config.profile?.[field]??'');
 setValue($('ai-form').elements.behavior,config.behavior??'');
 setValue($('ai-form').elements.fallback_number,config.fallback_number??'');
 if($('ai-form').elements.fallback_notify!==active)$('ai-form').elements.fallback_notify.checked=Boolean(config.fallback_notify);
 // A data profile has no AI switch of its own; only a session's settings carry it.
 if('enabled' in config)$('ai-session-enabled-field').value=config.enabled?'on':'';
 for(const kind of sourceKinds){const src=config[kind+'_source']||{mode:'builtin',endpoint:'',has_token:false};
  if($('ai-form').elements[kind+'_mode']!==active)$('ai-form').elements[kind+'_mode'].value=src.mode;
  setValue($('ai-form').elements[kind+'_endpoint'],src.endpoint);
  // The token input always reads back empty (the stored secret is never sent to the client); leave
  // it alone if the user is mid-edit so their unsent keystrokes aren't wiped by the save response.
  if($('ai-form').elements[kind+'_token']!==active)$('ai-form').elements[kind+'_token'].value='';
  if($('ai-form').elements[kind+'_clear_token']!==active)$('ai-form').elements[kind+'_clear_token'].checked=false;
  $('ai-'+kind+'-token-status').textContent=src.has_token?'Token tersimpan terenkripsi.':'Tanpa token.';
 }
 sourceVisibility();
}
async function loadAssistant(){const generation=++assistantLoad,id=$('ai-session').value;
 // .elements includes every form-associated control in the DOM subtree, named or not — that also
 // catches the nameless per-card toggles inside the session carousel, which must keep their own
 // disabled state (only the centered card's toggle is editable) instead of following this form.
 const controls=[...$('ai-form').elements].filter(x=>x.name&&x.name!=='session');for(const control of controls)control.disabled=true;
 renderAIView();$('ai-trial-session').value=aiView==='sessions'?id:'';
 // Knowledge, products and orders are the target data profile's; without one there is nothing to edit.
 const target=aiTarget(),sessions=aiView==='sessions';
 $('ai-product-add').disabled=$('ai-order-add').disabled=true;
 try{const config=sessions&&id?await api('/sessions/'+encodeURIComponent(id)+'/ai'):!sessions&&target?await api(profileBase(target)):{enabled:false,profile:{},behavior:''};if(generation!==assistantLoad)return;
 applyAssistantConfig(config);
 if(!sessions||!id){chat.id='';chat.active='';chat.list=[];renderChatList();renderChatView();}
 await Promise.all([sessions&&id?loadConversations():null,target?loadAIData(generation):null]);
 if(!target)for(const name of ['ai-products','ai-orders','ai-fallbacks'])$(name).replaceChildren();
 }finally{if(generation===assistantLoad){for(const control of controls)control.disabled=!target;$('ai-product-add').disabled=$('ai-order-add').disabled=!target;}}}
async function loadAIData(generation=assistantLoad){const target=aiTarget();if(!target)return;const base=dataBase();const [products,orders]=await Promise.all([api(base+'/products'),api(base+'/orders')]);if(generation!==assistantLoad||target!==aiTarget())return;
 table('ai-products',['Foto','Nama','Jenis','Deskripsi','Harga','Stok/kapasitas','Status','Tindakan'],products,p=>{let photo='—';if(p.image_id){photo=document.createElement('img');photo.src=productImageUrl(p.image_id);photo.alt='Foto '+p.name;photo.width=48;photo.height=48;photo.className='ai-product-thumb';}return [photo,p.name,p.type==='service'?'Layanan':'Produk',p.description,money(p.price),p.stock,p.active?'Aktif':'Nonaktif',button('Edit',()=>openProduct(p))];});
 $('ai-product-codes').replaceChildren(...products.filter(p=>p.active).map(p=>new Option(p.name)));
// Icon-only actions keep the orders table narrow; aria-label/title carry the name for screen readers and hover.
const actionIcons={edit:'<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',delete:'<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>'};
function iconButton(kind,label,action){const b=button('',action);b.classList.add('table-icon-button',kind==='delete'?'danger':'secondary');b.setAttribute('aria-label',label);b.title=label;b.innerHTML='<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+actionIcons[kind]+'</svg>';return b;}
function orderActions(o){const actions=document.createElement('div');actions.className='row-actions table-actions';
 actions.append(iconButton('edit','Edit pesanan '+o.id,()=>{const f=$('ai-order-edit-form');f.elements.id.value=o.id;f.elements.status.value=o.status;f.elements.notes.value=o.notes;$('ai-order-detail').textContent=o.customer+' · '+o.items.map(i=>(i.product_name??i.name)+' × '+i.quantity+' @ '+money(i.price)).join(', ');$('ai-order-edit-dialog').showModal();}),
  iconButton('delete','Hapus pesanan '+o.id,async()=>{if(!confirm('Hapus pesanan '+o.id+'? Tindakan ini tidak dapat dibatalkan.'))return;await api(dataBase()+'/orders/'+encodeURIComponent(o.id),'DELETE');await loadAIData();$('message').textContent='Pesanan dihapus.';}));
 return actions;}
// Display names for the stored/API values pesanan_masuk, dibayar, diproses, selesai, dibatalkan.
const orderStatusLabels={pesanan_masuk:'Pesanan masuk',dibayar:'Dibayar',diproses:'Diproses',selesai:'Selesai',dibatalkan:'Dibatalkan'};
 // Sessions sharing a data profile collect their orders together; Sesi shows where each came from.
 table('ai-orders',['ID','Pelanggan','Sesi','Item','Total','Status','Tindakan'],orders,o=>[o.id,o.customer,o.session_id||'Data Profil',o.items.map(i=>(i.product_name??i.name)+' × '+i.quantity).join(', '),money(o.total),orderStatusLabels[o.status]??o.status,orderActions(o)]);
 if(aiView==='sessions')await loadFallbacks('/sessions/'+encodeURIComponent($('ai-session').value)+'/ai');else $('ai-fallbacks').replaceChildren();
}
let aiFallbacksPage=1,aiFallbacksLoading=false;
async function loadFallbacks(base=(()=>{const id=$('ai-session').value;return id&&aiView==='sessions'?'/sessions/'+encodeURIComponent(id)+'/ai':null;})(),page=aiFallbacksPage){
 if(!base||aiFallbacksLoading)return;aiFallbacksLoading=true;$('ai-fallbacks-prev').disabled=$('ai-fallbacks-next').disabled=true;
 try{const result=await api(base+'/fallbacks?page='+page);aiFallbacksPage=result.page;
 table('ai-fallbacks',['ID','Pelanggan','Status','Pertanyaan','Dibuat','Tindakan'],result.items,row=>{const actions=document.createElement('div');actions.className='row-actions';if(row.status==='waiting')actions.append(button('Jawab',async()=>{const answer=prompt('Jawaban untuk pelanggan:');if(!answer?.trim())return;await api(base+'/fallbacks/'+encodeURIComponent(row.id)+'/answer','POST',{answer});await loadFallbacks(base);}));if(row.status==='resolved'){actions.append(button('Ke Knowledge',()=>fallbackKnowledge(base,row)),button('Tambah produk',()=>fallbackProduct(row)));}actions.append(button('Hapus',async()=>{if(!confirm('Hapus tiket fallback ini?'))return;await api(base+'/fallbacks/'+encodeURIComponent(row.id),'DELETE');await loadFallbacks(base);}));return [row.id,row.customer,row.status,row.question,new Date(row.created_at).toLocaleString('id-ID'),actions.childElementCount?actions:'—'];});
 $('ai-fallbacks-page').textContent='Halaman '+result.page+' dari '+result.pages+' · '+result.total+' tiket';
 $('ai-fallbacks-prev').disabled=result.page<=1;$('ai-fallbacks-next').disabled=result.page>=result.pages;
 }catch(error){$('ai-fallbacks-prev').disabled=aiFallbacksPage<=1;$('ai-fallbacks-next').disabled=false;throw error;}finally{aiFallbacksLoading=false;}
}
$('ai-fallbacks-prev').onclick=()=>run(()=>loadFallbacks(undefined,aiFallbacksPage-1));
$('ai-fallbacks-next').onclick=()=>run(()=>loadFallbacks(undefined,aiFallbacksPage+1));
async function fallbackKnowledge(base,row){const draft='Pertanyaan: '+row.question+'\nJawaban: '+(row.staff_answer||'');const content=prompt('Periksa dan edit Knowledge sebelum diterapkan:',draft);if(!content?.trim())return;await api(base+'/fallbacks/'+encodeURIComponent(row.id)+'/knowledge','POST',{content});await loadAssistant();$('message').textContent='Knowledge dari tiket fallback diterapkan.';}
function fallbackProduct(row){const f=$('ai-product-form');f.reset();f.elements.description.value=('Referensi pertanyaan pelanggan: '+row.question+'\nKonfirmasi tim: '+(row.staff_answer||'')).slice(0,500);f.elements.active.checked=true;$('ai-product-dialog').showModal();}
function aiDataForm(id,action){form(id,async data=>{let error=$(id).querySelector('.form-error');if(!error){error=document.createElement('p');error.className='form-error';error.setAttribute('role','alert');$(id).prepend(error);}error.textContent='';try{await action(data);}catch(e){error.textContent=e.message;throw e;}});}
let editingProductName,currentImageId=null;
function productImageUrl(imageId){return dataBase()+'/products-image/'+encodeURIComponent(imageId);}
function showProductImage(imageId){currentImageId=imageId;const preview=$('ai-product-image-preview'),remove=$('ai-product-image-remove');if(imageId){preview.src=productImageUrl(imageId);preview.hidden=false;remove.hidden=false;}else{preview.hidden=true;remove.hidden=true;}}
function openProduct(product){const f=$('ai-product-form');f.reset();editingProductName=product?product.name:'';if(product)for(const key of ['name','type','description','price','stock'])f.elements[key].value=product[key];f.elements.active.checked=product?product.active:true;$('ai-product-image-input').value='';$('ai-product-image-status').textContent='';showProductImage(product?.image_id??null);$('ai-product-dialog').showModal();}
$('ai-product-add').onclick=()=>openProduct();
$('ai-product-image-input').onchange=()=>run(async()=>{const file=$('ai-product-image-input').files[0];if(!file)return;const status=$('ai-product-image-status');status.textContent='Mengunggah…';
 const response=await fetch(dataBase()+'/products-image',{method:'POST',headers:{'X-Filename':file.name},body:file});
 const data=await response.json().catch(()=>({}));
 if(!response.ok){status.textContent=data.message||'Gagal mengunggah foto.';return;}
 status.textContent='Foto tersimpan.';showProductImage(data.id);});
$('ai-product-image-remove').onclick=()=>{showProductImage(null);$('ai-product-image-input').value='';$('ai-product-image-status').textContent='Foto akan dihapus saat produk disimpan.';};
aiDataForm('ai-product-form',async data=>{const base=dataBase(),payload={...data,price:Number(data.price),stock:Number(data.stock),active:data.active==='on',image_id:currentImageId};if(editingProductName)await api(base+'/products/'+encodeURIComponent(editingProductName),'PUT',payload);else await api(base+'/products','POST',payload);$('ai-product-dialog').close();await loadAIData();$('message').textContent='Produk tersimpan.';});
let orderRequest;
$('ai-order-add').onclick=()=>{$('ai-order-form').reset();orderRequest=undefined;$('ai-order-dialog').showModal();};
aiDataForm('ai-order-form',async data=>{const base=dataBase(),payload={customer:data.customer,items:[{product_name:data.product_name,quantity:Number(data.quantity)}],notes:data.notes};const signature=JSON.stringify([base,payload]);if(!orderRequest||orderRequest.signature!==signature)orderRequest={signature,key:crypto.randomUUID()};await api(base+'/orders','POST',payload,{'Idempotency-Key':orderRequest.key});$('ai-order-dialog').close();orderRequest=undefined;await loadAIData();$('message').textContent='Pesanan tercatat untuk diproses.';});
aiDataForm('ai-order-edit-form',async data=>{await api(dataBase()+'/orders/'+encodeURIComponent(data.id),'PUT',{status:data.status,notes:data.notes});$('ai-order-edit-dialog').close();await loadAIData();$('message').textContent='Pesanan diperbarui.';});
// Chat view of the AI page: conversation list on the left, WhatsApp-style history on the right.
const chat={id:'',list:[],contacts:new Map(),saved:new Set(),filter:'all',search:'',active:'',messages:[],before:null,loading:false,sending:false,refresh:undefined};
const chatTick={sent:'<path d="M3 12.5 7.5 17 17 7"/>',delivered:'<path d="M1.5 12.5 6 17 15.5 7"/><path d="M9 16.5 9.5 17 19 7"/>'};
const chatOrigins={ai:'AI',manual:'Manual',api:'API',system:'Sistem'};
// Indonesian numbers read as +62 812-3456-7890; others stay as sent.
function chatNumber(customer){if(!customer.startsWith('62'))return customer;const rest=customer.slice(2);return '+62 '+[rest.slice(0,3),rest.slice(3,7),rest.slice(7)].filter(Boolean).join('-');}
function chatName(customer){return chat.contacts.get(customer)||chatNumber(customer);}
function chatInitials(customer){const name=chat.contacts.get(customer);return name?name.split(/\s+/).map(w=>w[0]).slice(0,2).join('').toUpperCase():'#';}
function chatState(entry){if($('ai-session-enabled-field').value!=='on')return ['off','AI nonaktif'];return entry.paused?['paused','Dijeda']:entry.full_auto?['full','Full auto']:['ai','AI aktif'];}
function chatDay(value){const date=new Date(value),today=new Date();const start=d=>new Date(d.getFullYear(),d.getMonth(),d.getDate()).getTime();const days=Math.round((start(today)-start(date))/86400000);return days===0?'Hari ini':days===1?'Kemarin':date.toLocaleDateString('id-ID',{day:'numeric',month:'long',year:'numeric'});}
function chatClock(value){return new Date(value).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});}
function chatListTime(value){if(!value)return '';const days=chatDay(value);return days==='Hari ini'?chatClock(value):days==='Kemarin'?'Kemarin':new Date(value).toLocaleDateString('id-ID',{day:'2-digit',month:'2-digit'});}
async function loadConversations(){
 const id=$('ai-session').value,generation=assistantLoad;if(!id||aiView!=='sessions')return;
 const [rows,savedContacts]=await Promise.all([api('/sessions/'+encodeURIComponent(id)+'/ai/chats'),api('/auto-share/contacts')]);if(id!==$('ai-session').value||generation!==assistantLoad)return;
 if(chat.id!==id){chat.active='';chat.messages=[];chat.before=null;}
 chat.id=id;chat.list=rows;const number=c=>String(c.nomor).replace(/@s\.whatsapp\.net$/,'');chat.saved=new Set(savedContacts.map(number));chat.contacts=new Map(savedContacts.filter(c=>c.nama).map(c=>[number(c),c.nama]));
 renderChatList();
 if(chat.active)await loadChatMessages();else renderChatView();
}
function renderChatList(){
 const counts={all:chat.list.length,ai:0,paused:0,full:0};for(const entry of chat.list)counts[chatState(entry)[0]]=(counts[chatState(entry)[0]]||0)+1;
 for(const b of document.querySelectorAll('[data-chat-filter]')){const key=b.dataset.chatFilter;b.textContent=({all:'Semua',ai:'AI aktif',paused:'Dijeda',full:'Full auto'})[key]+' '+(counts[key]||0);b.setAttribute('aria-pressed',String(chat.filter===key));}
 const query=chat.search.trim().toLowerCase();
 const shown=chat.list.filter(entry=>(chat.filter==='all'||chatState(entry)[0]===chat.filter)&&(!query||entry.customer.includes(query.replace(/\D/g,'')||'\u0000')||chatName(entry.customer).toLowerCase().includes(query)));
 const list=$('chat-list');
 if(!shown.length){const empty=document.createElement('p');empty.className='chat-list-empty';empty.textContent=chat.list.length?'Tidak ada percakapan yang cocok.':'Belum ada percakapan. Pesan pribadi yang masuk ke sesi ini akan tampil di sini.';list.replaceChildren(empty);return;}
 list.replaceChildren(...shown.map(entry=>{
  const item=document.createElement('button'),avatar=document.createElement('span'),body=document.createElement('span'),top=document.createElement('span'),name=document.createElement('strong'),time=document.createElement('span'),bottom=document.createElement('span'),preview=document.createElement('span'),badge=document.createElement('span');
  const [state,label]=chatState(entry),last=entry.last;
  item.type='button';item.className='chat-item'+(entry.customer===chat.active?' active':'');item.setAttribute('aria-current',String(entry.customer===chat.active));
  avatar.className='chat-avatar';avatar.textContent=chatInitials(entry.customer);avatar.setAttribute('aria-hidden','true');
  name.textContent=chatName(entry.customer);time.className='chat-item-time';time.textContent=chatListTime(last?.at);
  preview.className='chat-item-preview';preview.textContent=last?(last.direction==='out'?(last.origin==='ai'?'AI: ':'Anda: '):'')+last.text:'Belum ada riwayat chat';
  badge.className='chat-badge '+state;badge.textContent=label;
  top.append(name,time);bottom.append(preview,badge);body.className='chat-item-body';body.append(top,bottom);item.append(avatar,body);
  item.onclick=()=>run(async()=>{chat.active=entry.customer;chat.messages=[];chat.before=null;renderChatList();$('chat-shell').classList.add('chat-open');await loadChatMessages();
   // On a phone the chat sits below the session picker; bring the whole chat, composer included, into view.
   if(matchMedia('(max-width:760px)').matches)$('chat-shell').scrollIntoView({block:'start'});else $('chat-text').focus({preventScroll:true});});
  return item;
 }));
}
async function loadChatMessages(older=false){
 const id=chat.id,customer=chat.active;if(!id||!customer)return;
 const query=older&&chat.before?'?before='+encodeURIComponent(chat.before):'';
 const page=await api('/sessions/'+encodeURIComponent(id)+'/ai/chats/'+encodeURIComponent(customer)+'/messages'+query);
 if(id!==chat.id||customer!==chat.active)return;
 const box=$('chat-messages'),nearBottom=box.scrollHeight-box.scrollTop-box.clientHeight<80,previousHeight=box.scrollHeight;
 if(older){chat.messages=[...page.messages,...chat.messages];}else{chat.messages=page.messages;}
 chat.before=page.before;
 renderChatView();
 if(older)box.scrollTop=box.scrollHeight-previousHeight;else if(nearBottom||!box.dataset.opened||box.dataset.opened!==customer){box.scrollTop=box.scrollHeight;box.dataset.opened=customer;}
}
function renderChatView(){
 const entry=chat.list.find(e=>e.customer===chat.active);
 $('chat-empty').hidden=Boolean(chat.active);$('chat-view').hidden=!chat.active;if(!chat.active){$('chat-shell').classList.remove('chat-open');return;}
 const current=entry??{customer:chat.active,paused:false,full_auto:false,message_count:0,router_context:null};
 const [state,label]=chatState(current);
 $('chat-avatar').textContent=chatInitials(current.customer);$('chat-name').textContent=chatName(current.customer);
 $('chat-meta').textContent=(chat.contacts.has(current.customer)?chatNumber(current.customer)+' · ':'')+current.message_count+' pesan di memori AI';
 $('chat-status').className='chat-status '+state;$('chat-status').textContent=label;
 $('chat-pause').textContent=current.paused?'Lanjutkan AI':'Jeda AI';$('chat-full-auto').checked=Boolean(current.full_auto);
 $('chat-save-contact').hidden=chat.saved.has(current.customer);
 $('chat-context').hidden=!current.router_context;$('chat-context-value').textContent=current.router_context||'';
 const nodes=[];
 if(chat.before){const more=button('Muat pesan sebelumnya',()=>loadChatMessages(true));more.className='secondary chat-more';nodes.push(more);}
 if(!chat.messages.length){const empty=document.createElement('p');empty.className='chat-note';empty.textContent='Belum ada riwayat chat yang tersimpan untuk pelanggan ini.';nodes.push(empty);}
 let day='';
 for(const m of chat.messages){
  const label=chatDay(m.at);if(label!==day){day=label;const divider=document.createElement('div');divider.className='chat-day';divider.textContent=label;nodes.push(divider);}
  if(m.direction==='note'){const note=document.createElement('div');note.className='chat-note';note.textContent=m.text+' · '+chatClock(m.at);nodes.push(note);continue;}
  const bubble=document.createElement('div'),text=document.createElement('span'),meta=document.createElement('span');
  bubble.className='chat-bubble '+(m.direction==='in'?'in':'out '+m.origin);text.className='chat-text';text.textContent=m.text;meta.className='chat-bubble-meta';
  if(m.direction==='out'){const tag=document.createElement('span');tag.className='chat-tag '+m.origin;tag.textContent=chatOrigins[m.origin]||m.origin;meta.append(tag);}
  meta.append(document.createTextNode(chatClock(m.at)));
  if(m.direction==='out'&&m.status){const tick=document.createElementNS('http://www.w3.org/2000/svg','svg');tick.setAttribute('viewBox','0 0 20 20');tick.setAttribute('width','16');tick.setAttribute('height','16');tick.setAttribute('class','chat-tick '+m.status);tick.setAttribute('role','img');tick.setAttribute('aria-label',({sent:'Terkirim',delivered:'Diterima',read:'Dibaca'})[m.status]);tick.innerHTML=m.status==='sent'?chatTick.sent:chatTick.delivered;meta.append(tick);}
  bubble.append(text,meta);nodes.push(bubble);
 }
 $('chat-messages').replaceChildren(...nodes);
}
async function updateChatConversation(body){await api('/sessions/'+encodeURIComponent(chat.id)+'/ai/conversations/'+encodeURIComponent(chat.active),'PUT',body);await loadConversations();}
$('chat-pause').onclick=()=>run(async()=>{const entry=chat.list.find(e=>e.customer===chat.active);await updateChatConversation({paused:!entry?.paused,full_auto:false});});
$('chat-full-auto').onchange=e=>run(async()=>{try{await updateChatConversation({paused:false,full_auto:e.target.checked});}catch(error){e.target.checked=!e.target.checked;throw error;}});
$('chat-clear').onclick=()=>run(async()=>{if(!confirm('Hapus memori AI pelanggan ini? Riwayat chat tetap tersimpan.'))return;const entry=chat.list.find(e=>e.customer===chat.active);await updateChatConversation({paused:Boolean(entry?.paused),clear:true});});
$('chat-save-contact').onclick=()=>run(async()=>{await loadAutoShare();openShareContact({nomor:chat.active});});
$('chat-back').onclick=()=>{$('chat-shell').classList.remove('chat-open');};
$('chat-refresh').onclick=()=>run(loadConversations);
$('chat-search').oninput=e=>{chat.search=e.target.value;renderChatList();};
for(const b of document.querySelectorAll('[data-chat-filter]'))b.onclick=()=>{chat.filter=b.dataset.chatFilter;renderChatList();};
// One Idempotency-Key per typed message, so a double submit or a retry never sends it twice.
let chatPending={text:'',key:''};
$('chat-text').oninput=e=>{e.target.style.height='46px';e.target.style.height=Math.min(Math.max(e.target.scrollHeight,46),140)+'px';};
$('chat-text').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('chat-composer').requestSubmit();}};
$('chat-composer').onsubmit=e=>{e.preventDefault();const input=$('chat-text'),text=input.value.trim();if(!text||chat.sending||!chat.active)return;
 if(chatPending.text!==text)chatPending={text,key:crypto.randomUUID()};
 void run(async()=>{chat.sending=true;e.currentTarget.querySelector('.chat-send').disabled=true;try{await api('/sessions/'+encodeURIComponent(chat.id)+'/ai/chats/'+encodeURIComponent(chat.active)+'/messages','POST',{text},{'Idempotency-Key':chatPending.key});input.value='';input.style.height='46px';chatPending={text:'',key:''};await loadConversations();await wallet();}finally{chat.sending=false;$('chat-composer').querySelector('.chat-send').disabled=false;}});};
// Realtime: any change to the open session's chats refreshes the list and, when it is open, the conversation.
function chatRealtime(data){if(data.event!=='chat.updated'||data.sessionId!==chat.id||$('ai-tab-conversations').hidden)return;clearTimeout(chat.refresh);chat.refresh=setTimeout(()=>{void run(loadConversations);},400);}
form('ai-trial-form',async data=>{$('ai-trial-error').textContent='';$('ai-trial-answer').hidden=true;try{const result=await api('/api/ai/trial','POST',aiView==='profiles'?{data_profile:aiTarget(),question:data.question}:{session:data.session,question:data.question});$('ai-trial-answer-text').textContent=result.answer;$('ai-trial-answer').hidden=false;await loadAI();}catch(e){$('ai-trial-error').textContent=e.message;}});
function aiCreditSummary(){const units=Number($('ai-credit-units').value),valid=Number.isSafeInteger(units)&&units>=1&&units<=100;$('ai-credit-summary').textContent=valid&&aiCreditPrice?`${new Intl.NumberFormat('id-ID').format(units*10000)} kredit AI · ${money(aiCreditPrice*units)}`:'Jumlah unit harus bilangan 1–100.';$('ai-credit-confirm').disabled=!valid||!aiCreditPrice;return valid?units:null;}
$('ai-credit-units').oninput=aiCreditSummary;
$('ai-credit-confirm').onclick=()=>run(async()=>{const units=aiCreditSummary();if(!units)return;const control=$('ai-credit-confirm');control.disabled=true;try{const order=await api('/api/ai/payments','POST',{units});$('ai-credit-modal').close();await checkout(order.id);await paymentList();}finally{control.disabled=false;await loadAI();}});
{const form=$('ai-config'),provider=document.createElement('label'),select=document.createElement('select'),helper=document.createElement('p');provider.className='ai-legacy-provider';provider.textContent='Provider AI';select.name='provider';select.append(new Option('Sumopod','sumopod'),new Option('OpenRouter','openrouter'),new Option('Provider kompatibel OpenAI','compatible'));provider.append(select);helper.className='ai-helper ai-legacy-provider';helper.id='ai-provider-helper';form.elements.endpoint.closest('label').classList.add('ai-legacy-provider');form.querySelector('fieldset').classList.add('ai-legacy-provider');form.insertBefore(provider,form.elements.endpoint.closest('label'));form.insertBefore(helper,form.elements.endpoint.closest('label'));const describe=()=>{const selected=select.value,managed=selected!=='compatible';helper.textContent=selected==='openrouter'?'OpenRouter memakai endpoint otomatis, API key OpenRouter, dan model dengan format provider/model. Pilih model yang mendukung Structured Outputs bila Router memakai output terstruktur.':selected==='sumopod'?'Sumopod memakai endpoint otomatis. Gunakan API key dan nama model dari akun Sumopod Anda.':'Gunakan endpoint API yang kompatibel dengan OpenAI Chat Completions.';form.elements.endpoint.readOnly=managed;if(selected==='openrouter')form.elements.endpoint.value='https://openrouter.ai/api/v1/chat/completions';if(selected==='sumopod')form.elements.endpoint.value='https://ai.sumopod.com/v1/chat/completions';};select.onchange=describe;describe();}
let providerProfiles={profiles:[],routes:[]};
const aiTiers=[['cheap','Murah'],['medium','Sedang'],['smart','Cerdas'],['structured','Terstruktur']];
{const panel=document.createElement('section'),title=document.createElement('div'),heading=document.createElement('h3'),add=document.createElement('button'),routes=document.createElement('form'),list=document.createElement('div'),dialog=document.createElement('dialog');panel.className='ai-provider-panel';heading.textContent='Profil provider AI';add.type='button';add.textContent='Tambah profil';title.className='integration-heading';title.append(heading,add);routes.className='ai-provider-routes';routes.innerHTML='<p>Gunakan profil berbeda untuk tiap tingkat model. API key tetap tersimpan di server.</p>';for(const [tier,label] of aiTiers){const row=document.createElement('label');row.textContent=label;const select=document.createElement('select');select.name=tier+'Profile';const model=document.createElement('input');model.name=tier+'Model';model.maxLength=100;model.placeholder='Nama model';row.append(select,model);routes.append(row);}const save=document.createElement('button');save.textContent='Simpan rute provider';routes.append(save);list.className='ai-provider-list';dialog.innerHTML='<div class="modal-heading"><h2 id="ai-provider-title">Profil provider</h2><button type="button" class="secondary" data-close> Tutup</button></div><form class="grid"><input name="id" type="hidden"><label>Nama profil<input name="name" required maxlength="100" placeholder="OpenRouter utama"></label><label>Provider<select name="provider"><option value="sumopod">Sumopod</option><option value="openrouter">OpenRouter</option><option value="compatible">Kompatibel OpenAI</option></select></label><label>Endpoint<input name="endpoint" type="url" required maxlength="512"></label><label>API key<input name="apiKey" type="password" autocomplete="off" maxlength="512" placeholder="Wajib untuk profil baru"></label><label><input name="active" type="checkbox" checked> Profil aktif</label><button>Simpan profil</button></form>';panel.append(title,routes,list,dialog);$('admin-ai').insertBefore(panel,$('ai-config').nextSibling);add.onclick=()=>openProviderProfile();dialog.querySelector('[data-close]').onclick=()=>dialog.close();dialog.querySelector('form').onsubmit=e=>{e.preventDefault();void run(async()=>{const f=e.currentTarget,data=Object.fromEntries(new FormData(f));data.active=f.elements.active.checked;await api('/api/admin/ai/providers','POST',data);dialog.close();await loadProviderProfiles();});};routes.onsubmit=e=>{e.preventDefault();void run(async()=>{const f=e.currentTarget,payload={};for(const tier of ['cheap','medium','smart'])payload[tier]={profileId:f.elements[tier+'Profile'].value,model:f.elements[tier+'Model'].value};await api('/api/admin/ai/providers/routes','PUT',payload);$('message').textContent='Rute provider tersimpan.';await loadProviderProfiles();});};window.__providerUi={panel,routes,list,dialog};}
{const ui=window.__providerUi,f=ui.dialog.querySelector('form');ui.routes.querySelectorAll('input').forEach(input=>input.remove());const active=f.elements.active.closest('label');for(const [tier,label] of aiTiers){const field=document.createElement('label'),input=document.createElement('input');field.textContent='Model '+label;input.name='model_'+tier;input.required=true;input.maxLength=100;input.placeholder='Nama model';field.append(input);f.insertBefore(field,active);}ui.routes.onsubmit=e=>{e.preventDefault();void run(async()=>{const payload={};for(const [tier] of aiTiers)payload[tier]={profileId:ui.routes.elements[tier+'Profile'].value};await api('/api/admin/ai/providers/routes','PUT',payload);$('message').textContent='Provider per tingkat tersimpan.';await loadProviderProfiles();});};}
function openProviderProfile(profile){const ui=window.__providerUi,f=ui.dialog.querySelector('form');f.reset();f.elements.id.value=profile?.id||'';f.elements.name.value=profile?.name||'';f.elements.provider.value=profile?.provider||'openrouter';f.elements.endpoint.value=profile?.endpoint||'https://openrouter.ai/api/v1/chat/completions';for(const [tier] of aiTiers)f.elements['model_'+tier].value=profile?.['model_'+tier]||'';f.elements.active.checked=profile?.active!==false;ui.dialog.showModal();}
async function loadProviderProfiles(){const ui=window.__providerUi;if(!ui)return;providerProfiles=await api('/api/admin/ai/providers');for(const [tier] of aiTiers){const select=ui.routes.elements[tier+'Profile'],route=providerProfiles.routes.find(r=>r.tier===tier);select.replaceChildren(...providerProfiles.profiles.filter(p=>p.active).map(p=>new Option(p.name+' · '+p.provider,p.id,p.id===route?.profile_id,p.id===route?.profile_id)));}ui.list.replaceChildren(...providerProfiles.profiles.map(profile=>{const row=document.createElement('article'),name=document.createElement('strong'),meta=document.createElement('span'),actions=document.createElement('div'),edit=button('Ubah',()=>openProviderProfile(profile)),test=button('Uji',async()=>{await api('/api/admin/ai/providers/test','POST',{id:profile.id,model:profile.model_medium});$('message').textContent='Koneksi '+profile.name+' berhasil diuji.';}),remove=button('Hapus',async()=>{if(!confirm('Hapus profil '+profile.name+'? API key dan pengaturan profil ini akan dihapus.'))return;await api('/api/admin/ai/providers/'+encodeURIComponent(profile.id),'DELETE');$('message').textContent='Profil '+profile.name+' dihapus.';await loadProviderProfiles();});remove.classList.add('danger');row.className='ai-provider-row';name.textContent=profile.name;meta.textContent=profile.provider+' · '+(profile.active?'Aktif':'Nonaktif');actions.className='row-actions';actions.append(edit,test,remove);row.append(name,meta,actions);return row;}));}
async function loadAIConfig(){const config=await api('/api/admin/ai');for(const name of ['provider','endpoint','model_cheap','model_medium','model_smart','model_structured','input_rate','output_rate','memory_limit','context_memory_limit','credit_price'])$('ai-config').elements[name].value=config[name];$('ai-config').elements.provider.dispatchEvent(new Event('change'));const routed=Boolean(config.profile_routing_enabled);document.querySelectorAll('.ai-legacy-provider,[data-ai-test]').forEach(el=>el.hidden=routed);$('ai-config').querySelectorAll('.ai-routing-note').forEach(el=>el.remove());if(routed){const note=document.createElement('p');note.className='ai-routing-note ai-helper';note.textContent='Provider dan model aktif mengikuti pilihan Model per tingkat di atas.';$('ai-config').prepend(note);}$('ai-config-status').textContent=routed?'API key dikelola pada tab Provider.':config.configured?'API key tersimpan terenkripsi.':'Koneksi AI belum dikonfigurasi. Tambahkan profil di tab Provider.';await loadProviderProfiles();}
const adminWithoutProviders=admin;admin=async()=>{await adminWithoutProviders();await loadProviderProfiles();};
{const page=$('admin-ai'),config=$('ai-config'),tabs=document.createElement('nav'),panels={},routes=window.__providerUi.routes,routesHeading=document.createElement('h3');tabs.className='ai-admin-tabs';tabs.setAttribute('aria-label','Sub menu pengaturan AI');for(const [id,label] of [['provider','Provider'],['model','Model'],['tidy','Rapikan Pesan'],['billing','Tarif & Kredit'],['memory','Memori & Log'],['usage','Pemakaian'],['balance','Saldo AI']]){const panel=document.createElement('section'),button=document.createElement('button');panel.className='ai-admin-panel';panels[id]=panel;button.type='button';button.textContent=label;button.onclick=()=>{for(const [key,other] of Object.entries(panels))other.hidden=key!==id;for(const tab of tabs.querySelectorAll('button'))tab.setAttribute('aria-pressed',String(tab===button));};tabs.append(button);}
const field=name=>config.elements[name].closest('label'),hint=node=>node.nextElementSibling?.tagName==='P'?node.nextElementSibling:null,own=nodes=>{for(const node of nodes)for(const control of node.querySelectorAll('input,select,textarea'))control.setAttribute('form','ai-config');return nodes;},saver=text=>{const button=document.createElement('button');button.setAttribute('form','ai-config');button.textContent=text;return button;};
const tidy=config.elements.tidy_prompt.closest('fieldset'),price=field('credit_price'),trace=field('trace_enabled'),save=config.querySelector('button:not([type])'),usageTitle=$('ai-model-usage').previousElementSibling?.previousElementSibling?.previousElementSibling,balanceTitle=$('ai-adjust').previousElementSibling;
const billing=own([price,hint(price),field('input_rate'),field('output_rate')].filter(Boolean)),memory=own([field('memory_limit'),field('context_memory_limit'),trace,hint(trace)].filter(Boolean));own([tidy]);
save.textContent='Simpan model';save.classList.add('ai-legacy-provider');routesHeading.textContent='Model per tingkat';routes.prepend(routesHeading);routes.querySelector('p').textContent='Cukup pilih profil yang sudah dibuat untuk setiap tingkat; API key tetap aman tersimpan di server. Tingkat Terstruktur dipakai node yang butuh output JSON pasti (Pesanan, dan Router bila dipindah ke tingkat ini), jadi isi dengan model yang mendukung JSON Schema.';
panels.provider.append($('ai-config-status'),page.querySelector('.ai-provider-panel'));panels.model.append(routes,config,...page.querySelectorAll('[data-ai-test]'));panels.tidy.append(tidy,saver('Simpan prompt rapikan'));panels.billing.append(...billing,saver('Simpan tarif & kredit'));panels.memory.append(...memory,saver('Simpan memori & log'));if(usageTitle)panels.usage.append(usageTitle,usageTitle.nextElementSibling,$('ai-model-refresh'),$('ai-model-usage'));if(balanceTitle)panels.balance.append(balanceTitle,$('ai-adjust'));config.noValidate=true;page.querySelector('h2').after(tabs);page.append(...Object.values(panels));tabs.querySelector('button').click();}
form('ai-config',async data=>{for(const key of ['input_rate','output_rate','memory_limit','context_memory_limit','credit_price'])data[key]=Number(data[key]);data.trace_enabled=data.trace_enabled==='on';await api('/api/admin/ai','PUT',data);await loadAIConfig();$('message').textContent='Pengaturan AI tersimpan.';});
document.querySelectorAll('[data-ai-test]').forEach(b=>{b.onclick=()=>run(async()=>{b.disabled=true;try{$('message').textContent=(await api('/api/admin/ai/test','POST',{tier:b.dataset.aiTest})).message;}finally{b.disabled=false;}});});
async function loadModelUsage(){table('ai-model-usage',['Waktu','Akun','Sesi','Status','Panggilan model'],await api('/api/admin/ai/usage'),r=>[new Date(r.created_at).toLocaleString('id-ID'),r.account_id,r.session_id,r.status,(typeof r.model_calls==='string'?JSON.parse(r.model_calls):r.model_calls||[]).map(c=>`${c.role}: ${c.model} (${c.status})`).join(' · ')||'—']);}
$('ai-model-refresh').onclick=()=>run(loadModelUsage);
let failuresPage=1,failuresLoading=false;
// Profiles are pipelines shipped in code; the owner switches each on or off for every client and tunes it in AI Studio.
async function loadAdminProfiles(){
 const rows=await api('/api/admin/ai/profiles');
 table('admin-profiles-list',['Profil','Alur aktif','Pemakaian','Untuk klien',''],rows,p=>{
  const name=element('div','admin-profile-name'),icon=element('span','admin-profile-icon');icon.innerHTML=chatIcon;const text=element('div');text.append(element('strong','',p.name),element('small','',p.nodes+' node · '+p.node_summary));name.append(icon,text);
  const flow=element('div','admin-profile-cell');flow.append(element('strong','',p.active_version?'Versi '+p.active_version:'Bawaan'),element('small','',p.revision>p.published_revision?'draft berubah':'draft sama dengan aktif'));
  const usage=element('div','admin-profile-cell');usage.append(element('strong','',p.sessions+' sesi'),element('small','',p.data_profiles+' data profil'));
  const toggle=element('label','ai-toggle admin-profile-toggle'),input=document.createElement('input'),state=element('strong','',p.enabled?'Aktif':'Nonaktif');input.type='checkbox';input.checked=p.enabled;input.setAttribute('aria-label',p.name+' aktif untuk klien');
  input.onchange=()=>run(async()=>{const enabled=input.checked;if(!enabled&&!confirm('Nonaktifkan '+p.name+'? AI berhenti membalas di '+p.sessions+' sesi yang memakainya. Data profil klien tidak dihapus.')){input.checked=true;return;}input.disabled=true;try{await api('/api/admin/ai/profiles/'+encodeURIComponent(p.id),'PUT',{enabled});$('message').textContent=p.name+(enabled?' diaktifkan untuk klien.':' dinonaktifkan.');}finally{await loadAdminProfiles();}});
  toggle.append(input,element('span'),state);
  const studio=element('a','button secondary','Buka di AI Studio');studio.href='/dashboard/admin/ai-studio?profile='+encodeURIComponent(p.id);studio.dataset.studio='';
  return [name,flow,usage,toggle,studio];
 });
}
async function loadFailures(page=failuresPage){
 if(failuresLoading)return;failuresLoading=true;$('ai-failures-prev').disabled=$('ai-failures-next').disabled=true;
 try{const result=await api('/api/admin/ai/failures?page='+page);failuresPage=result.page;
 table('ai-failures',['Waktu','Akun','Sesi','Agent','Model','Error','Pesan pelanggan','Tindakan'],result.items,r=>[new Date(r.created_at).toLocaleString('id-ID'),r.account_id,r.session_id,r.agent||'—',r.model||'—',r.error,r.message,button('Detail',async()=>{const detail=await api('/api/admin/ai/failures/'+r.id);$('failure-detail-context').textContent=detail.router_context||'Tidak ada (percakapan baru).';$('failure-detail-prompt').textContent=detail.prompt?JSON.stringify(detail.prompt,null,2):'Tidak tersedia.';$('failure-detail-raw').textContent=detail.raw_output||'Tidak tersedia.';$('failure-detail-dialog').showModal();})]);
 $('ai-failures-page').textContent='Halaman '+result.page+' dari '+result.pages+' · '+result.total+' kegagalan';
 $('ai-failures-prev').disabled=result.page<=1;$('ai-failures-next').disabled=result.page>=result.pages;
 }catch(error){$('ai-failures-prev').disabled=failuresPage<=1;$('ai-failures-next').disabled=false;throw error;}finally{failuresLoading=false;}
}
$('ai-failures-prev').onclick=()=>run(()=>loadFailures(failuresPage-1));
$('ai-failures-next').onclick=()=>run(()=>loadFailures(failuresPage+1));
let tracePage=1,traceLoading=false;
async function loadTraceRequests(page=tracePage){
 if(traceLoading)return;traceLoading=true;$('ai-trace-prev').disabled=$('ai-trace-next').disabled=true;
 try{const result=await api('/api/admin/ai/trace?page='+page);tracePage=result.page;
 table('ai-trace-requests',['Waktu mulai','Akun','Sesi','Jumlah langkah','Tindakan'],result.items,r=>[new Date(r.started_at).toLocaleString('id-ID'),r.account_id,r.session_id,r.event_count,button('Lihat jejak',async()=>{const events=await api('/api/admin/ai/trace/'+encodeURIComponent(r.request_id));$('trace-detail-events').replaceChildren(...events.map(e=>{const box=document.createElement('div');box.className='trace-event';const summary=document.createElement('p');summary.innerHTML=`<strong>${e.node}</strong> · ${e.state}${e.model?' · '+e.model:''}${e.attempt?' · percobaan '+e.attempt:''}${e.duration_ms!=null?' · '+e.duration_ms+' ms':''} · ${new Date(e.created_at).toLocaleString('id-ID')}`;box.append(summary);if(e.error){const err=document.createElement('p');err.className='trace-error';err.textContent='Error: '+e.error;box.append(err);}if(e.input!=null){const pre=document.createElement('pre');pre.textContent='Input: '+(typeof e.input==='string'?e.input:JSON.stringify(e.input,null,2));box.append(pre);}if(e.output!=null){const pre=document.createElement('pre');pre.textContent='Output: '+(typeof e.output==='string'?e.output:JSON.stringify(e.output,null,2));box.append(pre);}return box;}));$('trace-detail-dialog').showModal();})]);
 $('ai-trace-page').textContent='Halaman '+result.page+' dari '+result.pages+' · '+result.total+' proses';
 $('ai-trace-prev').disabled=result.page<=1;$('ai-trace-next').disabled=result.page>=result.pages;
 }catch(error){$('ai-trace-prev').disabled=tracePage<=1;$('ai-trace-next').disabled=false;throw error;}finally{traceLoading=false;}
}
$('ai-trace-prev').onclick=()=>run(()=>loadTraceRequests(tracePage-1));
$('ai-trace-next').onclick=()=>run(()=>loadTraceRequests(tracePage+1));
let aiAdjustment;
form('ai-adjust',async data=>{const payload=JSON.stringify(data);if(!aiAdjustment||aiAdjustment.payload!==payload)aiAdjustment={payload,id:crypto.randomUUID()};const result=await api('/api/admin/accounts/'+encodeURIComponent(data.accountId)+'/ai-credits','POST',{amount:Number(data.amount),reason:data.reason,requestId:aiAdjustment.id});aiAdjustment=undefined;$('message').textContent=`Penyesuaian AI tersimpan. Saldo: ${result.balance} kredit AI.`;});

let shareContacts=[],shareJobs=[],shareTemplates=[],shareSessions=[],shareOrder=[],shareAssets=[],shareAutoAdd=false;
const shareStatus=s=>({queued:'Dalam antrean',running:'Sedang dikirim',completed:'Selesai',completed_with_errors:'Selesai dengan kendala',pending:'Menunggu',sending:'Mengirim',sent:'Berhasil',failed:'Gagal',unknown:'Belum pasti'})[s]||s;
const shareMediaLabel=t=>({image:'Gambar',video:'Video',document:'Dokumen',audio:'Audio'})[t]||t;
const shareBytes=n=>n>=1048576?(n/1048576).toFixed(1)+' MB':(n/1024).toFixed(0)+' KB';
function shareTab(tab){for(const name of ['contacts','templates','assets','jobs','history'])$('share-'+name).hidden=name!==tab;document.querySelectorAll('[data-share-tab]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.shareTab===tab)));}
document.querySelectorAll('[data-share-tab]').forEach(b=>b.onclick=()=>shareTab(b.dataset.shareTab));
function openShareContact(value={}){const f=$('share-contact-form');f.reset();for(const key of ['id','nomor','nama','kelompkontak'])f.elements[key].value=value[key]||'';$('share-contact-dialog').showModal();}
$('share-add-contact').onclick=()=>openShareContact();
function shareOptions(id,items){$(id).replaceChildren(...items.map(([value,text])=>new Option(text,value)));}
async function loadAutoShare(){
 [shareContacts,shareJobs,shareSessions,shareTemplates]=await Promise.all([api('/auto-share/contacts'),api('/auto-share/jobs'),api('/sessions'),api('/auto-share/templates')]);
 shareAutoAdd=Boolean((await api('/auto-share/settings')).auto_add_enabled);$('share-auto-add').textContent='Auto tambah: '+(shareAutoAdd?'aktif':'nonaktif');$('share-auto-add').setAttribute('aria-pressed',String(shareAutoAdd));
 await loadShareAssets();
 const groups=[...new Set(shareContacts.map(c=>c.kelompkontak).filter(Boolean))].sort();
 $('share-group-options').replaceChildren(...groups.map(g=>new Option(g,g)));
 table('share-contact-list',['Nama','Nomor / ID grup','Kelompok','Tindakan'],shareContacts,c=>{const actions=document.createElement('div');actions.className='row-actions';actions.append(button('Ubah',async()=>openShareContact(c)),button('Hapus',async()=>{if(!confirm('Hapus kontak '+c.nomor+'?'))return;await api('/auto-share/contacts/'+c.id,'DELETE');await loadAutoShare();}));return [c.nama||'—',c.nomor,c.kelompkontak||'—',actions];});
 table('share-job-list',['Nama','Sesi','Tujuan','Rotasi berikutnya','Jadwal','Tindakan'],shareJobs,t=>{const actions=document.createElement('div');actions.className='row-actions';actions.append(button('Kirim',async()=>{$('share-send-form').elements.id.value=t.id;shareOptions('share-send-template',t.template_ids.map(id=>[id,shareTemplates.find(v=>v.id===id)?.name||'Template tidak tersedia']));$('share-send-dialog').showModal();}),button('Ubah',async()=>openShareJob(t)),button(t.enabled?'Nonaktifkan jadwal':'Aktifkan jadwal',async()=>{if(!t.enabled){await openShareJob(t);$('share-job-form').elements.enabled.checked=true;return;}await api('/auto-share/jobs/'+t.id,'PUT',{...t,enabled:false});await loadAutoShare();}),button('Hapus',async()=>{if(!confirm('Hapus pengiriman? Pengiriman yang sudah antre tetap berjalan.'))return;await api('/auto-share/jobs/'+t.id,'DELETE');await loadAutoShare();}));return [t.name,t.session_id,t.contacts.length+' kontak / '+t.groups.length+' kelompok',shareTemplates.find(v=>v.id===t.template_ids[t.rotation_index%t.template_ids.length])?.name||'—',t.enabled?new Date(t.next_at).toLocaleString('id-ID')+' · '+(t.interval_minutes?'setiap '+t.interval_minutes+' menit':'sekali'):'Tidak aktif',actions];});
 table('share-template-list',['Nama','Jenis','Konten','Tindakan'],shareTemplates,t=>{const actions=document.createElement('div');actions.className='row-actions';actions.append(button('Ubah',async()=>openShareTemplate(t)),button('Hapus',async()=>{if(!confirm('Hapus template ini?'))return;await api('/auto-share/templates/'+t.id,'DELETE');await loadAutoShare();}));return [t.name,t.media_type+(t.source_mode==='endpoint'?' · sumber data':''),(t.message||t.filename||'').slice(0,120),actions];});
 await loadShareRuns();
}
$('share-auto-add').onclick=()=>run(async()=>{shareAutoAdd=!shareAutoAdd;await api('/auto-share/settings','PUT',{auto_add_enabled:shareAutoAdd});$('share-auto-add').textContent='Auto tambah: '+(shareAutoAdd?'aktif':'nonaktif');$('share-auto-add').setAttribute('aria-pressed',String(shareAutoAdd));$('message').textContent=shareAutoAdd?'Auto tambah aktif. Kirim “tambah-nama-kelompok” dari sesi sendiri ke chat pribadi atau grup.':'Auto tambah kontak nonaktif.';});
const sharePublicUrl=token=>location.origin+'/public/assets/'+token;
async function shareCopyLink(text){
 try{await navigator.clipboard.writeText(text);}
 catch{const area=document.createElement('textarea');area.value=text;area.style.position='fixed';area.style.opacity='0';document.body.append(area);area.select();document.execCommand('copy');area.remove();}
}
async function loadShareAssets(){
 const data=await api('/auto-share/assets');shareAssets=data.assets;
 $('share-asset-count').textContent=`${data.used_count} / ${data.max_count}`;$('share-asset-storage').textContent=`${shareBytes(data.used_bytes)} / ${shareBytes(data.max_bytes)}`;
 $('share-asset-progress').style.width=Math.min(100,Math.max(data.max_count?data.used_count/data.max_count:0,data.max_bytes?data.used_bytes/data.max_bytes:0)*100)+'%';
 table('share-asset-list',['Nama file','Jenis','Ukuran','Akses','Tindakan'],shareAssets,a=>{
  const actions=document.createElement('div');actions.className='row-actions';
  actions.append(button('Preview',async()=>{window.open('/auto-share/assets/'+a.id+'/file','_blank','noopener');}));
  if(a.public_token)actions.append(button('Salin link publik',async()=>{await shareCopyLink(sharePublicUrl(a.public_token));$('message').textContent='Link publik disalin.';}));
  actions.append(button(a.public_token?'Jadikan privat':'Jadikan publik',async()=>{await api('/auto-share/assets/'+a.id+'/public','PUT',{public:!a.public_token});await loadShareAssets();$('message').textContent=a.public_token?'Asset kini privat.':'Asset kini publik; link dapat diakses tanpa API key.';}));
  actions.append(button('Hapus',async()=>{if(!confirm('Hapus asset '+a.filename+'?'))return;await api('/auto-share/assets/'+a.id,'DELETE');await loadShareAssets();await loadAutoShare();}));
  return [a.filename,shareMediaLabel(a.media_type),shareBytes(a.size_bytes),a.public_token?'Publik':'Privat',actions];
 });
}
function shareTemplateAssetOptions(){
 const type=$('share-template-form').elements.media_type.value;
 const matching=shareAssets.filter(a=>a.media_type===type).map(a=>[a.id,a.filename]);
 // An empty required <select> blocks submit with a native message that never says what is missing,
 // so an explanatory placeholder takes its place when the gallery has nothing of this type.
 shareOptions('share-template-asset',matching.length?matching:[['','Belum ada asset '+type+' di galeri']]);
}
// What the open template had when it was loaded, so the preview can say when it is showing
// unsaved settings.
let sharePreviewSaved={tidy:false,note:''};
let shareSelectedContacts=new Set();
// Rendered as checkboxes rather than <select multiple>: the native control needs Ctrl/Cmd, which
// phones do not have, and it cannot be searched once the contact list grows.
function renderShareContacts(){
 const query=$('share-contact-search').value.trim().toLowerCase();
 const matching=shareContacts.filter(c=>!query||c.nomor.toLowerCase().includes(query)||(c.nama||'').toLowerCase().includes(query)||(c.kelompkontak||'').toLowerCase().includes(query));
 $('share-target-contacts').replaceChildren(...matching.map(c=>{
  const row=document.createElement('label');row.className='check-row';
  const box=document.createElement('input');box.type='checkbox';box.value=c.id;box.checked=shareSelectedContacts.has(c.id);
  box.onchange=()=>{box.checked?shareSelectedContacts.add(c.id):shareSelectedContacts.delete(c.id);shareJobSummary();};
  row.append(box,document.createTextNode(' '+(c.nama?c.nama+' · ':'')+c.nomor+(c.kelompkontak?' — '+c.kelompkontak:'')));return row;}));
 const empty=$('share-contact-empty');
 empty.hidden=Boolean(matching.length);
 if(!matching.length)empty.textContent=shareContacts.length?'Tidak ada kontak yang cocok dengan pencarian.':'Belum ada kontak. Tambahkan di tab Kontak terlebih dahulu.';
 shareJobSummary();
}
// Answers the question that matters right before saving: how many people actually receive this?
function shareJobSummary(){
 const f=$('share-job-form');
 const groups=Array.from(f.elements.groups.selectedOptions,o=>o.value);
 const reached=new Set();
 for(const c of shareContacts)if(shareSelectedContacts.has(c.id)||groups.includes(c.kelompkontak))reached.add(c.nomor);
 const overlap=shareSelectedContacts.size+shareContacts.filter(c=>groups.includes(c.kelompkontak)).length-reached.size;
 const summary=$('share-target-summary');
 summary.textContent=reached.size
  ? reached.size+' tujuan unik · '+shareSelectedContacts.size+' kontak + '+groups.length+' kelompok'+(overlap>0?' ('+overlap+' nomor tumpang tindih, dikirim sekali)':'')
  : 'Belum ada tujuan dipilih.';
 summary.classList.toggle('is-empty',!reached.size);
 shareJobBlocker();
}
// Mirrors jobInput() so its three rejections surface before the request instead of after it.
function shareJobBlocker(){
 const f=$('share-job-form');
 const groups=Array.from(f.elements.groups.selectedOptions,o=>o.value);
 const reasons=[];
 if(!f.elements.session_id.value)reasons.push('hubungkan sesi WhatsApp di menu Sesi');
 if(!shareOrder.length)reasons.push('pilih minimal satu template');
 if(!shareSelectedContacts.size&&!groups.length)reasons.push('pilih kontak atau kelompok tujuan');
 if(f.elements.enabled.checked&&!f.elements.next_at.value)reasons.push('isi waktu pengiriman pertama');
 if(f.elements.enabled.checked&&f.elements.next_at.value&&new Date(f.elements.next_at.value).getTime()<=Date.now())reasons.push('waktu pengiriman harus di masa depan');
 const blocker=$('share-job-blocker');
 blocker.hidden=!reasons.length;
 blocker.textContent=reasons.length?'Lengkapi dulu: '+reasons.join(', ')+'.':'';
 $('share-job-save').disabled=Boolean(reasons.length);
}
function shareScheduleFields(){
 const f=$('share-job-form'),on=f.elements.enabled.checked;
 $('share-schedule-fields').classList.toggle('is-off',!on);
 f.elements.next_at.required=on;
 // Blocks a past time in the picker itself rather than letting the server reject it later.
 const now=new Date(Date.now()+60000);
 f.elements.next_at.min=new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,16);
 shareJobBlocker();
}
function shareSessionWarning(){
 const f=$('share-job-form'),session=shareSessions.find(s=>s.id===f.elements.session_id.value);
 const warning=$('share-session-warning');
 const bad=f.elements.session_id.value&&(!session||session.status!=='connected');
 warning.hidden=!bad;
 if(bad)warning.textContent=session
  ? 'Sesi ini berstatus '+session.status+'. Jadwal tetap tersimpan, tetapi pengiriman akan gagal selama sesi belum terhubung.'
  : 'Sesi ini tidak lagi tersedia. Pilih sesi lain agar pengiriman dapat berjalan.';
}
async function openShareJob(t={}){
 await loadAutoShare();const f=$('share-job-form');f.reset();
 // An empty required <select> blocks submit with a native message that never names the cause.
 shareOptions('share-session',shareSessions.length?shareSessions.map(s=>[s.id,s.id+' ('+s.status+')']):[['','Belum ada sesi WhatsApp']]);
 if(t.session_id&&!shareSessions.some(s=>s.id===t.session_id))$('share-session').add(new Option(t.session_id+' (tidak tersedia)',t.session_id));
 shareOptions('share-target-groups',[...new Set(shareContacts.map(c=>c.kelompkontak).filter(Boolean))].sort().map(g=>[g,g]));
 for(const key of ['id','name'])f.elements[key].value=t[key]||'';
 shareOrder=[...(t.template_ids||[])];shareOptions('share-choose-template',shareTemplates.map(v=>[v.id,v.name]));
 if(t.session_id)f.elements.session_id.value=t.session_id;
 f.elements.enabled.checked=!!t.enabled;f.elements.interval_minutes.value=String(t.interval_minutes||0);
 if(t.next_at){const d=new Date(t.next_at);f.elements.next_at.value=new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);}
 for(const option of f.elements.groups.options)option.selected=(t.groups||[]).includes(option.value);
 shareSelectedContacts=new Set(t.contacts||[]);
 $('share-contact-search').value='';renderShareContacts();renderShareOrder();
 shareScheduleFields();shareSessionWarning();showShareJobStep(1);
 $('share-timezone').textContent='Zona waktu: '+Intl.DateTimeFormat().resolvedOptions().timeZone+'.';$('share-job-dialog').showModal();
}
$('share-add-job').onclick=()=>run(()=>openShareJob());
$('share-contact-search').oninput=renderShareContacts;
$('share-target-groups').onchange=shareJobSummary;
$('share-session').onchange=shareSessionWarning;
$('share-job-form').elements.enabled.onchange=shareScheduleFields;
$('share-job-form').elements.next_at.oninput=shareJobBlocker;
let shareJobStep=1;
function showShareJobStep(step){shareJobStep=step;const form=$('share-job-form');for(const panel of form.querySelectorAll('[data-share-job-step]'))panel.hidden=Number(panel.dataset.shareJobStep)!==step;for(const indicator of form.querySelectorAll('[data-share-job-step-indicator]')){const number=Number(indicator.dataset.shareJobStepIndicator);indicator.classList.toggle('active',number===step);indicator.classList.toggle('complete',number<step);indicator.toggleAttribute('aria-current',number===step);}$('share-job-back').hidden=step===1;$('share-job-next').hidden=step===3;$('share-job-save').hidden=step!==3;if(step===3)shareJobBlocker();}
function shareJobCanAdvance(){const form=$('share-job-form');if(shareJobStep===1){for(const field of [form.elements.name,form.elements.session_id])if(!field.checkValidity()){field.reportValidity();return false;}}if(shareJobStep===2&&(!shareOrder.length||(!shareSelectedContacts.size&&!Array.from(form.elements.groups.selectedOptions).length))){shareJobBlocker();const blocker=$('share-job-blocker');blocker.hidden=false;blocker.textContent=!shareOrder.length?'Lengkapi dulu: pilih minimal satu template.':'Lengkapi dulu: pilih kontak atau kelompok tujuan.';return false;}return true;}
function setupShareJobWizard(){const form=$('share-job-form'),id=form.elements.id,name=form.elements.name.closest('label'),session=form.elements.session_id.closest('label'),warning=$('share-session-warning'),groups=[...form.querySelectorAll('.job-group')],blocker=$('share-job-blocker'),save=$('share-job-save'),close=save.nextElementSibling;
 const nav=document.createElement('ol');nav.className='template-steps share-job-steps';nav.setAttribute('aria-label','Tahap membuat pengiriman');for(const [number,label] of [[1,'Dasar'],[2,'Template & tujuan'],[3,'Jadwal']]){const item=document.createElement('li');item.dataset.shareJobStepIndicator=String(number);item.append(Object.assign(document.createElement('span'),{textContent:String(number)}),Object.assign(document.createElement('strong'),{textContent:label}));item.tabIndex=0;item.setAttribute('role','button');const go=()=>{if(number<=shareJobStep)showShareJobStep(number);else if(shareJobCanAdvance())showShareJobStep(shareJobStep+1);};item.onclick=go;item.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();go();}};nav.append(item);}
 const makePanel=(step,title,copy,nodes)=>{const panel=document.createElement('section');panel.className='template-step share-job-step';panel.dataset.shareJobStep=String(step);const heading=document.createElement('div');heading.className='template-step-heading';const titleNode=document.createElement('h4');titleNode.textContent=title;const copyNode=document.createElement('p');copyNode.textContent=copy;heading.append(titleNode,copyNode);panel.append(heading,...nodes);return panel;};
 const base=makePanel(1,'Atur pengiriman','Beri nama pengiriman dan pilih sesi WhatsApp yang akan mengirim.',[name,session,warning]);
 const audience=makePanel(2,'Pilih konten dan penerima','Tentukan template, lalu pilih kontak atau kelompok tujuan.',groups.slice(0,2));
 const schedule=makePanel(3,'Atur waktu pengiriman','Simpan sebagai draf atau aktifkan jadwal pengiriman.',[groups[2],blocker]);
 const actions=document.createElement('div');actions.className='template-wizard-actions';const back=button('Kembali',()=>showShareJobStep(Math.max(1,shareJobStep-1)));back.type='button';back.id='share-job-back';const next=button('Lanjut',()=>{if(shareJobCanAdvance())showShareJobStep(Math.min(3,shareJobStep+1));});next.type='button';next.id='share-job-next';actions.append(back,next,save,close);form.replaceChildren(id,nav,base,audience,schedule,actions);}
setupShareJobWizard();
form('share-contact-form',async data=>{await api('/auto-share/contacts'+(data.id?'/'+data.id:''),data.id?'PUT':'POST',{nomor:data.nomor,nama:data.nama,kelompkontak:data.kelompkontak});$('share-contact-dialog').close();await loadAutoShare();if($('ai-session').value)await loadConversations();$('message').textContent='Kontak tersimpan.';});
form('share-job-form',async data=>{const f=$('share-job-form');const body={name:data.name,template_ids:shareOrder,session_id:data.session_id,contacts:[...shareSelectedContacts],groups:Array.from(f.elements.groups.selectedOptions,o=>o.value),enabled:f.elements.enabled.checked,next_at:data.next_at?new Date(data.next_at).toISOString():null,interval_minutes:Number(data.interval_minutes)};await api('/auto-share/jobs'+(data.id?'/'+data.id:''),data.id?'PUT':'POST',body);$('share-job-dialog').close();await loadAutoShare();$('message').textContent='Pengiriman tersimpan.';});
function renderShareOrder(){
 $('share-order').replaceChildren(...shareOrder.map((id,index)=>{const li=document.createElement('li');li.append(document.createTextNode((shareTemplates.find(t=>t.id===id)?.name||'Template tidak tersedia')+' '));
 const up=button('Naik',async()=>{[shareOrder[index-1],shareOrder[index]]=[shareOrder[index],shareOrder[index-1]];renderShareOrder();});up.type='button';up.disabled=index===0;
 const down=button('Turun',async()=>{[shareOrder[index+1],shareOrder[index]]=[shareOrder[index],shareOrder[index+1]];renderShareOrder();});down.type='button';down.disabled=index===shareOrder.length-1;
 const remove=button('Hapus dari urutan',async()=>{shareOrder.splice(index,1);renderShareOrder();});remove.type='button';li.append(up,down,remove);return li;}));
 // Spells out the first few sends so a multi-template rotation is not left to the imagination.
 const preview=$('share-rotation-preview');
 preview.hidden=shareOrder.length<2;
 if(!preview.hidden)preview.textContent='Urutan kirim: '+shareOrder.slice(0,3).map(id=>shareTemplates.find(t=>t.id===id)?.name||'?').join(' → ')+(shareOrder.length>3?' → …':'')+', lalu kembali ke awal.';
 shareJobBlocker();
}
$('share-append-template').onclick=()=>{const id=$('share-choose-template').value;if(id&&!shareOrder.includes(id)){shareOrder.push(id);renderShareOrder();}};
let shareTemplateStep=1,shareSourceVerified=false;
function invalidateShareSource(){if(!shareSourceVerified)return;shareSourceVerified=false;$('share-source-vars').replaceChildren();$('share-source-result').replaceChildren();shareMediaFields();}
function showShareTemplateStep(step){shareTemplateStep=step;for(const panel of document.querySelectorAll('#share-template-form [data-template-step]'))panel.hidden=Number(panel.dataset.templateStep)!==step;
 for(const indicator of document.querySelectorAll('#share-template-form [data-template-step-indicator]')){const number=Number(indicator.dataset.templateStepIndicator);indicator.classList.toggle('active',number===step);indicator.classList.toggle('complete',number<step);indicator.toggleAttribute('aria-current',number===step);}
 $('share-template-back').hidden=step===1;$('share-template-next').hidden=step===3;$('share-template-save').hidden=step!==3;
 if(step===3){const f=$('share-template-form'),source=f.elements.source_mode.value==='endpoint',type=f.elements.media_type.value;
  $('share-template-summary').textContent='Template '+(f.elements.name.value||'tanpa nama')+' · '+(source?'data dari endpoint':'konten tetap')+' · '+({text:'teks',image:'gambar',video:'video',document:'dokumen',audio:'audio'}[type]||type)+'.';}}
function shareTemplateStepValid(){const panel=document.querySelector('#share-template-form [data-template-step="'+shareTemplateStep+'"]');
 for(const input of panel.querySelectorAll('input,select,textarea'))if(!input.disabled&&!input.hidden&&input.required&&!input.checkValidity()){input.reportValidity();return false;}return true;}
function shareMediaFields(){const f=$('share-template-form'),type=f.elements.media_type.value,media=type!=='text',audio=type==='audio',source=f.elements.source_mode.value==='endpoint';
 // Audio carries no caption, so a data source would have nowhere to write its values.
 if(audio&&source){f.elements.source_mode.value='none';return shareMediaFields();}
 for(const choice of document.querySelectorAll('#share-template-form input[name="source_mode"]'))choice.closest('label').hidden=audio;
 $('share-source-fields').hidden=!source;f.elements.source_endpoint.required=source;
 // Tidying rewrites the substituted text, so it only applies where a source supplies that text.
 const tidyable=source&&!audio;
 $('share-tidy-field').hidden=!tidyable;$('share-tidy-hint').hidden=!tidyable;
 if(!tidyable)f.elements.tidy.checked=false;
 // The note only matters while the rewrite is actually on.
 $('share-tidy-note-field').hidden=!tidyable||!f.elements.tidy.checked;
 $('share-preview-row').hidden=!source;
 if(!source)$('share-preview').hidden=true;
 $('share-media-fields').hidden=!media;f.elements.message.required=!media;f.elements.message.disabled=audio;
 // Media from the endpoint is only reachable once a data source exists, so hide the impossible option.
 const remoteOption=$('share-media-source').querySelector('option[value="endpoint"]');
 remoteOption.hidden=!source;
 if(!source&&f.elements.media_source.value==='endpoint')f.elements.media_source.value='asset';
 if(!media)f.elements.media_source.value='asset';
 const remote=media&&f.elements.media_source.value==='endpoint';
 $('share-asset-field').hidden=remote;f.elements.asset_id.required=media&&!remote;
 $('share-media-variable-field').hidden=!remote;f.elements.media_variable.required=remote;
 $('share-variable-bar').hidden=!source||!$('share-source-vars').childElementCount;
 shareTemplateAssetOptions();}
function shareHeaderRow(name='',stored=false){
 const row=document.createElement('div');row.className='header-row';
 const key=document.createElement('input');key.placeholder='X-API-Key';key.maxLength=64;key.value=name;key.dataset.headerName='';
 const value=document.createElement('input');value.type='password';value.autocomplete='new-password';value.maxLength=1024;value.dataset.headerValue='';
 value.placeholder=stored?'Tersimpan — kosongkan untuk mempertahankan':'Nilai header';
 const drop=button('×',()=>{row.remove();});drop.className='secondary';drop.title='Hapus header';
 row.append(key,value,drop);$('share-header-rows').append(row);return row;}
$('share-header-add').onclick=()=>shareHeaderRow();
function shareHeaders(){return [...$('share-header-rows').querySelectorAll('.header-row')]
 .map(row=>({name:row.querySelector('[data-header-name]').value.trim(),value:row.querySelector('[data-header-value]').value}))
 .filter(h=>h.name);}
$('share-media-type').onchange=shareMediaFields;
$('share-tidy').onchange=shareMediaFields;
$('share-media-source').onchange=shareMediaFields;
for(const sourceChoice of document.querySelectorAll('#share-template-form input[name="source_mode"]'))sourceChoice.onchange=()=>{shareSourceVerified=false;shareMediaFields();};
$('share-template-form').addEventListener('input',e=>{const target=e.target;if(target.name==='source_endpoint'||target.closest('#share-header-rows'))invalidateShareSource();});
$('share-template-back').onclick=()=>showShareTemplateStep(Math.max(1,shareTemplateStep-1));
function shareTemplateCanAdvance(){const f=$('share-template-form'),source=f.elements.source_mode.value==='endpoint';if(shareTemplateStep===1&&source&&!shareSourceVerified){const box=$('share-source-result');box.replaceChildren();const warning=document.createElement('p');warning.className='field-warning';warning.textContent='Uji koneksi dan ambil variabel terlebih dahulu sebelum melanjutkan.';box.append(warning);return false;}return shareTemplateStepValid();}
$('share-template-next').onclick=()=>{if(shareTemplateCanAdvance())showShareTemplateStep(Math.min(3,shareTemplateStep+1));};
for(const indicator of document.querySelectorAll('#share-template-form [data-template-step-indicator]')){indicator.setAttribute('role','button');indicator.tabIndex=0;const go=()=>{const target=Number(indicator.dataset.templateStepIndicator);if(target<=shareTemplateStep)showShareTemplateStep(target);else if(shareTemplateCanAdvance())showShareTemplateStep(shareTemplateStep+1);};indicator.onclick=go;indicator.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();go();}};}
// Runs the real path — fetch, substitute, then tidy when ticked — so the schedule is never switched
// on for output nobody has seen. A tidied message cannot be inspected after it is broadcast.
$('share-preview-run').onclick=()=>{
 const b=$('share-preview-run');
 // Tidying calls the model, which can take seconds; without this the button queues a second call
 // and spends credit twice for one preview.
 if(b.disabled)return;
 b.disabled=true;const label=b.textContent;b.textContent='Menyiapkan pratinjau…';
 void run(async()=>{const f=$('share-template-form');
  const result=await api('/auto-share/templates/test-source','POST',{source_endpoint:f.elements.source_endpoint.value,source_headers:shareHeaders(),template_id:f.elements.id.value||undefined,message:f.elements.message.value,tidy:f.elements.tidy.checked,tidy_note:f.elements.tidy_note.value});
  const preview=result.preview;
  $('share-preview').hidden=false;
  // The preview uses what is typed, while a send uses what is stored. Saying so prevents trusting a
  // preview of settings that were never saved.
  const dirty=f.elements.id.value&&(f.elements.tidy_note.value!==(sharePreviewSaved.note??'')||f.elements.tidy.checked!==Boolean(sharePreviewSaved.tidy));
  $('share-preview-dirty').hidden=!dirty;
  $('share-preview-text').textContent=!preview?'Isi teks pesan terlebih dahulu.'
   :preview.message?preview.message+(preview.tidied?'\n\n— sudah dirapikan AI':preview.note?'\n\n— tidak dirapikan ('+preview.note+'), pesan dikirim apa adanya':'')
   :'Pratinjau gagal: '+(preview.note||'tidak diketahui');
 }).finally(()=>{b.disabled=false;b.textContent=label;});};
$('share-source-test').onclick=()=>{
 const b=$('share-source-test');
 if(b.disabled)return;
 b.disabled=true;const label=b.textContent;b.textContent='Menguji…';
 void run(async()=>{const f=$('share-template-form');
 const result=await api('/auto-share/templates/test-source','POST',{source_endpoint:f.elements.source_endpoint.value,source_headers:shareHeaders(),template_id:f.elements.id.value||undefined,media_source:f.elements.media_source.value});
 const names=Object.keys(result.variables),vars=$('share-source-vars');vars.replaceChildren();
 for(const name of names){const chip=button('{{'+name+'}} = '+result.variables[name],()=>{
  // Insert at the caret so a variable can be dropped mid-sentence.
  const area=f.elements.message,at=area.selectionStart??area.value.length;
  area.value=area.value.slice(0,at)+'{{'+name+'}}'+area.value.slice(area.selectionEnd??at);
  area.focus();area.selectionStart=area.selectionEnd=at+name.length+4;});
  chip.className='secondary';vars.append(chip,' ');}
 const chosen=f.elements.media_variable.value;
 shareOptions('share-media-variable',names.map(n=>[n,n]));
 if(names.includes(chosen))f.elements.media_variable.value=chosen;
 const box=$('share-source-result');box.replaceChildren();
 const summary=document.createElement('p');
 summary.textContent=names.length?names.length+' variabel tersedia.':'Endpoint tidak mengembalikan variabel apa pun.';
 box.append(summary);
 if(result.media){const m=document.createElement('p');m.textContent='Media: '+result.media.media_type+' · '+Math.round(result.media.size_bytes/1024)+' KB';box.append(m);}
 const raw=document.createElement('details'),caption=document.createElement('summary');
 caption.textContent='Lihat respons endpoint';const pre=document.createElement('pre');pre.textContent=result.raw;
 raw.append(caption,pre);box.append(raw);
 shareSourceVerified=true;
 shareMediaFields();
 }).finally(()=>{b.disabled=false;b.textContent=label;});};
function openShareTemplate(t={}){const f=$('share-template-form');f.reset();shareSourceVerified=false;
 $('share-source-vars').replaceChildren();$('share-source-result').replaceChildren();$('share-header-rows').replaceChildren();
 $('share-preview').hidden=true;$('share-preview-text').textContent='';
 for(const key of ['id','name','message'])f.elements[key].value=t[key]||'';
 f.elements.source_mode.value=t.source_mode||'none';f.elements.source_endpoint.value=t.source_endpoint||'';
 f.elements.media_type.value=t.media_type||'text';f.elements.media_source.value=t.media_source||'asset';
 for(const name of t.source_header_names||[])shareHeaderRow(name,true);
 if(t.media_variable)shareOptions('share-media-variable',[[t.media_variable,t.media_variable]]);
 // shareMediaFields() clears the tick when it decides tidying does not apply, so the saved value is
 // restored after it runs rather than before.
 shareMediaFields();f.elements.tidy.checked=Boolean(t.tidy);f.elements.tidy_note.value=t.tidy_note||'';
 sharePreviewSaved={tidy:Boolean(t.tidy),note:t.tidy_note||''};
 $('share-tidy-note-field').hidden=!f.elements.tidy.checked||$('share-tidy-field').hidden;
 if(t.asset_id)f.elements.asset_id.value=t.asset_id;showShareTemplateStep(1);$('share-template-dialog').showModal();}
$('share-add-template').onclick=()=>openShareTemplate();
form('share-template-form',async data=>{const f=$('share-template-form'),source=f.elements.source_mode.value==='endpoint';
 await api('/auto-share/templates'+(data.id?'/'+data.id:''),data.id?'PUT':'POST',{name:data.name,message:data.message,media_type:data.media_type,
  asset_id:f.elements.media_source.value==='endpoint'?null:(data.asset_id||null),
  source_mode:data.source_mode,media_source:data.media_source,source_endpoint:data.source_endpoint||'',
  source_headers:source?shareHeaders():undefined,
  media_variable:f.elements.media_source.value==='endpoint'?f.elements.media_variable.value:undefined,
  tidy:f.elements.tidy.checked,tidy_note:f.elements.tidy_note.value});
 $('share-template-dialog').close();await loadAutoShare();$('message').textContent='Template tersimpan.';});
$('share-asset-upload-form').onsubmit=e=>{e.preventDefault();void run(async()=>{
 const file=$('share-asset-upload-form').elements.file.files[0];if(!file)return;
 const submit=$('share-asset-upload-form').querySelector('button');submit.disabled=true;
 try{
  const response=await fetch('/auto-share/assets',{method:'POST',headers:{'X-Filename':file.name},body:file});
  const data=await response.json().catch(()=>({error:'rate_limited'}));
  if(!response.ok){const messages={asset_limit_exceeded:'Jumlah asset sudah mencapai batas paket.',storage_limit_exceeded:'Penyimpanan asset sudah mencapai batas paket.',unsupported_file_type:'Jenis file tidak didukung.',asset_too_large:'Ukuran file melebihi batas.'};throw Error(messages[data.error]||data.message||data.error);}
  $('share-asset-upload-form').reset();await loadShareAssets();shareTemplateAssetOptions();$('message').textContent='Asset tersimpan.';
 }finally{submit.disabled=false;}
});};
form('share-send-form',async data=>{const result=await api('/auto-share/jobs/'+data.id+'/send','POST',{template_id:data.template_id});$('share-send-dialog').close();shareTab('history');await loadShareRuns();$('message').textContent='Pengiriman masuk antrean untuk '+result.total+' tujuan.';});
let shareDetail;
async function loadShareDetail(id){shareDetail=id;const rows=await api('/auto-share/runs/'+id);table('share-run-detail',['Tujuan','Status','Keterangan'],rows,d=>[d.nomor,shareStatus(d.status),d.error||d.message_id||'—']);}
async function loadShareRuns(){table('share-run-list',['Waktu','Pengiriman','Template','Pemicu','Status','Hasil','Tindakan'],await api('/auto-share/runs'),r=>[new Date(r.created_at).toLocaleString('id-ID'),r.job_name||'—',r.template_name,r.source==='manual'?'Manual':'Jadwal',shareStatus(r.status),r.sent+'/'+r.total+' berhasil · '+r.failed+' gagal · '+r.unknown_count+' belum pasti',button('Detail',()=>loadShareDetail(r.id))]);if(shareDetail)await loadShareDetail(shareDetail);}
$('share-refresh').onclick=()=>run(loadAutoShare);
setInterval(()=>{if(!$('dashboard').hidden&&!$('auto-share').hidden&&!$('share-history').hidden)void run(loadShareRuns);},5000);
new ResizeObserver(entries=>{document.documentElement.style.setProperty('--workspace-nav-height',entries[0].target.getBoundingClientRect().height+'px');}).observe(document.querySelector('.tabs'));
shareTab('contacts');

// --- Referral (user) ---
async function loadReferral(){
 const [overview,profile]=await Promise.all([api('/api/referral'),api('/api/referral/profile')]);
 $('referral-code').textContent=overview.code;
 $('referral-total').textContent=overview.totalReferrals;
 $('referral-qualified-count').textContent=overview.qualifiedReferrals+' qualified';
 $('referral-earnings-total').textContent=money(overview.totalEarnings);
 $('referral-balance').textContent=money(overview.availableBalance);
 if(overview.usedReferral){$('referral-redeem-section').hidden=true;$('referral-redeem-note').textContent=`Anda menggunakan kode ${overview.usedReferral.code} dari ${overview.usedReferral.referrerEmail} · ${overview.usedReferral.status==='qualified'?'Sudah qualified pada '+new Date(overview.usedReferral.qualifiedAt).toLocaleString('id-ID'):'Menunggu Anda terhubung WhatsApp dengan nomor baru.'}`;}
 else{$('referral-redeem-section').hidden=false;}
 if(profile)for(const key of ['bank_name','bank_account_name','bank_account_number'])$('referral-profile-form').elements[key].value=profile[key];
 $('referral-payout-note').textContent=profile?'Saldo tersedia: '+money(overview.availableBalance):'Lengkapi profil rekening di atas sebelum mengajukan pencairan.';
 $('referral-payout-form').querySelector('button').disabled=!profile;
 const [referrals,earnings,payouts]=await Promise.all([api('/api/referral/referrals'),api('/api/referral/earnings'),api('/api/referral/payouts')]);
 table('referral-list',['Email','Status','Tanggal daftar','Tanggal qualified','Komisi dihasilkan'],referrals,r=>[r.email,r.status==='qualified'?'Qualified':'Menunggu',new Date(r.createdAt).toLocaleDateString('id-ID'),r.qualifiedAt?new Date(r.qualifiedAt).toLocaleDateString('id-ID'):'—',money(r.earnings)]);
 table('referral-earnings-list',['Tanggal','Dari','Jumlah'],earnings,e=>[new Date(e.createdAt).toLocaleString('id-ID'),e.email,money(e.amount)]);
 table('referral-payout-list',['Tanggal','Jumlah','Status','Catatan'],payouts,p=>[new Date(p.created_at).toLocaleString('id-ID'),money(p.amount),({requested:'Menunggu',paid:'Selesai',rejected:'Ditolak'})[p.status]||p.status,p.note||'—']);
}
$('referral-copy').onclick=()=>run(async()=>{await shareCopyLink(location.origin+'/register');$('message').textContent='Link pendaftaran disalin. Ajak orang lain masuk ke halaman Referral untuk memasukkan kode Anda: '+$('referral-code').textContent;});
form('referral-redeem-form',async data=>{await api('/api/referral/redeem','POST',{code:data.code});$('referral-redeem-form').reset();await loadReferral();$('message').textContent='Kode referral berhasil digunakan.';});
form('referral-profile-form',async data=>{await api('/api/referral/profile','PUT',data);await loadReferral();$('message').textContent='Profil rekening tersimpan.';});
form('referral-payout-form',async data=>{await api('/api/referral/payouts','POST',{amount:Number(data.amount)});$('referral-payout-form').reset();await loadReferral();$('message').textContent='Pengajuan pencairan terkirim.';});

// --- Referral (admin) ---
function referralAdminTab(tab){for(const name of ['settings','payouts','list','agents'])$('referral-admin-'+name+(name==='settings'?'':'-tab')).hidden=name!==tab;document.querySelectorAll('[data-referral-admin-tab]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.referralAdminTab===tab)));}
document.querySelectorAll('[data-referral-admin-tab]').forEach(b=>b.onclick=()=>referralAdminTab(b.dataset.referralAdminTab));
referralAdminTab('settings');
async function loadAdminReferral(){
 const settings=await api('/api/admin/referral');
 $('referral-config').elements.enabled.checked=Boolean(settings.enabled);
 for(const key of ['commission_percent','referrer_signup_wa_credits','referrer_signup_ai_credits','referee_signup_wa_credits','referee_signup_ai_credits','min_payout_amount'])$('referral-config').elements[key].value=settings[key];
 const payouts=await api('/api/admin/referral/payouts?status=requested');
 table('referral-admin-payouts',['Tanggal','Pereferensi','Jumlah','Rekening','Tindakan'],payouts,p=>{
  const actions=document.createElement('div');actions.className='row-actions';
  actions.append(button('Tandai selesai',async()=>{await api('/api/admin/referral/payouts/'+p.id,'PUT',{status:'paid'});await loadAdminReferral();$('message').textContent='Pencairan ditandai selesai.';}),
   button('Tolak',async()=>{const note=prompt('Alasan penolakan:');if(note===null)return;await api('/api/admin/referral/payouts/'+p.id,'PUT',{status:'rejected',note});await loadAdminReferral();$('message').textContent='Pencairan ditolak.';}));
  return [new Date(p.created_at).toLocaleString('id-ID'),p.referrer_email,money(p.amount),`${p.bank_name} · ${p.bank_account_number} a.n. ${p.bank_account_name}`,actions];
 });
 const list=await api('/api/admin/referral/referrals');
 table('referral-admin-list',['Pereferensi','Direferensikan','Status','Nomor qualifikasi','Komisi','Tarif'],list,r=>[r.referrer_email,r.referred_email,r.status==='qualified'?'Qualified':'Menunggu',r.qualified_number||'—',money(r.earnings),r.agent_commission_percent!=null?r.agent_commission_percent+'% (Agen Resmi)':'Default']);
 const agents=await api('/api/admin/referral/agents');
 table('referral-agent-list',['Email','Persentase komisi','Catatan','Tindakan'],agents,a=>[a.email,a.commission_percent+'%',a.note||'—',button('Cabut',async()=>{if(!confirm('Cabut status Agen Resmi untuk '+a.email+'?'))return;await api('/api/admin/referral/agents/'+a.account_id,'PUT',{remove:true});await loadAdminReferral();$('message').textContent='Status Agen Resmi dicabut.';})]);
}
form('referral-config',async data=>{const payload={enabled:data.enabled==='on'};for(const key of ['commission_percent','referrer_signup_wa_credits','referrer_signup_ai_credits','referee_signup_wa_credits','referee_signup_ai_credits','min_payout_amount'])payload[key]=Number(data[key]);await api('/api/admin/referral','PUT',payload);await loadAdminReferral();$('message').textContent='Pengaturan referral tersimpan.';});
form('referral-agent-form',async data=>{if(!data.accountId)throw Error('Pilih akun terlebih dahulu.');await api('/api/admin/referral/agents/'+data.accountId,'PUT',{commission_percent:Number(data.commission_percent),note:data.note});$('referral-agent-form').reset();await loadAdminReferral();$('message').textContent='Akun dijadikan Agen Resmi.';});

let legacyMessageTest=false;
let receivedTestMessages=[];
function renderReceivedTest(){const list=$('ai-received-list');if(!list)return;list.replaceChildren();if(!receivedTestMessages.length){const empty=document.createElement('p');empty.className='ai-received-empty';empty.textContent='Menunggu pesan pada sesi aktif.';list.append(empty);return;}for(const message of receivedTestMessages){const item=document.createElement('article'),meta=document.createElement('div'),badge=document.createElement('span'),sender=document.createElement('strong'),time=document.createElement('time'),text=document.createElement('p');item.className='ai-received-message '+message.direction;badge.textContent=message.direction==='outgoing'?'Terkirim':'Diterima';sender.textContent=message.sender||message.from||'—';time.textContent=new Date(Number(message.timestamp||Date.now()/1000)*1000).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});text.textContent=message.text||`[Pesan ${message.type||'lain'}]`;meta.append(badge,sender,time);item.append(meta,text);list.append(item);}}
function recordReceivedTest(message){if(message.sessionId!==$('ai-session').value)return;receivedTestMessages.unshift(message);receivedTestMessages=receivedTestMessages.slice(0,5);renderReceivedTest();}
function clearReceivedTest(){receivedTestMessages=[];renderReceivedTest();}
function aiTrialTab(tab){for(const name of ['message','assistant'])$('ai-trial-'+name).hidden=name!==tab;document.querySelectorAll('[data-ai-trial-tab]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.aiTrialTab===tab)));}
$('sendconnection').required=false;$('sendconnection').disabled=true;
{const trial=$('ai-tab-trial'),assistant=document.createElement('div'),message=document.createElement('div'),tabs=document.createElement('div');assistant.id='ai-trial-assistant';message.id='ai-trial-message';tabs.id='ai-trial-tabs';tabs.className='row-actions';for(const [tab,label] of [['message','Uji Pesan'],['assistant','Uji AI Asisten']]){const button=document.createElement('button');button.type='button';button.dataset.aiTrialTab=tab;button.textContent=label;button.onclick=()=>aiTrialTab(tab);tabs.append(button);}while(trial.firstChild)assistant.append(trial.firstChild);const list=document.createElement('div');list.id='ai-received-list';const legacy=$('uji-pesan');while(legacy.firstChild)message.append(legacy.firstChild);message.append(list);trial.append(tabs,message,assistant);renderReceivedTest();aiTrialTab('assistant');}
{const source=$('integrasi'),panel=document.createElement('section'),tab=button('Integrasi',()=>aiTab('integrasi'));panel.id='ai-tab-integrasi';panel.className='ai-management';panel.hidden=true;while(source.firstChild)panel.append(source.firstChild);$('ai-session-detail').append(panel);tab.dataset.aiTab='integrasi';const actions=$('ai-session-detail').querySelector(':scope > .row-actions');actions.insertBefore(tab,$('ai-session-filters'));}

// Manajemen sesi tersedia dari Asisten AI; halaman Nomor lama tidak lagi ditampilkan.
const navigateWithoutNomor=navigate;
navigate=()=>{const requested=location.pathname.split('/')[2]||'',legacyIntegration=requested==='integrasi';if($('adminlink').hidden&&(['','nomor','uji-pesan','integrasi'].includes(requested))){legacyMessageTest=requested==='uji-pesan';history.replaceState(null,'','/dashboard/ai');}document.querySelector('.tabs a[href="/dashboard/nomor"]')?.remove();document.querySelector('.tabs a[href="/dashboard/uji-pesan"]')?.remove();document.querySelector('.tabs a[href="/dashboard/integrasi"]')?.remove();const result=navigateWithoutNomor();if(legacyIntegration)aiTab('integrasi');else if(legacyMessageTest){aiTab('trial');aiTrialTab('message');legacyMessageTest=false;}return result;};

function simplifyApiDocs(){
 const docs=$('dokumentasi');
 docs.replaceChildren();
 const title=document.createElement('h2');title.textContent='Dokumentasi API';
 const lead=document.createElement('p');lead.textContent='Gunakan API key dari tab Integrasi untuk menghubungkan aplikasi atau workflow Anda.';
 const section=(label,content)=>{const details=document.createElement('details');const summary=document.createElement('summary');summary.textContent=label;const body=document.createElement('div');body.className='api-doc-content';body.innerHTML=content;details.append(summary,body);return details;};
 docs.append(title,lead,
  section('1. Autentikasi',`<p>Base URL: <code id="baseurl"></code></p><p>Semua endpoint di bawah memakai header ini. Simpan key hanya di backend atau credential manager, jangan di aplikasi browser.</p><pre><code>X-API-Key: API_KEY_ANDA
Content-Type: application/json</code></pre><p>Respons gagal selalu berbentuk <code>{"error":"kode_error"}</code>.</p>`),
  section('2. Sesi WhatsApp',`<p><code>GET /sessions</code> daftar sesi · <code>POST /sessions</code> buat sesi · <code>GET /sessions/:id</code> detail · <code>GET /sessions/:id/qr</code> QR · <code>POST /sessions/:id/reconnect</code> hubungkan ulang · <code>POST /sessions/:id/logout</code> keluar · <code>DELETE /sessions/:id</code> hapus · <code>PUT /sessions/:id/filter</code> ubah filter (<code>private</code>, <code>group</code>, <code>all</code>).</p><p><strong>Request — buat sesi</strong></p><pre><code>POST <span class="api-origin"></span>/sessions
{"id":"toko-utama"}</code></pre><p><strong>Respons</strong></p><pre><code>{"id":"toko-utama","status":"qr","filter":"private"}</code></pre>`),
  section('3. Kirim pesan & aksi chat',`<p><code>POST /sessions/:id/messages/text</code> mengirim teks. <code>POST /sessions/:id/messages/media</code> mengirim <code>image</code>, <code>video</code>, <code>audio</code>, atau <code>document</code>. Setiap kirim pesan menggunakan kredit; sertakan <code>Idempotency-Key</code> unik agar pesan tidak terkirim dua kali.</p><pre><code>POST <span class="api-origin"></span>/sessions/toko-utama/messages/text
X-API-Key: API_KEY_ANDA
Idempotency-Key: pesan-001

{"to":"628123456789","text":"Halo, ada yang bisa kami bantu?"}</code></pre><p><strong>Respons sukses semua jenis pesan</strong></p><pre><code>{"messageId":"3EB0...","to":"628123456789","requestId":"pesan-001"}</code></pre><p><strong>Contoh gambar</strong></p><pre><code>POST /sessions/toko-utama/messages/media
{"to":"628123456789","type":"image","url":"https://contoh.com/promo.jpg","caption":"Promo hari ini"}</code></pre><p><strong>Contoh video</strong></p><pre><code>POST /sessions/toko-utama/messages/media
{"to":"628123456789","type":"video","url":"https://contoh.com/promo.mp4","caption":"Lihat video promo kami"}</code></pre><p><strong>Contoh audio</strong></p><pre><code>POST /sessions/toko-utama/messages/media
{"to":"628123456789","type":"audio","url":"https://contoh.com/sapaan.ogg"}</code></pre><p><strong>Contoh dokumen</strong></p><pre><code>POST /sessions/toko-utama/messages/media
{"to":"628123456789","type":"document","url":"https://contoh.com/katalog.pdf","filename":"Katalog-September.pdf","caption":"Berikut katalog terbaru kami."}</code></pre><p>Gunakan URL file yang dapat diakses publik oleh server. Properti <code>caption</code> bersifat opsional; <code>filename</code> digunakan untuk dokumen. Sertakan header <code>Idempotency-Key</code> yang berbeda pada setiap pengiriman media.</p><p>Fitur chat lainnya: <code>POST /sessions/:id/typing</code> dengan <code>{"to":"628...","state":"composing"}</code>, serta <code>POST /sessions/:id/read</code> dengan <code>{"from":"628...","messageId":"ID_PESAN"}</code>. Keduanya merespons <code>{"ok":true}</code>.</p>`),
  section('4. Webhook, media masuk & realtime',`<p><code>GET /webhooks</code> melihat daftar, <code>POST /webhooks</code> menambah, dan <code>DELETE /webhooks/:id</code> menghapus webhook.</p><p><strong>Request — tambah webhook</strong></p><pre><code>POST <span class="api-origin"></span>/webhooks
{"url":"https://aplikasi-anda.com/webhook","sessionId":"toko-utama"}</code></pre><p><strong>Respons</strong></p><pre><code>{"id":"webhook-123","url":"https://aplikasi-anda.com/webhook","sessionId":"toko-utama"}</code></pre><p>Payload pesan masuk memiliki bentuk berikut. Bila ada media, ambil file dengan <code>GET /media/:id</code>. Untuk stream langsung gunakan SSE <code>GET /events</code> dengan header API key yang sama.</p><pre><code>{"event":"message","sessionId":"toko-utama","direction":"incoming","from":"628123456789","text":"Halo","timestamp":1720000000}</code></pre>`),
  section('5. Asisten AI',`<p><strong>Profil dan data profil.</strong> Profil adalah alur AI siap pakai dari NC-WA (mis. CS Usaha); data profil adalah isi bisnis Anda untuk satu profil dan bisa dipasang ke beberapa sesi. <code>GET /ai/profile-types</code> menampilkan profil yang tersedia. Data profil: <code>GET</code>/<code>POST /ai/data-profiles</code> (body <code>{"profile_type":"cs","name":"Toko Kopi"}</code>, atau <code>{"name":"Salinan","copy_from":"ID"}</code> untuk menduplikat), <code>GET</code>/<code>PATCH</code>/<code>DELETE /ai/data-profiles/:id</code> (hapus hanya bila tidak terpasang), <code>PATCH /ai/data-profiles/:id/field</code>, serta produk, foto, dan pesanan di bawah <code>/ai/data-profiles/:id/products</code>, <code>/products-image</code>, dan <code>/orders</code>.</p><pre><code>PUT <span class="api-origin"></span>/sessions/toko-utama/ai/profile
{"data_profile_id":"ID_DATA_PROFIL","enabled":true}</code></pre><p>Pasang, ganti, atau cabut (<code>{"data_profile_id":null}</code>) data profil sebuah sesi. Mengganti atau mencabut mengosongkan memori AI sesi itu; riwayat chat tetap tersimpan.</p><p>Endpoint per sesi di bawah ini tetap berlaku dan bekerja pada data profil yang terpasang. Bila sesi belum berprofil, penulisan pertama membuat data profil CS bernama <code>CS – &lt;sesi&gt;</code> dan memasangnya.</p><p>Kelola asisten: <code>GET</code>/<code>PUT /sessions/:id/ai</code>, aktifkan dengan <code>PATCH /sessions/:id/ai/enabled</code>, dan ubah satu bidang dengan <code>PATCH /sessions/:id/ai/field</code>.</p><pre><code>PATCH <span class="api-origin"></span>/sessions/toko-utama/ai/enabled
{"enabled":true}</code></pre><p><strong>Respons</strong></p><pre><code>{"enabled":true}</code></pre><p>Produk: <code>GET</code>/<code>POST /sessions/:id/ai/products</code>, <code>PUT /sessions/:id/ai/products/:product</code>, serta upload gambar <code>POST /sessions/:id/ai/products-image</code> (body file dan header <code>X-Filename</code>). Pesanan: <code>GET</code>/<code>POST /sessions/:id/ai/orders</code> dan <code>PUT</code>/<code>DELETE /sessions/:id/ai/orders/:order</code>. Percakapan: <code>GET /sessions/:id/ai/conversations</code> dan <code>PUT /sessions/:id/ai/conversations/:customer</code>. Riwayat chat pribadi: <code>GET /sessions/:id/ai/chats</code> (daftar percakapan dengan pesan terakhir), <code>GET /sessions/:id/ai/chats/:customer/messages</code> (100 pesan terbaru; lanjutkan dengan <code>?before=</code> dari respons), dan <code>POST /sessions/:id/ai/chats/:customer/messages</code> dengan <code>{"text":"..."}</code> serta header <code>Idempotency-Key</code> untuk balasan manual (memakai 1 kredit dan menjeda AI kecuali full auto). Stream <code>/events</code> mengirim <code>chat.updated</code> saat riwayat berubah. Fallback: <code>GET /sessions/:id/ai/fallbacks</code>, <code>POST /sessions/:id/ai/fallbacks/:fallback/answer</code>, <code>POST /sessions/:id/ai/fallbacks/:fallback/knowledge</code>, atau <code>DELETE /sessions/:id/ai/fallbacks/:fallback</code>.</p>`),
  section('6. Auto Share',`<p>Semua endpoint memakai awalan <code>/auto-share</code>: asset (<code>GET/POST/DELETE /assets</code>), kontak (<code>GET/POST/PUT/DELETE /contacts</code>), template (<code>GET/POST/PUT/DELETE /templates</code>), jadwal (<code>GET/POST/PUT/DELETE /jobs</code>), jalankan sekarang (<code>POST /jobs/:id/send</code>), dan riwayat (<code>GET /runs</code>, <code>GET /runs/:id</code>).</p><pre><code>POST <span class="api-origin"></span>/auto-share/contacts
{"nomor":"628123456789","nama":"Pelanggan","kelompkontak":"Prospek"}</code></pre><p><strong>Respons</strong></p><pre><code>{"id":"CONTACT_ID","nomor":"628123456789","nama":"Pelanggan","kelompkontak":"Prospek"}</code></pre>`),
  section('7. Integrasi n8n',`<p>Gunakan community node <code>n8n-nodes-nc-wa</code> agar workflow n8n dapat memakai NC-WA tanpa menulis HTTP Request manual.</p><p><strong>Pasang node</strong>: n8n → <em>Settings</em> → <em>Community nodes</em> → <em>Install</em>, lalu masukkan <code>n8n-nodes-nc-wa</code>. Buat kredensial <strong>NC-WA Gateway API</strong> dengan Base URL <code><span class="api-origin"></span></code> dan API key dari tab Integrasi. Gunakan HTTPS jika n8n terpisah dari server NC-WA.</p><p><strong>Node NC-WA</strong> menyediakan Send Text, Send Media (gambar, video, audio, dokumen dari URL publik), Send Typing, Mark as Read, serta Create/Get/Get Many/Get QR Code/Reconnect/Log Out/Delete Session. Masukkan nomor tanpa awalan <code>+</code>, misalnya <code>628123456789</code>; ID grup berakhiran <code>@g.us</code>.</p><p><strong>Node NC-WA Trigger</strong> memulai workflow untuk event <code>message</code>, <code>session.status</code>, atau <code>session.qr</code>. Saat workflow diaktifkan, trigger otomatis mendaftarkan URL webhook-nya ke NC-WA dan mencabutnya saat dinonaktifkan. Opsi Session ID membatasi sesi, sedangkan Ignore Groups melewati pesan grup.</p><p><strong>Contoh alur balas otomatis</strong>: tambahkan <em>NC-WA Trigger</em> (Message Received) → <em>NC-WA</em> (Send Text). Isi <em>To</em> dengan <code>{{ $json.from }}</code>, Session ID dengan <code>{{ $json.sessionId }}</code>, dan Text dengan <code>Terima kasih, pesan Anda sudah kami terima.</code></p><p><strong>Data yang diterima trigger</strong></p><pre><code>{"event":"message","sessionId":"toko-utama","messageId":"3EB0...","from":"628123456789","isGroup":false,"sender":"628123456789","type":"text","text":"Halo","timestamp":1757900000,"media":null}</code></pre><p><strong>Penting — hindari balasan ganda:</strong> bila n8n dipakai sebagai engine untuk menjawab pesan, matikan <strong>Asisten AI</strong> pada sesi yang sama di Dashboard AI. Aktifkan hanya salah satu engine balasan: n8n atau Asisten AI NC-WA.</p><p>Untuk mencoba dari editor, tekan <em>Listen for test event</em> sebelum mengirim pesan ke nomor WhatsApp. Paket ini memerlukan n8n self-hosted atau paket n8n yang mengizinkan community nodes.</p>`),
  section('8. Status & format respons',`<p><code>GET /stats</code> menampilkan statistik sesi. Endpoint daftar memberi array, endpoint detail memberi objek, dan operasi hapus umumnya memberi <code>{"ok":true}</code>. Kode umum: <code>401 unauthorized</code>, <code>404 session_not_found</code>, <code>409 insufficient_credits</code>, dan <code>409 idempotency_conflict</code>.</p><pre><code>GET <span class="api-origin"></span>/stats

{"uptime":3600,"sessions":{"total":1,"connected":1},"messages":{"sent":24,"received":8}}</code></pre>`));
 const ownerDocs=document.createElement('details');ownerDocs.id='ownerdocs';ownerDocs.hidden=true;const summary=document.createElement('summary');summary.textContent='Endpoint pemilik layanan';ownerDocs.append(summary);docs.append(ownerDocs);
}
simplifyApiDocs();

const showWithDocsOnRight=show;
show=async()=>{await showWithDocsOnRight();const nav=$('docslink').parentElement;nav.insertBefore($('docslink'),nav.querySelector('.settings-menu'));};

void run(show);
