import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const f=new URL('./netlify/functions/api.mjs',import.meta.url);
const source=(await readFile(f,'utf8'))
.replace("import { getStore } from '@netlify/blobs';","const getStore = () => ({get: async key => key==='route-2' ? {stops:[{id:'test'}]} : null});")
.replace("import { makeRunHandler } from '../lib/runs.mjs';","const makeRunHandler=()=>()=>Response.json({});");
const {default:handler}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const req=(p,init)=>handler(new Request('https://example.test/api/'+p,init));
for(const p of ['simple-pass',' Synthetic-Test! ', 'Test-'+String.fromCharCode(1046,1047)]){
 process.env.ADMIN_PASS=p;
 assert.deepEqual(await (await req('auth',{method:'POST',body:JSON.stringify({pass:p})})).json(),{ok:true});
 const resp=await req('route?m=2',{headers:{'x-pass-encoded':encodeURIComponent(p)}});
 assert.equal(resp.status,200);
 assert.deepEqual((await resp.json()).stops,[{id:'test'}]);
 assert.equal((await req('route?m=2',{headers:{'x-pass-encoded':'%ZZ'}})).status,403);
 assert.equal((await req('route?m=2',{headers:{'x-pass-encoded':encodeURIComponent(p+'x')}})).status,403);
}
process.env.ADMIN_PASS='simple-pass';
assert.equal((await req('route?m=2',{headers:{'x-pass':'simple-pass'}})).status,200);
assert.equal((await req('route?m=2')).status,403);
delete process.env.ADMIN_PASS;
assert.equal((await req('auth',{method:'POST',body:'{}'})).status,503);
assert.equal((await req('route?m=2',{headers:{'x-pass-encoded':'simple-pass'}})).status,403);
console.log('Auth transport: PASS (plain, spaces, Unicode, malformed, wrong, old clients, blank config)');

