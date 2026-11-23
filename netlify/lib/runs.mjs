import { createHash, randomBytes } from 'node:crypto';

const dayOK = day => typeof day === 'string' && /^\d{4}-\d\d-\d\d$/.test(day)
  && Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0,10) === day;
const text = (x, n) => typeof x === 'string' ? x.trim().slice(0,n) : '';
const tokenHash = t => createHash('sha256').update(t).digest('hex');
const pointKey = id => /^[a-zA-Z0-9_-]{1,100}$/.test(id);
const safeMap = x => {
  try {
    const u = new URL(x);
    return u.protocol === 'https:' && !u.username && !u.password
      && /^(?:www\.)?(?:yandex\.(?:ru|com|com\.tr|kz|by)|ya\.ru|2gis\.(?:ru|com|kz))$/i.test(u.hostname) ? u.href : '';
  } catch { return ''; }
};

const safeYandexMap = x => {
  const safe=safeMap(x);
  if (!safe) return false;
  const {hostname,pathname}=new URL(safe);
  const host=hostname.toLowerCase().replace(/^www\./,'');
  return host==='ya.ru' || (/^yandex\.(?:ru|com|com\.tr|kz|by)$/.test(host) && /^\/maps(?:\/|$)/.test(pathname));
};
const runHash = /^[a-f0-9]{64}$/;
const RECENT_LIMIT = 12;
const LEGACY_SCAN_LIMIT = 160;
const INDEX_SCAN_LIMIT = 160;
const validIds = ids => Array.isArray(ids) && ids.length >= 1 && ids.length <= 100
  && ids.every(id => typeof id === 'string' && pointKey(id)) && new Set(ids).size === ids.length;
const coord = (x, limit) => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= limit;

// Bound concurrently pending storage requests. Keep ordering even when completion order differs.
async function batches(items, size, fn) {
  const out = [];
  for (let i=0; i<items.length; i+=size) out.push(...await Promise.all(items.slice(i,i+size).map(fn)));
  return out;
}
async function listKeys(store, prefix, limit, valid=()=>true) {
  const keys=[];
  for await (const {blobs} of store.list({prefix,paginate:true})) {
    for (const {key} of blobs) {
      if (!key.startsWith(prefix) || !valid(key)) continue;
      if (keys.length === limit) return {keys,truncated:true};
      keys.push(key);
    }
  }
  return {keys,truncated:false};
}
const issuedKey = id => 'issued-' + id;
const legacyKey = id => 'run-' + id;
const statusKey = (id, stop) => 'status-' + id + '-' + stop;
// The per-run pointer is immutable. Reversed timestamps keep newer dates first
// when storage returns keys in lexicographic order. The API also sorts the results.
const reverseTime = time => String(9999999999999-time).padStart(13,'0');
const indexPrefix = route => 'dispatch-index-' + route + '/';
const indexKey = (m,date,created,id) =>
  indexPrefix(m)+reverseTime(Date.parse(date))+'-'+reverseTime(created)+'-'+id;
const readBody = async (req,max) => {
  const reader=req.body?.getReader();
  if (!reader) return null;
  const decoder=new TextDecoder();
  let body='', bytes=0;
  try {
    for (;;) {
      const {value,done}=await reader.read();
      if (done) break;
      bytes+=value.byteLength;
      if (bytes>max) {await reader.cancel();return null;}
      body+=decoder.decode(value,{stream:true});
    }
    return JSON.parse(body+decoder.decode());
  } catch {return null;}
};

export function makeRunHandler(getStore, { now = Date.now, nonce = () => randomBytes(24).toString('base64url') } = {}) {
  return async ({req,url,path,authed,routes,json}) => {
    const store = getStore('kmz-dispatches', {consistency:'strong'});
    const readRun = key => store.get(key,{type:'json'});
    const get = async id => {
      const key=issuedKey(id), run=await readRun(key);
      if (run) return {key,run};
      const oldKey=legacyKey(id);
      return {key:oldKey,run:await readRun(oldKey)};
    };
    const getStatus = (id, stop) => store.get(statusKey(id,stop),{type:'json'});
    const id = url.searchParams.get('id') || '';
    if (path === 'dispatch-check' && req.method === 'POST') {
      if (!authed()) return json({error:'Войдите в управление'},401);
      const body=await readBody(req,12000);
      const m=body?.route, ids=body?.ids;
      if (!['2','3'].includes(m) || !validIds(ids)) return json({error:'Проверьте маршрут и список точек'},400);
      const data=await routes.get('route-' + m,{type:'json',consistency:'strong'});
      const items=new Map((data?.stops || []).map(s => [s.id,s]));
      if (ids.some(x => !items.has(x))) return json({error:'Список изменился. Обновите маршрут и выберите точки заново'},409);
      const photos=getStore('kmz-photos',{consistency:'strong'});
      const photoChecks=new Map();
      const verifyPhoto = id => {
        if (typeof id !== 'string' || !pointKey(id)) return 'missing';
        if (!photoChecks.has(id)) photoChecks.set(id,(async()=>{
          try {return (await photos.getMetadata('p-' + id)) ? 'ok' : 'missing';}
          catch {return 'unknown';}
        })());
        return photoChecks.get(id);
      };
      const rows=await batches(ids,12,async id=>{
        const s=items.get(id);
        const marker=coord(s.lat,90)&&coord(s.lon,180);
        return {id,photo:await verifyPhoto(s.photo),map:Boolean(safeYandexMap(s.url)||safeYandexMap(s.url2)||marker),
          address:Boolean(text(s.addr,260)),marker};
      });
      return json({rows});
    }
    if (path === 'dispatch' && req.method === 'GET' && url.searchParams.has('route')) {
      if (!authed()) return json({error:'Войдите в управление'},401);
      const m=url.searchParams.get('route');
      if (!['2','3'].includes(m) || id) return json({error:'Неверный маршрут'},400);
      const [indexed,legacy]=await Promise.all([
        listKeys(store,indexPrefix(m),INDEX_SCAN_LIMIT,key=>/^dispatch-index-[23]\/\d{13}-\d{13}-[a-f0-9]{64}$/.test(key)),
        listKeys(store,'run-',LEGACY_SCAN_LIMIT,key=>runHash.test(key.slice(4)))
      ]);
      const prior=await batches(legacy.keys,18,async key=>({id:key.slice(4),run:await readRun(key)}));
      const current=[];
      // Read enough indexed runs for one screen (a pointer can exist briefly before its run).
      const keys=indexed.keys.sort();
      for (let i=0; i<keys.length && current.length<=RECENT_LIMIT; i+=8) {
        const rows=await Promise.all(keys.slice(i,i+8).map(async key=>{
          const id=key.slice(-64);
          return {id,run:await readRun(issuedKey(id))};
        }));
        current.push(...rows.filter(x=>x.run?.route===m));
      }
      const hits=prior.concat(current).filter(x=>x.run?.route===m)
        .sort((a,b)=>b.run.date.localeCompare(a.run.date) || (b.run.created??b.run.expires)-(a.run.created??a.run.expires) || a.id.localeCompare(b.id));
      const runs=await batches(hits.slice(0,RECENT_LIMIT),3,async ({id,run})=>{
        const prefix='status-'+id+'-';
        const stopIds=new Set(run.stops.map(s=>s.id));
        const marked=await listKeys(store,prefix,stopIds.size,key=>stopIds.has(key.slice(prefix.length)));
        const statuses=await batches(marked.keys,12,key=>readRun(key));
        const done=statuses.filter(s=>s?.state==='done').length;
        const failed=statuses.filter(s=>s?.state==='failed').length;
        return {id,route:m,date:run.date,expires:run.expires,revoked:Boolean(run.revoked),
          count:run.stops.length,done,failed,pending:run.stops.length-done-failed};
      });
      return json({runs,truncated:indexed.truncated||legacy.truncated||hits.length>RECENT_LIMIT});
    }
    if (path === 'dispatch' && req.method === 'POST') {
      if (!authed()) return json({error:'Войдите в управление'},401);
      const body = await readBody(req,12000);
      const m = body?.route;
      const date = body?.date;
      const ids = body?.ids;
      if (!['2','3'].includes(m) || !dayOK(date) || !validIds(ids))
        return json({error:'Проверьте маршрут, дату и список точек'},400);
      const selectedDay = Date.parse(date);
      if (selectedDay < now() - 86400000*2 || selectedDay > now() + 86400000*14)
        return json({error:'Для рейса выберите дату в ближайшие 14 дней'},400);
      const data = await routes.get('route-' + m,{type:'json',consistency:'strong'});
      const items = new Map((data?.stops || []).map(s => [s.id,s]));
      if (ids.some(x => !items.has(x))) return json({error:'Список изменился. Обновите маршрут и выберите точки заново'},409);
      const stops = ids.map(id => {
        const s = items.get(id);
        const marker=coord(s.lat,90)&&coord(s.lon,180);
        return { id,lat:marker?s.lat:null,lon:marker?s.lon:null, name:text(s.name,180), addr:text(s.addr,260), hours:text(s.hours,120),
          note:text(s.note,1800), url:safeMap(s.url), url2:safeMap(s.url2),
          photo:typeof s.photo==='string' && pointKey(s.photo) ? s.photo : '' };
      });
      const token = nonce();
      const runId = tokenHash(token);
      const created = now();
      const expires = Math.max(created + 86400000*2, selectedDay + 86400000*2);
      // The one-record index avoids lost updates between concurrent launches.
      // Publish it before the run; orphaned pointers are ignored by listing.
      await store.setJSON(indexKey(m,date,created,runId), {});
      await store.setJSON(issuedKey(runId), {route:m,date,created,expires,stops});
      return json({token,id:runId,count:stops.length,expires},201);
    }
    if (path === 'dispatch' && ['DELETE','GET'].includes(req.method) && id) {
      if (!authed()) return json({error:'Войдите в управление'},401);
      if (!runHash.test(id)) return json({error:'Неверный рейс'},400);
      const {key,run} = await get(id);
      if (!run) return json({error:'Рейс не найден'},404);
      if (req.method === 'DELETE') {
        await store.setJSON(key,{...run,revoked:true});
        return json({ok:true});
      }
      const rows=await batches(run.stops,12,async s=>({id:s.id,name:s.name,addr:s.addr||'',status:await getStatus(id,s.id)||null}));
      return json({date:run.date,route:run.route,expires:run.expires,revoked:Boolean(run.revoked),count:run.stops.length,rows});
    }
    const token = req.headers.get('x-run-token') || '';
    if (!/^[a-zA-Z0-9_-]{32}$/.test(token)) return json({error:'Некорректная ссылка на рейс'},404);
    const runId = tokenHash(token);
    const {run} = await get(runId);
    if (!run || run.revoked || run.expires <= now()) return json({error:'Рейс недоступен. Попросите новую ссылку'},404);
    if (path === 'dispatch' && req.method === 'GET') {
      const status = Object.fromEntries(await Promise.all(run.stops.map(async s => [
        s.id,await getStatus(runId,s.id)
      ])));
      return json({route:run.route,date:run.date,expires:run.expires,
        stops:run.stops.map(({photo,...s})=>({...s,hasPhoto:Boolean(photo)})),status});
    }
    if (path === 'dispatch-status' && req.method === 'POST') {
      const body = await readBody(req,12000);
      if (!run.stops.some(s => s.id === body?.id) || !['done','failed','pending'].includes(body?.state))
        return json({error:'Неизвестная точка или отметка'},400);
      const status = {state:body.state, reason:body.state==='failed'?text(body.reason,140):'', at:new Date(now()).toISOString()};
      await store.setJSON(statusKey(runId,body.id),status);
      return json({status});
    }
    if (path === 'dispatch-photo' && req.method === 'GET') {
      const stop = run.stops.find(s=>s.id===url.searchParams.get('stop'));
      if (!stop?.photo) return json({error:'Фото нет'},404);
      const data = await getStore('kmz-photos').get('p-' + stop.photo);
      if (!data) return json({error:'Фото нет'},404);
      return new Response(Uint8Array.from(atob(data), c=>c.charCodeAt(0)),{
        headers:{'content-type':'image/jpeg','cache-control':'private, no-store','x-content-type-options':'nosniff'}
      });
    }
    return json({error:'Запрос не поддерживается'},405);
  };
}
