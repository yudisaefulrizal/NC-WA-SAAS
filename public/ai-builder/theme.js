// Tema editor (terang/gelap) dipasang sebelum halaman digambar supaya tidak berkedip. Pilihan disimpan per browser;
// tanpa pilihan, editor mengikuti pengaturan sistem.
(() => {
  let saved = null;
  try {
    saved = localStorage.getItem('ncwa-builder-theme');
  } catch {}
  if (saved === 'dark' || saved === 'light') document.documentElement.dataset.theme = saved;
})();
