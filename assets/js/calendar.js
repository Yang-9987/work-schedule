(function () {
  "use strict";

  var DEFAULT_DATA = {
    schoolName: "首师附一小",
    academicYear: "2026—2027",
    events: [
      { id: "term-start", date: "2026-09-01", title: "新学期开学", type: "teaching", note: "正式上课" },
      { id: "teachers-day", date: "2026-09-10", title: "教师节", type: "activity", note: "主题教育活动" },
      { id: "national-day", date: "2026-10-01", title: "国庆节", type: "holiday", note: "放假安排以通知为准" }
    ]
  };
  var data = JSON.parse(JSON.stringify(DEFAULT_DATA));
  var viewDate = new Date();
  viewDate.setDate(1);
  var editing = false;
  var adminMode = location.pathname.indexOf('/admin/calendar') === 0;
  var selectedDate = "";
  var adminToken = sessionStorage.getItem("calendarAdminToken") || "";
  var localPreview = false;
  try { localPreview = new URLSearchParams(location.search).get("localPreview") === "1"; } catch (error) {}

  function pad(value) { return String(value).padStart(2, "0"); }
  function dateKey(year, month, day) { return year + "-" + pad(month + 1) + "-" + pad(day); }
  function monthEvents() {
    var prefix = viewDate.getFullYear() + "-" + pad(viewDate.getMonth() + 1) + "-";
    return data.events.filter(function (item) { return item.date.indexOf(prefix) === 0; })
      .sort(function (a, b) { return a.date.localeCompare(b.date); });
  }
  function safeText(value) {
    return String(value || "").replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
    });
  }
  function render() {
    var year = viewDate.getFullYear();
    var month = viewDate.getMonth();
    if (selectedDate && selectedDate.slice(0, 7) !== dateKey(year, month, 1).slice(0, 7)) selectedDate = "";
    document.getElementById("monthTitle").textContent = year + "年 " + (month + 1) + "月";
    var firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
    var days = new Date(year, month + 1, 0).getDate();
    var today = new Date();
    var todayKey = dateKey(today.getFullYear(), today.getMonth(), today.getDate());
    var eventsByDate = {};
    data.events.forEach(function (item) { (eventsByDate[item.date] || (eventsByDate[item.date] = [])).push(item); });
    var html = "";
    for (var empty = 0; empty < firstWeekday; empty++) html += '<div class="calendar-day is-empty" aria-hidden="true"></div>';
    for (var day = 1; day <= days; day++) {
      var key = dateKey(year, month, day);
      var chips = (eventsByDate[key] || []).map(function (item) {
        return '<span class="calendar-chip calendar-chip--' + safeText(item.type) + '">' + safeText(item.title) + '</span>';
      }).join("");
      var count = (eventsByDate[key] || []).length;
      html += '<button type="button" data-date="' + key + '" aria-pressed="' + (key === selectedDate) + '" aria-label="' + key + '，' + count + '项事件" class="calendar-day' + (key === todayKey ? " is-today" : "") + (key === selectedDate ? " is-selected" : "") + '">' +
        '<span class="calendar-day__number">' + day + '</span><span class="calendar-day__count">' + (count ? count + '项' : '') + '</span><span class="calendar-day__events">' + chips + '</span></button>';
    }
    var total = firstWeekday + days;
    while (total++ % 7) html += '<div class="calendar-day is-empty" aria-hidden="true"></div>';
    document.getElementById("monthGrid").innerHTML = html;
    renderEventList();
  }
  function renderEventList() {
    var list = monthEvents();
    if (selectedDate) list = list.filter(function (item) { return item.date === selectedDate; });
    document.getElementById("eventListTitle").textContent = selectedDate ? Number(selectedDate.slice(5, 7)) + "月" + Number(selectedDate.slice(8)) + "日" : "本月事件";
    document.getElementById("showAllEvents").hidden = !selectedDate;
    document.getElementById("eventCount").textContent = list.length + " 项";
    document.getElementById("eventList").innerHTML = list.length ? list.map(function (item) {
      return '<article class="event-item"><span class="event-item__date">' + safeText(item.date.slice(8)) + '</span><div><h3>' +
        safeText(item.title) + '</h3></div>' +
        '<button class="event-delete" type="button" data-id="' + safeText(item.id) + '" aria-label="删除' + safeText(item.title) + '">删除</button></article>';
    }).join("") : '<p class="event-empty">' + (selectedDate ? "当天暂无事件。" : "这个月还没有校历事项。") + '</p>';
  }
  function typeLabel(type) {
    return { teaching: "教学安排", activity: "校园活动", holiday: "节假日", exam: "考试" }[type] || "其他";
  }
  function setStatus(message) { document.getElementById("editorStatus").textContent = message || ""; }
  function authHeaders() {
    return { "Authorization": "Bearer " + adminToken };
  }
  function showAccess(message) {
    adminToken = "";
    sessionStorage.removeItem("calendarAdminToken");
    document.getElementById("calendarApp").hidden = true;
    document.getElementById("calendarAccess").hidden = false;
    document.getElementById("loginStatus").textContent = message || "";
    document.getElementById("loginPanel").hidden = !message;
  }
  function showCalendar() {
    document.getElementById("calendarAccess").hidden = true;
    document.getElementById("calendarApp").hidden = false;
    document.querySelector('.calendar-header__actions').hidden = !adminMode;
    document.getElementById('calendarMode').textContent = localPreview ? '本地预览 · 数据尚未同步到线上' : adminMode ? '管理员模式' : '查看校历事件';
  }
  function loadLocalPreview() {
    var token = sessionStorage.getItem("localConsoleToken") || "";
    return fetch("/api/local-console/page-preview?moduleId=school-calendar&t=" + Date.now(), {
      headers: { "Authorization": "Bearer " + token }
    }).then(function (response) {
      return response.json().then(function (body) {
        if (!response.ok || !body.preview) throw new Error(body.error || "无法读取本地预览");
        return body.preview;
      });
    }).then(function (preview) {
      data = preview.data;
      data.events = CalendarText.expand(data.events);
      var first = data.events.slice().sort(function (a, b) { return a.date.localeCompare(b.date); })[0];
      if (first && /^\d{4}-\d{2}-\d{2}$/.test(first.date)) {
        viewDate = new Date(first.date + "T00:00:00");
        viewDate.setDate(1);
      }
      document.body.classList.add("local-preview-mode");
      document.getElementById("calendarYear").textContent = data.academicYear + " 学年";
      document.getElementById("calendarMode").textContent = "本地预览 · 数据尚未同步到线上";
      document.querySelector(".calendar-header__actions").hidden = true;
      showCalendar();
      render();
    }).catch(function (error) {
      showAccess(error.message);
      document.getElementById("accessTitle").textContent = "预览暂不可用";
      document.querySelector(".access-copy").textContent = "返回本地工作台重新生成网页预览。";
      document.getElementById("showAdminLogin").hidden = true;
    });
  }
  function load() {
    return fetch("/api/calendar?t=" + Date.now(), { headers: authHeaders() }).then(function (response) {
      if (response.status === 401) throw new Error("LOGIN_REQUIRED");
      if (response.status === 404) return {schoolName:'首师附一小', academicYear:'2026—2027', events:[]};
      if (!response.ok) throw new Error("校历服务暂时不可用");
      return response.json();
    }).then(function (loaded) {
      if (loaded && Array.isArray(loaded.events)) data = loaded;
      data.events = CalendarText.expand(data.events);
      showCalendar();
      render();
    }).catch(function (error) {
      if (adminMode) showAccess(error.message === "LOGIN_REQUIRED" ? "登录已失效，请重新登录。" : error.message);
      else { showCalendar(); document.getElementById('eventList').textContent = '校历服务暂时不可用，请稍后刷新。'; }
    });
  }
  document.getElementById("adminLogin").addEventListener("submit", function (event) {
    event.preventDefault();
    var button = document.getElementById("loginSubmit");
    var status = document.getElementById("loginStatus");
    button.disabled = true;
    status.textContent = "正在验证…";
    fetch("/api/auth", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        adminUser: document.getElementById("adminUser").value.trim(),
        adminPass: document.getElementById("adminPass").value
      })
    }).then(function (response) {
      return response.json().then(function (body) {
        if (!response.ok || !body.token) throw new Error(body.error || "管理员登录失败");
        adminToken = body.token;
        sessionStorage.setItem("calendarAdminToken", adminToken);
        document.getElementById("adminPass").value = "";
        return load();
      });
    }).catch(function (error) {
      status.textContent = error.message === "Failed to fetch" ? "管理员验证服务暂时不可用。" : error.message;
    }).then(function () { button.disabled = false; });
  });
  document.getElementById("showAdminLogin").addEventListener("click", function () {
    document.getElementById("loginPanel").hidden = false;
    document.getElementById("loginStatus").textContent = "";
    document.getElementById("adminUser").focus();
  });
  document.getElementById("hideAdminLogin").addEventListener("click", function () {
    document.getElementById("loginPanel").hidden = true;
    document.getElementById("loginStatus").textContent = "";
    document.getElementById("adminPass").value = "";
  });
  document.getElementById("adminLogout").addEventListener("click", function () { showAccess(""); });
  document.getElementById("monthGrid").addEventListener("click", function (event) {
    var button = event.target.closest("[data-date]");
    if (!button) return;
    selectedDate = button.dataset.date;
    render();
    if (window.matchMedia("(max-width: 620px)").matches) document.getElementById("eventPanel").scrollIntoView({ block: "start" });
  });
  document.getElementById("showAllEvents").addEventListener("click", function () { selectedDate = ""; render(); });
  document.getElementById("prevMonth").addEventListener("click", function () { viewDate.setMonth(viewDate.getMonth() - 1); render(); });
  document.getElementById("nextMonth").addEventListener("click", function () { viewDate.setMonth(viewDate.getMonth() + 1); render(); });
  document.getElementById("todayButton").addEventListener("click", function () { viewDate = new Date(); selectedDate = dateKey(viewDate.getFullYear(), viewDate.getMonth(), viewDate.getDate()); viewDate.setDate(1); render(); });
  document.getElementById("editToggle").addEventListener("click", function () {
    if (!adminMode || !adminToken) return;
    editing = !editing;
    document.body.classList.toggle("editing", editing);
    document.getElementById("eventEditor").hidden = !editing;
    this.classList.toggle("is-active", editing);
    this.textContent = editing ? "退出编辑模式" : "进入编辑模式";
    document.getElementById("eventDate").value = dateKey(viewDate.getFullYear(), viewDate.getMonth(), 1);
    setStatus("");
  });
  document.getElementById("eventEditor").addEventListener("submit", function (event) {
    event.preventDefault();
    var date = document.getElementById("eventDate").value;
    var title = document.getElementById("eventTitle").value.trim();
    if (!date || !title) return;
    CalendarText.parse(title).forEach(function (line, index) {
      data.events.push({ id: "event-" + Date.now() + "-" + index, date: date, title: line, type: "activity", note: "" });
    });
    viewDate = new Date(date + "T00:00:00");
    viewDate.setDate(1);
    this.reset();
    document.getElementById("eventDate").value = date;
    setStatus("已加入待发布列表。");
    render();
  });
  document.getElementById("eventList").addEventListener("click", function (event) {
    var id = event.target.getAttribute("data-id");
    if (!id) return;
    data.events = data.events.filter(function (item) { return item.id !== id; });
    setStatus("已删除，发布后全员生效。");
    render();
  });
  document.getElementById("saveCalendar").addEventListener("click", function () {
    setStatus("正在发布…");
    fetch("/api/calendar", {
      method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + adminToken },
      body: JSON.stringify({ calendar: data })
    }).then(function (response) {
      if (response.status === 401) {
        showAccess("登录已失效，请重新登录。");
        throw new Error("需要重新登录");
      }
      if (!response.ok) throw new Error("发布服务暂时不可用");
      setStatus("已发布，全员即时生效。");
    }).catch(function (error) { setStatus(error.message); });
  });
  if (localPreview) loadLocalPreview();
  else if (!adminMode || adminToken) load();
  else showAccess("");
})();
