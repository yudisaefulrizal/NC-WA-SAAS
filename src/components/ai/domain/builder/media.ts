// Node Kirim media: mengubah nilai variabel menjadi daftar file yang diantrekan. Pengiriman sebenarnya dilakukan
// runtime setelah alur selesai tanpa Fallback; simulasi dan Uji Coba hanya menampilkan daftarnya.
import type { GraphNode } from './definition.js';

export const maxMediaPerReply = 3;
export interface QueuedMedia {
  // file: ID file field File/gambar; url: URL HTTPS publik (misalnya dari koleksi API); preview: simulasi.
  kind: 'file' | 'url' | 'preview';
  ref: string;
  type: 'image' | 'document';
  filename: string;
  caption: string;
  when: 'before' | 'after';
}
export type MediaResolver = (
  ref: string,
  as: NonNullable<GraphNode['media_as']>,
) => Promise<Pick<QueuedMedia, 'kind' | 'ref' | 'type' | 'filename'>>;
export const fileRef = (v: string) => /^[0-9a-f-]{36}$/.test(v);
export const urlRef = (v: string) => /^https:\/\/[^\s]+$/i.test(v) && v.length <= 2048;
// Nilai kosong berarti tidak ada file (misalnya produk tanpa foto), bukan kesalahan.
export function mediaRefs(value: unknown): string[] {
  if (value === undefined || value === null || value === '') return [];
  const list = Array.isArray(value) ? value : [value];
  if (list.some(v => typeof v !== 'string')) throw Error('ai_media_invalid');
  return (list as string[]).map(v => v.trim()).filter(Boolean);
}
// Jenis dan nama file untuk URL dibaca dari alamatnya; "otomatis" berarti gambar bila ekstensinya gambar.
export function urlMedia(url: string, as: NonNullable<GraphNode['media_as']>) {
  const name = decodeURIComponent(new URL(url).pathname.split('/').pop() || 'file').slice(0, 255) || 'file';
  const image = /\.(jpe?g|png|webp)$/i.test(name);
  return {
    kind: 'url' as const,
    ref: url,
    type: as === 'auto' ? (image ? ('image' as const) : ('document' as const)) : as,
    filename: name,
  };
}
export const previewMedia: MediaResolver = async (ref, as) =>
  urlRef(ref)
    ? { ...urlMedia(ref, as), kind: 'preview' }
    : {
        kind: 'preview',
        ref,
        type: as === 'auto' ? (/\.(jpe?g|png|webp)$/i.test(ref) ? 'image' : 'document') : as,
        filename: ref.slice(0, 255),
      };
