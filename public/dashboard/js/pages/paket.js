// Paket: plan catalog, QRIS checkout and payment history, plus buying AI credit.
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
function aiCreditSummary(){const units=Number($('ai-credit-units').value),valid=Number.isSafeInteger(units)&&units>=1&&units<=100;$('ai-credit-summary').textContent=valid&&aiCreditPrice?`${new Intl.NumberFormat('id-ID').format(units*10000)} kredit AI · ${money(aiCreditPrice*units)}`:'Jumlah unit harus bilangan 1–100.';$('ai-credit-confirm').disabled=!valid||!aiCreditPrice;return valid?units:null;}
$('ai-credit-units').oninput=aiCreditSummary;
$('ai-credit-confirm').onclick=()=>run(async()=>{const units=aiCreditSummary();if(!units)return;const control=$('ai-credit-confirm');control.disabled=true;try{const order=await api('/api/ai/payments','POST',{units});$('ai-credit-modal').close();await checkout(order.id);await paymentList();}finally{control.disabled=false;await loadAI();}});
