(function () {
  'use strict';
  var module, targets=[], token='', cursor='', busy=false;
  var el = function(id) { return document.getElementById(id); };
  var dialog=el('releaseDialog');
  function environment() { return el('releaseEnvironment').value; }
  function target() { return targets.find(function(t){return t.environment===environment();}) || {}; }
  function controls() {
    el('releaseTarget').textContent = (target().origin || '未配置目标地址') + (target().writable ? '' : ' · 发布/回退已锁定');
    el('releasePublish').disabled = busy || !token || !target().writable;
    el('releaseLogin').disabled = busy || !target().origin;
    el('releaseEnvironment').disabled=busy;
    el('releaseClose').disabled=busy;
  }
  async function api(action, extra) {
    var r=await fetch('/api/local-console/releases/'+action,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+(sessionStorage.getItem('localConsoleToken')||'')},body:JSON.stringify(Object.assign({environment:environment(),moduleId:module.id,token:token},extra))});
    var b=await r.json(); if(!r.ok) throw new Error(b.error||'操作失败'); return b;
  }
  async function run(fn) {
    if(busy)return; busy=true;controls();el('releaseStatus').textContent='处理中…';
    try {await fn();} catch(e){el('releaseStatus').textContent=e.message+'；未自动重试。网络中断时请先核对目标数据再操作。';}
    finally {busy=false;controls();}
  }
  async function history(append) {
    var b=await api('history',{cursor:append?cursor:''});
    if(!append)el('releaseVersions').replaceChildren();
    (b.versions||[]).forEach(function(v){
      var row=document.createElement('p'), button=document.createElement('button');
      row.textContent=v.version+' ';button.textContent='回退到此版本';button.type='button';button.disabled=!target().writable;
      button.onclick=function(){if(busy)return;run(async function(){
        if(!confirm('将 '+environment()+' 的 '+module.name+' 回退到 '+v.version+'？当前数据会先备份。')){el('releaseStatus').textContent='已取消';return;}
        await api('rollback',{version:v.version,confirm:environment()+':'+module.id+':rollback'});await history(false);el('releaseStatus').textContent='回退成功。';
      });};row.append(button);el('releaseVersions').append(row);
    });
    cursor=b.cursor||'';el('releaseMore').hidden=!b.hasMore;
    if(!(b.versions||[]).length&&!append)el('releaseVersions').textContent='暂无备份。首次发布后，再次更新时会备份旧数据。';
  }
  window.addEventListener('open-release',function(event){
    module=event.detail;token='';el('releasePassword').value='';el('releaseEnvironment').value='dev';el('releaseModule').textContent=module.name+' · '+module.route;el('releaseVersions').replaceChildren();el('releaseMore').hidden=true;dialog.showModal();
    run(async function(){var r=await fetch('/api/local-console/releases/targets',{headers:{Authorization:'Bearer '+(sessionStorage.getItem('localConsoleToken')||'')}});var b=await r.json();if(!r.ok)throw new Error(b.error);targets=b.targets;el('releaseStatus').textContent='先核对目标环境，再验证目标网站管理员。';});
  });
  el('releaseEnvironment').onchange=function(){token='';cursor='';el('releasePassword').value='';el('releaseVersions').replaceChildren();el('releaseMore').hidden=true;controls();el('releaseStatus').textContent='环境已切换，请重新验证。';};
  el('releaseLogin').onclick=function(){run(async function(){
    var password=el('releasePassword').value;el('releasePassword').value='';
    token='';var b=await api('login',{username:el('releaseUser').value,password:password});token=b.token;await history(false);el('releaseStatus').textContent='验证成功，请先确认预览内容。';
  });};
  el('releasePublish').onclick=function(){run(async function(){
    if(!confirm('将 '+module.name+' 最近的预览数据发布到 '+environment()+'（'+target().origin+'）？')){el('releaseStatus').textContent='已取消';return;}
    var b=await api('publish',{module:module,confirm:environment()+':'+module.id+':publish'});await history(false);el('releaseStatus').textContent='数据发布成功。'+(b.backupVersion?'旧版本已备份。':'首次发布，没有旧版本。');
  });};
  el('releaseMore').onclick=function(){run(async function(){await history(true);el('releaseStatus').textContent='版本已加载';});};
  dialog.addEventListener('cancel',function(e){if(busy)e.preventDefault();});
  dialog.addEventListener('close',function(){token='';el('releasePassword').value='';});
  el('releaseClose').onclick=function(){dialog.close();};
})();
