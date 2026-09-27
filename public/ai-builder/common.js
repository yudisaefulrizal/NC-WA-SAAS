// Elemen dan akses API bersama editor profil dan pengelola data; semua teks dinamis memakai textContent.
const $ = id => document.getElementById(id);
function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function btn(text, fn, className = 'btn small') {
  const node = el('button', text, className);
  node.type = 'button';
  node.onclick = () => task(fn, node);
  return node;
}
async function api(path, method = 'GET', body) {
  const r = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({ message: 'Respons server tidak dapat dibaca.' }));
  if (!r.ok)
    throw Error(
      d.message ||
        {
          unauthorized: 'Silakan login melalui dashboard.',
          forbidden: 'Akses pemilik diperlukan.',
          internal_error: 'Terjadi gangguan server.',
        }[d.error] ||
        d.error ||
        'Permintaan gagal.',
    );
  return d;
}
let noticeTimer;
function notice(message) {
  $('notice').textContent = message;
  $('notice').showPopover();
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => $('notice').hidePopover(), 9000);
}
async function task(fn, button) {
  if (button) button.disabled = true;
  try {
    return await fn();
  } catch (e) {
    notice(e.message);
  } finally {
    if (button) button.disabled = false;
  }
}
function field(label, value, onchange, type = 'text', options = []) {
  const wrap = el('label', label);
  const input = el(type === 'textarea' ? 'textarea' : type === 'select' ? 'select' : 'input');
  if (type === 'select') {
    for (const option of options) {
      const o = el('option', typeof option === 'string' ? option : option.label);
      o.value = typeof option === 'string' ? option : option.value;
      input.append(o);
    }
  } else if (type !== 'textarea') input.type = type;
  input.setAttribute('aria-label', label);
  input.value = value ?? '';
  if (type === 'checkbox') input.checked = !!value;
  input[type === 'select' || type === 'checkbox' ? 'onchange' : 'oninput'] = () =>
    task(() => onchange(type === 'checkbox' ? input.checked : type === 'number' ? Number(input.value) : input.value));
  wrap.append(input);
  return wrap;
}
function download(name, value) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const a = el('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
