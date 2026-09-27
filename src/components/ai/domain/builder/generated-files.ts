// Node Buat file (JSON, Markdown): membentuk isi file dari template dan variabel alur tanpa memanggil AI. File disimpan
// sebagai file data profil (belum terikat record) sehingga bisa dikirim lewat Kirim media atau disimpan ke field File.
import type { GraphNode } from './definition.js';

export type FileNodeType = 'file_json' | 'file_md';
export const fileFormats: Record<FileNodeType, { extension: string; mimetype: string }> = {
  file_json: { extension: '.json', mimetype: 'application/json' },
  file_md: { extension: '.md', mimetype: 'text/markdown' },
};
export const isFileNode = (n: Pick<GraphNode, 'type'>): n is GraphNode & { type: FileNodeType } =>
  n.type in fileFormats;
// Batas isi file hasil node, jauh di bawah batas dokumen profil agar alur tetap ringan.
export const maxGeneratedBytes = 1024 * 1024;
export interface GeneratedFile {
  filename: string;
  content: Buffer;
  mimetype: string;
}
export type FileWriter = (file: GeneratedFile) => Promise<{ file: string; filename: string; size: number }>;

// Nama file dari template: karakter berbahaya diganti, ekstensi format selalu dipasang.
export function generatedName(value: unknown, fallback: string, type: FileNodeType) {
  const { extension } = fileFormats[type];
  const raw = (typeof value === 'string' ? value : value === undefined || value === null ? '' : JSON.stringify(value))
    .trim()
    .replace(/[\\/\0\r\n:*?"<>|]/g, '_')
    .slice(0, 120);
  const base = (raw || fallback || 'file').replace(new RegExp('\\' + extension + '$', 'i'), '');
  return base + extension;
}
// Template JSON dibaca dulu sebagai JSON, lalu setiap string diisi variabelnya: string yang hanya berisi satu variabel
// menjadi nilai aslinya (angka, daftar, objek), sehingga tanda kutip di jawaban AI tidak merusak JSON.
export function renderJson(template: string, fill: (v: unknown) => unknown) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(template);
  } catch {
    throw Error('ai_file_invalid_json');
  }
  return JSON.stringify(fill(parsed), null, 2) + '\n';
}
export function renderMarkdown(value: unknown) {
  const text = typeof value === 'string' ? value : value === undefined || value === null ? '' : JSON.stringify(value);
  return text.endsWith('\n') ? text : text + '\n';
}
export function buildFile(
  n: GraphNode & { type: FileNodeType },
  fill: (v: unknown) => unknown,
  fallbackName: string,
): GeneratedFile {
  const body = n.type === 'file_json' ? renderJson(n.value, fill) : renderMarkdown(fill(n.value));
  const content = Buffer.from(body, 'utf8');
  if (!content.length || !body.trim()) throw Error('ai_file_empty');
  if (content.length > maxGeneratedBytes) throw Error('ai_file_too_large');
  return {
    filename: generatedName(fill(n.filename ?? ''), fallbackName, n.type),
    content,
    mimetype: fileFormats[n.type].mimetype,
  };
}
// Simulasi dan Uji Coba: tidak menulis file sungguhan; nama file dipakai sebagai nilainya (seperti Terima media).
export const previewFiles: FileWriter = async file => ({
  file: file.filename,
  filename: file.filename,
  size: file.content.length,
});
