import {routerOutputSchema} from './ai-router-schema.js';
import type {RowDataPacket} from 'mysql2/promise';
import {db} from './db.js';
import {agents,routerPrompt,contextPrompt,permissions,type AgentName} from './ai-agents.js';
import {roleTier,modelTiers,type AgentWorkflow,type ModelRole} from './ai-models.js';
import {record} from './ai-data.js';
import {ApiError} from './engine/sessions.js';

export function defaultWorkflow():AgentWorkflow {
 return {nodes:Object.fromEntries(Object.entries(roleTier).map(([role,tier])=>[role,{tier,model:'',...(role==='router'?{structured_output:false}:{}),prompt:role==='router'?routerPrompt:role==='context'?contextPrompt:agents[role as AgentName],tools:[...(permissions[role as AgentName]??[])]}])) as AgentWorkflow['nodes']};
}
export function workflowInput(value:unknown):AgentWorkflow {
 const root=record(value),nodes=record(root.nodes),roles=Object.keys(roleTier);
 if(Object.keys(root).join()!=='nodes'||Object.keys(nodes).sort().join()!==roles.sort().join())throw new ApiError(400,'invalid_workflow','Node dan hubungan alur bersifat tetap.');
 const result=defaultWorkflow();
 for(const role of roles as ModelRole[]){
  const node=record(nodes[role]);
  if(Object.keys(node).some(k=>!['prompt','tier','model','tools',...(role==='router'?['structured_output']:[])].includes(k))||(node.structured_output!==undefined&&typeof node.structured_output!=='boolean')||typeof node.prompt!=='string'||!node.prompt.trim()||node.prompt.length>8000||!modelTiers.includes(node.tier as any)||typeof node.model!=='string'||node.model.length>100||!Array.isArray(node.tools))throw new ApiError(400,'invalid_workflow','Pengaturan node '+role+' tidak valid.');
  const allowed:readonly string[]=permissions[role as AgentName]??[];
  if(node.tools.some(t=>typeof t!=='string'||!allowed.includes(t))||new Set(node.tools).size!==node.tools.length)throw new ApiError(400,'invalid_workflow','Tool node '+role+' tidak diizinkan.');
  result.nodes[role]={prompt:node.prompt.trim(),tier:node.tier as typeof modelTiers[number],model:node.model.trim(),tools:node.tools as string[],...(role==='router'?{structured_output:node.structured_output===true}:{})};
 }
 return result;
}
const parse=(value:unknown)=>workflowInput(typeof value==='string'?JSON.parse(value):value);
export async function workflowState(){
 const [rows]=await db.query<RowDataPacket[]>('SELECT * FROM ai_workflow WHERE id=1');const row=rows[0];
 return {draft:row?parse(row.draft):defaultWorkflow(),active:row?.active?parse(row.active):defaultWorkflow(),revision:Number(row?.revision??0),active_version:Number(row?.active_version??0),published_revision:Number(row?.published_revision??0),allowedTools:permissions,routerSchema:routerOutputSchema};
}
export async function activeWorkflow(){const [rows]=await db.query<RowDataPacket[]>('SELECT active FROM ai_workflow WHERE id=1');return rows[0]?.active?parse(rows[0].active):defaultWorkflow();}
export async function changeWorkflow(actor:string,value:unknown,publish=false){
 const body=record(value);if(!Number.isSafeInteger(body.revision)||Number(body.revision)<0)throw new ApiError(400,'invalid_revision','Revision wajib valid.');
 const draft=publish?undefined:workflowInput(body.draft),c=await db.getConnection();
 try{
  await c.beginTransaction();
  await c.execute('INSERT IGNORE INTO ai_workflow(id,draft) VALUES (1,?)',[JSON.stringify(defaultWorkflow())]);
  const [rows]=await c.query<RowDataPacket[]>('SELECT revision FROM ai_workflow WHERE id=1 FOR UPDATE');
  if(Number(rows[0].revision)!==body.revision)throw new ApiError(409,'workflow_conflict','Draft berubah di tempat lain. Muat ulang sebelum menyimpan.');
  if(publish)await c.query('UPDATE ai_workflow SET active=draft,active_version=active_version+1,published_revision=revision WHERE id=1');
  else await c.execute('UPDATE ai_workflow SET draft=?,revision=revision+1 WHERE id=1',[JSON.stringify(draft)]);
  await c.execute('INSERT INTO audit_events(account_id,action) VALUES (?,?)',[actor,publish?'ai_workflow_published':'ai_workflow_draft_saved']);
  await c.commit();
 }catch(error){await c.rollback();throw error;}finally{c.release();}
 return workflowState();
}
