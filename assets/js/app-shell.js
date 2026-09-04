(function () {
  var day = document.getElementById("todayDay");
  if (!day) return;
  var now = new Date();
  var weeks = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
  document.getElementById("todayMonth").textContent = (now.getMonth() + 1) + "月";
  day.textContent = String(now.getDate()).padStart(2, "0");
  document.getElementById("todayWeek").textContent = weeks[now.getDay()];
})();
