// Kanvas graf: node, sambungan port, drag, zoom, peta mini, popover Tambah node, dan riwayat perubahan tanpa
// pustaka eksternal.
const viewport = $('viewport');
const nodeWidth = 236;
function transform() {
  $('world').style.transform = `translate(${state.pan.x}px,${state.pan.y}px) scale(${state.zoom})`;
  $('fit').textContent = Math.round(state.zoom * 100) + '%';
  renderMinimap();
}
function position(e) {
  const box = viewport.getBoundingClientRect();
  return { x: (e.clientX - box.left - state.pan.x) / state.zoom, y: (e.clientY - box.top - state.pan.y) / state.zoom };
}
function selectNode(id) {
  state.selected = id;
  renderCanvas();
  renderInspector();
}
const nodeElement = id => $('nodes').querySelector(`[data-node="${CSS.escape(id)}"]`);
function nodeSummary(n) {
  const tier = tierLabels[n.tier] ?? n.tier,
    memory = (n.context_memory ? ' · Konteks' : '') + (n.memory ? ' · Riwayat' : '');
  switch (n.type) {
    case 'input':
      return 'Pesan pelanggan';
    case 'memory':
      return (
        (n.memory_limit ?? 20) + ' pesan · ' + state.document.nodes.filter(x => x.memory === n.id).length + ' node'
      );
    case 'context_memory':
      return 'Ringkasan S-P-O · ' + state.document.nodes.filter(x => x.context_memory === n.id).length + ' node';
    case 'router':
      return tier + ' · ' + n.branches.length + ' cabang' + memory;
    case 'agent':
      return tier + ' · ' + n.tools.length + ' tool' + memory;
    case 'context':
      return tier + ' · ' + (n.context_format === 'spo' ? 'S-P-O' : 'Ringkasan');
    case 'extract':
      return (n.fields ?? []).length + ' field · ' + tier;
    case 'condition':
      return (n.rules ?? []).length + ' syarat · cocok ' + (n.match === 'any' ? 'salah satu' : 'semua');
    case 'compute':
      return (n.steps ?? []).length + ' langkah';
    case 'data_table':
    case 'data_text':
    case 'data_form': {
      const c = state.document.collections.find(c => c.id === n.collection);
      const byAgent = state.document.nodes.some(a => a.type === 'agent' && a.tools.includes(n.id));
      const what =
        n.type === 'data_text'
          ? (n.max_chars ?? 4000).toLocaleString('id-ID') + ' kar.'
          : n.type === 'data_form'
            ? n.operation === 'update'
              ? 'Ubah'
              : 'Baca'
            : operationLabel(n.operation);
      return (c?.name ?? 'pilih koleksi') + ' · ' + what + (byAgent ? ' · via Agent' : '');
    }
    case 'media':
      return n.send_when === 'after' ? 'Sesudah jawaban' : 'Sebelum jawaban';
    case 'receive':
      return (n.accept ?? []).map(t => (t === 'image' ? 'Gambar' : 'Dokumen')).join(', ') || 'Tidak ada jenis';
    case 'file_json':
    case 'file_md':
      return (n.filename?.trim() || n.label) + (n.type === 'file_json' ? '.json' : '.md');
    case 'output':
      return 'Kirim jawaban';
    default:
      return 'Teruskan ke manusia';
  }
}
function renderCanvas() {
  if (!state.document) return;
  const picker = field('Pilih node', state.selected || '', id => selectNode(id), 'select', [
    { value: '', label: 'Pilih node untuk diatur' },
    ...state.document.nodes.map(n => ({ value: n.id, label: n.label })),
  ]);
  $('node-picker').replaceChildren(picker);
  const host = $('nodes'),
    svg = $('connections'),
    tracing = Object.keys(state.traceSteps).length > 0;
  host.replaceChildren();
  svg.replaceChildren();
  svg.classList.toggle('tracing', tracing);
  for (const n of state.document.nodes) {
    const issue = state.issues.find(i => i.node === n.id),
      run = state.trace[n.id],
      box = el(
        'div',
        undefined,
        'graph-node' +
          (state.selected === n.id ? ' selected' : '') +
          (issue ? ' has-issue' : '') +
          (run ? ' ' + run : '') +
          (tracing && !run ? ' dim' : ''),
      );
    box.dataset.node = n.id;
    box.dataset.type = n.type;
    box.style.left = n.x + 'px';
    box.style.top = n.y + 'px';
    if (state.traceSteps[n.id]) box.append(el('span', state.traceSteps[n.id], 'step-badge'));
    const heading = el('div', undefined, 'node-heading');
    // Ilustrasi menjelaskan jenis node, jadi tulisan jenisnya tidak ditampilkan; judul atribut tetap menyebutnya.
    const text = el('div', undefined, 'node-text');
    text.append(el('span', n.label, 'node-title'), el('div', issue ? issue.message : nodeSummary(n), 'node-meta'));
    heading.append(nodeIcon(n.type), text);
    heading.title = kinds[n.type][0];
    if (issue) {
      const mark = svgIcon('alert');
      mark.classList.add('node-issue');
      heading.append(mark);
    }
    heading.tabIndex = 0;
    heading.setAttribute('role', 'button');
    heading.setAttribute('aria-label', 'Atur ' + n.label);
    heading.onkeydown = e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        showSide('inspector');
        selectNode(n.id);
      }
    };
    heading.onpointerdown = e => startDrag(e, n);
    box.append(heading);
    if (!['input', 'memory', 'context_memory'].includes(n.type)) {
      const p = el('button', undefined, 'port input-port');
      p.type = 'button';
      p.title = 'Masuk: ' + n.label;
      p.setAttribute('aria-label', p.title);
      p.dataset.target = n.id;
      p.onclick = e => {
        e.stopPropagation();
        connect(n.id);
      };
      p.onpointerup = () => {
        if (state.pending) connect(n.id);
      };
      box.append(p);
    }
    const rows = el('div', undefined, 'port-rows');
    const sharePort = { memory: 'memory', context_memory: 'context_memory' }[n.type];
    for (const port of sharePort ? [sharePort] : nodePorts(n)) {
      const taken =
          tracing &&
          state.document.edges.some(e => e.source === n.id && e.port === port && state.trace[e.target] && run),
        row = el(
          'div',
          port === 'memory' ? 'Bagikan riwayat' : port === 'context_memory' ? 'Bagikan konteks' : portLabel(n, port),
          'port-row' + (port === 'fallback' ? ' fallback' : '') + (taken ? ' taken-path' : ''),
        ),
        p = el(
          'button',
          undefined,
          'port' +
            (port === 'memory' ? ' memory-port' : '') +
            (port === 'context_memory' ? ' context-port' : '') +
            (port === 'fallback' ? ' fallback-port' : '') +
            (state.pending?.source === n.id && state.pending?.port === port ? ' pending' : ''),
        );
      p.type = 'button';
      p.title =
        n.label + ': ' + (port === 'memory' ? 'riwayat' : port === 'context_memory' ? 'konteks' : portLabel(n, port));
      p.setAttribute('aria-label', 'Hubungkan ' + p.title);
      p.dataset.source = n.id;
      p.dataset.port = port;
      p.onpointerdown = e => {
        e.stopPropagation();
        state.pending = { source: n.id, port };
        $('connection-hint').textContent = 'Lepas di port masuk node tujuan. Escape untuk batal.';
      };
      p.onclick = e => {
        e.stopPropagation();
        state.pending = { source: n.id, port };
        $('connection-hint').textContent = 'Klik port masuk node tujuan. Escape untuk batal.';
        renderCanvas();
      };
      row.append(p);
      rows.append(row);
    }
    // Node AI punya dua port memori: konteks (ringkasan; Context menulis ke sana) dan riwayat.
    if (memoryConsumers.includes(n.type))
      for (const [connection, on, off, className, label] of [
        [
          'context',
          n.type === 'context' ? 'Tulis konteks' : 'Konteks terhubung',
          'Tanpa konteks',
          'context-port context-input',
          'Konteks',
        ],
        ['memory', 'Riwayat terhubung', 'Tanpa riwayat', 'memory-port memory-input', 'Riwayat'],
      ]) {
        const linked = connection === 'context' ? n.context_memory : n.memory;
        const row = el('div', linked ? on : off, 'port-row memory-row');
        const p = el('button', undefined, 'port ' + className);
        p.type = 'button';
        p.dataset.target = n.id;
        p.dataset.connection = connection;
        p.setAttribute('aria-label', label + ': ' + n.label);
        p.onclick = e => {
          e.stopPropagation();
          connect(n.id, connection);
        };
        p.onpointerup = () => {
          if (state.pending) connect(n.id, connection);
        };
        row.prepend(p);
        rows.append(row);
      }
    if (rows.childElementCount) box.append(rows);
    host.append(box);
  }
  // Titik sambung diukur dari DOM setelah node tampil, jadi tinggi node boleh berbeda-beda.
  const anchor = (n, selector) => {
    const p = nodeElement(n.id)?.querySelector(selector);
    return p && { x: n.x + p.offsetLeft + p.offsetWidth / 2, y: n.y + p.offsetTop + p.offsetHeight / 2 };
  };
  const find = id => state.document.nodes.find(n => n.id === id);
  for (const edge of state.document.edges) {
    const source = find(edge.source),
      target = find(edge.target);
    if (!source || !target) continue;
    const from = anchor(source, `[data-source="${CSS.escape(source.id)}"][data-port="${CSS.escape(edge.port)}"]`),
      to = anchor(target, '.input-port');
    if (!from || !to) continue;
    const onPath = tracing && state.trace[source.id] && state.trace[target.id];
    const path = drawPath(svg, from.x, from.y, to.x, to.y, () => {
      if (confirm('Hapus koneksi ini?'))
        mutate(() => (state.document.edges = state.document.edges.filter(e => e.id !== edge.id)));
    });
    if (edge.port === 'fallback') path.classList.add('fallback-link');
    if ([source.id, target.id].includes(state.selected)) path.classList.add('active');
    if (onPath) path.classList.add('on-path');
    if (onPath && state.trace[target.id] === 'error') path.classList.add('failed');
  }
  for (const n of state.document.nodes.filter(n => n.memory)) {
    const m = find(n.memory);
    if (m?.type !== 'memory') continue;
    const from = anchor(m, '[data-port="memory"]'),
      to = anchor(n, '.memory-input');
    if (!from || !to) continue;
    const path = drawPath(svg, from.x, from.y, to.x, to.y, () => {
      if (confirm('Putuskan memori dari ' + n.label + '?')) {
        mutate(() => (n.memory = ''));
        renderInspector();
      }
    });
    path.classList.add('memory-link');
    if ([m.id, n.id].includes(state.selected)) path.classList.add('active');
    path.dataset.memoryConnection = m.id + ':' + n.id;
  }
  // Garis konteks: putus-putus untuk node yang membaca, tebal untuk Context yang menulis.
  for (const n of state.document.nodes.filter(n => n.context_memory)) {
    const m = find(n.context_memory);
    if (m?.type !== 'context_memory') continue;
    const from = anchor(m, '[data-port="context_memory"]'),
      to = anchor(n, '.context-input');
    if (!from || !to) continue;
    const path = drawPath(svg, from.x, from.y, to.x, to.y, () => {
      if (confirm('Putuskan memori konteks dari ' + n.label + '?')) {
        mutate(() => (n.context_memory = ''));
        renderInspector();
      }
    });
    path.classList.add(n.type === 'context' ? 'context-write' : 'context-link');
    if ([m.id, n.id].includes(state.selected)) path.classList.add('active');
    path.dataset.contextConnection = m.id + ':' + n.id;
  }
  for (const n of state.document.nodes.filter(n => n.type === 'agent'))
    for (const id of n.tools) {
      const t = find(id),
        a = nodeElement(n.id),
        b = t && nodeElement(t.id);
      if (!t || !a || !b) continue;
      const below = t.y > n.y;
      const path = drawPath(
        svg,
        n.x + nodeWidth / 2,
        below ? n.y + a.offsetHeight : n.y,
        t.x + nodeWidth / 2,
        below ? t.y : t.y + b.offsetHeight,
        undefined,
        true,
      );
      if ([n.id, t.id].includes(state.selected)) path.classList.add('active');
      if (tracing && state.trace[n.id] && state.trace[t.id]) path.classList.add('on-path');
    }
  transform();
}
function drawPath(svg, x1, y1, x2, y2, click, attachment = false) {
  const make = () => document.createElementNS('http://www.w3.org/2000/svg', 'path');
  const offset = Math.max(40, Math.abs(x2 - x1) / 2);
  const d = attachment
    ? `M${x1},${y1} C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2}`
    : `M${x1},${y1} C${x1 + offset},${y1} ${x2 - offset},${y2} ${x2},${y2}`;
  const path = make();
  path.setAttribute('d', d);
  if (attachment) path.classList.add('attachment');
  if (click) {
    // Garis tak terlihat yang lebih tebal memudahkan klik pada koneksi tipis.
    const hit = make();
    hit.setAttribute('d', d);
    hit.classList.add('hit');
    hit.onclick = () => task(click);
    svg.append(hit);
    path.onclick = () => task(click);
  }
  svg.append(path);
  return path;
}
function connect(target, connection = 'flow') {
  if (!state.pending) return;
  const { source, port } = state.pending;
  if (port === 'context_memory' || connection === 'context') {
    if (port !== 'context_memory' || connection !== 'context') {
      notice('Hubungkan port Memori konteks ke port Konteks pada node tujuan.');
      return;
    }
    attachMemory(source, target, 'context_memory');
    state.pending = null;
    renderCanvas();
    return;
  }
  if (port === 'memory' || connection === 'memory') {
    if (port !== 'memory' || connection !== 'memory') {
      notice('Hubungkan port Memori percakapan ke port Riwayat pada node tujuan.');
      return;
    }
    attachMemory(source, target);
    state.pending = null;
    renderCanvas();
    return;
  }
  if (['memory', 'context_memory'].includes(state.document.nodes.find(n => n.id === target)?.type)) {
    notice('Memori memakai sambungan terpisah, bukan jalur alur.');
    return;
  }
  if (source === target) {
    notice('Node tidak bisa dihubungkan ke dirinya sendiri.');
    return;
  }
  const seen = new Set();
  function reaches(id) {
    if (id === source) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return state.document.edges.some(e => e.source === id && reaches(e.target));
  }
  if (reaches(target)) {
    notice('Koneksi membentuk siklus. Pilih node berikutnya.');
    return;
  }
  mutate(() => {
    state.document.edges = state.document.edges.filter(e => !(e.source === source && e.port === port));
    state.document.edges.push({ id: uid('edge'), source, port, target });
  });
  state.pending = null;
  $('connection-hint').textContent = '';
  renderCanvas();
  renderInspector();
}
function attachMemory(source, target, key = 'memory') {
  const m = state.document.nodes.find(n => n.id === source),
    n = state.document.nodes.find(n => n.id === target);
  if (m?.type !== (key === 'memory' ? 'memory' : 'context_memory') || !n || !memoryConsumers.includes(n.type)) {
    notice('Memori dapat dipasang pada Router, Agent, Context, atau Ekstrak.');
    return;
  }
  mutate(() => (n[key] = source));
  renderInspector();
  $('connection-hint').textContent = '';
}
let drag;
function startDrag(e, n) {
  if (e.button !== 0) return;
  e.preventDefault();
  closePalette();
  showSide('inspector');
  state.selected = n.id;
  checkpoint();
  const p = position(e);
  drag = { kind: 'node', node: n, x: p.x, y: p.y, ox: n.x, oy: n.y, moved: false };
  renderCanvas();
  renderInspector();
}
viewport.onpointerdown = e => {
  if (e.button !== 0 || e.target.closest('button,input,.graph-node,.canvas-controls,.palette,#minimap,path')) return;
  closePalette();
  if (state.pending) {
    state.pending = null;
    $('connection-hint').textContent = '';
    renderCanvas();
  }
  drag = { kind: 'pan', x: e.clientX, y: e.clientY, ox: state.pan.x, oy: state.pan.y };
  viewport.setPointerCapture(e.pointerId);
};
window.addEventListener('pointermove', e => {
  if (!drag) return;
  if (drag.kind === 'pan') {
    state.pan.x = drag.ox + e.clientX - drag.x;
    state.pan.y = drag.oy + e.clientY - drag.y;
    transform();
  } else {
    const p = position(e);
    const x = Math.max(0, Math.min(3800, Math.round((drag.ox + p.x - drag.x) / 10) * 10));
    const y = Math.max(0, Math.min(3800, Math.round((drag.oy + p.y - drag.y) / 10) * 10));
    if (x === drag.node.x && y === drag.node.y) return;
    drag.node.x = x;
    drag.node.y = y;
    drag.moved = true;
    changed();
    renderCanvas();
  }
});
window.addEventListener('pointerup', e => {
  // Klik tanpa geser tidak dihitung sebagai perubahan, jadi titik urung yang dibuat saat mulai drag dibuang.
  if (drag?.kind === 'node' && !drag.moved) {
    state.undo.pop();
    renderStatus();
  }
  drag = null;
  if (state.pending) {
    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-target]');
    if (target) connect(target.dataset.target, target.dataset.connection ?? 'flow');
  }
});
viewport.onwheel = e => {
  if (e.target.closest('.palette')) return;
  e.preventDefault();
  const p = position(e),
    box = viewport.getBoundingClientRect();
  state.zoom = Math.max(0.25, Math.min(1.6, state.zoom * (e.deltaY > 0 ? 0.9 : 1.1)));
  state.pan.x = e.clientX - box.left - p.x * state.zoom;
  state.pan.y = e.clientY - box.top - p.y * state.zoom;
  transform();
};
viewport.ondragover = e => e.preventDefault();
viewport.ondrop = e => {
  e.preventDefault();
  const type = e.dataTransfer.getData('text/plain');
  if (!kinds[type]) return;
  const p = position(e);
  addNode(type, p.x - nodeWidth / 2, p.y - 20);
  closePalette();
};
// Node baru tidak boleh menutupi node lain; geser ke bawah sampai menemukan tempat kosong.
function freeSpot(x, y) {
  const taken = (px, py) => state.document.nodes.some(n => Math.abs(n.x - px) < 230 && Math.abs(n.y - py) < 130);
  for (let i = 0; i < 20 && taken(x, y); i++) y += 140;
  return { x: Math.round(x / 10) * 10, y: Math.round(y / 10) * 10 };
}
function addNode(type, x, y) {
  const spot = freeSpot(Math.max(0, x), Math.max(0, y));
  const n = newNode(type, spot.x, spot.y);
  mutate(() => state.document.nodes.push(n));
  showSide('inspector');
  selectNode(n.id);
}
function addAtCenter(type) {
  addNode(
    type,
    Math.max(30, (viewport.clientWidth / 2 - state.pan.x) / state.zoom - nodeWidth / 2),
    Math.max(30, (viewport.clientHeight / 2 - state.pan.y) / state.zoom - 40),
  );
  closePalette();
}

// Popover Tambah node: dikelompokkan per kategori, bisa dicari, dipilih dengan panah, atau ditarik ke kanvas.
let paletteActive = 0;
for (const [group, types] of paletteGroups) {
  const heading = el('div', group, 'palette-group');
  heading.dataset.group = group;
  $('node-types').append(heading);
  for (const type of types) {
    const [label, description] = kinds[type];
    const b = el('button', undefined, 'palette-item');
    b.type = 'button';
    b.append(nodeIcon(type), el('span', label, 'name'), el('span', description, 'desc'));
    b.setAttribute('aria-label', label);
    b.dataset.kind = type;
    b.dataset.group = group;
    b.draggable = true;
    b.onclick = () => addAtCenter(type);
    b.ondragstart = e => e.dataTransfer.setData('text/plain', type);
    $('node-types').append(b);
  }
}
$('node-types').append(el('div', 'Tidak ada node yang cocok.', 'palette-empty'));
const paletteItems = () => [...$('node-types').querySelectorAll('.palette-item:not([hidden])')];
function filterPalette() {
  const q = $('node-search').value.trim().toLowerCase();
  for (const item of $('node-types').querySelectorAll('.palette-item')) {
    const [label, description, , words] = kinds[item.dataset.kind];
    item.hidden = Boolean(q) && !(label + ' ' + description + ' ' + words).toLowerCase().includes(q);
  }
  for (const heading of $('node-types').querySelectorAll('.palette-group'))
    heading.hidden = !$('node-types').querySelector(
      `.palette-item[data-group="${heading.dataset.group}"]:not([hidden])`,
    );
  $('node-types').querySelector('.palette-empty').hidden = paletteItems().length > 0;
  paletteActive = 0;
  markPalette();
}
function markPalette() {
  for (const item of $('node-types').querySelectorAll('.palette-item.active')) item.classList.remove('active');
  paletteItems().forEach((item, i) => item.classList.toggle('active', i === paletteActive));
  paletteItems()[paletteActive]?.scrollIntoView({ block: 'nearest' });
}
function openPalette() {
  $('palette').hidden = false;
  $('add-node').setAttribute('aria-expanded', 'true');
  $('node-search').value = '';
  filterPalette();
  $('node-search').focus();
}
function closePalette() {
  if ($('palette').hidden) return;
  $('palette').hidden = true;
  $('add-node').setAttribute('aria-expanded', 'false');
}
$('add-node').onclick = () => ($('palette').hidden ? openPalette() : closePalette());
$('node-search').oninput = filterPalette;
$('node-search').onkeydown = e => {
  const items = paletteItems();
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    paletteActive = (paletteActive + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % Math.max(1, items.length);
    markPalette();
  } else if (e.key === 'Enter' && items[paletteActive]) {
    e.preventDefault();
    addAtCenter(items[paletteActive].dataset.kind);
  } else if (e.key === 'Escape') {
    e.stopPropagation();
    closePalette();
    $('add-node').focus();
  }
};

// Peta mini: seluruh node dan area yang sedang terlihat; klik untuk memindahkan tampilan.
let minimapFrame;
function renderMinimap() {
  if (!state.document || !viewport.clientWidth) return;
  const map = $('minimap'),
    view = {
      x: -state.pan.x / state.zoom,
      y: -state.pan.y / state.zoom,
      w: viewport.clientWidth / state.zoom,
      h: viewport.clientHeight / state.zoom,
    },
    boxes = state.document.nodes.map(n => ({ n, w: nodeWidth, h: nodeElement(n.id)?.offsetHeight || 80 })),
    minX = Math.min(view.x, ...boxes.map(b => b.n.x)),
    minY = Math.min(view.y, ...boxes.map(b => b.n.y)),
    maxX = Math.max(view.x + view.w, ...boxes.map(b => b.n.x + b.w)),
    maxY = Math.max(view.y + view.h, ...boxes.map(b => b.n.y + b.h)),
    scale = Math.min((map.clientWidth - 16) / (maxX - minX), (map.clientHeight - 16) / (maxY - minY)),
    place = (div, x, y, w, h) =>
      Object.assign(div.style, {
        left: 8 + (x - minX) * scale + 'px',
        top: 8 + (y - minY) * scale + 'px',
        width: Math.max(3, w * scale) + 'px',
        height: Math.max(2, h * scale) + 'px',
      });
  const colors = {
    ai: '#c9c1ef',
    logic: '#e8c58f',
    data: '#b8cbe6',
    media: '#e7bcd2',
    flow: '#b9c0ba',
    ctx: '#a8dcd3',
  };
  const parts = boxes.map(b => {
    const div = el('div');
    div.style.background = state.selected === b.n.id ? 'var(--accent)' : colors[nodeColor(b.n.type)];
    place(div, b.n.x, b.n.y, b.w, b.h);
    return div;
  });
  const frame = el('div', undefined, 'mini-view');
  place(frame, view.x, view.y, view.w, view.h);
  map.replaceChildren(...parts, frame);
  minimapFrame = { minX, minY, scale };
}
$('minimap').onclick = e => {
  if (!minimapFrame) return;
  const box = $('minimap').getBoundingClientRect(),
    x = minimapFrame.minX + (e.clientX - box.left - 8) / minimapFrame.scale,
    y = minimapFrame.minY + (e.clientY - box.top - 8) / minimapFrame.scale;
  state.pan.x = viewport.clientWidth / 2 - x * state.zoom;
  state.pan.y = viewport.clientHeight / 2 - y * state.zoom;
  transform();
};

function undo(redo = false) {
  const source = redo ? state.redo : state.undo,
    target = redo ? state.undo : state.redo;
  if (!source.length) return;
  target.push(snapshot());
  state.document = JSON.parse(source.pop());
  if (!state.document.nodes.some(n => n.id === state.selected)) state.selected = null;
  changed();
  renderAll();
}
$('undo').onclick = () => undo();
$('redo').onclick = () => undo(true);
$('zoom-in').onclick = () => {
  state.zoom = Math.min(1.6, state.zoom + 0.1);
  transform();
};
$('zoom-out').onclick = () => {
  state.zoom = Math.max(0.25, state.zoom - 0.1);
  transform();
};
function fitCanvas() {
  if (!state.document?.nodes.length) return;
  const ns = state.document.nodes,
    minX = Math.min(...ns.map(n => n.x)),
    minY = Math.min(...ns.map(n => n.y)),
    width = Math.max(...ns.map(n => n.x + nodeWidth)) - minX,
    height = Math.max(...ns.map(n => n.y + (nodeElement(n.id)?.offsetHeight || 90))) - minY;
  // Sisakan ruang untuk tombol Tambah node di atas dan kontrol zoom di bawah. Di layar sempit zoom tidak turun di bawah
  // 50% agar node tetap terbaca; tampilan dimulai dari sisi Input dan sisanya digeser.
  const narrow = viewport.clientWidth < 600,
    zoom = Math.min(1, (viewport.clientWidth - 80) / width, (viewport.clientHeight - 150) / height);
  state.zoom = Math.max(narrow ? 0.5 : 0.25, zoom);
  state.pan = {
    x:
      narrow && zoom < 0.5
        ? 16 - minX * state.zoom
        : (viewport.clientWidth - width * state.zoom) / 2 - minX * state.zoom,
    y: Math.max(64, 64 + (viewport.clientHeight - 140 - height * state.zoom) / 2) - minY * state.zoom,
  };
  transform();
}
$('fit').onclick = fitCanvas;
// Rapikan sesuai jenis node, dibaca kiri ke kanan: jalur utama berkolom menurut jarak dari Input dan berurutan
// mengikuti port sumbernya (cabang Router seperti kipas); node data yang hanya dipanggil Agent menjadi "laci" di kanan
// Agent-nya; Output dan Fallback di kolom paling kanan (Fallback di bawah); memori di rel atas, di atas node yang
// memakainya; node yang tidak tersambung dikumpulkan di kiri bawah. Setiap kolom diratakan tengah terhadap kolom
// tertinggi. Hasilnya selalu sama untuk graf yang sama dan bisa dibatalkan dengan Urungkan.
$('layout').onclick = () => {
  mutate(() => {
    const nodes = state.document.nodes,
      edges = state.document.edges,
      height = n => nodeElement(n.id)?.offsetHeight || 90,
      isMemory = n => n.type === 'memory' || n.type === 'context_memory',
      agentTool = n =>
        isDataNode(n) &&
        !edges.some(e => e.source === n.id || e.target === n.id) &&
        nodes.some(a => a.tools.includes(n.id)),
      step = nodeWidth + 44,
      gap = 40,
      levels = new Map(),
      input = nodes.find(n => n.type === 'input'),
      queue = input ? [{ id: input.id, level: 0 }] : [];
    let guard = 0;
    while (queue.length && guard++ < 500) {
      const { id, level } = queue.shift();
      if ((levels.get(id) ?? -1) >= level) continue;
      levels.set(id, level);
      for (const e of edges.filter(e => e.source === id)) queue.push({ id: e.target, level: level + 1 });
    }
    const main = nodes.filter(n => !isMemory(n) && !agentTool(n)),
      loose = main.filter(n => !levels.has(n.id) && !edges.some(e => e.source === n.id || e.target === n.id)),
      flow = main.filter(n => !loose.includes(n));
    for (const n of flow) if (!levels.has(n.id)) levels.set(n.id, 0);
    const last =
      Math.max(0, ...flow.filter(n => !['output', 'fallback'].includes(n.type)).map(n => levels.get(n.id))) + 1;
    for (const n of flow) if (['output', 'fallback'].includes(n.type)) levels.set(n.id, last);
    const columns = new Map();
    for (const n of flow) columns.set(levels.get(n.id), [...(columns.get(levels.get(n.id)) ?? []), n]);
    // Laci data: node data yang dipakai satu Agent menempel di kanan Agent itu; yang dipakai beberapa Agent diletakkan
    // di laci Agent pertama, setinggi rata-rata pemakainya.
    const users = t => flow.filter(n => n.tools.includes(t.id)),
      tools = nodes.filter(t => agentTool(t) && users(t).length),
      drawer = new Map(flow.map(n => [n.id, tools.filter(t => users(t).length === 1 && users(t)[0] === n)])),
      shared = tools.filter(t => users(t).length > 1),
      rank = new Map(),
      order = [],
      columnX = new Map();
    let x = 60;
    for (const level of [...columns.keys()].sort((a, b) => a - b)) {
      // Urutan dalam kolom mengikuti urutan sumber di kolom sebelumnya lalu urutan port; Fallback paling bawah.
      const key = n => {
        const keys = edges
          .filter(e => e.target === n.id && rank.has(e.source))
          .map(e => {
            const source = nodes.find(x => x.id === e.source);
            return rank.get(e.source) * 100 + Math.max(0, nodePorts(source).indexOf(e.port));
          });
        return (n.type === 'fallback' ? 1e6 : 0) + (keys.length ? Math.min(...keys) : 0);
      };
      const column = columns.get(level).sort((a, b) => key(a) - key(b) || a.id.localeCompare(b.id));
      column.forEach((n, index) => rank.set(n.id, index));
      order.push(column);
      for (const n of column) n.x = x;
      columnX.set(level, x);
      const wide = column.some(n => drawer.get(n.id).length || shared.some(t => users(t)[0] === n));
      x += wide ? step + nodeWidth + 36 : step;
    }
    const mean = list => list.reduce((sum, v) => sum + v, 0) / list.length,
      block = n =>
        Math.max(
          height(n),
          drawer.get(n.id).length ? drawer.get(n.id).reduce((sum, t) => sum + height(t) + 16, 12) : 0,
        ),
      center = n => n.y + height(n) / 2,
      // Letakkan kolom sedekat mungkin dengan posisi yang diinginkan tanpa menumpuk dan tanpa mengubah urutan.
      place = (column, want) => {
        const wants = column.map(n => want(n)),
          chosen = wants.map((w, i) => w ?? column[i].y);
        let end = -Infinity;
        column.forEach((n, i) => {
          n.y = Math.max(chosen[i], end + gap);
          end = n.y + block(n);
        });
        // Dorongan ke bawah membuat kelompok menggantung; geser seluruh kolom agar rata-rata tepat di posisi yang diinginkan
        // (misalnya cabang Router berpusat di Router).
        if (wants.every(w => w === undefined)) return;
        const delta = mean(column.flatMap((n, i) => (wants[i] === undefined ? [] : [wants[i] - n.y])));
        for (const n of column) n.y += delta;
      };
    for (const column of order) {
      let stack = 0;
      for (const n of column) {
        n.y = stack;
        stack += block(n) + gap;
      }
    }
    // Sejajarkan setiap node dengan sumbernya (kiri ke kanan), lalu sumber dengan tujuannya (kanan ke kiri), lalu sekali
    // lagi kiri ke kanan, sehingga Output berada tepat di kanan Agent-nya dan Router di tengah cabangnya.
    const linked = (n, side) =>
        edges
          .filter(e => (side === 'in' ? e.target : e.source) === n.id)
          .map(e => flow.find(m => m.id === (side === 'in' ? e.source : e.target)))
          .filter(m => m && m.x !== n.x),
      align = side => n => {
        const others = linked(n, side).filter(m => (side === 'in' ? m.x < n.x : m.x > n.x));
        return others.length ? mean(others.map(center)) - height(n) / 2 : undefined;
      };
    for (const column of order.slice(1)) place(column, align('in'));
    for (const column of order.slice(0, -1).reverse()) place(column, align('out'));
    for (const column of order.slice(1)) place(column, align('in'));
    for (const n of flow)
      drawer.get(n.id).reduce((ty, t) => {
        t.x = n.x + nodeWidth + 36;
        t.y = ty;
        return ty + height(t) + 16;
      }, n.y + 28);
    // Data bersama: setinggi rata-rata pemakainya, digeser seperlunya agar tidak menumpuk isi laci lain.
    for (const t of shared) {
      const us = users(t);
      t.x = us[0].x + nodeWidth + 36;
      t.y = mean(us.map(center)) - height(t) / 2;
    }
    const drawerColumns = new Map();
    for (const t of tools) drawerColumns.set(t.x, [...(drawerColumns.get(t.x) ?? []), t]);
    for (const list of drawerColumns.values()) {
      let end = -Infinity;
      for (const t of list.sort((a, b) => a.y - b.y)) {
        t.y = Math.max(t.y, end + 16);
        end = t.y + height(t);
      }
    }
    const placedTools = new Set(tools.map(t => t.id)),
      laid = [...flow, ...tools],
      minY = Math.min(...laid.map(n => n.y)),
      tallest = Math.max(0, ...laid.map(n => n.y + height(n))) - minY;
    // Rel memori di atas jalur utama.
    const memories = nodes.filter(isMemory),
      top = memories.length ? 100 + Math.max(...memories.map(height)) + 70 : 100;
    for (const n of laid) n.y = Math.round(n.y - minY + top);
    // Node data yang Agent pemakainya tidak ada di jalur ikut dikumpulkan di kiri bawah.
    for (const t of nodes.filter(t => agentTool(t) && !placedTools.has(t.id))) loose.push(t);
    let lx = 60;
    const bottom = top + tallest + 80;
    for (const n of loose.sort((a, b) => a.id.localeCompare(b.id))) {
      n.x = lx;
      n.y = bottom;
      lx += step;
    }
    // Memori diletakkan di atas rata-rata posisi pemakainya, tanpa saling menumpuk.
    const placed = memories
      .map(m => {
        const users = nodes.filter(n => (m.type === 'memory' ? n.memory : n.context_memory) === m.id);
        return { m, want: users.length ? users.reduce((sum, n) => sum + n.x, 0) / users.length : 60 };
      })
      .sort((a, b) => a.want - b.want || a.m.id.localeCompare(b.m.id));
    let minX = 60;
    for (const { m, want } of placed) {
      m.x = Math.round(Math.max(minX, want));
      m.y = 100;
      minX = m.x + step;
    }
  });
  fitCanvas();
};
window.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closePalette();
    if (state.pending) {
      state.pending = null;
      $('connection-hint').textContent = '';
      renderCanvas();
    }
  }
  if (!state.id) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    task(flushSave);
    return;
  }
  if (e.target.closest('input,textarea,select,[contenteditable]')) return;
  if (e.key === '/' && !$('flow').hidden) {
    e.preventDefault();
    openPalette();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    undo(e.shiftKey);
  }
  if (e.key === 'Delete' && state.selected && !$('flow').hidden) removeNode(state.selected);
});
new ResizeObserver(() => renderMinimap()).observe(viewport);
