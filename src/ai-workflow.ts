import {routerOutputSchema} from './ai-router-schema.js';
import {agents,routerPrompt,contextPrompt,permissions,type AgentName} from './ai-agents.js';
import {orderPrompt,orderOutputSchema} from './ai-order-schema.js';
import {roleTier,modelTiers,type AgentWorkflow,type ModelRole} from './ai-models.js';
import {record} from './ai-data.js';
import {ApiError} from './engine/sessions.js';

export function defaultWorkflow():AgentWorkflow {
 return {nodes:Object.fromEntries(Object.entries(roleTier).map(([role,tier])=>[role,{tier,model:'',...(role==='router'||role==='pesanan'?{structured_output:false}:{}),prompt:role==='router'?routerPrompt:role==='context'?contextPrompt:role==='pesanan'?orderPrompt:agents[role as AgentName],tools:[...(permissions[role as AgentName]??[])]}])) as AgentWorkflow['nodes']};
}
export function workflowInput(value:unknown):AgentWorkflow {
 // Workflows saved before the Pesanan node existed get its default instead of being rejected.
 const root=record(value),stored=record(root.nodes),nodes='pesanan' in stored?stored:{...stored,pesanan:defaultWorkflow().nodes.pesanan},roles=Object.keys(roleTier);
 if(Object.keys(root).join()!=='nodes'||Object.keys(nodes).sort().join()!==roles.sort().join())throw new ApiError(400,'invalid_workflow','Node dan hubungan alur bersifat tetap.');
 const result=defaultWorkflow();
 for(const role of roles as ModelRole[]){
  const node=record(nodes[role]);
  if(Object.keys(node).some(k=>!['prompt','tier','model','tools',...(role==='router'||role==='pesanan'?['structured_output']:[])].includes(k))||(node.structured_output!==undefined&&typeof node.structured_output!=='boolean')||typeof node.prompt!=='string'||!node.prompt.trim()||node.prompt.length>8000||!modelTiers.includes(node.tier as any)||typeof node.model!=='string'||node.model.length>100||!Array.isArray(node.tools))throw new ApiError(400,'invalid_workflow','Pengaturan node '+role+' tidak valid.');
  const allowed:readonly string[]=permissions[role as AgentName]??[];
  if(node.tools.some(t=>typeof t!=='string'||!allowed.includes(t))||new Set(node.tools).size!==node.tools.length)throw new ApiError(400,'invalid_workflow','Tool node '+role+' tidak diizinkan.');
  result.nodes[role]={prompt:node.prompt.trim(),tier:node.tier as typeof modelTiers[number],model:node.model.trim(),tools:node.tools as string[],...(role==='router'||role==='pesanan'?{structured_output:node.structured_output===true}:{})};
 }
 return result;
}
// What AI Studio shows next to the CS canvas: which tools each node may use and the schemas it enforces.
export function csStudioMeta(){return {allowedTools:permissions,routerSchema:routerOutputSchema,orderSchema:orderOutputSchema(['<nama produk dari katalog>'])};}
