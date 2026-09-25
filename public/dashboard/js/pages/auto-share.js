// Auto Share: contacts, templates, gallery assets, scheduled sends and their history.
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
