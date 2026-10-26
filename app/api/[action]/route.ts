import {after} from 'next/server';
import {branches,cleanup,dailyQr,edition,editionIsStale,getSession,isAdmin,rawEdition,refreshEdition,sameOrigin} from '../../../lib/server';
import {supabaseAdmin} from '../../../lib/supabase-server';
import {billingState} from '../../../lib/billing';
import {config} from '../../../lib/config';
import QRCode from 'qrcode';
export const dynamic='force-dynamic';
export const maxDuration=30;
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});

export async function GET(req:Request,{params}:{params:Promise<{action:string}>}){
  try{
    const {action}=await params;const url=new URL(req.url);
    if(action==='session')return json({session:await getSession(req),admin:await isAdmin()});
    if(action==='edition'){
      if(!await getSession(req)&&!await isAdmin())return json({error:'Scan the QR at TOMOCA to start reading.'},401);
      const ed=await edition();
      if(editionIsStale(ed))after(async()=>{try{await refreshEdition();}catch(error){console.error('Background edition refresh failed',error);}});
      return json(ed);
    }
    if(!await isAdmin())return json({error:'Management access required.'},403);

    if(action==='manage'){
      const db=supabaseAdmin();
      const [metrics,registrations,recent,currentEdition,billing]=await Promise.all([
        db.from('daily_branch_metrics').select('branch,sessions'),
        db.from('registrations').select('*',{count:'exact',head:true}),
        db.from('registrations').select('phone,branch,created,notice').order('created',{ascending:false}).limit(50),
        rawEdition(),
        billingState()
      ]);
      if(metrics.error||registrations.error||recent.error)throw new Error(metrics.error?.message||registrations.error?.message||recent.error?.message);
      const totals=new Map<string,number>();for(const row of metrics.data||[])totals.set(row.branch,(totals.get(row.branch)||0)+Number(row.sessions||0));
      return json({
        stats:[...totals].map(([branch,sessions])=>({branch,sessions})),
        registrations:{total:registrations.count||0,opted_in:registrations.count||0},
        recentRegistrations:recent.data||[],health:currentEdition.health||[],updated:currentEdition.updated,
        billing:{amount:25,currency:'USD',status:billing.status,active:billing.active,configured:billing.configured,currentPeriodEnd:billing.currentPeriodEnd,customer:!!billing.customerId,subscription:!!billing.subscriptionId},
        branches,
        operations:{database:'Supabase PostgreSQL',automaticBackups:'Supabase plan dependent',registrationRetentionDays:config.registrationRetentionDays(),overrideRetentionDays:config.overrideRetentionDays(),maintenance:'Daily Vercel cron + on-demand admin maintenance'}
      });
    }

    if(action==='qr'){
      const branch=url.searchParams.get('branch')||'';
      const code=await dailyQr(branch);
      const link=url.origin+'/scan?code='+code.id;
      return json({image:await QRCode.toDataURL(link,{width:380,margin:2,color:{dark:'#171714',light:'#ffffff'}}),expires:code.expires,branch,link,day:code.day,daily:false,permanent:true});
    }
    return json({error:'Not found'},404);
  }catch(error:any){console.error(error);return json({error:error?.message||'The reading desk is temporarily unavailable. Please try again.'},Number(error?.status)||503);}
}

export async function POST(req:Request,{params}:{params:Promise<{action:string}>}){
  try{
    const {action}=await params;
    if(action==='refresh'){
      if(!sameOrigin(req)||!await isAdmin())return json({error:'Management access required.'},403);
      return json(await edition(true));
    }
    if(!sameOrigin(req))return json({error:'Invalid request origin.'},403);
    const body:any=await req.json();

    if(action==='register'){
      const session=await getSession(req);if(!session)return json({error:'Start a reading session first.'},401);
      let phone=String(body.phone||'').replace(/[\s()-]/g,'');if(/^0[79]\d{8}$/.test(phone))phone='+251'+phone.slice(1);
      if(!/^\+[1-9]\d{7,14}$/.test(phone))return json({error:'Use an international phone number, for example +251…'},400);
      if(body.consent!==true)return json({error:'Please select the permission checkbox to join.'},400);
      const {error}=await supabaseAdmin().from('registrations').upsert({phone,branch:session.branch,consent:true,created:Date.now(),notice:'TOMOCA news, events and offers · optional · v1'},{onConflict:'phone'});
      if(error)throw new Error(error.message);
      return json({ok:true});
    }

    if(!await isAdmin())return json({error:'Management access required.'},403);
    if(action==='registrations'){
      if(body.action!=='delete'||typeof body.phone!=='string')return json({error:'Invalid registration action.'},400);
      const {error}=await supabaseAdmin().from('registrations').delete().eq('phone',body.phone);
      if(error)throw new Error(error.message);
      return json({ok:true});
    }
    if(action==='maintenance'){return json({ok:true,result:await cleanup()});}
    return json({error:'Not found'},404);
  }catch(error:any){console.error(error);return json({error:error?.message||'Could not save. Please try again.'},Number(error?.status)||503);}
}
