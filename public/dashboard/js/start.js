// Final wiring over core.js (routes folded into Asisten AI, docs link placement), then the first render.
// Manajemen sesi tersedia dari Asisten AI; halaman Nomor lama tidak lagi ditampilkan.
const navigateWithoutNomor=navigate;
navigate=()=>{const requested=location.pathname.split('/')[2]||'',legacyIntegration=requested==='integrasi';if($('adminlink').hidden&&(['','nomor','uji-pesan','integrasi'].includes(requested))){legacyMessageTest=requested==='uji-pesan';history.replaceState(null,'','/dashboard/ai');}document.querySelector('.tabs a[href="/dashboard/nomor"]')?.remove();document.querySelector('.tabs a[href="/dashboard/uji-pesan"]')?.remove();document.querySelector('.tabs a[href="/dashboard/integrasi"]')?.remove();const result=navigateWithoutNomor();if(legacyIntegration)aiTab('integrasi');else if(legacyMessageTest){aiTab('trial');aiTrialTab('message');legacyMessageTest=false;}return result;};

const showWithDocsOnRight=show;
show=async()=>{await showWithDocsOnRight();const nav=$('docslink').parentElement;nav.insertBefore($('docslink'),nav.querySelector('.settings-menu'));};

void run(show);
