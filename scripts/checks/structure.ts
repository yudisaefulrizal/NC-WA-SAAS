// Memeriksa aturan ketergantungan di AGENT.MD pada setiap import di src/ (dijalankan oleh npm run check):
// - kode di luar sebuah komponen hanya mengimpor index.ts komponen itu;
// - arah lapisan entry-points → domain → data-access, tidak pernah dibalik;
// - src/libraries tidak mengimpor komponen atau src/http.
// Import yang hanya tipe (`import type`) tidak dihitung karena hilang saat dijalankan. Satu pengecualian:
// data-access/schema.ts (migrasi) boleh memakai konstanta domain, karena migrasi menyiapkan data awal dari
// definisi domain (alur bawaan, daftar profil, bidang knowledge).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const root = resolve('src');
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith('.ts') ? [path] : [];
  });

// Letak sebuah file: komponen dan lapisannya, atau kelompok lain di src/.
function place(path: string) {
  const parts = relative(root, path).split('/');
  if (parts[0] === 'components') return { component: parts[1], layer: parts.length > 3 ? parts[2] : 'index' };
  return { component: null, layer: parts.length > 1 ? parts[0] : 'root' };
}

// Lapisan boleh mengimpor lapisan yang sama atau yang lebih dalam.
const depth: Record<string, number> = { 'entry-points': 0, domain: 1, 'data-access': 2 };
const problems: string[] = [];
for (const file of files(root)) {
  const source = readFileSync(file, 'utf8');
  const from = place(file);
  const specifiers = [
    ...source.matchAll(/^import\s+(?!type\s)[^;]*?from\s+'(\.[^']+)'|import\s*\(\s*'(\.[^']+)'/gm),
  ].map(match => (match[1] ?? match[2])!);
  const migration = file.endsWith('/data-access/schema.ts');
  for (const specifier of specifiers) {
    const target = resolve(dirname(file), specifier.replace(/\.js$/, '.ts'));
    const to = place(target);
    const where = `${relative('.', file)} → ${specifier}`;
    if (from.layer === 'libraries' && to.layer !== 'libraries')
      problems.push(`${where}: libraries tidak boleh mengimpor ${to.layer}`);
    if (to.component && to.component !== from.component && to.layer !== 'index')
      problems.push(`${where}: dari luar komponen ${to.component} hanya boleh lewat index.ts`);
    if (to.component && to.component === from.component && from.layer in depth && to.layer in depth)
      if (depth[to.layer]! < depth[from.layer]! && !(migration && to.layer === 'domain'))
        problems.push(`${where}: ${from.layer} tidak boleh mengimpor ${to.layer}`);
  }
}
if (problems.length) {
  console.error('Pelanggaran aturan struktur (lihat AGENT.MD, Peta kode):\n' + problems.join('\n'));
  process.exit(1);
}
console.log('Struktur src/ sesuai aturan.');
