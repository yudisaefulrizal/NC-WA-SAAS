// Sambungan terakhir di atas core.js, lalu render pertama. Halaman Nomor lama diarahkan ke Integrasi dan Uji Pesan ke
// Asisten AI; tautan Dokumentasi dipindah ke kanan.
const navigateWithoutNomor = navigate;
navigate = () => {
  const requested = location.pathname.split('/')[2] || '';
  // Halaman Nomor lama kini menjadi Integrasi; Uji Pesan dipindah ke Asisten AI.
  if ($('adminlink').hidden && requested === 'nomor') history.replaceState(null, '', '/dashboard/integrasi');
  if ($('adminlink').hidden && ['', 'uji-pesan'].includes(requested)) {
    legacyMessageTest = requested === 'uji-pesan';
    history.replaceState(null, '', '/dashboard/ai');
  }
  document.querySelector('.tabs a[href="/dashboard/nomor"]')?.remove();
  document.querySelector('.tabs a[href="/dashboard/uji-pesan"]')?.remove();
  const result = navigateWithoutNomor();
  if (legacyMessageTest) {
    aiTab('trial');
    aiTrialTab('message');
    legacyMessageTest = false;
  }
  return result;
};

const showWithDocsOnRight = show;
show = async () => {
  await showWithDocsOnRight();
  const nav = $('docslink').parentElement;
  nav.insertBefore($('docslink'), nav.querySelector('.settings-menu'));
};

void run(show);
