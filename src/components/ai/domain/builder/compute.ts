// Operasi node Set / Hitung. Daftarnya tetap (tanpa rumus bebas atau eval); nilai yang tidak sesuai menghentikan alur
// dengan ai_compute_failed supaya kesalahan terlihat di jejak, bukan diam-diam menjadi 0.
import type { ComputeOp } from './definition.js';

const fail = () => Error('ai_compute_failed');
function num(v: unknown) {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v.trim()) : NaN;
  if (!Number.isFinite(n)) throw fail();
  return n;
}
function int(v: unknown, min: number, max: number) {
  const n = num(v);
  if (!Number.isInteger(n) || n < min || n > max) throw fail();
  return n;
}
function day(v: unknown) {
  const d = typeof v === 'string' ? v.slice(0, 10) : '';
  const time = Date.parse(d + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== d)
    throw fail();
  return time;
}
const text = (v: unknown) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : JSON.stringify(v));
// Hasil dibulatkan ke 10 desimal supaya 0,1 + 0,2 tidak menjadi 0,30000000000000004.
const tidy = (n: number) => Math.round(n * 1e10) / 1e10;
export function compute(op: ComputeOp, args: unknown[]): unknown {
  const [a, b] = args;
  switch (op) {
    case 'value':
      return a;
    case 'add':
      return tidy(num(a) + num(b));
    case 'subtract':
      return tidy(num(a) - num(b));
    case 'multiply':
      return tidy(num(a) * num(b));
    case 'divide': {
      const divisor = num(b);
      if (divisor === 0) throw fail();
      return tidy(num(a) / divisor);
    }
    case 'round': {
      const places = text(b).trim() === '' ? 0 : int(b, 0, 6);
      return Math.round(num(a) * 10 ** places) / 10 ** places;
    }
    case 'format_rupiah':
      return 'Rp' + new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(num(a));
    case 'concat':
      return text(a);
    case 'truncate':
      return [...text(a)].slice(0, int(b, 0, 8000)).join('');
    case 'add_days':
      return new Date(day(a) + int(b, -36500, 36500) * 86400000).toISOString().slice(0, 10);
    case 'days_between':
      return Math.round((day(b) - day(a)) / 86400000);
    case 'format_date': {
      const date = new Intl.DateTimeFormat('id-ID', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(day(a));
      const time = typeof a === 'string' ? a.match(/[T ](\d{2}):(\d{2})/) : null;
      return time ? date + ' pukul ' + time[1] + '.' + time[2] : date;
    }
    case 'length':
      if (Array.isArray(a)) return a.length;
      if (typeof a === 'string') return [...a].length;
      throw fail();
    case 'item_at': {
      if (!Array.isArray(a)) throw fail();
      return a[int(b, 1, 10000) - 1] ?? null;
    }
  }
}
