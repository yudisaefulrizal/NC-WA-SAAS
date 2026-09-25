// Sumber template: template bisa mengambil nilai terkini dari endpoint HTTPS milik akun lalu mengisikannya
// ke teks atau caption. Semua fungsi di sini murni kecuali fetchSource, jadi aturan pengisian bisa diuji
// tanpa database atau jaringan.
import { request } from 'node:https';
import { ApiError } from '../../../libraries/errors.js';
import { validatePublicUrl } from '../../../libraries/download.js';

const invalid = (message: string) => new ApiError(400, 'invalid_request', message);
export const sourceModes = ['none', 'endpoint'] as const;
export const mediaSources = ['asset', 'endpoint'] as const;
export const maxSourceMediaBytes = 8 * 1024 * 1024;
const maxKeys = 50,
  maxValueLength = 1000,
  maxResponseBytes = 32 * 1024,
  timeoutMs = 10000;

// {{{{ menghasilkan {{ apa adanya, supaya template tetap bisa menampilkan kurung kurawal. Dicocokkan
// sebelum placeholder.
const token = /\{\{\{\{|\}\}\}\}|\{\{\s*([A-Za-z0-9_]{1,40})\s*\}\}/g;

export function parsePlaceholders(text: string) {
  const names = new Set<string>();
  for (const match of text.matchAll(token)) if (match[1]) names.add(match[1]);
  return [...names];
}

// Ditolak pada nilai pertama yang hilang: pesan massal yang terisi setengah lebih buruk daripada batal.
export function renderTemplate(text: string, data: Record<string, string>) {
  return text.replace(token, (match, name?: string) => {
    if (!name) return match === '{{{{' ? '{{' : '}}';
    if (!Object.prototype.hasOwnProperty.call(data, name))
      throw invalid('Data "' + name + '" tidak tersedia dari sumber');
    return data[name];
  });
}

function sourceValue(name: string, value: unknown) {
  if (typeof value === 'string') {
    if (value.length > maxValueLength) throw invalid('Nilai "' + name + '" melebihi ' + maxValueLength + ' karakter');
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw invalid('Nilai "' + name + '" bukan angka yang sah');
    return new Intl.NumberFormat('id-ID').format(value);
  }
  if (typeof value === 'boolean') return value ? 'Ya' : 'Tidak';
  throw invalid('Nilai "' + name + '" harus teks, angka, atau true/false');
}

export function validateSourceData(body: unknown): Record<string, string> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalid('Respons sumber data harus objek JSON');
  // Pembungkus "data" dipakai bila ada, tapi endpoint yang langsung menjawab dengan objek datar juga
  // diterima apa adanya, jadi API yang sudah ada tidak perlu diubah.
  const wrapper = (body as Record<string, unknown>).data;
  const raw =
    wrapper && typeof wrapper === 'object' && !Array.isArray(wrapper)
      ? (wrapper as Record<string, unknown>)
      : (body as Record<string, unknown>);
  const entries = Object.entries(raw);
  if (!entries.length) throw invalid('Respons sumber data tidak memuat satu variabel pun');
  if (entries.length > maxKeys) throw invalid('Sumber data maksimal ' + maxKeys + ' variabel');
  const data: Record<string, string> = {};
  for (const [name, value] of entries) {
    if (!/^[A-Za-z0-9_]{1,40}$/.test(name))
      throw invalid('Nama variabel "' + name + '" hanya boleh huruf, angka, dan garis bawah (maksimal 40 karakter)');
    data[name] = sourceValue(name, value);
  }
  return data;
}

export interface SourceMedia {
  url: string;
  filename: string | null;
}
// Alamat media hanyalah variabel lain yang dipilih namanya di template, jadi endpoint tidak butuh blok
// media khusus: nilai apa pun yang berisi tautan HTTPS bisa dipilih.
export async function validateSourceMedia(data: Record<string, string>, variable: string): Promise<SourceMedia> {
  if (!Object.prototype.hasOwnProperty.call(data, variable))
    throw invalid('Variabel media "' + variable + '" tidak tersedia dari sumber');
  const value = data[variable].trim();
  if (!value) throw invalid('Variabel media "' + variable + '" kosong');
  if (value.length > 4096) throw invalid('Alamat media dari variabel "' + variable + '" terlalu panjang');
  let url: URL;
  try {
    url = (await validatePublicUrl(value)).url;
  } catch {
    throw invalid('Variabel media "' + variable + '" bukan alamat HTTPS publik yang sah');
  }
  if (url.protocol !== 'https:') throw invalid('Variabel media "' + variable + '" wajib berupa alamat HTTPS');
  const name = decodeURIComponent(url.pathname.split('/').pop() || '').trim();
  return { url: url.href, filename: name ? name.slice(0, 255) : null };
}
// Aturan nama variabel yang dipilih; sama persis dengan aturan placeholder.
export function mediaVariable(value: unknown) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_]{1,40}$/.test(value))
    throw invalid('Pilih variabel media dari daftar hasil tes koneksi');
  return value;
}

export function endpointUrl(value: string) {
  if (value.length > 512) throw invalid('Endpoint terlalu panjang');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalid('Endpoint tidak valid');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash)
    throw invalid('Endpoint wajib HTTPS tanpa kredensial atau fragmen');
  return url.href;
}

export type SourceHeaders = Record<string, string>;
export const maxSourceHeaders = 10;
// Diatur oleh transport sendiri; bila template boleh menimpanya, request bisa rusak atau jaminan DNS
// terkunci dan tanpa redirect bisa jebol.
const reservedHeaders = new Set([
  'host',
  'content-length',
  'connection',
  'accept-encoding',
  'transfer-encoding',
  'upgrade',
  'te',
  'trailer',
  'expect',
]);

export function validateHeaders(value: unknown): SourceHeaders {
  if (value === undefined || value === null) return {};
  if (!Array.isArray(value)) throw invalid('Daftar header tidak valid');
  if (value.length > maxSourceHeaders) throw invalid('Header tambahan maksimal ' + maxSourceHeaders);
  const headers: SourceHeaders = {};
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw invalid('Header tambahan tidak valid');
    const { name, value: content } = entry as Record<string, unknown>;
    if (typeof name !== 'string' || !name.trim()) continue;
    const key = name.trim();
    if (!/^[A-Za-z0-9-]{1,64}$/.test(key))
      throw invalid('Nama header "' + key + '" hanya boleh huruf, angka, dan tanda hubung');
    if (reservedHeaders.has(key.toLowerCase()))
      throw invalid('Header "' + key + '" diatur otomatis dan tidak dapat diisi');
    if (typeof content !== 'string' || content.length > 1024)
      throw invalid('Nilai header "' + key + '" maksimal 1024 karakter');
    // Baris baru di sini memungkinkan sebuah nilai menyisipkan header tambahan ke request.
    if (/[\r\n]/.test(content)) throw invalid('Nilai header "' + key + '" tidak boleh memuat baris baru');
    if (Object.keys(headers).some(existing => existing.toLowerCase() === key.toLowerCase()))
      throw invalid('Header "' + key + '" ditulis lebih dari sekali');
    headers[key] = content;
  }
  return headers;
}

// Header yang tersimpan dienkripsi sebagai satu blob JSON. Template lama yang disimpan sebelum ada header
// kustom masih berisi token Bearer polos, jadi bentuk itu tetap dipahami saat dibaca.
export function decodeHeaders(plain: string): SourceHeaders {
  if (!plain) return {};
  if (!plain.startsWith('{')) return { Authorization: 'Bearer ' + plain };
  try {
    const parsed = JSON.parse(plain);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as SourceHeaders) : {};
  } catch {
    return {};
  }
}

// Membaca bidang sumber dari input template. Penanganan header sama dengan saveSource di data AI: nilai
// kosong mempertahankan yang tersimpan, dan mengganti endpoint membuangnya supaya secret tidak pernah
// sampai ke host yang bukan tujuannya.
export function sourceInput(body: Record<string, unknown>) {
  const mode = body.source_mode ?? 'none';
  if (typeof mode !== 'string' || !sourceModes.includes(mode as (typeof sourceModes)[number]))
    throw invalid('Sumber data tidak valid');
  const media = body.media_source ?? 'asset';
  if (typeof media !== 'string' || !mediaSources.includes(media as (typeof mediaSources)[number]))
    throw invalid('Sumber media tidak valid');
  if (mode === 'none') {
    if (media === 'endpoint') throw invalid('Sumber media endpoint memerlukan sumber data endpoint');
    return {
      mode: 'none' as const,
      endpoint: '',
      headers: undefined as SourceHeaders | undefined,
      media: 'asset' as const,
      variable: '',
    };
  }
  const endpoint = endpointUrl(typeof body.source_endpoint === 'string' ? body.source_endpoint.trim() : '');
  // Tidak dikirim berarti "pakai yang tersimpan"; array kosong berarti "hapus semuanya".
  const headers = body.source_headers === undefined ? undefined : validateHeaders(body.source_headers);
  const variable = media === 'endpoint' ? mediaVariable(body.media_variable) : '';
  return { mode: 'endpoint' as const, endpoint, headers, media: media as 'asset' | 'endpoint', variable };
}

// Hanya HTTPS; DNS dikunci, tanpa redirect, ukuran respons dibatasi. Setiap kegagalan menjadi ApiError
// supaya penjadwal mencatatnya sebagai invalid_request, bukan menghentikan putaran untuk semua akun.
export type SourceTransport = (endpoint: string, headers: SourceHeaders) => Promise<unknown>;
export const fetchSource: SourceTransport = async (endpoint, headers) => {
  const { url, addresses } = await validatePublicUrl(endpointUrl(endpoint));
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: 'GET',
        agent: false,
        signal: AbortSignal.timeout(timeoutMs),
        // Header kustom dipasang terakhir supaya template bisa mengganti Accept, tapi tidak header yang
        // dicadangkan.
        headers: { Accept: 'application/json', 'User-Agent': 'NC-WA/0.1', 'Accept-Encoding': 'identity', ...headers },
        lookup: (_host, options, callback) => {
          if (options.all) callback(null, addresses);
          else callback(null, addresses[0].address, addresses[0].family);
        },
      },
      response => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxResponseBytes) {
            response.destroy(Error('limit'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('error', error =>
          reject(
            error.message === 'limit'
              ? invalid('Respons sumber data melebihi 32 KB')
              : invalid('Sumber data tidak dapat dihubungi'),
          ),
        );
        response.on('end', () => {
          if (response.statusCode !== 200) {
            reject(invalid('Sumber data menjawab HTTP ' + response.statusCode));
            return;
          }
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString()));
          } catch {
            reject(invalid('Respons sumber data bukan JSON yang sah'));
          }
        });
      },
    );
    req.on('error', () => reject(invalid('Sumber data tidak dapat dihubungi')));
    req.end();
  });
};
