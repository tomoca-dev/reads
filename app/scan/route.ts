import {validDailyCode} from '../../lib/server';
import {beginEntry,readerCookie,syncSheets} from '../../lib/reader-entry';
import {after} from 'next/server';
export const dynamic='force-dynamic';
export async function GET(req:Request){
  try{
    const url=new URL(req.url);const code=url.searchParams.get('code')||'';const row=await validDailyCode(code);
    if(!row)return Response.redirect(url.origin+'/?scan=expired',303);
    const token=await beginEntry(row.branch);
    after(async()=>{try{await syncSheets();}catch{console.error('Google Sheets sync pending; scan saved for retry.');}});
    const headers=new Headers({Location:url.origin+'/', 'Cache-Control':'no-store'});
    headers.append('Set-Cookie',readerCookie('tomoca_pending',token,900));
    headers.append('Set-Cookie',readerCookie('tomoca_session','',0));
    return new Response(null,{status:303,headers});
  }catch(error){console.error(error);return new Response('Unable to start your session. Please try again.',{status:503});}
}
