'use strict';

const token = new URLSearchParams(location.hash.slice(1)).get('t') || '';
const preview = new URLSearchParams(location.search).get('preview') === '1';
const $ = id => document.getElementById(id);
const report = msg => { $('report').textContent = msg; };
const api = (path, options = {}) => fetch('./api/' + path, {
  ...options, cache: 'no-store', headers: {...options.headers, 'x-run-token': token}
});
const el = (tag, value, parent, className = '') => {
  const node = document.createElement(tag);
  node.textContent = value;
  if (className) node.className = className;
  if (parent) parent.append(node);
  return node;
};
const button = (value, parent, action, className = '') => {
  const node = el('button', value, parent, className);
  node.type = 'button';
  node.addEventListener('click', () => action(node));
  return node;
};
const safeMap = href => {
  try {
    const u = new URL(href);
    return u.protocol === 'https:' && !u.username && !u.password &&
      /^(?:www\.)?(?:yandex\.(?:ru|com|com\.tr|kz|by)|ya\.ru|2gis\.(?:ru|com|kz))$/i.test(u.hostname) ? u.href : '';
  } catch { return ''; }
};
const yandexMap = href => {
  const url = safeMap(href);
  return Boolean(url) && !/^(?:www\.)?2gis\./i.test(new URL(url).hostname) ? url : '';
};
const coordinatesMap = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) &&
  Math.abs(lat) <= 90 && Math.abs(lon) <= 180
  ? 'https://yandex.ru/maps/?' + new URLSearchParams({rtext:'~' + lat + ',' + lon,rtt:'auto'}) : '';
const addressOf = stop => stop.addr || 'Адрес не указан';
const statusOf = stop => model.status?.[stop.id];
const stateOf = stop => statusOf(stop)?.state;
const isPending = stop => !['done', 'failed'].includes(stateOf(stop));

let model, saveBusy = false;
const photoCache = new Map(), photoRequests = new Map();
const previewLoads = new Map();
const expandedDone = new Set();
const origin = location.origin;

function previewPhoto(id) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      previewLoads.delete(id);
      reject(new Error('Фото недоступно в предпросмотре'));
    }, 8000);
    previewLoads.set(id, value => {
      clearTimeout(timeout);
      if (value) resolve(value); else reject(new Error('Фото недоступно в предпросмотре'));
    });
    parent.postMessage({type:'kmz-driver-preview-photo-request', id}, origin);
  });
}

function safePhoto(photo) {
  if (photo instanceof Blob && photo.type === 'image/jpeg' && photo.size > 0 && photo.size <= 8 * 1024 * 1024) {
    return URL.createObjectURL(photo);
  }
  if (typeof photo === 'string' && photo.length <= 11_200_000 && /^data:image\/jpeg;base64,[a-zA-Z0-9+/]+={0,2}$/.test(photo)) {
    return photo;
  }
  throw new Error('Недопустимое фото');
}
function photoOf(stop) {
  if (photoCache.has(stop.id)) return Promise.resolve(photoCache.get(stop.id));
  if (photoRequests.has(stop.id)) return photoRequests.get(stop.id);
  const request = (async () => {
    let picture;
    if (preview) {
      picture = stop.previewPhoto || await previewPhoto(stop.id);
    } else {
      const response = await api('dispatch-photo?stop=' + encodeURIComponent(stop.id));
      if (!response.ok) throw new Error('Фото недоступно');
      picture = await response.blob();
    }
    const src = safePhoto(picture);
    photoCache.set(stop.id, src);
    return src;
  })().finally(() => photoRequests.delete(stop.id));
  photoRequests.set(stop.id, request);
  return request;
}
function forgetPhoto(stop, src) {
  if (photoCache.get(stop.id) === src) {
    photoCache.delete(stop.id);
    if (src.startsWith('blob:')) URL.revokeObjectURL(src);
  }
}
function showPhoto(stop, src, initiatingControl) {
  const dialog = $('photoDialog'), full = $('fullPhoto');
  full.onerror = () => { forgetPhoto(stop, src); dialog.close(); report('Фото не открылось. Попробуйте ещё раз.'); };
  full.alt = 'Место выгрузки: ' + stop.name;
  full.src = src;
  if (!dialog.open) {
    dialog.addEventListener('close', () => {
      full.onerror = null;
      full.removeAttribute('src');
      if (initiatingControl.isConnected) initiatingControl.focus();
    }, {once:true});
    dialog.showModal();
  }
}
function mapLink(href, label, group, main = false) {
  const a = el('a', label, group, main ? 'primary' : '');
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}
function navigation(stop, section, {thumb = false} = {}) {
  const first = safeMap(stop.url), second = safeMap(stop.url2);
  const main = yandexMap(first) || yandexMap(second) || coordinatesMap(stop.lat, stop.lon);
  const alternative = [second, first].find(x => x && x !== main);
  const actions = el('div', '', section, 'actions');
  if (main) mapLink(main, 'Поехать', actions, true);
  let photoButton;
  if (stop.hasPhoto) {
    photoButton = button('', actions, async b => {
      b.disabled = true;
      try {
        const src = await photoOf(stop);
        if (b.isConnected) {report(''); showPhoto(stop, src, b);}
      } catch { report('Фото не загрузилось. Попробуйте ещё раз.'); }
      finally { b.disabled = false; }
    }, 'photoButton');
    el('span', 'Фото выгрузки', photoButton);
    if (thumb) photoOf(stop).then(src => {
      if (!photoButton.isConnected) return;
      const mini = el('img', '');
      mini.alt = '';
      mini.addEventListener('error', () => { mini.remove(); forgetPhoto(stop, src); }, {once:true});
      mini.src = src;
      photoButton.prepend(mini);
    }).catch(() => {});
  }
  if (!main) el('p', 'Нет метки в Яндекс Картах. Уточните место выгрузки у диспетчера.', section, 'subtle');
  if (thumb && !stop.hasPhoto) el('p', 'Фото выгрузки не добавлено', section, 'subtle');
  if (alternative && alternative !== main) return alternative;
  return '';
}
function getMenu(parent, label) {
  const more = el('details', '', parent, 'inline-menu');
  el('summary', label, more);
  return el('div', '', more, 'actions');
}
function details(stop, section, thumb = false) {
  el('p', addressOf(stop), section, 'address');
  if (stop.hours) el('p', 'Приёмка: ' + stop.hours, section);
  if (stop.note) el('p', stop.note, section, 'note');
  return navigation(stop, section, {thumb});
}
function mark(stop, section, alternate, state) {
  const controls = el('div', '', section, 'actions');
  if (preview) {
    for (const label of ['Сдано','Не сдано']) {
      const sample = button(label, controls, () => {});
      sample.disabled = true;
    }
    if (alternate) mapLink(alternate, 'Ещё карта', getMenu(section, 'Ещё'));
    return;
  }
  const statusLine = el('p', '', section, 'subtle');
  statusLine.setAttribute('role', 'status');
  const save = async (value, reason = '') => {
    if (saveBusy) return;
    saveBusy = true;
    const buttons = Array.from(section.querySelectorAll('button'));
    buttons.forEach(b => b.disabled = true);
    statusLine.textContent = 'Сохраняю отметку…';
    try {
      const r = await api('dispatch-status', {
        method:'POST', headers:{'content-type':'application/json'},
        body:JSON.stringify({id:stop.id, state:value, reason})
      });
      if (!r.ok) throw new Error();
      model.status[stop.id] = (await r.json()).status;
      report('');
      render();
      const nextHeading = $('next').querySelector('h2');
      if (nextHeading) nextHeading.focus();
    } catch {
      statusLine.textContent = 'Отметка не сохранена. Проверьте связь и попробуйте снова.';
    } finally {
      saveBusy = false;
      buttons.forEach(b => b.disabled = false);
    }
  };
  if (state !== 'done') button('Сдано', controls, () => save('done'));
  if (state !== 'done') {
    const form = el('form', '', section, 'actions');
    form.hidden = true;
    const reason = el('input', '', form);
    reason.maxLength = 140;
    reason.placeholder = 'Причина, например: закрыто';
    reason.setAttribute('aria-label', 'Причина недоставки');
    if (state === 'failed') reason.value = statusOf(stop)?.reason || '';
    const submit = el('button', 'Сохранить причину', form);
    submit.type = 'submit';
    form.addEventListener('submit', e => { e.preventDefault(); save('failed', reason.value); });
    const toggle = button(state === 'failed' ? 'Изменить причину' : 'Не сдано', controls, b => {
      form.hidden = !form.hidden;
      b.setAttribute('aria-expanded', String(!form.hidden));
      if (!form.hidden) reason.focus();
    });
    toggle.setAttribute('aria-expanded','false');
  }
  if (alternate || state === 'done' || state === 'failed') {
    const menu = getMenu(section, 'Ещё');
    if (alternate) mapLink(alternate, 'Ещё карта', menu);
    if (state === 'done' || state === 'failed') button('Снять отметку', menu, () => save('pending'));
  }
}
function render() {
  const stops = model.stops, total = stops.length;
  const done = stops.filter(s => stateOf(s) === 'done').length;
  const failed = stops.filter(s => stateOf(s) === 'failed').length;
  const date = model.date.split('-').reverse().join('.');
  $('title').textContent = 'Краснодар · маршрут ' + model.route;
  $('summary').textContent = date + ' · сдано ' + done + ' из ' + total + (failed ? ' · не сдано ' + failed : '');
  const progress = $('progress');
  progress.hidden = !total;
  progress.max = total || 1; progress.value = done;
  const focus = stops.findIndex(isPending);
  const next = $('next');
  next.replaceChildren();
  if (focus >= 0) {
    const stop = stops[focus];
    el('div', 'Следующая точка · №' + (focus + 1) + ' из ' + total, next, 'eyebrow');
    el('h2', stop.name, next).tabIndex = -1;
    mark(stop, next, details(stop, next, true), 'pending');
  } else {
    el('h2', total && !failed ? 'Рейс завершён' : total ? 'Все точки отмечены' : 'В рейсе нет точек', next).tabIndex = -1;
    if (failed) el('p', 'Проверьте несданные точки и причины в списке ниже.', next);
  }
  $('routeList').hidden = !total;
  $('routeSummary').textContent = 'Все точки по порядку · ' + total;
  $('stops').replaceChildren();
  stops.forEach((stop, index) => {
    const li = el('li', '', $('stops'));
    const name = (index + 1) + '. ' + stop.name;
    const state = stateOf(stop);
    if (state === 'done') {
      li.className = 'completed';
      const row = el('details', '', li);
      row.open = expandedDone.has(stop.id);
      row.addEventListener('toggle', () => {
        if (row.open) expandedDone.add(stop.id); else expandedDone.delete(stop.id);
      });
      const summary = el('summary', name + ' · ', row);
      el('span', 'Сдано', summary, 'doneTag');
      el('span', addressOf(stop), summary, 'listNote');
      mark(stop, row, details(stop, row), state);
      return;
    }
    el('h3', name, li);
    if (state === 'failed') el('p', 'Не сдано · ' + (statusOf(stop)?.reason || 'причина не указана'), li, 'failTag');
    mark(stop, li, details(stop, li), state);
  });
}
if (preview) {
  $('previewLabel').hidden = false;
  $('summary').textContent = 'Загружаю предпросмотр…';
  if (parent === window) {
    $('summary').textContent = 'Откройте предпросмотр из окна подготовки рейса.';
  } else {
    window.addEventListener('message', event => {
      if (event.origin !== origin || event.source !== parent) return;
      const msg = event.data;
      if (msg?.type === 'kmz-driver-preview' && !model) {
        const d = msg.data;
        if (!d || !['2','3'].includes(String(d.route)) || !/^\d{4}-\d\d-\d\d$/.test(d.date) || !Array.isArray(d.stops)) return;
        model = {route:d.route, date:d.date, status:{}, stops:d.stops};
        render();
      }
      if (msg?.type === 'kmz-driver-preview-photo') {
        const accept = previewLoads.get(msg.id);
        if (accept) { previewLoads.delete(msg.id); accept(msg.photo); }
      }
    });
    parent.postMessage({type:'kmz-driver-preview-ready'}, origin);
  }
} else {
  (async () => {
    if (!/^[a-zA-Z0-9_-]{32}$/.test(token)) {
      $('summary').textContent = 'Откройте ссылку, которую прислал диспетчер.';
      return;
    }
    try {
      const r = await api('dispatch');
      const data = await r.json();
      if (!r.ok) { $('summary').textContent = data.error || 'Рейс недоступен.'; return; }
      model = data;
      render();
    } catch {
      $('summary').textContent = 'Не удалось загрузить рейс. Проверьте связь и обновите страницу.';
    }
  })();
}
