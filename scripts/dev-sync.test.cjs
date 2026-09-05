const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createSync,ORIGIN,hash}=require('../shared/dev-sync.cjs');
const client=require('../shared/release-client.cjs');
function fixture(t,{failure=false,readFailure=false}={}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'school-dev-sync-test-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const ids=['school-calendar','work-schedule','duty-roster'];
  const modules=ids.map(id=>({id,name:id,source:{documentUrl:'https://doc.weixin.qq.com/smartsheet/test-only',sheet:'sheet'}}));
  const previews=new Map(), written={}, calls=[];let taskModule,run;
  const request=async(url,options)=>{
    calls.push({url,options}); const route=new URL(url).pathname;
    if(route==='/api/auth') return Response.json({ok:true,token:'synthetic-admin-token'});
    if(route==='/api/releases' && !options.method) return Response.json({versions:[]});
    if(route==='/api/releases') {
      const body=JSON.parse(options.body);assert.equal(body.expectedEnvironment,'dev');written[body.moduleId]=body.data;
      if(failure) throw new Error('fetch failed');
      return Response.json({ok:true});
    }
    const id={'/api/calendar':'school-calendar','/api/config':'work-schedule','/api/duty-roster':'duty-roster'}[route];
    return Response.json(id==='duty-roster'?{data:written[id]}:written[id]);
  };
  const deps={dir,previews,loadMappings:()=>({modules}),request,schedule:fn=>{run=fn;},reader:{
    start(owner,m){taskModule=m;return {task:m.id,state:'reading',sequence:0};},
    async next(owner){
      if(readFailure) return {state:'failed',error:'synthetic read failed'};
      previews.set(taskModule.id,{mappingFingerprint:client.fingerprint(taskModule),sourceRowCount:2,complete:true,verifiedPasses:2,owner,issues:[],rowCount:2,data:{sample:taskModule.id}});
      return {state:'ready',result:{rowCount:2},readCount:2,total:2,pass:2};
    }
  }};
  const sync=createSync(deps);
  sync.save({origin:ORIGIN,proxy:'',username:'admin',password:'synthetic-password',bypass:'synthetic-bypass',storeSecrets:true});
  return {sync,dir,calls,written,ids,deps,run:()=>run()};
}
test('settings restrict origin/proxy and never return stored secrets',t=>{
  const {sync,dir}=fixture(t);
  assert.throws(()=>sync.save({origin:'https://evil.example',proxy:''}));
  assert.throws(()=>sync.save({origin:ORIGIN,proxy:'http://remote.example:7897'}));
  assert.throws(()=>sync.save({origin:ORIGIN,proxy:'',password:'changed'}));
  assert(!JSON.stringify(sync.status()).includes('synthetic-password'));
  assert(!JSON.stringify(sync.status()).includes('synthetic-bypass'));
  assert.equal(fs.statSync(path.join(dir,'dev-sync-config.json')).mode & 0o777,0o600);
  sync.save({origin:ORIGIN,proxy:'',clearpassword:true,clearbypass:true});
  assert.equal(sync.status().hasPassword,false);
});
test('one click processes all modules, verifies each, locks concurrent start',async t=>{
  const f=fixture(t);f.sync.start('owner',f.ids);
  assert.throws(()=>f.sync.start('owner',f.ids));
  assert.throws(()=>f.sync.save({origin:ORIGIN}));
  await f.run();
  assert(f.sync.status().job.items.every(i=>i.state==='success'));
  assert.equal(f.calls.filter(c=>c.url.endsWith('/api/releases')&&c.options.method==='POST').length,3);
  assert(f.calls.every(c=>c.url.startsWith(ORIGIN+'/api/')&&c.options.redirect==='manual'));
  assert(f.calls.every(c=>c.options.headers.get('x-vercel-protection-bypass')==='synthetic-bypass'));
});
test('lost publish response blocks retry and only read-only reconciliation clears it',async t=>{
  const f=fixture(t,{failure:true});f.sync.start('owner',f.ids);await f.run();
  assert.equal(f.sync.status().job.items[0].state,'unknown');
  assert.equal(f.sync.status().job.items[1].state,'pending');
  assert.throws(()=>f.sync.start('owner',f.ids));
  const resumed=createSync(f.deps);assert.throws(()=>resumed.start('owner',f.ids));
  const before=f.calls.length;await resumed.reconcile();
  assert.equal(resumed.status().job.items[0].state,'success');
  assert(f.calls.slice(before).every(c=>!c.options.method));
});
test('read failures never publish and do not claim success',async t=>{
  const f=fixture(t,{readFailure:true});f.sync.start('owner',f.ids);await f.run();
  assert(f.sync.status().job.items.every(i=>i.state==='failed'));
  assert.equal(Object.keys(f.written).length,0);
});
test('restart during sending remains unknown; hashes are key-order independent',t=>{
  const f=fixture(t);const file=path.join(f.dir,'dev-sync-state.json');
  fs.writeFileSync(file,JSON.stringify({running:true,items:[{id:'school-calendar',state:'unknown',hash:'test'}]}));
  const resumed=createSync(f.deps);assert.equal(resumed.status().job.items[0].state,'unknown');
  assert.throws(()=>resumed.start('owner',f.ids));
  assert.equal(hash({a:1,b:2}),hash({b:2,a:1}));
});
test('redirects never forward credentials and fail with actionable error',async t=>{
  const f=fixture(t);
  const s=createSync({...f.deps,request:async()=>new Response(null,{status:302,headers:{location:'https://elsewhere.example'}})});
  await assert.rejects(s.test(),/Vercel/);
});
