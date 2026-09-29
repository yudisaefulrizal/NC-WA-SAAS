// Sambungan terakhir di atas core.js, lalu render pertama. Manajemen sesi tersedia dari Asisten AI, jadi halaman
// Nomor, Uji Pesan, dan Integrasi lama diarahkan ke sana; tautan Dokumentasi dipindah ke kanan.
const navigateWithoutNomor = navigate;
navigate = () => {
  const requested = location.pathname.split('/')[2] || '',
    legacyIntegration = requested === 'integrasi';
  if ($('adminlink').hidden && ['', 'nomor', 'uji-pesan', 'integrasi'].includes(requested)) {
    legacyMessageTest = requested === 'uji-pesan';
    history.replaceState(null, '', '/dashboard/ai');
  }
  document.querySelector('.tabs a[href="/dashboard/nomor"]')?.remove();
  document.querySelector('.tabs a[href="/dashboard/uji-pesan"]')?.remove();
  document.querySelector('.tabs a[href="/dashboard/integrasi"]')?.remove();
  const result = navigateWithoutNomor();
  if (legacyIntegration) aiTab('integrasi');
  else if (legacyMessageTest) {
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
