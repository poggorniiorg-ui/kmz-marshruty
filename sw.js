/* Кэш приложения. ВАЖНО: фото лежат в отдельном хранилище,
   которое НЕ чистится при обновлении версии — иначе после каждой
   заливки телефон качал бы все фото заново. */
const V   = 'kmz-app-v17';
const PIC = 'kmz-photos';          // версию не менять никогда
const SHELL = ['./','./index.html','./import.html','./manifest.json','./icon.svg'];
/* Сервер живёт на отдельном домене — фото оттуда тоже кэшируем. */
const API_HOST = 'glistening-narwhal-c13cfe.netlify.app';

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => (k !== V && k !== PIC) ? caches.delete(k) : null)))
      .then(() => self.clients.claim())
  );
});

function withTimeout(req, ms) {
  return new Promise((resolve, reject) => {
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; reject(new Error('timeout')); } }, ms);
    fetch(req).then(r => { if (!done) { done = true; clearTimeout(t); resolve(r); } },
                    e => { if (!done) { done = true; clearTimeout(t); reject(e); } });
  });
}

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  let u;
  try { u = new URL(e.request.url); } catch (err) { return; }
  const sameOrigin = (u.origin === self.location.origin);
  const isApiHost  = (u.hostname === API_HOST);
  if (!sameOrigin && !isApiHost) return;

  if (u.pathname.indexOf('/api/photo') === 0) {
    /* С чужого домена запрашиваем фото в режиме cors — иначе ответ
       непрозрачный и в кэш не кладётся, то есть офлайн фото пропадут. */
    const picReq = sameOrigin
      ? e.request
      : new Request(e.request.url, { mode: 'cors', credentials: 'omit' });
    e.respondWith(
      caches.open(PIC).then(c =>
        c.match(picReq).then(hit => {
          if (hit) return hit;
          return fetch(picReq).then(r => {
            if (r && r.ok) { try { c.put(picReq, r.clone()); } catch (err) {} }
            return r;
          }).catch(() => new Response('', { status: 504 }));
        })
      )
    );
    return;
  }

  if (u.pathname.indexOf('/api/') === 0) return;
  if (!sameOrigin) return;

  e.respondWith(
    withTimeout(e.request, 4000)
      .then(r => {
        if (r && r.ok) {
          const cp = r.clone();
          caches.open(V).then(c => { try { c.put(e.request, cp); } catch (err) {} });
        }
        return r;
      })
      .catch(() =>
        caches.match(e.request).then(hit =>
          hit || caches.match('./index.html').then(h =>
            h || new Response('<meta charset="utf-8"><body style="font:16px sans-serif;padding:40px;text-align:center">Нет связи. Откройте страницу ещё раз, когда появится интернет.</body>',
              { headers: { 'content-type': 'text/html; charset=utf-8' } })
          )
        )
      )
  );
});
