// Koneksi ke provider AI: pengaturan pemilik, profil provider dan rute per tier model, serta uji koneksi.
import { modelTiers, tierConfig, type ModelTier } from './pipeline/models.js';
import { randomUUID } from 'node:crypto';
import type { RowDataPacket } from 'mysql2/promise';
import { db } from '../../../libraries/db.js';
import { encrypt } from '../../../libraries/crypto.js';
import { ApiError } from '../../../libraries/errors.js';
import { validatePublicUrl } from '../../../libraries/download.js';
import { object } from '../../../libraries/validation.js';
import { AIProvider, AIConfig, defaults, provider, chatEndpoint } from './provider.js';
import { fail, integer, text } from './input-validation.js';
import { transaction } from './transaction.js';
import { parseMemory } from './memory.js';
import type { AIService } from './service.js';
import * as auditEventsSql from '../data-access/audit-events-queries.js';
import * as conversationsSql from '../data-access/conversations-queries.js';
import * as providerProfilesSql from '../data-access/provider-profiles-queries.js';
import * as providerRoutesSql from '../data-access/provider-routes-queries.js';
import * as settingsSql from '../data-access/settings-queries.js';
export async function loadConfig(svc: AIService): Promise<AIConfig> {
  const [rows] = await settingsSql.find(db);
  const stored = rows[0],
    host = new URL(stored?.endpoint ?? defaults.endpoint).hostname;
  const detected: AIProvider =
    host === 'openrouter.ai' ? 'openrouter' : host === 'ai.sumopod.com' ? 'sumopod' : 'compatible';
  const config: AIConfig = {
    ...defaults,
    ...(stored ?? {}),
    provider: detected,
    trace_enabled: Boolean(stored?.trace_enabled),
  };
  for (const tier of modelTiers) config[`model_${tier}`] = config[`model_${tier}`] || config.model;
  if (stored?.profile_routing_enabled) {
    try {
      // p.* menjaga routing tetap jalan bila kode berjalan sebelum `npm run migrate` menambah kolom tier baru; rute atau
      // model Terstruktur yang belum ada lalu memakai Murah, persis seperti yang akan diatur migrasi.
      const [routes] = await providerRoutesSql.listWithProfiles(db);
      const profiles: NonNullable<AIConfig['tier_profiles']> = Object.fromEntries(
        routes.map(r => [
          r.tier,
          {
            id: r.id,
            provider: r.provider,
            endpoint: r.endpoint,
            secret: r.secret,
            model: r['model_' + r.tier] || r.model_cheap,
          },
        ]),
      );
      if (!profiles.structured && profiles.cheap) profiles.structured = profiles.cheap;
      config.tier_profiles = profiles;
    } catch (error) {
      console.error(
        'Rute provider AI gagal dimuat; memakai konfigurasi lama.',
        error instanceof Error ? error.message : error,
      );
    }
  }
  return config;
}
export async function configuration(svc: AIService) {
  const { secret, workflow, onTrace, tier_profiles, ...config } = await svc.config();
  return { ...config, configured: Boolean(secret), apiKey: secret ? '********' : null };
}
export async function providerProfiles(svc: AIService) {
  try {
    // SELECT * supaya daftar tetap tampil sebelum `npm run migrate` menambah kolom tier baru; secret tidak pernah
    // keluar dari server.
    const [all] = await providerProfilesSql.listAll(db);
    const rows = all.map(({ secret, ...profile }) => profile);
    const [routes] = await providerRoutesSql.listAll(db);
    return { profiles: rows, routes };
  } catch {
    return { profiles: [], routes: [] };
  }
}
export async function saveProviderProfile(svc: AIService, body: unknown) {
  const input = object(body),
    id = typeof input.id === 'string' ? input.id : '';
  const name = text(input.name, 100, 'Nama profil'),
    kind = provider(input.provider),
    endpoint = chatEndpoint(text(input.endpoint, 512, 'Endpoint')),
    host = new URL(endpoint).hostname;
  if (kind === 'openrouter' && host !== 'openrouter.ai') throw fail('Endpoint OpenRouter harus memakai openrouter.ai');
  if (kind === 'sumopod' && host !== 'ai.sumopod.com') throw fail('Endpoint Sumopod harus memakai ai.sumopod.com');
  const active = input.active !== false;
  const [old] = id ? await providerProfilesSql.findSecret(db, [id]) : [[] as RowDataPacket[]];
  if (id && !old[0]) throw new ApiError(404, 'not_found', 'Profil provider tidak ditemukan');
  const models = Object.fromEntries(modelTiers.map(tier => [tier, text(input['model_' + tier], 100, 'Model ' + tier)]));
  if (Object.values(models).some(model => !model)) throw fail('Model tiap tingkat wajib diisi');
  let secret = old[0]?.secret ?? '';
  if (input.apiKey !== undefined && input.apiKey !== '') {
    const key = text(input.apiKey, 512, 'API key');
    if (!key || /[\r\n]/.test(key)) throw fail('API key tidak valid');
    secret = encrypt(key);
  }
  if (!secret) throw fail('API key wajib diisi');
  const profileId = id || randomUUID();
  await providerProfilesSql.upsert(db, [
    profileId,
    name,
    kind,
    endpoint,
    secret,
    models.cheap,
    models.medium,
    models.smart,
    models.structured,
    active,
  ]);
  return { id: profileId };
}
export async function deleteProviderProfile(svc: AIService, id: unknown) {
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) throw fail('ID profil tidak valid');
  const [routes] = await providerRoutesSql.listTiersOfProfile(db, [id]);
  if (routes.length)
    throw new ApiError(
      409,
      'profile_in_use',
      'Profil masih dipakai oleh tingkat ' +
        routes.map(r => r.tier).join(', ') +
        '. Pilih profil lain terlebih dahulu.',
    );
  const [result] = await providerProfilesSql.deleteById(db, [id]);
  if (!result.affectedRows) throw new ApiError(404, 'not_found', 'Profil provider tidak ditemukan');
  return { ok: true };
}
export async function setProviderRoutes(svc: AIService, body: unknown) {
  const input = object(body);
  for (const tier of modelTiers) {
    const route = object(input[tier]);
    if (typeof route.profileId !== 'string') throw fail('Rute ' + tier + ' tidak valid');
    const [profiles] = await providerProfilesSql.findActiveModel(db, [route.profileId], tier);
    if (!profiles[0] || !profiles[0].model) throw fail('Profil ' + tier + ' tidak aktif atau model belum diisi');
    await providerRoutesSql.upsert(db, [tier, route.profileId, profiles[0].model]);
  }
  await settingsSql.enableProfileRouting(db);
  return svc.providerProfiles();
}
export async function testProviderProfile(svc: AIService, body: unknown) {
  const input = object(body);
  const id = typeof input.id === 'string' ? input.id : '';
  const [rows] = await providerProfilesSql.findActiveConnection(db, [id]);
  if (!rows[0]) throw new ApiError(404, 'not_found', 'Profil provider tidak ditemukan');
  const model = text(input.model, 100, 'Model');
  if (!model) throw fail('Model wajib diisi');
  await svc.transport(
    { ...defaults, provider: rows[0].provider, endpoint: rows[0].endpoint, secret: rows[0].secret, model },
    [{ role: 'user', content: 'Balas hanya OK.' }],
    10,
  );
  return { ok: true };
}
export async function configure(svc: AIService, actor: string, body: unknown) {
  const input = object(body),
    previous = await svc.config();
  if (typeof input.trace_enabled !== 'boolean') throw fail('Status log lengkap wajib valid');
  const selectedProvider = provider(input.provider ?? previous.provider);
  const endpoint = chatEndpoint(text(input.endpoint, 512, 'Endpoint'));
  const host = new URL(endpoint).hostname;
  if (selectedProvider === 'openrouter' && host !== 'openrouter.ai')
    throw fail('Endpoint OpenRouter harus memakai openrouter.ai');
  if (selectedProvider === 'sumopod' && host !== 'ai.sumopod.com')
    throw fail('Endpoint Sumopod harus memakai ai.sumopod.com');
  const config: AIConfig = {
    provider: selectedProvider,
    endpoint,
    model: text(input.model_medium ?? input.model, 100, 'Model sedang'),
    secret: previous.secret,
    input_rate: integer(input.input_rate, 0, 1000, 'Tarif input'),
    output_rate: integer(input.output_rate, 1, 1000, 'Tarif output'),
    memory_limit: integer(input.memory_limit, 1, 100, 'Batas memori'),
    context_memory_limit: integer(input.context_memory_limit, 0, 100, 'Batas memori Context Agent'),
    trace_enabled: input.trace_enabled,
    credit_price: integer(input.credit_price, 0, 1000000, 'Harga per 10.000 kredit'),
    tidy_prompt: text(input.tidy_prompt ?? previous.tidy_prompt ?? '', 2000, 'Prompt rapikan pesan'),
  };
  for (const tier of modelTiers) {
    const key = `model_${tier}` as const;
    config[key] = text(
      input[key] ?? (tier === 'medium' ? config.model : previous[key]) ?? config.model,
      100,
      'Model ' + tier,
    );
    if (!config[key]) throw fail('Model ' + tier + ' wajib diisi');
  }
  if (!config.model) throw fail('Model wajib diisi');
  await validatePublicUrl(config.endpoint);
  if (input.apiKey !== undefined && input.apiKey !== '') {
    const key = text(input.apiKey, 512, 'API key');
    if (!key || /[\r\n]/.test(key)) throw fail('API key tidak valid');
    config.secret = encrypt(key);
  }
  if (!config.secret) throw fail('API key wajib diisi');
  await transaction(async c => {
    await settingsSql.upsert(c, [
      config.endpoint,
      config.model,
      config.secret,
      config.input_rate,
      config.output_rate,
      config.memory_limit,
      config.context_memory_limit,
      config.trace_enabled,
      config.credit_price,
      config.model_cheap ?? config.model,
      config.model_medium ?? config.model,
      config.model_smart ?? config.model,
      config.model_structured ?? config.model,
      config.tidy_prompt ?? '',
    ]);
    // Pemotongan JSON memangkas memori semua akun seketika tanpa membuka isi percakapan.
    const [rows] = await conversationsSql.lockAll(c);
    for (const row of rows)
      await conversationsSql.updateMessages(c, [
        JSON.stringify(parseMemory(row.messages).slice(-config.memory_limit)),
        row.account_id,
        row.session_id,
        row.customer,
      ]);
    await auditEventsSql.insertSettingsUpdated(c, [actor]);
  });
  return svc.configuration();
}
export async function testTier(svc: AIService, tier: unknown = 'medium') {
  if (!modelTiers.includes(tier as ModelTier)) throw fail('Tier model tidak valid');
  const config = tierConfig(await svc.config(), tier as ModelTier);
  if (!config.secret) throw fail('AI belum dikonfigurasi');
  try {
    await svc.transport(config, [{ role: 'user', content: 'Balas hanya OK.' }], 10);
    return {
      ok: true,
      tier,
      model: config.model,
      message: 'Koneksi model ' + tier + ' (' + config.model + ') berhasil diuji.',
    };
  } catch {
    throw new ApiError(
      502,
      'ai_provider_failed',
      'Koneksi model ' + tier + ' belum berhasil; periksa endpoint, key, dan model.',
    );
  }
}
