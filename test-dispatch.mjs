import { makeRunHandler } from './netlify/lib/runs.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const stores = new Map();
const getStore = name => {
  if (!stores.has(name)) stores.set(name,new Map());
  const m=stores.get(name);
  return {get:async k=>structuredClone(m.get(k)),setJSON:async(k,v)=>m.set(k,structuredClone(v))};
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
