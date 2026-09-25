import {randomUUID} from 'node:crypto';
import {createWriteStream} from 'node:fs';
import {copyFile,mkdir,rename,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import type {Readable} from 'node:stream';
import type {PoolConnection} from 'mysql2/promise';
import {db} from '../../../../../libraries/db.js';
import {ApiError} from '../../../../../libraries/errors.js';
import {sniffMediaType} from '../../../../../libraries/media-type.js';
import {storagePaths} from '../../../../../libraries/storage.js';
import {copyEduContacts,copyEduPrograms,countEduContactsByDataProfileId,countEduDocumentsByDataProfileIdId,countEduProgramsByDataProfileId,deleteEduContactsByIdAccountIdDataProfileId,deleteEduDocumentsById,deleteEduProgramsByIdAccountIdDataProfileId,insertEduContact,insertEduDocuments,insertEduProgram,lockAccountsSuspendedById,lockDataProfilesProfileTypeByIdAccountId,lockEduDocumentsFileIdByIdAccountIdDataProfileId,selectEduContactsByAccountIdDataProfileId,selectEduDocumentFiles,selectEduDocumentRowsForCopy,selectEduDocuments,selectEduDocumentsByIdAccountIdDataProfileId,selectEduProgramsByAccountIdDataProfileId,selectEduProgramsIdByDataProfileIdNameId,updateDataProfilesRevisionById,updateEduContactsBagianByIdAccountIdDataProfileId,updateEduDocumentsDescriptionByIdAccountIdDataProfileId,updateEduDocumentsFileIdById,updateEduProgramsNameByIdAccountIdDataProfileId} from '../../../data-access/edu-queries.js';
import {eduLimits} from './profile.js';
// CS Lembaga Pendidikan: answers prospective students, parents and current students from what the institution
// writes (profile, programs, schedule, contacts) and sends its documents. It never records anyone's personal
// data; registration, tests and visits are whatever mechanism the institution describes in its own text.
const invalid=(message:string)=>new ApiError(400,'invalid_request',message);
const missing=(message='Data tidak ditemukan')=>new ApiError(404,'not_found',message);
function text(value:unknown,max:number,name:string,empty=true){if(typeof value!=='string'||value.length>max||(!empty&&!value.trim()))throw invalid(name+' tidak valid atau terlalu panjang');return value.trim();}
function rowId(value:unknown,name:string){if(typeof value!=='string'||!/^[0-9a-f-]{36}$/.test(value))throw missing(name+' tidak ditemukan');return value;}
export interface EduProgram {id:string;name:string;description:string}
export interface EduContact {id:string;bagian:string;kontak:string;deskripsi:string}
export interface EduDocument {id:string;filename:string;mimetype:string;media_type:'image'|'document';size_bytes:number;description:string;created_at?:unknown}
export function programInput(value:unknown){const p=value as Record<string,unknown>;if(!p||typeof p!=='object'||Array.isArray(p))throw invalid('Program wajib valid');return {name:text(p.name,eduLimits.programName,'Nama program',false),description:text(p.description??'',eduLimits.programDescription,'Deskripsi program')};}
export function contactInput(value:unknown){const c=value as Record<string,unknown>;if(!c||typeof c!=='object'||Array.isArray(c))throw invalid('Kontak wajib valid');return {bagian:text(c.bagian,eduLimits.contactPart,'Bagian',false),kontak:text(c.kontak,eduLimits.contact,'Kontak',false),deskripsi:text(c.deskripsi??'',eduLimits.contactDescription,'Deskripsi kontak')};}
export function documentDescription(value:unknown){return text(value,eduLimits.documentDescription,'Deskripsi dokumen',false);}
// Images and PDF/Word/Excel/PowerPoint files; legacy Office files (.doc/.xls/.ppt) are recognised by their
// OLE header plus extension, since that container carries no readable type of its own.
const legacyOffice:Record<string,string>={'.doc':'application/msword','.xls':'application/vnd.ms-excel','.ppt':'application/vnd.ms-powerpoint'};
export function documentType(head:Buffer,filename:string):{media_type:'image'|'document';mimetype:string}{
 const sniffed=sniffMediaType(head,filename),extension=/\.[a-z0-9]+$/i.exec(filename)?.[0].toLowerCase()??'';
 if(sniffed?.mediaType==='image')return {media_type:'image',mimetype:sniffed.mimetype};
 if(sniffed?.mediaType==='document'&&sniffed.mimetype!=='application/zip'&&sniffed.mimetype!=='application/octet-stream')return {media_type:'document',mimetype:sniffed.mimetype};
 if(head.length>=8&&head.readUInt32BE(0)===0xd0cf11e0&&head.readUInt32BE(4)===0xa1b11ae1&&legacyOffice[extension])return {media_type:'document',mimetype:legacyOffice[extension]};
 throw new ApiError(400,'unsupported_file_type','Dokumen harus PDF, Word, Excel, PowerPoint, atau gambar JPG/PNG/WebP');
}
export function filename(value:unknown){const name=text(value,255,'Nama file',false).replace(/[\\/\0\r\n]/g,'_');return name;}
export class EduStore {
 constructor(public root=storagePaths().aiDocuments){}
 private dir(account:string){return join(this.root,account);}
 path(account:string,id:string){return join(this.dir(account),rowId(id,'Dokumen'));}
 async programs(account:string,profile:string):Promise<EduProgram[]>{const [rows]=await selectEduProgramsByAccountIdDataProfileId(db,[account,profile]);return rows.map(r=>({id:String(r.id),name:String(r.name),description:String(r.description)}));}
 async saveProgram(account:string,profile:string,id:string|null,value:unknown){
  const input=programInput(value);
  return this.write(account,profile,async c=>{
   const [taken]=await selectEduProgramsIdByDataProfileIdNameId(c,[profile,input.name,...(id?[id]:[])],id);if(taken[0])throw new ApiError(409,'name_taken','Nama program sudah dipakai.');
   if(id){const [result]=await updateEduProgramsNameByIdAccountIdDataProfileId(c,[input.name,input.description,rowId(id,'Program'),account,profile]);if(!result.affectedRows)throw missing('Program tidak ditemukan');return {id,...input};}
   const [count]=await countEduProgramsByDataProfileId(c,[profile]);if(Number(count[0].n)>=eduLimits.programs)throw new ApiError(409,'program_limit','Maksimal '+eduLimits.programs+' program per data profil.');
   const created=randomUUID();await insertEduProgram(c,[created,account,profile,input.name,input.description,Number(count[0].last)+1]);return {id:created,...input};
  });
 }
 async deleteProgram(account:string,profile:string,id:string){return this.write(account,profile,async c=>{const [result]=await deleteEduProgramsByIdAccountIdDataProfileId(c,[rowId(id,'Program'),account,profile]);if(!result.affectedRows)throw missing('Program tidak ditemukan');return {ok:true};});}
 async contacts(account:string,profile:string):Promise<EduContact[]>{const [rows]=await selectEduContactsByAccountIdDataProfileId(db,[account,profile]);return rows.map(r=>({id:String(r.id),bagian:String(r.bagian),kontak:String(r.kontak),deskripsi:String(r.deskripsi)}));}
 async saveContact(account:string,profile:string,id:string|null,value:unknown){
  const input=contactInput(value);
  return this.write(account,profile,async c=>{
   if(id){const [result]=await updateEduContactsBagianByIdAccountIdDataProfileId(c,[input.bagian,input.kontak,input.deskripsi,rowId(id,'Kontak'),account,profile]);if(!result.affectedRows)throw missing('Kontak tidak ditemukan');return {id,...input};}
   const [count]=await countEduContactsByDataProfileId(c,[profile]);if(Number(count[0].n)>=eduLimits.contacts)throw new ApiError(409,'contact_limit','Maksimal '+eduLimits.contacts+' kontak per data profil.');
   const created=randomUUID();await insertEduContact(c,[created,account,profile,input.bagian,input.kontak,input.deskripsi,Number(count[0].last)+1]);return {id:created,...input};
  });
 }
 async deleteContact(account:string,profile:string,id:string){return this.write(account,profile,async c=>{const [result]=await deleteEduContactsByIdAccountIdDataProfileId(c,[rowId(id,'Kontak'),account,profile]);if(!result.affectedRows)throw missing('Kontak tidak ditemukan');return {ok:true};});}
 async documents(account:string,profile:string):Promise<EduDocument[]>{const [rows]=await selectEduDocuments(db,[account,profile]);return rows.map(r=>({id:String(r.id),filename:String(r.filename),mimetype:String(r.mimetype),media_type:r.media_type,size_bytes:Number(r.size_bytes),description:String(r.description),created_at:r.created_at}));}
 // Reads the upload into memory (at most 10 MB), checks its real type, then writes it under a random id.
 private async receive(account:string,name:string,body:Readable){
  const chunks:Buffer[]=[];let size=0;
  for await(const chunk of body){size+=chunk.length;if(size>eduLimits.documentBytes)throw new ApiError(413,'document_too_large','Ukuran dokumen melebihi 10 MB');chunks.push(chunk);}
  const content=Buffer.concat(chunks);if(!content.length)throw invalid('File kosong');
  const type=documentType(content.subarray(0,64),name);
  if(type.media_type==='image'&&content.length>eduLimits.imageBytes)throw new ApiError(413,'document_too_large','Ukuran gambar melebihi 5 MB');
  const id=randomUUID(),dir=this.dir(account),temporary=join(dir,id+'.part');
  await mkdir(dir,{recursive:true,mode:0o700});
  try{await new Promise<void>((done,fail)=>{const out=createWriteStream(temporary,{mode:0o600,flags:'wx'});out.on('error',fail);out.end(content,()=>done());});await rename(temporary,join(dir,id));}
  finally{await rm(temporary,{force:true});}
  return {id,size:content.length,...type};
 }
 private async quota(c:PoolConnection,profile:string,adding:number,replacing?:string){
  const [rows]=await countEduDocumentsByDataProfileIdId(c,[profile,...(replacing?[replacing]:[])],replacing);
  if(!replacing&&Number(rows[0].n)>=eduLimits.documents)throw new ApiError(409,'document_limit','Maksimal '+eduLimits.documents+' dokumen per data profil.');
  if(Number(rows[0].bytes)+adding>eduLimits.totalBytes)throw new ApiError(409,'storage_limit_exceeded','Total dokumen per data profil maksimal 100 MB.');
  return Number(rows[0].last);
 }
 async saveDocument(account:string,profile:string,name:unknown,description:unknown,body:Readable){
  const file=filename(name),about=documentDescription(description),stored=await this.receive(account,file,body);
  try{return await this.write(account,profile,async c=>{const last=await this.quota(c,profile,stored.size);await insertEduDocuments(c,[stored.id,account,profile,file,stored.mimetype,stored.media_type,stored.size,about,last+1]);return {id:stored.id,filename:file,mimetype:stored.mimetype,media_type:stored.media_type,size_bytes:stored.size,description:about} as EduDocument;});}
  catch(error){await rm(join(this.dir(account),stored.id),{force:true});throw error;}
 }
 // Ganti file: the new file gets its own id on disk; the row keeps its id so the description and references stay.
 async replaceDocumentFile(account:string,profile:string,id:string,name:unknown,body:Readable){
  const documentId=rowId(id,'Dokumen'),file=filename(name),stored=await this.receive(account,file,body);let previous:string|undefined;
  try{
   const result=await this.write(account,profile,async c=>{const [rows]=await lockEduDocumentsFileIdByIdAccountIdDataProfileId(c,[documentId,account,profile]);if(!rows[0])throw missing('Dokumen tidak ditemukan');previous=String(rows[0].file_id??documentId);await this.quota(c,profile,stored.size,documentId);await updateEduDocumentsFileIdById(c,[stored.id,file,stored.mimetype,stored.media_type,stored.size,documentId]);return {id:documentId,filename:file,mimetype:stored.mimetype,media_type:stored.media_type,size_bytes:stored.size};});
   if(previous)await rm(join(this.dir(account),previous),{force:true});
   return result;
  }catch(error){await rm(join(this.dir(account),stored.id),{force:true});throw error;}
 }
 async describeDocument(account:string,profile:string,id:string,value:unknown){const about=documentDescription((value as Record<string,unknown>|null)?.description);return this.write(account,profile,async c=>{const [result]=await updateEduDocumentsDescriptionByIdAccountIdDataProfileId(c,[about,rowId(id,'Dokumen'),account,profile]);if(!result.affectedRows)throw missing('Dokumen tidak ditemukan');return {id,description:about};});}
 async deleteDocument(account:string,profile:string,id:string){
  const file=await this.write(account,profile,async c=>{const [rows]=await lockEduDocumentsFileIdByIdAccountIdDataProfileId(c,[rowId(id,'Dokumen'),account,profile]);if(!rows[0])throw missing('Dokumen tidak ditemukan');await deleteEduDocumentsById(c,[id]);return String(rows[0].file_id??id);});
  await rm(join(this.dir(account),file),{force:true});return {ok:true};
 }
 // The stored file of a document, for the dashboard preview and for sending over WhatsApp.
 async file(account:string,id:string,profile?:string){
  const [rows]=await selectEduDocumentsByIdAccountIdDataProfileId(db,[rowId(id,'Dokumen'),account,...(profile?[profile]:[])],profile);
  if(!rows[0])throw missing('Dokumen tidak ditemukan');const path=join(this.dir(account),String(rows[0].file_id??rows[0].id));
  try{await stat(path);}catch{throw missing('Dokumen tidak ditemukan');}
  return {path,filename:String(rows[0].filename),mimetype:String(rows[0].mimetype),media_type:rows[0].media_type as 'image'|'document'};
 }
 // Duplicating a data profile copies its programs, contacts and documents, each document as its own file.
 async copy(c:PoolConnection,account:string,from:string,to:string,copied:string[]){
  await copyEduPrograms(c,[to,account,from]);
  await copyEduContacts(c,[to,account,from]);
  const [documents]=await selectEduDocumentRowsForCopy(c,[account,from]);
  for(const d of documents){const id=randomUUID();await copyFile(join(this.dir(account),String(d.file_id??d.id)),join(this.dir(account),id));copied.push(id);await insertEduDocuments(c,[id,account,to,d.filename,d.mimetype,d.media_type,d.size_bytes,d.description,d.position]);}
 }
 async files(c:PoolConnection,account:string,profile:string){const [rows]=await selectEduDocumentFiles(c,[account,profile]);return rows.map(r=>String(r.file));}
 async removeFiles(account:string,files:readonly string[]){for(const file of files)await rm(join(this.dir(account),file),{force:true}).catch(()=>{});}
 private async write<T>(account:string,profile:string,fn:(c:PoolConnection)=>Promise<T>){
  const c=await db.getConnection();
  try{await c.beginTransaction();
   const [owner]=await lockAccountsSuspendedById(c,[account]);if(!owner[0]||owner[0].suspended)throw new ApiError(403,'account_unavailable','Akun tidak tersedia');
   const [rows]=await lockDataProfilesProfileTypeByIdAccountId(c,[profile,account]);if(!rows[0])throw new ApiError(404,'data_profile_not_found','Data profil tidak ditemukan');
   if(rows[0].profile_type!=='pendidikan')throw new ApiError(409,'profile_mismatch','Data ini hanya untuk profil CS Lembaga Pendidikan.');
   await updateDataProfilesRevisionById(c,[profile]);
   const result=await fn(c);await c.commit();return result;
  }catch(error){await c.rollback();throw error;}finally{c.release();}
 }
}
