// Asisten AI, Knowledge: Perilaku AI dan Fallback Tim (simpan otomatis per bidang), tiket fallback sesi, dan memuat
// pengaturan asisten. Isi koleksi data profil dikelola di sub-menu koleksi (ai-records.js).
let assistantLoad = 0;
// Simpan otomatis: setiap bidang menyimpan dirinya sendiri dengan jeda, bukan satu tombol "Simpan semua tab". Timer
// per elemen membuat mengetik di satu kolom tidak pernah mengulang simpanan kolom lain yang sedang menunggu.
const autosaveTimers = new WeakMap();
let autosaveStatusToken = 0;
// Ditampilkan sebagai lencana ikon kecil (lihat .ai-save-status di css/ai-workspace.css), bukan teks biasa, supaya
// tidak menggeser header. Teksnya tetap ada tapi tersembunyi secara visual agar aria-live mengumumkannya ke pembaca
// layar, dan sebagai atribut title untuk tooltip mouse.
function autosaveStatus(state, text) {
  const el = $('ai-save-status');
  const token = ++autosaveStatusToken;
  el.className = 'ai-save-status ' + state;
  el.title = text;
  el.innerHTML = '';
  const label = document.createElement('span');
  label.className = 'sr-only';
  label.textContent = text;
  el.append(label);
  if (state === 'saved')
    setTimeout(() => {
      if (token === autosaveStatusToken) {
        el.className = 'ai-save-status';
        el.title = '';
        el.innerHTML = '';
      }
    }, 2500);
}
async function autosaveField(field, value) {
  const target = aiTarget(),
    base = dataBase();
  if (!target) return;
  autosaveStatus('saving', 'Menyimpan…');
  try {
    const config = await api(base + '/field', 'PATCH', { field, value });
    if (target !== aiTarget()) return; // pengguna berpindah sesi atau data profil saat ini masih berjalan
    applyAssistantConfig(config, { keepFocus: true });
    autosaveStatus('saved', 'Tersimpan');
  } catch (e) {
    autosaveStatus('error', e.message);
    throw e;
  }
}
function debounceAutosave(el, field, value, delay = 800) {
  clearTimeout(autosaveTimers.get(el));
  autosaveTimers.set(
    el,
    setTimeout(() => run(() => autosaveField(field, value)), delay),
  );
}
{
  const el = $('ai-form').elements.behavior;
  el.oninput = () => debounceAutosave(el, 'behavior', el.value);
}
{
  const el = $('ai-form').elements.fallback_number;
  el.oninput = () => debounceAutosave(el, 'fallback_number', el.value);
}
$('ai-form').elements.fallback_notify.onchange = e => run(() => autosaveField('fallback_notify', e.target.checked));
// keepFocus:true (respons simpan otomatis) melewati bidang yang sedang diketik, supaya balasan dari ketikan pengguna
// sendiri tidak menimpa apa yang masih diketiknya.
function applyAssistantConfig(config, { keepFocus = false } = {}) {
  const active = keepFocus ? document.activeElement : null;
  const setValue = (el, value) => {
    if (el !== active) el.value = value;
  };
  setValue($('ai-form').elements.behavior, config.behavior ?? '');
  setValue($('ai-form').elements.fallback_number, config.fallback_number ?? '');
  if ($('ai-form').elements.fallback_notify !== active)
    $('ai-form').elements.fallback_notify.checked = Boolean(config.fallback_notify);
  // Data profil tidak punya saklar AI sendiri; hanya pengaturan sesi yang memilikinya.
  if ('enabled' in config) $('ai-session-enabled-field').value = config.enabled ? 'on' : '';
}
async function loadAssistant() {
  const generation = ++assistantLoad,
    id = $('ai-session').value;
  // .elements berisi semua kontrol yang terhubung ke #ai-form, bernama atau tidak; saringan nama melewatkan tombol
  // tanpa nama di kartu carousel, yang status aktifnya diatur sendiri (hanya kartu tengah yang bisa disunting).
  const controls = [...$('ai-form').elements].filter(x => x.name && x.name !== 'session');
  for (const control of controls) control.disabled = true;
  renderAIView();
  $('ai-trial-session').value = aiView === 'sessions' ? id : '';
  // Perilaku dan fallback milik data profil tujuan; tanpa data profil tidak ada yang bisa disunting.
  const target = aiTarget(),
    sessions = aiView === 'sessions';
  try {
    const config =
      sessions && id
        ? await api('/sessions/' + encodeURIComponent(id) + '/ai')
        : !sessions && target
          ? await api(profileBase(target))
          : { enabled: false, behavior: '' };
    if (generation !== assistantLoad) return;
    applyAssistantConfig(config);
    if (!sessions || !id) {
      chat.id = '';
      chat.active = '';
      chat.list = [];
      renderChatList();
      renderChatView();
    }
    await Promise.all([
      sessions && id ? loadConversations() : null,
      sessions && target ? loadFallbacks() : null,
      loadKnowledgeCollections(),
    ]);
    if (!sessions || !target) $('ai-fallbacks').replaceChildren();
  } finally {
    if (generation === assistantLoad) for (const control of controls) control.disabled = !target;
  }
}
// Tiket fallback milik pelanggan sebuah sesi; data profil yang dikelola langsung hanya mengatur nomor tim.
let aiFallbacksPage = 1,
  aiFallbacksLoading = false;
async function loadFallbacks(
  base = (() => {
    const id = $('ai-session').value;
    return id && aiView === 'sessions' ? '/sessions/' + encodeURIComponent(id) + '/ai' : null;
  })(),
  page = aiFallbacksPage,
) {
  if (!base || aiFallbacksLoading) return;
  aiFallbacksLoading = true;
  $('ai-fallbacks-prev').disabled = $('ai-fallbacks-next').disabled = true;
  try {
    const result = await api(base + '/fallbacks?page=' + page);
    aiFallbacksPage = result.page;
    table('ai-fallbacks', ['ID', 'Pelanggan', 'Status', 'Pertanyaan', 'Dibuat', 'Tindakan'], result.items, row => {
      const actions = document.createElement('div');
      actions.className = 'row-actions';
      if (row.status === 'waiting')
        actions.append(
          button('Jawab', async () => {
            const answer = prompt('Jawaban untuk pelanggan:');
            if (!answer?.trim()) return;
            await api(base + '/fallbacks/' + encodeURIComponent(row.id) + '/answer', 'POST', { answer });
            await loadFallbacks(base);
          }),
        );
      actions.append(
        button('Hapus', async () => {
          if (!confirm('Hapus tiket fallback ini?')) return;
          await api(base + '/fallbacks/' + encodeURIComponent(row.id), 'DELETE');
          await loadFallbacks(base);
        }),
      );
      return [
        row.id,
        row.customer,
        row.status,
        row.question,
        new Date(row.created_at).toLocaleString('id-ID'),
        actions,
      ];
    });
    $('ai-fallbacks-page').textContent =
      'Halaman ' + result.page + ' dari ' + result.pages + ' · ' + result.total + ' tiket';
    $('ai-fallbacks-prev').disabled = result.page <= 1;
    $('ai-fallbacks-next').disabled = result.page >= result.pages;
  } catch (error) {
    $('ai-fallbacks-prev').disabled = aiFallbacksPage <= 1;
    $('ai-fallbacks-next').disabled = false;
    throw error;
  } finally {
    aiFallbacksLoading = false;
  }
}
$('ai-fallbacks-prev').onclick = () => run(() => loadFallbacks(undefined, aiFallbacksPage - 1));
$('ai-fallbacks-next').onclick = () => run(() => loadFallbacks(undefined, aiFallbacksPage + 1));
