// Definisi pembanding CS untuk audit editor; batas tool yang belum tersedia sengaja tidak disamarkan.
import {
  blankDefinition,
  type GraphDefinition,
  type GraphNode,
  type Field,
} from '../../../src/components/ai/domain/builder/definition.js';
import {
  agents,
  permissions,
  contextPrompt,
  routerPrompt,
} from '../../../src/components/ai/domain/profiles/cs/pipeline.js';
export const auditName = 'CS Usaha — Audit kelengkapan';
export const unsupportedTools = ['create_order', 'send_product_image'];
export const samples = {
  knowledge: [
    {
      judul: 'Profil usaha',
      isi: 'Toko Uji Nusantara. Buka Senin–Sabtu 09.00–17.00. Garansi barang cacat tujuh hari.',
    },
  ],
  products: [{ nama: 'Produk Basic', deskripsi: 'Produk harian', harga: 150000, stok: 10 }],
  orders: [
    { nomor: 'ORDER-UJI-1', pelanggan: 'pelanggan-uji-b', produk: 'Produk Basic', jumlah: 1, status: 'Pesanan masuk' },
  ],
};
export function csParityProfile(supportedOnly = false): GraphDefinition {
  const d = blankDefinition(auditName);
  d.description =
    'DRAFT AUDIT CS: lima specialist dan izin tool mengikuti CS bawaan. Belum setara: tool transaksi pesanan/foto, node Pesanan, fallback dari Agent, dan tiket menunggu belum tersedia. Jangan diterbitkan untuk klien.';
  const base = d.nodes[1];
  const node = (id: string, type: GraphNode['type'], label: string, x: number, y: number): GraphNode => ({
    ...base,
    id,
    type,
    label,
    x,
    y,
    prompt: '',
    tools: [],
    value: '',
    memory: '',
  });
  const names = Object.keys(agents) as (keyof typeof agents)[];
  const router = node('router', 'router', 'Router CS', 330, 300);
  router.tier = 'decision';
  router.memory = 'router_memory';
  router.prompt =
    'Klasifikasikan intent pesan terbaru sesuai kategori. Gunakan ringkasan sebelumnya untuk kelanjutan, dan ikuti topik baru bila berubah.';
  router.branches = names.map(id => ({
    id,
    label: id,
    description: routerPrompt.match(new RegExp('(?:^|\\n)-\\s*' + id + ':\\s*([^\\n]+)'))?.[1] ?? agents[id],
  }));
  const specialists = names.map((id, i) => ({
    ...node(id, 'agent', id.replaceAll('_', ' '), 650, 50 + i * 240),
    prompt: agents[id],
    memory: 'shared_memory',
    tools: permissions[id].filter(t => !supportedOnly || !unsupportedTools.includes(t)),
    tier: id === 'layanan' ? ('medium' as const) : ('cheap' as const),
  }));
  const context = {
    ...node('context', 'context', 'Context CS', 960, 530),
    prompt: contextPrompt,
    memory: 'shared_memory',
    tier: 'cheap' as const,
  };
  const output = { ...node('output', 'output', 'Jawaban akhir', 1260, 530), value: '' };
  const text = (id: string, label: string, required = true): Field => ({
    id,
    label,
    required,
    type: 'text',
    options: [],
    collection: '',
  });
  const number = (id: string, label: string): Field => ({ ...text(id, label), type: 'number' });
  d.collections = [
    { id: 'knowledge', name: 'Knowledge uji', fields: [text('judul', 'Judul'), text('isi', 'Isi')] },
    {
      id: 'products',
      name: 'Produk uji',
      fields: [text('nama', 'Nama'), text('deskripsi', 'Deskripsi'), number('harga', 'Harga'), number('stok', 'Stok')],
    },
    {
      id: 'orders',
      name: 'Record pesanan uji (bukan transaksi)',
      fields: [
        text('nomor', 'Nomor'),
        text('pelanggan', 'Pelanggan'),
        text('produk', 'Produk'),
        number('jumlah', 'Jumlah'),
        text('status', 'Status'),
      ],
    },
  ];
  const reads = [
    ['get_knowledge', 'knowledge'],
    ['get_products', 'products'],
    ['check_order', 'orders'],
  ].map(([id, collection], i) => ({
    ...node(id, 'tool', id + ' · koleksi uji', 500 + i * 260, 1330),
    collection,
    operation: 'search' as const,
    query: '',
  }));
  if (supportedOnly)
    for (const a of specialists)
      a.prompt +=
        '\nMode audit: tool yang tersedia hanya pembacaan koleksi contoh. Jangan membuat pesanan atau mengirim foto. Hasil berbentuk {records:[{data:...}]}. Gunakan query kosong untuk profil usaha; untuk produk gunakan kata nama seperti basic. Jika diminta transaksi/foto, jelaskan bahwa fitur itu belum tersedia dalam profil uji.';
  d.nodes = [
    { ...d.nodes[0], y: 300 },
    router,
    ...specialists,
    context,
    output,
    ...reads,
    { ...node('router_memory', 'memory', 'Memori router (ringkasan)', 60, 650), memory_limit: 0 },
    { ...node('shared_memory', 'memory', 'Shared Memory CS', 100, 1040), memory_limit: 20 },
  ];
  d.edges = [
    { id: 'input_router', source: 'input', port: 'next', target: 'router' },
    ...names.flatMap(id => [
      { id: 'route_' + id, source: 'router', port: id, target: id },
      { id: 'summarize_' + id, source: id, port: 'next', target: 'context' },
    ]),
    { id: 'context_output', source: 'context', port: 'next', target: 'output' },
  ];
  return d;
}
