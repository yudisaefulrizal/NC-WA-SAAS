export const routerAgentNames=['pembuka','informasi','konsultasi','transaksi','dukungan','keluhan','penutup','lainnya'] as const;
export type RouterAgentName=typeof routerAgentNames[number];
export const routerOutputSchema={
 type:'object',
 properties:{
  s_p_o_konteks:{type:'string',description:'Ringkasan S-P-O; usahakan tiga kata. Maksimal 200 karakter.'},
  sub_agent:{type:'string',enum:routerAgentNames},
  isi_pesan:{type:'string',description:'Pesan terbaru pelanggan persis tanpa perubahan.'},
 },
 required:['s_p_o_konteks','sub_agent','isi_pesan'],additionalProperties:false,
} as const;
export function validateRouterOutput(route:Record<string,unknown>,input:string){
 if(typeof route.sub_agent!=='string'||!routerAgentNames.includes(route.sub_agent as RouterAgentName)
  ||route.isi_pesan!==input||typeof route.s_p_o_konteks!=='string'
  ||!route.s_p_o_konteks.trim()||route.s_p_o_konteks.length>200
  ||Object.keys(route).sort().join(',')!==[...routerOutputSchema.required].sort().join(','))throw Error('ai_invalid_route');
 return route;
}
export function routerResponseFormat(){return {type:'json_schema',json_schema:{name:'router_output',strict:true,schema:routerOutputSchema}};}
