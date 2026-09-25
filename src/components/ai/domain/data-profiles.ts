// Data profil (isi milik klien untuk satu profil) dan data profil mana yang dijalankan setiap sesi: membuat,
// menggandakan, mengganti nama, menghapus, memasang ke sesi, dan menyimpan bidang-bidangnya.
import { profileDefinition, enabledProfiles } from './profiles/registry.js';
import { publicSources, sourceInput, saveSource, builtinSource } from './profiles/cs/store.js';
import { eduData } from './profiles/pendidikan/tools.js';
import { eduView, eduTextFields } from './profiles/pendidikan/profile.js';
import { randomUUID } from 'node:crypto';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { db } from '../../../libraries/db.js';
import { ApiError } from '../../../libraries/errors.js';
import { object } from '../../../libraries/validation.js';
import { recordNote } from './chat.js';
import { fail, text } from './input-validation.js';
import { profileFields, ProfileField, profileLabels, composeKnowledge } from './profiles/cs/knowledge.js';
import { faqLimit } from './profile-pipelines.js';
import { transaction, lockAccount } from './transaction.js';
import type { AIService } from './service.js';
import * as assistantsSql from '../data-access/assistants-queries.js';
import * as conversationsSql from '../data-access/conversations-queries.js';
import * as dataProfilesSql from '../data-access/data-profiles-queries.js';
import * as dataSourcesSql from '../data-access/data-sources-queries.js';
import * as productImagesSql from '../data-access/product-images-queries.js';
import * as productsSql from '../data-access/products-queries.js';
// Kolom isi data profil baru: disalin dari data profil lain, atau kosong.
export function eduColumns(from?: RowDataPacket) {
  return { edu_lembaga: String(from?.edu_lembaga ?? ''), edu_jadwal: String(from?.edu_jadwal ?? '') };
}
export async function sessionProfiles(svc: AIService, account: string) {
  const [rows] = await assistantsSql.listByAccount(db, [account]);
  return Object.fromEntries(
    rows.map(row => [
      String(row.session_id),
      {
        enabled: Boolean(row.enabled) && Boolean(row.id),
        profile: row.id ? { id: String(row.id), name: String(row.name), profile_type: String(row.profile_type) } : null,
      },
    ]),
  ) as Record<string, { enabled: boolean; profile: { id: string; name: string; profile_type: string } | null }>;
}
export async function setEnabled(svc: AIService, account: string, session: string, enabled: boolean) {
  await transaction(async c => {
    await lockAccount(c, account);
    if (enabled) await ensureDataProfile(svc, c, account, session);
    await assistantsSql.upsertEnabled(c, [account, session, enabled]);
  });
  return { enabled };
}
export async function ensureDataProfile(svc: AIService, c: PoolConnection, account: string, session: string) {
  const [rows] = await assistantsSql.lockDataProfileId(c, [account, session]);
  if (rows[0]?.data_profile_id) return String(rows[0].data_profile_id);
  if (!(await enabledProfiles()).has('cs'))
    throw new ApiError(409, 'profile_disabled', 'Profil CS Usaha sedang dinonaktifkan admin.');
  const id = await insertDataProfile(svc, c, account, 'cs', await uniqueName(svc, c, account, 'CS – ' + session));
  await assistantsSql.attachNew(c, [account, session, id]);
  return id;
}
export async function uniqueName(svc: AIService, c: PoolConnection, account: string, base: string) {
  const [rows] = await dataProfilesSql.lockNamesByAccount(c, [account]);
  const names = new Set(rows.map(row => String(row.name).toLowerCase()));
  let name = base.slice(0, 100);
  for (let n = 2; names.has(name.toLowerCase()); n++) name = base.slice(0, 94) + ' (' + n + ')';
  return name;
}
export async function insertDataProfile(
  svc: AIService,
  c: PoolConnection,
  account: string,
  type: string,
  name: string,
  from?: RowDataPacket,
) {
  const [count] = await dataProfilesSql.countByAccount(c, [account]);
  if (Number(count[0].n) >= 100) throw new ApiError(409, 'data_profile_limit', 'Maksimal 100 data profil per akun.');
  const id = randomUUID(),
    columns = profileFields.map(field => 'profil_' + field),
    edu = eduColumns(from);
  await dataProfilesSql.insert(
    c,
    [
      id,
      account,
      type,
      name,
      String(from?.behavior ?? ''),
      String(from?.fallback_number ?? ''),
      Boolean(from?.fallback_notify),
      ...columns.map(column => String(from?.[column] ?? '')),
      ...Object.values(edu),
    ],
    columns,
    edu,
  );
  return id;
}
export async function sessionProfile(svc: AIService, account: string, session: string) {
  const [rows] = await assistantsSql.findDataProfileId(db, [account, session]);
  return rows[0]?.data_profile_id ? String(rows[0].data_profile_id) : null;
}
export async function ensureSessionProfile(svc: AIService, account: string, session: string) {
  return transaction(async c => {
    await lockAccount(c, account);
    return ensureDataProfile(svc, c, account, session);
  });
}
export function dataProfileId(svc: AIService, value: unknown) {
  if (typeof value !== 'string' || !/^[0-9a-f-]{36}$/.test(value))
    throw new ApiError(404, 'data_profile_not_found', 'Data profil tidak ditemukan');
  return value;
}
export async function ownedDataProfile(svc: AIService, account: string, value: unknown) {
  const id = dataProfileId(svc, value);
  const [rows] = await dataProfilesSql.findOwned(db, [id, account]);
  if (!rows[0]) throw new ApiError(404, 'data_profile_not_found', 'Data profil tidak ditemukan');
  return id;
}
export async function profileType(svc: AIService, account: string, profile: string) {
  const [rows] = await dataProfilesSql.findType(db, [profile, account]);
  if (!rows[0]) throw new ApiError(404, 'data_profile_not_found', 'Data profil tidak ditemukan');
  return String(rows[0].profile_type);
}
export function profileView(svc: AIService, row: RowDataPacket) {
  const profile = Object.fromEntries(
    profileFields.map(field => [field, String(row['profil_' + field] ?? '')]),
  ) as Record<ProfileField, string>;
  return {
    profile,
    knowledge: row.profile_type === 'cs' ? composeKnowledge(profile) : '',
    behavior: String(row.behavior ?? ''),
    fallback_number: String(row.fallback_number ?? ''),
    fallback_notify: Boolean(row.fallback_notify),
    revision: Number(row.revision ?? 0),
    edu: row.profile_type === 'pendidikan' ? eduView(row) : null,
  };
}
export async function dataProfiles(svc: AIService, account: string) {
  const [rows] = await dataProfilesSql.listWithCounts(db, [account]);
  const [attached] = await assistantsSql.listAttachments(db, [account]);
  const enabled = await enabledProfiles();
  return rows.map(row => ({
    id: String(row.id),
    profile_type: String(row.profile_type),
    profile_name: profileDefinition(row.profile_type).name,
    profile_enabled: enabled.has(row.profile_type),
    name: String(row.name),
    products: Number(row.products),
    orders: Number(row.orders),
    programs: Number(row.programs),
    documents: Number(row.documents),
    contacts: Number(row.contacts),
    updated_at: row.updated_at,
    sessions: attached.filter(a => a.data_profile_id === row.id).map(a => String(a.session_id)),
  }));
}
export async function dataProfile(svc: AIService, account: string, value: unknown) {
  const id = dataProfileId(svc, value);
  const [rows] = await dataProfilesSql.find(db, [id, account]);
  const row = rows[0];
  if (!row) throw new ApiError(404, 'data_profile_not_found', 'Data profil tidak ditemukan');
  const [attached] = await assistantsSql.listSessionsOfProfile(db, [account, id]);
  return {
    id,
    profile_type: String(row.profile_type),
    profile_name: profileDefinition(row.profile_type).name,
    profile_enabled: (await enabledProfiles()).has(row.profile_type),
    name: String(row.name),
    sessions: attached.map(a => String(a.session_id)),
    ...profileView(svc, row),
    ...(await publicSources(account, id)),
  };
}
export async function createDataProfile(svc: AIService, account: string, body: unknown) {
  const input = object(body),
    name = text(input.name, 100, 'Nama data profil');
  if (!name) throw fail('Nama data profil wajib diisi');
  const copyFrom = input.copy_from === undefined ? undefined : dataProfileId(svc, input.copy_from);
  const images = new Map<string, string>(),
    documents: string[] = [];
  let id: string;
  try {
    id = await transaction(async c => {
      await lockAccount(c, account);
      let from: RowDataPacket | undefined, type: string;
      if (copyFrom) {
        const [rows] = await dataProfilesSql.share(c, [copyFrom, account]);
        from = rows[0];
        if (!from) throw new ApiError(404, 'data_profile_not_found', 'Data profil tidak ditemukan');
        type = String(from.profile_type);
      } else type = profileDefinition(input.profile_type).id;
      if (!(await enabledProfiles()).has(type))
        throw new ApiError(409, 'profile_disabled', 'Profil AI ini sedang dinonaktifkan admin.');
      const [taken] = await dataProfilesSql.lockByName(c, [account, name]);
      if (taken[0]) throw new ApiError(409, 'name_taken', 'Nama data profil sudah dipakai.');
      const created = await insertDataProfile(svc, c, account, type, name, from);
      if (copyFrom) {
        // Hasil gandaan punya salinan sendiri untuk setiap foto, jadi menghapus salah satu data profil tidak merusak
        // yang lain.
        const [photos] = await productImagesSql.listByProfile(c, [account, copyFrom]);
        for (const photo of photos) {
          const copy = await svc.productImages.copy(account, String(photo.id));
          images.set(String(photo.id), copy.id);
          await productImagesSql.insert(c, [copy.id, account, created, copy.sizeBytes]);
        }
        const [products] = await productsSql.listAllByProfile(c, [account, copyFrom]);
        for (const p of products)
          await productsSql.insert(c, [
            account,
            created,
            p.name,
            p.type,
            p.description,
            p.price,
            p.stock,
            p.active,
            p.image_id ? (images.get(String(p.image_id)) ?? null) : null,
          ]);
        await dataSourcesSql.copyToProfile(c, [created, account, copyFrom]);
        await eduData.store.copy(c, account, copyFrom, created, documents);
      }
      return created;
    });
  } catch (error) {
    for (const copy of images.values()) await svc.productImages.removeFile(account, copy).catch(() => {});
    await eduData.store.removeFiles(account, documents);
    throw error;
  }
  return svc.dataProfile(account, id);
}
export async function renameDataProfile(svc: AIService, account: string, value: unknown, body: unknown) {
  const id = dataProfileId(svc, value),
    name = text(object(body).name, 100, 'Nama data profil');
  if (!name) throw fail('Nama data profil wajib diisi');
  await transaction(async c => {
    await lockAccount(c, account);
    const [rows] = await dataProfilesSql.lockOwned(c, [id, account]);
    if (!rows[0]) throw new ApiError(404, 'data_profile_not_found', 'Data profil tidak ditemukan');
    const [taken] = await dataProfilesSql.findOtherWithName(c, [account, name, id]);
    if (taken[0]) throw new ApiError(409, 'name_taken', 'Nama data profil sudah dipakai.');
    await dataProfilesSql.rename(c, [name, id]);
  });
  return svc.dataProfile(account, id);
}
export async function deleteDataProfile(svc: AIService, account: string, value: unknown) {
  const id = dataProfileId(svc, value);
  const photos = await transaction(async c => {
    await lockAccount(c, account);
    const [rows] = await dataProfilesSql.lockOwned(c, [id, account]);
    if (!rows[0]) throw new ApiError(404, 'data_profile_not_found', 'Data profil tidak ditemukan');
    const [attached] = await assistantsSql.lockSessionsOfProfile(c, [account, id]);
    if (attached.length)
      throw new ApiError(
        409,
        'data_profile_in_use',
        'Data profil masih dipasang di sesi ' +
          attached.map(a => a.session_id).join(', ') +
          '. Cabut dari sesi terlebih dahulu.',
      );
    const [images] = await productImagesSql.listByProfile(c, [account, id]);
    const documents = await eduData.store.files(c, account, id);
    await dataProfilesSql.deleteOwned(c, [id, account]);
    return { images: images.map(image => String(image.id)), documents };
  });
  for (const photo of photos.images) await svc.productImages.removeFile(account, photo).catch(() => {});
  await eduData.store.removeFiles(account, photos.documents);
  return { ok: true };
}
export async function attachProfile(svc: AIService, account: string, session: string, body: unknown) {
  const input = object(body);
  if (input.data_profile_id !== null && typeof input.data_profile_id !== 'string')
    throw fail('Data profil wajib dipilih');
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw fail('Status asisten wajib valid');
  const target = input.data_profile_id === null ? null : dataProfileId(svc, input.data_profile_id);
  await transaction(async c => {
    await lockAccount(c, account);
    let profile: RowDataPacket | undefined;
    if (target) {
      const [rows] = await dataProfilesSql.shareSummary(c, [target, account]);
      profile = rows[0];
      if (!profile) throw new ApiError(404, 'data_profile_not_found', 'Data profil tidak ditemukan');
      if (!(await enabledProfiles()).has(String(profile.profile_type)))
        throw new ApiError(409, 'profile_disabled', 'Profil AI ini sedang dinonaktifkan admin.');
    }
    const [current] = await assistantsSql.lockAttachment(c, [account, session]);
    const previous = current[0]?.data_profile_id ? String(current[0].data_profile_id) : null;
    const enabled = target
      ? input.enabled === undefined
        ? Boolean(current[0]?.enabled)
        : input.enabled === true
      : false;
    await assistantsSql.upsertAttachment(c, [account, session, enabled, target]);
    if (previous === target) return;
    const [customers] = await conversationsSql.lockCustomersOfSession(c, [account, session]);
    await conversationsSql.clearMemoryOfSession(c, [account, session]);
    const note = !profile
      ? 'Profil AI dicabut; AI berhenti membalas'
      : previous
        ? 'Profil diganti ke ' + profile.name + '; memori AI dikosongkan'
        : 'Profil AI dipasang: ' + profile.name;
    for (const row of customers) await recordNote(account, session, String(row.customer), note, c);
  });
  return svc.assistant(account, session);
}
export async function saveField(svc: AIService, account: string, session: string, field: string, value: unknown) {
  await saveProfileField(svc, account, await svc.ensureSessionProfile(account, session), field, value);
  return svc.assistant(account, session);
}
export async function saveDataProfileField(
  svc: AIService,
  account: string,
  value: unknown,
  field: string,
  input: unknown,
) {
  const id = await svc.ownedDataProfile(account, value);
  await saveProfileField(svc, account, id, field, input);
  return svc.dataProfile(account, id);
}
export async function saveProfileField(
  svc: AIService,
  account: string,
  profile: string,
  field: string,
  value: unknown,
) {
  // Setiap profil menerima bidangnya sendiri; perilaku, FAQ, dan nomor fallback dimiliki semua profil.
  const type = await svc.profileType(account, profile);
  if (field === 'faq') {
    await dataProfilesSql.updateFaq(db, [text(value, faqLimit(type), 'FAQ'), profile, account]);
    return;
  }
  if (type === 'pendidikan') {
    if (Object.hasOwn(eduTextFields, field)) {
      const spec = eduTextFields[field as keyof typeof eduTextFields];
      await dataProfilesSql.updateEduField(db, [text(value, spec.max, spec.label), profile, account], spec);
      return;
    }
  }
  if (type === 'cs' && profileFields.includes(field as ProfileField)) {
    await dataProfilesSql.updateProfileField(
      db,
      [text(value, 2000, profileLabels[field as ProfileField]), profile, account],
      field,
    );
    return;
  }
  if (field === 'behavior') {
    await dataProfilesSql.updateBehavior(db, [text(value, 2000, 'Perilaku AI'), profile, account]);
    return;
  }
  if (field === 'fallback_number' || field === 'fallback_notify') {
    const [rows] = await dataProfilesSql.findFallback(db, [profile, account]);
    const current = {
      fallback_number: String(rows[0]?.fallback_number ?? ''),
      fallback_notify: Boolean(rows[0]?.fallback_notify),
    };
    const fallbackNumber =
      field === 'fallback_number' ? (value === '' ? '' : text(value, 20, 'Nomor fallback')) : current.fallback_number;
    if (fallbackNumber && !/^[1-9][0-9]{5,14}$/.test(fallbackNumber))
      throw fail('Nomor fallback harus nomor internasional tanpa +');
    const fallbackNotify = field === 'fallback_notify' ? value === true : current.fallback_notify;
    await dataProfilesSql.updateFallback(db, [
      fallbackNumber,
      Boolean(fallbackNumber) && fallbackNotify,
      profile,
      account,
    ]);
    return;
  }
  if (type === 'cs' && (field === 'products_source' || field === 'orders_source')) {
    const kind = field === 'products_source' ? 'products' : 'orders';
    const input = await sourceInput(value);
    await transaction(async c => {
      await lockAccount(c, account);
      await saveSource(c, account, profile, kind, input);
    });
    return;
  }
  throw fail('Bidang tidak dikenal');
}
export async function assistant(svc: AIService, account: string, session: string) {
  const [rows] = await assistantsSql.findWithProfile(db, [account, session]);
  const row = rows[0],
    attached = row?.data_profile_id ? String(row.data_profile_id) : null;
  const view = attached
    ? profileView(svc, row)
    : {
        profile: Object.fromEntries(profileFields.map(field => [field, ''])) as Record<ProfileField, string>,
        knowledge: '',
        behavior: '',
        fallback_number: '',
        fallback_notify: false,
        revision: 0,
        edu: null,
      };
  const { secret: _, ...builtin } = builtinSource,
    sources = attached
      ? await publicSources(account, attached)
      : { products_source: { ...builtin, has_token: false }, orders_source: { ...builtin, has_token: false } };
  return {
    enabled: Boolean(row?.enabled) && Boolean(attached),
    data_profile: attached ? { id: attached, name: String(row.name), profile_type: String(row.profile_type) } : null,
    profile_enabled: attached ? (await enabledProfiles()).has(String(row.profile_type)) : false,
    ...view,
    ...sources,
  };
}
export async function saveAssistant(svc: AIService, account: string, session: string, body: unknown) {
  const input = object(body);
  if (typeof input.enabled !== 'boolean') throw fail('Status asisten wajib valid');
  const inputProfile = object(input.profile);
  const profile = Object.fromEntries(
    profileFields.map(field => [field, text(inputProfile[field] ?? '', 2000, profileLabels[field])]),
  ) as Record<ProfileField, string>;
  const behavior = text(input.behavior, 2000, 'Perilaku AI'),
    fallbackNumber = input.fallback_number === undefined ? '' : text(input.fallback_number, 20, 'Nomor fallback'),
    fallbackNotify = input.fallback_notify === true;
  if (fallbackNumber && !/^[1-9][0-9]{5,14}$/.test(fallbackNumber))
    throw fail('Nomor fallback harus nomor internasional tanpa +');
  const products = input.products_source === undefined ? undefined : await sourceInput(input.products_source),
    orders = input.orders_source === undefined ? undefined : await sourceInput(input.orders_source);
  const profileColumns = profileFields.map(field => 'profil_' + field),
    profileValues = profileFields.map(field => profile[field]);
  await transaction(async c => {
    await lockAccount(c, account);
    const id = await ensureDataProfile(svc, c, account, session);
    const [types] = await dataProfilesSql.findTypeById(c, [id]);
    if (types[0]?.profile_type !== 'cs')
      throw new ApiError(
        409,
        'profile_mismatch',
        'Sesi ini memakai profil lain; ubah isinya lewat halaman Asisten AI atau endpoint data profil.',
      );
    await dataProfilesSql.updateContent(
      c,
      [behavior, fallbackNumber, Boolean(fallbackNumber) && fallbackNotify, ...profileValues, id, account],
      profileColumns,
    );
    await assistantsSql.updateEnabled(c, [Boolean(input.enabled), account, session]);
    if (products) await saveSource(c, account, id, 'products', products);
    if (orders) await saveSource(c, account, id, 'orders', orders);
  });
  return svc.assistant(account, session);
}
