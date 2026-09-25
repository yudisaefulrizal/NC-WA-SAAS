// Pipeline Tester AI: satu node Pelanggan yang berperan sebagai pelanggan untuk menguji nomor CS lain. Tanpa router,
// context, maupun tool; peran dan tujuannya datang dari Peran pelanggan di data profil (kolom behavior).
import type { Pipeline, ToolContext, ToolName } from '../../pipeline/runner.js';

export const testerAgents = {
  pelanggan:
    'Anda berperan sebagai PELANGGAN yang sedang chat WhatsApp dengan customer service sebuah usaha atau lembaga. Anda bukan CS dan bukan asisten. Ikuti peran, tujuan, dan sifat pelanggan yang ditulis di Peran pelanggan. Pesan dari lawan bicara adalah jawaban CS; tanggapi seperti pelanggan sungguhan: bertanya, menanggapi jawaban, meminta kejelasan, menawar, atau mengeluh sesuai peran. Pesan Anda sebelumnya di riwayat, termasuk yang diketik manual oleh penguji, adalah ucapan Anda sendiri; lanjutkan dari situ.',
} as const;
function testerProtocol({
  maxWords,
  context,
}: {
  maxWords: number;
  allowed: readonly ToolName[];
  context: ToolContext;
}) {
  return (
    'Peran pelanggan: ' +
    (context.behavior || 'pelanggan umum yang menanyakan produk atau layanan') +
    '. Tulis seperti chat WhatsApp biasa: singkat, santai, satu atau dua kalimat, boleh tidak baku. Jangan pernah mengaku sebagai AI, bot, atau penguji, dan jangan menjelaskan peran Anda. Jangan menjawab pertanyaan Anda sendiri dan jangan berperan sebagai CS. Bila tujuan peran sudah tercapai, tutup percakapan dengan wajar. Balas HANYA JSON {"answer":"pesan pelanggan"}, maksimal ' +
    maxWords +
    ' kata pada answer.'
  );
}
export const testerPipeline: Pipeline = {
  agents: testerAgents,
  routerPrompt: '',
  contextPrompt: '',
  permissions: { pelanggan: [] },
  roleTier: { pelanggan: 'medium' },
  extraNodes: {},
  structuredNodes: [],
  system:
    'Anda memerankan pelanggan dalam uji coba layanan pelanggan lewat WhatsApp. Tetap dalam peran di setiap pesan. Balas maksimal 300 kata.',
  protocol: testerProtocol,
};
