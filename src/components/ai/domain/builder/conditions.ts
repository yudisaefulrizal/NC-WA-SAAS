// Evaluasi syarat node Kondisi dan variabel waktu WIB. Tanpa model dan tanpa eval; nilai yang tidak ada dianggap
// kosong sehingga hanya operator "kosong" yang cocok.
import type { ConditionOperator, ConditionRule, ConditionGroup, GraphNode } from './definition.js';

const zone = 'Asia/Jakarta';
export const weekdays = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
function parts(date: Date) {
  const get = (type: string) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(date)
      .find(p => p.type === type)!.value;
  return { day: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}
export function systemVariables(now = new Date()) {
  const today = parts(now),
    tomorrow = parts(new Date(now.getTime() + 86400000));
  return {
    today: today.day,
    tomorrow: tomorrow.day,
    now: today.day + ' ' + today.time,
    time: today.time,
    weekday: weekdays[new Date(today.day + 'T00:00:00Z').getUTCDay()],
  };
}
const missing = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
const plain = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v)).trim().toLowerCase();
const day = (v: unknown) => (typeof v === 'string' ? (v.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? null) : null);
function minutes(v: string) {
  const m = v.trim().match(/^(\d{1,2})[.:](\d{2})$/);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}
const list = (v: string) =>
  v
    .split(',')
    .map(x => x.trim().toLowerCase())
    .filter(Boolean);
export function ruleMatches(value: unknown, operator: ConditionOperator, compare: string): boolean {
  if (operator === 'empty') return missing(value);
  if (operator === 'exists') return !missing(value);
  if (missing(value)) return false;
  switch (operator) {
    case 'equals':
    case 'not_equals': {
      const same =
        typeof value === 'number' && compare.trim() !== '' && Number.isFinite(Number(compare))
          ? value === Number(compare)
          : plain(value) === compare.trim().toLowerCase();
      return operator === 'equals' ? same : !same;
    }
    case 'contains':
      return plain(value).includes(compare.trim().toLowerCase());
    case 'not_contains':
      return !plain(value).includes(compare.trim().toLowerCase());
    case 'greater':
    case 'less': {
      const a = Number(value),
        b = Number(compare);
      if (!Number.isFinite(a) || compare.trim() === '' || !Number.isFinite(b)) return false;
      return operator === 'greater' ? a > b : a < b;
    }
    case 'date_before':
    case 'date_on_or_after': {
      const a = day(value),
        b = day(compare.trim());
      if (!a || !b) return false;
      return operator === 'date_before' ? a < b : a >= b;
    }
    case 'weekday_is': {
      const d = day(value);
      const name = d ? weekdays[new Date(d + 'T00:00:00Z').getUTCDay()] : String(value);
      return list(compare).includes(name.toLowerCase());
    }
    case 'time_between': {
      const t = minutes(String(value)),
        range = compare.split(/\s*(?:-|–|—|s\/d|sampai)\s*/);
      const from = range.length === 2 ? minutes(range[0]) : null,
        to = range.length === 2 ? minutes(range[1]) : null;
      if (t === null || from === null || to === null) return false;
      // Rentang melewati tengah malam, misalnya 22.00–06.00.
      return from <= to ? t >= from && t <= to : t >= from || t <= to;
    }
    case 'one_of':
      return list(compare).includes(plain(value));
    case 'count_greater':
      return Array.isArray(value) && compare.trim() !== '' && value.length > Number(compare);
  }
}
export function conditionMatches(
  n: GraphNode,
  resolve: (field: string) => unknown,
  interpolate: (compare: string) => string,
): boolean {
  const rules: (ConditionRule | ConditionGroup)[] = n.rules ?? [
    { field: n.field, operator: n.operator, compare: n.compare },
  ];
  const leaf = (r: ConditionRule) => ruleMatches(resolve(r.field), r.operator, interpolate(r.compare));
  const one = (r: ConditionRule | ConditionGroup) =>
    'rules' in r ? (r.match === 'any' ? r.rules.some(leaf) : r.rules.every(leaf)) : leaf(r);
  return (n.match ?? 'all') === 'any' ? rules.some(one) : rules.every(one);
}
