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
console.log('Plan import: order, aliases, ambiguity, unmatched, duplicates PASS');

