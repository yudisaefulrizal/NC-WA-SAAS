// Pengaturan AI pemilik: provider dan rute model, konfigurasi AI, pemakaian model, profil, kegagalan, jejak, dan
// penyesuaian kredit AI.
{
  const form = $('ai-config'),
    provider = document.createElement('label'),
    select = document.createElement('select'),
    helper = document.createElement('p');
  provider.className = 'ai-legacy-provider';
  provider.textContent = 'Provider AI';
  select.name = 'provider';
  select.append(
    new Option('Sumopod', 'sumopod'),
    new Option('OpenRouter', 'openrouter'),
    new Option('Provider kompatibel OpenAI', 'compatible'),
  );
  provider.append(select);
  helper.className = 'ai-helper ai-legacy-provider';
  helper.id = 'ai-provider-helper';
  form.elements.endpoint.closest('label').classList.add('ai-legacy-provider');
  form.querySelector('fieldset').classList.add('ai-legacy-provider');
  form.insertBefore(provider, form.elements.endpoint.closest('label'));
  form.insertBefore(helper, form.elements.endpoint.closest('label'));
  const describe = () => {
    const selected = select.value,
      managed = selected !== 'compatible';
    helper.textContent =
      selected === 'openrouter'
        ? 'OpenRouter memakai endpoint otomatis, API key OpenRouter, dan model dengan format provider/model. Pilih model yang mendukung Structured Outputs bila Router memakai output terstruktur.'
        : selected === 'sumopod'
          ? 'Sumopod memakai endpoint otomatis. Gunakan API key dan nama model dari akun Sumopod Anda.'
          : 'Gunakan endpoint API yang kompatibel dengan OpenAI Chat Completions.';
    form.elements.endpoint.readOnly = managed;
    if (selected === 'openrouter') form.elements.endpoint.value = 'https://openrouter.ai/api/v1/chat/completions';
    if (selected === 'sumopod') form.elements.endpoint.value = 'https://ai.sumopod.com/v1/chat/completions';
  };
  select.onchange = describe;
  describe();
}
let providerProfiles = { profiles: [], routes: [] };
const aiTiers = [
  ['cheap', 'Murah'],
  ['medium', 'Sedang'],
  ['smart', 'Cerdas'],
  ['structured', 'Terstruktur'],
];
{
  const panel = document.createElement('section'),
    title = document.createElement('div'),
    heading = document.createElement('h3'),
    add = document.createElement('button'),
    routes = document.createElement('form'),
    list = document.createElement('div'),
    dialog = document.createElement('dialog');
  panel.className = 'ai-provider-panel';
  heading.textContent = 'Profil provider AI';
  add.type = 'button';
  add.textContent = 'Tambah profil';
  title.className = 'integration-heading';
  title.append(heading, add);
  routes.className = 'ai-provider-routes';
  routes.innerHTML = '<p>Gunakan profil berbeda untuk tiap tingkat model. API key tetap tersimpan di server.</p>';
  for (const [tier, label] of aiTiers) {
    const row = document.createElement('label');
    row.textContent = label;
    const select = document.createElement('select');
    select.name = tier + 'Profile';
    const model = document.createElement('input');
    model.name = tier + 'Model';
    model.maxLength = 100;
    model.placeholder = 'Nama model';
    row.append(select, model);
    routes.append(row);
  }
  const save = document.createElement('button');
  save.textContent = 'Simpan rute provider';
  routes.append(save);
  list.className = 'ai-provider-list';
  dialog.innerHTML =
    '<div class="modal-heading"><h2 id="ai-provider-title">Profil provider</h2><button type="button" class="secondary" data-close> Tutup</button></div><form class="grid"><input name="id" type="hidden"><label>Nama profil<input name="name" required maxlength="100" placeholder="OpenRouter utama"></label><label>Provider<select name="provider"><option value="sumopod">Sumopod</option><option value="openrouter">OpenRouter</option><option value="compatible">Kompatibel OpenAI</option></select></label><label>Endpoint<input name="endpoint" type="url" required maxlength="512"></label><label>API key<input name="apiKey" type="password" autocomplete="off" maxlength="512" placeholder="Wajib untuk profil baru"></label><label><input name="active" type="checkbox" checked> Profil aktif</label><button>Simpan profil</button></form>';
  panel.append(title, routes, list, dialog);
  $('admin-ai').insertBefore(panel, $('ai-config').nextSibling);
  add.onclick = () => openProviderProfile();
  dialog.querySelector('[data-close]').onclick = () => dialog.close();
  dialog.querySelector('form').onsubmit = e => {
    e.preventDefault();
    void run(async () => {
      const f = e.currentTarget,
        data = Object.fromEntries(new FormData(f));
      data.active = f.elements.active.checked;
      await api('/api/admin/ai/providers', 'POST', data);
      dialog.close();
      await loadProviderProfiles();
    });
  };
  routes.onsubmit = e => {
    e.preventDefault();
    void run(async () => {
      const f = e.currentTarget,
        payload = {};
      for (const tier of ['cheap', 'medium', 'smart'])
        payload[tier] = { profileId: f.elements[tier + 'Profile'].value, model: f.elements[tier + 'Model'].value };
      await api('/api/admin/ai/providers/routes', 'PUT', payload);
      $('message').textContent = 'Rute provider tersimpan.';
      await loadProviderProfiles();
    });
  };
  window.__providerUi = { panel, routes, list, dialog };
}
{
  const ui = window.__providerUi,
    f = ui.dialog.querySelector('form');
  ui.routes.querySelectorAll('input').forEach(input => input.remove());
  const active = f.elements.active.closest('label');
  for (const [tier, label] of aiTiers) {
    const field = document.createElement('label'),
      input = document.createElement('input');
    field.textContent = 'Model ' + label;
    input.name = 'model_' + tier;
    input.required = true;
    input.maxLength = 100;
    input.placeholder = 'Nama model';
    field.append(input);
    f.insertBefore(field, active);
  }
  ui.routes.onsubmit = e => {
    e.preventDefault();
    void run(async () => {
      const payload = {};
      for (const [tier] of aiTiers) payload[tier] = { profileId: ui.routes.elements[tier + 'Profile'].value };
      await api('/api/admin/ai/providers/routes', 'PUT', payload);
      $('message').textContent = 'Provider per tingkat tersimpan.';
      await loadProviderProfiles();
    });
  };
}
function openProviderProfile(profile) {
  const ui = window.__providerUi,
    f = ui.dialog.querySelector('form');
  f.reset();
  f.elements.id.value = profile?.id || '';
  f.elements.name.value = profile?.name || '';
  f.elements.provider.value = profile?.provider || 'openrouter';
  f.elements.endpoint.value = profile?.endpoint || 'https://openrouter.ai/api/v1/chat/completions';
  for (const [tier] of aiTiers) f.elements['model_' + tier].value = profile?.['model_' + tier] || '';
  f.elements.active.checked = profile?.active !== false;
  ui.dialog.showModal();
}
async function loadProviderProfiles() {
  const ui = window.__providerUi;
  if (!ui) return;
  providerProfiles = await api('/api/admin/ai/providers');
  for (const [tier] of aiTiers) {
    const select = ui.routes.elements[tier + 'Profile'],
      route = providerProfiles.routes.find(r => r.tier === tier);
    select.replaceChildren(
      ...providerProfiles.profiles
        .filter(p => p.active)
        .map(
          p => new Option(p.name + ' · ' + p.provider, p.id, p.id === route?.profile_id, p.id === route?.profile_id),
        ),
    );
  }
  ui.list.replaceChildren(
    ...providerProfiles.profiles.map(profile => {
      const row = document.createElement('article'),
        name = document.createElement('strong'),
        meta = document.createElement('span'),
        actions = document.createElement('div'),
        edit = button('Ubah', () => openProviderProfile(profile)),
        test = button('Uji', async () => {
          await api('/api/admin/ai/providers/test', 'POST', { id: profile.id, model: profile.model_medium });
          $('message').textContent = 'Koneksi ' + profile.name + ' berhasil diuji.';
        }),
        remove = button('Hapus', async () => {
          if (!confirm('Hapus profil ' + profile.name + '? API key dan pengaturan profil ini akan dihapus.')) return;
          await api('/api/admin/ai/providers/' + encodeURIComponent(profile.id), 'DELETE');
          $('message').textContent = 'Profil ' + profile.name + ' dihapus.';
          await loadProviderProfiles();
        });
      remove.classList.add('danger');
      row.className = 'ai-provider-row';
      name.textContent = profile.name;
      meta.textContent = profile.provider + ' · ' + (profile.active ? 'Aktif' : 'Nonaktif');
      actions.className = 'row-actions';
      actions.append(edit, test, remove);
      row.append(name, meta, actions);
      return row;
    }),
  );
}
async function loadAIConfig() {
  const config = await api('/api/admin/ai');
  for (const name of [
    'provider',
    'endpoint',
    'model_cheap',
    'model_medium',
    'model_smart',
    'model_structured',
    'input_rate',
    'output_rate',
    'memory_limit',
    'context_memory_limit',
    'credit_price',
  ])
    $('ai-config').elements[name].value = config[name];
  $('ai-config').elements.provider.dispatchEvent(new Event('change'));
  const routed = Boolean(config.profile_routing_enabled);
  document.querySelectorAll('.ai-legacy-provider,[data-ai-test]').forEach(el => (el.hidden = routed));
  $('ai-config')
    .querySelectorAll('.ai-routing-note')
    .forEach(el => el.remove());
  if (routed) {
    const note = document.createElement('p');
    note.className = 'ai-routing-note ai-helper';
    note.textContent = 'Provider dan model aktif mengikuti pilihan Model per tingkat di atas.';
    $('ai-config').prepend(note);
  }
  $('ai-config-status').textContent = routed
    ? 'API key dikelola pada tab Provider.'
    : config.configured
      ? 'API key tersimpan terenkripsi.'
      : 'Koneksi AI belum dikonfigurasi. Tambahkan profil di tab Provider.';
  await loadProviderProfiles();
}
const adminWithoutProviders = admin;
admin = async () => {
  await adminWithoutProviders();
  await loadProviderProfiles();
};
{
  const page = $('admin-ai'),
    config = $('ai-config'),
    tabs = document.createElement('nav'),
    panels = {},
    routes = window.__providerUi.routes,
    routesHeading = document.createElement('h3');
  tabs.className = 'ai-admin-tabs';
  tabs.setAttribute('aria-label', 'Sub menu pengaturan AI');
  for (const [id, label] of [
    ['provider', 'Provider'],
    ['model', 'Model'],
    ['tidy', 'Rapikan Pesan'],
    ['billing', 'Tarif & Kredit'],
    ['memory', 'Memori & Log'],
    ['usage', 'Pemakaian'],
    ['balance', 'Saldo AI'],
  ]) {
    const panel = document.createElement('section'),
      button = document.createElement('button');
    panel.className = 'ai-admin-panel';
    panels[id] = panel;
    button.type = 'button';
    button.textContent = label;
    button.onclick = () => {
      for (const [key, other] of Object.entries(panels)) other.hidden = key !== id;
      for (const tab of tabs.querySelectorAll('button')) tab.setAttribute('aria-pressed', String(tab === button));
    };
    tabs.append(button);
  }
  const field = name => config.elements[name].closest('label'),
    hint = node => (node.nextElementSibling?.tagName === 'P' ? node.nextElementSibling : null),
    own = nodes => {
      for (const node of nodes)
        for (const control of node.querySelectorAll('input,select,textarea')) control.setAttribute('form', 'ai-config');
      return nodes;
    },
    saver = text => {
      const button = document.createElement('button');
      button.setAttribute('form', 'ai-config');
      button.textContent = text;
      return button;
    };
  const tidy = config.elements.tidy_prompt.closest('fieldset'),
    price = field('credit_price'),
    trace = field('trace_enabled'),
    save = config.querySelector('button:not([type])'),
    usageTitle = $('ai-model-usage').previousElementSibling?.previousElementSibling?.previousElementSibling,
    balanceTitle = $('ai-adjust').previousElementSibling;
  const billing = own([price, hint(price), field('input_rate'), field('output_rate')].filter(Boolean)),
    memory = own([field('memory_limit'), field('context_memory_limit'), trace, hint(trace)].filter(Boolean));
  own([tidy]);
  save.textContent = 'Simpan model';
  save.classList.add('ai-legacy-provider');
  routesHeading.textContent = 'Model per tingkat';
  routes.prepend(routesHeading);
  routes.querySelector('p').textContent =
    'Cukup pilih profil yang sudah dibuat untuk setiap tingkat; API key tetap aman tersimpan di server. Tingkat Terstruktur dipakai node yang butuh output JSON pasti (Pesanan, dan Router bila dipindah ke tingkat ini), jadi isi dengan model yang mendukung JSON Schema.';
  panels.provider.append($('ai-config-status'), page.querySelector('.ai-provider-panel'));
  panels.model.append(routes, config, ...page.querySelectorAll('[data-ai-test]'));
  panels.tidy.append(tidy, saver('Simpan prompt rapikan'));
  panels.billing.append(...billing, saver('Simpan tarif & kredit'));
  panels.memory.append(...memory, saver('Simpan memori & log'));
  if (usageTitle)
    panels.usage.append(usageTitle, usageTitle.nextElementSibling, $('ai-model-refresh'), $('ai-model-usage'));
  if (balanceTitle) panels.balance.append(balanceTitle, $('ai-adjust'));
  config.noValidate = true;
  page.querySelector('h2').after(tabs);
  page.append(...Object.values(panels));
  tabs.querySelector('button').click();
}
form('ai-config', async data => {
  for (const key of ['input_rate', 'output_rate', 'memory_limit', 'context_memory_limit', 'credit_price'])
    data[key] = Number(data[key]);
  data.trace_enabled = data.trace_enabled === 'on';
  await api('/api/admin/ai', 'PUT', data);
  await loadAIConfig();
  $('message').textContent = 'Pengaturan AI tersimpan.';
});
document.querySelectorAll('[data-ai-test]').forEach(b => {
  b.onclick = () =>
    run(async () => {
      b.disabled = true;
      try {
        $('message').textContent = (await api('/api/admin/ai/test', 'POST', { tier: b.dataset.aiTest })).message;
      } finally {
        b.disabled = false;
      }
    });
});
async function loadModelUsage() {
  table(
    'ai-model-usage',
    ['Waktu', 'Akun', 'Sesi', 'Status', 'Panggilan model'],
    await api('/api/admin/ai/usage'),
    r => [
      new Date(r.created_at).toLocaleString('id-ID'),
      r.account_id,
      r.session_id,
      r.status,
      (typeof r.model_calls === 'string' ? JSON.parse(r.model_calls) : r.model_calls || [])
        .map(c => `${c.role}: ${c.model} (${c.status})`)
        .join(' · ') || '—',
    ],
  );
}
$('ai-model-refresh').onclick = () => run(loadModelUsage);
let failuresPage = 1,
  failuresLoading = false;
// Profil adalah pipeline di kode; pemilik menyalakan atau mematikannya untuk semua klien dan menyetelnya di AI Studio.
async function loadAdminProfiles() {
  const rows = await api('/api/admin/ai/profiles');
  table('admin-profiles-list', ['Profil', 'Alur aktif', 'Pemakaian', 'Untuk klien', ''], rows, p => {
    const name = element('div', 'admin-profile-name'),
      icon = element('span', 'admin-profile-icon');
    icon.innerHTML = chatIcon;
    const text = element('div');
    text.append(element('strong', '', p.name), element('small', '', p.nodes + ' node · ' + p.node_summary));
    name.append(icon, text);
    const flow = element('div', 'admin-profile-cell');
    flow.append(
      element('strong', '', p.active_version ? 'Versi ' + p.active_version : 'Bawaan'),
      element('small', '', p.revision > p.published_revision ? 'draft berubah' : 'draft sama dengan aktif'),
    );
    const usage = element('div', 'admin-profile-cell');
    usage.append(element('strong', '', p.sessions + ' sesi'), element('small', '', p.data_profiles + ' data profil'));
    const toggle = element('label', 'ai-toggle admin-profile-toggle'),
      input = document.createElement('input'),
      state = element('strong', '', p.enabled ? 'Aktif' : 'Nonaktif');
    input.type = 'checkbox';
    input.checked = p.enabled;
    input.setAttribute('aria-label', p.name + ' aktif untuk klien');
    input.onchange = () =>
      run(async () => {
        const enabled = input.checked;
        if (
          !enabled &&
          !confirm(
            'Nonaktifkan ' +
              p.name +
              '? AI berhenti membalas di ' +
              p.sessions +
              ' sesi yang memakainya. Data profil klien tidak dihapus.',
          )
        ) {
          input.checked = true;
          return;
        }
        input.disabled = true;
        try {
          await api('/api/admin/ai/profiles/' + encodeURIComponent(p.id), 'PUT', { enabled });
          $('message').textContent = p.name + (enabled ? ' diaktifkan untuk klien.' : ' dinonaktifkan.');
        } finally {
          await loadAdminProfiles();
        }
      });
    toggle.append(input, element('span'), state);
    const studio = element('a', 'button secondary', 'Buka di AI Studio');
    studio.href = '/dashboard/admin/ai-studio?profile=' + encodeURIComponent(p.id);
    studio.dataset.studio = '';
    return [name, flow, usage, toggle, studio];
  });
}
async function loadFailures(page = failuresPage) {
  if (failuresLoading) return;
  failuresLoading = true;
  $('ai-failures-prev').disabled = $('ai-failures-next').disabled = true;
  try {
    const result = await api('/api/admin/ai/failures?page=' + page);
    failuresPage = result.page;
    table(
      'ai-failures',
      ['Waktu', 'Akun', 'Sesi', 'Agent', 'Model', 'Error', 'Pesan pelanggan', 'Tindakan'],
      result.items,
      r => [
        new Date(r.created_at).toLocaleString('id-ID'),
        r.account_id,
        r.session_id,
        r.agent || '—',
        r.model || '—',
        r.error,
        r.message,
        button('Detail', async () => {
          const detail = await api('/api/admin/ai/failures/' + r.id);
          $('failure-detail-context').textContent = detail.router_context || 'Tidak ada (percakapan baru).';
          $('failure-detail-prompt').textContent = detail.prompt
            ? JSON.stringify(detail.prompt, null, 2)
            : 'Tidak tersedia.';
          $('failure-detail-raw').textContent = detail.raw_output || 'Tidak tersedia.';
          $('failure-detail-dialog').showModal();
        }),
      ],
    );
    $('ai-failures-page').textContent =
      'Halaman ' + result.page + ' dari ' + result.pages + ' · ' + result.total + ' kegagalan';
    $('ai-failures-prev').disabled = result.page <= 1;
    $('ai-failures-next').disabled = result.page >= result.pages;
  } catch (error) {
    $('ai-failures-prev').disabled = failuresPage <= 1;
    $('ai-failures-next').disabled = false;
    throw error;
  } finally {
    failuresLoading = false;
  }
}
$('ai-failures-prev').onclick = () => run(() => loadFailures(failuresPage - 1));
$('ai-failures-next').onclick = () => run(() => loadFailures(failuresPage + 1));
let tracePage = 1,
  traceLoading = false;
async function loadTraceRequests(page = tracePage) {
  if (traceLoading) return;
  traceLoading = true;
  $('ai-trace-prev').disabled = $('ai-trace-next').disabled = true;
  try {
    const result = await api('/api/admin/ai/trace?page=' + page);
    tracePage = result.page;
    table('ai-trace-requests', ['Waktu mulai', 'Akun', 'Sesi', 'Jumlah langkah', 'Tindakan'], result.items, r => [
      new Date(r.started_at).toLocaleString('id-ID'),
      r.account_id,
      r.session_id,
      r.event_count,
      button('Lihat jejak', async () => {
        const events = await api('/api/admin/ai/trace/' + encodeURIComponent(r.request_id));
        $('trace-detail-events').replaceChildren(
          ...events.map(e => {
            const box = document.createElement('div');
            box.className = 'trace-event';
            const summary = document.createElement('p');
            summary.innerHTML = `<strong>${e.node}</strong> · ${e.state}${e.model ? ' · ' + e.model : ''}${e.attempt ? ' · percobaan ' + e.attempt : ''}${e.duration_ms != null ? ' · ' + e.duration_ms + ' ms' : ''} · ${new Date(e.created_at).toLocaleString('id-ID')}`;
            box.append(summary);
            if (e.error) {
              const err = document.createElement('p');
              err.className = 'trace-error';
              err.textContent = 'Error: ' + e.error;
              box.append(err);
            }
            if (e.input != null) {
              const pre = document.createElement('pre');
              pre.textContent = 'Input: ' + (typeof e.input === 'string' ? e.input : JSON.stringify(e.input, null, 2));
              box.append(pre);
            }
            if (e.output != null) {
              const pre = document.createElement('pre');
              pre.textContent =
                'Output: ' + (typeof e.output === 'string' ? e.output : JSON.stringify(e.output, null, 2));
              box.append(pre);
            }
            return box;
          }),
        );
        $('trace-detail-dialog').showModal();
      }),
    ]);
    $('ai-trace-page').textContent =
      'Halaman ' + result.page + ' dari ' + result.pages + ' · ' + result.total + ' proses';
    $('ai-trace-prev').disabled = result.page <= 1;
    $('ai-trace-next').disabled = result.page >= result.pages;
  } catch (error) {
    $('ai-trace-prev').disabled = tracePage <= 1;
    $('ai-trace-next').disabled = false;
    throw error;
  } finally {
    traceLoading = false;
  }
}
$('ai-trace-prev').onclick = () => run(() => loadTraceRequests(tracePage - 1));
$('ai-trace-next').onclick = () => run(() => loadTraceRequests(tracePage + 1));
let aiAdjustment;
form('ai-adjust', async data => {
  const payload = JSON.stringify(data);
  if (!aiAdjustment || aiAdjustment.payload !== payload) aiAdjustment = { payload, id: crypto.randomUUID() };
  const result = await api('/api/admin/accounts/' + encodeURIComponent(data.accountId) + '/ai-credits', 'POST', {
    amount: Number(data.amount),
    reason: data.reason,
    requestId: aiAdjustment.id,
  });
  aiAdjustment = undefined;
  $('message').textContent = `Penyesuaian AI tersimpan. Saldo: ${result.balance} kredit AI.`;
});
