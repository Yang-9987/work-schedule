const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createReader, parsePage } = require('../shared/paged-read.cjs');
const moduleData = { id: 'school-calendar', source: {}, mappings: [{source:'事件'}] };
const rows = count => Array.from({length: count}, (_, i) => ({record_id: 'mock-' + i, values: {事件:'事件 ' + i}}));
function fixture(count, options = {}) {
  let finished = 0, calls = 0;
  const data = rows(count);
  const reader = createReader({
    inspect: () => ({total: count, fields:['事件']}),
    read: async (_, cursor, limit) => {
      calls++;
      const offset = Number(cursor || 0), end = Math.min(offset + limit, count);
      return {errcode:0, records:data.slice(offset, end), next_cursor: end < count ? String(end) : ''};
    },
    finish: (_, result, proof) => { finished++; assert.equal(result.length, count); assert.equal(proof.verifiedPasses, 2); return {rowCount:result.length}; },
    ...options
  });
  return { reader, start: () => reader.start('owner', moduleData), finished: () => finished, calls: () => calls };
}
async function drain(f, job) {
  for (let i=0; ['reading','verifying'].includes(job.state) && i<250; i++) job = await f.reader.next('owner', job.task, job.sequence);
  return job;
}
for (const count of [0,1,199,200,201,400,450,1000]) test('two-pass full read: ' + count, async () => {
  const f=fixture(count), job=await drain(f,f.start());
  assert.equal(job.state,'ready'); assert.equal(f.finished(),1);
  assert.equal(f.calls(),2*Math.max(1,Math.ceil(count/200)));
});
test('strict terminal signals and malformed rows', () => {
  for (const payload of [{records:[]},{records:[],has_more:true},{records:[],has_more:false,next_cursor:'x'},
    {records:{},next_cursor:''},{records:[{values:{}}],next_cursor:''},{errcode:4,records:[],next_cursor:''},
    {records:[],next_cursor:'x'},{records:[],next_cursor:42}]) assert.throws(()=>parsePage(payload,['事件'],200));
  assert.deepEqual(parsePage({errcode:0,has_more:false},['事件'],200).entries,[]);
  assert.deepEqual(parsePage({errcode:0,records:[{record_id:'blank'}],next_cursor:''},['事件'],200).entries,[['blank',{'事件':''}]]);
});
test('CLI omitted terminal fields require success, explicit total and complete accumulation', () => {
  const terminal={errcode:0,total:5,records:rows(1)};
  assert.equal(parsePage(terminal,['事件'],2,{total:5,count:4}).done,true);
  for(const progress of [{},{total:5,count:2},{total:6,count:5}]) assert.throws(()=>parsePage(terminal,['事件'],2,progress));
  assert.throws(()=>parsePage({...terminal,total:undefined},['事件'],2,{total:5,count:4}));
  assert.throws(()=>parsePage({...terminal,errcode:undefined},['事件'],2,{total:5,count:4}));
});
test('double click, repeated request and ownership', async () => {
  let resolve;
  const f=fixture(1,{read:()=>new Promise(r=>{resolve=r;})});
  const start=f.start();
  assert.throws(()=>f.reader.status('other',start.task));
  const pending=f.reader.next('owner',start.task,0);
  assert.equal((await f.reader.next('owner',start.task,0)).busy,true);
  resolve({records:rows(1),next_cursor:''});
  const done=await pending;
  assert.equal(done.sequence,1);
  assert.equal((await f.reader.next('owner',start.task,0)).sequence,1);
});
test('cancelled in-flight data never finishes', async () => {
  let resolve; const f=fixture(1,{read:()=>new Promise(r=>{resolve=r;})});
  const job=f.start(), pending=f.reader.next('owner',job.task,0);
  f.reader.cancel('owner',job.task);
  resolve({records:rows(1),next_cursor:''});
  assert.equal((await pending).state,'cancelled'); assert.equal(f.finished(),0);
});
test('failure, duplicate records, repeated cursor, count and content changes block finish', async () => {
  for (const mode of ['timeout','duplicate','cursor','count','content','schema','missing-total']) {
    let calls=0, inspections=0;
    const f=fixture(2,{
      inspect:()=>({total: mode==='missing-total'?null:mode==='count'&&inspections++?3:2,fields:mode==='schema'&&inspections++?['changed']:['事件']}),
      read:async()=>{
        calls++;
        if(mode==='timeout')throw new Error('timeout');
        if(mode==='duplicate')return {records:[rows(1)[0],rows(1)[0]],next_cursor:''};
        if(mode==='cursor')return {records:[{record_id:'mock-'+calls,values:{事件:'a'}}],next_cursor:'same'};
        const data=rows(2);if(mode==='content'&&calls>1)data[0].values.事件='changed';
        return {records:data,next_cursor:''};
      }
    });
    if(mode==='missing-total') assert.throws(()=>f.start());
    else assert.equal((await drain(f,f.start())).state,'failed',mode);
    assert.equal(f.finished(),0);
  }
});
test('expiry and resource limits', async () => {
  let time=0;const f=fixture(1,{now:()=>time,ttl:5});const job=f.start();time=6;
  assert.throws(()=>f.reader.status('owner',job.task));
  for (const options of [{maxBytes:1},{maxPages:1}]) {
    const limited=fixture(201,options);assert.equal((await drain(limited,limited.start())).state,'failed');
  }
  assert.throws(()=>fixture(201,{maxRows:200}).start());
});
test('many selected columns reduce request limit below 200', async () => {
  const f=fixture(0,{read:async(_,cursor,limit)=>{assert.equal(limit,99);return {records:[],next_cursor:''};}});
  const module={...moduleData,mappings:Array.from({length:100},(_,i)=>({source:'field-'+i}))};
  assert.equal((await drain(f,f.reader.start('owner',module))).state,'ready');
});
test('new task revokes older work for same module', async () => {
  const f=fixture(2), old=f.start();f.start();
  assert.equal(f.reader.status('owner',old.task).state,'cancelled');
});
test('full calendar keeps multiline events beyond the first 200 source rows', async () => {
  const model = require('../shared/module-mapping-model.cjs');
  const preview = require('../shared/preview-model.cjs');
  const module = model.cloneSeed().modules.find(item => item.id === 'school-calendar');
  let result;
  const reader = createReader({
    inspect:()=>({total:201,fields:['日期','事件']}),
    read:async(_,cursor,limit)=>{
      const start=Number(cursor||0),end=Math.min(start+limit,201);
      return {records:Array.from({length:end-start},(_,i)=>({record_id:'synthetic-'+(start+i),values:{日期:'2026-09-01',事件:'1. 上午事项 '+(start+i)+'\n2. 下午事项 '+(start+i)}})),next_cursor:end<201?String(end):''};
    },
    finish:(module,rows)=>{result=preview.pageData(module,rows);return {rowCount:result.data.events.length};}
  });
  const job=await drain({reader},reader.start('owner',module));
  assert.equal(job.state,'ready');assert.equal(result.data.events.length,402);
  assert(result.data.events.some(event=>event.title==='下午事项 200'));
});
test('preview validation failure does not mark data ready', async () => {
  const f=fixture(1,{finish:()=>{throw new Error('invalid preview');}});
  assert.equal((await drain(f,f.start())).state,'failed');
});
