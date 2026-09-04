#!/usr/bin/env node
/**
 * 校园工作台 - 本地后端（零依赖，Node.js 16+）
 *
 * 接口：
 *   GET  /               静态页面（index.html 等，同域部署无需跨域）
 *   GET  /api/health     健康检查（前端用来探测后端是否可用）
 *   GET/POST /api/config   读取/发布作息配置（保留兼容路径）
 *   GET/POST /api/calendar 读取/发布校历配置
 *   GET/POST /api/module-mappings 读取/保存网页与表格映射
 *
 * 配置存储：data/config.json（自动创建）
 * 管理密码：必须通过环境变量 ADMIN_PASS 设置，不写入代码或配置文件。
 *
 * 运行：node server.js   （建议用 pm2 保活：pm2 start server.js --name schedule）
 * 端口：环境变量 PORT，默认 3000
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const mappingModel = require("./shared/module-mapping-model.cjs");
const localConsoleAuth = require("./shared/local-console-auth.cjs");
const wecomBridge = require("./shared/wecom-bridge.cjs");
const previewModel = require("./shared/preview-model.cjs");
const releaseClient = require('./shared/release-client.cjs');

const PORT = Number(process.env.PORT) || 3000;
const LOCAL_CONSOLE_MODE = process.env.LOCAL_CONSOLE_MODE === "1";
const HOST = LOCAL_CONSOLE_MODE ? "127.0.0.1" : (process.env.HOST || "0.0.0.0");
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");
const CALENDAR_FILE = path.join(DATA_DIR, "calendar.json");
const MAPPINGS_FILE = path.join(DATA_DIR, "module-mappings.json");
const LOCAL_AUTH_FILE = path.join(DATA_DIR, "local-console-auth.json");
const ADMIN_PASS = process.env.ADMIN_PASS || "";
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const CALENDAR_SYNC_SECRET = process.env.CALENDAR_SYNC_SECRET || "";
const MAX_BODY = 1024 * 1024; // 请求体上限 1MB
const localPagePreviews = new Map();
const readOwner = req => crypto.createHash('sha256').update(localConsoleToken(req)).digest('hex');
const fullReader = require('./shared/paged-read.cjs').createReader({ finish(module, rows, proof) {
  const built = previewModel.pageData(module, rows);
  const rowCount = (built.data.events || built.data.schedule || built.data.rows || []).length;
  // Keep existing cloud validator limits explicit; never silently truncate output.
  if (module.id === 'school-calendar' && rowCount > 500) throw new Error('校历解析后超过 500 条事件的当前发布容量，请缩小源表范围');
  if (module.id === 'duty-roster' && rowCount > 2000) throw new Error('值周数据超过 2000 条的当前发布容量');
  if (Buffer.byteLength(JSON.stringify(built.data)) > 900 * 1024) throw new Error('解析数据超过发布大小上限，请缩小源表范围');
  if (built.issues.length || !rowCount) throw new Error('完整数据存在解析问题或为空，请检查样例和字段映射');
  const preview = { ...proof, moduleId: module.id, moduleName: module.name, route: module.route,
    mappingFingerprint: releaseClient.fingerprint(module), generatedAt: new Date().toISOString(),
    rowCount, issues: built.issues, data: built.data };
  localPagePreviews.set(module.id, preview);
  return { previewUrl: module.route + '?localPreview=1', rowCount, sourceRowCount: rows.length, issueCount: 0 };
} });
setInterval(() => fullReader.sweep(), 60000).unref();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};
// 不对外暴露的文件/目录
const HIDDEN = ["/server.js", "/package.json", "/data", "/data/", "/config", "/config/", "/shared", "/shared/", "/node_modules"];

function send(res, code, obj) {
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*"
  });
  res.end(JSON.stringify(obj));
}

function readRequestJson(req, maxBytes = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("request too large"));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on("end", () => {
      try { resolve(JSON.parse(body || "{}")); }
      catch { reject(new Error("invalid json")); }
    });
    req.on("error", reject);
  });
}

function localConsoleAllowed(req) {
  if (!LOCAL_CONSOLE_MODE) return false;
  const address = req.socket.remoteAddress || "";
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function localConsoleToken(req) {
  const authorization = req.headers.authorization || "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
}

function loadStored() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch (e) {
    return null;
  }
}
function saveStored(cfg) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = CONFIG_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), "utf8");
  fs.renameSync(tmp, CONFIG_FILE); // 原子替换，避免写一半
}
function loadJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (e) { return null; }
}
function saveJson(file, value) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(tmp, file);
}
function validCalendar(calendar) {
  const types = new Set(["teaching", "activity", "holiday", "exam"]);
  return calendar && typeof calendar === "object" && !Array.isArray(calendar)
    && typeof calendar.schoolName === "string" && typeof calendar.academicYear === "string"
    && Array.isArray(calendar.events) && calendar.events.length <= 500
    && calendar.events.every((event) => event && typeof event.id === "string"
      && /^\d{4}-\d{2}-\d{2}$/.test(event.date)
      && typeof event.title === "string" && event.title.length > 0 && event.title.length <= 5000
      && types.has(event.type) && typeof (event.note || "") === "string" && (event.note || "").length <= 120);
}
function publicOf(stored) {
  const c = JSON.parse(JSON.stringify(stored));
  delete c.adminPass;
  return c;
}
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const ba = Buffer.from(a), bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}
function createAdminToken(username) {
  const payload = Buffer.from(JSON.stringify({
    sub: username,
    exp: Math.floor(Date.now() / 1000) + 8 * 60 * 60
  })).toString("base64url");
  const signature = crypto.createHmac("sha256", ADMIN_PASS).update(payload).digest("base64url");
  return payload + "." + signature;
}
function verifyAdminToken(req) {
  if (!ADMIN_PASS) return false;
  const authorization = req.headers.authorization || "";
  if (!authorization.startsWith("Bearer ")) return false;
  const parts = authorization.slice(7).split(".");
  if (parts.length !== 2) return false;
  const expected = crypto.createHmac("sha256", ADMIN_PASS).update(parts[0]).digest("base64url");
  if (!safeEqual(parts[1], expected)) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    return payload.sub === ADMIN_USER && Number(payload.exp) > Math.floor(Date.now() / 1000);
  } catch (e) { return false; }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://" + (req.headers.host || "localhost"));
  const p = url.pathname;

  // CORS 预检（支持前后端分离部署）
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,X-Admin-Pass,Authorization,X-Calendar-Sync-Secret",
      "Access-Control-Max-Age": "86400"
    });
    res.end();
    return;
  }

  // ===================== API =====================
  if (p === "/api/health") {
    return send(res, ADMIN_PASS ? 200 : 503, { ok: Boolean(ADMIN_PASS), t: Date.now() });
  }

  if (p === "/api/auth" && req.method === "POST") {
    if (!ADMIN_PASS) return send(res, 503, { ok: false, error: "server not configured" });
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 4096) req.destroy();
    });
    req.on("end", () => {
      let data;
      try { data = JSON.parse(body); } catch (e) { return send(res, 400, { ok: false, error: "invalid json" }); }
      const username = data.adminUser || ADMIN_USER;
      return safeEqual(username, ADMIN_USER) && safeEqual(data.adminPass, ADMIN_PASS)
        ? send(res, 200, { ok: true, token: createAdminToken(username), adminUser: username })
        : send(res, 401, { ok: false, error: "管理员账号或密码错误" });
    });
    return;
  }

  if (p === "/api/config" || p === "/api/schedule") {
    if (req.method === "GET") {
      const stored = loadStored();
      if (!stored) return send(res, 404, { ok: false, error: "no config yet" });
      return send(res, 200, publicOf(stored));
    }
    if (req.method === "POST") {
      let body = "";
      let size = 0;
      req.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY) { req.destroy(); return; }
        body += chunk;
      });
      req.on("end", () => {
        let data;
        try { data = JSON.parse(body); } catch (e) { return send(res, 400, { ok: false, error: "invalid json" }); }
        if (!ADMIN_PASS) return send(res, 503, { ok: false, error: "server not configured" });
        if (!safeEqual(data.adminPass, ADMIN_PASS)) {
          return send(res, 401, { ok: false, error: "密码错误" });
        }
        const cfg = data.config;
        if (!cfg || typeof cfg !== "object") {
          return send(res, 400, { ok: false, error: "config 缺失" });
        }
        delete cfg.adminPass;
        saveStored(cfg);
        console.log("[" + new Date().toLocaleString() + "] 配置已发布更新");
        return send(res, 200, { ok: true });
      });
      req.on("error", () => send(res, 400, { ok: false, error: "bad request" }));
      return;
    }
    return send(res, 405, { ok: false, error: "method not allowed" });
  }

  if (p === '/api/duty-roster' && req.method === 'GET') {
    const duty = loadJson(path.join(DATA_DIR, 'duty-roster.json'));
    return duty ? send(res, 200, { data: duty }) : send(res, 404, { error: '值周排班尚未发布' });
  }
  if (p === "/api/calendar") {
    if (req.method === "GET") {
      const calendar = loadJson(CALENDAR_FILE);
      if (!calendar) return send(res, 404, { ok: false, error: "no calendar yet" });
      return send(res, 200, calendar);
    }
    if (req.method === "POST") {
      if (!verifyAdminToken(req)) return send(res, 401, { ok: false, error: "需要管理员登录" });
      let body = "";
      let size = 0;
      req.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY) { req.destroy(); return; }
        body += chunk;
      });
      req.on("end", () => {
        let data;
        try { data = JSON.parse(body); } catch (e) { return send(res, 400, { ok: false, error: "invalid json" }); }
        if (!ADMIN_PASS) return send(res, 503, { ok: false, error: "server not configured" });
        if (!validCalendar(data.calendar)) return send(res, 400, { ok: false, error: "calendar 格式错误" });
        saveJson(CALENDAR_FILE, data.calendar);
        console.log("[" + new Date().toLocaleString() + "] 校历已发布更新");
        return send(res, 200, { ok: true });
      });
      req.on("error", () => send(res, 400, { ok: false, error: "bad request" }));
      return;
    }
    return send(res, 405, { ok: false, error: "method not allowed" });
  }

  if (p === "/api/calendar-sync") {
    if (req.method !== "POST") return send(res, 405, { ok: false, error: "method not allowed" });
    if (!CALENDAR_SYNC_SECRET) return send(res, 503, { ok: false, error: "sync service not configured" });
    if (!safeEqual(req.headers["x-calendar-sync-secret"] || "", CALENDAR_SYNC_SECRET)) {
      return send(res, 401, { ok: false, error: "同步凭据无效" });
    }
    let body = "";
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) { req.destroy(); return; }
      body += chunk;
    });
    req.on("end", () => {
      let data;
      try { data = JSON.parse(body); } catch (e) { return send(res, 400, { ok: false, error: "invalid json" }); }
      if (!validCalendar(data.calendar)) return send(res, 400, { ok: false, error: "calendar 格式错误" });
      saveJson(CALENDAR_FILE, data.calendar);
      return send(res, 200, { ok: true, eventCount: data.calendar.events.length, syncedAt: new Date().toISOString() });
    });
    req.on("error", () => send(res, 400, { ok: false, error: "bad request" }));
    return;
  }

  if (p === "/api/module-mappings") {
    if (!verifyAdminToken(req)) return send(res, 401, { ok: false, error: "需要管理员登录" });
    if (req.method === "GET") {
      const stored = loadJson(MAPPINGS_FILE);
      return send(res, 200, {
        ok: true,
        mappingSet: mappingModel.validMappingSet(stored) ? mappingModel.upgradeMappingSet(stored) : mappingModel.cloneSeed()
      });
    }
    if (req.method === "POST") {
      let body = "";
      let size = 0;
      req.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY) { req.destroy(); return; }
        body += chunk;
      });
      req.on("end", () => {
        let data;
        try { data = JSON.parse(body); }
        catch (e) { return send(res, 400, { ok: false, error: "请求格式不正确" }); }
        if (!mappingModel.validMappingSet(data.mappingSet)) {
          return send(res, 400, { ok: false, error: "映射配置校验失败" });
        }
        const action = data.action === "publish" ? "publish" : "save";
        const prepared = mappingModel.prepareForSave(data.mappingSet, action);
        saveJson(MAPPINGS_FILE, prepared);
        return send(res, 200, { ok: true, action, mappingSet: prepared });
      });
      req.on("error", () => send(res, 400, { ok: false, error: "bad request" }));
      return;
    }
    return send(res, 405, { ok: false, error: "method not allowed" });
  }

  if (p.startsWith("/api/local-console/")) {
    if (!localConsoleAllowed(req)) return send(res, 404, { ok: false, error: "not found" });
    const authRecord = loadJson(LOCAL_AUTH_FILE);
    const authConfigured = localConsoleAuth.validRecord(authRecord);
    if (p === "/api/local-console/auth/status" && req.method === "GET") {
      return send(res, 200, { ok: true, configured: authConfigured });
    }
    if (p === "/api/local-console/auth/setup" && req.method === "POST") {
      if (authConfigured) return send(res, 409, { ok: false, error: "本地密码已经设置" });
      readRequestJson(req, 4096).then((body) => {
        const record = localConsoleAuth.createRecord(body.password);
        saveJson(LOCAL_AUTH_FILE, record);
        return send(res, 200, { ok: true, token: localConsoleAuth.createToken(record) });
      }).catch((error) => send(res, 400, { ok: false, error: error.message }));
      return;
    }
    if (p === "/api/local-console/auth/login" && req.method === "POST") {
      if (!authConfigured) return send(res, 409, { ok: false, error: "请先设置本地密码" });
      readRequestJson(req, 4096).then((body) => {
        if (!localConsoleAuth.verifyPassword(body.password, authRecord)) {
          return send(res, 401, { ok: false, error: "密码错误" });
        }
        return send(res, 200, { ok: true, token: localConsoleAuth.createToken(authRecord) });
      }).catch((error) => send(res, 400, { ok: false, error: error.message }));
      return;
    }
    if (!authConfigured || !localConsoleAuth.verifyToken(localConsoleToken(req), authRecord)) {
      return send(res, 401, { ok: false, error: "需要登录本地工作台" });
    }
    if (p === "/api/local-console/status" && req.method === "GET") {
      try { return send(res, 200, { ok: true, wecom: wecomBridge.status() }); }
      catch (error) { return send(res, 503, { ok: false, error: error.message }); }
    }
    if (p === "/api/local-console/mappings" && req.method === "GET") {
      const stored = loadJson(MAPPINGS_FILE);
      return send(res, 200, {
        ok: true,
        mappingSet: mappingModel.validMappingSet(stored) ? mappingModel.upgradeMappingSet(stored) : mappingModel.cloneSeed()
      });
    }
    if (p === "/api/local-console/page-preview" && req.method === "GET") {
      const moduleId = url.searchParams.get("moduleId") || "";
      const preview = localPagePreviews.get(moduleId);
      if (!preview) return send(res, 404, { ok: false, error: "请先在本地工作台生成网页预览" });
      if (preview.owner && preview.owner !== readOwner(req)) return send(res, 404, { ok: false, error: '请在当前会话生成预览' });
      const { owner, ...publicPreview } = preview;
      return send(res, 200, { ok: true, preview: publicPreview });
    }
    if (p === '/api/local-console/releases/targets' && req.method === 'GET') {
      return send(res, 200, { targets: ['dev', 'main'].map(environment => {
        let origin = ''; try { origin = releaseClient.target(environment); } catch {}
        return { environment, origin, writable: !!origin && (environment === 'dev' || process.env.RELEASE_MAIN_ENABLED === 'true') };
      }) });
    }
    if (req.method !== "POST") return send(res, 405, { ok: false, error: "method not allowed" });
    readRequestJson(req).then(async (body) => {
      if (p.startsWith('/api/local-console/full-read/')) {
        const owner = readOwner(req);
        if (p.endsWith('/start')) {
          if (!mappingModel.validMappingSet(body.mappingSet)) throw new Error('映射配置校验失败');
          const module = body.mappingSet.modules.find(item => item.id === body.moduleId);
          if (!module) throw new Error('未找到网页模块');
          localPagePreviews.delete(module.id);
          return send(res, 200, fullReader.start(owner, module));
        }
        if (p.endsWith('/next')) return send(res, 200, await fullReader.next(owner, body.task, body.sequence));
        if (p.endsWith('/status')) return send(res, 200, fullReader.status(owner, body.task));
        if (p.endsWith('/cancel')) {
          const state = fullReader.cancel(owner, body.task);
          const preview = localPagePreviews.get(state.moduleId);
          if (preview?.owner === owner) localPagePreviews.delete(state.moduleId);
          return send(res, 200, state);
        }
        throw new Error('读取操作无效');
      }
      if (p.startsWith('/api/local-console/releases/')) {
        const environment = body.environment;
        releaseClient.target(environment);
        if (p.endsWith('/login')) return send(res, 200, await releaseClient.remote(environment, '/api/auth', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({adminUser:body.username,adminPass:body.password})}));
        const headers = {'Content-Type':'application/json',Authorization:'Bearer ' + String(body.token || '')};
        if (!['school-calendar','work-schedule','duty-roster'].includes(body.moduleId)) throw new Error('模块无效');
        if (p.endsWith('/history')) return send(res, 200, await releaseClient.remote(environment, '/api/releases?moduleId=' + body.moduleId + (body.cursor ? '&cursor=' + encodeURIComponent(body.cursor) : ''), {headers}));
        if (!p.endsWith('/publish') && !p.endsWith('/rollback')) throw new Error('操作无效');
        if (environment === 'main' && process.env.RELEASE_MAIN_ENABLED !== 'true') throw new Error('正式环境尚未批准开放');
        const action = p.endsWith('/publish') ? 'publish' : 'rollback';
        if (body.confirm !== environment + ':' + body.moduleId + ':' + action) throw new Error('确认信息不匹配');
        let data;
        if (action === 'publish') {
          const module = body.module;
          if (!module || module.id !== body.moduleId) throw new Error('模块不匹配');
          data = releaseClient.publishData(localPagePreviews.get(body.moduleId), module, readOwner(req));
        }
        return send(res, 200, await releaseClient.remote(environment, '/api/releases', { method:'POST',headers,body:JSON.stringify({moduleId:body.moduleId,action,data,version:body.version,confirm:body.moduleId+':'+action,expectedEnvironment:environment}) }));
      }
      if (p === "/api/local-console/discover") {
        return send(res, 200, { ok: true, document: wecomBridge.listSheets(body.documentUrl) });
      }
      if (p === "/api/local-console/fields") {
        return send(res, 200, { ok: true, fields: wecomBridge.listFields(body.documentUrl, body.sheet) });
      }
      if (p === "/api/local-console/preview") {
        const result = wecomBridge.listSampleRows(body.documentUrl, body.sheet, body.fieldTitles || [], 8);
        return send(res, 200, { ok: true, fields: result.fields, rows: result.rows });
      }
      if (p === "/api/local-console/page-preview") {
        if (!mappingModel.validMappingSet(body.mappingSet)) {
          return send(res, 400, { ok: false, error: "映射配置校验失败" });
        }
        const module = body.mappingSet.modules.find((item) => item.id === body.moduleId);
        if (!module) return send(res, 404, { ok: false, error: "未找到网页模块" });
        fullReader.revoke(module.id);
        localPagePreviews.delete(module.id);
        const fieldTitles = module.mappings.map((mapping) => mapping.source);
        const result = wecomBridge.listPreviewRows(module.source.documentUrl, module.source.sheet, fieldTitles, 200);
        const built = previewModel.pageData(module, result.rows);
        const preview = {
          moduleId: module.id,
          mappingFingerprint: releaseClient.fingerprint(module),
          sourceRowCount: result.rows.length,
          complete: false,
          owner: readOwner(req),
          moduleName: module.name,
          route: module.route,
          generatedAt: new Date().toISOString(),
          rowCount: Array.isArray(built.data.events) ? built.data.events.length
            : Array.isArray(built.data.schedule) ? built.data.schedule.length
              : Array.isArray(built.data.rows) ? built.data.rows.length : 0,
          issues: built.issues,
          data: built.data
        };
        localPagePreviews.set(module.id, preview);
        return send(res, 200, {
          ok: true,
          previewUrl: module.route + "?localPreview=1",
          rowCount: preview.rowCount,
          issueCount: preview.issues.length
        });
      }
      if (p === "/api/local-console/save-mapping") {
        if (!mappingModel.validMappingSet(body.mappingSet)) {
          return send(res, 400, { ok: false, error: "映射配置校验失败" });
        }
        const prepared = mappingModel.prepareForSave(body.mappingSet, "save");
        saveJson(MAPPINGS_FILE, prepared);
        return send(res, 200, { ok: true, mappingSet: prepared });
      }
      return send(res, 404, { ok: false, error: "not found" });
    }).catch((error) => send(res, error.code === "UNSAFE_CONTENT" ? 422 : 400, { ok: false, error: error.message }));
    return;
  }

  // ===================== 静态文件 =====================
  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); res.end(); return; }
  const routeFiles = {
    "/": "/index.html",
    "/work-schedule": "/modules/work-schedule/index.html",
    "/work-schedule/": "/modules/work-schedule/index.html",
    "/school-calendar": "/modules/school-calendar/index.html",
    "/school-calendar/": "/modules/school-calendar/index.html",
    "/duty-roster": "/modules/duty-roster/index.html",
    "/duty-roster/": "/modules/duty-roster/index.html",
    "/admin/mappings": "/admin/mappings/index.html",
    "/admin/mappings/": "/admin/mappings/index.html",
    "/admin/calendar/": "/modules/school-calendar/index.html",
    "/admin/calendar": "/modules/school-calendar/index.html",
    "/local-console": "/local-console/index.html",
    "/local-console/": "/local-console/index.html"
  };
  const rel = routeFiles[p] || p;
  if (HIDDEN.some((h) => rel === h || rel.startsWith(h))) { res.writeHead(404); res.end(); return; }
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("404 Not Found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Cache-Control": path.extname(file) === ".html" ? "no-cache" : "public, max-age=3600"
    });
    res.end(data);
  });
});

server.listen(PORT, HOST, () => {
  console.log("校园工作台后端已启动: http://" + HOST + ":" + PORT);
  if (LOCAL_CONSOLE_MODE) console.log("本地工作台: http://127.0.0.1:" + PORT + "/local-console/");
  console.log("配置存储: " + CONFIG_FILE);
  console.log("管理密码: " + (ADMIN_PASS ? "(来自环境变量 ADMIN_PASS)" : "未配置（管理功能不可用）"));
});
