import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';
const ctx={window:{}};
runInNewContext(await readFile(new URL('./plan-import.js',import.meta.url),'utf8'),ctx);
const p=ctx.window.KMZPlan;
const stops=[{id:'a',name:'Кутявина · Тепличная',addr:'Тепличная 1'},{id:'b',name:'Кутявина · Соловьёва',addr:'Краеведа Соловьёва 15'},{id:'c',name:'Щёлокова',addr:'Никольская 20/1'}];
const states=rows=>JSON.stringify(p.match(p.parse(rows),stops).map(x=>[x.state,x.stop?.id||null]));
assert.equal(states('1. Щелокова\r\n2) Кутявина 15\nЩёлокова'),'[["found","c"],["found","b"],["duplicate","c"]]');
assert.equal(states('Кутявина\nОчерет\nКутявина 20'),'[["ambiguous",null],["missing",null],["missing",null]]');
assert.equal(states('• Кутявина · Тепличная\n- Кутявина Соловьёва'),'[["found","a"],["found","b"]]');
const matched=p.match(p.parse('Щёлокова\nКутявина Тепличная\nЩёлокова'),stops)
  .filter(row=>row.state==='found').map(row=>row.stop);
const ids=rows=>Array.from(rows,stop=>stop.id);
assert.deepEqual(ids(p.orderImportedStops('2',stops,matched)),['a','c']);
assert.deepEqual(ids(p.orderImportedStops('2',[stops[2],stops[1],stops[0]],matched)),['c','a']);
assert.deepEqual(ids(p.orderImportedStops('2',stops,[])),[]);
for(const route of ['1','3','4','5','6']) assert.deepEqual(ids(p.orderImportedStops(route,stops,matched)),['c','a']);
console.log('Plan import: route order, subset, duplicates and other routes PASS');

