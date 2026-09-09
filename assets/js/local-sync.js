(function () {
  'use strict';
  var el=function(id){return document.getElementById(id);}, timer, busy=false, loadedEnvironment='', active=false;
  function environment(){return el('syncEnvironment').value;}
  function copy() {
    var main=environment()==='main', name=main?'Production · 正式环境':'dev · 测试环境';
    el('syncEnvironmentLabel').textContent=name;
    el('syncEnvironmentLabel').classList.toggle('production',main);
    el('syncDescription').textContent=main
      ? '使用已保存的字段映射，完整读取、双遍核对后更新正式网站，并自动保留旧版本。请暂勿编辑源表。'
      : '使用已保存的字段映射，完整读取、双遍核对后更新测试网站。不会发布到 Production。请暂勿编辑源表。';
    el('syncStart').textContent=main?'一键同步到 Production':'一键同步到 dev';
    el('syncStart').classList.toggle('production',main);
    el('syncSettingsTitle').textContent=(main?'Production':'dev')+' 同步设置（首次配置）';
    el('syncOriginLabel').textContent=main?'正式地址':'测试地址';
    el('syncUserLabel').textContent=(main?'Production':'dev')+' 管理员账号';
    el('syncPasswordLabel').textContent=(main?'Production':'dev')+' 管理员密码';
  }
  async function api(action,body,requestedEnvironment) {
    var target=requestedEnvironment||environment();
    var response=await fetch('/api/local-console/sync/'+target+'/'+action,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Authorization:'Bearer '+(sessionStorage.getItem('localConsoleToken')||'')},...(body?{body:JSON.stringify(body)}:{})});
    var data=await response.json(); if(!response.ok) throw new Error(data.error||'请求失败'); return data;
  }
  function controls(running) {
    ['syncStart','syncSave','syncTest','syncReconcile'].forEach(function(id){el(id).disabled=busy||running;});
    el('syncEnvironment').disabled=busy||running;
  }
  function draw(data) {
    if(data.environment!==environment()) return;
    active=data.running;
    el('syncOrigin').value=data.origin;
    if(loadedEnvironment!==data.environment) {
      el('syncProxy').value=data.proxy;el('syncUser').value=data.username;loadedEnvironment=data.environment;
    }
    el('syncSaved').textContent='管理员密码：'+(data.hasPassword?'已保存':'未保存')+'；Vercel Secret：'+(data.hasBypass?'已保存':'未保存');
    controls(data.running);
    el('syncResults').replaceChildren();
    var labels={pending:'未执行',reading:'读取中',failed:'失败（未发送发布）',unknown:'结果待核对',success:'成功'};
    ((data.job||{}).items||[]).forEach(function(item){var li=document.createElement('li');li.textContent=item.name+' · '+labels[item.state]+' · '+item.message+(item.count?'（'+item.count+' 条）':'');el('syncResults').append(li);});
    clearTimeout(timer);
    if(data.running) {el('syncStatus').textContent='正在同步，关闭或刷新页面不会重复发布。';timer=setTimeout(refresh,1500);}
    else if(data.job) el('syncStatus').textContent='本次任务已结束，请查看各模块结果。未执行的模块不会自动补发。';
    else el('syncStatus').textContent='首次使用请展开设置，保存管理员密码后验证连接。';
  }
  async function refresh() {
    var target=environment();
    try {draw(await api('status',null,target));} catch(e) {if(target===environment())el('syncStatus').textContent=e.message+'。点击“刷新进度”，不要重复点击同步。';}
  }
  async function run(fn) {
    if(busy)return;busy=true;controls(false);
    try {await fn();} catch(e){el('syncStatus').textContent=e.message+'；未自动重试。';}
    finally {busy=false;controls(active);}
  }
  el('syncEnvironment').onchange=function(){
    clearTimeout(timer);active=false;loadedEnvironment='';
    el('syncPassword').value='';el('syncBypass').value='';el('syncResults').replaceChildren();
    copy();el('syncStatus').textContent='正在读取该环境的独立配置…';refresh();
  };
  el('syncSettingsForm').onsubmit=function(e){e.preventDefault();run(async function(){
    var input={origin:el('syncOrigin').value,proxy:el('syncProxy').value,username:el('syncUser').value,password:el('syncPassword').value,bypass:el('syncBypass').value,storeSecrets:el('syncConsent').checked,clearpassword:el('syncClearPassword').checked,clearbypass:el('syncClearBypass').checked};
    var data=await api('settings',input);
    el('syncPassword').value='';el('syncBypass').value='';el('syncConsent').checked=false;el('syncClearPassword').checked=false;el('syncClearBypass').checked=false;
    draw(data);el('syncStatus').textContent='配置已保存。可先验证连接，再同步。';
  });};
  el('syncTest').onclick=function(){run(async function(){el('syncStatus').textContent='正在验证连接…';var d=await api('test',{});el('syncStatus').textContent=d.message;});};
  el('syncStart').onclick=function(){run(async function(){
    var target=environment();
    var modules=Array.from(document.querySelectorAll('[name="syncModule"]:checked')).map(function(x){return x.value;});
    if(target==='main'&&!confirm('将所选模块同步到正式网站？系统会先完整读取两遍，并为当前正式数据保留可回退备份。')){el('syncStatus').textContent='已取消正式环境同步。';return;}
    draw(await api('start',{modules:modules,confirm:'sync:'+target},target));
  });};
  el('syncRefresh').onclick=refresh;
  el('syncReconcile').onclick=function(){run(async function(){draw(await api('reconcile',{}));});};
  var observer=new MutationObserver(function(){if(!el('consoleApp').hidden){copy();refresh();}else {clearTimeout(timer);loadedEnvironment='';el('syncPassword').value='';el('syncBypass').value='';}});
  observer.observe(el('consoleApp'),{attributes:true,attributeFilter:['hidden']});
  copy();if(!el('consoleApp').hidden)refresh();
})();
