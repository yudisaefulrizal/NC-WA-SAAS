// Kanvas graf: koordinat, sambungan port, drag, zoom, serta riwayat perubahan tanpa pustaka eksternal.
const viewport = $('viewport');
function transform() {
  $('world').style.transform = `translate(${state.pan.x}px,${state.pan.y}px) scale(${state.zoom})`;
  $('fit').textContent = Math.round(state.zoom * 100) + '%';
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
function renderCanvas() {
  if (!state.document) return;
  $('node-picker').replaceChildren(
    field('Pilih node', state.selected || '', id => selectNode(id), 'select', [
      { value: '', label: 'Pilih langkah alur' },
      ...state.document.nodes.map(n => ({ value: n.id, label: n.label })),
    ]),
  );
  const host = $('nodes'),
    svg = $('connections');
  host.replaceChildren();
  svg.replaceChildren();
  for (const n of state.document.nodes) {
    const box = el(
      'div',
      undefined,
      'graph-node' + (state.selected === n.id ? ' selected' : '') + ' ' + (state.trace[n.id] || ''),
    );
    box.dataset.node = n.id;
    box.style.left = n.x + 'px';
    box.style.top = n.y + 'px';
    const heading = el('div', undefined, 'node-heading'),
      text = el('div');
    text.append(el('div', n.label, 'node-title'), el('div', kinds[n.type][1] + ' · ' + n.id, 'node-sub'));
    heading.append(el('span', kinds[n.type][0], 'node-icon'), text);
    heading.tabIndex = 0;
    heading.setAttribute('role', 'button');
    heading.setAttribute('aria-label', 'Atur ' + n.label);
    heading.onkeydown = e => {
      if (e.key === 'Enter') selectNode(n.id);
    };
    heading.onpointerdown = e => startDrag(e, n);
    box.append(heading);
    if (!['input', 'memory'].includes(n.type)) {
      const p = el('button', undefined, 'port input-port');
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
    for (const port of n.type === 'memory' ? ['memory'] : nodePorts(n)) {
      const row = el(
          'div',
          n.branches.find(b => b.id === port)?.label || { ...portLabels, memory: 'Bagikan memori' }[port] || port,
          'port-row',
        ),
        p = el(
          'button',
          undefined,
          'port' + (state.pending?.source === n.id && state.pending?.port === port ? ' pending' : ''),
        );
      if (port === 'memory') p.classList.add('memory-port');
      p.title = n.label + ': ' + port;
      p.setAttribute('aria-label', 'Hubungkan ' + p.title);
      p.dataset.source = n.id;
      p.dataset.port = port;
      p.onpointerdown = e => {
        e.stopPropagation();
        state.pending = { source: n.id, port };
        $('connection-hint').textContent = 'Pilih atau tarik ke port masuk node tujuan. Escape untuk batal.';
      };
      p.onclick = e => {
        e.stopPropagation();
        state.pending = { source: n.id, port };
      };
      row.append(p);
      box.append(row);
    }
    if (memoryConsumers.includes(n.type)) {
      const row = el('div', n.memory ? 'Memori terhubung' : 'Tanpa memori', 'port-row memory-row');
      const p = el('button', undefined, 'port memory-port memory-input');
      p.dataset.target = n.id;
      p.dataset.connection = 'memory';
      p.setAttribute('aria-label', 'Memori: ' + n.label);
      p.onclick = e => {
        e.stopPropagation();
        connect(n.id, 'memory');
      };
      p.onpointerup = () => {
        if (state.pending) connect(n.id, 'memory');
      };
      row.append(p);
      box.append(row);
    }
    host.append(box);
  }
  for (const edge of state.document.edges) {
    const source = state.document.nodes.find(n => n.id === edge.source),
      target = state.document.nodes.find(n => n.id === edge.target);
    if (!source || !target) continue;
    const y = source.y + 64 + nodePorts(source).indexOf(edge.port) * 30 + 15;
    drawPath(svg, source.x + 190, y, target.x, target.y + 34, () => {
      if (confirm('Hapus koneksi ini?'))
        mutate(() => (state.document.edges = state.document.edges.filter(e => e.id !== edge.id)));
    });
  }
  for (const n of state.document.nodes.filter(n => n.memory)) {
    const m = state.document.nodes.find(m => m.id === n.memory && m.type === 'memory');
    if (!m) continue;
    const path = drawPath(svg, m.x + 190, m.y + 79, n.x, n.y + 64 + nodePorts(n).length * 30 + 15, () => {
      if (confirm('Putuskan memori dari ' + n.label + '?')) {
        mutate(() => (n.memory = ''));
        renderInspector();
      }
    });
    path.classList.add('memory-link');
    path.dataset.memoryConnection = m.id + ':' + n.id;
  }
  for (const n of state.document.nodes.filter(n => n.type === 'agent'))
    for (const id of n.tools) {
      const t = state.document.nodes.find(t => t.id === id);
      if (t) drawPath(svg, n.x + 95, n.y + 64, t.x + 95, t.y, undefined, true);
    }
  transform();
}
function drawPath(svg, x1, y1, x2, y2, click, attachment = false) {
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  const offset = Math.max(70, Math.abs(x2 - x1) / 2);
  path.setAttribute(
    'd',
    attachment
      ? `M${x1},${y1} C${x1},${y1 + 65} ${x2},${y2 - 65} ${x2},${y2}`
      : `M${x1},${y1} C${x1 + offset},${y1} ${x2 - offset},${y2} ${x2},${y2}`,
  );
  if (attachment) path.classList.add('attachment');
  if (click) path.onclick = () => task(click);
  svg.append(path);
  return path;
}
function connect(target, connection = 'flow') {
  if (!state.pending) return;
  const { source, port } = state.pending;
  if (port === 'memory' || connection === 'memory') {
    if (port !== 'memory' || connection !== 'memory') {
      notice('Hubungkan port Shared Memory ke port Memori pada node tujuan.');
      return;
    }
    attachMemory(source, target);
    state.pending = null;
    renderCanvas();
    return;
  }
  if (state.document.nodes.find(n => n.id === target)?.type === 'memory') {
    notice('Shared Memory memakai sambungan memori terpisah.');
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
  $('connection-hint').textContent = 'Koneksi tersambung. Klik garis untuk menghapus.';
  renderCanvas();
}
function attachMemory(source, target) {
  const m = state.document.nodes.find(n => n.id === source),
    n = state.document.nodes.find(n => n.id === target);
  if (m?.type !== 'memory' || !n || !memoryConsumers.includes(n.type)) {
    notice('Memori dapat dipasang pada Router, Agent, atau Context.');
    return;
  }
  mutate(() => (n.memory = source));
  renderInspector();
  $('connection-hint').textContent = 'Memori terhubung. Klik garis ungu untuk memutuskan.';
}
let drag;
function startDrag(e, n) {
  if (e.button !== 0) return;
  e.preventDefault();
  state.selected = n.id;
  checkpoint();
  const p = position(e);
  drag = { kind: 'node', node: n, x: p.x, y: p.y, ox: n.x, oy: n.y };
  renderCanvas();
  renderInspector();
}
viewport.onpointerdown = e => {
  if (e.button !== 0 || e.target.closest('button,.graph-node,.canvas-controls,path')) return;
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
    drag.node.x = Math.max(0, Math.min(3800, Math.round((drag.ox + p.x - drag.x) / 10) * 10));
    drag.node.y = Math.max(0, Math.min(3800, Math.round((drag.oy + p.y - drag.y) / 10) * 10));
    changed();
    renderCanvas();
  }
});
window.addEventListener('pointerup', e => {
  drag = null;
  if (state.pending) {
    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-target]');
    if (target) connect(target.dataset.target, target.dataset.connection ?? 'flow');
  }
});
viewport.onwheel = e => {
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
  addNode(type, p.x, p.y);
};
// Node baru tidak boleh menutupi node lain; geser ke bawah sampai menemukan tempat kosong.
function freeSpot(x, y) {
  const taken = (px, py) => state.document.nodes.some(n => Math.abs(n.x - px) < 210 && Math.abs(n.y - py) < 170);
  for (let i = 0; i < 20 && taken(x, y); i++) y += 180;
  return { x, y };
}
function addNode(type, x, y) {
  const spot = freeSpot(Math.max(0, x), Math.max(0, y));
  const n = newNode(type, spot.x, spot.y);
  mutate(() => state.document.nodes.push(n));
  selectNode(n.id);
}
for (const [group, types] of paletteGroups) {
  $('node-types').append(el('div', group, 'palette-group'));
  for (const type of types) {
    const [icon, label] = kinds[type];
    const b = btn('', () => {
      const x = Math.max(30, (viewport.clientWidth / 2 - state.pan.x) / state.zoom - 95),
        y = Math.max(30, (viewport.clientHeight / 2 - state.pan.y) / state.zoom);
      addNode(type, x, y);
    });
    b.append(el('span', icon, 'node-icon'), el('span', label));
    b.setAttribute('aria-label', label);
    b.dataset.kind = type;
    b.draggable = true;
    b.ondragstart = e => e.dataTransfer.setData('text/plain', type);
    $('node-types').append(b);
  }
}
function undo(redo = false) {
  const source = redo ? state.redo : state.undo,
    target = redo ? state.undo : state.redo;
  if (!source.length) return;
  target.push(snapshot());
  state.document = JSON.parse(source.pop());
  state.selected = null;
  changed();
  renderCanvas();
  renderInspector();
  renderCollections();
  $('profile-name').value = state.document.name;
  $('profile-description').value = state.document.description;
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
    width = Math.max(...ns.map(n => n.x + 220)) - minX,
    height = Math.max(...ns.map(n => n.y + 90 + nodePorts(n).length * 30)) - minY;
  state.zoom = Math.max(0.25, Math.min(1, (viewport.clientWidth - 50) / width, (viewport.clientHeight - 90) / height));
  state.pan = { x: 25 - minX * state.zoom, y: 55 - minY * state.zoom };
  transform();
}
$('fit').onclick = fitCanvas;
$('layout').onclick = () => {
  mutate(() => {
    const levels = new Map(),
      input = state.document.nodes.find(n => n.type === 'input'),
      queue = input ? [{ id: input.id, level: 0 }] : [];
    let guard = 0;
    while (queue.length && guard++ < 300) {
      const { id, level } = queue.shift();
      if ((levels.get(id) ?? -1) >= level) continue;
      levels.set(id, level);
      for (const e of state.document.edges.filter(e => e.source === id)) queue.push({ id: e.target, level: level + 1 });
    }
    const counts = {};
    for (const n of state.document.nodes) {
      const level = Math.min(20, levels.get(n.id) ?? 1),
        row = counts[level] || 0;
      n.x = 60 + level * 280;
      n.y = 100 + row * 220;
      counts[level] = row + 1;
    }
  });
  fitCanvas();
};
window.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    state.pending = null;
    renderCanvas();
  }
  if (!state.id) return;
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    task(save);
    return;
  }
  if (e.target.closest('input,textarea,select')) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    undo(e.shiftKey);
  }
  if (e.key === 'Delete' && state.selected) removeNode(state.selected);
});
