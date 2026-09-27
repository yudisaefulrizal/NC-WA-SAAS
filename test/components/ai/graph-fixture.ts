// Graf uji bersama untuk tes runtime dan data profil. simpleGraph: satu agent ("info") yang boleh meneruskan ke tim
// lewat node Fallback. routedGraph: Router memilih agent "info" atau "layanan", lalu node Context meringkas
// percakapan ke Shared Memory; tier modelnya Murah untuk Router dan Context, Sedang untuk agent.
import {
  blankDefinition,
  parseDefinition,
  validateGraph,
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
    { ...node, id: 'memory', type: 'memory', label: 'Shared Memory', memory_limit: 20 },
    { ...d.nodes[2], id: 'output', value: '' },
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
