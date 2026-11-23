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
    panel.querySelector('[data-dispatch-route]').textContent=rName(route);
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
    let selected=planned.filter(id=>byId.has(id)), date=today(), runLabel='';
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
      const layout=element('div','',c);layout.className='dispatch-picker';
      const available=element('div','',layout);
      const search=element('input','',available);search.type='search';search.placeholder='Название или адрес';search.setAttribute('aria-label','Поиск точки');
      const boxes=element('div','',available);
      const draft=element('section','',layout);draft.className='dispatch-draft';
      const draftHeading=element('h3','Собранный рейс',draft);
      const draftList=element('ol','',draft);
      const bar=header(c);bar.classList.add('dispatch-picker-actions');
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
      function progress(){
        next.textContent='Проверить рейс · '+selected.length;next.disabled=!selected.length;
        draftHeading.textContent='Собранный рейс · '+selected.length;
        draftList.replaceChildren();
        for(const id of selected){const s=byId.get(id);const li=element('li',s.name,draftList);element('small',address(s),li)}
      }
      button('Снять все отметки',bar,()=>{selected=[];paint();progress()});
      search.addEventListener('input',paint);paint();progress();
    }
    function review(){
      if(!selected.length){pick();return}
      title('Проверка рейса',pick);
      element('p',rName(m)+' · '+selected.length+' точек. Этот порядок увидит водитель.',c);
      const label=element('label','Дата рейса',c);label.className='dispatch-date';
      const input=element('input','',label);input.type='date';input.value=date;
      const nameLabel=element('label','Название рейса (необязательно, видишь только ты)',c);nameLabel.className='dispatch-name';
      const nameInput=element('input','',nameLabel);nameInput.maxLength=80;nameInput.value=runLabel;nameInput.placeholder='Например: Сулейман, утро';
      nameInput.addEventListener('input',()=>{runLabel=nameInput.value});
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
          const data=await api('dispatch',json('POST',{route:m,date,ids:selected,label:runLabel}));
          if(visible())showLink(data);
        }catch(e){if(visible()){result.textContent=e.message;creating=false;update()}}
      });
      function update(){
        create.disabled=!checked||creating||!date;preview.disabled=creating||!date;input.disabled=creating;nameInput.disabled=creating;
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
          if(flags.childElementCount)item.classList.add('dispatch-has-warning');
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
      element('p',rName(m)+' · '+fmtDate(date)+' · '+data.count+' точек · № '+data.code+(runLabel.trim()?' · '+runLabel.trim():''),c);
      element('p','Ссылка действует до '+new Date(data.expires).toLocaleString('ru-RU')+'. Список в ней зафиксирован. Отправляйте только нужному водителю.',c);
      const url=new URL('./driver.html',location.href);url.hash='t='+encodeURIComponent(data.token);
      const field=element('input','',c);field.value=url.href;field.readOnly=true;field.className='dispatch-url';field.setAttribute('aria-label','Ссылка водителю');
      const actions=header(c);
      primary('Скопировать ссылку',actions,async()=>{try{await navigator.clipboard.writeText(url.href);toast('Ссылка скопирована')}catch{field.focus();field.select();toast('Скопируйте выделенную ссылку')}});
      if(navigator.share)button('Поделиться',actions,()=>navigator.share({title:'Рейс КМЗ №1',url:url.href}).catch(()=>{}));
      button('Ход этого рейса',actions,()=>openDispatchHistory(m,data.id));
    }
    if(todayOnly&&selected.length)review();else pick();
  };

  const clockLabel=at=>new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',hour:'2-digit',minute:'2-digit'}).format(at);
  const fullTime=at=>new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(at);
  const activeRun=d=>!d.revoked&&d.expires>Date.now();
  const runName=d=>d.label||('Рейс '+d.code);
  const runState=d=>d.revoked?'Ссылка отозвана':d.expires<=Date.now()?'Ссылка истекла':'Ссылка действует';
  const interval=15000;

  window.openDispatchHistory=(m=route,runId='')=>{
    if(!eligible()){toast('Войдите в управление маршрутом 2 или 3');return}
    const sheet=document.getElementById('sheet');
    const c=emptyModal('Ход рейса');
    const pane=element('div','',c);
    const valid=()=>admin&&pane.isConnected&&sheet.classList.contains('open');
    let generation=0,dispose=()=>{};
    const reset=()=>{
      dispose();dispose=()=>{};pane.replaceChildren();c.scrollTop=0;
      return ++generation;
    };
    const same=g=>valid()&&g===generation;
    const watcher=new MutationObserver(()=>{
      if(valid())return;
      dispose();watcher.disconnect();
    });
    watcher.observe(c,{childList:true});watcher.observe(sheet,{attributes:true,attributeFilter:['class']});

    function listRuns(){
      const g=reset();
      element('p','Выберите рейс из истории или вставьте ту самую ссылку, которую отправили водителю.',pane);
      const lookup=element('form','',pane);lookup.className='dispatch-lookup';
      const label=element('label','Ссылка водителя',lookup);
      const input=element('input','',label);input.type='url';input.required=true;input.maxLength=450;
      input.placeholder='Вставьте ссылку из переписки';input.autocomplete='off';input.spellcheck=false;
      const search=element('button','Найти рейс',lookup);search.className='mini';
      const status=element('p','',pane);status.setAttribute('role','status');
      lookup.addEventListener('submit',async e=>{
        e.preventDefault();
        if(search.disabled)return;
        let token;
        try{
          const link=new URL(input.value.trim());
          if(link.origin!==location.origin||!link.pathname.endsWith('/driver.html'))throw Error();
          token=new URLSearchParams(link.hash.slice(1)).get('t');
          if(!/^[A-Za-z0-9_-]{32}$/.test(token||''))throw Error();
        }catch{status.textContent='Вставьте полную ссылку водителя с этого сайта.';return}
        search.disabled=true;status.textContent='Ищу рейс…';
        try{
          const detail=await api('dispatch-lookup',json('POST',{token}));
          if(same(g))showRun(detail.id,detail);
        }catch(err){if(same(g))status.textContent=err.message}
        finally{search.disabled=false}
      });
      const bar=header(pane,'Недавние ссылки');
      const selector=element('select','',bar);selector.setAttribute('aria-label','Маршрут для истории рейсов');
      for(const id of ['2','3']){const o=element('option',rName(id),selector);o.value=id}
      selector.value=m;
      const content=element('div','',pane);
      let seq=0;
      async function refresh(){
        const i=++seq;m=selector.value;
        content.replaceChildren();element('p','Загружаю рейсы…',content);
        try{
          const data=await api('dispatch?route='+encodeURIComponent(m));
          if(!same(g)||i!==seq)return;
          content.replaceChildren();
          if(!data.runs.length)element('p','По этому маршруту ещё нет рейсов.',content);
          for(const item of data.runs){
            const card=button('',content,()=>showRun(item.id));card.classList.add('dispatch-runcard');
            element('strong',runName(item),card);
            element('small',fmtDate(item.date)+(item.label?' · № '+item.code:'')+(item.created?' · ссылка создана '+fullTime(item.created):''),card);
            element('small','Сдано '+item.done+' из '+item.count+' · не сдано '+item.failed+' · осталось '+item.pending+' · '+runState(item),card);
          }
          if(data.truncated)element('p','Более ранний рейс можно найти по его ссылке.',content);
        }catch(e){if(same(g)&&i===seq)content.textContent=e.message}
      }
      button('Обновить список',bar,refresh);selector.addEventListener('change',refresh);refresh();
    }

    function showRun(id,first){
      const g=reset();
      const controls=header(pane);
      button('← К списку рейсов',controls,listRuns);
      const refresh=button('Обновить отметки',controls,()=>read());
      const title=element('h3','Рейс',pane);
      const details=element('p','',pane);
      const chips=element('div','',pane);chips.className='dispatch-live-counts';
      const track=element('progress','',pane);track.className='dispatch-meter';track.hidden=true;
      track.setAttribute('aria-label','Точки с отметкой');
      const sync=element('p','Загружаю отметки…',pane);sync.className='dispatch-sync';sync.setAttribute('role','status');
      const next=element('p','',pane);
      const ol=element('ol','',pane);ol.className='dispatch-live-rows';
      let current=null,inflight=false,timer,lastFingerprint='';
      const revoke=button('Отозвать ссылку',pane,async()=>{
        if(!current||!activeRun(current)||!confirm('Отозвать ссылку? Водитель больше не сможет открыть этот рейс.'))return;
        revoke.disabled=true;
        try{await api('dispatch?id='+encodeURIComponent(id),{method:'DELETE'});if(same(g)){current={...current,revoked:true};paint(current);sync.textContent='Ссылка отозвана.';}}
        catch(e){if(same(g)){toast(e.message);revoke.disabled=false}}
      });
      revoke.hidden=true;
      function paint(d){
        const fingerprint=JSON.stringify(d);
        if(fingerprint===lastFingerprint&&revoke.hidden===!activeRun(d))return;
        current=d;m=d.route;lastFingerprint=fingerprint;
        const done=d.rows.filter(x=>x.status?.state==='done').length;
        const failed=d.rows.filter(x=>x.status?.state==='failed').length;
        title.textContent=rName(d.route)+' · '+runName(d);
        details.textContent=fmtDate(d.date)+' · № '+d.code+' · '+runState(d);
        chips.replaceChildren();
        for(const [n,label,style] of [[done,'Сдано','done'],[failed,'Не сдано','failed'],[d.count-done-failed,'Осталось','pending']]){
          const chip=element('div','',chips);chip.className=style;
          element('b',String(n),chip);element('small',label,chip);
        }
        track.hidden=!d.count;track.max=d.count||1;track.value=done+failed;
        const pending=d.rows.findIndex(r=>!r.status||r.status.state==='pending');
        next.textContent=pending>=0?'Первая без отметки: '+(pending+1)+'. '+d.rows[pending].name:'Все точки отмечены';
        ol.replaceChildren();
        for(const row of d.rows){
          const li=element('li','',ol), body=element('div','',li);
          element('strong',row.name,body);if(row.addr)element('small',row.addr,body);
          const state=row.status?.state;
          const badge=element('span',state==='done'?'Сдано':state==='failed'?'Не сдано':'Без отметки',li);
          badge.className='dispatch-badge '+(state==='done'||state==='failed'?state:'pending');
          if(row.status?.at){
            const time=new Date(row.status.at);
            if(Number.isFinite(+time))element('small','Отметка: '+fullTime(+time)+' МСК',body);
          }
          if(state==='failed')element('small','Причина: '+(row.status.reason||'не указана'),body);
        }
        revoke.hidden=!activeRun(d);revoke.disabled=false;
        if(!activeRun(d))clearInterval(timer);
      }
      async function read(){
        if(!same(g)||document.hidden||inflight)return;
        inflight=true;refresh.disabled=true;
        try{
          const d=await api('dispatch?id='+encodeURIComponent(id));
          if(!same(g))return;
          // A concurrent read started before revocation must not reopen controls.
          paint(current?.revoked?{...d,revoked:true}:d);
          sync.textContent='Обновлено '+clockLabel(Date.now())+' МСК'+(activeRun(current)?' · автообновление каждые 15 с.':'')+' · отметки, не GPS';
        }catch(e){
          if(same(g))sync.textContent='Не удалось обновить отметки: '+e.message+(current?'. Показаны последние полученные данные.':'');
        }finally{inflight=false;refresh.disabled=false}
      }
      function onVisible(){if(!document.hidden&&(!current||activeRun(current)))read()}
      timer=setInterval(onVisible,interval);
      document.addEventListener('visibilitychange',onVisible);
      dispose=()=>{clearInterval(timer);document.removeEventListener('visibilitychange',onVisible)};
      if(first)paint(first);
      read();
    }
    if(runId)showRun(runId);else listRuns();
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
