// Template CS lengkap memakai node dan kemampuan yang sama dengan editor profil umum.
import { blankDefinition, businessTools, type GraphDefinition, type GraphNode } from './definition.js';
import { agents, permissions, contextPrompt, routerPrompt } from '../profiles/cs/pipeline.js';
export function csTemplate(): GraphDefinition {
  const d = blankDefinition('CS Usaha lengkap');
  d.description =
    'Lima specialist CS dengan memori, katalog, pesanan tervalidasi, foto produk, dan fallback tim. Data bisnis diisi masing-masing akun.';
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
    fallback: true,
    tools: [...permissions[id]],
    tier: id === 'layanan' ? ('medium' as const) : ('cheap' as const),
  }));
  const context = {
    ...node('context', 'context', 'Context CS', 960, 530),
    prompt: contextPrompt,
    context_format: 'spo' as const,
    memory: 'shared_memory',
    tier: 'cheap' as const,
  };
  const output = { ...node('output', 'output', 'Jawaban akhir', 1260, 530), value: '' };
  const reads = businessTools.map((capability, i) => ({
    ...node(capability, 'tool', capability, 350 + i * 240, 1400),
    capability,
    tier: capability === 'create_order' ? ('structured' as const) : ('medium' as const),
    query: '',
  }));
  const fallback = node('fallback', 'fallback', 'Konfirmasi petugas', 1000, 1130);
  d.nodes = [
    { ...d.nodes[0], y: 300 },
    router,
    ...specialists,
    context,
    output,
    ...reads,
    fallback,
    { ...node('router_memory', 'memory', 'Memori router (ringkasan)', 60, 650), memory_limit: 0 },
    { ...node('shared_memory', 'memory', 'Shared Memory CS', 100, 1040), memory_limit: 20 },
  ];
  d.edges = [
    { id: 'input_router', source: 'input', port: 'next', target: 'router' },
    ...names.flatMap(id => [
      { id: 'route_' + id, source: 'router', port: id, target: id },
      { id: 'fallback_' + id, source: id, port: 'fallback', target: 'fallback' },
      { id: 'summarize_' + id, source: id, port: 'next', target: 'context' },
    ]),
    { id: 'context_output', source: 'context', port: 'next', target: 'output' },
  ];
  return d;
}
