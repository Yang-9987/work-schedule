(function () {
  "use strict";

  var localToken = sessionStorage.getItem("localConsoleToken") || "";
  var setupMode = false;
  var mappingSet = null;
  var selectedModuleId = "";
  var discoveredFields = [];
  var discoveredSheets = [];
  var moduleDrafts = Object.create(null);
  var toastTimer = null;

  var FIELD_ALIASES = {
    date: ["日期", "时间", "值班日期"],
    title: ["事件", "事项", "内容", "标题"],
    type: ["类型", "分类", "类别"],
    importance: ["重要程度", "重要性", "优先级"],
    note: ["备注", "说明"],
    name: ["名称", "时段名称", "事项", "内容"],
    start: ["开始时间", "开始", "起始时间"],
    end: ["结束时间", "结束", "截止时间"],
    desc: ["说明", "备注"],
    shift: ["时间段", "值周时间段", "值班时间段", "班次", "时段"],
    person: ["值班领导", "值周领导", "值班人员", "人员", "姓名", "leaders"],
    cadre: ["值班干部", "值周干部", "干部"],
    location: ["值班地点", "地点", "位置"]
  };

  var els = {
    wecomStatus: document.getElementById("wecomStatus"),
    cliVersion: document.getElementById("cliVersion"),
    authState: document.getElementById("authState"),
    mappingUpdate: document.getElementById("mappingUpdate"),
    moduleList: document.getElementById("moduleList"),
    moduleName: document.getElementById("moduleName"),
    moduleRoute: document.getElementById("moduleRoute"),
    schemaName: document.getElementById("schemaName"),
    documentUrl: document.getElementById("documentUrl"),
    documentInfo: document.getElementById("documentInfo"),
    sheetSelect: document.getElementById("sheetSelect"),
    fieldSummary: document.getElementById("fieldSummary"),
    mappingList: document.getElementById("mappingList"),
    previewTable: document.getElementById("previewTable"),
    previewCount: document.getElementById("previewCount"),
    saveHint: document.getElementById("saveHint"),
    pagePreview: document.getElementById("pagePreview"),
    pagePreviewFrame: document.getElementById("pagePreviewFrame"),
    pagePreviewTitle: document.getElementById("pagePreviewTitle"),
    pagePreviewMeta: document.getElementById("pagePreviewMeta"),
    toast: document.getElementById("toast")
  };

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char];
    });
  }

  function toast(message) {
    clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.classList.add("show");
    toastTimer = setTimeout(function () { els.toast.classList.remove("show"); }, 2400);
  }

  function clearToast() {
    clearTimeout(toastTimer);
    els.toast.textContent = "";
    els.toast.classList.remove("show");
  }

  function normalizedDocumentUrl(value) {
    try {
      var url = new URL(String(value || "").trim());
      url.search = "";
      url.hash = "";
      return url.toString().replace(/\/$/, "");
    } catch (error) {
      return String(value || "").trim();
    }
  }

  function api(path, options, skipAuth) {
    options = options || {};
    options.headers = Object.assign({}, options.headers || {});
    if (localToken && !skipAuth) options.headers.Authorization = "Bearer " + localToken;
    return fetch(path, options).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (body) {
        if (!response.ok) {
          var error = new Error(body.error || "操作失败");
          error.status = response.status;
          throw error;
        }
        return body;
      });
    });
  }

  function post(path, body, skipAuth) {
    return api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, skipAuth);
  }

  function showLogin(configured, message) {
    setupMode = !configured;
    document.getElementById("consoleApp").hidden = true;
    document.getElementById("loginScreen").hidden = false;
    document.getElementById("loginTitle").textContent = setupMode ? "设置本地登录密码" : "登录本地工作台";
    document.getElementById("loginDescription").textContent = setupMode
      ? "首次使用，请设置一个至少 8 个字符的本地密码。"
      : "输入本地密码后继续。";
    document.getElementById("confirmPasswordField").hidden = !setupMode;
    document.getElementById("confirmPassword").required = setupMode;
    document.getElementById("loginButton").textContent = setupMode ? "设置密码并进入" : "登录";
    document.getElementById("loginError").textContent = message || "";
    document.getElementById("localPassword").value = "";
    document.getElementById("confirmPassword").value = "";
  }

  function initializeAuth() {
    return api("/api/local-console/auth/status?t=" + Date.now(), {}, true).then(function (body) {
      if (!body.configured) {
        localToken = "";
        sessionStorage.removeItem("localConsoleToken");
        showLogin(false);
        return;
      }
      if (!localToken) {
        showLogin(true);
        return;
      }
      return initializeApp().catch(function (error) {
        if (error.status === 401) {
          localToken = "";
          sessionStorage.removeItem("localConsoleToken");
          showLogin(true, "登录状态已失效，请重新登录。");
          return;
        }
        throw error;
      });
    }).catch(function (error) {
      showLogin(true, error.message);
    });
  }

  function submitLogin(event) {
    event.preventDefault();
    var password = document.getElementById("localPassword").value;
    var confirm = document.getElementById("confirmPassword").value;
    var errorElement = document.getElementById("loginError");
    errorElement.textContent = "";
    if (password.length < 8 || password.length > 128) {
      errorElement.textContent = "本地密码需要 8—128 个字符。";
      return;
    }
    if (setupMode && password !== confirm) {
      errorElement.textContent = "两次输入的密码不一致。";
      return;
    }
    var button = document.getElementById("loginButton");
    setBusy(button, true, setupMode ? "正在设置" : "正在登录");
    post(setupMode ? "/api/local-console/auth/setup" : "/api/local-console/auth/login", { password: password }, true)
      .then(function (body) {
        localToken = body.token;
        sessionStorage.setItem("localConsoleToken", localToken);
        return initializeApp();
      }).catch(function (error) {
        errorElement.textContent = error.message;
      }).finally(function () {
        setBusy(button, false, setupMode ? "设置密码并进入" : "登录");
      });
  }

  function initializeApp() {
    document.getElementById("loginScreen").hidden = true;
    document.getElementById("consoleApp").hidden = false;
    return Promise.all([loadStatus(), loadMappings()]);
  }

  function logout() {
    localToken = "";
    sessionStorage.removeItem("localConsoleToken");
    mappingSet = null;
    moduleDrafts = Object.create(null);
    showLogin(true);
  }

  function currentModule() {
    return mappingSet && mappingSet.modules.find(function (module) { return module.id === selectedModuleId; });
  }

  function draftFor(module) {
    if (!moduleDrafts[module.id]) {
      var hasSavedSource = Boolean(module.source.documentUrl);
      moduleDrafts[module.id] = {
        documentUrl: module.source.documentUrl || "",
        sheet: module.source.sheet || "",
        sheets: hasSavedSource && module.source.sheet ? [{ title: module.source.sheet }] : [],
        fields: hasSavedSource ? (module.source.fields || []).map(function (field) {
          return { name: field.name, type: field.type, typeLabel: field.typeLabel || "" };
        }) : [],
        documentInfo: hasSavedSource ? "已保存表格链接，点击“读取子表”刷新。" : "尚未读取表格"
      };
    }
    return moduleDrafts[module.id];
  }

  function captureCurrentDraft() {
    var module = currentModule();
    if (!module) return;
    var draft = draftFor(module);
    draft.documentUrl = normalizedDocumentUrl(els.documentUrl.value);
    draft.sheet = els.sheetSelect.value;
    draft.sheets = discoveredSheets.slice();
    draft.fields = discoveredFields.slice();
    draft.documentInfo = els.documentInfo.textContent;
    var rows = els.mappingList.querySelectorAll(".mapping-row");
    if (rows.length && draft.documentUrl && draft.sheet && draft.fields.length) {
      module.source.documentUrl = draft.documentUrl;
      module.source.sheet = draft.sheet;
      module.source.fields = draft.fields.map(function (field) { return { name: field.name, type: field.type }; });
      module.mappings = Array.prototype.map.call(rows, function (row) {
        var source = row.querySelector('[data-role="source"]').value;
        return source ? {
          source: source,
          target: row.dataset.target,
          transform: row.querySelector('[data-role="transform"]').value,
          required: row.dataset.required === "true"
        } : null;
      }).filter(Boolean);
    }
  }

  function formatTime(value) {
    if (!value) return "初始配置";
    var date = new Date(value);
    return isNaN(date.getTime()) ? "初始配置" : date.toLocaleString("zh-CN", { hour12: false });
  }

  function loadStatus() {
    els.wecomStatus.className = "wecom-status";
    els.wecomStatus.querySelector("span").textContent = "检查企业微信连接";
    return api("/api/local-console/status?t=" + Date.now()).then(function (body) {
      var state = body.wecom;
      els.cliVersion.textContent = state.installed ? (state.version || "无法识别版本") : "未安装";
      els.authState.textContent = state.authorized ? "已授权" : "未授权";
      els.wecomStatus.classList.toggle("ready", Boolean(state.supported && state.authorized));
      els.wecomStatus.classList.toggle("error", !state.supported || !state.authorized);
      els.wecomStatus.querySelector("span").textContent = state.supported && state.authorized ? "企业微信已连接" : "企业微信未就绪";
    }).catch(function (error) {
      if (error.status === 401) throw error;
      els.cliVersion.textContent = "不可用";
      els.authState.textContent = "检查失败";
      els.wecomStatus.classList.add("error");
      els.wecomStatus.querySelector("span").textContent = "企业微信连接失败";
      toast(error.message);
    });
  }

  function loadMappings() {
    return api("/api/local-console/mappings?t=" + Date.now()).then(function (body) {
      mappingSet = body.mappingSet;
      moduleDrafts = Object.create(null);
      selectedModuleId = mappingSet.modules[0] ? mappingSet.modules[0].id : "";
      document.getElementById("moduleTotal").textContent = mappingSet.modules.length + " 个";
      els.mappingUpdate.textContent = formatTime(mappingSet.updatedAt);
      renderModules();
      renderModule();
    }).catch(function (error) {
      if (error.status === 401) throw error;
      toast(error.message);
    });
  }

  function renderModules() {
    els.moduleList.innerHTML = mappingSet.modules.map(function (module) {
      return '<button class="module-button' + (module.id === selectedModuleId ? " active" : "") + '" aria-pressed="' + (module.id === selectedModuleId ? "true" : "false") + '" data-module="' + escapeHtml(module.id) + '" type="button">' +
        '<span class="module-icon">' + escapeHtml(module.name.slice(0, 1)) + '</span><span><strong>' + escapeHtml(module.name) + '</strong><small>' + escapeHtml(module.route) + '</small></span></button>';
    }).join("");
    Array.prototype.forEach.call(els.moduleList.querySelectorAll("[data-module]"), function (button) {
      button.addEventListener("click", function () {
        captureCurrentDraft();
        selectedModuleId = button.dataset.module;
        clearToast();
        renderModules();
        renderModule();
      });
    });
  }

  function renderModule() {
    var module = currentModule();
    if (!module) return;
    var draft = draftFor(module);
    discoveredFields = draft.fields.slice();
    discoveredSheets = draft.sheets.slice();
    els.moduleName.textContent = module.name;
    els.moduleRoute.textContent = module.route;
    els.schemaName.textContent = module.schema.id;
    els.documentUrl.value = draft.documentUrl;
    els.documentInfo.textContent = draft.documentInfo;
    renderSheetOptions(draft.sheet);
    renderFields();
    renderMappings();
    clearPreview();
  }

  function renderSheetOptions(selected) {
    var options = discoveredSheets.length ? discoveredSheets : (selected ? [{ title: selected }] : []);
    els.sheetSelect.innerHTML = '<option value="">' + (options.length ? "请选择子表" : "请先读取表格") + '</option>' + options.map(function (sheet) {
      var detail = sheet.fieldCount !== undefined ? "（" + sheet.fieldCount + " 列，" + sheet.recordCount + " 行）" : "";
      return '<option value="' + escapeHtml(sheet.title) + '"' + (sheet.title === selected ? " selected" : "") + '>' + escapeHtml(sheet.title + detail) + '</option>';
    }).join("");
  }

  function renderFields() {
    if (!discoveredFields.length) {
      els.fieldSummary.textContent = "尚未读取字段";
      return;
    }
    els.fieldSummary.innerHTML = discoveredFields.map(function (field) {
      return '<span class="field-chip">' + escapeHtml(field.name) + ' · ' + escapeHtml(field.typeLabel || field.type) + '</span>';
    }).join("");
  }

  function invalidateSourceFields() {
    discoveredFields = [];
    var draft = draftFor(currentModule());
    draft.fields = [];
    draft.sheet = els.sheetSelect.value;
    renderFields();
    renderMappings();
    clearPreview();
    els.saveHint.textContent = "数据源已变化，请重新读取字段后再预览或保存。";
  }

  function normalizedName(value) {
    return String(value || "").toLowerCase().replace(/[\s_\-—:：()（）]/g, "");
  }

  function sourceSuggestions(module) {
    var result = new Map();
    var used = new Set();
    module.schema.fields.forEach(function (field) {
      var existing = module.mappings.find(function (mapping) { return mapping.target === field.key; });
      if (existing && discoveredFields.some(function (source) { return source.name === existing.source; })) {
        result.set(field.key, existing.source);
        used.add(existing.source);
      }
    });
    module.schema.fields.forEach(function (field) {
      if (result.has(field.key)) return;
      var candidates = [field.label, field.key].concat(FIELD_ALIASES[field.key] || []).map(normalizedName);
      var exact = discoveredFields.find(function (source) {
        return !used.has(source.name) && candidates.indexOf(normalizedName(source.name)) !== -1;
      });
      if (exact) {
        result.set(field.key, exact.name);
        used.add(exact.name);
      }
    });
    return result;
  }

  function transformFor(field, sourceName, module) {
    var existing = module.mappings.find(function (mapping) { return mapping.target === field.key && mapping.source === sourceName; });
    if (existing) return existing.transform;
    if (field.type === "date") return "date";
    if (field.type === "time") return "time";
    if (field.type === "enum") return "type-map";
    return "trim";
  }

  function renderMappings() {
    var module = currentModule();
    if (!module || !discoveredFields.length) {
      els.mappingList.innerHTML = '<p class="empty">读取字段后可配置映射。</p>';
      return;
    }
    var transforms = [
      ["identity", "保持原值"], ["trim", "清理文本"], ["date", "转为日期"],
      ["time", "转为时间"], ["type-map", "字典转换"]
    ];
    var suggestions = sourceSuggestions(module);
    els.mappingList.innerHTML = module.schema.fields.map(function (field) {
      var source = suggestions.get(field.key) || "";
      var transform = transformFor(field, source, module);
      var sourceOptions = '<option value="">不映射</option>' + discoveredFields.map(function (item) {
        return '<option value="' + escapeHtml(item.name) + '"' + (item.name === source ? " selected" : "") + '>' + escapeHtml(item.name + " · " + (item.typeLabel || item.type)) + '</option>';
      }).join("");
      var transformOptions = transforms.map(function (item) {
        return '<option value="' + item[0] + '"' + (item[0] === transform ? " selected" : "") + '>' + item[1] + '</option>';
      }).join("");
      var fieldLabel = module.id === "duty-roster" && field.key === "shift" ? "时间段（可选）" : field.label;
      return '<div class="mapping-row" data-target="' + escapeHtml(field.key) + '" data-target-label="' + escapeHtml(fieldLabel) + '" data-required="' + (field.required ? "true" : "false") + '">' +
        '<label>企业微信列<select data-role="source">' + sourceOptions + '</select></label><span class="arrow"></span>' +
        '<div class="target"><label>标准字段</label><div class="target-box">' + escapeHtml(fieldLabel + " · " + field.key) + '</div>' + (field.required ? '<span class="required">必填</span>' : "") + '</div>' +
        '<label class="transform">转换<select data-role="transform">' + transformOptions + '</select></label></div>';
    }).join("");
    Array.prototype.forEach.call(els.mappingList.querySelectorAll('[data-role="source"]'), function (select) {
      select.addEventListener("change", updateMappingHint);
    });
    updateMappingHint();
  }

  function updateMappingHint() {
    var selected = Array.prototype.map.call(els.mappingList.querySelectorAll('[data-role="source"]'), function (select) {
      return select.value;
    }).filter(Boolean);
    var duplicates = selected.filter(function (name, index) { return selected.indexOf(name) !== index; });
    if (duplicates.length) {
      els.saveHint.textContent = "提醒：同一企业微信列被映射了多次，请确认。";
      return;
    }
    els.saveHint.textContent = currentModule().id === "duty-roster" ? "按日值周：班次、地点可不映射；类型为空按正常处理，放假可不填人员。修改仅保存在本机。" : "修改仅保存在本机。";
  }

  function updateModuleFromForm() {
    var module = currentModule();
    if (!module) return [];
    module.source.documentUrl = normalizedDocumentUrl(els.documentUrl.value);
    els.documentUrl.value = module.source.documentUrl;
    module.source.sheet = els.sheetSelect.value;
    module.source.fields = discoveredFields.map(function (field) { return { name: field.name, type: field.type }; });
    var draft = draftFor(module);
    draft.documentUrl = module.source.documentUrl;
    draft.sheet = module.source.sheet;
    draft.fields = discoveredFields.slice();
    var errors = [];
    module.mappings = Array.prototype.map.call(els.mappingList.querySelectorAll(".mapping-row"), function (row) {
      var source = row.querySelector('[data-role="source"]').value;
      if (row.dataset.required === "true" && !source) errors.push("必填字段尚未映射：" + row.querySelector(".target-box").textContent.split(" · ")[0]);
      return source ? { source: source, target: row.dataset.target, transform: row.querySelector('[data-role="transform"]').value, required: row.dataset.required === "true" } : null;
    }).filter(Boolean);
    if (!module.source.documentUrl) errors.push("请填写智能表格链接");
    if (!module.source.sheet) errors.push("请选择子表");
    if (!discoveredFields.length) errors.push("请先读取当前子表的字段");
    return errors;
  }

  function discover() {
    var url = els.documentUrl.value.trim();
    if (!url) return toast("请填写智能表格链接");
    setBusy(document.getElementById("discoverButton"), true, "读取中");
    post("/api/local-console/discover", { documentUrl: url }).then(function (body) {
      discoveredSheets = body.document.sheets;
      var draft = draftFor(currentModule());
      draft.documentUrl = body.document.documentUrl || url;
      draft.sheets = discoveredSheets.slice();
      draft.documentInfo = body.document.documentName + " · " + discoveredSheets.length + " 个子表";
      els.documentInfo.textContent = body.document.documentName + " · " + discoveredSheets.length + " 个子表";
      renderSheetOptions(draft.sheet || "");
      var selected = discoveredSheets.find(function (item) { return item.title === els.sheetSelect.value; });
      if (draft.sheet !== els.sheetSelect.value || normalizedDocumentUrl(url) !== normalizedDocumentUrl(currentModule().source.documentUrl) ||
          (selected && selected.fieldCount !== undefined && selected.fieldCount !== discoveredFields.length)) {
        invalidateSourceFields();
      }
      toast("子表读取完成");
    }).catch(function (error) { toast(error.message); }).finally(function () {
      setBusy(document.getElementById("discoverButton"), false, "读取子表");
    });
  }

  function loadFields() {
    var url = els.documentUrl.value.trim();
    var sheet = els.sheetSelect.value;
    var moduleId = selectedModuleId;
    if (!url || !sheet) return toast("请先选择智能表格和子表");
    setBusy(document.getElementById("fieldsButton"), true, "读取中");
    post("/api/local-console/fields", { documentUrl: url, sheet: sheet }).then(function (body) {
      if (selectedModuleId !== moduleId || els.sheetSelect.value !== sheet ||
          normalizedDocumentUrl(els.documentUrl.value) !== normalizedDocumentUrl(url)) return;
      discoveredFields = body.fields;
      var draft = draftFor(currentModule());
      draft.documentUrl = url;
      draft.sheet = sheet;
      draft.fields = discoveredFields.slice();
      renderFields();
      renderMappings();
      clearPreview();
      toast("已读取 " + discoveredFields.length + " 个字段");
    }).catch(function (error) { toast(error.message); }).finally(function () {
      setBusy(document.getElementById("fieldsButton"), false, "读取字段");
    });
  }

  function setBusy(button, busy, label) {
    button.disabled = busy;
    button.textContent = label;
  }

  function saveMapping() {
    var errors = updateModuleFromForm();
    if (errors.length) return toast(errors[0]);
    setBusy(document.getElementById("saveButton"), true, "保存中");
    post("/api/local-console/save-mapping", { mappingSet: mappingSet }).then(function (body) {
      mappingSet = body.mappingSet;
      els.mappingUpdate.textContent = formatTime(mappingSet.updatedAt);
      els.saveHint.textContent = "已保存到本机映射配置。";
      toast("字段映射已保存");
    }).catch(function (error) { toast(error.message); }).finally(function () {
      setBusy(document.getElementById("saveButton"), false, "保存字段映射");
    });
  }

  function transformValue(value, transform) {
    var text = String(value == null ? "" : value).trim();
    var number = Number(text);
    if (transform === "date") {
      if (text && Number.isFinite(number) && number > 0 && number < 2958466) {
        var excelDate = new Date(Date.UTC(1899, 11, 30) + Math.floor(number) * 86400000);
        return excelDate.toISOString().slice(0, 10);
      }
      var dateMatch = text.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/);
      return dateMatch ? dateMatch[1] + "-" + dateMatch[2].padStart(2, "0") + "-" + dateMatch[3].padStart(2, "0") : text.slice(0, 10);
    }
    if (transform === "time") {
      if (text && Number.isFinite(number) && number >= 0) {
        var minutes = Math.round((number % 1) * 24 * 60) % (24 * 60);
        return String(Math.floor(minutes / 60)).padStart(2, "0") + ":" + String(minutes % 60).padStart(2, "0");
      }
      var match = text.match(/\b(\d{1,2}:\d{2})\b/);
      return match ? match[1].split(":").map(function (part) { return part.padStart(2, "0"); }).join(":") : text;
    }
    return text;
  }

  function preview() {
    var errors = updateModuleFromForm();
    if (errors.length) return toast(errors[0]);
    var module = currentModule();
    var fieldTitles = module.mappings.map(function (mapping) { return mapping.source; });
    setBusy(document.getElementById("previewButton"), true, "读取中");
    post("/api/local-console/preview", {
      documentUrl: module.source.documentUrl, sheet: module.source.sheet, fieldTitles: fieldTitles
    }).then(function (body) {
      renderPreviewRows(body.rows, module);
      toast("样例数据读取完成");
    }).catch(function (error) { toast(error.message); }).finally(function () {
      setBusy(document.getElementById("previewButton"), false, "预览 8 行");
    });
  }

  function previewPage() {
    var errors = updateModuleFromForm();
    if (errors.length) return toast(errors[0]);
    var module = currentModule();
    var button = document.getElementById("previewPageButton");
    setBusy(button, true, "生成中");
    post("/api/local-console/page-preview", { moduleId: module.id, mappingSet: mappingSet }).then(function (body) {
      els.pagePreviewTitle.textContent = module.name + " · 网页预览";
      els.pagePreviewMeta.textContent = "部分快速预览，不可发布 · " + body.rowCount + " 条数据" + (body.issueCount ? " · " + body.issueCount + " 条需要检查" : " · 字段检查通过");
      els.pagePreviewFrame.src = body.previewUrl + (body.previewUrl.indexOf("?") === -1 ? "?" : "&") + "t=" + Date.now();
      els.pagePreview.hidden = false;
      document.body.style.overflow = "hidden";
      toast(body.issueCount ? "预览已生成，请检查缺失字段" : "网页预览已生成");
    }).catch(function (error) { toast(error.message); }).finally(function () {
      setBusy(button, false, "预览网页");
    });
  }

  function closePagePreview() {
    els.pagePreview.hidden = true;
    els.pagePreviewFrame.src = "about:blank";
    document.body.style.overflow = "";
  }

  var readTask = null, readRunning = false, readStarting = false, readCancelled = false, readModule = null;
  var readProgress = document.getElementById('fullReadProgress');
  try {
    var savedRead = JSON.parse(sessionStorage.getItem('fullReadTask') || 'null');
    if (savedRead && typeof savedRead.task === 'string') {
      readTask = {task: savedRead.task}; readModule = {name: savedRead.name};
      readProgress.textContent = '有一项未完成读取，可继续查询进度或取消。';
      document.getElementById('resumeReadButton').hidden = false;
      readControls(true);
    }
  } catch (_) { sessionStorage.removeItem('fullReadTask'); }
  function readControls(locked) {
    ['fullReadButton', 'previewPageButton', 'releaseButton', 'saveButton'].forEach(function(id) {
      document.getElementById(id).disabled = locked || readRunning || readStarting;
    });
    document.getElementById('cancelReadButton').hidden = !locked;
  }
  async function advanceRead() {
    if (readRunning || !readTask) return;
    readRunning = true;
    document.getElementById('resumeReadButton').hidden = true;
    try {
      readTask = await post('/api/local-console/full-read/status', {task: readTask.task});
      while (!readCancelled && ['reading', 'verifying'].includes(readTask.state)) {
        readProgress.textContent = (readTask.pass === 2 ? '正在复核内容' : '正在完整读取') + '：' + readTask.readCount + ' / ' + readTask.total + ' 行，请暂勿编辑源表。';
        if (readTask.busy) {
          await new Promise(function(resolve) { setTimeout(resolve, 500); });
          readTask = await post('/api/local-console/full-read/status', {task: readTask.task});
        } else readTask = await post('/api/local-console/full-read/next', {task: readTask.task, sequence: readTask.sequence});
      }
      if (readCancelled) return;
      if (readTask.state !== 'ready') throw new Error(readTask.error || '读取已取消或过期，请重新开始');
      var result = readTask.result;
      readProgress.textContent = '完整读取并复核通过：' + result.sourceRowCount + ' 行源记录，生成 ' + result.rowCount + ' 条展示数据。';
      els.pagePreviewTitle.textContent = readModule.name + ' · 完整预览';
      els.pagePreviewMeta.textContent = result.sourceRowCount + ' 行源记录 · ' + result.rowCount + ' 条展示数据 · 两次读取核对通过';
      els.pagePreviewFrame.src = result.previewUrl + '&t=' + Date.now();
      els.pagePreview.hidden = false;
      document.body.style.overflow = 'hidden';
      readTask = null; sessionStorage.removeItem('fullReadTask'); readControls(false);
    } catch (error) {
      if (readCancelled) return;
      readProgress.textContent = error.message + '。未发布数据。可继续查询任务状态，或取消后重新读取。';
      document.getElementById('resumeReadButton').hidden = false;
    } finally { readRunning = false; readControls(!!readTask && !readCancelled); }
  }
  document.getElementById('fullReadButton').onclick = async function() {
    var errors = updateModuleFromForm();
    if (errors.length) return toast(errors[0]);
    readCancelled = false; readStarting = true; readControls(true);
    readModule = JSON.parse(JSON.stringify(currentModule()));
    readProgress.textContent = '正在检查数据源和字段，请暂勿编辑源表…';
    try {
      readTask = await post('/api/local-console/full-read/start', {moduleId: readModule.id, mappingSet: mappingSet});
      sessionStorage.setItem('fullReadTask', JSON.stringify({task:readTask.task, name:readModule.name}));
      if (readCancelled) { await post('/api/local-console/full-read/cancel', {task: readTask.task}); readTask = null; sessionStorage.removeItem('fullReadTask'); return; }
      await advanceRead();
    } catch (error) { readProgress.textContent = error.message; readTask = null; }
    finally { readStarting = false; readControls(!!readTask && !readCancelled); }
  };
  document.getElementById('resumeReadButton').onclick = advanceRead;
  document.getElementById('cancelReadButton').onclick = async function() {
    readCancelled = true;
    document.getElementById('resumeReadButton').hidden = true;
    try {
      if (readTask) await post('/api/local-console/full-read/cancel', {task: readTask.task});
      readProgress.textContent = '已取消读取，未发布数据。';
    } catch (error) { readProgress.textContent = '已停止继续读取；服务器取消未确认，请重新读取，不要发布旧预览。'; }
    finally { readTask = null; sessionStorage.removeItem('fullReadTask'); readControls(false); }
  };

  function renderPreviewRows(rows, module) {
    els.previewCount.textContent = rows.length + " 行";
    if (!rows.length) {
      els.previewTable.innerHTML = '<p class="empty">当前子表没有可预览的数据。</p>';
      return;
    }
    var mappings = module.mappings;
    var fieldByKey = new Map(module.schema.fields.map(function (field) { return [field.key, field]; }));
    els.previewTable.innerHTML = '<table class="preview-table"><thead><tr>' + mappings.map(function (mapping) {
      return '<th>' + escapeHtml(fieldByKey.get(mapping.target).label) + '</th>';
    }).join("") + '</tr></thead><tbody>' + rows.map(function (row) {
      return '<tr>' + mappings.map(function (mapping) {
        return '<td>' + escapeHtml(transformValue(row[mapping.source], mapping.transform)) + '</td>';
      }).join("") + '</tr>';
    }).join("") + '</tbody></table>';
  }

  function clearPreview() {
    els.previewCount.textContent = "0 行";
    els.previewTable.innerHTML = '<p class="empty">完成字段映射后，读取少量样例数据进行检查。</p>';
  }

  document.getElementById("loginForm").addEventListener("submit", submitLogin);
  document.getElementById("logoutButton").addEventListener("click", logout);
  document.getElementById("refreshStatus").addEventListener("click", loadStatus);
  document.getElementById("discoverButton").addEventListener("click", discover);
  document.getElementById("fieldsButton").addEventListener("click", loadFields);
  els.sheetSelect.addEventListener("change", invalidateSourceFields);
  els.documentUrl.addEventListener("change", function () {
    if (normalizedDocumentUrl(els.documentUrl.value) === draftFor(currentModule()).documentUrl) return;
    discoveredSheets = [];
    renderSheetOptions("");
    invalidateSourceFields();
    draftFor(currentModule()).documentUrl = normalizedDocumentUrl(els.documentUrl.value);
  });
  document.getElementById("saveButton").addEventListener("click", saveMapping);
  document.getElementById("previewButton").addEventListener("click", preview);
  document.getElementById("previewPageButton").addEventListener("click", previewPage);
  document.getElementById("closePagePreview").addEventListener("click", closePagePreview);

  initializeAuth();
  document.getElementById('releaseButton').addEventListener('click', function () {
    var errors = updateModuleFromForm();
    if (errors.length) return toast(errors[0]);
    window.dispatchEvent(new CustomEvent('open-release', {detail: JSON.parse(JSON.stringify(currentModule()))}));
  });
})();
