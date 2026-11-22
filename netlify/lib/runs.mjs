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

export function makeRunHandler(getStore, { now = Date.now, nonce = () => randomBytes(24).toString('base64url') } = {}) {
  return async ({req,url,path,authed,routes,json}) => {
    const store = getStore('kmz-dispatches', {consistency:'strong'});
    const get = id => store.get('run-' + id, {type:'json'});
    const getStatus = async (id, stop) => store.get('status-' + id + '-' + stop, {type:'json'});
    const id = url.searchParams.get('id') || '';
    if (path === 'dispatch' && req.method === 'POST') {
      if (!authed()) return json({error:'Войдите в управление'},401);
      const body = await req.json().catch(() => null);
      const m = body?.route;
      const date = body?.date;
      const ids = body?.ids;
      if (!['2','3'].includes(m) || !dayOK(date) || !Array.isArray(ids) || ids.length < 1 || ids.length > 100 ||
          new Set(ids).size !== ids.length || ids.some(x => typeof x !== 'string' || !pointKey(x)))
        return json({error:'Проверьте маршрут, дату и список точек'},400);
      const selectedDay = Date.parse(date);
      if (selectedDay < now() - 86400000*2 || selectedDay > now() + 86400000*14)
        return json({error:'Для рейса выберите дату в ближайшие 14 дней'},400);
      const data = await routes.get('route-' + m,{type:'json'});
      const items = new Map((data?.stops || []).map(s => [s.id,s]));
      if (ids.some(x => !items.has(x))) return json({error:'Список изменился. Обновите маршрут и выберите точки заново'},409);
      const stops = ids.map(id => {
        const s = items.get(id);
        return { id, name:text(s.name,180), addr:text(s.addr,260), hours:text(s.hours,120),
          note:text(s.note,1800), url:safeMap(s.url), url2:safeMap(s.url2),
          photo:typeof s.photo==='string' && pointKey(s.photo) ? s.photo : '' };
      });
      const token = nonce();
      const runId = tokenHash(token);
      const expires = Math.max(now() + 86400000*2, selectedDay + 86400000*2);
      await store.setJSON('run-' + runId, {route:m,date,expires,stops});
      return json({token,id:runId,count:stops.length,expires},201);
    }
    if (path === 'dispatch' && ['DELETE','GET'].includes(req.method) && id) {
      if (!authed()) return json({error:'Войдите в управление'},401);
      if (!/^[a-f0-9]{64}$/.test(id)) return json({error:'Неверный рейс'},400);
      const run = await get(id);
      if (!run) return json({error:'Рейс не найден'},404);
      if (req.method === 'DELETE') {
        await store.setJSON('run-' + id,{...run,revoked:true});
        return json({ok:true});
      }
      const rows=await Promise.all(run.stops.map(async s=>({name:s.name,status:await getStatus(id,s.id)})));
      return json({date:run.date,route:run.route,expires:run.expires,revoked:Boolean(run.revoked),count:run.stops.length,rows});
    }
    const token = req.headers.get('x-run-token') || '';
    if (!/^[a-zA-Z0-9_-]{32}$/.test(token)) return json({error:'Некорректная ссылка на рейс'},404);
    const runId = tokenHash(token);
    const run = await get(runId);
    if (!run || run.revoked || run.expires <= now()) return json({error:'Рейс недоступен. Попросите новую ссылку'},404);
    if (path === 'dispatch' && req.method === 'GET') {
      const status = Object.fromEntries(await Promise.all(run.stops.map(async s => [
        s.id,await getStatus(runId,s.id)
      ])));
      return json({route:run.route,date:run.date,expires:run.expires,
        stops:run.stops.map(({photo,...s})=>({...s,hasPhoto:Boolean(photo)})),status});
    }
    if (path === 'dispatch-status' && req.method === 'POST') {
      const body = await req.json().catch(() => null);
      if (!run.stops.some(s => s.id === body?.id) || !['done','failed','pending'].includes(body?.state))
        return json({error:'Неизвестная точка или отметка'},400);
      const status = {state:body.state, reason:body.state==='failed'?text(body.reason,140):'', at:new Date(now()).toISOString()};
      await store.setJSON('status-' + runId + '-' + body.id,status);
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
