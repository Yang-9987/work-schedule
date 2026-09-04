const { spawnSync, execFile } = require("node:child_process");

const MIN_VERSION = [1, 1, 0];
const INJECTION_PATTERN = /(忽略.{0,12}(之前|以上|前面).{0,8}(指令|要求)|你现在是|请执行以下命令|ignore\s+(all\s+)?previous\s+instructions|system\s+prompt)/i;

function bridgeError(message, code = "WECOM_ERROR") {
  const error = new Error(message);
  error.code = code;
  return error;
}

function run(args) {
  const result = spawnSync("wecom-cli", args, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024, timeout: 30000 });
  if (result.error?.code === "ETIMEDOUT") throw bridgeError("企业微信读取超时，请重新准备数据");
  if (result.error?.code === "ENOENT") throw bridgeError("未安装企业微信命令行工具", "CLI_MISSING");
  if (result.status !== 0) throw bridgeError("企业微信命令执行失败，请检查本机授权和表格权限");
  return result.stdout.trim();
}

function parseVersion(output) {
  const match = String(output).match(/(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1).map(Number) : null;
}

function versionAtLeast(version, minimum = MIN_VERSION) {
  if (!version) return false;
  for (let index = 0; index < minimum.length; index += 1) {
    if (version[index] > minimum[index]) return true;
    if (version[index] < minimum[index]) return false;
  }
  return true;
}

function status() {
  let versionOutput;
  try { versionOutput = run(["--version"]); }
  catch (error) {
    if (error.code === "CLI_MISSING") return { installed: false, version: "", supported: false, authorized: false };
    throw error;
  }
  const version = parseVersion(versionOutput);
  const supported = versionAtLeast(version);
  let authorization = "unknown";
  if (supported) authorization = run(["auth", "show", "--status"]);
  return { installed: true, version: version ? version.join(".") : "", supported, authorized: authorization === "authorized" };
}

function ensureReady() {
  const state = status();
  if (!state.installed) throw bridgeError("未安装企业微信命令行工具", "CLI_MISSING");
  if (!state.supported) throw bridgeError("企业微信命令行工具版本过低，请升级到 1.1.0 或更高版本", "CLI_OLD");
  if (!state.authorized) throw bridgeError("企业微信尚未授权，请先完成本机授权", "UNAUTHORIZED");
  return state;
}

function parseDocumentUrl(value) {
  let url;
  try { url = new URL(value); }
  catch { throw bridgeError("请输入完整的企业微信智能表格链接", "INVALID_URL"); }
  if (url.protocol !== "https:" || url.hostname !== "doc.weixin.qq.com") {
    throw bridgeError("链接必须来自企业微信文档", "INVALID_URL");
  }
  const match = url.pathname.match(/^\/smartsheet\/([^/]+)\/?$/);
  if (!match) throw bridgeError("该链接不是企业微信智能表格链接", "INVALID_URL");
  return { documentKey: match[1], url: url.origin + url.pathname.replace(/\/$/, "") };
}

function cliJson(args, action) {
  let payload;
  try { payload = JSON.parse(run(args)); }
  catch (error) {
    if (error instanceof SyntaxError) throw bridgeError(action + "返回了无法识别的数据");
    throw error;
  }
  if (payload.errcode !== undefined && payload.errcode !== 0) throw bridgeError(action + "失败，请检查表格权限或内容");
  return payload;
}

function typeName(value) {
  const type = String(value || "text").replace(/^FIELD_TYPE_/i, "").toLowerCase();
  const names = {
    text: "文本", number: "数字", checkbox: "复选框", date_time: "日期", image: "图片",
    attachment: "文件", user: "成员", url: "超链接", select: "多选", single_select: "单选",
    created_user: "创建人", modified_user: "最后编辑人", created_time: "创建时间",
    modified_time: "最后编辑时间", progress: "进度", phone_number: "电话", email: "邮箱",
    reference: "关联", location: "位置", formula: "公式", lookup: "查找引用",
    two_way_link_records: "双向关联", currency: "货币", wwgroup: "群", autonumber: "自动编号",
    percentage: "百分数", barcode: "条码"
  };
  return { type, label: names[type] || "其他" };
}

function listSheets(documentUrl) {
  ensureReady();
  const parsed = parseDocumentUrl(documentUrl);
  const payload = cliJson(["smartsheet", "sheets", "list", "--json", JSON.stringify({ docid: parsed.documentKey })], "读取子表");
  return {
    documentName: String(payload.name || "企业微信智能表格"),
    documentUrl: parsed.url,
    sheets: (payload.sheets || []).filter((sheet) => sheet.type === "smartsheet").map((sheet) => ({
      title: String(sheet.title || ""), fieldCount: Number(sheet.field_count || 0), recordCount: Number.isInteger(sheet.record_count) ? sheet.record_count : null
    })).filter((sheet) => sheet.title)
  };
}

function ensureSheet(documentUrl, sheetTitle) {
  const document = listSheets(documentUrl);
  if (!document.sheets.some((sheet) => sheet.title === sheetTitle)) {
    throw bridgeError("未找到所选子表，请重新读取表格", "SHEET_NOT_FOUND");
  }
  return document;
}

function listFields(documentUrl, sheetTitle) {
  ensureSheet(documentUrl, sheetTitle);
  const parsed = parseDocumentUrl(documentUrl);
  const payload = cliJson([
    "smartsheet", "fields", "list", "--json",
    JSON.stringify({ docid: parsed.documentKey, sheet_title: sheetTitle, limit: 1000 })
  ], "读取字段");
  return (payload.fields || []).map((field) => {
    const type = typeName(field.field_type);
    return { name: String(field.field_title || ""), type: type.type, typeLabel: type.label };
  }).filter((field) => field.name);
}

function readableValue(value) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(readableValue).filter(Boolean).join("、");
  if (typeof value === "object") return String(value.userName || value.name || value.text || value.title || value.address || "");
  return String(value);
}

function assertSafeRows(rows) {
  for (const row of rows) {
    for (const value of Object.values(row)) {
      if (INJECTION_PATTERN.test(readableValue(value))) {
        throw bridgeError("样例数据包含不能处理的指令性文本", "UNSAFE_CONTENT");
      }
    }
  }
}

function listRows(documentUrl, sheetTitle, fieldTitles, limit, maximum) {
  const fields = listFields(documentUrl, sheetTitle);
  const allowed = new Set(fields.map((field) => field.name));
  const selected = Array.from(new Set(fieldTitles)).filter((name) => allowed.has(name));
  if (!selected.length) throw bridgeError("请先选择至少一个有效字段", "NO_FIELDS");
  const parsed = parseDocumentUrl(documentUrl);
  const safeLimit = Math.max(1, Math.min(Number(limit) || 8, maximum, Math.floor(9999 / selected.length)));
  const payload = cliJson([
    "smartsheet", "records", "list", "--json",
    JSON.stringify({ docid: parsed.documentKey, sheet_title: sheetTitle, field_titles: selected, limit: safeLimit })
  ], "读取样例数据");
  const rows = (payload.records || []).map((record) => {
    const values = record.values || record.fields || {};
    const row = {};
    for (const name of selected) row[name] = readableValue(values[name]);
    return row;
  });
  assertSafeRows(rows);
  return { fields, rows };
}

function listSampleRows(documentUrl, sheetTitle, fieldTitles, limit = 8) {
  return listRows(documentUrl, sheetTitle, fieldTitles, limit, 10);
}

function listPreviewRows(documentUrl, sheetTitle, fieldTitles, limit = 200) {
  return listRows(documentUrl, sheetTitle, fieldTitles, limit, 200);
}

function inspectRead(module) {
  const { documentUrl, sheet } = module.source;
  const fields = listFields(documentUrl, sheet);
  const selected = [...new Set(module.mappings.map(mapping => mapping.source))];
  if (!selected.length || selected.some(name => !fields.some(field => field.name === name))) {
    throw bridgeError("映射字段不存在，请重新检查字段映射");
  }
  const total = ensureSheet(documentUrl, sheet).sheets.find(item => item.title === sheet).recordCount;
  return { total, fields: selected.map(name => fields.find(field => field.name === name)) };
}

// Async record requests let cancellation/status requests run while the CLI is busy.
function readPage(module, cursor, limit) {
  const selected = [...new Set(module.mappings.map(mapping => mapping.source))];
  const params = { docid: parseDocumentUrl(module.source.documentUrl).documentKey,
    sheet_title: module.source.sheet, field_titles: selected, limit };
  if (cursor) params.cursor = cursor;
  return new Promise((resolve, reject) => {
    execFile('wecom-cli', ['smartsheet', 'records', 'list', '--json', JSON.stringify(params)],
      { encoding: 'utf8', timeout: 30000, maxBuffer: 10 * 1024 * 1024 }, (error, stdout) => {
        if (error) return reject(bridgeError('企业微信分页读取失败或超时，请检查授权后重新读取'));
        try {
          const payload = JSON.parse(stdout);
          if (!payload || typeof payload !== 'object' || Array.isArray(payload)
            || (payload.errcode !== undefined && payload.errcode !== 0)) throw new Error();
          resolve(payload);
        } catch { reject(bridgeError('企业微信分页响应无效，请检查表格权限或更新工具')); }
      });
  }).catch(error => {
    // Recheck sheet existence, never retry the failed record request blindly.
    ensureSheet(module.source.documentUrl, module.source.sheet);
    throw error;
  });
}

module.exports = { inspectRead, readPage, assertSafeRows, listFields, listPreviewRows, listSampleRows, listSheets, parseDocumentUrl, readableValue, status, versionAtLeast };
