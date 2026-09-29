// Instagram DM lewat Zernio di dashboard: daftar dan pengelolaan akun Zernio, pilihan jenis sesi di dialog Tambah
// sesi, dan memasang atau menyambungkan lagi akun Instagram. Login Instagram dilakukan klien di dashboard Zernio.
let zernioAccounts = [];
async function loadZernio() {
  zernioAccounts = await api('/api/instagram/zernio');
  renderZernio();
  fillZernioSelect();
  if (!$('integrasi').hidden) renderProviders();
}
function zernioTime(value) {
  return value
    ? new Date(value).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : 'belum ada';
}
function renderZernio() {
  list('zernio-list', zernioAccounts, (li, z) => {
    const head = element('div', 'zernio-head');
    const status = element(
      'span',
      'badge ' + (z.status === 'active' && z.webhook ? 'connected' : 'logged_out'),
      z.status === 'active' ? (z.webhook ? 'Terhubung' : 'Webhook belum ada') : 'Kunci tidak berlaku',
    );
    head.append(element('strong', '', z.name), element('code', '', 'sk_••••' + z.key_hint), status);
    const instagram = z.instagram.length
      ? z.instagram
          .map(
            i => '@' + i.username + ' (' + i.session + (i.status === 'active' ? '' : ', perlu dihubungkan ulang') + ')',
          )
          .join(', ')
      : 'belum ada';
    const detail = element(
      'p',
      'hint',
      'Instagram: ' + instagram + ' · Webhook terakhir diterima: ' + zernioTime(z.last_event_at),
    );
    const actions = element('div', 'row-actions');
    actions.append(
      button('Periksa ulang', async () => {
        await api('/api/instagram/zernio/' + z.id + '/check', 'POST');
        await loadZernio();
        $('message').textContent = 'Akun Zernio "' + z.name + '" siap dipakai.';
      }),
      button('Ganti kunci', async () => {
        const apiKey = prompt('Kunci API baru untuk "' + z.name + '" (harus dari akun Zernio yang sama):');
        if (!apiKey) return;
        await api('/api/instagram/zernio/' + z.id + '/key', 'PUT', { apiKey: apiKey.trim() });
        await loadZernio();
        $('message').textContent = 'Kunci API diganti.';
      }),
      button('Hapus', async () => {
        const note = z.instagram.length
          ? ' Sesi Instagram ' + z.instagram.map(i => i.session).join(', ') + ' ikut dihapus dari NC-WA.'
          : '';
        if (!confirm('Hapus akun Zernio "' + z.name + '"?' + note + ' Akun di Zernio tidak dihapus.')) return;
        await api('/api/instagram/zernio/' + z.id, 'DELETE');
        await Promise.all([loadZernio(), sessions()]);
        if (typeof loadAI === 'function' && !$('ai').hidden) await loadAI();
      }),
    );
    li.append(head, detail, actions);
  });
}
function fillZernioSelect() {
  const select = $('session-zernio'),
    current = select.value;
  select.replaceChildren(
    new Option('Pilih akun Zernio', ''),
    ...zernioAccounts.map(
      z =>
        new Option(
          z.name + ' · ' + z.instagram.length + ' Instagram' + (z.status === 'active' ? '' : ' (kunci tidak berlaku)'),
          z.id,
        ),
    ),
  );
  select.value = current || (zernioAccounts.length === 1 ? zernioAccounts[0].id : '');
  $('session-zernio-empty').hidden = zernioAccounts.length > 0;
  void run(loadInstagramAccounts);
}
// Akun Instagram yang sudah ada di akun Zernio terpilih; yang sudah dipakai sesi lain tidak bisa dipilih.
let instagramLoad = 0;
async function loadInstagramAccounts() {
  const zernioId = $('session-zernio').value,
    select = $('session-instagram-account'),
    generation = ++instagramLoad;
  $('session-instagram-account-field').hidden = !zernioId;
  if (!zernioId) return;
  select.replaceChildren(new Option('Memuat akun Instagram…', ''));
  const accounts = await api('/api/instagram/zernio/' + encodeURIComponent(zernioId) + '/instagram');
  if (generation !== instagramLoad) return;
  select.replaceChildren(
    new Option(accounts.length ? 'Pilih akun Instagram' : 'Belum ada Instagram di akun Zernio ini', ''),
    ...accounts.map(a => {
      const label =
        '@' + a.username + (a.session ? ' (sesi ' + a.session + ')' : a.active ? '' : ' (terputus di Zernio)');
      const option = new Option(label, a.id);
      option.disabled = Boolean(a.session) || !a.active;
      return option;
    }),
  );
  select.value = accounts.find(a => !a.session && a.active)?.id ?? '';
}
// Menampilkan isian yang sesuai jenis sesi; pilihan akun Zernio hanya wajib untuk Instagram.
function syncSessionKind() {
  const instagram = $('sessionform').querySelector('input[name="kind"]:checked')?.value === 'instagram';
  $('session-instagram').hidden = !instagram;
  $('session-zernio').required = instagram;
  $('session-zernio').disabled = !instagram;
  $('session-instagram-account').required = instagram;
  $('session-instagram-account').disabled = !instagram;
  $('session-submit').textContent = instagram ? 'Hubungkan Instagram' : 'Hubungkan sesi';
  if (instagram) void run(loadZernio);
}
async function connectInstagram(sessionId, zernioId, instagramId) {
  if (!zernioId) throw Error('Pilih akun Zernio terlebih dahulu.');
  if (!instagramId) throw Error('Pilih akun Instagram. Tambahkan akunnya di dashboard Zernio bila belum ada.');
  const result = await api('/api/instagram/connect', 'POST', { sessionId, zernioId, instagramId });
  $('addconnection').close();
  $('sessionform').reset();
  await sessions();
  if (!$('ai').hidden) await loadAI();
  if (!$('integrasi').hidden) await loadIntegrations();
  $('message').textContent = result.message;
}
// Menyambungkan lagi sesi yang terputus; bila akunnya masih terputus di Zernio, pesannya meminta klien
// menghubungkannya ulang di dashboard Zernio dulu.
async function reconnectInstagram(session) {
  const result = await api('/api/instagram/sessions/' + encodeURIComponent(session.id) + '/reconnect', 'POST');
  await sessions();
  if (!$('ai').hidden) await loadAI();
  if (!$('integrasi').hidden) await loadIntegrations();
  $('message').textContent = result.message;
}
// Label akun sebuah sesi untuk tabel dan kartu: nomor WhatsApp, atau @username dengan penanda Instagram.
function sessionAccountLabel(s) {
  if (s.channel === 'instagram') return (s.phone || 'Instagram') + ' · Instagram';
  return s.phone || '—';
}
$('sessionform').addEventListener('change', e => {
  if (e.target.name === 'kind') syncSessionKind();
  if (e.target.name === 'zernioId') void run(loadInstagramAccounts);
});
$('sessionform').addEventListener('reset', () => queueMicrotask(syncSessionKind));
document.querySelectorAll('[data-open-zernio]').forEach(
  b =>
    (b.onclick = () =>
      run(async () => {
        closeSettingsMenu();
        $('zernio-dialog').showModal();
        await loadZernio();
      })),
);
form('zernio-form', async data => {
  const created = await api('/api/instagram/zernio', 'POST', { name: data.name, apiKey: data.apiKey });
  $('zernio-form').reset();
  await loadZernio();
  $('session-zernio').value = created.id;
  $('message').textContent = 'Akun Zernio "' + data.name + '" terhubung. Webhook pesan masuk sudah didaftarkan.';
});
syncSessionKind();
