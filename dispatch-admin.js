/* Loaded before the main app; references to its state are resolved at click time. */
(() => {
  const element = (tag,text,parent) => {
    const e=document.createElement(tag); e.textContent=text; if(parent) parent.append(e); return e;
  };
  const button=(label,parent,fn)=>{
    const b=element('button',label,parent);b.type='button';b.className='mini';b.addEventListener('click',fn);return b;
  };
  const emptyModal=title=>{
    const c=document.getElementById('card');c.replaceChildren();
    button('Закрыть',c,closeSheet);element('h2',title,c);
    document.getElementById('sheet').classList.add('open');return c;
  };
  const api=async(path,options={})=>{
    const res=await fetch('/api/'+path,{...options,cache:'no-store',headers:{...options.headers,...hdr()}});
    const data=await res.json();
    if(!res.ok)throw new Error(data.error||'Сервер не принял изменения');
    return data;
  };
  const json=(method,body)=>({method,headers:{'content-type':'application/json'},body:JSON.stringify(body)});

  const eligible=()=>admin&&['2','3'].includes(route);
  const ready=()=>eligible()&&!loading&&!offline&&!dirty;
  const primary=(label,p,fn)=>{const b=button(label,p,fn);b.classList.add('dispatch-primary');return b};
  const fmtDate=s=>String(s||'').split('-').reverse().join('.');
  const address=s=>s.addr?.trim()||'Адрес не указан';
  const mapsURL=(x,host)=>{try{const u=new URL(x);return u.protocol==='https:'&&!u.username&&!u.password&&host.test(u.hostname)?u.href:''}catch{return ''}};
  const ya=/^(?:www\.)?(?:yandex\.(?:ru|com|com\.tr|kz|by)|ya\.ru)$/i;
  const gis=/^(?:www\.)?2gis\.(?:ru|com|kz)$/i;
  const coord=s=>typeof s.lat==='number'&&typeof s.lon==='number'&&Math.abs(s.lat)<=90&&Math.abs(s.lon)<=180&&(s.lat!==0||s.lon!==0);
  const driverStops=stops=>stops.map(s=>({id:s.id,name:s.name,addr:s.addr,hours:s.hours,note:s.note,url:mapsURL(s.url,ya)||mapsURL(s.url2,ya),url2:mapsURL(s.url2,gis)||mapsURL(s.url,gis),hasPhoto:!!s.photo,lat:coord(s)?s.lat:null,lon:coord(s)?s.lon:null}));
  function header(c, title){
    const bar=element('div','',c);bar.className='dispatch-actions';
    if(title)element('h3',title,c);
    return bar;
  }
  window.renderDispatchHome=()=>{
    const panel=document.getElementById('dispatchHome');
    if(!panel)return;
    panel.hidden=!eligible();
    if(panel.hidden)return;
    const n=planIds()?.length||0;
    panel.querySelector('[data-dispatch-count]').textContent=n?'На сегодня: '+n+' точек':'План на сегодня не задан';
    panel.querySelector('[data-dispatch-import]').disabled=!ready();
    panel.querySelector('[data-dispatch-review]').disabled=!ready()||!n;
  };
  const openPreview=(c,m,date,stops,back)=>{
    c.replaceChildren();
    const bar=header(c);
    button('← К проверке рейса',bar,back);button('Закрыть',bar,closeSheet);
    element('h2','Глазами водителя',c);
    element('p','Это предпросмотр. Ссылка ещё не создана, отметки не сохраняются.',c);
    const frame=element('iframe','',c);frame.className='dispatch-frame';frame.title='Предпросмотр рейса водителя';
    const send=(data)=>frame.contentWindow?.postMessage(data,location.origin);
    const byId=new Map(stops.map(s=>[s.id,s]));
    const message=async e=>{
      if(e.origin!==location.origin||e.source!==frame.contentWindow||!frame.isConnected||!document.getElementById('sheet').classList.contains('open')||!admin)return;
      if(e.data?.type==='kmz-driver-preview-ready')send({type:'kmz-driver-preview',data:{route:m,date,stops:driverStops(stops),status:{}}});
      if(e.data?.type==='kmz-driver-preview-photo-request'){
        const id=e.data.id;let photo=null;
        const stop=byId.get(id);
        if(stop?.photo)try{
          const r=await fetch(photoUrl(stop.photo),{headers:hdr()});
          if(r.ok&&r.headers.get('content-type')?.startsWith('image/jpeg'))photo=await r.blob();
        }catch{}
        if(frame.isConnected)send({type:'kmz-driver-preview-photo',id,photo});
      }
    };
    window.addEventListener('message',message);
    const watcher=new MutationObserver(()=>{
      if(frame.isConnected&&document.getElementById('sheet').classList.contains('open'))return;
      window.removeEventListener('message',message);watcher.disconnect();
    });
    watcher.observe(c,{childList:true});watcher.observe(document.getElementById('sheet'),{attributes:true,attributeFilter:['class']});
    frame.src='./driver.html?preview=1';
  };
  window.openDispatch=({todayOnly=false}={})=>{
    if(!ready()){toast('Сначала обновите и сохраните маршрут');return;}
    const m=route, stops=list.slice(), planned=planIds()||[];
    const byId=new Map(stops.map(s=>[s.id,s]));
    let selected=planned.filter(id=>byId.has(id)), date=today();
    const c=emptyModal('');
    const current=()=>ready()&&route===m;
    const title=(text,back)=>{
      c.replaceChildren();c.scrollTop=0;
      const nav=header(c);
      if(back)button('← Назад',nav,back);
      button('Закрыть',nav,closeSheet);
      element('h2',text,c);
    };
    function pick(){
      title('Точки рейса · '+rName(m));
      element('p','Выберите точки. Порядок проверите на следующем шаге.',c);
      const bar=header(c), search=element('input','',c);search.type='search';search.placeholder='Название или адрес';search.setAttribute('aria-label','Поиск точки');
      const boxes=element('div','',c);
      const next=primary('',bar,review);
      const paint=()=>{
        boxes.replaceChildren();const q=search.value.trim().toLowerCase().replace(/ё/g,'е');
        let displayed=0;
        for(const s of stops){
          if(![s.name,s.addr].join(' ').toLowerCase().replace(/ё/g,'е').includes(q))continue;
          displayed++;
          const label=element('label','',boxes);label.className='dispatch-select';
          const box=element('input','',label);box.type='checkbox';box.checked=selected.includes(s.id);
          const txt=element('span','',label);element('b',s.name,txt);element('small',address(s),txt);
          box.addEventListener('change',()=>{selected=box.checked?[...selected,s.id]:selected.filter(id=>id!==s.id);progress()});
        }
        if(!displayed)element('p','Точки не найдены',boxes);
      };
      function progress(){next.textContent='Проверить рейс · '+selected.length;next.disabled=!selected.length}
      button('Снять все отметки',bar,()=>{selected=[];paint();progress()});
      search.addEventListener('input',paint);paint();progress();
    }
    function review(){
      if(!selected.length){pick();return}
      title('Проверка рейса',pick);
      element('p',rName(m)+' · '+selected.length+' точек. Этот порядок увидит водитель.',c);
      const label=element('label','Дата рейса',c);label.className='dispatch-date';
      const input=element('input','',label);input.type='date';input.value=date;
      const controls=header(c);
      const result=element('div','',c);result.setAttribute('role','status');result.className='dispatch-report';
      const rows=element('ol','',c);rows.className='dispatch-rows';
      let audit=null,revision=0,creating=false,checked=false;
      const visible=()=>current()&&c.contains(rows)&&document.getElementById('sheet').classList.contains('open');
      const preview=button('Посмотреть глазами водителя',controls,()=>{
        if(input.reportValidity())openPreview(c,m,date,selected.map(id=>byId.get(id)),review);
      });
      input.required=true;input.addEventListener('input',()=>{date=input.value;update()});
      const create=primary('Создать ссылку',controls,async()=>{
        if(!visible()||creating||!checked||!input.reportValidity())return;
        creating=true;update();result.textContent='Создаю рейс…';
        try{
          const data=await api('dispatch',json('POST',{route:m,date,ids:selected}));
          if(visible())showLink(data);
        }catch(e){if(visible()){result.textContent=e.message;creating=false;update()}}
      });
      function update(){
        create.disabled=!checked||creating||!date;preview.disabled=creating||!date;input.disabled=creating;
        rows.querySelectorAll('button').forEach(b=>{b.disabled=creating||b.dataset.boundary==='yes'});
      }
      function paintRows(focusId,focusDir){
        rows.replaceChildren();
        const counts={photo:0,map:0,address:0,unknown:0,marker:0};
        const rowsById=new Map(audit?.map(x=>[x.id,x]));
        let focus;
        selected.forEach((id,i)=>{
          const s=byId.get(id), info=rowsById.get(id);
          const item=element('li','',rows);
          const card=element('div','',item);card.className='dispatch-checkrow';
          const body=element('div','',card);element('strong',s.name,body);element('small',address(s),body);
          const flags=element('div','',body);flags.className='dispatch-flags';
          function flag(msg,key){element('span',msg,flags);counts[key]++}
          if(info?.address===false||!s.addr?.trim())flag('Уточнить адрес','address');
          if(info?.map===false||(!info&&!mapsURL(s.url,ya)&&!mapsURL(s.url2,ya)&&!coord(s)))flag('Нет метки Яндекса','map');
          else if(info?.marker===false)flag('Координаты не записаны','marker');
          if(info?.photo==='missing'||!s.photo)flag('Нет фото','photo');
          else if(info?.photo==='unknown'||(checked&&!info))flag('Фото не проверено','unknown');
          const arrows=element('div','',card);arrows.className='dispatch-arrows';
          for(const [glyph,dir,word] of [['↑',-1,'выше'],['↓',1,'ниже']]){
            const b=button(glyph,arrows,()=>{
              [selected[i],selected[i+dir]]=[selected[i+dir],selected[i]];paintRows(id,dir);
            });b.setAttribute('aria-label',s.name+': переместить '+word);
            b.dataset.boundary=i+dir<0||i+dir>=selected.length?'yes':'no';
            if(focusId===id&&b.dataset.boundary==='no'&&(focusDir===dir||!focus))focus=b;
          }
        });
        if(checked){
          const warnings=[counts.address&&'уточнить адрес: '+counts.address,counts.map&&'нет метки Яндекса: '+counts.map,counts.photo&&'нет фото: '+counts.photo,counts.unknown&&'фото не проверено: '+counts.unknown,counts.marker&&'без записанных координат: '+counts.marker].filter(Boolean);
          result.textContent=warnings.length?'Обратите внимание: '+warnings.join(' · ')+'. Ссылка всё равно доступна.':'Адреса, ссылки на карту и наличие фото проверены.';
        }
        update();focus?.focus({preventScroll:true});
      }
      result.textContent='Проверяю карточки и наличие фото…';
      paintRows();
      const run=++revision;
      api('dispatch-check',json('POST',{route:m,ids:selected}))
        .then(data=>{if(!visible()||run!==revision)return;audit=data.rows;checked=true;paintRows()})
        .catch(e=>{if(!visible()||run!==revision)return;result.textContent='Проверка не завершилась: '+e.message;button('Повторить проверку',result,review)});
    }
    function showLink(data){
      title('Рейс готов');
      element('p',rName(m)+' · '+fmtDate(date)+' · '+data.count+' точек',c);
      element('p','Ссылка действует до '+new Date(data.expires).toLocaleString('ru-RU')+'. Список в ней зафиксирован. Отправляйте только нужному водителю.',c);
      const url=new URL('./driver.html',location.href);url.hash='t='+encodeURIComponent(data.token);
      const field=element('input','',c);field.value=url.href;field.readOnly=true;field.className='dispatch-url';field.setAttribute('aria-label','Ссылка водителю');
      const actions=header(c);
      primary('Скопировать ссылку',actions,async()=>{try{await navigator.clipboard.writeText(url.href);toast('Ссылка скопирована')}catch{field.focus();field.select();toast('Скопируйте выделенную ссылку')}});
      if(navigator.share)button('Поделиться',actions,()=>navigator.share({title:'Рейс КМЗ №1',url:url.href}).catch(()=>{}));
      button('Рейсы и статусы',actions,()=>openDispatchHistory(m));
    }
    if(todayOnly&&selected.length)review();else pick();
  };
  window.openDispatchHistory=(m=route)=>{
    if(!eligible()){toast('Войдите в управление маршрутом 2 или 3');return}
    const c=emptyModal('Последние рейсы');
    const bar=header(c);
    const selector=element('select','',bar);selector.setAttribute('aria-label','Маршрут для истории рейсов');
    for(const id of ['2','3']){const o=element('option',rName(id),selector);o.value=id}
    selector.value=m;
    const content=element('div','',c);
    let sequence=0;
    const valid=()=>admin&&c.contains(content)&&document.getElementById('sheet').classList.contains('open');
    async function refresh(){
      const seq=++sequence;
      content.replaceChildren();element('p','Загружаю рейсы…',content);
      try{
        const data=await api('dispatch?route='+encodeURIComponent(selector.value));
        if(!valid()||seq!==sequence)return;
        content.replaceChildren();
        if(!data.runs.length)element('p','По этому маршруту ещё нет рейсов.',content);
        if(data.truncated)element('p','Показаны последние рейсы.',content);
        for(const item of data.runs){
          const card=element('details','',content);card.className='dispatch-history';
          const summary=element('summary','',card);
          element('strong',fmtDate(item.date)+' · '+item.count+' точек',summary);
          element('small','Сдано '+item.done+' · не сдано '+item.failed+' · без отметки '+item.pending+(item.revoked?' · ссылка отозвана':item.expires<=Date.now()?' · ссылка истекла':''),summary);
          const details=element('div','',card);
          card.addEventListener('toggle',async()=>{
            if(!card.open)return;
            details.replaceChildren();element('p','Обновляю отметки…',details);
            try{
              const detail=await api('dispatch?id='+encodeURIComponent(item.id));
              if(!valid()||!details.isConnected)return;
              details.replaceChildren();const ol=element('ol','',details);
              for(const row of detail.rows){
                const li=element('li','',ol);element('b',row.name,li);element('small',address(row),li);
                element('small',row.status?.state==='done'?'Сдано':row.status?.state==='failed'?'Не сдано'+(row.status.reason?' · '+row.status.reason:''):'Без отметки',li);
              }
              if(!detail.revoked&&detail.expires>Date.now())button('Отозвать ссылку',details,async e=>{
                if(!confirm('Отозвать ссылку? Водитель больше не сможет открыть этот рейс.'))return;
                const b=e.currentTarget;b.disabled=true;
                try{await api('dispatch?id='+encodeURIComponent(item.id),{method:'DELETE'});if(valid())await refresh()}
                catch(err){toast(err.message);b.disabled=false}
              });
            }catch(e){details.textContent=e.message}
          });
        }
      }catch(e){if(valid()&&seq===sequence)content.textContent=e.message}
    }
    button('Обновить статусы',bar,refresh);selector.addEventListener('change',refresh);refresh();
  };

  window.openRouteImport=()=>{
    if(!admin||offline||dirty||loading||!['2','3'].includes(route)){toast('Сначала открывайте сохранённый маршрут 2 или 3');return}
    const m=route, original=list.slice();
    const c=emptyModal('Загрузить сверенный список · '+rName(m));
    element('p','Выберите файл маршрутов. Совпавшие точки сохранят фото, телефон и идентификатор; старые карточки не удаляются.',c);
    const file=element('input','',c);file.type='file';file.accept='.json,application/json';file.setAttribute('aria-label','Файл с маршрутами');
    const view=element('div','',c);view.setAttribute('aria-live','polite');
    const normal=s=>String(s||'').toLowerCase().replace(/ё/g,'е').replace(/[^a-zа-я0-9]+/g,' ').trim();
    file.onchange=async()=>{
      view.replaceChildren();
      try{
        if(!file.files[0] || file.files[0].size>1000000)throw Error('Нужен JSON размером до 1 МБ');
        const rows=JSON.parse(await file.files[0].text())?.routes?.[m];
        if(!Array.isArray(rows)||!rows.length||rows.length>100)throw Error('Файл не содержит этот маршрут');
        const used=new Set(), next=[], added=[], issues=[];
        for(const s of rows){
          if(!s || typeof s.name!=='string'||!s.name.trim()||s.name.length>150||typeof s.id!=='string'||!/^kmz[23]-[a-z0-9]+$/.test(s.id)||
             [s.addr,s.note,s.url].some(x=>typeof x!=='string'||x.length>1700)||
             (s.url&&!/^https:\/\/yandex\.ru\/maps\/-\/[a-z0-9_-]+\/?$/i.test(s.url)))throw Error('Неверный формат точки '+(s?.name||''));
          const same=original.filter(x=>x.id===s.id || (s.url&&x.url===s.url)||normal(x.name)===normal(s.name));
          if(same.length>1 || (same[0]&&used.has(same[0].id))){issues.push(s.name);continue;}
          const old=same[0];
          if(old){used.add(old.id);const changedMap=s.url&&old.url&&s.url!==old.url;
            next.push({...old,name:s.name,addr:s.addr||old.addr||'',note:[old.note,s.note].filter(Boolean).filter((s,i,a)=>a.indexOf(s)===i).join('\n'),url:s.url||old.url||'',...(changedMap?{lat:null,lon:null}:{})});}
          else{added.push(s.name);next.push(s)}
        }
        if(new Set(next.map(s=>s.id)).size!==next.length)throw Error('В исходном списке повторяются точки');
        if(issues.length)throw Error('Несколько совпадений: '+issues.join(', ')+'. Сначала уточните карточки.');
        const remaining=original.filter(s=>!used.has(s.id));
        element('p','В сверенном порядке: '+next.length+' · новых: '+added.length+' · старых вне сверки сохранено в конце: '+remaining.length,view);
        if(added.length)element('p','Новые: '+added.join(', ')+'. Проверьте, нет ли этих же точек под другими именами.',view);
        if(remaining.length)element('p','Вне списка: '+remaining.map(s=>s.name).join(', '),view);
        button('Сохранить этот порядок',view,async e=>{
          if(route!==m||list.length!==original.length||list.some((s,i)=>s!==original[i])){toast('Маршрут изменился, откройте импорт заново');return}
          if(!confirm('Сохранить сверенный порядок для маршрута '+m+'? Карточки вне списка будут сохранены.'))return;
          const submit=e.currentTarget;submit.disabled=true;
          try{
            await api('route?m='+encodeURIComponent(m),json('POST',{stops:next.concat(remaining),day:plan,tpl}));
            await loadRoute();closeSheet();toast('Маршрут сохранён');
          }catch(err){toast(err.message);submit.disabled=false;}
        });
      }catch(e){element('p',e.message,view)}
    };
  };
})();
