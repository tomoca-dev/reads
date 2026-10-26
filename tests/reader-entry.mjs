import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const tables={editions:new Map(),sessions:new Map(),registrations:new Map()};let sessionsCreated=0;
class Query{
 constructor(table){this.table=table;this.filters=[];this.op='select';}
 select(){return this;}eq(k,v){this.filters.push(row=>String(k==='data->>synced'?row.data.synced:row[k])===String(v));return this;}
 like(k,v){this.filters.push(row=>row[k].startsWith(v.slice(0,-1)));return this;}
 lt(k,v){this.filters.push(row=>row[k]<v);return this;}
 order(){return this;}limit(){return this;}maybeSingle(){this.single=true;return this;}
 upsert(row){this.op='upsert';this.row=row;return this;}
 update(row){this.op='update';this.row=row;return this;}delete(){this.op='delete';return this;}
 then(resolve,reject){try{let rows=[...tables[this.table].values()].filter(r=>this.filters.every(f=>f(r)));if(this.op==='upsert'){tables[this.table].set(this.row.id||this.row.phone,structuredClone(this.row));rows=[this.row];}for(const row of rows){if(this.op==='update')Object.assign(row,this.row);if(this.op==='delete')tables[this.table].delete(row.id||row.phone);}resolve({data:this.single?(rows[0]||null):rows,error:null});}catch(e){reject(e);}}
}
const db={from:table=>new Query(table),rpc:async(name,args)=>{
 if(name==='create_reader_session'){assert(!tables.sessions.has(args.p_id));tables.sessions.set(args.p_id,{id:args.p_id,created:args.p_created,expires:args.p_expires});sessionsCreated++;}
 return {data:true,error:null};
}};
const {webcrypto}=await import('node:crypto');const hash=async value=>Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(value))).toString('hex');
const exports={};let tokenIndex=0;
const require=name=>({
 './supabase-server':{supabaseAdmin:()=>db},'./security':{digest:hash,randomToken:()=>String(++tokenIndex).padStart(64,'0')},'./time':{addisDay:()=> '2026-10-26'},'./config':{config:{registrationRetentionDays:()=>365}}
}[name]);
const source=ts.transpileModule(fs.readFileSync(new URL('../lib/reader-entry.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
new Function('require','exports',source)(require,exports);
assert.equal(exports.normalizePhone('0912 345 678'),'+251912345678');
assert.equal(exports.normalizePhone('251912345678'),'+251912345678');assert.equal(exports.normalizePhone('bad'),null);
const token=await exports.beginEntry('historical');const req=new Request('https://example.test',{headers:{cookie:'tomoca_pending='+token}});
assert.equal(sessionsCreated,0,'A scan alone cannot unlock reading');
await assert.rejects(()=>exports.startEntry(req,{noticeAccepted:true}),/phone number/);
await assert.rejects(()=>exports.startEntry(req,{phone:'0912345678'}),/acknowledge/);
const first=await exports.startEntry(req,{phone:'0912345678',noticeAccepted:true,consent:false});
assert.equal(sessionsCreated,1);assert.equal(first.expires-tables.sessions.values().next().value.created,1800000);
assert.equal(tables.registrations.get('+251912345678').consent,false);
const retry=await exports.startEntry(req,{phone:'0912345678',noticeAccepted:true,consent:false});
assert.deepEqual(retry,first);assert.equal(sessionsCreated,1,'Retries do not create or count another session');
await exports.configureSheets('https://script.google.com/macros/s/TEST/exec','a'.repeat(64));
const realFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('network down');};
await assert.rejects(()=>exports.syncSheets(),/network down/);const event=[...tables.editions.values()].find(row=>row.id.startsWith('reader-event:'));assert.equal(event.data.synced,false);
globalThis.fetch=async()=>Response.json({ok:true});assert.equal((await exports.syncSheets()).sent,1);assert.equal(event.data.synced,true);
globalThis.fetch=realFetch;console.log('PASS: required phone, notice, exact 30 minutes, retry idempotence, independent marketing choice, durable delivery retry.');
