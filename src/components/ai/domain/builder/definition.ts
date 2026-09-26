// Format portabel profil: validasi struktur, koneksi, koleksi, dan referensi yang dipakai editor serta runtime.
import { ApiError } from '../../../../libraries/errors.js';
import { record } from '../../../../libraries/validation.js';
import { modelTiers, type ModelTier } from '../pipeline/models.js';
import { filterOperators, maxToolLimit, type FilterOperator } from './record-query.js';

export const businessTools = [
  'get_knowledge',
  'get_products',
  'check_order',
  'create_order',
  'send_product_image',
] as const;
export type BusinessTool = (typeof businessTools)[number];
export const usesBusinessTools = (d: GraphDefinition) => d.nodes.some(n => n.type === 'tool' && n.capability);

export const nodeTypes = [
  'input',
  'memory',
  'router',
  'agent',
  'condition',
  'tool',
  'context',
  'output',
  'fallback',
  'extract',
  'compute',
  'media',
] as const;
export type NodeType = (typeof nodeTypes)[number];
export const fieldTypes = [
  'text',
  'number',
  'boolean',
  'date',
  'time',
  'datetime',
  'choice',
  'multichoice',
  'phone',
  'relation',
  'file',
] as const;
export type FieldType = (typeof fieldTypes)[number];
// Tipe yang boleh unik atau punya nilai bawaan; relasi dan file selalu menunjuk record/file tertentu.
export const uniqueFieldTypes: readonly FieldType[] = ['text', 'number', 'date', 'time', 'datetime', 'choice', 'phone'];
export const defaultFieldTypes: readonly FieldType[] = fieldTypes.filter(t => t !== 'relation' && t !== 'file');
export interface Field {
  id: string;
  label: string;
  type: FieldType;
  required: boolean;
  options: string[];
  collection: string;
  // Diisi saat record dibuat tanpa nilai untuk field ini.
  default?: unknown;
  // Nilai tidak boleh sama dengan record lain di koleksi yang sama pada satu data profil.
  unique?: boolean;
}
// Node Ekstrak: field yang diambil model dari pesan pelanggan. Relasi dan file tidak bisa diambil dari teks.
export const extractFieldTypes = [
  'text',
  'number',
  'boolean',
  'date',
  'time',
  'datetime',
  'choice',
  'multichoice',
  'phone',
] as const;
export interface ExtractField {
  id: string;
  label: string;
  type: (typeof extractFieldTypes)[number];
  required: boolean;
  hint: string;
  options: string[];
}
// Node Set / Hitung: operasi tetap dan jumlah argumennya. Tidak ada rumus bebas atau eval.
export const computeArity = {
  value: 1,
  add: 2,
  subtract: 2,
  multiply: 2,
  divide: 2,
  round: 2,
  format_rupiah: 1,
  concat: 1,
  truncate: 2,
  add_days: 2,
  days_between: 2,
  format_date: 1,
  length: 1,
  item_at: 2,
} as const;
export type ComputeOp = keyof typeof computeArity;
export interface ComputeStep {
  name: string;
  op: ComputeOp;
  args: string[];
}
// Koleksi umum dibaca semua pelanggan; koleksi milik pelanggan terikat ke nomor pengirim dan hanya bisa diakses
// pelanggan itu melalui AI.
export const collectionOwners = ['shared', 'customer'] as const;
export interface Collection {
  id: string;
  name: string;
  owner: (typeof collectionOwners)[number];
  fields: Field[];
}
export const toolOperations = ['search', 'get', 'create', 'update', 'delete', 'count'] as const;
export type ToolOperation = (typeof toolOperations)[number];
export const conditionOperators = [
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'exists',
  'empty',
  'greater',
  'less',
  'date_before',
  'date_on_or_after',
  'weekday_is',
  'time_between',
  'one_of',
  'count_greater',
] as const;
export type ConditionOperator = (typeof conditionOperators)[number];
export interface ConditionRule {
  field: string;
  operator: ConditionOperator;
  compare: string;
}
export interface ConditionGroup {
  match: 'all' | 'any';
  rules: ConditionRule[];
}
export interface NodeFilter {
  field: string;
  operator: FilterOperator;
  value: string;
}
// Variabel yang disediakan runtime di luar node: waktu WIB, pelanggan yang sedang chat, dan data profil.
export const contextVariables: Record<string, readonly string[]> = {
  system: ['today', 'tomorrow', 'now', 'time', 'weekday'],
  customer: ['phone', 'name'],
  service: ['name'],
};
export interface GraphNode {
  id: string;
  type: NodeType;
  label: string;
  x: number;
  y: number;
  prompt: string;
  tier: ModelTier;
  model: string;
  tools: string[];
  branches: { id: string; label: string; description: string }[];
  collection: string;
  operation: ToolOperation;
  value: string;
  query: string;
  field: string;
  operator: ConditionOperator;
  compare: string;
  // Node Data: filter per field, urutan, batas hasil, dan field yang dijumlahkan operasi Hitung.
  filters?: NodeFilter[];
  sort_field?: string;
  sort_direction?: 'asc' | 'desc';
  limit?: number;
  sum_field?: string;
  // Dipakai filter node Data dan aturan node Kondisi.
  match?: 'all' | 'any';
  rules?: (ConditionRule | ConditionGroup)[];
  // Node Ekstrak dan node Set / Hitung.
  fields?: ExtractField[];
  steps?: ComputeStep[];
  // Node Kirim media: file dari `value`, keterangan, dikirim sebelum atau sesudah jawaban, dan jenisnya.
  caption?: string;
  send_when?: 'before' | 'after';
  media_as?: 'auto' | 'image' | 'document';
  context_format?: 'text' | 'spo';
  capability?: BusinessTool;
  fallback?: boolean;
  memory_limit?: number;
  memory?: string;
}
export interface GraphEdge {
  id: string;
  source: string;
  port: string;
  target: string;
}
export interface GraphDefinition {
  format: 'ncwa-profile';
  version: 1;
  name: string;
  description: string;
  collections: Collection[];
  nodes: GraphNode[];
  edges: GraphEdge[];
}
export interface GraphIssue {
  node?: string;
  message: string;
}
const bad = (message: string) => new ApiError(400, 'invalid_graph', message);
export function text(v: unknown, max = 8000): string {
  if (typeof v !== 'string' || v.length > max) throw bad('Teks wajib valid, maksimal ' + max + ' karakter.');
  return v;
}
function id(v: unknown) {
  const s = text(v, 32);
  if (!/^[a-z][a-z0-9_]*$/.test(s) || ['constructor', 'prototype', '__proto__'].includes(s))
    throw bad('ID harus huruf kecil, angka, atau garis bawah.');
  return s;
}
function list(v: unknown, max: number): unknown[] {
  if (!Array.isArray(v) || v.length > max) throw bad('Daftar melebihi batas ' + max + '.');
  return v;
}
function unique(values: string[]) {
  if (new Set(values).size !== values.length) throw bad('ID harus unik.');
}
function choice<T extends string>(v: unknown, values: readonly T[]): T {
  if (!values.includes(v as T)) throw bad('Pilihan tidak dikenal: ' + String(v).slice(0, 50));
  return v as T;
}
export function parseDefinition(value: unknown): GraphDefinition {
  const root = record(value);
  if (root.format !== 'ncwa-profile' || root.version !== 1) throw bad('Format/versi profil tidak didukung.');
  const collections = list(root.collections, 30).map(v => {
    const c = record(v);
    const fields = list(c.fields, 50).map(v => {
      const f = record(v);
      const field: Field = {
        id: id(f.id),
        label: text(f.label, 100),
        type: choice(f.type, fieldTypes),
        required: f.required === true,
        options: list(f.options ?? [], 100).map(v => text(v, 100)),
        collection: text(f.collection ?? '', 32),
      };
      if (f.unique === true) {
        if (!uniqueFieldTypes.includes(field.type)) throw bad('Field ' + field.label + ' tidak bisa dibuat unik.');
        field.unique = true;
      }
      if (f.default !== undefined && f.default !== null && f.default !== '') {
        if (!defaultFieldTypes.includes(field.type))
          throw bad('Field ' + field.label + ' tidak bisa punya nilai bawaan.');
        field.default = fieldValue(field, f.default);
      }
      return field;
    });
    unique(fields.map(f => f.id));
    return { id: id(c.id), name: text(c.name, 100), owner: choice(c.owner ?? 'shared', collectionOwners), fields };
  });
  unique(collections.map(c => c.id));
  for (const c of collections)
    for (const f of c.fields) {
      const target = collections.find(c => c.id === f.collection);
      if (f.type === 'relation' && !target) throw bad('Koleksi relasi tidak ditemukan.');
      if (f.type === 'relation' && target?.owner === 'customer' && c.owner !== 'customer')
        throw bad('Koleksi umum tidak boleh berelasi ke koleksi milik pelanggan.');
      if (['choice', 'multichoice'].includes(f.type) && !f.options.length) throw bad('Field pilihan membutuhkan opsi.');
    }
  const nodes = list(root.nodes, 60).map(v => {
    const n = record(v);
    const branches = list(n.branches ?? [], 20).map(v => {
      const b = record(v);
      return { id: id(b.id), label: text(b.label, 100), description: text(b.description, 1000) };
    });
    unique(branches.map(b => b.id));
    if (
      n.memory_limit !== undefined &&
      (!Number.isSafeInteger(n.memory_limit) || Number(n.memory_limit) < 0 || Number(n.memory_limit) > 60)
    )
      throw bad('Shared Memory membutuhkan batas 0–60 pesan.');
    const coord = (v: unknown) => {
      if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > 20000) throw bad('Posisi node tidak valid.');
      return v;
    };
    return {
      id: id(n.id),
      type: choice(n.type, nodeTypes),
      label: text(n.label, 100),
      x: coord(n.x),
      y: coord(n.y),
      prompt: text(n.prompt ?? ''),
      tier: choice(n.tier ?? 'medium', modelTiers),
      model: text(n.model ?? '', 100),
      tools: list(n.tools ?? [], 20).map(id),
      branches,
      ...(n.context_format !== undefined ? { context_format: choice(n.context_format, ['text', 'spo'] as const) } : {}),
      ...(n.capability ? { capability: choice(n.capability, businessTools) } : {}),
      ...(n.fallback !== undefined ? { fallback: n.fallback === true } : {}),
      collection: text(n.collection ?? '', 32),
      operation: choice(n.operation ?? 'search', toolOperations),
      value: text(n.value ?? '{}'),
      query: text(n.query ?? '', 2000),
      field: text(n.field ?? '', 200),
      operator: choice(n.operator ?? 'equals', conditionOperators),
      compare: text(n.compare ?? '', 2000),
      ...(n.filters !== undefined
        ? {
            filters: list(n.filters, 20).map(v => {
              const f = record(v);
              return { field: id(f.field), operator: choice(f.operator, filterOperators), value: text(f.value, 2000) };
            }),
          }
        : {}),
      ...(n.match !== undefined ? { match: choice(n.match, ['all', 'any'] as const) } : {}),
      ...(n.sort_field !== undefined ? { sort_field: n.sort_field === '' ? '' : id(n.sort_field) } : {}),
      ...(n.sort_direction !== undefined ? { sort_direction: choice(n.sort_direction, ['asc', 'desc'] as const) } : {}),
      ...(n.limit !== undefined ? { limit: limit(n.limit) } : {}),
      ...(n.sum_field !== undefined ? { sum_field: n.sum_field === '' ? '' : id(n.sum_field) } : {}),
      ...(n.rules !== undefined ? { rules: list(n.rules, 20).map(rule) } : {}),
      ...(n.fields !== undefined ? { fields: list(n.fields, 30).map(extractField) } : {}),
      ...(n.steps !== undefined ? { steps: list(n.steps, 20).map(computeStep) } : {}),
      ...(n.caption !== undefined ? { caption: text(n.caption, 1000) } : {}),
      ...(n.send_when !== undefined ? { send_when: choice(n.send_when, ['before', 'after'] as const) } : {}),
      ...(n.media_as !== undefined ? { media_as: choice(n.media_as, ['auto', 'image', 'document'] as const) } : {}),
      ...(n.memory !== undefined ? { memory: n.memory === '' ? '' : id(n.memory) } : {}),
      ...(n.memory_limit !== undefined ? { memory_limit: Number(n.memory_limit) } : {}),
    };
  });
  unique(nodes.map(n => n.id));
  const edges = list(root.edges, 180).map(v => {
    const e = record(v);
    return { id: id(e.id), source: id(e.source), target: id(e.target), port: text(e.port, 32) };
  });
  unique(edges.map(e => e.id));
  for (const n of nodes)
    if (n.type === 'condition' && !n.rules)
      Object.assign(n, { rules: [{ field: n.field, operator: n.operator, compare: n.compare }], match: 'all' });
  return normalizeMemoryConnections(
    normalizeRecordPorts({
      format: 'ncwa-profile',
      version: 1,
      name: text(root.name, 100),
      description: text(root.description ?? '', 1000),
      collections,
      nodes,
      edges,
    }),
  );
}
function limit(v: unknown) {
  if (!Number.isSafeInteger(v) || Number(v) < 1 || Number(v) > maxToolLimit)
    throw bad('Batas hasil harus 1–' + maxToolLimit + '.');
  return Number(v);
}
function extractField(v: unknown): ExtractField {
  const f = record(v);
  return {
    id: id(f.id),
    label: text(f.label ?? f.id, 100),
    type: choice(f.type, extractFieldTypes),
    required: f.required === true,
    hint: text(f.hint ?? '', 500),
    options: list(f.options ?? [], 100).map(v => text(v, 100)),
  };
}
function computeStep(v: unknown): ComputeStep {
  const s = record(v);
  const op = choice(s.op, Object.keys(computeArity) as ComputeOp[]);
  const args = list(s.args ?? [], 2).map(v => text(v, 2000));
  if (args.length !== computeArity[op]) throw bad('Operasi ' + op + ' membutuhkan ' + computeArity[op] + ' nilai.');
  return { name: id(s.name), op, args };
}
function leaf(v: unknown): ConditionRule {
  const r = record(v);
  return {
    field: text(r.field, 200),
    operator: choice(r.operator, conditionOperators),
    compare: text(r.compare ?? '', 2000),
  };
}
function rule(v: unknown): ConditionRule | ConditionGroup {
  const r = record(v);
  if (r.rules === undefined) return leaf(r);
  return { match: choice(r.match, ['all', 'any'] as const), rules: list(r.rules, 20).map(leaf) };
}
const recordLookup = (n: GraphNode) => n.type === 'tool' && !n.capability && ['search', 'get'].includes(n.operation);
// Cari/Ambil dulu hanya punya port "next". Definisi lama tetap berjalan sama: kedua port baru menuju tujuan lama.
export function normalizeRecordPorts(d: GraphDefinition): GraphDefinition {
  for (const n of d.nodes.filter(recordLookup)) {
    const old = d.edges.find(e => e.source === n.id && e.port === 'next');
    if (!old) continue;
    old.port = 'found';
    if (d.edges.some(e => e.source === n.id && e.port === 'empty')) continue;
    let edgeId = old.id.slice(0, 26) + '_empty';
    for (let i = 2; d.edges.some(e => e.id === edgeId); i++) edgeId = old.id.slice(0, 24) + '_empty' + i;
    d.edges.push({ id: edgeId, source: n.id, port: 'empty', target: old.target });
  }
  return d;
}
export const conditionRules = (n: GraphNode): ConditionRule[] =>
  (n.rules ?? [{ field: n.field, operator: n.operator, compare: n.compare }]).flatMap(r =>
    'rules' in r ? r.rules : [r],
  );
export const memoryConsumers = ['router', 'agent', 'context', 'extract'];
// Membaca draft lama yang menempatkan memori di jalur eksekusi sebagai sambungan resource.
export function normalizeMemoryConnections(d: GraphDefinition): GraphDefinition {
  for (const m of d.nodes.filter(n => n.type === 'memory')) {
    const out = d.edges.filter(e => e.source === m.id),
      incoming = d.edges.filter(e => e.target === m.id);
    if (out.length !== 1 || !incoming.length || out[0].target === m.id) continue;
    const seen = new Set<string>();
    const visit = (id: string) => {
      if (seen.has(id)) return;
      seen.add(id);
      const n = d.nodes.find(n => n.id === id);
      if (!n || n.type === 'memory') return;
      if (memoryConsumers.includes(n.type) && n.memory === undefined) n.memory = m.id;
      for (const e of d.edges.filter(e => e.source === id)) visit(e.target);
    };
    visit(out[0].target);
    for (const e of incoming) e.target = out[0].target;
    d.edges = d.edges.filter(e => e.source !== m.id);
  }
  return d;
}
export function ports(node: GraphNode): string[] {
  if (['output', 'fallback', 'memory'].includes(node.type)) return [];
  if (node.type === 'router') return node.branches.map(b => b.id);
  if (node.type === 'agent' && node.fallback) return ['next', 'fallback'];
  if (node.type === 'condition') return ['yes', 'no'];
  if (recordLookup(node)) return ['found', 'empty'];
  return ['next'];
}
export function validateGraph(d: GraphDefinition): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const add = (message: string, node?: string) => issues.push({ message, node });
  const nodes = new Map(d.nodes.map(n => [n.id, n]));
  if (!d.name.trim()) add('Nama profil wajib diisi.');
  const inputs = d.nodes.filter(n => n.type === 'input');
  if (inputs.length !== 1) add('Alur membutuhkan tepat satu Input.');
  for (const e of d.edges) {
    if (!nodes.has(e.source) || !nodes.has(e.target)) add('Koneksi mengacu pada node yang tidak ada.', e.source);
    else if (!ports(nodes.get(e.source)!).includes(e.port) || ['input', 'memory'].includes(nodes.get(e.target)!.type))
      add('Port koneksi tidak sesuai.', e.source);
  }
  const linkedTools = new Set(d.nodes.flatMap(n => n.tools));
  for (const n of d.nodes) {
    if (n.memory && (!memoryConsumers.includes(n.type) || nodes.get(n.memory)?.type !== 'memory'))
      add('Sambungan memori harus berasal dari Shared Memory menuju Router, Agent, Context, atau Ekstrak.', n.id);
    if (['agent', 'context'].includes(n.type) && !n.prompt.trim()) add('Prompt wajib diisi.', n.id);
    if (n.type === 'extract') {
      const fields = n.fields ?? [];
      if (!fields.length) add('Tambahkan minimal satu field untuk Ekstrak.', n.id);
      if (new Set(fields.map(f => f.id)).size !== fields.length) add('ID field Ekstrak harus unik.', n.id);
      if (fields.some(f => f.id === 'missing')) add('ID field "missing" dipakai sistem.', n.id);
      for (const f of fields)
        if (['choice', 'multichoice'].includes(f.type) && !f.options.length)
          add('Field pilihan ' + f.id + ' membutuhkan opsi.', n.id);
    }
    if (n.type === 'media' && !n.value.trim()) add('Isi file yang dikirim, misalnya variabel field File.', n.id);
    if (n.type === 'compute') {
      const steps = n.steps ?? [];
      if (!steps.length) add('Tambahkan minimal satu langkah.', n.id);
      if (new Set(steps.map(s => s.name)).size !== steps.length) add('Nama hasil setiap langkah harus unik.', n.id);
    }
    if (n.tier === 'decision' && n.type !== 'router') add('Tier Keputusan hanya untuk Router.', n.id);
    if (n.type === 'router' && n.branches.length < 2) add('Router membutuhkan minimal dua cabang.', n.id);
    if (n.context_format && n.type !== 'context') add('Format konteks hanya untuk node Context.', n.id);
    if (n.capability && n.type !== 'tool') add('Operasi bisnis hanya untuk Tool.', n.id);
    if (n.fallback && n.type !== 'agent') add('Port fallback hanya untuk Agent.', n.id);
    const collection = d.collections.find(c => c.id === n.collection);
    if (n.type === 'tool' && !n.capability && !collection) add('Pilih koleksi untuk node Data.', n.id);
    if (n.type === 'tool' && !n.capability && collection) {
      for (const f of n.filters ?? [])
        if (!collection.fields.some(x => x.id === f.field))
          add('Field filter ' + f.field + ' tidak ada di koleksi ' + collection.name + '.', n.id);
      if (n.sort_field && n.sort_field !== 'created_at' && !collection.fields.some(x => x.id === n.sort_field))
        add('Field urutan ' + n.sort_field + ' tidak ada di koleksi ' + collection.name + '.', n.id);
      if (n.sum_field && !collection.fields.some(x => x.id === n.sum_field && x.type === 'number'))
        add('Field yang dijumlahkan harus bertipe angka.', n.id);
      if (['get', 'delete'].includes(n.operation) && d.edges.some(e => e.target === n.id) && !n.query.trim())
        add('Isi ID record untuk operasi Ambil atau Hapus.', n.id);
    }
    for (const tool of n.tools)
      if (!nodes.has(tool)) add('Tool belum tersedia: ' + tool + '.', n.id);
      else if (n.type !== 'agent' || nodes.get(tool)?.type !== 'tool')
        add('Agent hanya dapat memakai node Tool.', n.id);
    if (n.type === 'tool' && linkedTools.has(n.id) && !d.edges.some(e => e.source === n.id || e.target === n.id))
      continue;
    for (const port of ports(n))
      if (d.edges.filter(e => e.source === n.id && e.port === port).length !== 1)
        add('Hubungkan tepat satu tujuan pada port ' + port + '.', n.id);
  }
  const visiting = new Set<string>(),
    visited = new Set<string>();
  function walk(node: string) {
    if (visiting.has(node)) {
      add('Siklus tidak diizinkan.', node);
      return;
    }
    if (visited.has(node)) return;
    visiting.add(node);
    for (const e of d.edges.filter(e => e.source === node)) walk(e.target);
    visiting.delete(node);
    visited.add(node);
  }
  for (const n of d.nodes) walk(n.id);
  const reachable = new Set<string>();
  function reach(node: string) {
    if (reachable.has(node)) return;
    reachable.add(node);
    for (const e of d.edges.filter(e => e.source === node)) reach(e.target);
  }
  if (inputs[0]) reach(inputs[0].id);
  for (const n of d.nodes)
    if (
      n.type !== 'memory' &&
      !reachable.has(n.id) &&
      !(n.type === 'tool' && d.nodes.some(a => reachable.has(a.id) && a.tools.includes(n.id)))
    )
      add('Node tidak terhubung dari Input.', n.id);
  // Referensi node harus tersedia pada setiap jalur menuju pemakai, bukan hanya salah satu cabang.
  const ancestors = (id: string, blocked: string, seen = new Set<string>()): boolean => {
    if (id === blocked || seen.has(id)) return false;
    if (nodes.get(id)?.type === 'input') return true;
    seen.add(id);
    return d.edges.filter(e => e.target === id).some(e => ancestors(e.source, blocked, seen));
  };
  for (const n of d.nodes) {
    if (n.type === 'condition' && (!conditionRules(n).length || conditionRules(n).some(r => !r.field.trim())))
      add('Isi nilai yang diperiksa pada setiap syarat Kondisi.', n.id);
    if (n.type === 'tool' && !n.capability && ['create', 'update'].includes(n.operation)) {
      try {
        JSON.parse(n.value);
      } catch {
        add('Pemetaan tool harus JSON valid.', n.id);
      }
    }
    // Langkah Set / Hitung boleh memakai hasil langkah sebelumnya di node yang sama.
    const earlier = (step: number) => new Set((n.steps ?? []).slice(0, step).map(s => s.name));
    const values: [string, number][] = [
      [n.prompt, -1],
      [n.query, -1],
      [n.value, -1],
      [n.caption ?? '', -1],
      ...(n.filters ?? []).map(f => [f.value, -1] as [string, number]),
      ...(n.type === 'condition'
        ? conditionRules(n).flatMap(r => [
            ['{{' + r.field + '}}', -1] as [string, number],
            [r.compare, -1] as [string, number],
          ])
        : []),
      ...(n.type === 'compute' ? (n.steps ?? []).flatMap((s, i) => s.args.map(a => [a, i] as [string, number])) : []),
    ];
    for (const [value, step] of values)
      for (const match of value.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) {
        const path = match[1].split('.');
        if (step >= 0 && path[0] === 'nodes' && path[1] === n.id) {
          if (!earlier(step).has(path[2] ?? ''))
            add('Hasil ' + match[1] + ' belum dihitung pada langkah sebelumnya.', n.id);
          continue;
        }
        if (
          path.some(p => ['__proto__', 'constructor', 'prototype'].includes(p)) ||
          !['input', 'nodes', ...Object.keys(contextVariables)].includes(path[0])
        )
          add('Path variabel tidak diizinkan.', n.id);
        if (contextVariables[path[0]] && !contextVariables[path[0]].includes(path[1] ?? ''))
          add('Variabel ' + match[1] + ' tidak dikenal.', n.id);
        if (path[0] === 'input' && path[1] && !['message', 'context', 'history'].includes(path[1]))
          add('Field input tidak dikenal: ' + path[1] + '.', n.id);
        if (path[0] === 'nodes') {
          const source = nodes.get(path[1]);
          if (source && path[2]) {
            const fields: Record<NodeType, string[]> = {
              input: ['message', 'context', 'history'],
              memory: ['history', 'context'],
              agent: ['answer', 'fallback', 'question'],
              router: ['branch', 'fallback_terkait'],
              condition: ['matched'],
              context: ['context'],
              tool: source.capability
                ? ['knowledge', 'products', 'order', 'available', 'reason', 'product_name', 'image_id']
                : recordOutputs[source.operation],
              output: [],
              fallback: [],
              extract: [...(source.fields ?? []).map(f => f.id), 'missing'],
              compute: (source.steps ?? []).map(s => s.name),
              media: ['files', 'count', 'skipped'],
            };
            if (!fields[source.type].includes(path[2])) add('Field keluaran ' + match[1] + ' tidak dikenal.', n.id);
          }
          if (
            !source ||
            source.id === n.id ||
            (source.type === 'memory' ? n.memory !== source.id : ancestors(n.id, path[1]))
          )
            add('Variabel ' + match[1] + ' belum tersedia pada semua jalur.', n.id);
        }
      }
  }
  return issues;
}
// Keluaran node Data per operasi; Cari dan Ambil memakai bentuk yang sama supaya jalur berikutnya tidak berubah.
export const recordOutputs: Record<ToolOperation, string[]> = {
  search: ['records', 'count', 'first', 'has_more'],
  get: ['records', 'count', 'first', 'has_more'],
  count: ['count', 'total'],
  create: ['id', 'data', 'revision', 'customer', 'deleted'],
  update: ['id', 'data', 'revision', 'customer', 'deleted'],
  delete: ['id', 'deleted'],
};
export function assertRunnable(d: GraphDefinition) {
  const issues = validateGraph(d);
  if (issues.length) throw bad(issues.map(i => (i.node ? i.node + ': ' : '') + i.message).join('\n'));
}
const validDay = (v: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
export const validTime = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
// Nomor disimpan sebagai digit saja; awalan 0 lokal diubah menjadi 62 supaya sama dengan nomor WhatsApp pelanggan.
export function normalizePhone(v: string) {
  const digits = v
    .trim()
    .replace(/[\s().-]/g, '')
    .replace(/^\+/, '');
  const phone = digits.startsWith('0') ? '62' + digits.slice(1) : digits;
  return /^\d{5,20}$/.test(phone) ? phone : null;
}
// Memeriksa dan menormalkan satu nilai field; nilai kosong ditangani pemanggil.
export function fieldValue(f: Field, v: unknown): unknown {
  const wrong = () => bad('Tipe field ' + f.label + ' tidak sesuai.');
  switch (f.type) {
    case 'number':
      if (typeof v !== 'number' || !Number.isFinite(v)) throw wrong();
      return v;
    case 'boolean':
      if (typeof v !== 'boolean') throw wrong();
      return v;
    case 'multichoice': {
      if (!Array.isArray(v) || v.some(x => typeof x !== 'string')) throw wrong();
      if (v.some(x => !f.options.includes(x as string))) throw bad('Pilihan ' + f.label + ' tidak valid.');
      return [...new Set(v as string[])];
    }
  }
  if (typeof v !== 'string' || v.length > 8000) throw wrong();
  switch (f.type) {
    case 'choice':
      if (!f.options.includes(v)) throw bad('Pilihan ' + f.label + ' tidak valid.');
      return v;
    case 'date':
      if (!validDay(v)) throw bad('Tanggal tidak valid.');
      return v;
    case 'time':
      if (!validTime(v)) throw bad('Jam ' + f.label + ' harus berformat JJ:MM.');
      return v;
    case 'datetime':
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) || !validDay(v.slice(0, 10)) || !validTime(v.slice(11)))
        throw bad('Tanggal-jam ' + f.label + ' harus berformat YYYY-MM-DDTJJ:MM.');
      return v;
    case 'phone': {
      const phone = normalizePhone(v);
      if (!phone) throw bad('Nomor telepon ' + f.label + ' tidak valid.');
      return phone;
    }
    case 'relation':
    case 'file':
      if (!/^[0-9a-f-]{36}$/.test(v) && f.type === 'relation') throw bad('ID relasi tidak valid.');
      if (f.type === 'file' && (!v.trim() || v.length > 255)) throw bad('File ' + f.label + ' tidak valid.');
      return v;
    default:
      return v;
  }
}
// create: field kosong diisi nilai bawaannya. Daftar pilihan ganda yang kosong dianggap tidak diisi.
export function validateRecord(c: Collection, value: unknown, create = false): Record<string, unknown> {
  const data = record(value),
    result: Record<string, unknown> = {};
  if (Object.keys(data).some(k => !c.fields.some(f => f.id === k))) throw bad('Field data tidak dikenal.');
  for (const f of c.fields) {
    let v = data[f.id];
    const empty = (x: unknown) => x === undefined || x === null || x === '' || (Array.isArray(x) && !x.length);
    if (empty(v) && create && f.default !== undefined) v = f.default;
    if (empty(v)) {
      if (f.required) throw bad(f.label + ' wajib diisi.');
      continue;
    }
    result[f.id] = fieldValue(f, v);
  }
  return result;
}
export function blankDefinition(name = 'Profil baru'): GraphDefinition {
  const node = (id: string, type: NodeType, x: number, prompt = ''): GraphNode => ({
    id,
    type,
    label: type === 'input' ? 'Pesan masuk' : type === 'agent' ? 'Asisten' : 'Jawaban',
    x,
    y: 240,
    prompt,
    tier: 'medium',
    model: '',
    tools: [],
    branches: [],
    collection: '',
    operation: 'search',
    value: '{}',
    query: '',
    field: '',
    operator: 'equals',
    compare: '',
  });
  return {
    format: 'ncwa-profile',
    version: 1,
    name,
    description: '',
    collections: [],
    nodes: [
      node('input', 'input', 80),
      node('agent', 'agent', 420, 'Jawab ramah dan ringkas berdasarkan informasi yang tersedia.'),
      { ...node('output', 'output', 760), value: '{{nodes.agent.answer}}' },
    ],
    edges: [
      { id: 'e1', source: 'input', port: 'next', target: 'agent' },
      { id: 'e2', source: 'agent', port: 'next', target: 'output' },
    ],
  };
}
