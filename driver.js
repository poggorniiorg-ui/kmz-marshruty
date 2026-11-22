'use strict';
const token = new URLSearchParams(location.hash.slice(1)).get('t') || '';
const $ = id => document.getElementById(id);
const report = msg => { $('report').textContent=msg; };
const api = (path, options={}) => fetch('./api/'+path,{
  ...options,cache:'no-store',headers:{...options.headers,'x-run-token':token}
});
const el = (kind, text, parent) => {
  const node=document.createElement(kind); node.textContent=text;
  if(parent) parent.append(node); return node;
};
const btn = (text, parent, action) => {
  const node=el('button',text,parent); node.type='button'; node.addEventListener('click',e=>action(node,e)); return node;
};
let model;
function progress(){
  const statuses=Object.values(model.status);
  const n=statuses.filter(x=>x?.state==='done').length;
  const f=statuses.filter(x=>x?.state==='failed').length;
  $('summary').textContent=model.date.split('-').reverse().join('.')+' · сдано '+n+' из '+model.stops.length+(f?' · не сдано '+f:'');
}
function entry(stop,i){
  const li=el('li','',$('stops'));
  el('h2',(i+1)+'. '+stop.name,li);
  if(stop.addr) el('p',stop.addr,li);
  if(stop.hours) el('p',stop.hours,li);
  if(stop.note) el('p',stop.note,li);
  const status=el('p','',li);
  status.className='tag';
  const paint=()=>{
    const v=model.status[stop.id];
    status.textContent=v?.state==='done'?'Сдано':v?.state==='failed'?'Не сдано'+(v.reason?' · '+v.reason:''):'';
    status.classList.toggle('fail',v?.state==='failed');
  };
  paint();
  const actions=el('div','',li); actions.className='actions';
  [[stop.url,'Яндекс Карты'],[stop.url2,'Ещё карта']].forEach(([href,label])=>{
    if(!href) return; const a=el('a',label,actions); a.href=href; a.target='_blank'; a.rel='noopener noreferrer';
  });
  if(!stop.url&&!stop.url2) el('p','Нет ссылки на карту. Уточните адрес у диспетчера.',li);
  if(stop.hasPhoto) btn('Фото',actions,async b=>{
    b.disabled=true;
    try{
      const r=await api('dispatch-photo?stop='+encodeURIComponent(stop.id));
      if(!r.ok) throw new Error();
      const src=URL.createObjectURL(await r.blob());
      const img=el('img','',li);
      img.alt='Фото точки'; img.src=src;
      img.addEventListener('load',()=>URL.revokeObjectURL(src),{once:true});
      img.addEventListener('error',()=>{URL.revokeObjectURL(src);img.remove();b.hidden=false;b.disabled=false;report('Не удалось открыть фото.');},{once:true});
      b.hidden=true;
    }catch{b.disabled=false;report('Фото не загрузилось. Попробуйте ещё раз.');}
  });
  const options=el('div','',li); options.className='actions';
  const save=async (state,reason='')=>{
    for(const b of options.querySelectorAll('button')) b.disabled=true;
    try{
      const r=await api('dispatch-status',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:stop.id,state,reason})});
      if(!r.ok) throw new Error();
      model.status[stop.id]=(await r.json()).status; report(''); paint(); progress();
    }catch{report('Отметка не сохранена. Проверьте связь и попробуйте снова.');}
    finally{for(const b of options.querySelectorAll('button')) b.disabled=false;}
  };
  btn('Сдано',options,()=>save('done'));
  const reason=el('input','',options); reason.hidden=true; reason.maxLength=140;
  reason.placeholder='Причина, например: закрыто'; reason.setAttribute('aria-label','Причина недоставки');
  const submit=btn('Сохранить причину',options,()=>{save('failed',reason.value);}); submit.hidden=true;
  btn('Не сдано',options,()=>{reason.hidden=!reason.hidden;submit.hidden=reason.hidden;if(!reason.hidden)reason.focus();});
  btn('Снять отметку',options,()=>save('pending'));
}
(async()=>{
  if(!/^[a-zA-Z0-9_-]{32}$/.test(token)){ $('summary').textContent='Откройте ссылку, которую прислал диспетчер.';return; }
  try{
    const r=await api('dispatch'); const data=await r.json();
    if(!r.ok){$('summary').textContent=data.error||'Рейс недоступен.';return;}
    model=data; $('title').textContent='Краснодар · маршрут '+model.route; progress(); model.stops.forEach(entry);
  }catch{ $('summary').textContent='Не удалось загрузить рейс. Проверьте связь и обновите страницу.'; }
})();
