const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { fetch, ProxyAgent } = require('undici');
const client = require('./release-client.cjs');
const ORIGIN = 'https://work-schedule-git-dev-walters-projects-67325a53.vercel.app';
const MODULES = ['school-calendar', 'work-schedule', 'duty-roster'];
const ROUTES = {'school-calendar':'/api/calendar', 'work-schedule':'/api/config', 'duty-roster':'/api/duty-roster'};
function read(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch(e) { if(e.code === 'ENOENT') return null; throw new Error('本地同步配置无法读取'); } }
function write(file, value) {
  fs.mkdirSync(path.dirname(file), {recursive:true});
  const temp = file + '.' + crypto.randomUUID() + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), {mode:0o600, flag:'wx'});
  fs.renameSync(temp, file);
}
function canonical(value) {
  if(Array.isArray(value)) return value.map(canonical);
  if(value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
  return value;
}
const hash = value => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
function createSync({dir, reader, previews, loadMappings, request, schedule = setImmediate}) {
  const configFile = path.join(dir,'dev-sync-config.json'), journalFile = path.join(dir,'dev-sync-state.json');
  let job = read(journalFile), running = false;
  if(job?.running) {
    job.running = false;
    for(const item of job.items) if(!['success','failed','pending'].includes(item.state)) {
      item.state = item.hash ? 'unknown' : 'failed'; item.message = item.hash ? '服务重启，请核对目标数据' : '服务重启，尚未发送发布';
    }
    write(journalFile,job);
  }
  function config() { return read(configFile) || {origin:ORIGIN, proxy:'http://127.0.0.1:7897', username:'admin'}; }
  function status() {
    const c=config();
    return {origin:c.origin,proxy:c.proxy,username:c.username,hasPassword:!!c.password,hasBypass:!!c.bypass,
      job:job ? JSON.parse(JSON.stringify(job)) : null, running};
  }
  function save(input) {
    if(running) throw new Error('同步进行中，不能修改配置');
    if((input.password || input.bypass) && input.storeSecrets !== true) throw new Error('请确认允许在本机保存凭据');
    const c=config();
    if(input.origin !== ORIGIN) throw new Error('仅允许当前已批准的 dev 地址');
    const proxy = String(input.proxy || '').trim();
    if(proxy) {
      const u=new URL(proxy);
      if(u.protocol!=='http:' || !['127.0.0.1','localhost','[::1]'].includes(u.hostname) || u.username || u.password || u.pathname!=='/' || u.search || u.hash) throw new Error('代理必须是本机 HTTP 地址');
    }
    const next={origin:ORIGIN,proxy,username:String(input.username||'admin').trim()};
    if(!next.username || next.username.length>100) throw new Error('管理员账号无效');
    for(const key of ['password','bypass']) {
      const value=input[key];
      if(value!==undefined && (typeof value!=='string' || value.length>4096 || /[\r\n]/.test(value))) throw new Error('凭据格式无效');
      next[key]=input['clear'+key] ? '' : value || c[key] || '';
    }
    write(configFile,next); return status();
  }
  async function remote(endpoint, options={}, c=config()) {
    if(c.origin!==ORIGIN || !(/^\/api\/(auth|releases|calendar|config|duty-roster)(\?|$)/.test(endpoint))) throw new Error('目标地址不允许');
    const dispatcher=c.proxy ? new ProxyAgent(c.proxy) : undefined;
    try {
      const headers=new Headers(options.headers || {});
      if(c.bypass) headers.set('x-vercel-protection-bypass',c.bypass);
      const response=await (request || fetch)(c.origin+endpoint,{...options,headers,dispatcher,redirect:'manual',signal:AbortSignal.timeout(20000)});
      if(response.status>=300 && response.status<400) throw new Error('目标被 Vercel 登录保护拦截，请配置自动化访问 Secret');
      if(!(response.headers.get('content-type')||'').includes('application/json')) throw new Error('目标未返回 JSON，请检查 Vercel 访问保护配置');
      const body=await response.json();
      if(!response.ok) throw new Error(response.status===401 ? '目标管理员验证失败或登录已过期' : '目标接口失败（HTTP '+response.status+'），请核对配置或目标数据');
      return body;
    } catch(e) {
      if(/fetch failed|timeout|aborted/i.test(e.message)) throw new Error('连接目标失败或超时，请检查本机代理与网络；未自动重试');
      throw e;
    } finally { if(dispatcher) await dispatcher.close(); }
  }
  async function login(c) {
    if(!c.password) throw new Error('请先在 dev 同步设置中保存测试管理员密码');
    const body=await remote('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({adminUser:c.username,adminPass:c.password})},c);
    if(!body.ok || typeof body.token!=='string' || !body.token) throw new Error('管理员验证响应无效');
    return body.token;
  }
  const persist = () => write(journalFile,job);
  async function verify(item,c) {
    const body=await remote(ROUTES[item.id],{},c);
    const data=item.id==='duty-roster' ? body.data : body;
    if(!data || hash(data)!==item.hash) throw new Error('目标数据与本次内容尚不一致，禁止自动重发，请人工核对');
    item.state='success'; item.message='已读取目标并核对数据一致'; persist();
  }
  async function reconcile() {
    if(running) throw new Error('同步进行中');
    running=true;
    try { for(const item of job?.items || []) if(item.state==='unknown') {
      try { await verify(item,config()); } catch(e) { item.message=e.message; persist(); }
    } return status(); } finally {running=false;}
  }
  function start(owner, ids) {
    if(running) throw new Error('已有同步正在进行，请查看进度');
    if(job?.items.some(i=>i.state==='unknown')) throw new Error('上次发布结果待核对，请先核对结果，不可重复发布');
    if(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!MODULES.includes(id))) throw new Error('请选择要同步的模块');
    const set=loadMappings(), c=config();
    const modules=ids.map(id=>set.modules.find(m=>m.id===id));
    if(modules.some(m=>!m?.source.documentUrl || !m.source.sheet)) throw new Error('请先保存所选模块的表格地址、子表和字段映射');
    if(!c.password) throw new Error('请先配置测试管理员密码');
    running=true;
    job={id:crypto.randomUUID(),running:true,startedAt:new Date().toISOString(),items:modules.map(m=>({id:m.id,name:m.name,state:'pending',message:'等待同步'}))};
    try { persist(); } catch(e) {running=false;throw e;}
    schedule(async()=>{
      try {
        const token=await login(c);
        // Read-only environment check before reading any source table.
        const check=await remote('/api/releases?moduleId='+modules[0].id,{headers:{Authorization:'Bearer '+token}},c);
        if(!Array.isArray(check.versions)) throw new Error('目标发布接口尚未就绪');
        for(let n=0;n<modules.length;n++) {
          const module=modules[n], item=job.items[n];
          try {
            item.state='reading'; item.message='正在完整读取并双遍核对'; persist();
            const task=reader.start(owner,module); let current=task;
            while(['reading','verifying'].includes(current.state)) {
              current=await reader.next(owner,task.task,current.sequence);
              item.message=(current.pass===2?'复核':'读取')+' '+current.readCount+' / '+current.total+' 行'; persist();
            }
            if(current.state!=='ready') throw new Error(current.error || '完整读取未完成');
            const latest=loadMappings().modules.find(m=>m.id===module.id);
            if(client.fingerprint(latest)!==client.fingerprint(module)) throw new Error('映射发生变化，已停止该模块发布');
            const data=client.publishData(previews.get(module.id),module,owner);
            item.count=current.result.rowCount; item.hash=hash(data);
            // Persist uncertainty BEFORE making a write. A crash cannot permit blind retry.
            item.state='unknown'; item.message='正在发布，结果待核对'; persist();
            await remote('/api/releases',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({moduleId:module.id,action:'publish',data,confirm:module.id+':publish',expectedEnvironment:'dev'})},c);
            await verify(item,c);
          } catch(e) {
            if(item.state!=='unknown') item.state='failed';
            item.message=e.message; persist();
            if(item.state==='unknown') break;
          }
        }
      } catch(e) { for(const item of job.items) if(item.state==='pending') {item.state='failed';item.message=e.message;} }
      finally { job.running=false; running=false; persist(); }
    });
    return status();
  }
  return {status,save,start,reconcile,remote,active:()=>running,test:async()=>{await login(config());return {ok:true,message:'dev 管理员及网络连接验证通过'};}};
}
module.exports={createSync,hash,ORIGIN};
