(function () {
  'use strict';
  var el=function(id){return document.getElementById(id);}, timer, busy=false, loaded=false, active=false;
  async function api(action,body) {
    var response=await fetch('/api/local-console/dev-sync/'+action,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Authorization:'Bearer '+(sessionStorage.getItem('localConsoleToken')||'')},...(body?{body:JSON.stringify(body)}:{})});
    var data=await response.json(); if(!response.ok) throw new Error(data.error||'请求失败'); return data;
  }
  function controls(running) {
    ['syncStart','syncSave','syncTest','syncReconcile'].forEach(function(id){el(id).disabled=busy||running;});
  }
  function draw(data) {
    active=data.running;
    el('syncOrigin').value=data.origin;
    if(!loaded) {el('syncProxy').value=data.proxy;el('syncUser').value=data.username;loaded=true;}
    el('syncSaved').textContent='管理员密码：'+(data.hasPassword?'已保存':'未保存')+'；Vercel Secret：'+(data.hasBypass?'已保存':'未保存');
    controls(data.running);
    el('syncResults').replaceChildren();
    var labels={pending:'未执行',reading:'读取中',failed:'失败（未发送发布）',unknown:'结果待核对',success:'成功'};
    ((data.job||{}).items||[]).forEach(function(item){var li=document.createElement('li');li.textContent=item.name+' · '+labels[item.state]+' · '+item.message+(item.count?'（'+item.count+' 条）':'');el('syncResults').append(li);});
    clearTimeout(timer);
    if(data.running) {el('syncStatus').textContent='正在同步，关闭或刷新页面不会重复发布。';timer=setTimeout(refresh,1500);}
    else if(data.job) el('syncStatus').textContent='本次任务已结束，请查看各模块结果。未执行的模块不会自动补发。';
  }
  async function refresh() {
    try {draw(await api('status'));} catch(e) {el('syncStatus').textContent=e.message+'。点击“刷新进度”，不要重复点击同步。';}
  }
  async function run(fn) {
    if(busy)return;busy=true;controls(false);
    try {await fn();} catch(e){el('syncStatus').textContent=e.message+'；未自动重试。';}
    finally {busy=false;controls(active);}
  }
  el('syncSettingsForm').onsubmit=function(e){e.preventDefault();run(async function(){
    var input={origin:el('syncOrigin').value,proxy:el('syncProxy').value,username:el('syncUser').value,password:el('syncPassword').value,bypass:el('syncBypass').value,storeSecrets:el('syncConsent').checked,clearpassword:el('syncClearPassword').checked,clearbypass:el('syncClearBypass').checked};
    var data=await api('settings',input);
    el('syncPassword').value='';el('syncBypass').value='';el('syncConsent').checked=false;el('syncClearPassword').checked=false;el('syncClearBypass').checked=false;
    draw(data);el('syncStatus').textContent='配置已保存。可先验证连接，再同步。';
  });};
  el('syncTest').onclick=function(){run(async function(){el('syncStatus').textContent='正在验证连接…';var d=await api('test',{});el('syncStatus').textContent=d.message;});};
  el('syncStart').onclick=function(){run(async function(){
    var modules=Array.from(document.querySelectorAll('[name="syncModule"]:checked')).map(function(x){return x.value;});
    draw(await api('start',{modules:modules,confirm:'sync:dev'}));
  });};
  el('syncRefresh').onclick=refresh;
  el('syncReconcile').onclick=function(){run(async function(){draw(await api('reconcile',{}));});};
  var observer=new MutationObserver(function(){if(!el('consoleApp').hidden)refresh();else {clearTimeout(timer);loaded=false;el('syncPassword').value='';el('syncBypass').value='';}});
  observer.observe(el('consoleApp'),{attributes:true,attributeFilter:['hidden']});
  if(!el('consoleApp').hidden)refresh();
})();
