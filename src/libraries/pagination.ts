import type {RowDataPacket} from 'mysql2';
import {db} from './db.js';
import {ApiError} from './errors.js';
// Page N of a table, 20 rows per page; the page is clamped to the last one.
export async function paginate(value:unknown,countSql:string,itemsSql:(size:number,offset:number)=>string){
 if(typeof value!=='string'||!/^\d{1,9}$/.test(value)||Number(value)<1)throw new ApiError(400,'invalid_request','Halaman tidak valid');
 const size=20;
 const [counts]=await db.query<RowDataPacket[]>(countSql);
 const total=Number(counts[0].total),pages=Math.max(1,Math.ceil(total/size)),page=Math.min(Number(value),pages);
 const [items]=await db.query(itemsSql(size,(page-1)*size));
 return {items,page,pages,total,page_size:size};
}
