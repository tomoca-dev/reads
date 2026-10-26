import Stripe from 'stripe';
import {config,requireEnv} from './config';
import {supabaseAdmin} from './supabase-server';
let stripeClient:Stripe|undefined;
export function stripe(){if(!stripeClient)stripeClient=new Stripe(requireEnv('STRIPE_SECRET_KEY',config.stripeSecretKey()));return stripeClient;}
export type BillingState={status:string;active:boolean;customerId:string|null;subscriptionId:string|null;currentPeriodEnd:number|null;configured:boolean};
export function billingConfigured(){return !!(config.stripeSecretKey()&&config.stripeWebhookSecret()&&config.stripePriceId());}

export async function verifiedMonthlyPrice(){
  const id=requireEnv('STRIPE_PRICE_ID',config.stripePriceId());
  const price=await stripe().prices.retrieve(id);
  const recurring=price.recurring;
  if(!price.active||price.currency!=='usd'||price.unit_amount!==2500||!recurring||recurring.interval!=='month'||recurring.interval_count!==1){
    throw new Error('STRIPE_PRICE_ID must point to an active recurring $25 USD monthly price.');
  }
  return price;
}
export function isPaidStatus(status:string|null|undefined){return status==='active'||status==='trialing';}
export async function billingState():Promise<BillingState>{
  const {data,error}=await supabaseAdmin().from('organizations').select('stripe_customer_id,stripe_subscription_id,subscription_status,current_period_end').eq('id','tomoca').maybeSingle();
  if(error)throw new Error('Billing state lookup failed: '+error.message);
  const status=data?.subscription_status||'inactive';
  return {status,active:isPaidStatus(status),customerId:data?.stripe_customer_id||null,subscriptionId:data?.stripe_subscription_id||null,currentPeriodEnd:data?.current_period_end||null,configured:billingConfigured()};
}
export async function requireActiveSubscription(){const state=await billingState();if(!state.active)throw Object.assign(new Error('TOMOCA Reads subscription is not active.'),{status:402});return state;}
export async function ensureOrganization(){
  const db=supabaseAdmin();
  const {error}=await db.from('organizations').upsert({id:'tomoca',name:'TOMOCA',updated:Date.now()},{onConflict:'id',ignoreDuplicates:true});
  if(error)throw new Error('Organization initialization failed: '+error.message);
}
export async function syncSubscription(subscription:Stripe.Subscription){
  if(subscription.metadata?.organization_id!=='tomoca')return false;
  const customer=typeof subscription.customer==='string'?subscription.customer:subscription.customer.id;
  const item=subscription.items.data[0];
  const periodEnd=item?.current_period_end?item.current_period_end*1000:null;
  const {error}=await supabaseAdmin().from('organizations').upsert({
    id:'tomoca',name:'TOMOCA',stripe_customer_id:customer,stripe_subscription_id:subscription.id,
    subscription_status:subscription.status,current_period_end:periodEnd,updated:Date.now()
  },{onConflict:'id'});
  if(error)throw new Error('Subscription sync failed: '+error.message);
  return true;
}
