// Endpoint HTTPS milik klien yang menggantikan tabel aplikasi untuk sebuah koleksi profil: alamat, token terenkripsi,
// dan pemanggilnya. Server yang memanggil; model tidak pernah memegang URL atau token.
import { request } from 'node:https';
import { decrypt } from '../../../libraries/crypto.js';
import { ApiError } from '../../../libraries/errors.js';
import { validatePublicUrl } from '../../../libraries/download.js';
import { record } from '../../../libraries/validation.js';

const invalid = (message: string) => new ApiError(400, 'invalid_request', message);
function text(value: unknown, max: number, name: string, empty = false) {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()))
    throw invalid(name + ' tidak valid');
  return value.trim();
}
export interface DataSource {
  mode: 'builtin' | 'endpoint';
  endpoint: string;
  secret: string;
}
export const builtinSource: DataSource = { mode: 'builtin', endpoint: '', secret: '' };
export async function endpointUrl(value: string) {
  if (value.length > 512) throw invalid('Endpoint terlalu panjang');
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    throw invalid('Endpoint tidak valid');
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash)
    throw invalid('Endpoint wajib HTTPS tanpa kredensial, query atau fragmen');
  await validatePublicUrl(u.href);
  return u.href;
}
export async function sourceInput(value: unknown) {
  const s = record(value);
  if (s.mode !== 'builtin' && s.mode !== 'endpoint') throw invalid('Sumber data tidak valid');
  const endpoint = s.mode === 'endpoint' ? await endpointUrl(text(s.endpoint, 512, 'Endpoint')) : '';
  let token: string | undefined;
  if (s.token !== undefined) {
    token = text(s.token, 512, 'Token', true);
    if (/[\r\n]/.test(token)) throw invalid('Token tidak valid');
  }
  if (s.clear_token !== undefined && typeof s.clear_token !== 'boolean')
    throw invalid('Pilihan hapus token tidak valid');
  return { mode: s.mode as DataSource['mode'], endpoint, token, clear_token: s.clear_token === true };
}
// Hanya HTTPS; DNS dikunci di setiap request, tanpa redirect, tanpa kredensial atau body di pesan error.
export type EndpointTransport = (
  source: DataSource,
  payload: Record<string, unknown>,
  idempotencyKey: string,
  maxBytes?: number,
) => Promise<unknown>;
export const callEndpoint: EndpointTransport = async (config, payload, idempotencyKey, maxBytes = 32000) => {
  const { url, addresses } = await validatePublicUrl(await endpointUrl(config.endpoint));
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: 'POST',
        agent: false,
        signal: AbortSignal.timeout(15000),
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'Idempotency-Key': idempotencyKey,
          ...(config.secret ? { Authorization: 'Bearer ' + decrypt(config.secret) } : {}),
        },
        lookup: (_host, options, callback) => {
          if (options.all) callback(null, addresses);
          else callback(null, addresses[0].address, addresses[0].family);
        },
      },
      res => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            res.destroy(Error('endpoint_response_limit'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('error', error =>
          reject(Error(error.message === 'endpoint_response_limit' ? 'endpoint_response_limit' : 'endpoint_failed')),
        );
        res.on('end', () => {
          if (res.statusCode !== 200) {
            reject(Error('endpoint_http_' + res.statusCode));
            return;
          }
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString()));
          } catch {
            reject(Error('endpoint_invalid_json'));
          }
        });
      },
    );
    req.on('error', () => reject(Error('endpoint_failed')));
    req.end(body);
  });
};
