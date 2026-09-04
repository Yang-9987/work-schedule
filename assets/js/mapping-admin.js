(function () {
  "use strict";

  var token = sessionStorage.getItem("workbenchAdminToken") || "";
  var mappingSet = null;
  var selectedModuleId = "";
  var moduleSnapshot = null;
  var toastTimer = null;

  var els = {
    loginScreen: document.getElementById("loginScreen"),
    loginForm: document.getElementById("loginForm"),
    loginError: document.getElementById("loginError"),
    adminShell: document.getElementById("adminShell"),
    connectionState: document.getElementById("connectionState"),
    moduleList: document.getElementById("moduleList"),
    mappingTable: document.getElementById("mappingTable"),
    visibleFields: document.getElementById("visibleFields"),
    previewContent: document.getElementById("previewContent"),
    checkCard: document.getElementById("checkCard"),
    documentUrl: document.getElementById("documentUrl"),
    sheetName: document.getElementById("sheetName"),
    viewType: document.getElementById("viewType"),
    toast: document.getElementById("toast")
  };

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char];
    });
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.classList.add("show");
    toastTimer = setTimeout(function () { els.toast.classList.remove("show"); }, 2400);
  }

  function authHeaders() {
    return { "Authorization": "Bearer " + token };
  }

  function activeModule() {
    return mappingSet && mappingSet.modules.find(function (module) { return module.id === selectedModuleId; });
  }

  function formatTime(value) {
    if (!value) return "尚未保存";
    var date = new Date(value);
    return isNaN(date.getTime()) ? "尚未保存" : date.toLocaleString("zh-CN", { hour12: false });
  }

  function setConnected(connected) {
    els.connectionState.classList.toggle("online", connected);
    els.connectionState.lastChild.nodeValue = connected ? " 已连接" : " 连接失败";
  }

  function login(event) {
    event.preventDefault();
    els.loginError.textContent = "";
    fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        adminUser: document.getElementById("adminUser").value.trim(),
        adminPass: document.getElementById("adminPass").value
      })
    }).then(function (response) {
      return response.json().then(function (body) { return { ok: response.ok, body: body }; });
    }).then(function (result) {
      if (!result.ok) throw new Error(result.body.error || "登录失败");
      token = result.body.token;
      sessionStorage.setItem("workbenchAdminToken", token);
      document.getElementById("adminPass").value = "";
      return loadMappings();
    }).catch(function (error) {
      els.loginError.textContent = error.message;
    });
  }

  function loadMappings() {
    return fetch("/api/module-mappings?t=" + Date.now(), { headers: authHeaders() }).then(function (response) {
      if (response.status === 401) throw new Error("登录状态已失效");
      return response.json().then(function (body) { return { ok: response.ok, body: body }; });
    }).then(function (result) {
      if (!result.ok) throw new Error(result.body.error || "无法读取映射");
      mappingSet = result.body.mappingSet;
      selectedModuleId = mappingSet.modules[0] ? mappingSet.modules[0].id : "";
      els.loginScreen.hidden = true;
      els.adminShell.hidden = false;
      setConnected(true);
      renderAll();
    }).catch(function (error) {
      setConnected(false);
      if (error.message.indexOf("登录状态") !== -1) logout();
      throw error;
    });
  }

  function logout() {
    token = "";
    mappingSet = null;
    sessionStorage.removeItem("workbenchAdminToken");
    els.adminShell.hidden = true;
    els.loginScreen.hidden = false;
  }

  function syncInputsToModule() {
    var module = activeModule();
    if (!module) return;
    module.source.documentUrl = els.documentUrl.value.trim();
    module.source.sheet = els.sheetName.value.trim();
    module.view.type = els.viewType.value;
  }

  function selectModule(id) {
    syncInputsToModule();
    selectedModuleId = id;
    renderAll();
  }

  function renderAll() {
    renderSummary();
    renderModuleList();
    renderModuleEditor();
  }

  function moduleIssues(module) {
    var issues = [];
    var mapped = new Set(module.mappings.map(function (item) { return item.target; }));
    module.schema.fields.forEach(function (field) {
      if (field.required && !mapped.has(field.key)) issues.push("必填字段“" + field.label + "”尚未映射");
    });
    if (!module.source.documentUrl) issues.push("尚未填写企业微信智能表格链接");
    if (!module.source.sheet) issues.push("尚未填写子表名称");
    var targets = module.mappings.map(function (item) { return item.target; });
    if (new Set(targets).size !== targets.length) issues.push("存在重复的目标字段");
    return issues;
  }

  function renderSummary() {
    var modules = mappingSet.modules;
    var issueTotal = modules.reduce(function (sum, module) { return sum + moduleIssues(module).length; }, 0);
    document.getElementById("moduleCount").textContent = modules.length;
    document.getElementById("publishedCount").textContent = modules.filter(function (module) { return module.mappingState === "published"; }).length;
    document.getElementById("issueCount").textContent = issueTotal;
    document.getElementById("updatedAt").textContent = formatTime(mappingSet.updatedAt);
  }

  function renderModuleList() {
    els.moduleList.innerHTML = mappingSet.modules.map(function (module) {
      return '<button class="module-button' + (module.id === selectedModuleId ? " active" : "") + '" data-module="' + escapeHtml(module.id) + '" type="button">' +
        '<span class="module-glyph">' + escapeHtml(module.name.slice(0, 1)) + '</span>' +
        '<span class="module-meta"><strong>' + escapeHtml(module.name) + '</strong><small>' + escapeHtml(module.route) + '</small></span>' +
        '<i class="module-dot ' + (module.mappingState === "published" ? "published" : "") + '"></i></button>';
    }).join("");
    Array.prototype.forEach.call(els.moduleList.querySelectorAll("[data-module]"), function (button) {
      button.addEventListener("click", function () { selectModule(button.dataset.module); });
    });
  }

  function renderModuleEditor() {
    var module = activeModule();
    if (!module) return;
    moduleSnapshot = JSON.stringify(module);
    document.getElementById("sourceName").textContent = module.source.name;
    document.getElementById("schemaName").textContent = module.schema.id;
    document.getElementById("pageRoute").textContent = module.route;
    document.getElementById("pageRoute").href = module.route;
    els.documentUrl.value = module.source.documentUrl || "";
    els.sheetName.value = module.source.sheet || "";
    els.viewType.value = module.view.type;
    var state = document.getElementById("mappingState");
    state.textContent = module.mappingState === "published" ? "已发布 · v" + module.revision : "草稿 · v" + module.revision;
    state.classList.toggle("published", module.mappingState === "published");
    renderMappings(module);
    renderVisibleFields(module);
    renderPreview(module);
    renderCheck(module, false);
  }

  function options(items, selected, valueKey, labelKey) {
    return items.map(function (item) {
      var value = typeof item === "string" ? item : item[valueKey];
      var label = typeof item === "string" ? item : item[labelKey];
      return '<option value="' + escapeHtml(value) + '"' + (value === selected ? " selected" : "") + '>' + escapeHtml(label) + '</option>';
    }).join("");
  }

  function renderMappings(module) {
    var transforms = [
      { key: "identity", label: "保持原值" }, { key: "trim", label: "清理文本" },
      { key: "date", label: "转为日期" }, { key: "time", label: "转为时间" },
      { key: "type-map", label: "字典转换" }
    ];
    els.mappingTable.innerHTML = module.schema.fields.map(function (field) {
      var mapping = module.mappings.find(function (item) { return item.target === field.key; }) || {
        source: module.source.fields[0] ? module.source.fields[0].name : "", target: field.key, transform: "identity", required: field.required
      };
      return '<div class="mapping-row" data-target="' + escapeHtml(field.key) + '">' +
        '<label>企业微信列<select data-role="source">' + options(module.source.fields, mapping.source, "name", "name") + '</select></label>' +
        '<span class="mapping-arrow" aria-hidden="true"></span>' +
        '<label>标准字段<select data-role="target" disabled><option>' + escapeHtml(field.label + " · " + field.key) + '</option></select></label>' +
        '<label class="transform-field">转换<select data-role="transform">' + options(transforms, mapping.transform, "key", "label") + '</select></label>' +
        '<label class="required-check"><input data-role="required" type="checkbox"' + ((mapping.required || field.required) ? " checked" : "") + (field.required ? " disabled" : "") + '><span>必填</span></label>' +
        '</div>';
    }).join("");
    Array.prototype.forEach.call(els.mappingTable.querySelectorAll("select,input"), function (input) {
      input.addEventListener("change", function () { updateMappingsFromRows(module); });
    });
  }

  function updateMappingsFromRows(module) {
    module.mappings = Array.prototype.map.call(els.mappingTable.querySelectorAll(".mapping-row"), function (row) {
      return {
        source: row.querySelector('[data-role="source"]').value,
        target: row.dataset.target,
        transform: row.querySelector('[data-role="transform"]').value,
        required: row.querySelector('[data-role="required"]').checked
      };
    });
    renderPreview(module);
    renderSummary();
    renderCheck(module, false);
  }

  function renderVisibleFields(module) {
    els.visibleFields.innerHTML = module.schema.fields.map(function (field) {
      var checked = module.view.visibleFields.indexOf(field.key) !== -1;
      return '<label class="field-chip"><input type="checkbox" value="' + escapeHtml(field.key) + '"' + (checked ? " checked" : "") + '><span>' + escapeHtml(field.label) + '</span></label>';
    }).join("");
    Array.prototype.forEach.call(els.visibleFields.querySelectorAll("input"), function (input) {
      input.addEventListener("change", function () {
        module.view.visibleFields = Array.prototype.filter.call(els.visibleFields.querySelectorAll("input"), function (item) { return item.checked; }).map(function (item) { return item.value; });
        renderPreview(module);
      });
    });
  }

  function sampleValue(field) {
    var samples = { date: "2026-09-10", time: "08:20", enum: "校园活动", text: "示例内容" };
    return samples[field.type] || "示例内容";
  }

  function renderPreview(module) {
    var visible = module.schema.fields.filter(function (field) { return module.view.visibleFields.indexOf(field.key) !== -1; });
    els.previewContent.innerHTML = '<p class="preview-title">' + escapeHtml(module.name) + '</p>' + (visible.length ? visible.map(function (field) {
      return '<div class="preview-line"><span>' + escapeHtml(field.label) + '</span><strong>' + escapeHtml(sampleValue(field)) + '</strong></div>';
    }).join("") : '<div class="preview-line"><span>提示</span><strong>请选择至少一个展示字段</strong></div>');
  }

  function renderCheck(module, explicit) {
    syncInputsToModule();
    var issues = moduleIssues(module);
    els.checkCard.className = "check-card" + (explicit ? (issues.length ? " error" : " ok") : "");
    els.checkCard.innerHTML = issues.length
      ? '<strong>' + (explicit ? "发现 " + issues.length + " 项问题" : "配置尚未完成") + '</strong><p>' + escapeHtml(issues[0]) + (issues.length > 1 ? "；另有 " + (issues.length - 1) + " 项。" : "") + '</p>'
      : '<strong>' + (explicit ? "配置检查通过" : "结构完整") + '</strong><p>必填字段、数据源和展示规则已经就绪。</p>';
    renderSummary();
    return issues;
  }

  function save(action) {
    syncInputsToModule();
    var issues = mappingSet.modules.reduce(function (all, module) { return all.concat(moduleIssues(module)); }, []);
    if (action === "publish" && issues.length) {
      renderCheck(activeModule(), true);
      showToast("还有配置问题，暂时不能发布");
      return;
    }
    fetch("/api/module-mappings", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
      body: JSON.stringify({ action: action, mappingSet: mappingSet })
    }).then(function (response) {
      return response.json().then(function (body) { return { ok: response.ok, body: body }; });
    }).then(function (result) {
      if (!result.ok) throw new Error(result.body.error || "保存失败");
      mappingSet = result.body.mappingSet;
      renderAll();
      showToast(action === "publish" ? "映射已发布" : "草稿已保存");
    }).catch(function (error) {
      if (error.message.indexOf("登录") !== -1) logout();
      showToast(error.message);
    });
  }

  els.loginForm.addEventListener("submit", login);
  document.getElementById("logoutButton").addEventListener("click", logout);
  document.getElementById("validateButton").addEventListener("click", function () {
    var issues = renderCheck(activeModule(), true);
    showToast(issues.length ? "检查完成：需要处理 " + issues.length + " 项" : "当前模块配置完整");
  });
  document.getElementById("saveButton").addEventListener("click", function () { save("save"); });
  document.getElementById("publishButton").addEventListener("click", function () { save("publish"); });
  document.getElementById("resetModuleButton").addEventListener("click", function () {
    if (!moduleSnapshot) return;
    var index = mappingSet.modules.findIndex(function (module) { return module.id === selectedModuleId; });
    mappingSet.modules[index] = JSON.parse(moduleSnapshot);
    renderAll();
    showToast("已恢复进入本模块时的配置");
  });
  els.documentUrl.addEventListener("input", function () { syncInputsToModule(); renderCheck(activeModule(), false); });
  els.sheetName.addEventListener("input", function () { syncInputsToModule(); renderCheck(activeModule(), false); });
  els.viewType.addEventListener("change", function () { syncInputsToModule(); renderPreview(activeModule()); });

  if (token) {
    loadMappings().catch(function () { logout(); });
  }
})();
