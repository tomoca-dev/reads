import {collect,withCoffeeFallback} from './news.mjs';
import seed from './seed.json';
import {supabaseAdmin} from './supabase-server';
import {localAdmin} from './admin-auth';
import {digest,randomToken,sameOrigin} from './security';
import {addisDay} from './time';
import {billingState,requireActiveSubscription} from './billing';
import {config} from './config';

export const branches=[
  {id:'historical',name:'Historical'},
  {id:'sip',name:'Sip'},
  {id:'abrehot',name:'Abrehot'}
];

export async function isAdmin(){return localAdmin();}
export {sameOrigin};

export async function getSession(req:Request){
  const token=req.headers.get('cookie')?.match(/(?:^|;\s*)tomoca_session=([^;]+)/)?.[1];
  if(!token||!/^[a-f0-9]{64}$/.test(token))return null;
  const db=supabaseAdmin();
  const {data,error}=await db.from('sessions').select('branch,expires,created').eq('id',await digest(token)).gt('expires',Date.now()).maybeSingle();
  if(error)throw new Error('Reader session lookup failed: '+error.message);
  return data?{branch:data.branch,expires:Number(data.expires),created:Number(data.created)}:null;
}

export async function createReaderSession(branch:string){
  const db=supabaseAdmin();
  const token=randomToken(),now=Date.now(),expires=now+30*60*1000;
  const id=await digest(token);
  const result=await db.rpc('create_reader_session',{p_id:id,p_branch:branch,p_created:now,p_expires:expires,p_day:addisDay(now)});
  if(result.error)throw new Error('Could not create reader session: '+result.error.message);
  return {token,expires};
}

export async function dailyQr(branch:string){
  await requireActiveSubscription();
  if(!branches.some(b=>b.id===branch))throw Object.assign(new Error('Choose a branch.'),{status:400});
  // The permanent marker reuses the branch's code across calendar days.
  const db=supabaseAdmin(),day='permanent',now=Date.now(),expires=253402300799999,id=randomToken();
  const created=await db.rpc('get_or_create_daily_code',{p_branch:branch,p_day:day,p_id:id,p_created:now,p_expires:expires});
  if(created.error)throw new Error('Daily QR creation failed: '+created.error.message);
  const row=Array.isArray(created.data)?created.data[0]:created.data;
  if(!row)throw new Error('Daily QR creation returned no token.');
  return {id:row.id,expires:Number(row.expires),day};
}

export async function validDailyCode(code:string){
  if(!/^[a-f0-9]{64}$/.test(code))return null;
  const db=supabaseAdmin(),now=Date.now();
  const {data,error}=await db.from('codes').select('branch,day,expires').eq('id',code).gt('expires',now).maybeSingle();
  if(error)throw new Error('QR validation failed: '+error.message);
  if(!data||(data.day!=='permanent'&&data.day!==addisDay(now)))return null;
  const billing=await billingState();
  return billing.active?data:null;
}

async function savedEdition(){
  const {data,error}=await supabaseAdmin().from('editions').select('data,updated').eq('id','latest').maybeSingle();
  if(error)throw new Error('Edition lookup failed: '+error.message);
  if(!data)return null;
  const parsed=typeof data.data==='string'?JSON.parse(data.data):data.data;
  return {...parsed,updated:Number(data.updated)};
}

export function editionIsStale(ed:any){
  return !ed||Date.now()-Number(ed.updated||0)>60*60*1000||!ed.health?.some((s:any)=>s.name==='Daily Coffee News');
}

export async function refreshEdition(){
  const db=supabaseAdmin();
  const claim=await db.rpc('claim_system_lock',{p_name:'edition-refresh',p_ttl_ms:120000});
  if(claim.error)throw new Error('Refresh lock failed: '+claim.error.message);
  if(!claim.data)return withCoffeeFallback((await savedEdition())||seed);
  try{
    const current=await savedEdition();
    try{
      const next=await collect();
      if(next.stories.length>=3){
        const {error}=await db.from('editions').upsert({id:'latest',data:next,updated:next.updated},{onConflict:'id'});
        if(error)throw new Error('Edition save failed: '+error.message);
        return next;
      }
    }catch(error){console.error('Edition refresh failed',error);}
    return withCoffeeFallback(current||seed);
  }finally{
    try{await db.rpc('release_system_lock',{p_name:'edition-refresh'});}catch{}
  }
}

export async function rawEdition(refresh=false){
  if(refresh)return refreshEdition();
  const saved=await savedEdition();
  if(saved)return withCoffeeFallback(saved);
  return refreshEdition();
}

export async function edition(refresh=false){
  const ed=await rawEdition(refresh);
  const {data,error}=await supabaseAdmin().from('story_overrides').select('url,title,summary,hidden');
  if(error)throw new Error('Story override lookup failed: '+error.message);
  const overrides=new Map((data||[]).map((o:any)=>[o.url,o]));
  return {...ed,stories:ed.stories.filter((s:any)=>!overrides.get(s.url)?.hidden).map((s:any)=>{const o:any=overrides.get(s.url);return o?{...s,title:o.title||s.title,summary:o.summary}:s;})};
}

export async function cleanup(){
  const {data,error}=await supabaseAdmin().rpc('tomoca_cleanup',{
    p_now:Date.now(),
    p_registration_cutoff:Date.now()-config.registrationRetentionDays()*86400000,
    p_override_cutoff:Date.now()-config.overrideRetentionDays()*86400000
  });
  if(error)throw new Error('Maintenance cleanup failed: '+error.message);
  return data;
}
