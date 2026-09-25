// Referral: the client page and the owner page.
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
