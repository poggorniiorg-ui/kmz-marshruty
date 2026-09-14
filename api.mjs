import { getStore } from '@netlify/blobs';

/* Сервер приложения «Маршруты КМЗ №1».
   Разделы: /api/auth, /api/access, /api/keys, /api/route,
            /api/status, /api/visits, /api/photo, /api/resolve, /api/geocode
   Пароль редактирования — переменная окружения ADMIN_PASS. */

export const config = { path: "/api/*" };
const PASS = () => process.env.ADMIN_PASS || "1";
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});
export default async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\/?/, "");
  const routes = getStore("kmz-routes");
  const keysStore = getStore("kmz-keys");
  const photos = getStore("kmz-photos");
  const authed = () => (req.headers.get("x-pass") || "") === PASS();
  const getKeys = async () => await keysStore.get("keys", { type: "json" }) || null;
  const allowed = async (m) => {
    if (authed()) return true;
    const keys = await getKeys();
    if (!keys) return true;
    const k = url.searchParams.get("k") || "";
    return !!k && (k === keys.all || k === keys["r" + m]);
  };
  try {
    if (path === "auth" && req.method === "POST") {
      const { pass } = await req.json();
      return json({ ok: pass === PASS() });
    }
    if (path === "route") {
      const m = url.searchParams.get("m") || "1";
      if (req.method === "GET") {
        if (!await allowed(m)) return json({ error: "\u041D\u0435\u0442 \u0434\u043E\u0441\u0442\u0443\u043F\u0430 \u043A \u044D\u0442\u043E\u043C\u0443 \u043C\u0430\u0440\u0448\u0440\u0443\u0442\u0443" }, 403);
        const data = await routes.get("route-" + m, { type: "json" });
        return json({ stops: data?.stops || [], day: data?.day || null, tpl: data?.tpl || null, updated: data?.updated || null });
      }
      if (req.method === "POST") {
        if (!authed()) return json({ error: "\u041D\u0443\u0436\u0435\u043D \u043F\u0430\u0440\u043E\u043B\u044C" }, 401);
        const body = await req.json();
        await routes.setJSON("route-" + m, {
          stops: body.stops || [],
          day: body.day || null,
          tpl: body.tpl || null,
          updated: (/* @__PURE__ */ new Date()).toISOString()
        });
        return json({ ok: true });
      }
    }
    if (path === "photo") {
      if (req.method === "GET") {
        const id = url.searchParams.get("id");
        const b64 = await photos.get("p-" + id);
        if (!b64) return new Response("\u043D\u0435\u0442 \u0442\u0430\u043A\u043E\u0433\u043E \u0444\u043E\u0442\u043E", { status: 404 });
        const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        return new Response(bin, {
          headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=31536000" }
        });
      }
      if (req.method === "DELETE") {
        if (!authed()) return json({ error: "\u041D\u0443\u0436\u0435\u043D \u043F\u0430\u0440\u043E\u043B\u044C" }, 401);
        const id = url.searchParams.get("id");
        if (id) await photos.delete("p-" + id).catch(() => {
        });
        return json({ ok: true });
      }
      if (req.method === "POST") {
        if (!authed()) return json({ error: "\u041D\u0443\u0436\u0435\u043D \u043F\u0430\u0440\u043E\u043B\u044C" }, 401);
        const { data } = await req.json();
        const b64 = String(data || "").replace(/^data:image\/\w+;base64,/, "");
        if (!b64) return json({ error: "\u041F\u0443\u0441\u0442\u043E\u0435 \u0444\u043E\u0442\u043E" }, 400);
        const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
        await photos.set("p-" + id, b64);
        return json({ id });
      }
    }
    if (path === "access" && req.method === "GET") {
      const keys = await getKeys();
      if (authed() || !keys) return json({ routes: ["1", "2", "3", "4", "5", "6"], admin: authed() });
      const k = url.searchParams.get("k") || "";
      if (!k) return json({ routes: [] });
      if (k === keys.all) return json({ routes: ["1", "2", "3", "4", "5", "6"] });
      const mine = [];
      for (let i = 1; i <= 6; i++) if (keys["r" + i] === k) mine.push(String(i));
      return json({ routes: mine });
    }
    if (path === "keys") {
      if (!authed()) return json({ error: "\u041D\u0443\u0436\u0435\u043D \u043F\u0430\u0440\u043E\u043B\u044C" }, 401);
      if (req.method === "POST") {
        const rnd = () => Math.random().toString(36).slice(2, 8).toUpperCase();
        const keys = { all: rnd() };
        for (let i = 1; i <= 6; i++) keys["r" + i] = rnd();
        await keysStore.setJSON("keys", keys);
        return json({ keys });
      }
      return json({ keys: await getKeys() });
    }
    if (path === "status") {
      const m = url.searchParams.get("m") || "1";
      const d = url.searchParams.get("d") || "";
      const stats = getStore("kmz-status");
      const visits = getStore("kmz-visits");
      if (req.method === "GET") {
        const key = "st-" + m + "-" + d;
        const st = await stats.get(key, { type: "json" });
        return json({ st: st || {} });
      }
      if (req.method === "POST") {
        if (!await allowed(m)) return json({ error: "\u041D\u0435\u0442 \u0434\u043E\u0441\u0442\u0443\u043F\u0430" }, 403);
        const body = await req.json();
        const key = "st-" + m + "-" + d;
        const st = await stats.get(key, { type: "json" }) || {};
        const id = body.id;
        if (!id) return json({ error: "\u043D\u0435\u0442 \u0442\u043E\u0447\u043A\u0438" }, 400);
        if (body.clear) delete st[id];
        else st[id] = { d: body.done ? 1 : 0, at: (/* @__PURE__ */ new Date()).toISOString(), r: body.reason || "" };
        await stats.setJSON(key, st);
        const vkey = "v-" + m;
        const v = await visits.get(vkey, { type: "json" }) || {};
        if (!body.clear) {
          const arr = (v[id] || []).filter((x) => x.day !== d);
          arr.push({ day: d, ok: body.done ? 1 : 0, r: body.reason || "" });
          v[id] = arr.slice(-30);
          await visits.setJSON(vkey, v);
        }
        return json({ ok: true });
      }
    }
    if (path === "visits" && req.method === "GET") {
      const m = url.searchParams.get("m") || "1";
      if (!await allowed(m)) return json({ error: "Нет доступа" }, 403);
      const v = await getStore("kmz-visits").get("v-" + m, { type: "json" });
      return json({ v: v || {} });
    }
    if (path === "resolve" && req.method === "GET") {
      if (!authed()) return json({ error: "\u041D\u0443\u0436\u0435\u043D \u043F\u0430\u0440\u043E\u043B\u044C" }, 401);
      const target = url.searchParams.get("url") || "";
      if (!/^https:\/\/(yandex\.[a-z.]+|(www\.)?2gis\.[a-z.]+)\//i.test(target)) return json({ error: "\u041F\u043E\u0434\u0434\u0435\u0440\u0436\u0438\u0432\u0430\u044E\u0442\u0441\u044F \u042F\u043D\u0434\u0435\u043A\u0441.\u041A\u0430\u0440\u0442\u044B \u0438 2\u0413\u0418\u0421" }, 400);
      const grab = (t) => {
        if (!t) return null;
        const dec = decodeURIComponent(t.replace(/%2C/gi, ","));
        const pats = [
          /whatshere\[point\]=(-?\d+\.\d+),(-?\d+\.\d+)/,
          /poi\[point\]=(-?\d+\.\d+),(-?\d+\.\d+)/,
          /[?&]pt=(-?\d+\.\d+),(-?\d+\.\d+)/,
          /"coordinates":\s*\[\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/,
          /[?&]ll=(-?\d+\.\d+),(-?\d+\.\d+)/,
          /\/(-?\d+\.\d+),(-?\d+\.\d+)(?:[/?#]|$)/,
          /"(?:point|centroid|lon)"\s*:\s*"?(-?\d+\.\d+)[,\s]+"?(-?\d+\.\d+)/,
          /POINT\((-?\d+\.\d+)\s+(-?\d+\.\d+)\)/
        ];
        for (const re of pats) {
          const m = dec.match(re);
          if (m) return [parseFloat(m[2]), parseFloat(m[1]), re === pats[4] ? "center" : "exact"];
        }
        return null;
      };
      const UA = { "user-agent": "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36" };
      let cur = target, coords = grab(target), hops = 0;
      while (!coords && hops++ < 6) {
        const r = await fetch(cur, { redirect: "manual", headers: UA });
        const loc = r.headers.get("location");
        if (loc) {
          cur = loc.startsWith("http") ? loc : new URL(loc, cur).href;
          coords = grab(cur);
          continue;
        }
        const html = await r.text();
        coords = grab(html.slice(0, 4e5));
        break;
      }
      return coords ? json({ lat: coords[0], lon: coords[1], kind: coords[2] || "exact" }) : json({ error: "\u043A\u043E\u043E\u0440\u0434\u0438\u043D\u0430\u0442 \u043D\u0435\u0442 \u0432 \u0441\u0441\u044B\u043B\u043A\u0435" }, 404);
    }
    if (path === "geocode" && req.method === "GET") {
      if (!authed()) return json({ error: "\u041D\u0443\u0436\u0435\u043D \u043F\u0430\u0440\u043E\u043B\u044C" }, 401);
      const q = (url.searchParams.get("q") || "").trim();
      if (!q) return json({ error: "\u041F\u0443\u0441\u0442\u043E\u0439 \u0430\u0434\u0440\u0435\u0441" }, 400);
      const r = await fetch(
        "https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ru&q=" + encodeURIComponent(q),
        { headers: { "user-agent": "kmz-routes/1.0 (logistics app)", "accept-language": "ru" } }
      );
      const d = await r.json();
      if (!d || !d[0]) return json({ error: "\u0430\u0434\u0440\u0435\u0441 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D" }, 404);
      return json({ lat: parseFloat(d[0].lat), lon: parseFloat(d[0].lon), found: d[0].display_name });
    }
    return json({ error: "\u041D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u044B\u0439 \u0437\u0430\u043F\u0440\u043E\u0441" }, 404);
  } catch (e) {
    return json({ error: String(e && e.message ? e.message : e) }, 500);
  }
};
