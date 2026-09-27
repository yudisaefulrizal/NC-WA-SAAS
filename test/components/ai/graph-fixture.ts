// Graf uji bersama untuk tes runtime, data profil, dan pemeriksaan browser. simpleGraph: satu agent ("info") yang
// boleh meneruskan ke tim lewat node Fallback. routedGraph: Router memilih agent "info" atau "layanan", lalu node
// Context meringkas percakapan ke Shared Memory; tier modelnya Murah untuk Router dan Context, Sedang untuk agent.
// catalogGraph: Router ke agent "layanan" (tool cari_data atas koleksi Produk) atau "sapaan", masing-masing ke Output
// sendiri, dengan Shared Memory.
import {
  blankDefinition,
  parseDefinition,
  validateGraph,
  type Collection,
  type GraphDefinition,
  type GraphNode,
} from '../../../src/components/ai/domain/builder/definition.js';
import { createGraph, saveGraph } from '../../../src/components/ai/domain/builder/store.js';
import { setProfileEnabled } from '../../../src/components/ai/domain/profiles/registry.js';

function base(name: string) {
  const d = blankDefinition(name);
  const node = d.nodes[1];
  const agent = (id: string): GraphNode => ({
    ...node,
    id,
    label: id,
    fallback: true,
    memory: 'memory',
    prompt: 'Jawab pelanggan ' + id + '.',
  });
  const nodes: GraphNode[] = [
    d.nodes[0],
    { ...node, id: 'memory', type: 'memory', label: 'Shared_Memory', memory_limit: 20 },
    { ...d.nodes[2], id: 'output', label: 'output', value: '' },
    { ...d.nodes[2], id: 'tim', type: 'fallback', label: 'Tim', value: '' },
  ];
  return { d, node, agent, nodes };
}
export function simpleGraph(name = 'Profil uji'): GraphDefinition {
  const { d, agent, nodes } = base(name);
  d.nodes = [...nodes, agent('info')];
  d.edges = [
    { id: 'e1', source: 'input', port: 'next', target: 'info' },
    { id: 'e2', source: 'info', port: 'next', target: 'output' },
    { id: 'e3', source: 'info', port: 'fallback', target: 'tim' },
  ];
  return checked(d);
}
export function routedGraph(name = 'Profil uji berjalur'): GraphDefinition {
  const { d, node, agent, nodes } = base(name);
  d.nodes = [
    ...nodes,
    {
      ...node,
      id: 'router',
      type: 'router',
      label: 'Router',
      tier: 'cheap',
      memory: 'memory',
      prompt: 'Pilih cabang sesuai maksud pesan.',
      branches: [
        { id: 'info', label: 'Info', description: 'Informasi umum' },
        { id: 'layanan', label: 'Layanan', description: 'Pesanan dan layanan' },
      ],
    },
    agent('info'),
    agent('layanan'),
    {
      ...node,
      id: 'context',
      type: 'context',
      label: 'Context',
      tier: 'cheap',
      memory: 'memory',
      context_format: 'spo',
      prompt: 'Ringkas percakapan sebagai Subjek-Predikat-Objek.',
    },
  ];
  d.edges = [
    { id: 'e1', source: 'input', port: 'next', target: 'router' },
    { id: 'e2', source: 'router', port: 'info', target: 'info' },
    { id: 'e3', source: 'router', port: 'layanan', target: 'layanan' },
    { id: 'e4', source: 'info', port: 'next', target: 'context' },
    { id: 'e5', source: 'layanan', port: 'next', target: 'context' },
    { id: 'e6', source: 'info', port: 'fallback', target: 'tim' },
    { id: 'e7', source: 'layanan', port: 'fallback', target: 'tim' },
    { id: 'e8', source: 'context', port: 'next', target: 'output' },
  ];
  return checked(d);
}
export function catalogGraph(name = 'Katalog uji'): GraphDefinition {
  const d = blankDefinition(name);
  d.description = 'Asisten dengan data koleksi yang dapat disesuaikan.';
  const collection: Collection = {
    id: 'produk',
    name: 'Produk',
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
    type: 'data_table',
    label: 'Cari_' + collection.name,
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
  d.nodes[2].label = 'Jawaban_layanan';
  d.nodes[2].value = '{{nodes.layanan.answer}}';
  const closing: GraphNode = {
    ...d.nodes[2],
    id: 'output_sapaan',
    label: 'Jawaban_sapaan',
    y: 350,
    value: '{{nodes.sapaan.answer}}',
  };
  d.nodes.push(router, greet, tool, closing);
  d.edges = [
    { id: 'e1', source: 'input', port: 'next', target: 'router' },
    { id: 'e2', source: 'router', port: 'layanan', target: 'layanan' },
    { id: 'e3', source: 'router', port: 'sapaan', target: 'sapaan' },
    { id: 'e4', source: 'layanan', port: 'next', target: 'output' },
    { id: 'e5', source: 'sapaan', port: 'next', target: 'output_sapaan' },
  ];
  d.nodes.push({
    ...d.nodes[0],
    id: 'shared_memory',
    type: 'memory',
    label: 'Shared_Memory',
    x: 330,
    y: 650,
    memory_limit: 20,
  });
  for (const n of d.nodes) if (['router', 'agent', 'context'].includes(n.type)) n.memory = 'shared_memory';
  return checked(d);
}
function checked(d: GraphDefinition) {
  const issues = validateGraph(parseDefinition(d));
  if (issues.length) throw Error('Graf uji tidak valid: ' + issues.map(i => i.message).join('; '));
  return d;
}
// Menerbitkan dan menyalakan graf untuk semua klien; mengembalikan ID profilnya. Pemanggil menghapus baris
// ai_graph_profiles dan ai_profile_types-nya setelah tes.
export async function publishGraph(owner: string, d: GraphDefinition) {
  const g = await createGraph(owner, d);
  await saveGraph(owner, g.id, { revision: g.revision }, true);
  await setProfileEnabled(owner, g.id, true);
  return g.id;
}
