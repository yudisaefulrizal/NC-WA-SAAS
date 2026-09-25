// Skema jawaban Router: specialist mana yang menjawab dan tiket fallback mana yang dipilih. Daftar specialist di
// bawah milik CS Usaha; pipeline profil lain memberikan daftarnya sendiri ke fungsi-fungsi ini.
export const routerAgentNames = ['pembuka', 'profil_perusahaan', 'layanan', 'penutup', 'lainnya'] as const;
export type RouterAgentName = (typeof routerAgentNames)[number];
export function routerSchema(names: readonly string[] = routerAgentNames) {
  return {
    type: 'object',
    properties: {
      s_p_o_konteks: {
        type: 'string',
        description:
          'Ringkasan S-P-O dipisahkan tanda hubung, minimal tiga kata, tambahkan kata secukupnya agar makna tetap utuh. Maksimal 200 karakter.',
      },
      sub_agent: { type: 'string', enum: names },
      isi_pesan: { type: 'string', description: 'Pesan terbaru pelanggan persis tanpa perubahan.' },
      fallback_terkait: {
        type: 'array',
        items: { type: 'string' },
        description: 'ID tiket menunggu yang relevan dari daftar yang diberikan. Gunakan [] bila tidak terkait.',
      },
    },
    required: ['s_p_o_konteks', 'sub_agent', 'isi_pesan', 'fallback_terkait'],
    additionalProperties: false,
  } as const;
}
export const routerOutputSchema = routerSchema();
export function validateRouterOutput(
  route: Record<string, unknown>,
  input: string,
  available: readonly string[] = [],
  names: readonly string[] = routerAgentNames,
) {
  // Prompt lama tetap cocok hanya bila tidak perlu memilih tiket.
  if (route.fallback_terkait === undefined && !available.length) route = { ...route, fallback_terkait: [] };
  const selected = route.fallback_terkait;
  if (
    !Array.isArray(selected) ||
    selected.some(id => typeof id !== 'string' || !available.includes(id)) ||
    new Set(selected).size !== selected.length
  )
    throw Error('ai_invalid_route');
  if (
    typeof route.sub_agent !== 'string' ||
    !names.includes(route.sub_agent) ||
    route.isi_pesan !== input ||
    typeof route.s_p_o_konteks !== 'string' ||
    !route.s_p_o_konteks.trim() ||
    route.s_p_o_konteks.length > 200 ||
    Object.keys(route).sort().join(',') !== [...routerOutputSchema.required].sort().join(',')
  )
    throw Error('ai_invalid_route');
  return route;
}
export function routerResponseFormat(names: readonly string[] = routerAgentNames) {
  return { type: 'json_schema', json_schema: { name: 'router_output', strict: true, schema: routerSchema(names) } };
}
