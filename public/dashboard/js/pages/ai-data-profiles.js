// Asisten AI, Data Profil: kartu data profil, strip profil sesi yang dipilih, dialog pasang/ganti, dan filter pesan sesi.
const profileIcon =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 9l1.5-5h15L21 9"/><path d="M4 9v11h16V9"/><path d="M9 20v-6h6v6"/></svg>';
const chatIcon =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/></svg>';
function sessionChips(sessions) {
  const chips = element('div', 'ai-session-chips');
  for (const id of sessions) chips.append(element('span', 'ai-session-chip', id));
  return chips;
}
// Isi sebuah data profil, dalam istilah profilnya sendiri.
const profileCounts = p =>
  p.profile_type === 'pendidikan'
    ? [p.programs + ' program', p.documents + ' dokumen', p.contacts + ' kontak']
    : [p.products + ' produk', p.orders + ' pesanan'];
function renderDataProfiles() {
  const list = $('ai-profiles-list');
  list.replaceChildren();
  if (!aiDataProfiles.length)
    list.append(element('p', 'empty', 'Belum ada data profil. Buat data profil, lalu pasang ke sesi di tab Sesi.'));
  for (const p of aiDataProfiles) {
    const card = element('article', 'ai-profile-card'),
      head = element('div', 'ai-profile-card-head'),
      icon = element('span', 'ai-profile-card-icon'),
      title = element('div', 'ai-profile-card-title');
    icon.innerHTML = profileIcon;
    title.append(
      element('strong', '', p.name),
      element(
        'span',
        'ai-profile-type' + (p.profile_enabled ? '' : ' disabled'),
        p.profile_name + (p.profile_enabled ? '' : ' · nonaktif'),
      ),
    );
    const menu = element('details', 'ai-card-menu'),
      summary = element('summary', '', '⋮'),
      items = element('div', 'ai-card-menu-items');
    summary.setAttribute('aria-label', 'Menu ' + p.name);
    items.append(
      button('Ganti nama', async () => {
        menu.open = false;
        const name = prompt('Nama baru untuk data profil ini:', p.name);
        if (!name?.trim() || name.trim() === p.name) return;
        await api(profileBase(p.id), 'PATCH', { name: name.trim() });
        await loadDataProfiles();
        $('message').textContent = 'Nama data profil diperbarui.';
      }),
      button('Duplikat', async () => {
        menu.open = false;
        const name = prompt('Nama untuk salinan data profil ini:', 'Salinan ' + p.name);
        if (!name?.trim()) return;
        await api('/ai/data-profiles', 'POST', { name: name.trim(), copy_from: p.id });
        await loadDataProfiles();
        $('message').textContent =
          p.profile_type === 'pendidikan'
            ? 'Data profil diduplikat beserta program, dokumen, dan kontaknya.'
            : 'Data profil diduplikat beserta produk dan fotonya.';
      }),
      button('Hapus', async () => {
        menu.open = false;
        if (p.sessions.length) {
          $('message').textContent =
            'Cabut data profil ini dari sesi ' + p.sessions.join(', ') + ' sebelum menghapusnya.';
          return;
        }
        if (
          !confirm(
            'Hapus data profil ' +
              p.name +
              '? ' +
              (p.profile_type === 'pendidikan'
                ? 'Profil lembaga, program, jadwal, dokumen, dan kontaknya'
                : 'Knowledge, produk, foto, dan pesanannya') +
              ' ikut terhapus.',
          )
        )
          return;
        await api(profileBase(p.id), 'DELETE');
        await loadDataProfiles();
        $('message').textContent = 'Data profil dihapus.';
      }),
    );
    items.lastElementChild.classList.add('danger');
    menu.append(summary, items);
    head.append(icon, title, menu);
    const stats = element('div', 'ai-profile-stats');
    stats.append(
      ...profileCounts(p).map(text => element('span', '', text)),
      element(
        'span',
        '',
        'Diubah ' + new Date(p.updated_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }),
      ),
    );
    const used = element('div', 'ai-profile-used');
    used.append(
      element('small', '', 'DIPASANG DI'),
      p.sessions.length
        ? sessionChips(p.sessions)
        : element('span', 'ai-profile-idle', 'Belum dipasang ke sesi mana pun'),
    );
    const actions = element('div', 'ai-profile-actions');
    actions.append(
      button('Kelola isi', () => manageProfile(p)),
      button('Uji Coba', () => manageProfile(p, 'trial')),
    );
    actions.lastElementChild.classList.add('secondary');
    card.append(head, stats, used, actions);
    list.append(card);
  }
  const enabled = aiProfileTypes.filter(t => t.enabled);
  $('ai-profile-types-info').textContent = enabled.length
    ? 'Profil tersedia: ' +
      enabled.map(t => t.name).join(', ') +
      '. Profil adalah alur AI siap pakai dari NC-WA; setiap data profil dibuat untuk satu profil. Profil lain muncul di sini setelah diaktifkan admin.'
    : 'Belum ada profil AI yang diaktifkan admin.';
  $('ai-profile-new').disabled = !enabled.length;
}
$('ai-profile-new').onclick = () => {
  const f = $('ai-profile-create-form');
  f.reset();
  $('ai-profile-create-error').textContent = '';
  $('ai-profile-create-type').replaceChildren(
    ...aiProfileTypes.filter(t => t.enabled).map(t => new Option(t.name, t.id)),
  );
  $('ai-profile-create-dialog').showModal();
};
form('ai-profile-create-form', async data => {
  $('ai-profile-create-error').textContent = '';
  try {
    const created = await api('/ai/data-profiles', 'POST', { profile_type: data.profile_type, name: data.name.trim() });
    $('ai-profile-create-dialog').close();
    await loadDataProfiles();
    manageProfile(
      aiDataProfiles.find(p => p.id === created.id) ?? {
        ...created,
        products: 0,
        orders: 0,
        programs: 0,
        documents: 0,
        contacts: 0,
      },
    );
    $('message').textContent =
      data.profile_type === 'pendidikan'
        ? 'Data profil dibuat. Isi profil lembaga, program, jadwal, dokumen, dan kontaknya, lalu pasang ke sesi.'
        : 'Data profil dibuat. Isi knowledge dan produknya, lalu pasang ke sesi.';
  } catch (e) {
    $('ai-profile-create-error').textContent = e.message;
    throw e;
  }
});
// Profil sesi yang dipilih: apa yang dijalankan, siapa saja yang berbagi isinya, dan cara mengganti atau mencabutnya.
function renderProfileStrip() {
  const strip = $('ai-profile-strip'),
    session = selectedSession();
  strip.hidden = aiView !== 'sessions' || !session;
  strip.replaceChildren();
  strip.classList.toggle('is-empty', !session?.aiProfile);
  if (strip.hidden) return;
  const profile = session.aiProfile,
    type = profile && profileType(profile.profile_type),
    icon = element('span', 'ai-profile-strip-icon'),
    body = element('div', 'ai-profile-strip-body'),
    actions = element('div', 'ai-profile-strip-actions');
  icon.innerHTML = profile ? chatIcon : addIcon;
  if (!profile) {
    body.append(
      element('strong', '', 'Sesi ini belum memakai profil AI'),
      element('small', '', 'AI tidak membalas pesan di sesi ini. Riwayat chat tetap tercatat di tab Percakapan.'),
    );
    actions.append(button('Pasang profil', () => openAttach(session)));
  } else {
    const line = element('span', 'ai-profile-strip-line');
    line.append(
      element('strong', '', session.id),
      document.createTextNode(' memakai profil '),
      element('strong', '', type?.name ?? profile.profile_type),
      document.createTextNode(' dengan data profil '),
      element('strong', '', profile.name),
    );
    body.append(line);
    if (type && !type.enabled)
      body.append(
        element(
          'small',
          'ai-warning',
          'Profil ini sedang dinonaktifkan admin; AI tidak membalas sampai diaktifkan kembali.',
        ),
      );
    const shared = aiSessions.filter(s => s.id !== session.id && s.aiProfile?.id === profile.id).map(s => s.id);
    if (shared.length)
      body.append(
        element(
          'small',
          'ai-warning',
          'Data profil ini dipakai juga oleh ' +
            shared.join(', ') +
            '. Perubahan isinya berlaku untuk semua sesi tersebut.',
        ),
      );
    actions.append(
      button('Ganti data profil', () => openAttach(session, true)),
      button('Cabut', async () => {
        if (
          !confirm(
            'Cabut profil dari sesi ' +
              session.id +
              '? AI berhenti membalas di sesi ini dan memori AI-nya dikosongkan. Data profil ' +
              profile.name +
              ' tetap tersimpan.',
          )
        )
          return;
        await api('/sessions/' + encodeURIComponent(session.id) + '/ai/profile', 'PUT', { data_profile_id: null });
        await refreshSessionCards();
        await loadAssistant();
        $('message').textContent = 'Profil dicabut dari sesi ' + session.id + '.';
      }),
    );
    actions.firstElementChild.classList.add('secondary');
    actions.lastElementChild.classList.add('danger');
  }
  strip.append(icon, body, actions);
}
let attachSession = null;
async function openAttach(session, switching = false) {
  attachSession = session;
  await loadProfileCatalog();
  $('ai-attach-title').textContent = (switching ? 'Ganti data profil ' : 'Pasang profil ke ') + session.id;
  $('ai-attach-error').textContent = '';
  $('ai-attach-form').reset();
  const types = aiProfileTypes.filter(t => t.enabled),
    current = session.aiProfile;
  $('ai-attach-types').replaceChildren(
    ...types.map(t => {
      const label = element('label', 'ai-choice'),
        input = document.createElement('input'),
        text = element('span');
      input.type = 'radio';
      input.name = 'profile_type';
      input.value = t.id;
      input.checked = t.id === (current?.profile_type ?? types[0].id);
      input.onchange = renderAttachProfiles;
      text.append(element('strong', '', t.name), element('small', '', t.description));
      label.append(input, text);
      return label;
    }),
  );
  if (!types.length) $('ai-attach-types').append(element('p', 'empty', 'Belum ada profil AI yang diaktifkan admin.'));
  $('ai-attach-submit').disabled = !types.length;
  $('ai-attach-submit').textContent = switching ? 'Ganti data profil' : 'Pasang profil';
  renderAttachProfiles();
  $('ai-attach-dialog').showModal();
}
function renderAttachProfiles() {
  const f = $('ai-attach-form'),
    type = f.elements.profile_type?.value ?? f.querySelector('[name=profile_type]:checked')?.value,
    current = attachSession?.aiProfile;
  const options = aiDataProfiles.filter(p => p.profile_type === type),
    chosen = current && options.some(p => p.id === current.id) ? current.id : (options[0]?.id ?? 'new');
  $('ai-attach-profiles').replaceChildren(
    ...options.map(p => {
      const label = element('label', 'ai-choice'),
        input = document.createElement('input'),
        text = element('span');
      input.type = 'radio';
      input.name = 'data_profile';
      input.value = p.id;
      input.checked = p.id === chosen;
      input.onchange = attachWarning;
      const where = p.sessions.length ? 'Dipasang di ' + p.sessions.length + ' sesi' : 'Belum dipasang';
      text.append(element('strong', '', p.name), element('small', '', where + ' · ' + profileCounts(p)[0]));
      label.append(input, text);
      return label;
    }),
  );
  f.querySelector('[name=data_profile][value=new]').checked = chosen === 'new';
  f.querySelector('[name=data_profile][value=new]').onchange = attachWarning;
  attachWarning();
}
function attachWarning() {
  const f = $('ai-attach-form'),
    value = f.querySelector('[name=data_profile]:checked')?.value,
    current = attachSession?.aiProfile,
    profile = aiDataProfiles.find(p => p.id === value);
  $('ai-attach-new-name').hidden = value !== 'new';
  f.elements.name.required = value === 'new';
  const notes = [];
  const others = profile?.sessions.filter(s => s !== attachSession?.id) ?? [];
  if (others.length)
    notes.push(
      profile.name +
        ' dipakai juga oleh ' +
        others.join(', ') +
        '. Isinya dibagi bersama; memori AI dan percakapan tetap terpisah per sesi.',
    );
  if (current && value !== current.id)
    notes.push(
      'Memori AI sesi ' +
        attachSession.id +
        ' akan dikosongkan karena berasal dari data profil lain. Riwayat chat tetap tersimpan.',
    );
  $('ai-attach-warning').textContent = notes.join(' ');
  $('ai-attach-warning').hidden = !notes.length;
}
form('ai-attach-form', async data => {
  $('ai-attach-error').textContent = '';
  const session = attachSession;
  try {
    let id = data.data_profile;
    if (id === 'new')
      id = (await api('/ai/data-profiles', 'POST', { profile_type: data.profile_type, name: (data.name || '').trim() }))
        .id;
    await api('/sessions/' + encodeURIComponent(session.id) + '/ai/profile', 'PUT', { data_profile_id: id });
    $('ai-attach-dialog').close();
    await refreshSessionCards();
    aiTab('knowledge');
    await loadAssistant();
    $('message').textContent = session.aiEnabled
      ? 'Data profil sesi ' + session.id + ' diganti.'
      : 'Profil terpasang di ' + session.id + '. Aktifkan AI Asisten di kartu sesi saat isinya sudah siap.';
  } catch (e) {
    $('ai-attach-error').textContent = e.message;
    throw e;
  }
});
function renderAISessionFilters() {
  const filters = $('ai-session-filters'),
    session = aiSessions.find(s => s.id === $('ai-session').value);
  filters.hidden = !session || aiView !== 'sessions';
  filters.replaceChildren();
  if (!session) return;
  filters.setAttribute('aria-label', 'Filter pesan ' + session.id);
  for (const [value, label] of Object.entries({ private: 'pribadi', group: 'grup', all: 'semua' })) {
    const choice = document.createElement('label'),
      input = document.createElement('input');
    input.type = 'radio';
    input.name = 'ai-session-filter-' + session.id;
    input.setAttribute('form', 'ai-form');
    input.value = value;
    input.checked = session.filter === value;
    input.disabled = session.serviceActive === false;
    input.onchange = () =>
      run(async () => {
        await api('/sessions/' + encodeURIComponent(session.id) + '/filter', 'PUT', { filter: value });
        session.filter = value;
        renderAISessionFilters();
      });
    choice.append(input, document.createTextNode(label));
    filters.append(choice);
  }
}
