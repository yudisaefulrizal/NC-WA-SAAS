import {ApiError} from './errors.js';
// Input checks shared by every component; each throws a 400 ApiError with a readable message.
export function object(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'invalid_request', 'Body harus objek JSON');
  return body as Record<string, unknown>;
}
export function requiredString(value: unknown, name: string, max = 65536): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new ApiError(400, 'invalid_request', `${name} wajib berupa teks dengan panjang maksimal ${max}`);
  return value;
}
export function record(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new ApiError(400,'invalid_request','Objek data wajib valid');return value as Record<string,unknown>;}
