// Simulasi graf memakai record sementara dan riwayat eksplisit, tanpa penulisan data klien atau WhatsApp.
import { randomUUID } from 'node:crypto';
import { record } from '../../../../libraries/validation.js';
import { ApiError } from '../../../../libraries/errors.js';
import { ai } from '../service.js';
import type { AITraceEvent } from '../pipeline/models.js';
import type { AIMessage, AITransport } from '../provider.js';
import { collectionKind, parseDefinition, validateRecord, text, type Collection } from './definition.js';
import { keywords, queryMemory, sumMemory, filterGroup, type StoredRecord } from './record-query.js';
import { runRecordTool, type RecordAdapter } from './record-tools.js';
import { previewMedia } from './media.js';
// Nomor pelanggan tiruan untuk koleksi milik pelanggan di simulasi.
export const simulationCustomer = '628000000001';
import { runGraph } from './engine.js';
import { transientAIError } from '../pipeline/retry.js';
export async function simulate(
  actor: string,
  value: unknown,
  emit: (e: AITraceEvent) => void,
  signal: AbortSignal,
  transport: AITransport = ai.transport,
) {
  const body = record(value),
    d = parseDefinition(body.definition),
    message = text(body.message, 4000);
  // Lampiran contoh untuk node Terima media; tidak ada file sungguhan, nama file dipakai sebagai nilainya.
  let incomingMedia;
  if (body.media !== undefined && body.media !== null) {
    const m = record(body.media);
    const filename = text(m.filename, 255).trim();
    if (!filename || !['image', 'document'].includes(String(m.type)))
      throw new ApiError(400, 'invalid_request', 'Lampiran simulasi membutuhkan nama file dan jenis gambar/dokumen.');
    incomingMedia = {
      file: filename,
      filename,
      type: m.type as 'image' | 'document',
      mimetype: m.type === 'image' ? 'image/jpeg' : 'application/octet-stream',
      caption: message.trim(),
    };
  }
  const history: AIMessage[] = [];
  if (body.history !== undefined) {
    if (!Array.isArray(body.history) || body.history.length > 60)
      throw new ApiError(400, 'invalid_request', 'Maksimal 60 pesan riwayat.');
    for (const v of body.history) {
      const m = record(v);
      if (!['user', 'assistant'].includes(String(m.role)))
        throw new ApiError(400, 'invalid_request', 'Peran riwayat tidak valid.');
      history.push({ role: m.role as 'user' | 'assistant', content: text(m.content, 8000) });
    }
  }
  // Record contoh koleksi milik pelanggan tanpa nomor dianggap milik pelanggan simulasi.
  const sample = record(body.records ?? {}),
    records: Record<string, StoredRecord[]> = {};
  for (const c of d.collections) {
    // Contoh koleksi teks boleh berupa string, dan isian berupa satu objek; keduanya disimpan sebagai satu record.
    const given = sample[c.id],
      rows =
        collectionKind(c) === 'text' && typeof given === 'string'
          ? [{ text: given }]
          : collectionKind(c) === 'form' && given && typeof given === 'object' && !Array.isArray(given)
            ? [given]
            : (given ?? []);
    if (!Array.isArray(rows) || rows.length > 100)
      throw new ApiError(400, 'invalid_request', 'Maksimal 100 record simulasi per koleksi.');
    records[c.id] = rows.map(v => {
      const r = record(v);
      // Pada format datar, kunci "customer" adalah pemilik record kecuali koleksinya punya field bernama customer.
      const ownerKey = c.owner === 'customer' && !c.fields.some(f => f.id === 'customer');
      const { customer, ...fields } = ownerKey ? r : { ...r, customer: undefined };
      const owner =
        c.owner === 'customer'
          ? { customer: typeof customer === 'string' && customer ? customer : simulationCustomer }
          : {};
      return Object.hasOwn(r, 'data') && typeof r.id === 'string' && Number.isSafeInteger(r.revision)
        ? { id: r.id, data: validateRecord(c, r.data), revision: Number(r.revision), ...owner }
        : { id: randomUUID(), data: validateRecord(c, ownerKey ? fields : r), revision: 1, ...owner };
    });
  }
  const config = { ...(await ai.config()), signal, onTrace: emit };
  const wrapped: AITransport = async (c, m, max) => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      c.signal?.throwIfAborted();
      const start = Date.now();
      emit({ node: c.trace_node ?? c.call_role ?? 'model', state: 'running', model: c.model, attempt });
      try {
        const out = await transport(c, m, max);
        emit({
          node: c.trace_node ?? c.call_role ?? 'model',
          state: 'responded',
          output: out,
          model: c.model,
          duration_ms: Date.now() - start,
        });
        return out;
      } catch (e) {
        if (attempt === 3 || !transientAIError(e)) throw e;
        await new Promise(r => setTimeout(r, attempt * 300));
      }
    }
    throw Error('ai_retry_limit');
  };
  const result = await runGraph(
    d,
    wrapped,
    config,
    [...history, { role: 'user', content: message }],
    {
      account: actor,
      profile: 'simulation',
      session: 'simulation',
      customer: simulationCustomer,
      customerName: 'Pelanggan simulasi',
      serviceName: 'Data profil simulasi',
      incomingMedia,
      requestId: randomUUID(),
      fallbackEnabled: true,
    },
    typeof body.context === 'string' ? text(body.context, 200) : null,
    (n, v, key) => runRecordTool(memoryRecords(records), d, n, v, key),
    300,
    previewMedia,
  );
  emit({
    node: 'output',
    state: 'completed',
    output: {
      ...result,
      context: config.graph_context ?? null,
      records,
    },
  });
}
// Penyimpanan record sementara untuk satu simulasi; aturan kepemilikan, relasi, dan revisi sama dengan database.
function memoryRecords(records: Record<string, StoredRecord[]>): RecordAdapter {
  const visible = (c: Collection) =>
    records[c.id].filter(r => c.owner !== 'customer' || r.customer === simulationCustomer);
  const query = (c: Collection, s: import('./store.js').RecordSearch) =>
    queryMemory(visible(c), {
      keywords: keywords(s.keyword ?? ''),
      groups: s.groups ?? [],
      sort: s.sort ?? { field: 'created_at', type: 'created_at', direction: 'asc' },
      limit: s.limit ?? 100,
      offset: 0,
    });
  return {
    search: async (c, s) => {
      const rows = query(c, s);
      return { records: rows.slice(0, s.limit ?? 100), has_more: rows.length > (s.limit ?? 100) };
    },
    count: async (c, s, sum) => {
      const rows = query(c, s);
      return { count: rows.length, total: sum ? sumMemory(rows, sum) : 0 };
    },
    get: async (c, id) => visible(c).find(r => r.id === id) ?? null,
    write: async (c, operation, value, _key) => {
      const input = record(value);
      const owner = c.owner === 'customer' ? { customer: simulationCustomer } : {};
      if (operation === 'create') {
        const row = { id: randomUUID(), data: validateRecord(c, input.data, true), revision: 1, ...owner };
        relations(c, row.data);
        unique(c, row.data, row.id);
        records[c.id].push(row);
        return { ...row, deleted: false };
      }
      const row = visible(c).find(r => r.id === input.id);
      if (!row || (input.revision !== undefined && row.revision !== input.revision))
        throw new ApiError(409, 'record_conflict', 'Record simulasi tidak ditemukan atau berubah.');
      if (operation === 'delete') {
        records[c.id] = records[c.id].filter(r => r !== row);
        return { id: row.id, data: {}, revision: row.revision + 1, deleted: true, ...owner };
      }
      const next = { ...row.data };
      for (const [field, v] of Object.entries(record(input.data)))
        if (v === null || v === '') delete next[field];
        else next[field] = v;
      unique(c, validateRecord(c, next), row.id);
      row.data = validateRecord(c, next);
      relations(c, row.data);
      row.revision++;
      return { ...row, deleted: false };
    },
  };
  // Sama dengan assertUnique di store: seluruh record koleksi, memakai aturan "sama dengan" pencarian.
  function unique(c: Collection, data: Record<string, unknown>, self: string) {
    for (const f of c.fields.filter(f => f.unique && data[f.id] !== undefined)) {
      const same = queryMemory(records[c.id], {
        keywords: [],
        groups: [filterGroup(c, [{ field: f.id, operator: 'equals', value: String(data[f.id]) }])],
        sort: { field: 'created_at', type: 'created_at', direction: 'asc' },
        limit: 2,
        offset: 0,
      });
      if (same.some(r => r.id !== self))
        throw new ApiError(
          409,
          'duplicate_value',
          f.label + ' "' + String(data[f.id]) + '" sudah dipakai record lain.',
        );
    }
  }
  function relations(c: Collection, data: Record<string, unknown>) {
    for (const f of c.fields.filter(f => f.type === 'relation'))
      if (data[f.id] && !records[f.collection]?.some(r => r.id === data[f.id]))
        throw new ApiError(400, 'invalid_relation', 'Record relasi simulasi tidak ditemukan.');
  }
}
