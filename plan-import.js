/* Plan import for verified route lists. No external requests or writes until Save. */
(() => {
  const norm = v => String(v??'').toLocaleLowerCase('ru').replace(/ё/g,'е').replace(/[^a-zа-я0-9]+/g,' ').trim();
  const parse = v => String(v??'').split(/\r?\n/).map(r=>r.replace(/^\s*(?:\d+[.)]|[•*-])\s+/,'').trim()).filter(Boolean);
  function match(rows,stops){
    const used=new Set();
    return rows.map(row=>{
      const q=norm(row), word=q.split(' ').filter(Boolean);
      const byName=q?stops.filter(s=>norm(s.name)===q):[];
      const options=byName.length?byName:(word.length?stops.filter(s=>{
        const terms=new Set(norm([s.name,s.addr].join(' ')).split(' '));
        return word.every(w=>terms.has(w));
      }):[]);
      if(options.length!==1) return {row,state:options.length?'ambiguous':'missing',options};
      const stop=options[0],state=used.has(stop.id)?'duplicate':'found';
      used.add(stop.id);
      return {row,state,stop};
    });
  }
  window.KMZPlan={parse,match};
  function make(parent,tag,label){
    const e=document.createElement(tag);e.textContent=label;parent.append(e);return e;
  }
  function action(p,title,click){
    const b=make(p,'button',title);b.type='button';b.className='btn flat';b.addEventListener('click',click);return b;
  }
  window.openPlanImport=()=>{
    if(!admin||offline||dirty||loading||!['2','3'].includes(route)) {toast('Сначала откройте сохранённый маршрут 2 или 3');return;}
    const activeRoute=route, stops=list.slice(), originalPlan=plan;
    query='';const search=document.getElementById('search');if(search)search.value='';
    const c=document.getElementById('card');c.replaceChildren();
    make(c,'h2','Загрузить точки в «Сегодня» · '+rName(route));
    const l=make(c,'label','Точки из заявок, по одной в строке');l.htmlFor='plan-import-rows';
    const ta=make(c,'textarea','');ta.id=l.htmlFor;ta.rows=8;
    const fl=make(c,'label','Или выберите файл .txt (UTF‑8)');fl.htmlFor='plan-import-file';
    const file=make(c,'input','');file.id=fl.htmlFor;file.type='file';file.accept='.txt,text/plain';
    const message=make(c,'p','Предпросмотр ничего не меняет. Порядок строк сохраняется. Справочник не изменится.');message.setAttribute('role','status');
    const controls=make(c,'div','');controls.className='row';
    const result=make(c,'div','');
    let preview=null;
    const apply=action(controls,'Сохранить в «Сегодня»',async()=>{
      if(!preview||!admin||offline||dirty||loading||route!==activeRoute||plan!==originalPlan)return;
      const oldTab=tab; const oldPlan=plan; const ids=preview;
      apply.disabled=check.disabled=close.disabled=file.disabled=ta.disabled=true;
      plan={date:today(),ids};
      try{
        await push();tab='day';render();
        c.replaceChildren();make(c,'h2','План на сегодня сохранён');make(c,'p','Точек: '+ids.length+' · порядок из списка сохранён.');
        action(c,'Проверить рейс',()=>openDispatch({todayOnly:true}));action(c,'Закрыть',closeSheet);
      }catch(e){
        plan=oldPlan;tab=oldTab;dirty=false;render();
        message.textContent='Не сохранилось: '+e.message;
        check.disabled=close.disabled=file.disabled=ta.disabled=false;preview=null;
      }
    });
    const close=action(controls,'Закрыть',closeSheet);
    const clear=()=>{preview=null;apply.disabled=true;result.replaceChildren();};
    const check=action(controls,'Проверить список',()=>{
      clear();const rows=parse(ta.value);
      if(!rows.length||rows.length>100){message.textContent='Вставьте от 1 до 100 непустых строк.';return;}
      const checks=match(rows,stops);
      const ok=checks.filter(x=>x.state==='found');
      const errors=checks.filter(x=>x.state==='missing'||x.state==='ambiguous');
      const duplicates=checks.filter(x=>x.state==='duplicate');
      message.textContent='Совпало: '+ok.length+' · не определено: '+errors.length+' · повторов: '+duplicates.length+'.';
      if(originalPlan?.date===today()&&originalPlan.ids?.length)
        make(result,'p','Сохранение заменит текущий план ('+originalPlan.ids.length+' точек). Справочник не изменится.');
      const lines=make(result,'ol','');
      for(const x of checks){
        const title=x.state==='found'?x.stop.name:x.state==='duplicate'?x.row+' · повтор, не будет добавлен':x.state==='ambiguous'?x.row+' · уточните: '+x.options.map(s=>s.name+(s.addr?' ('+s.addr+')':'')).join(' / '):x.row+' · нет совпадения';
        make(lines,'li',title);
      }
      if(errors.length)make(result,'p','Исправьте строки с вопросами и нажмите «Проверить список» ещё раз. План пока не изменён.');
      if(ok.length&&!errors.length){preview=ok.map(x=>x.stop.id);apply.disabled=false;}
    });
    apply.disabled=true;
    ta.addEventListener('input',clear);
    file.addEventListener('change',async()=>{
      clear();const f=file.files?.[0];if(!f)return;
      if(f.size>128000||!/\.txt$/i.test(f.name)){file.value='';message.textContent='Нужен файл .txt до 128 КБ.';return;}
      try{
        const value=new TextDecoder('utf-8',{fatal:true}).decode(await f.arrayBuffer());
        if(file.files?.[0]!==f)return;
        ta.value=value;check.click();
      }catch{if(file.files?.[0]===f)message.textContent='Не удалось прочитать файл. Сохраните его в UTF‑8 или вставьте текст.';}
    });
    document.getElementById('sheet').classList.add('open');
  };
})();
