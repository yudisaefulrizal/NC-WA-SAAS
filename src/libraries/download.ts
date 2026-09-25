import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { mkdtemp, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import ipaddr from 'ipaddr.js';
import {ApiError} from './errors.js';

type Address = { address: string; family: number };
type Resolver = (hostname: string) => Promise<Address[]>;
const resolveAddresses: Resolver = hostname => lookup(hostname, { all: true, verbatim: true });
const invalid = () => new ApiError(400, 'invalid_request', 'URL media harus menuju alamat HTTP/HTTPS publik');
export function isPublicAddress(address: string) {
  try { return ipaddr.process(address).range() === 'unicast'; } catch { return false; }
}
export async function validatePublicUrl(value: string, resolve: Resolver = resolveAddresses) {
  let url: URL;
  try { url = new URL(value); } catch { throw invalid(); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw invalid();
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  let addresses: Address[];
  try { addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await resolve(hostname); }
  catch { throw invalid(); }
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) throw invalid();
  return { url, addresses };
}
function open(url: URL, addresses: Address[], signal: AbortSignal): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
      method: 'GET', signal, agent: false,
      headers: { 'User-Agent': 'NC-WA/0.1', 'Accept-Encoding': 'identity' },
      // Pin the already validated answer while retaining the original Host and TLS name.
      lookup: (_hostname, options, callback) => {
        if (options.all) callback(null, addresses);
        else callback(null, addresses[0].address, addresses[0].family);
      },
    }, resolve);
    request.once('error', reject);
    request.end();
  });
}
export interface DownloadOptions { maxBytes?: number; resolve?: Resolver; open?: typeof open }
export async function downloadPublicMedia(value: string, options: DownloadOptions = {}) {
  const maxBytes = options.maxBytes ?? 32 * 1024 * 1024;
  const signal = AbortSignal.timeout(30_000);
  let target = value;
  for (let redirect = 0; redirect <= 3; redirect++) {
    const { url, addresses } = await validatePublicUrl(target, options.resolve);
    const response = await (options.open ?? open)(url, addresses, signal);
    if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
      response.destroy();
      if (!response.headers.location || redirect === 3) throw invalid();
      try { target = new URL(response.headers.location, url).href; } catch { throw invalid(); }
      continue;
    }
    if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
      response.destroy();
      throw new ApiError(502, 'send_failed', 'Server media menolak unduhan');
    }
    if (Number(response.headers['content-length'] ?? 0) > maxBytes) {
      response.destroy();
      throw new ApiError(400, 'invalid_request', 'Media melebihi batas ukuran');
    }
    const directory = await mkdtemp(join(tmpdir(), 'nc-wa-send-'));
    const path = join(directory, 'media');
    const cleanup = () => rm(directory, { recursive: true, force: true });
    let size = 0;
    const limit = new Transform({ transform(chunk, _encoding, callback) {
      size += chunk.length;
      callback(size > maxBytes ? new ApiError(400, 'invalid_request', 'Media melebihi batas ukuran') : null, chunk);
    } });
    try { await pipeline(response, limit, createWriteStream(path, { flags: 'wx', mode: 0o600 }), { signal }); }
    catch (error) { await cleanup(); throw error; }
    const mimetype = response.headers['content-type']?.split(';')[0];
    return { path, mimetype, cleanup };
  }
  throw invalid();
}

// Validate and pin DNS on every webhook attempt; redirects are never followed.
export async function postPublicJson(value:string,payload:unknown,abort:AbortSignal){
 const {url,addresses}=await validatePublicUrl(value);
 const body=JSON.stringify(payload);
 await new Promise<void>((resolve,reject)=>{
  const req=(url.protocol==='https:'?httpsRequest:httpRequest)(url,{
   method:'POST',agent:false,signal:AbortSignal.any([abort,AbortSignal.timeout(10_000)]),
   headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)},
   lookup:(_hostname,options,callback)=>{if(options.all)callback(null,addresses);else callback(null,addresses[0].address,addresses[0].family);},
  },response=>{const ok=Boolean(response.statusCode&&response.statusCode>=200&&response.statusCode<300);response.destroy();if(ok)resolve();else reject(new Error('webhook_failed'));});
  req.once('error',reject);req.end(body);
 });
}
