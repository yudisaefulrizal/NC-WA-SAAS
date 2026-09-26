// Template awal memakai format yang sama dengan profil kosong dan berkas impor.
import { blankDefinition, type Collection, type GraphDefinition, type GraphNode } from './definition.js';
export function templates(): { id: string; definition: GraphDefinition }[] {
  return ['catalog', 'pendidikan', 'tester'].map(id => {
    const d = blankDefinition(
      id === 'catalog' ? 'Katalog sederhana' : id === 'pendidikan' ? 'CS Pendidikan' : 'Tester AI',
    );
    d.description =
      id === 'tester'
        ? 'Pelanggan simulasi untuk menguji layanan.'
        : 'Asisten dengan data koleksi yang dapat disesuaikan.';
    if (id === 'tester') {
      d.nodes[1].prompt =
        'Berperan sebagai pelanggan untuk menguji layanan. Tulis pertanyaan singkat dan alami. Jangan menjawab pertanyaan sendiri.';
      return { id, definition: withMemory(d) };
    }
    const collection: Collection = {
      id: id === 'catalog' ? 'produk' : 'program',
      name: id === 'catalog' ? 'Produk' : 'Program',
      owner: 'shared',
      fields: [
        { id: 'nama', label: 'Nama', type: 'text', required: true, options: [], collection: '' },
        { id: 'deskripsi', label: 'Deskripsi', type: 'text', required: false, options: [], collection: '' },
        { id: 'biaya', label: 'Biaya', type: 'number', required: false, options: [], collection: '' },
      ],
    };
    d.collections.push(collection);
    const agent = d.nodes[1];
    agent.id = 'layanan';
    agent.label = 'Layanan';
    agent.tools = ['cari_data'];
    agent.prompt =
      'Bantu pengguna dalam bahasa Indonesia. Gunakan tool cari_data untuk informasi yang tersedia; jangan mengarang. Bila belum jelas, tanyakan kebutuhan pengguna.';
    const tool: GraphNode = {
      ...agent,
      id: 'cari_data',
      type: 'tool',
      label: 'Cari ' + collection.name,
      x: 440,
      y: 480,
      collection: collection.id,
      tools: [],
      operation: 'search',
      query: '{{input.message}}',
    };
    const router: GraphNode = {
      ...agent,
      id: 'router',
      type: 'router',
      label: 'Router',
      x: 330,
      y: 120,
      tier: 'decision',
      prompt: 'Pilih maksud utama pesan pengguna.',
      tools: [],
      branches: [
        {
          id: 'layanan',
          label: 'Layanan',
          description: 'Pertanyaan produk, program, biaya, kebutuhan, atau kelanjutan transaksi.',
        },
        { id: 'sapaan', label: 'Sapaan', description: 'Salam, terima kasih, atau pamit.' },
      ],
    };
    const greet: GraphNode = {
      ...agent,
      id: 'sapaan',
      label: 'Sapaan',
      x: 640,
      y: 350,
      tools: [],
      prompt: 'Balas salam atau terima kasih secara singkat dan ramah.',
    };
    agent.x = 640;
    agent.y = 100;
    d.nodes[2].x = 990;
    d.nodes[2].value = '{{nodes.layanan.answer}}';
    const closing: GraphNode = { ...d.nodes[2], id: 'output_sapaan', y: 350, value: '{{nodes.sapaan.answer}}' };
    d.nodes.push(router, greet, tool, closing);
    d.edges = [
      { id: 'e1', source: 'input', port: 'next', target: 'router' },
      { id: 'e2', source: 'router', port: 'layanan', target: 'layanan' },
      { id: 'e3', source: 'router', port: 'sapaan', target: 'sapaan' },
      { id: 'e4', source: 'layanan', port: 'next', target: 'output' },
      { id: 'e5', source: 'sapaan', port: 'next', target: 'output_sapaan' },
    ];
    return { id, definition: withMemory(d) };
  });
}

function withMemory(d: GraphDefinition): GraphDefinition {
  d.nodes.push({
    ...d.nodes[0],
    id: 'shared_memory',
    type: 'memory',
    label: 'Shared Memory',
    x: 330,
    y: 650,
    memory_limit: 20,
  });
  for (const n of d.nodes) if (['router', 'agent', 'context'].includes(n.type)) n.memory = 'shared_memory';
  return d;
}
