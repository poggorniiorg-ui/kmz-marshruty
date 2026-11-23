import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const script = await readFile(new URL('./driver.js',import.meta.url),'utf8');
class Element {
  constructor(tagName) {
    this.tagName = tagName;
    this.listeners = new Map();
    this.children = [];
    this.attributes = {};
    this.isConnected = true;
  }
  set textContent(text) { this.value = text; this.children = []; }
  get textContent() { return (this.value || '') + this.children.map(c => c.textContent).join(''); }
  append(...children) { this.children.push(...children); }
  prepend(child) { this.children.unshift(child); }
  replaceChildren(...children) { this.value = ''; this.children = children; }
  setAttribute(name, value) { this.attributes[name] = value; }
  removeAttribute(name) { delete this[name]; }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  fire(type) { this.listeners.get(type)?.({preventDefault(){}}); }
  focus() { this.focused = true; }
  close() { this.open = false; this.fire('close'); }
  showModal() { this.open = true; }
  querySelector(tag) { return this.querySelectorAll(tag)[0]; }
  querySelectorAll(tag) {
    return this.children.flatMap(node => [
      ...((node.tagName === tag) ? [node] : []), ...node.querySelectorAll(tag)
    ]);
  }
}
const stops = [
  {id:'1',name:'Одинаковое имя',addr:'Улица А, 2',url:'https://yandex.ru/maps/-/ab',url2:'https://2gis.ru/krasnodar/'},
  {id:'2',name:'Другая точка',hours:'09:00–18:00',note:'Въезд со двора',lat:45.1,lon:39.2,url:'https://2gis.ru/krasnodar/',hasPhoto:true},
  {id:'3',name:'Одинаковое имя',addr:'Улица Б, 15',url:'https://2gis.ru/krasnodar/'}
];
const date = '2026-11-23', origin = 'https://example.test';
const tick = () => new Promise(resolve => setImmediate(resolve));
async function start({preview=false, initial={}, statusFail=false} = {}) {
  const ids = Object.fromEntries(['report','title','summary','previewLabel','progress','next','routeList','routeSummary','stops','photoDialog','fullPhoto'].map(id => [id,new Element(id)]));
  const outbound = [], reads = [], writes = [];
  const win = new Element('window');
  const parent = {postMessage(msg,dest) { outbound.push([msg,dest]); }};
  const dispatch = (data,{source=parent,from=origin} = {}) => {
    win.listeners.get('message')?.({origin:from,source,data});
  };
  const fetch = async (url,opt) => {
    assert.equal(opt.headers['x-run-token'], 'a'.repeat(32));
    if (url === './api/dispatch' || url.startsWith('./api/dispatch-photo')) {
      reads.push(url);
      if (url.includes('photo')) return {ok:true, blob:async()=>new Blob(['fake'],{type:'image/jpeg'})};
      return Response.json({date,route:'2',status:initial,stops});
    }
    assert.equal(url,'./api/dispatch-status');
    const value=JSON.parse(opt.body);
    writes.push(value);
    if (statusFail) { statusFail=false; return Response.json({},{status:502}); }
    return Response.json({status:{state:value.state,reason:value.reason}});
  };
  vm.runInNewContext(script, {
    URLSearchParams, URL, Blob, location:{search:preview?'?preview=1':'',hash:preview?'':'#t='+'a'.repeat(32),origin}, window:win, parent, fetch,
    document:{getElementById:id=>ids[id], createElement:tag=>new Element(tag)}, setTimeout, clearTimeout
  });
  await tick();
  return {ids,outbound,reads,writes,dispatch};
}
const choose = (element, tag, text) => {
  const item = element.querySelectorAll(tag).find(o => o.textContent === text);
  assert.ok(item, 'Expected control ' + text);
  return item;
};

test('next pending stop, exact Yandex navigation, lazy photo, original route order', async () => {
  const {ids,reads} = await start({initial:{1:{state:'done'}}});
  assert.match(ids.next.textContent, /Следующая точка · №2 из 3/);
  assert.match(ids.next.textContent, /Адрес не указан/);
  assert.match(ids.next.textContent, /09:00–18:00/);
  assert.match(ids.next.textContent, /Въезд со двора/);
  assert.match(choose(ids.next,'a','Яндекс Карты').href, /^https:\/\/yandex\.ru\/maps\/\?rtext=/);
  assert.equal(choose(ids.next,'a','Ещё карта').href, 'https://2gis.ru/krasnodar/');
  assert.deepEqual(reads, ['./api/dispatch','./api/dispatch-photo?stop=2']);
  const photo = choose(ids.next,'button','Фото выгрузки');
  assert.ok(photo.querySelector('img'));
  photo.fire('click');
  await tick();
  assert.ok(ids.photoDialog.open);
  assert.match(ids.fullPhoto.alt,/Другая точка/);
  ids.photoDialog.close();
  assert.ok(photo.focused);
  assert.deepEqual(ids.stops.children.map(c => c.querySelector('h3')?.textContent || c.querySelector('summary').textContent.split(' · ')[0]), ['1. Одинаковое имя','2. Другая точка','3. Одинаковое имя']);
  assert.match(ids.stops.children[0].querySelector('summary').textContent, /Улица А, 2/);
  assert.match(ids.stops.children[2].textContent, /Улица Б, 15/);
  assert.ok(!ids.stops.children[2].querySelectorAll('a').some(a => a.textContent === 'Яндекс Карты'));
});
test('status validation failure allows retry; unsuccessful stops surface reason; clear resumes same stop', async () => {
  const {ids,writes} = await start({statusFail:true});
  const clicked = choose(ids.next,'button','Не сдано');
  clicked.fire('click');
  const form=ids.next.querySelector('form');
  form.querySelector('input').value='Закрыто';
  form.fire('submit');
  await tick();
  assert.match(ids.next.textContent, /Отметка не сохранена/);
  assert.equal(form.querySelector('button').disabled,false);
  assert.equal(form.querySelector('input').value,'Закрыто');
  form.fire('submit');
  await tick();
  assert.match(ids.next.textContent, /№2 из 3/);
  assert.match(ids.stops.children[0].textContent,/Не сдано · Закрыто/);
  assert.equal(writes.length,2);
  choose(ids.stops.children[0],'button','Снять отметку').fire('click');
  await tick();
  assert.match(ids.next.textContent,/№1 из 3/);
  choose(ids.next,'button','Сдано').fire('click');
  await tick();
  assert.match(ids.summary.textContent,/сдано 1 из 3/);
  assert.match(ids.next.textContent,/№2 из 3/);
});
test('preview accepts only same-origin messages from its parent; does not write or read live API', async () => {
  const {ids,outbound,reads,writes,dispatch} = await start({preview:true});
  assert.equal(outbound[0][0].type,'kmz-driver-preview-ready');
  assert.equal(outbound[0][1],origin);
  const msg={type:'kmz-driver-preview', data:{date,route:'2',stops:[stops[1]]}};
  dispatch(msg,{source:{}});
  dispatch(msg,{from:'https://untrusted.example'});
  assert.equal(ids.title.textContent,'');
  dispatch(msg);
  await tick();
  choose(ids.next,'button','Сдано').fire('click');
  assert.equal(choose(ids.next,'button','Сдано').disabled,true);
  assert.match(ids.next.textContent,/№1 из 1/);
  assert.equal(outbound[1][0].type,'kmz-driver-preview-photo-request');
  assert.equal(outbound[1][0].id,'2');
  dispatch({type:'kmz-driver-preview-photo',id:'2',photo:'data:image/jpeg;base64,YQ=='});
  await tick();
  assert.ok(choose(ids.next,'button','Фото выгрузки').querySelector('img'));
  assert.deepEqual(reads,[]);
  assert.deepEqual(writes,[]);
});
