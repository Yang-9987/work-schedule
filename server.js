#!/usr/bin/env node
/**
 * 作息时间表 - 极简后端（零依赖，Node.js 16+）
 *
 * 接口：
 *   GET  /               静态页面（index.html 等，同域部署无需跨域）
 *   GET  /api/health     健康检查（前端用来探测后端是否可用）
 *   GET  /api/config     返回当前作息配置（已剔除 adminPass）
 *   POST /api/config     保存发布作息（body: { adminPass, config }，全员即时生效）
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

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");
const ADMIN_PASS = process.env.ADMIN_PASS || "";
const MAX_BODY = 1024 * 1024; // 请求体上限 1MB

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
const HIDDEN = ["/server.js", "/package.json", "/data", "/data/", "/node_modules"];

function send(res, code, obj) {
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*"
  });
  res.end(JSON.stringify(obj));
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

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://" + (req.headers.host || "localhost"));
  const p = url.pathname;

  // CORS 预检（支持前后端分离部署）
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,X-Admin-Pass",
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
      return safeEqual(data.adminPass, ADMIN_PASS)
        ? send(res, 200, { ok: true })
        : send(res, 401, { ok: false, error: "密码错误" });
    });
    return;
  }

  if (p === "/api/config") {
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

  // ===================== 静态文件 =====================
  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405); res.end(); return; }
  const rel = p === "/" ? "/index.html" : p;
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

server.listen(PORT, () => {
  console.log("作息时间表后端已启动: http://0.0.0.0:" + PORT);
  console.log("配置存储: " + CONFIG_FILE);
  console.log("管理密码: " + (ADMIN_PASS ? "(来自环境变量 ADMIN_PASS)" : "未配置（管理功能不可用）"));
});
