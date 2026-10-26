import {supabaseAdmin} from './supabase-server';
import {digest,randomToken} from './security';
import {addisDay} from './time';
import {config} from './config';

// Private JSON documents share the existing RLS-protected server-only store.
// No integration secret or event document is returned by the public edition API.
const SETTINGS='integration:google-sheets',PREFIX='reader-event:';
export type ReaderEvent={id:string;branch:string;scanned:number;phone?:string;started?:number;expires?:number;consent?:boolean;synced?:boolean};
async function saveEvent(event:ReaderEvent){
  const {error}=await supabaseAdmin().from('editions').upsert({id:PREFIX+event.id,data:event,updated:Date.now()},{onConflict:'id'});
  if(error)throw new Error('Could not save the scan. Please scan again.');
}
function cookie(req:Request,name:string){return req.headers.get('cookie')?.match(new RegExp('(?:^|;\\s*)'+name+'=([^;]+)'))?.[1]||'';}
export function readerCookie(name:string,token:string,seconds:number){return `${name}=${token}; HttpOnly; ${process.env.NODE_ENV==='production'?'Secure; ':''}SameSite=Lax; Path=/; Max-Age=${seconds}`;}
export async function beginEntry(branch:string){
  const token=randomToken(),id=await digest(token);
  await saveEvent({id,branch,scanned:Date.now(),synced:false});
  return token;
}
export async function pendingEntry(req:Request){
  const token=cookie(req,'tomoca_pending');if(!/^[a-f0-9]{64}$/.test(token))return null;
  const {data,error}=await supabaseAdmin().from('editions').select('data').eq('id',PREFIX+await digest(token)).maybeSingle();
  if(error)throw new Error('Could not check this scan.');
  const event=data?.data as ReaderEvent|undefined;
  return event&&Date.now()-event.scanned<15*60000?{token,event}:null;
}
export function normalizePhone(value:unknown){
  let phone=String(value||'').replace(/[\s()-]/g,'');
  if(/^0[79]\d{8}$/.test(phone))phone='+251'+phone.slice(1);
  if(/^251[79]\d{8}$/.test(phone))phone='+'+phone;
  return /^\+[1-9]\d{7,14}$/.test(phone)?phone:null;
}
export async function startEntry(req:Request,body:any){
  const pending=await pendingEntry(req);if(!pending)throw Object.assign(new Error('Please scan the TOMOCA QR again.'),{status:401});
  const phone=normalizePhone(body.phone);if(!phone)throw Object.assign(new Error('Enter a valid phone number, for example 0912345678 or +251912345678.'),{status:400});
  if(body.noticeAccepted!==true)throw Object.assign(new Error('Please acknowledge how TOMOCA uses your number.'),{status:400});
  const db=supabaseAdmin(),{event}=pending;
  const lock=await db.rpc('claim_system_lock',{p_name:'entry:'+event.id,p_ttl_ms:15000});
  if(lock.error||!lock.data)throw Object.assign(new Error('Your session is starting. Please try again in a moment.'),{status:409});
  try{
    // Deriving a token from the private pending cookie makes retries idempotent.
    const token=await digest('tomoca-reader:'+pending.token),id=await digest(token);
    const existing=await db.from('sessions').select('created,expires').eq('id',id).maybeSingle();
    if(existing.error)throw new Error('Could not check the reading session.');
    if(existing.data){
      if(Number(existing.data.expires)<=Date.now())throw Object.assign(new Error('Your 30 minutes ended. Please scan again.'),{status:401});
    }
    const registration=await db.from('registrations').upsert({phone,branch:event.branch,consent:body.consent===true,created:Date.now(),notice:'Phone required for reading access and visit measurement; marketing '+(body.consent===true?'opted in':'not opted in')+' · v2'},{onConflict:'phone'});
    if(registration.error)throw new Error('Could not save your number. Please try again.');
    const started=existing.data?Number(existing.data.created):Date.now(),expires=existing.data?Number(existing.data.expires):started+1800000;
    if(!existing.data){
      const result=await db.rpc('create_reader_session',{p_id:id,p_branch:event.branch,p_created:started,p_expires:expires,p_day:addisDay(started)});
      if(result.error)throw new Error('Could not start reading. Please try again.');
    }
    await saveEvent({...event,phone,consent:body.consent===true,started,expires,synced:false});
    return {token,expires};
  }finally{await db.rpc('release_system_lock',{p_name:'entry:'+event.id});}
}
export async function sheetsSettings(){
  const {data,error}=await supabaseAdmin().from('editions').select('data').eq('id',SETTINGS).maybeSingle();
  if(error)throw new Error('Could not load Google Sheets settings.');
  return data?.data as {url:string;secret:string}|undefined;
}
export async function configureSheets(url:string,secret:string){
  if(!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url)||!/^[-A-Za-z0-9_]{32,200}$/.test(secret))throw Object.assign(new Error('Enter the deployed Apps Script URL and a secret of at least 32 characters.'),{status:400});
  const {error}=await supabaseAdmin().from('editions').upsert({id:SETTINGS,data:{url,secret},updated:Date.now()},{onConflict:'id'});
  if(error)throw new Error('Could not save Google Sheets settings.');
}
export async function syncSheets(){
  const cutoff=Date.now()-config.registrationRetentionDays()*86400000;
  const expired=await supabaseAdmin().from('editions').delete().like('id',PREFIX+'%').lt('updated',cutoff);
  if(expired.error)throw new Error('Could not apply scan log retention.');
  const settings=await sheetsSettings();if(!settings)return {configured:false,sent:0};
  const db=supabaseAdmin();
  const lock=await db.rpc('claim_system_lock',{p_name:'google-sheets-sync',p_ttl_ms:25000});
  if(lock.error||!lock.data)return {configured:true,sent:0,busy:true};
  try{
    const {data,error}=await db.from('editions').select('id,data,updated').like('id',PREFIX+'%').eq('data->>synced','false').order('updated').limit(25);
    if(error)throw new Error('Could not read queued scans.');
    if(!data?.length)return {configured:true,sent:0};
    const response=await fetch(settings.url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({secret:settings.secret,events:data.map(row=>row.data)}),signal:AbortSignal.timeout(15000)});
    const result=await response.json();if(!response.ok||result.ok!==true)throw new Error('Google Sheets did not acknowledge the scan log.');
    // Compare updated timestamps so a concurrent phone submission stays queued.
    for(const row of data){const saved=await db.from('editions').update({data:{...row.data,synced:true}}).eq('id',row.id).eq('updated',row.updated);if(saved.error)throw new Error('Could not acknowledge synced scans.');}
    return {configured:true,sent:data.length};
  }finally{await db.rpc('release_system_lock',{p_name:'google-sheets-sync'});}
}
