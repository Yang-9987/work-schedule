(function (root, factory) {
  var api=factory();
  if(typeof module==='object' && module.exports) module.exports=api;
  else root.ReleaseVersionLabel=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function dateOf(version,savedAt) {
    var date=new Date(savedAt || Number(String(version||'').split('-')[0]));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  function format(version,savedAt,moduleName,index) {
    var date=dateOf(version,savedAt);
    var time=date ? new Intl.DateTimeFormat('zh-CN',{year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(date) : '时间未知';
    var order=index===0?'最近更新前':'更早备份 '+(index+1);
    return (moduleName||'数据')+' · '+time+' · '+order;
  }
  return {format:format};
});
