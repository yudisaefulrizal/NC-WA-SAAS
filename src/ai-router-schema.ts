export const routerAgentNames=['pembuka','informasi','layanan','penutup','lainnya'] as const;
export type RouterAgentName=typeof routerAgentNames[number];
export const routerOutputSchema={
 type:'object',
 properties:{
  s_p_o_konteks:{type:'string',description:'Ringkasan S-P-O dipisahkan tanda hubung, minimal tiga kata, tambahkan kata secukupnya agar makna tetap utuh. Maksimal 200 karakter.'},
  sub_agent:{type:'string',enum:routerAgentNames},
  isi_pesan:{type:'string',description:'Pesan terbaru pelanggan persis tanpa perubahan.'},
  fallback_terkait:{type:'array',items:{type:'string'},description:'ID tiket menunggu yang relevan dari daftar yang diberikan. Gunakan [] bila tidak terkait.'},
 },
 required:['s_p_o_konteks','sub_agent','isi_pesan','fallback_terkait'],additionalProperties:false,
} as const;
export function validateRouterOutput(route:Record<string,unknown>,input:string,available:readonly string[]=[]){
 // Older prompts are compatible only when no ticket selection is needed.
 if(route.fallback_terkait===undefined&&!available.length)route={...route,fallback_terkait:[]};
 const selected=route.fallback_terkait;
 if(!Array.isArray(selected)||selected.some(id=>typeof id!=='string'||!available.includes(id))||new Set(selected).size!==selected.length)throw Error('ai_invalid_route');
 if(typeof route.sub_agent!=='string'||!routerAgentNames.includes(route.sub_agent as RouterAgentName)
  ||route.isi_pesan!==input||typeof route.s_p_o_konteks!=='string'
  ||!route.s_p_o_konteks.trim()||route.s_p_o_konteks.length>200
  ||Object.keys(route).sort().join(',')!==[...routerOutputSchema.required].sort().join(','))throw Error('ai_invalid_route');
 return route;
}
export function routerResponseFormat(){return {type:'json_schema',json_schema:{name:'router_output',strict:true,schema:routerOutputSchema}};}
