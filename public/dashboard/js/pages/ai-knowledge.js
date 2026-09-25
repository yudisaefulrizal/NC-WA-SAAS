// Asisten AI, Knowledge: sumber data produk/pesanan, simpan otomatis per bidang, dan memuat pengaturan asisten.
let assistantLoad = 0;
const sourceKinds = ['products', 'orders'];
const profileFields = ['usaha', 'cara_pemesanan', 'pembayaran', 'kebijakan', 'faq'];
function sourceVisibility() {
  for (const kind of sourceKinds) {
    const external = $('ai-form').elements[kind + '_mode'].value === 'endpoint';
    $('ai-' + kind + '-endpoint').hidden = !external;
    $('ai-form').elements[kind + '_endpoint'].required = external;
    if (external) $('ai-' + kind + '-endpoint').closest('details').open = true;
  }
}
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
for (const field of profileFields) {
  const el = $('ai-form').elements['profile_' + field];
  el.oninput = () => debounceAutosave(el, field, el.value);
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
for (const kind of sourceKinds) {
  const sourceValue = () => ({
    mode: $('ai-form').elements[kind + '_mode'].value,
    endpoint: $('ai-form').elements[kind + '_endpoint'].value,
    token: $('ai-form').elements[kind + '_token'].value || undefined,
    clear_token: $('ai-form').elements[kind + '_clear_token'].checked,
  });
  $('ai-form').elements[kind + '_mode'].onchange = () => {
    sourceVisibility();
    run(() => autosaveField(kind + '_source', sourceValue()));
  };
  $('ai-form').elements[kind + '_clear_token'].onchange = () =>
    run(() => autosaveField(kind + '_source', sourceValue()));
  const endpointEl = $('ai-form').elements[kind + '_endpoint'];
  endpointEl.oninput = () => debounceAutosave(endpointEl, kind + '_source', sourceValue());
  const tokenEl = $('ai-form').elements[kind + '_token'];
  tokenEl.oninput = () => {
    if (tokenEl.value) debounceAutosave(tokenEl, kind + '_source', sourceValue());
  };
}
// keepFocus:true (respons simpan otomatis) melewati bidang yang sedang diketik, supaya balasan dari ketikan pengguna
// sendiri tidak menimpa apa yang masih diketiknya.
function applyAssistantConfig(config, { keepFocus = false } = {}) {
  const active = keepFocus ? document.activeElement : null;
  const setValue = (el, value) => {
    if (el !== active) el.value = value;
  };
  for (const field of profileFields) setValue($('ai-form').elements['profile_' + field], config.profile?.[field] ?? '');
  setValue($('ai-form').elements.behavior, config.behavior ?? '');
  const edu = config.edu;
  setValue($('ai-form').elements.edu_lembaga, edu?.lembaga ?? '');
  setValue($('edu-jadwal'), edu?.jadwal ?? '');
  eduJadwalCount();
  setValue($('ai-form').elements.fallback_number, config.fallback_number ?? '');
  if ($('ai-form').elements.fallback_notify !== active)
    $('ai-form').elements.fallback_notify.checked = Boolean(config.fallback_notify);
  // Data profil tidak punya saklar AI sendiri; hanya pengaturan sesi yang memilikinya.
  if ('enabled' in config) $('ai-session-enabled-field').value = config.enabled ? 'on' : '';
  for (const kind of sourceKinds) {
    const src = config[kind + '_source'] || { mode: 'builtin', endpoint: '', has_token: false };
    if ($('ai-form').elements[kind + '_mode'] !== active) $('ai-form').elements[kind + '_mode'].value = src.mode;
    setValue($('ai-form').elements[kind + '_endpoint'], src.endpoint);
    // Kolom token selalu kosong saat dibaca ulang (secret yang tersimpan tidak pernah dikirim ke browser); bila pengguna
    // sedang mengisinya, biarkan supaya ketikannya tidak terhapus oleh respons simpan.
    if ($('ai-form').elements[kind + '_token'] !== active) $('ai-form').elements[kind + '_token'].value = '';
    if ($('ai-form').elements[kind + '_clear_token'] !== active)
      $('ai-form').elements[kind + '_clear_token'].checked = false;
    $('ai-' + kind + '-token-status').textContent = src.has_token ? 'Token tersimpan terenkripsi.' : 'Tanpa token.';
  }
  sourceVisibility();
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
  // Knowledge, produk, dan pesanan milik data profil tujuan; tanpa data profil tidak ada yang bisa disunting.
  const target = aiTarget(),
    sessions = aiView === 'sessions';
  $('ai-product-add').disabled = $('ai-order-add').disabled = true;
  try {
    const config =
      sessions && id
        ? await api('/sessions/' + encodeURIComponent(id) + '/ai')
        : !sessions && target
          ? await api(profileBase(target))
          : { enabled: false, profile: {}, behavior: '' };
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
      target ? (aiTargetType() === 'pendidikan' ? loadEduData(generation) : loadAIData(generation)) : null,
    ]);
    if (!target) for (const name of ['ai-products', 'ai-orders', 'ai-fallbacks']) $(name).replaceChildren();
  } finally {
    if (generation === assistantLoad) {
      for (const control of controls) control.disabled = !target;
      $('ai-product-add').disabled = $('ai-order-add').disabled = !target;
    }
  }
}
