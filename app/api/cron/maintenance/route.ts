import {cleanup,refreshEdition} from '../../../../lib/server';
import {config,requireStrongHex} from '../../../../lib/config';
import {syncSheets} from '../../../../lib/reader-entry';
export const dynamic='force-dynamic';
export const maxDuration=30;
export async function GET(req:Request){
  try{
    const expected=requireStrongHex('CRON_SECRET',config.cronSecret());
    if(req.headers.get('authorization')!==`Bearer ${expected}`)return Response.json({error:'Unauthorized'},{status:401});
    const [edition,maintenance]=await Promise.all([refreshEdition(),cleanup()]);
    let sheets;try{sheets=await syncSheets();}catch{sheets={error:'Sync pending; saved events will retry.'};}
    return Response.json({ok:true,updated:edition.updated,maintenance,sheets});
  }catch(error:any){console.error(error);return Response.json({error:error?.message||'Maintenance failed'},{status:503});}
}
