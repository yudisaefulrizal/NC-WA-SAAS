// Halaman Integrasi: semua koneksi (sesi WhatsApp dan Instagram) dalam satu daftar dengan jatah sesi paket,
// peringatan koneksi terputus, tindakan hubungkan/putuskan/hapus, dan akun penyedia (Zernio).
const integrations = { sessions: [], filter: 'all', limit: 0 };
const integrationIcons = {
  whatsapp:
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 20l1.3-3.9A8 8 0 1112 20a8 8 0 01-4.1-1.1z"/></svg>',
  instagram:
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="5"/><circle cx="12" cy="12" r="3.6"/></svg>',
};
async function loadIntegrations() {
  const [rows, wallet] = await Promise.all([api('/sessions'), api('/api/wallet'), loadZernio()]);
  integrations.sessions = rows;
  integrations.limit = wallet.session_limit;
  renderIntegrations();
}
function platformOf(s) {
  return s.channel === 'instagram' ? 'instagram' : 'whatsapp';
}
function integrationStatus(s) {
  if (s.serviceActive === false) return ['inactive', 'Nonaktif (batas paket)'];
  return (
    {
      connected: ['connected', 'Terhubung'],
      qr_required: ['connecting', 'Menunggu QR'],
      connecting: ['connecting', 'Menghubungkan'],
    }[s.status] ?? ['logged_out', 'Terputus']
  );
}
function renderIntegrations() {
  const all = integrations.sessions,
    active = all.filter(s => s.serviceActive !== false).length;
  $('integrations-quota').textContent = active + ' dari ' + integrations.limit + ' terpakai';
  $('integrations-add').disabled = active >= integrations.limit;
  $('integrations-add').title = active >= integrations.limit ? 'Jatah sesi paket sudah penuh' : '';
  // Koneksi terputus disebut di atas, karena pesan pelanggannya tidak dibalas sampai disambungkan lagi.
  const broken = all.filter(s => s.serviceActive !== false && s.status === 'logged_out');
  $('integrations-alert').hidden = !broken.length;
  $('integrations-alert').replaceChildren(
    element('strong', '', broken.length + ' perlu perhatian'),
    element(
      'span',
      '',
      broken.map(s => (s.phone || s.id) + ' terputus').join(', ') + '; pesan tidak dibalas sampai dihubungkan ulang.',
    ),
  );
  const counts = { all: all.length, whatsapp: 0, instagram: 0 };
  for (const s of all) counts[platformOf(s)]++;
  $('integrations-filters').replaceChildren(
    ...Object.entries({ all: 'Semua', whatsapp: 'WhatsApp', instagram: 'Instagram' }).map(([key, label]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label + ' ' + counts[key];
      b.setAttribute('aria-pressed', String(integrations.filter === key));
      b.onclick = () => {
        integrations.filter = key;
        renderIntegrations();
      };
      return b;
    }),
  );
  const shown = all.filter(s => integrations.filter === 'all' || platformOf(s) === integrations.filter);
  table('integrations-list', ['Sesi', 'Akun', 'Data profil', 'Status', 'Tindakan'], shown, s => {
    const platform = platformOf(s),
      [statusClass, statusLabel] = integrationStatus(s);
    const name = element('div', 'integration-name');
    const icon = element('span', 'integration-icon ' + platform);
    icon.innerHTML = integrationIcons[platform];
    const owner = zernioAccounts.find(z => z.instagram.some(i => i.session === s.id));
    const text = element('div');
    text.append(
      element('strong', '', s.id),
      element(
        'small',
        '',
        platform === 'instagram' ? 'Instagram' + (owner ? ' · Zernio "' + owner.name + '"' : '') : 'WhatsApp',
      ),
    );
    name.append(icon, text);
    const profile = s.aiProfile
      ? s.aiProfile.name + (s.aiEnabled ? ' · AI aktif' : ' · AI mati')
      : element('span', 'hint', 'Belum dipasang');
    return [
      name,
      s.phone || '—',
      profile,
      element('span', 'badge ' + statusClass, statusLabel),
      integrationActions(s, platform),
    ];
  });
  renderProviders();
}
function integrationActions(s, platform) {
  const actions = element('div', 'row-actions');
  const refresh = async () => {
    await Promise.all([loadIntegrations(), sessions()]);
    if (!$('ai').hidden) await loadAI();
  };
  if (s.serviceActive !== false && s.status === 'logged_out')
    actions.append(
      button('Hubungkan ulang', async () => {
        if (platform === 'instagram') await reconnectInstagram(s);
        else {
          await api('/sessions/' + encodeURIComponent(s.id) + '/reconnect', 'POST');
          await pair(s.id);
        }
        await refresh();
      }),
    );
  else if (platform === 'whatsapp' && s.serviceActive !== false && s.status !== 'connected')
    actions.append(button('Lihat QR', () => pair(s.id)));
  if (s.status !== 'logged_out')
    actions.append(
      button('Putuskan', async () => {
        const note =
          platform === 'instagram'
            ? 'AI berhenti membalas DM ' + (s.phone || s.id) + '. Akun di Zernio tidak dihapus.'
            : 'Perangkat WhatsApp ' + (s.phone || s.id) + ' dikeluarkan; memasang ulang butuh scan QR.';
        if (!confirm('Putuskan ' + s.id + '?\n' + note + '\nRiwayat chat dan data profil tetap tersimpan.')) return;
        await api('/sessions/' + encodeURIComponent(s.id) + '/logout', 'POST');
        await refresh();
      }),
    );
  const remove = button('Hapus', async () => {
    if (!confirm('Hapus sesi ' + s.id + '? Riwayat chat, memori AI, dan tiket fallback sesi ini ikut dihapus.')) return;
    await api('/sessions/' + encodeURIComponent(s.id), 'DELETE');
    await refresh();
  });
  remove.className = 'danger';
  actions.append(remove);
  return actions;
}
function renderProviders() {
  const host = $('integrations-providers');
  if (!zernioAccounts.length) {
    host.replaceChildren(element('p', 'hint', 'Belum ada akun Zernio. Tambahkan untuk menghubungkan Instagram DM.'));
    return;
  }
  host.replaceChildren(
    ...zernioAccounts.map(z => {
      const card = element('article', 'integration-provider');
      const head = element('div', 'integration-provider-head');
      head.append(
        element('strong', '', 'Zernio · ' + z.name),
        element('code', '', 'sk_••••' + z.key_hint),
        element(
          'span',
          'badge ' + (z.status === 'active' && z.webhook ? 'connected' : 'logged_out'),
          z.status === 'active' ? (z.webhook ? 'Terhubung' : 'Webhook belum ada') : 'Kunci tidak berlaku',
        ),
      );
      const actions = element('div', 'row-actions');
      const refresh = async () => {
        await loadIntegrations();
        await sessions();
      };
      actions.append(
        button('Periksa ulang', async () => {
          await api('/api/instagram/zernio/' + z.id + '/check', 'POST');
          await refresh();
          $('message').textContent = 'Akun Zernio "' + z.name + '" siap dipakai.';
        }),
        button('Ganti kunci', async () => {
          const apiKey = prompt('Kunci API baru untuk "' + z.name + '" (harus dari akun Zernio yang sama):');
          if (!apiKey) return;
          await api('/api/instagram/zernio/' + z.id + '/key', 'PUT', { apiKey: apiKey.trim() });
          await refresh();
          $('message').textContent = 'Kunci API diganti.';
        }),
      );
      const remove = button('Hapus', async () => {
        const note = z.instagram.length
          ? ' Sesi Instagram ' + z.instagram.map(i => i.session).join(', ') + ' ikut dihapus dari NC-WA.'
          : '';
        if (!confirm('Hapus akun Zernio "' + z.name + '"?' + note + ' Akun di Zernio tidak dihapus.')) return;
        await api('/api/instagram/zernio/' + z.id, 'DELETE');
        await refresh();
      });
      remove.className = 'danger';
      actions.append(remove);
      card.append(
        head,
        element(
          'p',
          'hint',
          z.instagram.length + ' Instagram dipakai · webhook terakhir diterima ' + zernioTime(z.last_event_at),
        ),
        actions,
      );
      return card;
    }),
  );
}
$('integrations-add').onclick = () => {
  $('sessionform').reset();
  $('addconnection').showModal();
};
