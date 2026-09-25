// Where the app keeps files at runtime. Never in git, and part of every backup.
//   storage/whatsapp/<account>/<session>/  WhatsApp login (Baileys) and session metadata
//   storage/files/<kind>/<account>/        files belonging to clients
import {cp,mkdir,readdir,rename,rm,rmdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';

export const storageRoot=resolve('storage');

export function storagePaths(root=storageRoot){
 return {
  whatsapp:join(root,'whatsapp'),
  media:join(root,'files','media'),
  productImages:join(root,'files','product-images'),
  aiDocuments:join(root,'files','ai-documents'),
  shareAssets:join(root,'files','share-assets'),
 };
}

// Folders of the old single auth/ directory and where they belong now; any other entry is an account's sessions.
const legacyFolders:Record<string,Exclude<keyof ReturnType<typeof storagePaths>,'whatsapp'>>={
 _media:'media','_product-images':'productImages','_ai-documents':'aiDocuments','_share-assets':'shareAssets',
};

// Moves the old auth/ directory into storage/ once, entry by entry, so a run that stops halfway resumes on the
// next start. A target holding only empty folders (left by a start that ran before the move) is replaced; one that
// holds files is never merged: startup stops instead, so no session or client file is silently hidden. Returns how
// many entries moved.
export async function moveLegacyStorage(root=storageRoot,legacy=resolve('auth')){
 let entries:string[];
 try{entries=await readdir(legacy);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return 0;throw error;}
 const paths=storagePaths(root);
 await mkdir(root,{recursive:true,mode:0o700});
 await mkdir(paths.whatsapp,{recursive:true,mode:0o700});
 await mkdir(join(root,'files'),{recursive:true,mode:0o700});
 let moved=0;
 for(const name of entries){
  const target=legacyFolders[name]?paths[legacyFolders[name]]:join(paths.whatsapp,name);
  if(await hasFiles(target))throw Error(`Penyimpanan lama auth/${name} tidak dipindah karena ${target} sudah berisi file. Periksa dan gabungkan manual.`);
  await rm(target,{recursive:true,force:true});
  await move(join(legacy,name),target);moved++;
 }
 // A service allowed to write only inside auth/ and storage/ cannot remove auth/ itself; an empty folder is harmless.
 await rmdir(legacy).catch(()=>{});
 return moved;
}

// rename is atomic but only works within one filesystem; systemd's ReadWritePaths mounts auth/ and storage/
// separately, so there the entry is copied beside its target and swapped in with a rename.
async function move(from:string,to:string){
 try{await rename(from,to);return;}catch(error){if((error as NodeJS.ErrnoException).code!=='EXDEV')throw error;}
 const staging=to+'.moving';
 await rm(staging,{recursive:true,force:true});
 await cp(from,staging,{recursive:true,preserveTimestamps:true,errorOnExist:true,force:false});
 await rename(staging,to);
 await rm(from,{recursive:true,force:true});
}

async function hasFiles(path:string):Promise<boolean>{
 const entries=await readdir(path,{withFileTypes:true}).catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return null;if(error.code==='ENOTDIR')return true;throw error;});
 if(entries===null)return false;if(entries===true)return true;
 for(const entry of entries)if(!entry.isDirectory()||await hasFiles(join(path,entry.name)))return true;
 return false;
}
