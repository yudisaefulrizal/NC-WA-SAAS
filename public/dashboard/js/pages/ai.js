// Asisten AI: tab, tampilan Sesi dan Data Profil, katalog profil, dan pemuatan halaman.
const aiTabNames = ['knowledge', 'orders', 'conversations', 'usage', 'trial', 'integrasi'];
function aiTab(tab) {
  for (const name of aiTabNames) {
    const section = $('ai-tab-' + name);
    if (section) section.hidden = name !== tab;
  }
  document
    .querySelectorAll('[data-ai-tab]')
    .forEach(b => b.setAttribute('aria-pressed', String(b.dataset.aiTab === tab)));
  if (tab === 'knowledge') knowledgeTab(firstKnowledgeTab(aiTargetType()));
  if (tab === 'conversations' && $('ai-session').value && aiView === 'sessions') void run(loadConversations);
}
document.querySelectorAll('[data-ai-tab]').forEach(b => (b.onclick = () => aiTab(b.dataset.aiTab)));
const knowledgeTabNames = [
  'usaha',
  'products',
  'behavior',
  'lembaga',
  'program',
  'jadwal',
  'dokumen',
  'kontak',
  'cara_pemesanan',
  'pembayaran',
  'kebijakan',
  'faq',
  'fallback',
];
// Bagian Knowledge berbeda per profil: CS Usaha punya bidang usaha dan produk, CS Lembaga Pendidikan punya profil
// lembaga; Perilaku AI, FAQ, dan Fallback Tim dimiliki keduanya. Tester AI hanya punya Peran pelanggan, yang disimpan
// di bidang Perilaku AI.
const knowledgeTabsFor = type =>
  type === 'tester'
    ? ['behavior']
    : type === 'pendidikan'
      ? ['behavior', 'lembaga', 'program', 'jadwal', 'dokumen', 'kontak', 'faq', 'fallback']
      : ['behavior', 'usaha', 'products', 'cara_pemesanan', 'pembayaran', 'kebijakan', 'faq', 'fallback'];
// Bagian yang dibuka pertama: bagian isi utama profil, atau satu-satunya bagian bila hanya ada satu.
const firstKnowledgeTab = type => knowledgeTabsFor(type)[1] ?? knowledgeTabsFor(type)[0];
function renderKnowledgeTabs() {
  const allowed = knowledgeTabsFor(aiTargetType());
  document
    .querySelectorAll('[data-knowledge-tab]')
    .forEach(b => (b.hidden = !allowed.includes(b.dataset.knowledgeTab)));
  for (const option of $('ai-knowledge-select').options) option.hidden = !allowed.includes(option.value);
  $('ai-form').elements.profile_faq.maxLength = aiTargetType() === 'pendidikan' ? 4000 : 2000;
  // Di Tester AI bidang Perilaku AI berisi peran pelanggan yang dimainkan AI.
  const tester = aiTargetType() === 'tester',
    behaviorLabel = tester ? 'Peran pelanggan' : 'Perilaku AI';
  document.querySelector('[data-knowledge-tab="behavior"]').textContent = behaviorLabel;
  $('ai-knowledge-select').querySelector('option[value="behavior"]').textContent = behaviorLabel;
  $('ai-behavior-tester-help').hidden = !tester;
  {
    const behavior = $('ai-form').elements.behavior;
    behavior.dataset.csPlaceholder ??= behavior.placeholder;
    behavior.placeholder = tester
      ? 'Tulis siapa pelanggan yang diperankan, apa yang dicari, dan sifatnya. Contoh: Ibu rumah tangga di Bandung yang mau pesan kue ulang tahun untuk hari Sabtu; tanyakan ukuran dan harga, lalu tawar sekali. Balas singkat seperti chat WhatsApp biasa.'
      : aiTargetType() === 'pendidikan'
        ? "Tulis gaya bahasa dan cara menyebut orang. Contoh: Sopan dan ringkas, awali dengan salam Assalamu'alaikum. Sebut peserta didik sebagai santri, orang tua sebagai wali santri, dan pengajar sebagai ustadz/ustadzah. Nama asistennya Admin PSB."
        : behavior.dataset.csPlaceholder;
  }
  if (!allowed.includes($('ai-knowledge-select').value)) knowledgeTab(firstKnowledgeTab(aiTargetType()));
}
function knowledgeTab(tab) {
  $('ai-knowledge-select').value = tab;
  for (const name of knowledgeTabNames) $('ai-knowledge-tab-' + name).hidden = name !== tab;
  document
    .querySelectorAll('[data-knowledge-tab]')
    .forEach(b => b.setAttribute('aria-pressed', String(b.dataset.knowledgeTab === tab)));
}
document
  .querySelectorAll('[data-knowledge-tab]')
  .forEach(b => (b.onclick = () => knowledgeTab(b.dataset.knowledgeTab)));
$('ai-knowledge-select').onchange = e => knowledgeTab(e.target.value);
{
  const icon = document.querySelector('.ai-hero-icon'),
    plan = document.createElement('div'),
    label = document.createElement('span');
  plan.className = 'ai-hero-plan';
  label.id = 'ai-active-plan';
  label.className = 'ai-active-plan';
  label.textContent = '—';
  icon.before(plan);
  plan.append(icon, label);
}
$('ai-hero-buy').onclick = () => {
  $('ai-credit-units').value = '1';
  aiCreditSummary();
  $('ai-credit-modal').showModal();
};
let aiUsagePage = 1,
  aiUsageLoading = false,
  aiCreditPrice = 0;
// Mengambil status koneksi terbaru (dan aiEnabled) untuk kartu carousel tanpa menyentuh knowledge, produk, pesanan,
// dan lainnya; cukup ringan untuk diambil berkala, supaya logout dari HP atau scan QR di tempat lain langsung
// terlihat tanpa memuat ulang halaman.
async function refreshSessionCards() {
  const sessionRows = await api('/sessions');
  const selected = $('ai-session').value;
  aiSessions = sessionRows;
  if (!aiSessions.some(s => s.id === selected)) $('ai-session').value = aiSessions[0]?.id ?? '';
  aiSessionIndex = Math.max(
    0,
    aiSessions.findIndex(s => s.id === $('ai-session').value),
  );
  renderSessionCards();
  renderAISessionFilters();
  renderProfileStrip();
  renderAITabs();
}
async function loadAI() {
  const [w, waWallet, types] = await Promise.all([
    api('/api/ai/wallet'),
    api('/api/wallet'),
    api('/ai/profile-types'),
    loadAIUsage(),
  ]);
  aiProfileTypes = types;
  aiSessionLimit = waWallet.session_limit;
  await refreshSessionCards();
  $('ai-balance').textContent = `${w.balance} kredit`;
  $('wa-balance').textContent = `${new Intl.NumberFormat('id-ID').format(waWallet.balance)} pesan`;
  $('ai-active-plan').textContent = waWallet.plan_id === 'basic' ? 'Gratis' : waWallet.plan_id;
  aiCreditPrice = w.credit_price;
  $('ai-hero-buy').disabled = !w.credit_price;
  if ($('ai-credit-rate')) {
    const rows = [
      `${w.balance} kredit AI tersedia`,
      `Input ${w.input_rate} kredit/kata · Output ${w.output_rate} kredit/kata`,
      'Tidak kedaluwarsa, dipakai lintas semua nomor layanan',
    ];
    $('ai-credit-rate').replaceChildren(
      ...rows.map(text => {
        const li = document.createElement('li');
        const check = document.createElement('span');
        check.textContent = '✓';
        check.setAttribute('aria-hidden', 'true');
        li.append(check, document.createTextNode(text));
        return li;
      }),
    );
    $('ai-buy').disabled = !w.credit_price;
  }
  await loadAssistant();
}
// Status sesi diambil tiap 12 detik selama tab Asisten AI terbuka, supaya logout WhatsApp dari HP atau scan QR di tab
// atau perangkat lain tercermin di carousel tanpa memuat ulang.
setInterval(() => {
  if (!document.hidden && !$('ai').hidden) void run(refreshSessionCards);
}, 12000);
// Ikon batang sinyal yang netral, bukan logo WhatsApp: diulang di setiap kartu carousel (termasuk salinan putarannya),
// deretan logo WhatsApp terlihat seperti gangguan.
const connectedIcon =
  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="2" y="14" width="4" height="8" rx="1"/><rect x="10" y="10" width="4" height="12" rx="1"/><rect x="18" y="5" width="4" height="17" rx="1"/></svg>';
const qrIcon =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v3M14 20h3M20 20v.01"/></svg>';
// qr_required/logged_out butuh tindakan pengguna (scan atau sambung ulang), jadi ikon statusnya menjadi ikon QR yang
// bisa diklik; connecting hanya menunggu, jadi tetap ikon sinyal.
const sessionStatusMeta = {
  connected: { cls: 'online', icon: connectedIcon, label: 'WhatsApp terhubung', clickable: false },
  connecting: { cls: 'connecting', icon: connectedIcon, label: 'Menghubungkan…', clickable: false },
  qr_required: { cls: 'offline', icon: qrIcon, label: 'Menunggu scan QR — klik untuk menampilkan QR', clickable: true },
  logged_out: { cls: 'offline', icon: qrIcon, label: 'WhatsApp terputus — klik untuk memasang ulang', clickable: true },
};
let aiSessions = [],
  aiSessionIndex = 0,
  aiSessionLimit = 1;
// Multi-profil: profil adalah pipeline bawaan NC-WA (CS Usaha, …); data profil adalah isi milik akun ini untuk satu
// profil, bisa dipasang ke sesi mana pun. "Sesi" menyunting data profil yang terpasang di sesi terpilih; "Data
// Profil" menampilkan semua data profil dan bisa mengelolanya langsung, terpasang atau tidak.
let aiView = 'sessions',
  aiManaged = null,
  aiProfileTypes = [],
  aiDataProfiles = [];
const profileType = id => aiProfileTypes.find(t => t.id === id);
const selectedSession = () => aiSessions.find(s => s.id === $('ai-session').value);
// Data profil yang sedang disunting: yang sedang dikelola, atau yang terpasang di sesi terpilih.
const aiTarget = () => (aiView === 'profiles' ? (aiManaged?.id ?? '') : (selectedSession()?.aiProfile?.id ?? ''));
const aiTargetType = () =>
  aiView === 'profiles' ? (aiManaged?.profile_type ?? '') : (selectedSession()?.aiProfile?.profile_type ?? '');
aiTab('knowledge');
const profileBase = (id = aiTarget()) => '/ai/data-profiles/' + encodeURIComponent(id);
// Tampilan Sesi tetap memakai rute sesi, supaya pesanan mengingat dari nomor mana asalnya.
const dataBase = () =>
  aiView === 'profiles' ? profileBase() : '/sessions/' + encodeURIComponent($('ai-session').value) + '/ai';
// Percakapan, Uji Pesan, dan Integrasi dimiliki setiap sesi; profil menambahkan tabnya sendiri.
function allowedAITabs() {
  if (aiView === 'profiles')
    return aiManaged
      ? (profileType(aiManaged.profile_type)?.tabs ?? ['knowledge', 'orders', 'trial']).filter(t => t !== 'usage')
      : [];
  const session = selectedSession();
  if (!session) return [];
  const type = session.aiProfile && profileType(session.aiProfile.profile_type);
  return ['conversations', 'trial', 'integrasi', ...(type ? type.tabs : [])];
}
function renderAITabs() {
  const allowed = allowedAITabs();
  renderKnowledgeTabs();
  document.querySelectorAll('[data-ai-tab]').forEach(b => (b.hidden = !allowed.includes(b.dataset.aiTab)));
  const current = [...document.querySelectorAll('[data-ai-tab]')].find(b => b.getAttribute('aria-pressed') === 'true')
    ?.dataset.aiTab;
  if (allowed.length && !allowed.includes(current)) aiTab(aiTabNames.find(t => allowed.includes(t)));
  // Uji Pesan mengirim pesan WhatsApp sungguhan dari sesi; Uji AI Asisten butuh data profil.
  const trials = { message: aiView === 'sessions', assistant: Boolean(aiTarget()) };
  document.querySelectorAll('[data-ai-trial-tab]').forEach(b => (b.hidden = !trials[b.dataset.aiTrialTab]));
  const trial = [...document.querySelectorAll('[data-ai-trial-tab]')].find(
    b => b.getAttribute('aria-pressed') === 'true',
  )?.dataset.aiTrialTab;
  if (document.querySelector('[data-ai-trial-tab]') && !trials[trial])
    aiTrialTab(trials.assistant ? 'assistant' : 'message');
  // Tiket fallback milik pelanggan sebuah sesi; data profil yang dikelola langsung hanya mengatur nomor tim.
  for (const el of [$('ai-fallbacks'), $('ai-fallbacks').previousElementSibling, $('ai-fallbacks').nextElementSibling])
    el.hidden = aiView === 'profiles';
}
function renderAIView() {
  const sessions = aiView === 'sessions',
    managing = aiView === 'profiles' && Boolean(aiManaged);
  document
    .querySelectorAll('[data-ai-view]')
    .forEach(b => b.setAttribute('aria-selected', String(b.dataset.aiView === aiView)));
  $('ai-session-picker').hidden = !sessions;
  $('ai-profiles-view').hidden = sessions || managing;
  $('ai-manage-head').hidden = !managing;
  $('ai-session-placeholder').hidden = !sessions || Boolean($('ai-session').value);
  $('ai-session-detail').hidden = sessions ? !$('ai-session').value : !managing;
  $('ai-session-filters').hidden = !sessions || !selectedSession();
  if (managing) {
    const type = profileType(aiManaged.profile_type);
    $('ai-manage-name').textContent = aiManaged.name;
    $('ai-manage-meta').textContent =
      (type?.name ?? aiManaged.profile_type) +
      ' · ' +
      (aiManaged.sessions.length ? 'dipasang di ' + aiManaged.sessions.join(', ') : 'belum dipasang ke sesi mana pun');
  }
  renderProfileStrip();
  renderAITabs();
}
function setAIView(view) {
  if (aiView === view && !aiManaged) return;
  aiView = view;
  aiManaged = null;
  renderAIView();
  run(async () => {
    if (view === 'profiles') await loadDataProfiles();
    await loadAssistant();
  });
}
document.querySelectorAll('[data-ai-view]').forEach(b => (b.onclick = () => setAIView(b.dataset.aiView)));
$('ai-manage-back').onclick = () => {
  aiManaged = null;
  renderAIView();
  run(loadDataProfiles);
};
function manageProfile(profile, tab = 'knowledge') {
  aiManaged = profile;
  renderAIView();
  aiTab(tab);
  run(loadAssistant);
}
async function loadProfileCatalog() {
  [aiProfileTypes, aiDataProfiles] = await Promise.all([api('/ai/profile-types'), api('/ai/data-profiles')]);
}
async function loadDataProfiles() {
  await loadProfileCatalog();
  renderDataProfiles();
}
