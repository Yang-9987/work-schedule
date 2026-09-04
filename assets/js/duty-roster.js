(function () {
  "use strict";
  var localPreview = new URLSearchParams(location.search).get("localPreview") === "1";
  var data = {}, rows = [], index = new Map(), personnel = [];
  var today = new Date();
  var state = { view: "week", week: 0, month: new Date(today.getFullYear(), today.getMonth(), 1), person: "", date: "" };
  var weekNames = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  function el(id) { return document.getElementById(id); }
  function safe(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function pad(n) { return String(n).padStart(2, "0"); }
  function iso(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function parse(s) { return new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10))); }
  function validDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s || "") && iso(parse(s)) === s; }
  function fmt(s) { var d = parse(s); return (d.getMonth() + 1) + "月" + d.getDate() + "日 " + weekNames[d.getDay()]; }
  function names(row) { return (row.leaders || []).concat(row.cadres || []); }
  function entries(s) { return index.get(s) || []; }
  function typeName(type) { return { normal: "正常值班", holiday: "放假", makeup: "补课值班" }[type] || "未知类型"; }
  function tags(row) {
    return '<span class="day-tag ' + (row.type === "holiday" ? "tag-holiday" : row.type === "makeup" ? "tag-makeup" : "") + '">' + safe(typeName(row.type)) + '</span>';
  }
  function entryText(row) {
    return row.type === "holiday" ? "放假 · 不安排值周" : names(row).join("、") || "人员待补充";
  }
  function detail(row) {
    var roles = [];
    if (row.type !== "holiday") {
      if ((row.leaders || []).length) roles.push("领导／人员：" + row.leaders.join("、"));
      if ((row.cadres || []).length) roles.push("干部：" + row.cadres.join("、"));
    }
    return [roles.join("；"), row.shift, row.location, row.note].filter(Boolean).join(" · ");
  }
  function dayContent(s) {
    var list = entries(s);
    return list.length ? list.map(function (row) {
      return '<div class="day-main"><div class="day-names">' + safe(entryText(row)) + ' ' + tags(row) + '</div><div class="day-note">' + safe(detail(row)) + '</div></div>';
    }).join("") : '<div class="day-main"><div class="day-note">未排班</div></div>';
  }
  function renderToday() {
    var s = iso(today), list = entries(s);
    el("todayDuty").hidden = false;
    var html = '<div class="hero-head"><h2 class="hero-label">今日值班</h2><span class="hero-date">' + safe(today.getFullYear() + "年" + fmt(s)) + '</span></div><div class="hero-body">';
    if (!list.length) {
      html += '<div class="hero-empty"><div class="big">今日暂无值班安排</div><p>没有排班记录，不代表已确认放假。</p></div>';
      var next = rows.find(function (row) { return row.date > s && row.type !== "holiday" && names(row).length; });
      if (next) html += '<div class="hero-tip">下次值班：' + safe(fmt(next.date) + " · " + names(next).join("、")) + '</div>';
    } else list.forEach(function (row) {
      if (row.type === "holiday") html += '<div class="hero-empty"><div class="big">今日放假</div><p>不安排值周</p></div>';
      else {
        html += '<div class="hero-leaders">';
        [["leaders", "值班领导"], ["cadres", "值班干部"]].forEach(function (role) {
          (row[role[0]] || []).forEach(function (name) {
            html += '<div class="leader-chip"><div class="role">' + role[1] + '</div><div class="name">' + safe(name) + '</div></div>';
          });
        });
        html += '</div>';
        if (!names(row).length) html += '<p class="empty-hint">人员待补充</p>';
      }
    });
    el("todayDuty").innerHTML = html + '</div>';
  }
  function navigation(title, unit) {
    return '<div class="nav-row"><button class="nav-btn" data-act="prev">‹ 上' + unit + '</button><h2 class="nav-title">' + safe(title) + '</h2><button class="nav-btn" data-act="next">下' + unit + ' ›</button></div>';
  }
  function renderWeek() {
    var monday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7 + state.week * 7);
    var end = new Date(monday); end.setDate(end.getDate() + 6);
    var shortDate = function (d) { return (d.getMonth() + 1) + "月" + d.getDate() + "日"; };
    var html = '<section class="card">' + navigation(shortDate(monday) + " — " + shortDate(end), "周") + '<div class="week-list">';
    for (var i = 0; i < 7; i++) {
      var date = new Date(monday); date.setDate(date.getDate() + i);
      var s = iso(date);
      var list = entries(s);
      var content = list.length ? list.map(function (row) {
        return '<div class="day-names">' + (row.type === "holiday" ? "放假" : names(row).map(safe).join('<span class="sep">·</span>') || "人员待补充") + '</div>';
      }).join("") : '<div class="day-names day-unassigned">' + ([0, 6].includes(date.getDay()) ? "周末" : "未排班") + '</div>';
      var badge = s === iso(today) ? '<span class="day-tag tag-today">今天</span>' : list.filter(function (row) { return row.type !== "normal"; }).map(tags).join("");
      html += '<div class="day-row' + (s === iso(today) ? " today" : !list.length && [0, 6].includes(date.getDay()) ? " off" : "") + '"><div class="day-date"><div class="d">' + date.getDate() + '</div><div class="m">' + (date.getMonth() + 1) + '月</div></div><div class="day-week' + (s === iso(today) ? " today" : "") + '">' + weekNames[date.getDay()] + '</div><div class="day-main">' + content + '</div>' + badge + '</div>';
    }
    return html + '</div></section>';
  }
  function renderMonth() {
    var y = state.month.getFullYear(), m = state.month.getMonth();
    var html = '<section class="card">' + navigation(y + "年" + (m + 1) + "月", "月") + '<div class="month-grid">';
    ["日", "一", "二", "三", "四", "五", "六"].forEach(function (w) { html += '<div class="mg-head">' + w + '</div>'; });
    for (var blank = 0; blank < state.month.getDay(); blank++) html += '<div class="mg-cell empty"></div>';
    var days = new Date(y, m + 1, 0).getDate();
    for (var d = 1; d <= days; d++) {
      var s = iso(new Date(y, m, d)), list = entries(s);
      var type = list.some(function (row) { return row.type === "makeup"; }) ? "makeup" : list.length && list.every(function (row) { return row.type === "holiday"; }) ? "holiday" : "";
      var summary = list.length ? list.map(entryText).join("；") : "未排班";
      var who = list.map(function (row) { return row.type === "holiday" ? '<span>' + safe(row.note || "放假") + '</span>' : names(row).map(function (name) { return '<span>' + safe(name) + '</span>'; }).join(""); }).join("");
      html += '<button class="mg-cell ' + type + (s === iso(today) ? " today" : "") + (s === state.date ? " selected" : "") + '" data-date="' + s + '" aria-pressed="' + (s === state.date) + '" aria-label="' + safe(fmt(s) + " " + summary) + '"><span class="num">' + d + '</span><span class="who">' + who + '</span></button>';
    }
    html += '</div><p class="legend">橙框：今天 · 绿色：放假 · 蓝色：补课。点击日期查看详情。</p>';
    if (state.date) html += '<div class="month-detail"><h3 class="card-title">' + safe(fmt(state.date)) + '</h3>' + dayContent(state.date) + '</div>';
    return html + '</section>';
  }
  function renderPerson() {
    if (!personnel.length) return '<section class="card"><p class="empty-hint">暂无人员，请检查人员字段映射。</p></section>';
    if (!state.person) state.person = personnel[0];
    var list = rows.filter(function (row) { return names(row).indexOf(state.person) !== -1 && row.type !== "holiday"; });
    var dates = Array.from(new Set(list.map(function (row) { return row.date; }))).sort();
    var count = dates.length;
    var html = '<section class="card"><div class="person-pills">' + personnel.map(function (name) {
      return '<button class="pill' + (name === state.person ? " active" : "") + '" data-person="' + safe(name) + '" aria-pressed="' + (name === state.person) + '">' + safe(name) + '</button>';
    }).join("") + '</div><div class="person-result"><p class="person-stat">共 <b>' + count + '</b> 天值班安排' + (localPreview ? '（当前预览数据）' : '') + '</p>';
    var month = "";
    dates.forEach(function (date) {
      if (month !== date.slice(0, 7)) { month = date.slice(0, 7); html += '<h3 class="person-month">' + safe(month) + '</h3>'; }
      html += '<div class="person-row"><time datetime="' + date + '">' + safe(fmt(date)) + '</time></div>';
    });
    if (!dates.length) html += '<p class="person-empty">暂无值班日期</p>';
    return html + '</div></section>';
  }
  function parseDutyTimes(value) {
    var raw = String(value || "").trim();
    // Split on period labels, not semicolons: afternoon contains several times.
    var pattern = /(^|[\s;；])(早晨值周|早晨|早上|上午|早|中午陪餐|中午|午|下午到岗|下午)\s*[：:]?\s*(?=\d{1,2}[:：])/g;
    var markers = [], match;
    while ((match = pattern.exec(raw))) {
      // A period name inside an explanation must not create a new section.
      var depth = 0;
      for (var i = 0; i < match.index; i++) {
        if (raw[i] === "（" || raw[i] === "(") depth++;
        else if (raw[i] === "）" || raw[i] === ")") depth = Math.max(0, depth - 1);
      }
      if (depth) continue;
      var key = match[2].indexOf("下午") === 0 ? "afternoon" : /^(中午|午)/.test(match[2]) ? "lunch" : "morning";
      markers.push({ key: key, start: match.index, content: pattern.lastIndex });
    }
    var result = {};
    markers.forEach(function (marker, index) {
      var content = raw.slice(marker.content, index + 1 < markers.length ? markers[index + 1].start : raw.length).replace(/[;；\s]+$/, "");
      result[marker.key] = result[marker.key] ? result[marker.key] + "；" + content : content;
    });
    // Keep unrecognized text visible instead of silently losing source content.
    if (!markers.length || raw.slice(0, markers[0].start).trim()) result.original = raw;
    return result;
  }
  function renderNotice() {
    var groups = new Map();
    var dutyRows = rows.filter(function (row) { return row.type !== "holiday"; });
    dutyRows.forEach(function (row) {
      var time = String(row.shift || "").trim();
      if (!time) return;
      if (!groups.has(time)) groups.set(time, new Set());
      groups.get(time).add(row.date);
    });
    var html = '<section class="card"><div class="card-head"><h2 class="card-title">值周时间安排</h2></div>';
    var allHaveTime = dutyRows.length > 0 && dutyRows.every(function (row) { return String(row.shift || "").trim(); });
    groups.forEach(function (dates, time) {
      if (groups.size > 1 || !allHaveTime) html += '<div class="notice-item"><p class="v">适用日期：' + safe(Array.from(dates).sort().join("、")) + '</p></div>';
      var parsed = parseDutyTimes(time);
      [["morning", "早晨值周"], ["lunch", "中午陪餐"], ["afternoon", "下午到岗"]].forEach(function (item) {
        html += '<div class="notice-item"><div><h3 class="t">' + item[1] + '</h3><p class="v">' + safe(parsed[item[0]] || "时间段中未识别到此项，请检查原文") + '</p></div></div>';
      });
      if (parsed.original) html += '<div class="notice-item"><div><h3 class="t">时间段原文（请核对格式）</h3><p class="v">' + safe(parsed.original) + '</p></div></div>';
    });
    if (!groups.size) html += '<div class="notice-item"><p class="v">暂无时间段数据。请在工作台将表格的“时间段”列映射到“时间段 · shift”，然后重新生成预览。</p></div>';
    else if (!allHaveTime) html += '<div class="notice-item"><p class="v">部分值班记录未填写时间段，请核对表格。</p></div>';
    return html + '</section><section class="card"><div class="card-head"><h2 class="card-title">值周须知</h2></div><div class="notice-item"><p class="v">' + safe(data.notice || "尚未配置值周须知。") + '</p></div></section>';
  }
  function renderView() {
    el("rosterContent").innerHTML = ({week: renderWeek, month: renderMonth, person: renderPerson, notice: renderNotice})[state.view]();
    document.querySelectorAll("[data-view]").forEach(function (button) {
      button.classList.toggle("active", button.dataset.view === state.view);
      button.setAttribute("aria-pressed", String(button.dataset.view === state.view));
    });
  }
  function render(preview) {
    data = preview.data || {};
    rows = (data.rows || []).filter(function (row) { return validDate(row.date); }).sort(function (a, b) { return a.date.localeCompare(b.date); });
    rows.forEach(function (row) { if (!index.has(row.date)) index.set(row.date, []); index.get(row.date).push(row); });
    personnel = Array.from(new Set(rows.reduce(function (all, row) { return all.concat(names(row)); }, [])));
    el("termText").textContent = data.meta && data.meta.term || "行政干部值周安排";
    el("rosterUpdated").textContent = localPreview ? "预览 " + new Date(preview.generatedAt).toLocaleDateString("zh-CN") : '已发布';
    el("previewProof").hidden = !localPreview;
    var issues = (preview.issues || []).slice();
    if (rows.length !== (data.rows || []).length) issues.push("无效日期记录未显示，请返回工作台核对。");
    el("rosterIssues").hidden = !issues.length;
    el("rosterIssues").textContent = issues.join("\n");
    el("tabbar").hidden = false;
    renderToday(); renderView();
  }
  el("adminEntry").addEventListener("click", function () {
    location.href = localPreview ? "/local-console/" : "/admin/mappings/";
  });
  el("tabbar").addEventListener("click", function (event) {
    var button = event.target.closest("[data-view]");
    if (!button) return;
    state.view = button.dataset.view;
    renderView();
  });
  el("rosterContent").addEventListener("click", function (event) {
    var button = event.target.closest("[data-act], [data-person], [data-date]");
    if (!button) return;
    if (button.dataset.person !== undefined) state.person = button.dataset.person;
    if (button.dataset.date) state.date = button.dataset.date;
    if (button.dataset.act) {
      var act = button.dataset.act, delta = act === "prev" ? -1 : 1;
      if (state.view === "week") state.week = act === "now" ? 0 : state.week + delta;
      if (state.view === "month") {
        state.month = act === "now" ? new Date(today.getFullYear(), today.getMonth(), 1) : new Date(state.month.getFullYear(), state.month.getMonth() + delta, 1);
        state.date = "";
      }
    }
    renderView();
  });
  function showError(message) {
    el("rosterContent").innerHTML = '<section class="card"><p class="empty-hint">' + safe(message) + '</p></section>';
    el("rosterUpdated").textContent = localPreview ? "未生成预览" : "尚未发布";
  }
  fetch(localPreview ? "/api/local-console/page-preview?moduleId=duty-roster&t=" + Date.now() : '/api/duty-roster?t=' + Date.now(), {
    headers: localPreview ? { Authorization: "Bearer " + (sessionStorage.getItem("localConsoleToken") || "") } : {}
  }).then(function (response) {
    return response.json().then(function (body) {
      if (!response.ok || !(localPreview ? body.preview : body.data)) throw new Error(body.error || "无法读取排班");
      return localPreview ? body.preview : { data: body.data, issues: [] };
    });
  }).then(render).catch(function (error) { showError(error.message + (localPreview ? "，请返回本地工作台重新生成。" : "")); });
})();
