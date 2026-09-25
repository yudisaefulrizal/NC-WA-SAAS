// Asisten AI, CS Usaha: tabel produk dan pesanan, tiket fallback, dan dialog produk/pesanan.
async function loadAIData(generation = assistantLoad) {
  const target = aiTarget();
  if (!target) return;
  const base = dataBase();
  const [products, orders] = await Promise.all([api(base + '/products'), api(base + '/orders')]);
  if (generation !== assistantLoad || target !== aiTarget()) return;
  table(
    'ai-products',
    ['Foto', 'Nama', 'Jenis', 'Deskripsi', 'Harga', 'Stok/kapasitas', 'Status', 'Tindakan'],
    products,
    p => {
      let photo = '—';
      if (p.image_id) {
        photo = document.createElement('img');
        photo.src = productImageUrl(p.image_id);
        photo.alt = 'Foto ' + p.name;
        photo.width = 48;
        photo.height = 48;
        photo.className = 'ai-product-thumb';
      }
      return [
        photo,
        p.name,
        p.type === 'service' ? 'Layanan' : 'Produk',
        p.description,
        money(p.price),
        p.stock,
        p.active ? 'Aktif' : 'Nonaktif',
        button('Edit', () => openProduct(p)),
      ];
    },
  );
  $('ai-product-codes').replaceChildren(...products.filter(p => p.active).map(p => new Option(p.name)));
  // Tombol berupa ikon menjaga tabel pesanan tetap sempit; aria-label/title membawa namanya untuk pembaca layar dan
  // tooltip.
  const actionIcons = {
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    delete: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>',
  };
  function iconButton(kind, label, action) {
    const b = button('', action);
    b.classList.add('table-icon-button', kind === 'delete' ? 'danger' : 'secondary');
    b.setAttribute('aria-label', label);
    b.title = label;
    b.innerHTML =
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      actionIcons[kind] +
      '</svg>';
    return b;
  }
  function orderActions(o) {
    const actions = document.createElement('div');
    actions.className = 'row-actions table-actions';
    actions.append(
      iconButton('edit', 'Edit pesanan ' + o.id, () => {
        const f = $('ai-order-edit-form');
        f.elements.id.value = o.id;
        f.elements.status.value = o.status;
        f.elements.notes.value = o.notes;
        $('ai-order-detail').textContent =
          o.customer +
          ' · ' +
          o.items.map(i => (i.product_name ?? i.name) + ' × ' + i.quantity + ' @ ' + money(i.price)).join(', ');
        $('ai-order-edit-dialog').showModal();
      }),
      iconButton('delete', 'Hapus pesanan ' + o.id, async () => {
        if (!confirm('Hapus pesanan ' + o.id + '? Tindakan ini tidak dapat dibatalkan.')) return;
        await api(dataBase() + '/orders/' + encodeURIComponent(o.id), 'DELETE');
        await loadAIData();
        $('message').textContent = 'Pesanan dihapus.';
      }),
    );
    return actions;
  }
  // Nama tampilan untuk nilai tersimpan/API pesanan_masuk, dibayar, diproses, selesai, dibatalkan.
  const orderStatusLabels = {
    pesanan_masuk: 'Pesanan masuk',
    dibayar: 'Dibayar',
    diproses: 'Diproses',
    selesai: 'Selesai',
    dibatalkan: 'Dibatalkan',
  };
  // Sesi yang berbagi data profil mengumpulkan pesanan bersama; kolom Sesi menunjukkan asal tiap pesanan.
  table('ai-orders', ['ID', 'Pelanggan', 'Sesi', 'Item', 'Total', 'Status', 'Tindakan'], orders, o => [
    o.id,
    o.customer,
    o.session_id || 'Data Profil',
    o.items.map(i => (i.product_name ?? i.name) + ' × ' + i.quantity).join(', '),
    money(o.total),
    orderStatusLabels[o.status] ?? o.status,
    orderActions(o),
  ]);
  if (aiView === 'sessions') await loadFallbacks('/sessions/' + encodeURIComponent($('ai-session').value) + '/ai');
  else $('ai-fallbacks').replaceChildren();
}
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
      if (row.status === 'resolved') {
        actions.append(button('Ke Knowledge', () => fallbackKnowledge(base, row)));
        if (aiTargetType() === 'cs') actions.append(button('Tambah produk', () => fallbackProduct(row)));
      }
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
        actions.childElementCount ? actions : '—',
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
async function fallbackKnowledge(base, row) {
  const draft = 'Pertanyaan: ' + row.question + '\nJawaban: ' + (row.staff_answer || '');
  const content = prompt('Periksa dan edit Knowledge sebelum diterapkan:', draft);
  if (!content?.trim()) return;
  await api(base + '/fallbacks/' + encodeURIComponent(row.id) + '/knowledge', 'POST', { content });
  await loadAssistant();
  $('message').textContent = 'Knowledge dari tiket fallback diterapkan.';
}
function fallbackProduct(row) {
  const f = $('ai-product-form');
  f.reset();
  f.elements.description.value = (
    'Referensi pertanyaan pelanggan: ' +
    row.question +
    '\nKonfirmasi tim: ' +
    (row.staff_answer || '')
  ).slice(0, 500);
  f.elements.active.checked = true;
  $('ai-product-dialog').showModal();
}
function aiDataForm(id, action) {
  form(id, async data => {
    let error = $(id).querySelector('.form-error');
    if (!error) {
      error = document.createElement('p');
      error.className = 'form-error';
      error.setAttribute('role', 'alert');
      $(id).prepend(error);
    }
    error.textContent = '';
    try {
      await action(data);
    } catch (e) {
      error.textContent = e.message;
      throw e;
    }
  });
}
let editingProductName,
  currentImageId = null;
function productImageUrl(imageId) {
  return dataBase() + '/products-image/' + encodeURIComponent(imageId);
}
function showProductImage(imageId) {
  currentImageId = imageId;
  const preview = $('ai-product-image-preview'),
    remove = $('ai-product-image-remove');
  if (imageId) {
    preview.src = productImageUrl(imageId);
    preview.hidden = false;
    remove.hidden = false;
  } else {
    preview.hidden = true;
    remove.hidden = true;
  }
}
function openProduct(product) {
  const f = $('ai-product-form');
  f.reset();
  editingProductName = product ? product.name : '';
  if (product)
    for (const key of ['name', 'type', 'description', 'price', 'stock']) f.elements[key].value = product[key];
  f.elements.active.checked = product ? product.active : true;
  $('ai-product-image-input').value = '';
  $('ai-product-image-status').textContent = '';
  showProductImage(product?.image_id ?? null);
  $('ai-product-dialog').showModal();
}
$('ai-product-add').onclick = () => openProduct();
$('ai-product-image-input').onchange = () =>
  run(async () => {
    const file = $('ai-product-image-input').files[0];
    if (!file) return;
    const status = $('ai-product-image-status');
    status.textContent = 'Mengunggah…';
    const response = await fetch(dataBase() + '/products-image', {
      method: 'POST',
      headers: { 'X-Filename': file.name },
      body: file,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      status.textContent = data.message || 'Gagal mengunggah foto.';
      return;
    }
    status.textContent = 'Foto tersimpan.';
    showProductImage(data.id);
  });
$('ai-product-image-remove').onclick = () => {
  showProductImage(null);
  $('ai-product-image-input').value = '';
  $('ai-product-image-status').textContent = 'Foto akan dihapus saat produk disimpan.';
};
aiDataForm('ai-product-form', async data => {
  const base = dataBase(),
    payload = {
      ...data,
      price: Number(data.price),
      stock: Number(data.stock),
      active: data.active === 'on',
      image_id: currentImageId,
    };
  if (editingProductName) await api(base + '/products/' + encodeURIComponent(editingProductName), 'PUT', payload);
  else await api(base + '/products', 'POST', payload);
  $('ai-product-dialog').close();
  await loadAIData();
  $('message').textContent = 'Produk tersimpan.';
});
let orderRequest;
$('ai-order-add').onclick = () => {
  $('ai-order-form').reset();
  orderRequest = undefined;
  $('ai-order-dialog').showModal();
};
aiDataForm('ai-order-form', async data => {
  const base = dataBase(),
    payload = {
      customer: data.customer,
      items: [{ product_name: data.product_name, quantity: Number(data.quantity) }],
      notes: data.notes,
    };
  const signature = JSON.stringify([base, payload]);
  if (!orderRequest || orderRequest.signature !== signature) orderRequest = { signature, key: crypto.randomUUID() };
  await api(base + '/orders', 'POST', payload, { 'Idempotency-Key': orderRequest.key });
  $('ai-order-dialog').close();
  orderRequest = undefined;
  await loadAIData();
  $('message').textContent = 'Pesanan tercatat untuk diproses.';
});
aiDataForm('ai-order-edit-form', async data => {
  await api(dataBase() + '/orders/' + encodeURIComponent(data.id), 'PUT', { status: data.status, notes: data.notes });
  $('ai-order-edit-dialog').close();
  await loadAIData();
  $('message').textContent = 'Pesanan diperbarui.';
});
