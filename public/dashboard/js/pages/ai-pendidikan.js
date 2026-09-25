// Asisten AI, profil CS Lembaga Pendidikan: Profil Lembaga (di Knowledge), Program, Jadwal, Dokumen, dan Kontak.
// Setiap suntingan tersimpan sendiri; program, dokumen, dan kontak dikirim ke endpoint masing-masing di bawah data
// profil.
const edu = { programs: [], selected: null, documents: [], contacts: [] };
function eduDeleteButton(label, action) {
  const b = button('', action);
  b.classList.add('table-icon-button', 'danger');
  b.setAttribute('aria-label', label);
  b.title = label;
  b.innerHTML =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>';
  return b;
}
{
  const el = $('ai-form').elements.edu_lembaga;
  el.oninput = () => debounceAutosave(el, 'edu_lembaga', el.value);
}
function eduJadwalCount() {
  $('edu-jadwal-count').textContent =
    new Intl.NumberFormat('id-ID').format($('edu-jadwal').value.length) + ' / 8.000 karakter · tersimpan otomatis';
}
$('edu-jadwal').oninput = () => {
  eduJadwalCount();
  debounceAutosave($('edu-jadwal'), 'edu_jadwal', $('edu-jadwal').value);
};
async function loadEduData(generation = assistantLoad) {
  const target = aiTarget();
  if (!target) return;
  const base = dataBase();
  const [programs, documents, contacts] = await Promise.all([
    api(base + '/programs'),
    api(base + '/documents'),
    api(base + '/contacts'),
  ]);
  if (generation !== assistantLoad || target !== aiTarget()) return;
  edu.programs = programs;
  edu.documents = documents;
  edu.contacts = contacts;
  if (!programs.some(p => p.id === edu.selected)) edu.selected = programs[0]?.id ?? null;
  renderEduPrograms();
  renderEduDocuments();
  renderEduContacts();
  if (aiView === 'sessions') await loadFallbacks('/sessions/' + encodeURIComponent($('ai-session').value) + '/ai');
  else $('ai-fallbacks').replaceChildren();
}
function renderEduPrograms() {
  $('edu-program-count').textContent = edu.programs.length + ' program';
  $('edu-programs').replaceChildren(
    ...edu.programs.map(p => {
      const b = element('button', 'edu-program-item');
      b.type = 'button';
      b.setAttribute('aria-pressed', String(p.id === edu.selected));
      b.append(
        element('strong', '', p.name),
        element('small', '', p.description.replace(/\s+/g, ' ').slice(0, 70) || 'Belum ada deskripsi'),
      );
      b.onclick = () => {
        edu.selected = p.id;
        renderEduPrograms();
      };
      return b;
    }),
  );
  $('edu-program-select').replaceChildren(
    ...edu.programs.map(p => new Option(p.name, p.id, false, p.id === edu.selected)),
  );
  $('edu-program-select').closest('label').hidden = !edu.programs.length;
  const program = edu.programs.find(p => p.id === edu.selected);
  $('edu-program-form').hidden = !program;
  $('edu-program-empty').hidden = Boolean(program);
  if (program) {
    if (document.activeElement !== $('edu-program-name')) $('edu-program-name').value = program.name;
    if (document.activeElement !== $('edu-program-description'))
      $('edu-program-description').value = program.description;
    eduProgramStatus('');
  }
}
function eduProgramStatus(state) {
  const length = new Intl.NumberFormat('id-ID').format($('edu-program-description').value.length);
  $('edu-program-status').textContent = (state ? state + ' · ' : '') + length + ' / 4.000 karakter';
}
let eduProgramTimer;
function saveEduProgram() {
  const id = edu.selected;
  clearTimeout(eduProgramTimer);
  eduProgramStatus('Menyimpan…');
  eduProgramTimer = setTimeout(
    () =>
      run(async () => {
        const program = edu.programs.find(p => p.id === id);
        if (!program) return;
        const name = $('edu-program-name').value.trim();
        if (!name) {
          eduProgramStatus('Nama program wajib diisi');
          return;
        }
        try {
          const saved = await api(dataBase() + '/programs/' + encodeURIComponent(id), 'PUT', {
            name,
            description: $('edu-program-description').value,
          });
          Object.assign(program, saved);
          if (edu.selected === id) {
            renderEduPrograms();
            eduProgramStatus('Tersimpan');
          }
        } catch (e) {
          eduProgramStatus(e.message);
          throw e;
        }
      }),
    800,
  );
}
$('edu-program-select').onchange = e => {
  edu.selected = e.target.value;
  renderEduPrograms();
};
$('edu-program-name').oninput = saveEduProgram;
$('edu-program-description').oninput = saveEduProgram;
$('edu-program-add').onclick = () =>
  run(async () => {
    const names = new Set(edu.programs.map(p => p.name.toLowerCase()));
    let name = 'Program baru';
    for (let n = 2; names.has(name.toLowerCase()); n++) name = 'Program baru ' + n;
    const created = await api(dataBase() + '/programs', 'POST', { name, description: '' });
    edu.programs.push(created);
    edu.selected = created.id;
    renderEduPrograms();
    $('edu-program-name').focus();
    $('edu-program-name').select();
  });
$('edu-program-delete').onclick = () =>
  run(async () => {
    const program = edu.programs.find(p => p.id === edu.selected);
    if (!program || !confirm('Hapus program ' + program.name + '?')) return;
    await api(dataBase() + '/programs/' + encodeURIComponent(program.id), 'DELETE');
    edu.programs = edu.programs.filter(p => p.id !== program.id);
    edu.selected = edu.programs[0]?.id ?? null;
    renderEduPrograms();
    $('message').textContent = 'Program dihapus.';
  });
const fileSize = bytes =>
  bytes >= 1048576
    ? (bytes / 1048576).toLocaleString('id-ID', { maximumFractionDigits: 1 }) + ' MB'
    : Math.max(1, Math.round(bytes / 1024)) + ' KB';
const fileBadge = d =>
  d.media_type === 'image'
    ? (d.mimetype.split('/')[1] || 'img').replace('jpeg', 'jpg').toUpperCase()
    : /pdf/.test(d.mimetype)
      ? 'PDF'
      : /word/.test(d.mimetype)
        ? 'DOC'
        : /sheet|excel/.test(d.mimetype)
          ? 'XLS'
          : /presentation|powerpoint/.test(d.mimetype)
            ? 'PPT'
            : 'FILE';
async function uploadDocument(path, method, file, headers) {
  const response = await fetch(path, {
    method,
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
      'X-Filename': encodeURIComponent(file.name),
      ...headers,
    },
    body: file,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(data.message || 'Gagal mengunggah dokumen.');
  return data;
}
$('edu-document-upload').onclick = () => {
  const input = $('edu-document-file'),
    description = $('edu-document-description'),
    file = input.files[0],
    submit = $('edu-document-upload');
  if (!description.value.trim()) {
    $('message').textContent = 'Tulis deskripsi dokumen terlebih dahulu.';
    description.focus();
    return;
  }
  if (!file) {
    $('message').textContent = 'Pilih file dokumen terlebih dahulu.';
    return;
  }
  void run(async () => {
    submit.disabled = true;
    submit.textContent = 'Mengunggah…';
    try {
      const created = await uploadDocument(dataBase() + '/documents', 'POST', file, {
        'X-Description': encodeURIComponent(description.value.trim()),
      });
      edu.documents.push(created);
      input.value = '';
      description.value = '';
      renderEduDocuments();
      $('message').textContent = 'Dokumen ' + created.filename + ' tersimpan.';
    } finally {
      submit.disabled = false;
      submit.textContent = 'Unggah dokumen';
    }
  });
};
function renderEduDocuments() {
  $('edu-document-count').textContent = edu.documents.length + ' dari 20 dokumen';
  if (!edu.documents.length) {
    $('edu-documents').replaceChildren(element('p', 'empty', 'Belum ada dokumen.'));
    return;
  }
  $('edu-documents').replaceChildren(
    ...edu.documents.map(d => {
      const row = element('div', 'edu-document'),
        badge = element(
          'span',
          'edu-file-badge ' + (d.media_type === 'image' ? 'image' : fileBadge(d).toLowerCase()),
          fileBadge(d),
        ),
        info = element('div', 'edu-document-file'),
        link = element('a', '', d.filename);
      link.href = dataBase() + '/documents/' + encodeURIComponent(d.id) + '/file';
      link.target = '_blank';
      link.rel = 'noopener';
      const replace = element('label', 'edu-replace', 'Ganti file'),
        input = document.createElement('input');
      input.type = 'file';
      input.accept = $('edu-document-file').accept;
      input.className = 'sr-only';
      input.onchange = () =>
        run(async () => {
          const file = input.files[0];
          if (!file) return;
          replace.firstChild.textContent = 'Mengunggah…';
          try {
            Object.assign(
              d,
              await uploadDocument(dataBase() + '/documents/' + encodeURIComponent(d.id) + '/file', 'PUT', file, {}),
            );
            renderEduDocuments();
            $('message').textContent = 'File dokumen diganti.';
          } finally {
            replace.firstChild.textContent = 'Ganti file';
          }
        });
      replace.append(input);
      info.append(link, element('small', '', fileSize(d.size_bytes)), replace);
      const description = document.createElement('textarea');
      description.maxLength = 300;
      description.rows = 2;
      description.value = d.description;
      description.setAttribute('aria-label', 'Deskripsi ' + d.filename);
      let timer;
      description.oninput = () => {
        clearTimeout(timer);
        timer = setTimeout(
          () =>
            run(async () => {
              if (!description.value.trim()) return;
              await api(dataBase() + '/documents/' + encodeURIComponent(d.id), 'PATCH', {
                description: description.value,
              });
              d.description = description.value.trim();
            }),
          800,
        );
      };
      const remove = eduDeleteButton('Hapus dokumen ' + d.filename, async () => {
        if (!confirm('Hapus dokumen ' + d.filename + '?')) return;
        await api(dataBase() + '/documents/' + encodeURIComponent(d.id), 'DELETE');
        edu.documents = edu.documents.filter(x => x.id !== d.id);
        renderEduDocuments();
        $('message').textContent = 'Dokumen dihapus.';
      });
      row.append(badge, info, description, remove);
      return row;
    }),
  );
}
// Baris kontak baru disimpan setelah Bagian dan Kontak terisi; suntingan berikutnya memperbarui baris yang sama.
function renderEduContacts() {
  if (!edu.contacts.length) {
    $('edu-contacts').replaceChildren(element('p', 'empty', 'Belum ada kontak.'));
    return;
  }
  const head = element('div', 'edu-contact-head');
  head.append(
    element('span', '', 'Bagian'),
    element('span', '', 'Kontak'),
    element('span', '', 'Deskripsi'),
    element('span', ''),
  );
  $('edu-contacts').replaceChildren(
    head,
    ...edu.contacts.map(c => {
      const row = element('div', 'edu-contact'),
        field = (name, label, max, multi = false) => {
          const el = document.createElement(multi ? 'textarea' : 'input');
          el.maxLength = max;
          el.value = c[name] ?? '';
          el.setAttribute('aria-label', label + (c.bagian ? ' ' + c.bagian : ''));
          if (multi) el.rows = 2;
          el.oninput = () => {
            c[name] = el.value;
            save();
          };
          return el;
        };
      let timer;
      const save = () => {
        clearTimeout(timer);
        timer = setTimeout(
          () =>
            run(async () => {
              if (!c.bagian?.trim() || !c.kontak?.trim()) return;
              const body = { bagian: c.bagian, kontak: c.kontak, deskripsi: c.deskripsi ?? '' };
              if (c.id) await api(dataBase() + '/contacts/' + encodeURIComponent(c.id), 'PUT', body);
              else if (!c.saving) {
                c.saving = true;
                try {
                  c.id = (await api(dataBase() + '/contacts', 'POST', body)).id;
                } finally {
                  c.saving = false;
                }
              }
            }),
          800,
        );
      };
      const remove = eduDeleteButton('Hapus kontak ' + (c.bagian || 'baru'), async () => {
        if (c.id) {
          if (!confirm('Hapus kontak ' + c.bagian + '?')) return;
          await api(dataBase() + '/contacts/' + encodeURIComponent(c.id), 'DELETE');
        }
        edu.contacts = edu.contacts.filter(x => x !== c);
        renderEduContacts();
      });
      row.append(
        field('bagian', 'Bagian', 100),
        field('kontak', 'Kontak', 150),
        field('deskripsi', 'Deskripsi', 300, true),
        remove,
      );
      return row;
    }),
  );
}
$('edu-contact-add').onclick = () => {
  if (edu.contacts.length >= 30) {
    $('message').textContent = 'Maksimal 30 kontak per data profil.';
    return;
  }
  edu.contacts.push({ bagian: '', kontak: '', deskripsi: '' });
  renderEduContacts();
  $('edu-contacts').querySelector('.edu-contact:last-child input').focus();
};
