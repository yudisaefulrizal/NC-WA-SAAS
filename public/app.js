const $=id=>document.getElementById(id),fields=id=>Object.fromEntries(new FormData($(id)));
async function api(path,method='GET',body,headers={}){const response=await fetch(path,{method,headers:{'Content-Type':'application/json',...headers},body:body?JSON.stringify(body):undefined});const data=await response.json().catch(()=>({error:'rate_limited'}));if(!response.ok){const messages={invalid_request:'Periksa isian formulir.',unauthorized:'Email, password, atau kredensial tidak valid.',account_exists:'Email sudah terdaftar.',invalid_origin:'Buka alamat aplikasi yang dikonfigurasi.',forbidden:'Akses tidak diizinkan.',internal_error:'Terjadi gangguan server.',rate_limited:'Terlalu banyak permintaan; coba lagi nanti.'};const e=Error(data.message||messages[data.error]||data.error);e.status=response.status;throw e;}return data;}
async function run(fn){$('message').textContent='';try{await fn();}catch(e){$('message').textContent=e.message;}}
function button(title,action){const b=document.createElement('button');b.textContent=title;b.onclick=()=>run(async()=>{b.disabled=true;try{await action();}finally{b.disabled=false;}});return b;}
function list(id,items,render){if(!items.length){const li=document.createElement('li');li.className='empty';li.textContent=({sessions:'Belum ada nomor. Hubungkan sesi pertama Anda di atas.',keys:'Belum ada API key. Buat saat Anda siap menghubungkan aplikasi.',webhooks:'Belum ada webhook manual.',usage:'Belum ada pengiriman. Riwayat akan muncul setelah Anda mengirim pesan.',payments:'Belum ada pembayaran.',adminpayments:'Belum ada transaksi.',audit:'Belum ada aktivitas.'})[id]||'Belum ada data.';$(id).replaceChildren(li);return;}$(id).replaceChildren(...items.map(item=>{const li=document.createElement('li');render(li,item);return li;}));}
function table(id,columns,items,render){let host=$(id);if(host.tagName==='UL'){const replacement=document.createElement('div');replacement.id=id;host.replaceWith(replacement);host=replacement;}host.className='table-wrap';const t=document.createElement('table'),head=document.createElement('thead'),hr=document.createElement('tr'),body=document.createElement('tbody');for(const title of columns){const th=document.createElement('th');th.scope='col';th.textContent=title;hr.append(th);}head.append(hr);if(!items.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=columns.length;td.className='empty';td.textContent='Belum ada data.';tr.append(td);body.append(tr);}for(const item of items){const tr=document.createElement('tr');for(const value of render(item)){const td=document.createElement('td');if(value instanceof Node)td.append(value);else td.textContent=value??'—';tr.append(td);}body.append(tr);}t.append(head,body);host.replaceChildren(t);}
function form(id,action){$(id).onsubmit=e=>{e.preventDefault();const submit=$(id).querySelector('button[type="submit"],button:not([type])');void run(async()=>{submit.disabled=true;try{await action(fields(id));}finally{submit.disabled=false;}});};}
const money=n=>new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(n);
async function keys(){table('keys',['ID API key','Tindakan'],await api('/api/keys'),key=>{const actions=document.createElement('div');actions.className='row-actions';actions.append(button('Ganti key',async()=>{const replacement=await api('/api/keys/'+key.id+'/rotate','POST');$('secret').textContent='Simpan key pengganti: '+replacement.key;await keys();}),button('Cabut',async()=>{await api('/api/keys/'+key.id,'DELETE');await keys();}));return [key.id,actions];});}
let activePlanId;
async function wallet(){const w=await api('/api/wallet');activePlanId=w.plan_id;updateActivePlan();$('stat-credit').textContent=w.balance;$('stat-limit').textContent=w.session_limit;$('stat-plan').textContent=w.plan_id==='basic'?'Gratis':w.plan_id;$('stat-period').textContent=w.expires_at?'Berakhir '+new Date(w.expires_at).toLocaleDateString('id-ID'):'Reset setiap tanggal 1';$('wallet').textContent=`${w.plan_id} · ${w.balance} kredit tersedia · ${w.session_limit} nomor · ${w.expires_at?'berakhir '+new Date(w.expires_at).toLocaleString('id-ID'):'reset tanggal 1, 00.00 WIB'}`;}
function updateActivePlan(){document.querySelectorAll('#catalog [data-plan-id]').forEach(card=>{const active=card.dataset.planId===activePlanId;const label=card.querySelector('.active-plan-label');label.hidden=!active;const free=card.querySelector('.free-plan-action');if(free)free.textContent=active?'Paket aktif':'Paket dasar';});}
async function catalog(id,authenticated=false){const data=await api('/public/plans');$(id).replaceChildren(...data.map(p=>{
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
}));if(authenticated)updateActivePlan();}
async function usage(){list('usage',await api('/api/usage'),(li,r)=>{li.textContent=`${new Date(r.created_at).toLocaleString('id-ID')} · ${r.status} · ${r.request_id}${r.message_id?' · '+r.message_id:''}`;});}
async function webhooks(){table('webhooks',['URL webhook','Sesi','Tindakan'],await api('/webhooks'),w=>[w.url,w.sessionId||'Semua sesi',button('Cabut',async()=>{await api('/webhooks/'+w.id,'DELETE');await webhooks();})]);}
async function show(){
 document.body.classList.remove('workspace','client-workspace');$('siteheader').hidden=false;if(location.pathname==='/'){$('landing').hidden=false;$('autharea').hidden=true;$('dashboard').hidden=true;await Promise.all([landingAuth(),catalog('publicplans')]);return;}
 let me;try{me=await api('/api/me');}catch(e){if(e.status!==401)throw e;$('autharea').hidden=false;$('dashboard').hidden=true;setAuthMode(location.pathname==='/register');return;}
 document.body.classList.add('workspace');$('siteheader').hidden=true;$('landing').hidden=true;$('autharea').hidden=true;$('dashboard').hidden=false;$('welcome').textContent=me.email;$('role').textContent=me.role==='owner'?'Pemilik layanan':'Pengguna';$('admin').hidden=$('adminlink').hidden=me.role!=='owner';$('baseurl').textContent=location.origin;document.querySelectorAll('.api-origin').forEach(el=>el.textContent=location.origin);
 const owner=me.role==='owner';document.body.classList.toggle('client-workspace',!owner);if(!owner){const nav=$('docslink').parentElement;nav.insertBefore($('docslink'),nav.querySelector('a[href="/dashboard/paket"]'));}$('wallet').hidden=owner;document.querySelectorAll('.tabs > a:not(.sidebar-brand):not(#adminlink):not(#docslink)').forEach(a=>a.hidden=owner);navigate();if(owner)await admin();else await Promise.all([keys(),sessions(),wallet(),catalog('catalog',true),usage(),webhooks(),paymentList(),loadAI(),loadAutoShare(),loadReferral()]);
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
function navigate(){const owner=!$('adminlink').hidden;const allowed=owner?['admin','dokumentasi']:['nomor','uji-pesan','ai','auto-share','integrasi','dokumentasi','paket','referral'];const requested=location.pathname.split('/')[2]||location.hash.slice(1);const page=allowed.includes(requested)?requested:allowed[0];if(requested!==page)history.replaceState(null,'','/dashboard/'+page);$('pagetitle').textContent=({'auto-share':'Auto Share',ai:'Asisten AI',nomor:'Session WhatsApp',integrasi:'Integrasi',pemakaian:'Riwayat pemakaian',paket:'Paket',referral:'Referral','uji-pesan':'Uji Pesan',admin:'Pengelolaan layanan',dokumentasi:'Dokumentasi API'})[page];for(const id of ['nomor','uji-pesan','ai','auto-share','integrasi','paket','referral','admin','dokumentasi'])$(id).hidden=id!==page;const subpages={ai:'Pengaturan AI',plans:'Paket & Harga',accounts:'Akun pelanggan',settings:'Pengaturan pembayaran',payments:'Semua pembayaran',referral:'Referral',health:'Status layanan & audit'};const requestedSub=location.pathname.split('/')[3];const sub=Object.hasOwn(subpages,requestedSub)?requestedSub:'plans';$('adminsubmenu').hidden=!owner;$('ownerdocs').hidden=!owner;for(const id of Object.keys(subpages))$('admin-'+id).hidden=id!==sub;if(page==='admin')$('pagetitle').textContent=subpages[sub];document.querySelectorAll('#adminsubmenu a').forEach(a=>{if(a.pathname==='/dashboard/admin/'+sub)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});document.querySelectorAll('.tabs > a').forEach(a=>{if(a.pathname==='/dashboard/'+page)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});$('pageintro').textContent=page==='paket'?'':page==='admin'?({ai:'Kelola koneksi, tarif kata, harga kredit, dan memori AI global.',plans:'Kelola pilihan paket, harga, dan kapasitas untuk pelanggan Anda.',accounts:'Kelola akun pelanggan, status akses, dan penyesuaian kredit.',settings:'Siapkan pembayaran paket melalui Midtrans.',payments:'Pantau transaksi pembelian paket pelanggan.',referral:'Kelola program referral, permintaan pencairan, dan Agen Resmi.',health:'Pantau kondisi layanan dan aktivitas pengelolaan.'}[sub]):({nomor:'Hubungkan nomor WhatsApp dan pantau koneksi Anda.',integrasi:'Sambungkan WhatsApp ke aplikasi dan workflow Anda.',dokumentasi:'Panduan untuk membangun integrasi WhatsApp Anda.','uji-pesan':'Coba pengiriman dan lihat riwayat pemakaian kredit.',referral:'Bagikan kode referral dan pantau bonus serta komisi Anda.'}[page]||'');$('userstats').hidden=owner||page!=='nomor';if(page!=='nomor')closeQr();}
document.querySelectorAll('#admin > details, #nomor > details').forEach(panel=>panel.addEventListener('toggle',()=>{if(panel.open)for(const other of panel.parentElement.querySelectorAll(':scope > details'))if(other!==panel)other.open=false;}));
document.querySelectorAll('.tabs a:not(.sidebar-brand):not([data-studio])').forEach(a=>a.addEventListener('click',event=>{if(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;event.preventDefault();history.pushState(null,'',a.pathname);navigate();if(a.pathname==='/dashboard/ai')void run(loadAI);if(a.pathname==='/dashboard/auto-share')void run(loadAutoShare);if(a.pathname==='/dashboard/referral')void run(loadReferral);if(a.pathname==='/dashboard/admin/referral')void run(loadAdminReferral);$('message').textContent='';window.scrollTo(0,0);}));
window.addEventListener('popstate',()=>{if(!$('dashboard').hidden)navigate();});
window.addEventListener('hashchange',()=>{if(!$('dashboard').hidden)navigate();});
$('newkey').onclick=()=>run(async()=>{const data=await api('/api/keys','POST');$('secret').textContent='Simpan key ini: '+data.key;await keys();});
const settingsMenu=document.querySelector('.settings-menu');
function closeSettingsMenu(){$('settings-menu-list').hidden=true;$('settings-toggle').setAttribute('aria-expanded','false');}
$('settings-toggle').onclick=()=>{const open=!$('settings-menu-list').hidden;if(open)closeSettingsMenu();else{$('settings-menu-list').hidden=false;$('settings-toggle').setAttribute('aria-expanded','true');}};
$('logout').onclick=()=>run(async()=>{closeSettingsMenu();await api('/api/auth/logout','POST');location.assign('/login');});
$('open-password').onclick=()=>{closeSettingsMenu();$('self-password-form').reset();$('self-password-dialog').showModal();};
form('self-password-form',async data=>{if(data.password!==data.confirmPassword)throw Error('Ulangi password baru harus sama.');await api('/api/auth/password','PUT',{currentPassword:data.currentPassword,password:data.password});$('self-password-dialog').close();$('message').textContent='Password berhasil diganti. Sesi login lain telah dicabut.';});
document.addEventListener('click',e=>{if(!$('settings-menu-list').hidden&&!settingsMenu.contains(e.target))closeSettingsMenu();});
let qrTimer,qrGeneration=0;
function closeQr(){qrGeneration++;clearTimeout(qrTimer);$('pairing').close();$('qrimage').removeAttribute('src');}
async function sessions(){const data=await api('/sessions');$('stat-active').textContent=data.filter(s=>s.status==='connected'&&s.serviceActive!==false).length;for(const [id,label] of [['sendconnection','Pilih sesi'],['hookconnection','Semua sesi']]){const select=$(id),current=select.value;select.replaceChildren(new Option(label,''),...data.filter(s=>s.serviceActive!==false).map(s=>new Option(s.id+(s.phone?' · '+s.phone:''),s.id)));select.value=current;}table('sessions',['Sesi','Nomor WhatsApp','Status','Pesan ke webhook','Tindakan'],data,s=>{const badge=document.createElement('span');badge.className='badge '+(s.serviceActive===false?'inactive':s.status);badge.textContent=s.serviceActive===false?'Nonaktif (batas paket)':({connected:'Terhubung',qr_required:'Menunggu QR',connecting:'Menghubungkan',logged_out:'Terputus'})[s.status]||s.status;const actions=document.createElement('div');actions.className='row-actions';if(s.serviceActive!==false&&s.status!=='connected')actions.append(button(s.status==='logged_out'?'Pasang ulang':'Lihat QR',async()=>{if(s.status==='logged_out')await api('/sessions/'+encodeURIComponent(s.id)+'/reconnect','POST');await pair(s.id);}));actions.append(button('Logout',async()=>{if(!confirm('Putuskan perangkat WhatsApp ini?'))return;await api('/sessions/'+encodeURIComponent(s.id)+'/logout','POST');await sessions();}),button('Hapus',async()=>{if(!confirm('Hapus sesi dan data koneksi perangkat ini?'))return;await api('/sessions/'+encodeURIComponent(s.id),'DELETE');await sessions();}));const select=document.createElement('select');select.setAttribute('aria-label','Filter pesan '+s.id);for(const [value,label] of Object.entries({all:'Semua pesan',private:'Pesan pribadi',group:'Pesan grup'}))select.append(new Option(label,value));select.value=s.filter;select.disabled=s.serviceActive===false;select.onchange=()=>run(()=>api('/sessions/'+encodeURIComponent(s.id)+'/filter','PUT',{filter:select.value}));return [s.id,s.phone||'—',badge,select,actions];});}
async function pair(id){closeQr();const generation=qrGeneration;$('pairing').showModal();const poll=async()=>{try{const state=await api('/sessions/'+encodeURIComponent(id)+'/qr');if(generation!==qrGeneration)return;$('qrstatus').textContent=state.status==='connected'?'WhatsApp tersambung.':'Scan QR melalui WhatsApp → Perangkat tertaut.';$('qrimage').hidden=!state.qr;if(state.qr)$('qrimage').src=state.qr;if(state.status==='connected'){await sessions();return;}qrTimer=setTimeout(poll,3000);}catch(e){if(generation===qrGeneration)$('qrstatus').textContent=e.message;}};await poll();}
$('pairing').addEventListener('cancel',e=>{e.preventDefault();closeQr();});$('closeqr').onclick=closeQr;$('refreshsessions').onclick=()=>run(sessions);$('refreshusage').onclick=()=>run(usage);
form('sessionform',async data=>{await api('/sessions','POST',data);await sessions();$('sessionform').reset();$('addconnection').close();await pair(data.id);});
let sendAttempt;
form('sendform',async data=>{const payload=JSON.stringify(data);if(!sendAttempt||sendAttempt.payload!==payload)sendAttempt={payload,id:crypto.randomUUID()};const result=await api('/sessions/'+encodeURIComponent(data.sessionId)+'/messages/text','POST',{to:data.to,text:data.text},{'Idempotency-Key':sendAttempt.id});$('sendresult').textContent='Pesan terkirim. Referensi: '+result.messageId;sendAttempt=undefined;$('sendform').reset();await Promise.all([wallet(),usage()]);});
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
async function admin(){await plans();await loadAIConfig();await loadModelUsage();const accounts=await api('/api/admin/accounts');$('ai-adjust-account').replaceChildren(new Option('Pilih akun',''),...accounts.map(u=>new Option(u.email,u.id)));const selected=$('adjustaccount').value;$('adjustaccount').replaceChildren(new Option('Pilih akun',''),...accounts.map(u=>new Option(u.email,u.id)));$('adjustaccount').value=selected;$('referral-agent-account').replaceChildren(new Option('Pilih akun',''),...accounts.map(u=>new Option(u.email,u.id)));table('accounts',['Email','Peran','Status','Paket aktif','Sisa kredit','Tindakan'],accounts,u=>{if(u.role==='owner')return [u.email,'Pemilik',u.suspended?'Nonaktif':'Aktif',u.plan_name,new Intl.NumberFormat('id-ID').format(u.balance),'—'];const actions=document.createElement('div');actions.className='row-actions';actions.append(button(u.suspended?'Aktifkan':'Nonaktifkan',async()=>{await api('/api/admin/accounts/'+u.id+'/status','PUT',{suspended:!u.suspended});await admin();}),button('Ganti password',async()=>changePassword(u)));return [u.email,'Pengguna',u.suspended?'Nonaktif':'Aktif',u.plan_name,new Intl.NumberFormat('id-ID').format(u.balance),actions];});const config=await api('/api/admin/midtrans');$('midtransstatus').textContent=`${config.configured?'Terkonfigurasi: '+config.environment+' · '+config.serverKey:'Belum dikonfigurasi'} · URL notifikasi: ${config.notificationUrl}`;table('audit',['Waktu','Aktivitas','Email'],await api('/api/admin/audit'),a=>[new Date(a.created_at).toLocaleString('id-ID'),a.action,a.account_email]);table('adminpayments',['ID pembayaran','Email','Total','Status'],await api('/api/admin/payments'),p=>[p.id,p.account_email,money(p.total),p.status]);const health=await api('/api/admin/health');table('health',['Komponen','Status'],Object.entries(health),([key,value])=>[({database:'Database',engine:'WhatsApp',uptime:'Waktu aktif'})[key]||key,typeof value==='object'?JSON.stringify(value):key==='uptime'?Math.floor(value)+' detik':String(value)]);await loadAdminReferral();}
form('midtransform',async data=>{await api('/api/admin/midtrans','PUT',data);$('midtransform').reset();$('midtransform-modal').close();await admin();});
$('testmidtrans').onclick=()=>run(async()=>{$('message').textContent=(await api('/api/admin/midtrans/test','POST')).message;});
let adjustment;
form('adjustform',async data=>{const payload=JSON.stringify(data);if(!adjustment||adjustment.payload!==payload)adjustment={payload,id:crypto.randomUUID()};await api('/api/admin/accounts/'+encodeURIComponent(data.accountId)+'/credits','POST',{amount:Number(data.amount),reason:data.reason,requestId:adjustment.id});adjustment=undefined;await admin();$('adjustform-modal').close();$('adjustform').reset();$('message').textContent='Penyesuaian tersimpan.';});
document.querySelectorAll('[data-open]').forEach(b=>b.onclick=()=>{const modal=$(b.dataset.open);modal.querySelector('form').reset();modal.showModal();});
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
const aiUnits=document.createElement('input');aiUnits.id='ai-units';aiUnits.type='number';aiUnits.min='1';aiUnits.max='100';aiUnits.step='1';aiUnits.value='1';aiUnits.inputMode='numeric';const aiUnitsLabel=document.createElement('label');aiUnitsLabel.textContent='Jumlah unit kredit AI (1 unit = 10.000 kredit)';aiUnitsLabel.append(' ',aiUnits);$('ai-credit-actions').prepend(aiUnitsLabel);

let aiUsagePage=1,aiUsageLoading=false;
async function loadAI(){
 const [w,sessionRows]=await Promise.all([api('/api/ai/wallet'),api('/sessions'),loadAIUsage()]);
 $('ai-balance').textContent=`${w.balance} kredit AI · Input ${w.input_rate} kredit/kata · Output ${w.output_rate} kredit/kata · Tidak kedaluwarsa`;
 const units=Number($('ai-units').value),validUnits=Number.isSafeInteger(units)&&units>=1&&units<=100;
 $('ai-buy').disabled=!w.credit_price||!validUnits;$('ai-buy').textContent=w.credit_price&&validUnits?`Beli ${new Intl.NumberFormat('id-ID').format(units*10000)} kredit AI · ${money(w.credit_price*units)}`:'Pembelian AI belum tersedia';
 const selected=$('ai-session').value;$('ai-session').replaceChildren(new Option('Pilih sesi',''),...sessionRows.map(s=>new Option(s.id,s.id)));$('ai-session').value=selected;
 const trialSelected=$('ai-trial-session').value;$('ai-trial-session').replaceChildren(new Option('Pilih nomor layanan',''),...sessionRows.map(s=>new Option(s.id,s.id)));$('ai-trial-session').value=trialSelected;

 if(selected)await loadAssistant();
}
async function loadAIUsage(page=aiUsagePage){
 if(aiUsageLoading)return;aiUsageLoading=true;$('ai-usage-prev').disabled=$('ai-usage-next').disabled=true;
 try{const result=await api('/api/ai/usage?page='+page);aiUsagePage=result.page;const rows=result.items;
 table('ai-usage',['Waktu','Sesi','Pelanggan','Agent','Status','Kata input','Kata output','Tarif input / output','Kredit dipotong'],rows,r=>[new Date(r.created_at).toLocaleString('id-ID'),r.session_id,r.customer,r.agent||'—',({fallback_sent:'Pesan bantuan terkirim',fallback_generated:'Menyiapkan pesan bantuan',fallback_send_failed:'Pesan bantuan gagal terkirim',fallback_send_unknown:'Pengiriman bantuan belum pasti',sent:'Terkirim',generating:'Memproses',generated:'Menunggu pengiriman',cancelled:'Dibatalkan',provider_failed:'AI gagal / hasil tidak valid',interrupted:'Terhenti saat restart',send_failed:'WhatsApp gagal',send_unknown:'Pengiriman belum pasti'})[r.status]||r.status,r.input_words,r.output_words,`${r.input_rate} / ${r.output_rate}`,r.charged]);
 $('ai-usage-page').textContent='Halaman '+result.page+' dari '+result.pages+' · '+result.total+' riwayat';
 $('ai-usage-prev').disabled=result.page<=1;$('ai-usage-next').disabled=result.page>=result.pages;
 }catch(error){$('ai-usage-prev').disabled=aiUsagePage<=1;$('ai-usage-next').disabled=false;throw error;}finally{aiUsageLoading=false;}
}
$('ai-usage-prev').onclick=()=>run(()=>loadAIUsage(aiUsagePage-1));
$('ai-usage-next').onclick=()=>run(()=>loadAIUsage(aiUsagePage+1));
let assistantLoad=0;
const sourceKinds=['products','orders'];
function sourceVisibility(){for(const kind of sourceKinds){const external=$('ai-form').elements[kind+'_mode'].value==='endpoint';$('ai-'+kind+'-endpoint').hidden=!external;$('ai-form').elements[kind+'_endpoint'].required=external;}}
for(const kind of sourceKinds)$('ai-form').elements[kind+'_mode'].onchange=sourceVisibility;
async function loadAssistant(){const generation=++assistantLoad,id=$('ai-session').value;const controls=[...$('ai-form').elements].filter(x=>x.name!=='session');for(const control of controls)control.disabled=true;
 for(const dialog of ['ai-product-dialog','ai-order-dialog','ai-order-edit-dialog'])$(dialog).close();
 $('ai-product-add').disabled=$('ai-order-add').disabled=true;
 try{const config=id?await api('/sessions/'+encodeURIComponent(id)+'/ai'):{enabled:false,knowledge:'',behavior:''};if(generation!==assistantLoad)return;
 for(const name of ['knowledge','behavior','fallback_number'])$('ai-form').elements[name].value=config[name]??'';$('ai-form').elements.fallback_notify.checked=Boolean(config.fallback_notify);$('ai-form').elements.enabled.checked=Boolean(config.enabled);
 for(const kind of sourceKinds){const src=config[kind+'_source']||{mode:'builtin',endpoint:'',has_token:false};$('ai-form').elements[kind+'_mode'].value=src.mode;$('ai-form').elements[kind+'_endpoint'].value=src.endpoint;$('ai-form').elements[kind+'_token'].value='';$('ai-form').elements[kind+'_clear_token'].checked=false;$('ai-'+kind+'-token-status').textContent=src.has_token?'Token tersimpan terenkripsi.':'Tanpa token.';$('ai-'+kind+'-source-note').textContent=src.mode==='builtin'?'Asisten menggunakan tabel ini.':'Asisten menggunakan custom endpoint. Data tabel NC-WA tetap tersimpan dan dapat dikelola di bawah.';}
 sourceVisibility();
 if(id){await Promise.all([loadConversations(),loadAIData(id,generation)]);}else{for(const name of ['ai-conversations','ai-products','ai-orders','ai-fallbacks'])$(name).replaceChildren();}
 }finally{if(generation===assistantLoad){for(const control of controls)control.disabled=!id;$('ai-product-add').disabled=$('ai-order-add').disabled=!id;}}}
async function loadAIData(id=$('ai-session').value,generation=assistantLoad){if(!id)return;const base='/sessions/'+encodeURIComponent(id)+'/ai';const [products,orders,fallbacks]=await Promise.all([api(base+'/products'),api(base+'/orders'),api(base+'/fallbacks')]);if(generation!==assistantLoad||id!==$('ai-session').value)return;
 table('ai-products',['Kode','Nama','Jenis','Harga','Stok/kapasitas','Status','Tindakan'],products,p=>[p.id,p.name,p.type==='service'?'Layanan':'Produk',money(p.price),p.stock,p.active?'Aktif':'Nonaktif',button('Edit',()=>openProduct(p))]);
 $('ai-product-codes').replaceChildren(...products.filter(p=>p.active).map(p=>new Option(p.name,p.id)));
 table('ai-orders',['ID','Pelanggan','Item','Total','Status','Tindakan'],orders,o=>[o.id,o.customer,o.items.map(i=>i.name+' × '+i.quantity).join(', '),money(o.total),o.status,button('Kelola',()=>{const f=$('ai-order-edit-form');f.elements.id.value=o.id;f.elements.status.value=o.status;f.elements.notes.value=o.notes;$('ai-order-detail').textContent=o.customer+' · '+o.items.map(i=>i.name+' × '+i.quantity+' @ '+money(i.price)).join(', ');$('ai-order-edit-dialog').showModal();})]);table('ai-fallbacks',['ID','Pelanggan','Status','Pertanyaan','Dibuat','Tindakan'],fallbacks,row=>{const actions=document.createElement('div');actions.className='row-actions';if(row.status==='waiting')actions.append(button('Jawab',async()=>{const answer=prompt('Jawaban untuk pelanggan:');if(!answer?.trim())return;await api(base+'/fallbacks/'+encodeURIComponent(row.id)+'/answer','POST',{answer});await loadAIData();}));if(row.status==='resolved'){actions.append(button('Ke Knowledge',()=>fallbackKnowledge(base,row)),button('Tambah produk',()=>fallbackProduct(row)));}return [row.id,row.customer,row.status,row.question,new Date(row.created_at).toLocaleString('id-ID'),actions.childElementCount?actions:'—'];});}
async function fallbackKnowledge(base,row){const draft='Pertanyaan: '+row.question+'\nJawaban: '+(row.staff_answer||'');const content=prompt('Periksa dan edit Knowledge sebelum diterapkan:',draft);if(!content?.trim())return;await api(base+'/fallbacks/'+encodeURIComponent(row.id)+'/knowledge','POST',{content});await loadAssistant();$('message').textContent='Knowledge dari tiket fallback diterapkan.';}
function fallbackProduct(row){const f=$('ai-product-form');f.reset();f.elements.id.readOnly=false;f.elements.description.value=('Referensi pertanyaan pelanggan: '+row.question+'\nKonfirmasi tim: '+(row.staff_answer||'')).slice(0,500);f.elements.active.checked=true;$('ai-product-dialog').showModal();}
function aiDataForm(id,action){form(id,async data=>{let error=$(id).querySelector('.form-error');if(!error){error=document.createElement('p');error.className='form-error';error.setAttribute('role','alert');$(id).prepend(error);}error.textContent='';try{await action(data);}catch(e){error.textContent=e.message;throw e;}});}
function openProduct(product){const f=$('ai-product-form');f.reset();f.elements.id.readOnly=Boolean(product);if(product)for(const key of ['id','name','type','description','price','stock'])f.elements[key].value=product[key];f.elements.active.checked=product?product.active:true;$('ai-product-dialog').showModal();}
$('ai-product-add').onclick=()=>openProduct();
aiDataForm('ai-product-form',async data=>{const id=$('ai-session').value;await api('/sessions/'+encodeURIComponent(id)+'/ai/products/'+encodeURIComponent(data.id),'PUT',{...data,price:Number(data.price),stock:Number(data.stock),active:data.active==='on'});$('ai-product-dialog').close();await loadAIData();$('message').textContent='Produk tersimpan.';});
let orderRequest;
$('ai-order-add').onclick=()=>{$('ai-order-form').reset();orderRequest=undefined;$('ai-order-dialog').showModal();};
aiDataForm('ai-order-form',async data=>{const id=$('ai-session').value,payload={customer:data.customer,items:[{product_id:data.product_id,quantity:Number(data.quantity)}],notes:data.notes};const signature=JSON.stringify([id,payload]);if(!orderRequest||orderRequest.signature!==signature)orderRequest={signature,key:crypto.randomUUID()};await api('/sessions/'+encodeURIComponent(id)+'/ai/orders','POST',payload,{'Idempotency-Key':orderRequest.key});$('ai-order-dialog').close();orderRequest=undefined;await loadAIData();$('message').textContent='Pesanan tercatat untuk diproses.';});
aiDataForm('ai-order-edit-form',async data=>{await api('/sessions/'+encodeURIComponent($('ai-session').value)+'/ai/orders/'+encodeURIComponent(data.id),'PUT',{status:data.status,notes:data.notes});$('ai-order-edit-dialog').close();await loadAIData();$('message').textContent='Pesanan diperbarui.';});
async function loadConversations(){
 const id=$('ai-session').value,generation=assistantLoad;if(!id)return;
 const [rows,savedContacts]=await Promise.all([api('/sessions/'+encodeURIComponent(id)+'/ai/conversations'),api('/auto-share/contacts')]);if(id!==$('ai-session').value||generation!==assistantLoad)return;
 table('ai-conversations',['Pelanggan','Memori','Konteks S-P-O','Status','Tindakan'],rows,r=>{
  const actions=document.createElement('div');actions.className='row-actions';
  const update=async body=>{await api('/sessions/'+encodeURIComponent(id)+'/ai/conversations/'+encodeURIComponent(r.customer),'PUT',body);await loadConversations();};
  actions.append(button(r.paused?'Lanjutkan AI':'Jeda AI',()=>update({paused:!r.paused,full_auto:false})),
   button(r.full_auto?'Nonaktifkan full auto':'Full auto',()=>update({paused:false,full_auto:!r.full_auto})),
   button('Hapus konteks',async()=>{if(!confirm('Hapus memori AI pelanggan ini? Chat WhatsApp tetap tersimpan.'))return;await update({paused:Boolean(r.paused),clear:true});}));
  const saved=savedContacts.some(c=>c.nomor===(r.customer.includes('@')?r.customer:r.customer+'@s.whatsapp.net'));
  const save=button(saved?'Sudah di kontak':'Simpan ke kontak',async()=>{await loadAutoShare();openShareContact({nomor:r.customer});});save.disabled=saved;actions.append(save);
  return [r.customer,r.message_count,r.router_context||'—',r.paused?'Dijeda':r.full_auto?'Full auto':'Aktif',actions];
 });
}
$('ai-session').onchange=()=>run(loadAssistant);
form('ai-form',async data=>{if(!data.session)throw Error('Pilih sesi terlebih dahulu.');const payload={enabled:data.enabled==='on',knowledge:data.knowledge,behavior:data.behavior,fallback_number:data.fallback_number,fallback_notify:data.fallback_notify==='on'};for(const kind of sourceKinds)payload[kind+'_source']={mode:data[kind+'_mode'],endpoint:data[kind+'_endpoint'],token:data[kind+'_token'],clear_token:data[kind+'_clear_token']==='on'};await api('/sessions/'+encodeURIComponent(data.session)+'/ai','PUT',payload);await loadAssistant();$('message').textContent='Pengaturan asisten tersimpan.';});
$('ai-units').oninput=()=>void run(loadAI);
form('ai-trial-form',async data=>{$('ai-trial-error').textContent='';$('ai-trial-answer').hidden=true;try{const result=await api('/api/ai/trial','POST',{session:data.session,question:data.question});$('ai-trial-answer-text').textContent=result.answer;$('ai-trial-answer').hidden=false;await loadAI();}catch(e){$('ai-trial-error').textContent=e.message;}});
$('ai-buy').onclick=()=>run(async()=>{const control=$('ai-buy'),units=Number($('ai-units').value);if(!Number.isSafeInteger(units)||units<1||units>100)throw Error('Jumlah unit kredit AI harus bilangan 1–100.');control.disabled=true;try{const order=await api('/api/ai/payments','POST',{units});history.pushState(null,'','/dashboard/paket');navigate();await checkout(order.id);await paymentList();}finally{await loadAI();}});
async function loadAIConfig(){const config=await api('/api/admin/ai');for(const name of ['endpoint','model_cheap','model_medium','model_smart','input_rate','output_rate','memory_limit','credit_price'])$('ai-config').elements[name].value=config[name];$('ai-config').elements.apiKey.value='';$('ai-config-status').textContent=config.configured?'API key tersimpan terenkripsi.':'Koneksi AI belum dikonfigurasi.';}
form('ai-config',async data=>{for(const key of ['input_rate','output_rate','memory_limit','credit_price'])data[key]=Number(data[key]);await api('/api/admin/ai','PUT',data);await loadAIConfig();$('message').textContent='Pengaturan AI tersimpan. Batas memori berlaku untuk seluruh percakapan.';});
document.querySelectorAll('[data-ai-test]').forEach(b=>{b.onclick=()=>run(async()=>{b.disabled=true;try{$('message').textContent=(await api('/api/admin/ai/test','POST',{tier:b.dataset.aiTest})).message;}finally{b.disabled=false;}});});
async function loadModelUsage(){table('ai-model-usage',['Waktu','Akun','Sesi','Status','Panggilan model'],await api('/api/admin/ai/usage'),r=>[new Date(r.created_at).toLocaleString('id-ID'),r.account_id,r.session_id,r.status,(typeof r.model_calls==='string'?JSON.parse(r.model_calls):r.model_calls||[]).map(c=>`${c.role}: ${c.model} (${c.status})`).join(' · ')||'—']);}
$('ai-model-refresh').onclick=()=>run(loadModelUsage);
let aiAdjustment;
form('ai-adjust',async data=>{const payload=JSON.stringify(data);if(!aiAdjustment||aiAdjustment.payload!==payload)aiAdjustment={payload,id:crypto.randomUUID()};const result=await api('/api/admin/accounts/'+encodeURIComponent(data.accountId)+'/ai-credits','POST',{amount:Number(data.amount),reason:data.reason,requestId:aiAdjustment.id});aiAdjustment=undefined;$('message').textContent=`Penyesuaian AI tersimpan. Saldo: ${result.balance} kredit AI.`;});

let shareContacts=[],shareJobs=[],shareTemplates=[],shareSessions=[],shareOrder=[],shareAssets=[];
const shareStatus=s=>({queued:'Dalam antrean',running:'Sedang dikirim',completed:'Selesai',completed_with_errors:'Selesai dengan kendala',pending:'Menunggu',sending:'Mengirim',sent:'Berhasil',failed:'Gagal',unknown:'Belum pasti'})[s]||s;
const shareMediaLabel=t=>({image:'Gambar',video:'Video',document:'Dokumen',audio:'Audio'})[t]||t;
const shareBytes=n=>n>=1048576?(n/1048576).toFixed(1)+' MB':(n/1024).toFixed(0)+' KB';
function shareTab(tab){for(const name of ['contacts','templates','assets','jobs','history'])$('share-'+name).hidden=name!==tab;document.querySelectorAll('[data-share-tab]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.shareTab===tab)));}
document.querySelectorAll('[data-share-tab]').forEach(b=>b.onclick=()=>shareTab(b.dataset.shareTab));
function openShareContact(value={}){const f=$('share-contact-form');f.reset();for(const key of ['id','nomor','kelompkontak'])f.elements[key].value=value[key]||'';$('share-contact-dialog').showModal();}
$('share-add-contact').onclick=()=>openShareContact();
function shareOptions(id,items){$(id).replaceChildren(...items.map(([value,text])=>new Option(text,value)));}
async function loadAutoShare(){
 [shareContacts,shareJobs,shareSessions,shareTemplates]=await Promise.all([api('/auto-share/contacts'),api('/auto-share/jobs'),api('/sessions'),api('/auto-share/templates')]);
 await loadShareAssets();
 const groups=[...new Set(shareContacts.map(c=>c.kelompkontak).filter(Boolean))].sort();
 $('share-group-options').replaceChildren(...groups.map(g=>new Option(g,g)));
 table('share-contact-list',['Nomor / ID grup','Kelompok','Tindakan'],shareContacts,c=>{const actions=document.createElement('div');actions.className='row-actions';actions.append(button('Ubah',async()=>openShareContact(c)),button('Hapus',async()=>{if(!confirm('Hapus kontak '+c.nomor+'?'))return;await api('/auto-share/contacts/'+c.id,'DELETE');await loadAutoShare();}));return [c.nomor,c.kelompkontak||'—',actions];});
 table('share-job-list',['Nama','Sesi','Tujuan','Rotasi berikutnya','Jadwal','Tindakan'],shareJobs,t=>{const actions=document.createElement('div');actions.className='row-actions';actions.append(button('Kirim',async()=>{$('share-send-form').elements.id.value=t.id;shareOptions('share-send-template',t.template_ids.map(id=>[id,shareTemplates.find(v=>v.id===id)?.name||'Template tidak tersedia']));$('share-send-dialog').showModal();}),button('Ubah',async()=>openShareJob(t)),button(t.enabled?'Nonaktifkan jadwal':'Aktifkan jadwal',async()=>{if(!t.enabled){await openShareJob(t);$('share-job-form').elements.enabled.checked=true;return;}await api('/auto-share/jobs/'+t.id,'PUT',{...t,enabled:false});await loadAutoShare();}),button('Hapus',async()=>{if(!confirm('Hapus pengiriman? Pengiriman yang sudah antre tetap berjalan.'))return;await api('/auto-share/jobs/'+t.id,'DELETE');await loadAutoShare();}));return [t.name,t.session_id,t.contacts.length+' kontak / '+t.groups.length+' kelompok',shareTemplates.find(v=>v.id===t.template_ids[t.rotation_index%t.template_ids.length])?.name||'—',t.enabled?new Date(t.next_at).toLocaleString('id-ID')+' · '+(t.interval_minutes?'setiap '+t.interval_minutes+' menit':'sekali'):'Tidak aktif',actions];});
 table('share-template-list',['Nama','Jenis','Konten','Tindakan'],shareTemplates,t=>{const actions=document.createElement('div');actions.className='row-actions';actions.append(button('Ubah',async()=>openShareTemplate(t)),button('Hapus',async()=>{if(!confirm('Hapus template ini?'))return;await api('/auto-share/templates/'+t.id,'DELETE');await loadAutoShare();}));return [t.name,t.media_type,(t.message||t.filename||'').slice(0,120),actions];});
 await loadShareRuns();
}
const sharePublicUrl=token=>location.origin+'/public/assets/'+token;
async function shareCopyLink(text){
 try{await navigator.clipboard.writeText(text);}
 catch{const area=document.createElement('textarea');area.value=text;area.style.position='fixed';area.style.opacity='0';document.body.append(area);area.select();document.execCommand('copy');area.remove();}
}
async function loadShareAssets(){
 const data=await api('/auto-share/assets');shareAssets=data.assets;
 $('share-asset-quota').textContent=`${data.used_count}/${data.max_count} asset · ${shareBytes(data.used_bytes)}/${shareBytes(data.max_bytes)}`;
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
 shareOptions('share-template-asset',shareAssets.filter(a=>a.media_type===type).map(a=>[a.id,a.filename]));
}
async function openShareJob(t={}){
 await loadAutoShare();const f=$('share-job-form');f.reset();
 shareOptions('share-session',shareSessions.map(s=>[s.id,s.id+' ('+s.status+')']));
 if(t.session_id&&!shareSessions.some(s=>s.id===t.session_id))$('share-session').add(new Option(t.session_id+' (tidak tersedia)',t.session_id));
 shareOptions('share-target-contacts',shareContacts.map(c=>[c.id,c.nomor+(c.kelompkontak?' — '+c.kelompkontak:'')]));
 shareOptions('share-target-groups',[...new Set(shareContacts.map(c=>c.kelompkontak).filter(Boolean))].sort().map(g=>[g,g]));
 for(const key of ['id','name'])f.elements[key].value=t[key]||'';
 shareOrder=[...(t.template_ids||[])];shareOptions('share-choose-template',shareTemplates.map(v=>[v.id,v.name]));renderShareOrder();
 if(t.session_id)f.elements.session_id.value=t.session_id;
 f.elements.enabled.checked=!!t.enabled;f.elements.interval_minutes.value=String(t.interval_minutes||0);
 if(t.next_at){const d=new Date(t.next_at);f.elements.next_at.value=new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);}
 for(const key of ['contacts','groups'])for(const option of f.elements[key].options)option.selected=(t[key]||[]).includes(option.value);
 $('share-timezone').textContent='Zona waktu: '+Intl.DateTimeFormat().resolvedOptions().timeZone+'.';$('share-job-dialog').showModal();
}
$('share-add-job').onclick=()=>run(()=>openShareJob());
form('share-contact-form',async data=>{await api('/auto-share/contacts'+(data.id?'/'+data.id:''),data.id?'PUT':'POST',{nomor:data.nomor,kelompkontak:data.kelompkontak});$('share-contact-dialog').close();await loadAutoShare();if($('ai-session').value)await loadConversations();$('message').textContent='Kontak tersimpan.';});
form('share-job-form',async data=>{const f=$('share-job-form');const body={name:data.name,template_ids:shareOrder,session_id:data.session_id,contacts:Array.from(f.elements.contacts.selectedOptions,o=>o.value),groups:Array.from(f.elements.groups.selectedOptions,o=>o.value),enabled:f.elements.enabled.checked,next_at:data.next_at?new Date(data.next_at).toISOString():null,interval_minutes:Number(data.interval_minutes)};await api('/auto-share/jobs'+(data.id?'/'+data.id:''),data.id?'PUT':'POST',body);$('share-job-dialog').close();await loadAutoShare();$('message').textContent='Pengiriman tersimpan.';});
function renderShareOrder(){
 $('share-order').replaceChildren(...shareOrder.map((id,index)=>{const li=document.createElement('li');li.append(document.createTextNode((shareTemplates.find(t=>t.id===id)?.name||'Template tidak tersedia')+' '));
 const up=button('Naik',async()=>{[shareOrder[index-1],shareOrder[index]]=[shareOrder[index],shareOrder[index-1]];renderShareOrder();});up.type='button';up.disabled=index===0;
 const down=button('Turun',async()=>{[shareOrder[index+1],shareOrder[index]]=[shareOrder[index],shareOrder[index+1]];renderShareOrder();});down.type='button';down.disabled=index===shareOrder.length-1;
 const remove=button('Hapus dari urutan',async()=>{shareOrder.splice(index,1);renderShareOrder();});remove.type='button';li.append(up,down,remove);return li;}));
}
$('share-append-template').onclick=()=>{const id=$('share-choose-template').value;if(id&&!shareOrder.includes(id)){shareOrder.push(id);renderShareOrder();}};
function shareMediaFields(){const f=$('share-template-form'),media=f.elements.media_type.value!=='text';$('share-media-fields').hidden=!media;f.elements.asset_id.required=media;f.elements.message.required=!media;f.elements.message.disabled=f.elements.media_type.value==='audio';shareTemplateAssetOptions();}
$('share-media-type').onchange=shareMediaFields;
function openShareTemplate(t={}){const f=$('share-template-form');f.reset();for(const key of ['id','name','message'])f.elements[key].value=t[key]||'';f.elements.media_type.value=t.media_type||'text';shareMediaFields();if(t.asset_id)f.elements.asset_id.value=t.asset_id;$('share-template-dialog').showModal();}
$('share-add-template').onclick=()=>openShareTemplate();
form('share-template-form',async data=>{await api('/auto-share/templates'+(data.id?'/'+data.id:''),data.id?'PUT':'POST',{name:data.name,message:data.message,media_type:data.media_type,asset_id:data.asset_id||null});$('share-template-dialog').close();await loadAutoShare();$('message').textContent='Template tersimpan.';});
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

void run(show);
