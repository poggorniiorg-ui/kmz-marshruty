import { makeRunHandler } from './netlify/lib/runs.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const stores = new Map();
const getStore = name => {
  if (!stores.has(name)) stores.set(name,new Map());
  const m=stores.get(name);
  return {
    get:async k=>structuredClone(m.get(k)),
    setJSON:async(k,v)=>m.set(k,structuredClone(v)),
    getMetadata:async k=>{
      if (k==='p-photo-offline') throw new Error('storage offline');
      return m.has(k)?{etag:'etag',metadata:{}}:null;
    },
    async *list({prefix,paginate}) {
      assert.equal(paginate,true);
      const keys=[...m.keys()].filter(x=>x.startsWith(prefix)).sort();
      // Page size 3 makes the tests exercise cross-page ordering and old rows.
      for (let i=0;i<keys.length;i+=3) yield {blobs:keys.slice(i,i+3).map(key=>({etag:'etag',key})),directories:[]};
    }
  };
};
let now=Date.parse('2026-11-22T12:00:00Z');
const routes=getStore('kmz-routes');
const handler=makeRunHandler(getStore,{now:()=>now});
const req=(p,{admin=false,method='GET',body,token}={})=>{
  const url=new URL('https://example.test/api/'+p);
  return handler({req:new Request(url,{method,body:body?JSON.stringify(body):undefined,headers:token?{'x-run-token':token}:{}}),
    url,path:url.pathname.slice(5),authed:()=>admin,routes,json:(v,s=200)=>Response.json(v,{status:s})});
};
test('рейс ограничен выбранными точками и сохраняет порядок; отслеживание, фото, отзыв',async()=>{
  await routes.setJSON('route-2',{stops:[
    {id:'a',name:'Первая',phone:'не должно передаваться',url:'https://yandex.ru/maps/-/mapA'},
    {id:'b',name:'Вторая',url:'javascript:alert(0)',photo:'photo-b'},
    {id:'c',name:'Не выбрана'}]});
  await getStore('kmz-photos').setJSON('p-photo-b','YWJj');
  const body={route:'2',date:'2026-11-23',ids:['b','a']};
  assert.equal((await req('dispatch',{method:'POST',body})).status,401);
  assert.equal((await req('dispatch',{admin:true,method:'POST',body:{...body,ids:['a','a']}})).status,400);
  assert.equal((await req('dispatch',{admin:true,method:'POST',body:{...body,ids:['a','d']}})).status,409);
  assert.equal((await req('dispatch',{admin:true,method:'POST',body:{...body,date:'2026-11-31'}})).status,400);
  const response=await req('dispatch',{admin:true,method:'POST',body});
  assert.equal(response.status,201);
  const {token,id}=await response.json();
  assert.equal(token.length,32);
  assert.equal((await req('dispatch?id='+id)).status,401);
  assert.equal((await req('dispatch')).status,404);
  assert.equal((await req('dispatch',{token:'z'.repeat(32)})).status,404);
  await routes.setJSON('route-2',{stops:[]});
  const run=await (await req('dispatch',{token})).json();
  assert.deepEqual(run.stops.map(s=>s.id),['b','a']);
  assert.equal(run.stops[0].url,'');
  assert.equal(run.stops[1].phone,undefined);
  assert.equal(run.stops[0].photo,undefined);
  assert.equal((await req('dispatch-photo?stop=a',{token})).status,404);
  assert.equal(await (await req('dispatch-photo?stop=b',{token})).text(),'abc');
  assert.equal((await req('dispatch-status',{token,method:'POST',body:{id:'c',state:'done'}})).status,400);
  assert.equal((await req('dispatch-status',{token,method:'POST',body:{id:'a',state:'done'}})).status,200);
  assert.equal((await (await req('dispatch?id='+id,{admin:true})).json()).rows[1].status.state,'done');
  assert.equal((await req('dispatch?id='+id,{admin:true,method:'DELETE'})).status,200);
  assert.equal((await req('dispatch',{token})).status,404);
});
test('маршрут 3: срок ссылки действует на рейс, фото и статусы',async()=>{
  await routes.setJSON('route-3',{stops:[{id:'x',name:'Точка'}]});
  const {token,expires}=await (await req('dispatch',{admin:true,method:'POST',body:{route:'3',date:'2026-11-23',ids:['x']}})).json();
  assert.equal((await req('dispatch',{token})).status,200);
  now=expires;
  assert.equal((await req('dispatch',{token})).status,404);
  assert.equal((await req('dispatch-photo?stop=x',{token})).status,404);
  assert.equal((await req('dispatch-status',{token,method:'POST',body:{id:'x',state:'done'}})).status,404);
});

test('проверка рейса не пишет в хранилище, проверяет наличие фото и сохраняет порядок',async()=>{
  now=Date.parse('2026-11-22T12:00:00Z');
  await routes.setJSON('route-2',{stops:[
    {id:'first',photo:'photo-b',url:'https://yandex.ru/maps/-/marker',addr:'Адрес',lat:45,lon:39},
    {id:'missing',photo:'photo-missing',url:'javascript:alert(0)',lat:null,lon:39},
    {id:'error',photo:'photo-offline',url2:'https://2gis.ru/krasnodar',addr:'  ',lat:45,lon:181},
    {id:'empty',lat:44,lon:38}]});
  await getStore('kmz-photos').setJSON('p-photo-b','YWJj');
  const body={route:'2',ids:['missing','first','error','empty']};
  const post={admin:true,method:'POST'};
  assert.equal((await req('dispatch-check',{method:'POST',body})).status,401);
  assert.equal((await req('dispatch-check',{...post,body:{...body,route:'1'}})).status,400);
  assert.equal((await req('dispatch-check',{...post,body:{...body,ids:['first','first']}})).status,400);
  assert.equal((await req('dispatch-check',{...post,body:{...body,ids:['gone']}})).status,409);
  assert.equal((await req('dispatch-check',{...post,body:{...body,junk:'x'.repeat(13000)}})).status,400);
  const original=structuredClone(stores);
  const data=await (await req('dispatch-check',{...post,body})).json();
  assert.deepEqual(data.rows,[
    {id:'missing',photo:'missing',map:false,address:false,marker:false},
    {id:'first',photo:'ok',map:true,address:true,marker:true},
    {id:'error',photo:'unknown',map:false,address:false,marker:false},
    {id:'empty',photo:'missing',map:true,address:false,marker:true}
  ]);
  assert.deepEqual(stores,original);
});

test('история доступна администратору с другого устройства; старые ссылки, статусы, порядок и отзыв',async()=>{
  now=Date.parse('2026-11-22T12:00:00Z');
  const legacyToken='b'.repeat(32);
  const legacyId=createHash('sha256').update(legacyToken).digest('hex');
  const db=getStore('kmz-dispatches');
  await db.setJSON('run-'+legacyId,{route:'2',date:'2026-11-22',expires:now+86400000,stops:[{id:'old',name:'Старая',addr:'Другой адрес'}]});
  assert.equal((await req('dispatch',{token:legacyToken})).status,200);
  assert.equal((await req('dispatch-status',{token:legacyToken,method:'POST',body:{id:'old',state:'failed',reason:'закрыто'}})).status,200);
  const ids=['first','missing'];
  const {id,token}=await (await req('dispatch',{admin:true,method:'POST',body:{route:'2',date:'2026-11-24',ids}})).json();
  const live=await (await req('dispatch',{token})).json();
  assert.deepEqual(live.stops.map(s=>[s.lat,s.lon]),[[45,39],[null,null]]);
  assert.equal((await req('dispatch-status',{token,method:'POST',body:{id:'first',state:'done'}})).status,200);
  assert.equal((await req('dispatch-status',{token,method:'POST',body:{id:'missing',state:'pending'}})).status,200);
  assert.equal((await req('dispatch?route=2')).status,401);
  assert.equal((await req('dispatch?route=2',{token})).status,401);
  assert.equal((await req('dispatch?route=6',{admin:true})).status,400);
  const result=await req('dispatch?route=2',{admin:true});
  const list=await result.json();
  assert.equal(result.status,200);
  assert.equal(list.truncated,false);
  assert.equal(list.runs[0].id,id);
  assert.ok(list.runs.every(r=>r.route==='2'&&!('token' in r)&&!('stops' in r)));
  assert.deepEqual(list.runs.map(r=>[r.done,r.failed,r.pending]),[[1,0,1],[1,0,1],[0,1,0]]);
  assert.deepEqual((await (await req('dispatch?id='+legacyId,{admin:true})).json()).rows.map(r=>[r.id,r.name,r.addr,r.status.reason]),[['old','Старая','Другой адрес','закрыто']]);
  assert.equal((await req('dispatch?id='+legacyId,{admin:true,method:'DELETE'})).status,200);
  assert.equal((await req('dispatch',{token:legacyToken})).status,404);
  assert.equal((await (await req('dispatch?route=2',{admin:true})).json()).runs.find(r=>r.id===legacyId).revoked,true);
});

test('история ограничена свежими записями и не теряет независимые рейсы',async()=>{
  now=Date.parse('2026-11-22T12:00:00Z');
  const admin=true, method='POST';
  const body={route:'3',date:'2026-11-25',ids:['x']};
  const created=[];
  for (let i=0;i<13;i++) {
    now+=1;
    const response=await req('dispatch',{admin,method,body});
    assert.equal(response.status,201);
    created.push((await response.json()).id);
  }
  const result=await (await req('dispatch?route=3',{admin})).json();
  assert.equal(result.truncated,true);
  assert.deepEqual(result.runs.map(r=>r.id),created.slice(-12).reverse());
  assert.ok(result.runs.every(r=>r.pending===1&&r.done===0&&r.failed===0));
});

test('точная ссылка находит свой рейс; ярлык закрыт от водителя, отметки независимы',async()=>{
  now=Date.parse('2026-11-23T07:00:00Z');
  await routes.setJSON('route-3',{stops:[{id:'common',name:'Одна точка'}]});
  const post={admin:true,method:'POST'};
  const d={route:'3',date:'2026-11-23',ids:['common']};
  const a=await (await req('dispatch',{...post,body:{...d,label:' Утренний '}})).json();
  const b=await (await req('dispatch',{...post,body:d})).json();
  assert.notEqual(a.code,b.code);
  assert.equal(a.code,a.id.slice(0,10).toUpperCase());
  const lookup=(token,admin=true)=>req('dispatch-lookup',{method:'POST',admin,body:{token}});
  assert.equal((await lookup(a.token,false)).status,401);
  assert.equal((await lookup('invalid')).status,400);
  assert.equal((await lookup('u'.repeat(32))).status,404);
  const driver=await (await req('dispatch',{token:a.token})).json();
  assert.equal(driver.code,a.code);
  assert.equal(driver.label,undefined);
  await req('dispatch-status',{token:a.token,method:'POST',body:{id:'common',state:'failed',reason:'закрыто'}});
  const exact=await (await lookup(a.token)).json();
  assert.equal(exact.id,a.id);
  assert.equal(exact.label,'Утренний');
  assert.equal(exact.token,undefined);
  assert.deepEqual(exact.rows[0].status,{state:'failed',reason:'закрыто',at:new Date(now).toISOString()});
  assert.equal((await (await lookup(b.token)).json()).rows[0].status,null);
  await req('dispatch?id='+a.id,{admin:true,method:'DELETE'});
  assert.equal((await req('dispatch',{token:a.token})).status,404);
  assert.equal((await (await lookup(a.token)).json()).revoked,true);
});

