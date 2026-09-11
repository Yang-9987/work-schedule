(function () {
  "use strict";
  var data = { schoolName: "首师附一小", academicYear: "2026—2027", events: [] };
  var viewDate = new Date();
  viewDate.setDate(1);
  var selectedDate = dateKey(viewDate.getFullYear(), viewDate.getMonth(), new Date().getDate());
  var loadError = "";
  var localPreview = new URLSearchParams(location.search).get("localPreview") === "1";
  function el(id) { return document.getElementById(id); }
  function pad(value) { return String(value).padStart(2, "0"); }
  function dateKey(y, m, d) { return y + "-" + pad(m + 1) + "-" + pad(d); }
  function safe(value) { return String(value || "").replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function render() {
    var y = viewDate.getFullYear(), m = viewDate.getMonth(), prefix = dateKey(y, m, 1).slice(0, 7);
    if (selectedDate.slice(0, 7) !== prefix) selectedDate = "";
    el("monthTitle").textContent = y + "年 " + (m + 1) + "月";
    var now = new Date(), todayKey = dateKey(now.getFullYear(), now.getMonth(), now.getDate());
    var plan = (data.monthlyPlans || []).find(function (p) { return p.month === prefix; });
    el('monthlyPlan').hidden = !plan;
    el('monthlyPlan').innerHTML = plan ? '<p class="eyebrow">月份及待定事项</p><h2>' + safe(plan.theme || '本月安排') + '</h2><ol>' + plan.items.map(function (item) { return '<li>' + safe(item.title) + (item.note && item.note.replace(/[，,。\s]/g, '') !== '具体日期待定以每周日程为准' ? '<p>' + safe(item.note) + '</p>' : '') + '</li>'; }).join('') + '</ol>' : '';
    el('calendarNotes').hidden = !(data.notes || []).length;
    el('calendarNotes').innerHTML = '<h2>校历说明</h2><ol>' + (data.notes || []).map(function (note) { return '<li>' + safe(note) + '</li>'; }).join('') + '</ol>';
    var byDate = {};
    CalendarText.displayEvents(data).forEach(function (item) { (byDate[item.date] || (byDate[item.date] = [])).push(item); });
    var first = (new Date(y, m, 1).getDay() + 6) % 7, days = new Date(y, m + 1, 0).getDate(), html = "";
    for (var i = 0; i < first; i++) html += '<div class="calendar-day is-empty" aria-hidden="true"></div>';
    for (var d = 1; d <= days; d++) {
      var key = dateKey(y, m, d), events = byDate[key] || [];
      var week = CalendarText.weekNumber(data.term, key);
      html += '<button type="button" data-date="' + key + '" aria-pressed="' + (key === selectedDate) + '" aria-label="' + key + '，' + events.length + '项事件" class="calendar-day' + (key === todayKey ? ' is-today' : '') + (key === selectedDate ? ' is-selected' : '') + '"><span class="calendar-day__number">' + d + '</span>' + (week && (d === 1 || (first + d - 1) % 7 === 0) ? '<span class="calendar-week">第' + week + '周</span>' : '') + '<span class="calendar-day__count">' + (events.length ? events.length + '项' : '') + '</span><span class="calendar-day__events">' + events.map(function (item) { return '<span class="calendar-chip">' + safe(item.title) + '</span>'; }).join("") + '</span></button>';
    }
    for (var tail = (first + days) % 7; tail > 0 && tail < 7; tail++) html += '<div class="calendar-day is-empty" aria-hidden="true"></div>';
    el("monthGrid").innerHTML = html;
    var list = Object.keys(byDate).flatMap(function (key) { return byDate[key]; }).filter(function (item) { return selectedDate ? item.date === selectedDate : item.date.slice(0, 7) === prefix; }).sort(function (a, b) { return a.date.localeCompare(b.date); });
    el("eventListTitle").textContent = selectedDate ? Number(selectedDate.slice(5, 7)) + "月" + Number(selectedDate.slice(8)) + "日" : "本月事件";
    el("showAllEvents").hidden = !selectedDate;
    el("eventCount").textContent = list.length + " 项";
    el("eventList").innerHTML = loadError ? '<p class="event-empty" role="status">' + safe(loadError) + '</p>' : list.length ? list.map(function (item) { return '<article class="event-item"><time class="event-item__date" datetime="' + safe(item.date) + '">' + safe(item.date.slice(8)) + '</time><div><h3>' + safe(item.title) + (!selectedDate ? '<small class="event-item__full-date">' + safe(item.date) + '</small>' : '') + '</h3>' + (item.note ? '<p>' + safe(item.note) + '</p>' : '') + '</div></article>'; }).join("") : '<p class="event-empty">' + (selectedDate ? "当天暂无事件。" : "本月暂无校历事项。") + '</p>';
  }
  el("monthGrid").addEventListener("click", function (event) {
    var button = event.target.closest("[data-date]");
    if (!button) return;
    selectedDate = button.dataset.date; render();
    if (window.matchMedia("(max-width:620px)").matches) el("eventPanel").scrollIntoView({ block: "start" });
  });
  el("showAllEvents").addEventListener("click", function () { selectedDate = ""; render(); });
  el("prevMonth").addEventListener("click", function () { viewDate.setMonth(viewDate.getMonth() - 1); render(); });
  el("nextMonth").addEventListener("click", function () { viewDate.setMonth(viewDate.getMonth() + 1); render(); });
  el("todayButton").addEventListener("click", function () { viewDate = new Date(); selectedDate = dateKey(viewDate.getFullYear(), viewDate.getMonth(), viewDate.getDate()); viewDate.setDate(1); render(); });
  render();
  el("calendarMode").textContent = localPreview ? "本地预览 · 数据尚未同步到线上" : "按日期查看校园安排";
  fetch(localPreview ? "/api/local-console/page-preview?moduleId=school-calendar&t=" + Date.now() : "/api/calendar?t=" + Date.now(), {
    headers: localPreview ? { Authorization: "Bearer " + (sessionStorage.getItem("localConsoleToken") || "") } : {}
  }).then(function (response) {
    if (response.status === 404 && !localPreview) return { events: [], academicYear: data.academicYear };
    if (!response.ok) throw new Error("无法读取校历");
    return response.json();
  }).then(function (body) {
    var loaded = localPreview ? body.preview && body.preview.data : body;
    if (!loaded || !Array.isArray(loaded.events)) throw new Error("校历数据格式异常");
    data = loaded;
    data.events = CalendarText.expand(data.events);
    el("calendarYear").textContent = (data.academicYear || "2026—2027") + " 学年" + (data.term ? " · " + data.term.name : "");
    render();
  }).catch(function () {
    loadError = localPreview ? "预览暂不可用，请重新生成预览后刷新。" : "校历暂时无法读取，请稍后刷新。";
    render();
  });
})();
