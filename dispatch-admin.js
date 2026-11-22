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
    const res=await fetch('/api/'+path,{...options,cache:'no-store',headers:{...options.headers,'x-pass':pass}});
    const data=await res.json();
    if(!res.ok)throw new Error(data.error||'Сервер не принял изменения');
    return data;
  };
  const json=(method,body)=>({method,headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const recent=()=>{try{return JSON.parse(LS.get('kmz_recent_dispatches')||'[]')}catch{return[]}};
  window.openDispatch=()=>{
    if(!admin || !['2','3'].includes(route)) return;
    if(offline || loading || dirty){toast('Сначала обновите и сохраните маршрут');return;}
    const m=route, stops=list.slice(), todayIds=new Set(planIds()||[]);
    const positions=new Map((planIds()||[]).map((id,i)=>[id,i]));
    let sequence=stops.slice().sort((a,b)=>(positions.get(a.id)??Infinity)-(positions.get(b.id)??Infinity));
    const checked=new Set(todayIds);
    const c=emptyModal('Рейс водителю · '+rName(m));
    element('p','Отметьте только точки этого рейса. Порядок можно поменять до отправки. После создания ссылки список в ней не меняется.',c);
    const date=element('input','',c); date.type='date';date.value=today();date.setAttribute('aria-label','Дата рейса');
    const bar=element('div','',c);bar.className='row';
    const rows=element('div','',c);
    function redraw(){
      rows.replaceChildren();
      sequence.forEach((s,i)=>{
        const row=element('div','',rows);row.className='phrow';
        const lbl=element('label','',row);const input=element('input','',lbl);
        input.type='checkbox';input.checked=checked.has(s.id);
        input.onchange=()=>{if(input.checked)checked.add(s.id);else checked.delete(s.id);make.disabled=!checked.size;make.textContent='Создать ссылку · '+checked.size;};
        lbl.append(' '+s.name+(s.addr?' · '+s.addr:''));
        const controls=element('div','',row);
        for(const [label,d] of [['Выше',-1],['Ниже',1]]){
          const b=button(label,controls,()=>{[sequence[i],sequence[i+d]]=[sequence[i+d],sequence[i]];redraw();});
          b.setAttribute('aria-label',s.name+' '+label.toLowerCase());
          b.disabled=i+d<0||i+d>=sequence.length;
        }
      });
      make.disabled=!checked.size;make.textContent='Создать ссылку · '+checked.size;
    }
    button('Отметить все',bar,()=>{stops.forEach(s=>checked.add(s.id));redraw()});
    button('Снять отметки',bar,()=>{checked.clear();redraw()});
    const report=element('p','',c);report.setAttribute('role','status');
    const make=button('Создать ссылку',c,async()=>{
      make.disabled=true;report.textContent='Создаю рейс…';
      try{
        const data=await api('dispatch',json('POST',{route:m,date:date.value,ids:sequence.filter(s=>checked.has(s.id)).map(s=>s.id)}));
        const url=new URL('./driver.html',location.href);url.hash='t='+encodeURIComponent(data.token);
        const item={id:data.id,route:m,date:date.value,expires:data.expires,count:data.count};
        LS.set('kmz_recent_dispatches',JSON.stringify([item,...recent()].slice(0,15)));
        rows.querySelectorAll('input,button').forEach(x=>x.disabled=true);bar.querySelectorAll('button').forEach(x=>x.disabled=true);date.disabled=true;
        report.replaceChildren();element('b','Рейс готов · '+data.count+' точек',report);
        element('p','Ссылка действует до '+new Date(data.expires).toLocaleString('ru-RU')+'. Отправляйте только нужному водителю.',report);
        const field=element('input','',report);field.value=url.href;field.readOnly=true;field.setAttribute('aria-label','Ссылка водителю');field.style.width='100%';
        button('Копировать ссылку',report,async()=>{try{await navigator.clipboard.writeText(url.href);toast('Ссылка скопирована')}catch{field.focus();field.select();toast('Скопируйте выделенную ссылку')}});
        if(navigator.share)button('Поделиться',report,()=>navigator.share({title:'Рейс КМЗ №1',url:url.href}).catch(()=>{}));
        button('Посмотреть как водитель',report,()=>window.open(url.href,'_blank','noopener,noreferrer'));
        button('Новый рейс',report,()=>openDispatch());
      }catch(e){report.textContent=e.message;make.disabled=false;}
    });
    redraw();
    const prev=recent().filter(x=>x.route===m&&x.expires>Date.now());
    if(prev.length)element('h3','Недавние рейсы на этом устройстве',c);
    prev.forEach(item=>{
      const line=element('div','',c);line.className='phrow';
      const name=element('span',item.date+' · '+item.count+' точек',line);
      let statusList;
      button('Статусы',line,async()=>{try{
        const data=await api('dispatch?id='+encodeURIComponent(item.id));
        if(data.revoked){name.textContent='Ссылка отозвана';return}
        statusList?.remove(); const box=statusList=element('ol','',line); data.rows.forEach(row=>element('li',row.name+' · '+(row.status?.state==='done'?'сдано':row.status?.state==='failed'?'не сдано'+(row.status.reason?' ('+row.status.reason+')':''):'нет отметки'),box));
      }catch(e){toast(e.message)}});
      button('Отозвать',line,async()=>{
        if(!confirm('Выключить эту ссылку на рейс? Водитель больше не сможет её открыть.'))return;
        try{await api('dispatch?id='+encodeURIComponent(item.id),{method:'DELETE'});LS.set('kmz_recent_dispatches',JSON.stringify(recent().filter(x=>x.id!==item.id)));line.remove();}
        catch(e){toast(e.message)}
      });
    });
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
