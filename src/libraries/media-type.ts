// Mengenali jenis file dari byte awalnya, untuk unggahan media dan dokumen.
export type ShareMediaType = 'image' | 'video' | 'document' | 'audio';

// Dokumen Office (docx/pptx/xlsx) berupa arsip ZIP; membedakan jenisnya berarti membuka arsip dan
// membaca [Content_Types].xml. WhatsApp mengirim 'document' secara umum (mimetype + nama file bebas),
// jadi semua format Office berbasis ZIP diterima sebagai 'document' dan diberi label dari nama filenya.
const officeMimetypes: Record<string, string> = {
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.zip': 'application/zip',
};

function extensionOf(filename: string) {
  const match = /\.[a-z0-9]+$/i.exec(filename);
  return match ? match[0].toLowerCase() : '';
}

// Jenis file dibaca dari byte awalnya, bukan dari Content-Type kiriman klien, supaya unggahan tidak bisa
// menyamar untuk lolos dari daftar media_type yang diizinkan.
export function sniffMediaType(head: Buffer, filename: string): { mediaType: ShareMediaType; mimetype: string } | null {
  if (head.length >= 8 && head.readUInt32BE(0) === 0x89504e47 && head.readUInt32BE(4) === 0x0d0a1a0a)
    return { mediaType: 'image', mimetype: 'image/png' };
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff)
    return { mediaType: 'image', mimetype: 'image/jpeg' };
  if (head.length >= 12 && head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WEBP')
    return { mediaType: 'image', mimetype: 'image/webp' };
  if (head.length >= 12 && head.toString('ascii', 4, 8) === 'ftyp')
    return { mediaType: 'video', mimetype: 'video/mp4' };
  if (head.length >= 3 && head[0] === 0xff && (head[1] === 0xfb || head[1] === 0xf3 || head[1] === 0xfa))
    return { mediaType: 'audio', mimetype: 'audio/mpeg' };
  if (head.length >= 3 && head.toString('ascii', 0, 3) === 'ID3') return { mediaType: 'audio', mimetype: 'audio/mpeg' };
  if (head.length >= 4 && head.toString('ascii', 0, 4) === 'OggS') return { mediaType: 'audio', mimetype: 'audio/ogg' };
  if (head.length >= 5 && head.toString('ascii', 0, 5) === '%PDF-')
    return { mediaType: 'document', mimetype: 'application/pdf' };
  if (head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) {
    const extension = extensionOf(filename);
    return { mediaType: 'document', mimetype: officeMimetypes[extension] ?? 'application/octet-stream' };
  }
  return null;
}
