// Asisten AI, carousel sesi: kartu nomor WhatsApp, slot tambah/upgrade, geser, dan penyesuaian lebar layar.
const addIcon =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
const upgradeIcon =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
// Slot carousel setelah sesi sungguhan: "tambah" (masih di bawah session_limit, membuka dialog sambung) atau "upgrade"
// (melewati session_limit, menuju /dashboard/paket). Jumlah slot selalu minimal 5: paket kecil (batas < 5) mengisi
// sisanya dengan slot upgrade; paket 5 ke atas hanya menampilkan slot tambah yang tersisa, ditambah tepat satu slot
// upgrade saat kuota penuh.
function buildSessionSlots() {
  const used = aiSessions.length,
    limit = Math.max(1, aiSessionLimit);
  const slots = aiSessions.slice();
  if (limit < 5) {
    for (let i = used; i < limit; i++) slots.push({ placeholder: 'add' });
    for (let i = Math.max(limit, used); i < 5; i++) slots.push({ placeholder: 'upgrade' });
  } else {
    for (let i = used; i < limit; i++) slots.push({ placeholder: 'add' });
    if (used >= limit) slots.push({ placeholder: 'upgrade' });
  }
  return slots;
}
function selectSession(id) {
  if ($('ai-session').value === id) return;
  $('ai-session').value = id;
  clearReceivedTest();
  const index = aiSessions.findIndex(s => s.id === id);
  if (index >= 0) aiSessionIndex = index;
  renderSessionCards();
  renderAISessionFilters();
  run(async () => {
    aiTab('knowledge');
    for (const dialog of ['ai-product-dialog', 'ai-order-dialog', 'ai-order-edit-dialog']) $(dialog).close();
    aiFallbacksPage = 1;
    await loadAssistant();
  });
}
// Kartu pengganti setelah sesi sungguhan: "tambah" membuka dialog sambung, "upgrade" menuju halaman pembelian.
// Tampilannya dibuat mirip kartu sesi (kelas sama, efek kedalaman sama) tapi tanpa status, saklar, atau id.
function buildPlaceholderCard(kind, offset) {
  const card = document.createElement('article');
  card.className = 'ai-session-card placeholder placeholder-' + kind;
  card.setAttribute('role', 'button');
  card.tabIndex = 0;
  card.classList.add('ai-session-depth-' + Math.min(2, Math.abs(offset)));
  const icon = document.createElement('span');
  icon.className = 'ai-session-placeholder-icon';
  icon.innerHTML = kind === 'add' ? addIcon : upgradeIcon;
  const label = document.createElement('strong');
  label.textContent = kind === 'add' ? '+ Tambah sesi' : 'Tingkatkan paket';
  card.append(icon, label);
  const activate = () => {
    if (kind === 'add') {
      $('sessionform').reset();
      $('addconnection').showModal();
    } else {
      history.pushState(null, '', '/dashboard/paket');
      navigate();
      window.scrollTo(0, 0);
    }
  };
  card.onclick = activate;
  card.onkeydown = e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      activate();
    }
  };
  return card;
}
// offset adalah jarak kartu dari kartu tengah (aktif): 0 = aktif/bisa disunting, ±1/±2 = tetangga yang hanya
// ditampilkan sebagai konteks, dipudarkan dan kontrolnya dimatikan supaya tidak tersunting tanpa sengaja.
function buildSessionCard(s, offset) {
  if (s.placeholder) return buildPlaceholderCard(s.placeholder, offset);
  const card = document.createElement('article');
  card.className = 'ai-session-card';
  card.setAttribute('role', 'button');
  card.tabIndex = 0;
  const active = offset === 0;
  card.setAttribute('aria-pressed', String(active));
  if (active) card.classList.add('selected');
  card.classList.add('ai-session-depth-' + Math.min(2, Math.abs(offset)));
  const head = document.createElement('div');
  head.className = 'ai-session-card-head';
  const meta = sessionStatusMeta[s.status] ?? sessionStatusMeta.logged_out;
  const status = document.createElement(meta.clickable ? 'button' : 'span');
  status.className = 'ai-session-status ' + meta.cls;
  status.innerHTML = meta.icon;
  status.setAttribute('aria-label', meta.label);
  if (meta.clickable) {
    status.type = 'button';
    status.onclick = e => {
      e.stopPropagation();
      run(async () => {
        if (s.status === 'logged_out') await api('/sessions/' + encodeURIComponent(s.id) + '/reconnect', 'POST');
        await pair(s.id);
      });
    };
  }
  const nameBlock = document.createElement('div');
  nameBlock.className = 'ai-session-card-name';
  const name = document.createElement('strong');
  name.textContent = s.id;
  const phone = document.createElement('small');
  phone.textContent = s.phone || '—';
  nameBlock.append(name, phone);
  head.append(status, nameBlock);
  const foot = document.createElement('div');
  foot.className = 'ai-session-card-foot';
  const toggle = document.createElement('label');
  toggle.className = 'ai-toggle' + (s.aiEnabled ? ' active' : '');
  // Bukan <span>: selektor global .ai-toggle span mewarnai pil saklar, jadi label ini akan ikut tergambar seperti
  // saklar kedua di samping saklar aslinya.
  const robot = document.createElement('strong');
  robot.className = 'ai-session-robot';
  robot.textContent = 'AI Asisten';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = Boolean(s.aiEnabled);
  input.disabled = !active;
  input.onclick = e => e.stopPropagation();
  input.onchange = () =>
    run(async () => {
      const desired = input.checked;
      input.disabled = true;
      try {
        await api('/sessions/' + encodeURIComponent(s.id) + '/ai/enabled', 'PATCH', { enabled: desired });
        s.aiEnabled = desired;
        if (s.id === $('ai-session').value) $('ai-session-enabled-field').value = desired ? 'on' : '';
      } catch (e) {
        input.disabled = false;
        throw e;
      }
      // Render ulang supaya setiap salinan kartu sesi ini (bila sesi lebih sedikit dari slot, satu sesi tampil lebih dari
      // sekali) ikut menampilkan keadaan baru. Render ulang mengganti `input` di DOM, jadi mengaktifkannya lagi di sini
      // berarti menyentuh elemen yang sudah terlepas.
      renderSessionCards();
    });
  toggle.append(robot, input, document.createElement('span'));
  // Kartu menunjukkan data profil yang dijalankan sesi; tanpa data profil tidak ada saklar AI, hanya "Pasang profil".
  if (s.aiProfile) {
    const chip = element('span', 'ai-session-profile');
    chip.append(
      element('small', '', (profileType(s.aiProfile.profile_type)?.name ?? s.aiProfile.profile_type).toUpperCase()),
      element('strong', '', s.aiProfile.name),
    );
    foot.append(chip, toggle);
  } else {
    const attach = button('Pasang profil', async () => {
      selectSession(s.id);
      await openAttach(s);
    });
    attach.classList.add('ai-session-attach');
    attach.addEventListener('click', e => e.stopPropagation());
    attach.disabled = !active;
    foot.append(element('span', 'ai-session-noprofile', 'Belum ada profil AI'), attach);
  }
  card.append(head, foot);
  card.onclick = () => selectSession(s.id);
  card.onkeydown = e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      selectSession(s.id);
    }
  };
  return card;
}
// Putaran tanpa ujung: salinan tambahan dirender sebelum dan sesudah daftar asli supaya geser ke ujung mana pun selalu
// punya kartu berikutnya, lalu kembali tanpa animasi ke salinan tengah. Terlihat 3 kartu penuh (yang tengah bisa
// disunting) dan setengah kartu di tiap sisi; di layar selebar ponsel (batas 760px seperti bagian lain tab AI) hanya
// 1 kartu selebar layar, karena 3 kartu dengan lebar minimum 120px tidak muat.
function aiSessionFullCardsFor(viewport) {
  return viewport < 760 ? 1 : 3;
}
// aiSessionIndex menunjuk ke daftar slot (sesi sungguhan + pengganti), bukan hanya aiSessions. selectSession()
// memberi posisi sesi di aiSessions, yang selalu <= posisinya di slot karena sesi sungguhan diletakkan lebih dulu
// oleh buildSessionSlots().
function renderSessionCards() {
  const slots = buildSessionSlots(),
    count = slots.length;
  $('ai-session-prev').disabled = $('ai-session-next').disabled = count === 0;
  if (!count) {
    $('ai-session-track').replaceChildren();
    $('ai-session-dots').replaceChildren();
    return;
  }
  const track = $('ai-session-track');
  const gap = 12,
    viewport = $('ai-session-cards').getBoundingClientRect().width;
  // Berhenti selama wadah carousel tersembunyi (lebar 0, misalnya tab AI belum aktif), karena tata letak berbasis lebar
  // yang dihitung saat itu salah. ResizeObserver di bawah memicu ulang begitu wadahnya benar-benar terukur.
  if (viewport <= 0) return;
  // N slot penuh + setengah slot mengintip di tiap sisi = selebar N+1 slot, kecuali saat 1 kartu penuh (lebar ponsel),
  // di mana satu kartu memenuhi layar tanpa intipan.
  const aiSessionFullCards = aiSessionFullCardsFor(viewport);
  const visibleCards = aiSessionFullCards === 1 ? 1 : aiSessionFullCards + 1;
  const cardWidth = Math.max(120, Math.floor((viewport - gap * (visibleCards - 1)) / visibleCards));
  document.documentElement.style.setProperty('--ai-card-width', cardWidth + 'px');
  // Daftar slot diulang cukup banyak supaya geser ke tepi jendela yang terlihat, dari posisi mana pun, selalu mendarat
  // di dalam cadangan; 3x tidak cukup bila slot lebih sedikit dari kartu yang terlihat (misalnya 1-4 slot di 5 posisi).
  const copies = Math.max(3, Math.ceil((visibleCards * 2 + 2) / count));
  const middleBlock = Math.floor(copies / 2);
  // Kartu aktif berada di indeks (middleBlock*count + aiSessionIndex) pada blok tengah; offset kartu lain adalah
  // indeksnya sendiri dikurangi indeks tengah itu.
  const centerFlatIndex = middleBlock * count + aiSessionIndex;
  track.replaceChildren(
    ...Array.from({ length: copies }, () => slots)
      .flat()
      .map((s, i) => buildSessionCard(s, i - centerFlatIndex)),
  );
  // Intipan depan: sisakan celah tipis di tiap sisi supaya kartu sebelumnya mengintip di kiri dan dua kartu berikutnya
  // terlihat di kanan: setengah/AKTIF/penuh/penuh/setengah. Kartu aktif berada tepat setelah celah kiri (slot penuh
  // pertama), jadi tata letaknya condong melihat ke depan, bukan persis di tengah.
  const sliver = Math.max(0, viewport - aiSessionFullCards * cardWidth - (aiSessionFullCards - 1) * gap) / 2;
  track.style.transition = 'none';
  track.style.transform = 'translateX(-' + (centerFlatIndex * (cardWidth + gap) - sliver) + 'px)';
  track.offsetHeight; // paksa reflow supaya perubahan transform berikutnya beranimasi
  track.style.transition = '';
  $('ai-session-dots').replaceChildren(
    ...slots.map((_, i) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'ai-session-dot' + (i === ((aiSessionIndex % count) + count) % count ? ' active' : '');
      dot.setAttribute('aria-label', 'Slot ' + (i + 1));
      dot.onclick = () => {
        aiSessionIndex = i;
        renderSessionCards();
        settleSession();
      };
      return dot;
    }),
  );
}
// Menjadikan slot yang di tengah (setelah geser atau klik titik) benar-benar sesi aktif, bukan hanya tampak di tengah
// sementara form di bawah masih menampilkan sesi sebelumnya. Sesi sungguhan di tengah → selectSession() (sama seperti
// mengeklik kartunya): menyamakan $('ai-session').value dan memuat ulang tab knowledge/produk/pesanannya. Kartu
// pengganti di tengah → tidak ada sesi aktif, jadi form disembunyikan seperti saat belum ada sesi.
function settleSession() {
  const slots = buildSessionSlots();
  if (!slots.length) return;
  const index = ((aiSessionIndex % slots.length) + slots.length) % slots.length;
  const slot = slots[index];
  if (slot.placeholder) {
    if ($('ai-session').value) {
      $('ai-session').value = '';
      renderAISessionFilters();
      run(loadAssistant);
    }
  } else if (slot.id !== $('ai-session').value) selectSession(slot.id);
}
function slideSession(delta) {
  const count = buildSessionSlots().length;
  if (!count) return;
  aiSessionIndex += delta;
  renderSessionCards();
  // Setelah animasi geser, bila posisi sudah masuk ke salinan cadangan, lompat tanpa animasi ke posisi yang sama di
  // salinan tengah supaya putaran tidak pernah kehabisan kartu. Penentuan sesi aktif juga diberi jeda yang sama,
  // supaya klik beruntun tidak memicu satu request per klik.
  clearTimeout(slideSession.snapTimer);
  slideSession.snapTimer = setTimeout(() => {
    const count = buildSessionSlots().length;
    if (aiSessionIndex < 0 || aiSessionIndex >= count) {
      aiSessionIndex = ((aiSessionIndex % count) + count) % count;
      renderSessionCards();
    }
    settleSession();
  }, 360);
}
$('ai-session-prev').onclick = () => slideSession(-1);
$('ai-session-next').onclick = () => slideSession(1);
// Listener 'resize' biasa melewatkan kasus yang paling penting: tab AI berubah dari display:none menjadi terlihat
// (wadahnya berlebar nol saat tersembunyi, jadi ukuran kartu yang dihitung saat itu salah). ResizeObserver terpicu
// setiap kali ukuran kotaknya benar-benar berubah, termasuk saat menjadi terlihat.
new ResizeObserver(() => renderSessionCards()).observe($('ai-session-cards'));
