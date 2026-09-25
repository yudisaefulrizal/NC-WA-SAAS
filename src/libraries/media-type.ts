export type ShareMediaType = 'image' | 'video' | 'document' | 'audio';

// Office documents (docx/pptx/xlsx) are ZIP containers; distinguishing the sub-type would require
// opening the archive and reading [Content_Types].xml, which is out of scope for a manual sniff.
// WhatsApp/Baileys sends 'document' generically (arbitrary mimetype + fileName), so every ZIP-based
// office format is accepted under the same 'document' category and labelled from the client's filename.
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

// Sniffs the actual file type from its leading bytes rather than trusting the client's Content-Type,
// so uploads cannot be mislabeled to slip past the media_type whitelist.
export function sniffMediaType(head: Buffer, filename: string): { mediaType: ShareMediaType; mimetype: string } | null {
  if (head.length >= 8 && head.readUInt32BE(0) === 0x89504e47 && head.readUInt32BE(4) === 0x0d0a1a0a) return { mediaType: 'image', mimetype: 'image/png' };
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return { mediaType: 'image', mimetype: 'image/jpeg' };
  if (head.length >= 12 && head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WEBP') return { mediaType: 'image', mimetype: 'image/webp' };
  if (head.length >= 12 && head.toString('ascii', 4, 8) === 'ftyp') return { mediaType: 'video', mimetype: 'video/mp4' };
  if (head.length >= 3 && head[0] === 0xff && (head[1] === 0xfb || head[1] === 0xf3 || head[1] === 0xfa)) return { mediaType: 'audio', mimetype: 'audio/mpeg' };
  if (head.length >= 3 && head.toString('ascii', 0, 3) === 'ID3') return { mediaType: 'audio', mimetype: 'audio/mpeg' };
  if (head.length >= 4 && head.toString('ascii', 0, 4) === 'OggS') return { mediaType: 'audio', mimetype: 'audio/ogg' };
  if (head.length >= 5 && head.toString('ascii', 0, 5) === '%PDF-') return { mediaType: 'document', mimetype: 'application/pdf' };
  if (head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) {
    const extension = extensionOf(filename);
    return { mediaType: 'document', mimetype: officeMimetypes[extension] ?? 'application/octet-stream' };
  }
  return null;
}
