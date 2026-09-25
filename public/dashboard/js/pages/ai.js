// Asisten AI: tabs, session carousel, data profiles, knowledge autosave, products and orders.
const aiTabNames=['knowledge','orders','conversations','usage','trial','integrasi'];
function aiTab(tab){for(const name of aiTabNames){const section=$('ai-tab-'+name);if(section)section.hidden=name!==tab;}document.querySelectorAll('[data-ai-tab]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.aiTab===tab)));if(tab==='knowledge')knowledgeTab(knowledgeTabsFor(aiTargetType())[1]);if(tab==='conversations'&&$('ai-session').value&&aiView==='sessions')void run(loadConversations);}
document.querySelectorAll('[data-ai-tab]').forEach(b=>b.onclick=()=>aiTab(b.dataset.aiTab));
const knowledgeTabNames=['usaha','products','behavior','lembaga','program','jadwal','dokumen','kontak','cara_pemesanan','pembayaran','kebijakan','faq','fallback'];
// Knowledge sections differ per profile: CS Usaha has business fields and products, CS Lembaga Pendidikan its
// institution profile; Perilaku AI, FAQ and Fallback Tim belong to both.
const knowledgeTabsFor=type=>type==='pendidikan'?['behavior','lembaga','program','jadwal','dokumen','kontak','faq','fallback']:['behavior','usaha','products','cara_pemesanan','pembayaran','kebijakan','faq','fallback'];
function renderKnowledgeTabs(){const allowed=knowledgeTabsFor(aiTargetType());document.querySelectorAll('[data-knowledge-tab]').forEach(b=>b.hidden=!allowed.includes(b.dataset.knowledgeTab));for(const option of $('ai-knowledge-select').options)option.hidden=!allowed.includes(option.value);$('ai-form').elements.profile_faq.maxLength=aiTargetType()==='pendidikan'?4000:2000;{const behavior=$('ai-form').elements.behavior;behavior.dataset.csPlaceholder??=behavior.placeholder;behavior.placeholder=aiTargetType()==='pendidikan'?"Tulis gaya bahasa dan cara menyebut orang. Contoh: Sopan dan ringkas, awali dengan salam Assalamu'alaikum. Sebut peserta didik sebagai santri, orang tua sebagai wali santri, dan pengajar sebagai ustadz/ustadzah. Nama asistennya Admin PSB.":behavior.dataset.csPlaceholder;}if(!allowed.includes($('ai-knowledge-select').value))knowledgeTab(allowed[1]);}
function knowledgeTab(tab){$('ai-knowledge-select').value=tab;for(const name of knowledgeTabNames)$('ai-knowledge-tab-'+name).hidden=name!==tab;document.querySelectorAll('[data-knowledge-tab]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.knowledgeTab===tab)));}
document.querySelectorAll('[data-knowledge-tab]').forEach(b=>b.onclick=()=>knowledgeTab(b.dataset.knowledgeTab));
$('ai-knowledge-select').onchange=e=>knowledgeTab(e.target.value);
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
const aiTargetType=()=>aiView==='profiles'?aiManaged?.profile_type??'':selectedSession()?.aiProfile?.profile_type??'';
aiTab('knowledge');
const profileBase=(id=aiTarget())=>'/ai/data-profiles/'+encodeURIComponent(id);
// Session view keeps using the session routes, so orders remember which number they came from.
const dataBase=()=>aiView==='profiles'?profileBase():'/sessions/'+encodeURIComponent($('ai-session').value)+'/ai';
// Percakapan, Uji Pesan and Integrasi belong to every session; the profile adds its own tabs.
function allowedAITabs(){
 if(aiView==='profiles')return aiManaged?(profileType(aiManaged.profile_type)?.tabs??['knowledge','orders','trial']).filter(t=>t!=='usage'):[];
 const session=selectedSession();if(!session)return [];
 const type=session.aiProfile&&profileType(session.aiProfile.profile_type);
 return ['conversations','trial','integrasi',...(type?type.tabs:[])];
}
function renderAITabs(){
 const allowed=allowedAITabs();renderKnowledgeTabs();
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
// What a data profile holds, in its own profile's terms.
const profileCounts=p=>p.profile_type==='pendidikan'?[p.programs+' program',p.documents+' dokumen',p.contacts+' kontak']:[p.products+' produk',p.orders+' pesanan'];
function renderDataProfiles(){
 const list=$('ai-profiles-list');list.replaceChildren();
 if(!aiDataProfiles.length)list.append(element('p','empty','Belum ada data profil. Buat data profil, lalu pasang ke sesi di tab Sesi.'));
 for(const p of aiDataProfiles){
  const card=element('article','ai-profile-card'),head=element('div','ai-profile-card-head'),icon=element('span','ai-profile-card-icon'),title=element('div','ai-profile-card-title');
  icon.innerHTML=profileIcon;title.append(element('strong','',p.name),element('span','ai-profile-type'+(p.profile_enabled?'':' disabled'),p.profile_name+(p.profile_enabled?'':' · nonaktif')));
  const menu=element('details','ai-card-menu'),summary=element('summary','','⋮'),items=element('div','ai-card-menu-items');summary.setAttribute('aria-label','Menu '+p.name);
  items.append(button('Ganti nama',async()=>{menu.open=false;const name=prompt('Nama baru untuk data profil ini:',p.name);if(!name?.trim()||name.trim()===p.name)return;await api(profileBase(p.id),'PATCH',{name:name.trim()});await loadDataProfiles();$('message').textContent='Nama data profil diperbarui.';}),
   button('Duplikat',async()=>{menu.open=false;const name=prompt('Nama untuk salinan data profil ini:','Salinan '+p.name);if(!name?.trim())return;await api('/ai/data-profiles','POST',{name:name.trim(),copy_from:p.id});await loadDataProfiles();$('message').textContent=p.profile_type==='pendidikan'?'Data profil diduplikat beserta program, dokumen, dan kontaknya.':'Data profil diduplikat beserta produk dan fotonya.';}),
   button('Hapus',async()=>{menu.open=false;if(p.sessions.length){$('message').textContent='Cabut data profil ini dari sesi '+p.sessions.join(', ')+' sebelum menghapusnya.';return;}if(!confirm('Hapus data profil '+p.name+'? '+(p.profile_type==='pendidikan'?'Profil lembaga, program, jadwal, dokumen, dan kontaknya':'Knowledge, produk, foto, dan pesanannya')+' ikut terhapus.'))return;await api(profileBase(p.id),'DELETE');await loadDataProfiles();$('message').textContent='Data profil dihapus.';}));
  items.lastElementChild.classList.add('danger');menu.append(summary,items);
  head.append(icon,title,menu);
  const stats=element('div','ai-profile-stats');stats.append(...profileCounts(p).map(text=>element('span','',text)),element('span','','Diubah '+new Date(p.updated_at).toLocaleDateString('id-ID',{day:'numeric',month:'short'})));
  const used=element('div','ai-profile-used');used.append(element('small','','DIPASANG DI'),p.sessions.length?sessionChips(p.sessions):element('span','ai-profile-idle','Belum dipasang ke sesi mana pun'));
  const actions=element('div','ai-profile-actions');actions.append(button('Kelola isi',()=>manageProfile(p)),button('Uji Coba',()=>manageProfile(p,'trial')));actions.lastElementChild.classList.add('secondary');
  card.append(head,stats,used,actions);list.append(card);
 }
 const enabled=aiProfileTypes.filter(t=>t.enabled);
 $('ai-profile-types-info').textContent=enabled.length?'Profil tersedia: '+enabled.map(t=>t.name).join(', ')+'. Profil adalah alur AI siap pakai dari NC-WA; setiap data profil dibuat untuk satu profil. Profil lain muncul di sini setelah diaktifkan admin.':'Belum ada profil AI yang diaktifkan admin.';
 $('ai-profile-new').disabled=!enabled.length;
}
$('ai-profile-new').onclick=()=>{const f=$('ai-profile-create-form');f.reset();$('ai-profile-create-error').textContent='';$('ai-profile-create-type').replaceChildren(...aiProfileTypes.filter(t=>t.enabled).map(t=>new Option(t.name,t.id)));$('ai-profile-create-dialog').showModal();};
form('ai-profile-create-form',async data=>{$('ai-profile-create-error').textContent='';try{const created=await api('/ai/data-profiles','POST',{profile_type:data.profile_type,name:data.name.trim()});$('ai-profile-create-dialog').close();await loadDataProfiles();manageProfile(aiDataProfiles.find(p=>p.id===created.id)??{...created,products:0,orders:0,programs:0,documents:0,contacts:0});$('message').textContent=data.profile_type==='pendidikan'?'Data profil dibuat. Isi profil lembaga, program, jadwal, dokumen, dan kontaknya, lalu pasang ke sesi.':'Data profil dibuat. Isi knowledge dan produknya, lalu pasang ke sesi.';}catch(e){$('ai-profile-create-error').textContent=e.message;throw e;}});
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
  if(shared.length)body.append(element('small','ai-warning','Data profil ini dipakai juga oleh '+shared.join(', ')+'. Perubahan isinya berlaku untuk semua sesi tersebut.'));
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
 $('ai-attach-profiles').replaceChildren(...options.map(p=>{const label=element('label','ai-choice'),input=document.createElement('input'),text=element('span');input.type='radio';input.name='data_profile';input.value=p.id;input.checked=p.id===chosen;input.onchange=attachWarning;const where=p.sessions.length?'Dipasang di '+p.sessions.length+' sesi':'Belum dipasang';text.append(element('strong','',p.name),element('small','',where+' · '+profileCounts(p)[0]));label.append(input,text);return label;}));
 f.querySelector('[name=data_profile][value=new]').checked=chosen==='new';f.querySelector('[name=data_profile][value=new]').onchange=attachWarning;
 attachWarning();
}
function attachWarning(){
 const f=$('ai-attach-form'),value=f.querySelector('[name=data_profile]:checked')?.value,current=attachSession?.aiProfile,profile=aiDataProfiles.find(p=>p.id===value);
 $('ai-attach-new-name').hidden=value!=='new';f.elements.name.required=value==='new';
 const notes=[];const others=profile?.sessions.filter(s=>s!==attachSession?.id)??[];
 if(others.length)notes.push(profile.name+' dipakai juga oleh '+others.join(', ')+'. Isinya dibagi bersama; memori AI dan percakapan tetap terpisah per sesi.');
 if(current&&value!==current.id)notes.push('Memori AI sesi '+attachSession.id+' akan dikosongkan karena berasal dari data profil lain. Riwayat chat tetap tersimpan.');
 $('ai-attach-warning').textContent=notes.join(' ');$('ai-attach-warning').hidden=!notes.length;
}
form('ai-attach-form',async data=>{$('ai-attach-error').textContent='';const session=attachSession;try{
 let id=data.data_profile;
 if(id==='new')id=(await api('/ai/data-profiles','POST',{profile_type:data.profile_type,name:(data.name||'').trim()})).id;
 await api('/sessions/'+encodeURIComponent(session.id)+'/ai/profile','PUT',{data_profile_id:id});
 $('ai-attach-dialog').close();await refreshSessionCards();aiTab('knowledge');await loadAssistant();
 $('message').textContent=session.aiEnabled?'Data profil sesi '+session.id+' diganti.':'Profil terpasang di '+session.id+'. Aktifkan AI Asisten di kartu sesi saat isinya sudah siap.';
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
 const edu=config.edu;
 setValue($('ai-form').elements.edu_lembaga,edu?.lembaga??'');
 setValue($('edu-jadwal'),edu?.jadwal??'');eduJadwalCount();
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
 await Promise.all([sessions&&id?loadConversations():null,target?(aiTargetType()==='pendidikan'?loadEduData(generation):loadAIData(generation)):null]);
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
 table('ai-fallbacks',['ID','Pelanggan','Status','Pertanyaan','Dibuat','Tindakan'],result.items,row=>{const actions=document.createElement('div');actions.className='row-actions';if(row.status==='waiting')actions.append(button('Jawab',async()=>{const answer=prompt('Jawaban untuk pelanggan:');if(!answer?.trim())return;await api(base+'/fallbacks/'+encodeURIComponent(row.id)+'/answer','POST',{answer});await loadFallbacks(base);}));if(row.status==='resolved'){actions.append(button('Ke Knowledge',()=>fallbackKnowledge(base,row)));if(aiTargetType()==='cs')actions.append(button('Tambah produk',()=>fallbackProduct(row)));}actions.append(button('Hapus',async()=>{if(!confirm('Hapus tiket fallback ini?'))return;await api(base+'/fallbacks/'+encodeURIComponent(row.id),'DELETE');await loadFallbacks(base);}));return [row.id,row.customer,row.status,row.question,new Date(row.created_at).toLocaleString('id-ID'),actions.childElementCount?actions:'—'];});
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
