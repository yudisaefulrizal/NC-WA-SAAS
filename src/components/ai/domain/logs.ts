// Log untuk pemilik: pemakaian model, kegagalan agent beserta prompt-nya, dan jejak lengkap setiap node dalam
// satu request.
import { request } from 'node:https';
import { db } from '../../../libraries/db.js';
import { ApiError } from '../../../libraries/errors.js';
import { fail } from './input-validation.js';
import type { AIService } from './service.js';
import * as agentFailuresSql from '../data-access/agent-failures-queries.js';
import * as traceLogSql from '../data-access/trace-log-queries.js';
import * as usageSql from '../data-access/usage-queries.js';
export async function modelUsage(svc: AIService) {
  const [rows] = await usageSql.listLatest(db);
  return rows;
}
export async function agentFailures(svc: AIService, value: unknown) {
  if (typeof value !== 'string' || !/^\d{1,9}$/.test(value) || Number(value) < 1) throw fail('Halaman tidak valid');
  const size = 20;
  const [counts] = await agentFailuresSql.count(db);
  const total = Number(counts[0].total),
    pages = Math.max(1, Math.ceil(total / size)),
    page = Math.min(Number(value), pages);
  const [items] = await agentFailuresSql.listPage(db, size, page);
  return { items, page, pages, total, page_size: size };
}
export async function agentFailureDetail(svc: AIService, id: unknown) {
  if (typeof id !== 'string' || !/^\d{1,20}$/.test(id)) throw fail('ID kegagalan tidak valid');
  const [rows] = await agentFailuresSql.findDetail(db, [id]);
  if (!rows[0]) throw new ApiError(404, 'not_found', 'Detail kegagalan tidak ditemukan');
  return { prompt: rows[0].prompt, raw_output: rows[0].raw_output, router_context: rows[0].router_context };
}
export async function traceRequests(svc: AIService, value: unknown) {
  if (typeof value !== 'string' || !/^\d{1,9}$/.test(value) || Number(value) < 1) throw fail('Halaman tidak valid');
  const size = 20;
  const [counts] = await traceLogSql.countRequests(db);
  const total = Number(counts[0].total),
    pages = Math.max(1, Math.ceil(total / size)),
    page = Math.min(Number(value), pages);
  const [items] = await traceLogSql.listRequestsPage(db, size, page);
  return { items, page, pages, total, page_size: size };
}
export async function traceLog(svc: AIService, requestId: unknown) {
  if (typeof requestId !== 'string' || !/^[0-9a-f]{1,64}$/i.test(requestId)) throw fail('ID permintaan tidak valid');
  const [rows] = await traceLogSql.listByRequest(db, [requestId]);
  return rows;
}
