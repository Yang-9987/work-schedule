#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import calendarText from '../assets/js/calendar-text.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ALLOWED_TYPES = new Set(["teaching", "activity", "holiday", "exam"]);
const INJECTION_PATTERN = /(忽略.{0,12}(之前|以上|前面).{0,8}(指令|要求)|你现在是|请执行以下命令|ignore\s+(all\s+)?previous\s+instructions|system\s+prompt)/i;

function fail(message) {
  throw new Error(message);
}

function parseArguments(argv) {
  const result = { config: "config/wecom-calendar.local.json", dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--dry-run") result.dryRun = true;
    else if (argv[index] === "--config" && argv[index + 1]) result.config = argv[++index];
    else fail(`未知参数：${argv[index]}`);
  }
  return result;
}

function readConfig(configPath) {
  const fullPath = path.resolve(ROOT, configPath);
  let config;
  try { config = JSON.parse(fs.readFileSync(fullPath, "utf8")); }
  catch { fail(`无法读取同步配置：${path.relative(ROOT, fullPath)}`); }
  if (!config?.source?.url || !config?.source?.sheet || !config?.source?.fields?.title || !config?.source?.fields?.date) {
    fail("同步配置缺少表格链接、子表名、事件字段或日期字段");
  }
  if (!config?.calendar?.schoolName || !config?.calendar?.academicYear) fail("同步配置缺少学校名称或学年");
  if (!config?.destination?.url) fail("同步配置缺少网站接收地址");
  let destinationUrl;
  try { destinationUrl = new URL(config.destination.url); }
  catch { fail("网站接收地址格式不正确"); }
  if (destinationUrl.protocol !== "https:" && destinationUrl.hostname !== "localhost") {
    fail("网站接收地址必须使用 HTTPS");
  }
  return config;
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  if (result.error?.code === "ENOENT") fail("未找到 wecom-cli，请先安装企业微信命令行工具");
  if (result.status !== 0) fail("企业微信命令执行失败，请检查本机授权和表格权限");
  return result.stdout.trim();
}

function checkCli() {
  const versionOutput = run("wecom-cli", ["--version"]);
  const match = versionOutput.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) fail("无法识别 wecom-cli 版本");
  const version = match.slice(1).map(Number);
  if (version[0] < 1 || (version[0] === 1 && version[1] < 1)) fail("wecom-cli 版本过低，请升级到 1.1.0 或更高版本");
  if (run("wecom-cli", ["auth", "show", "--status"]) !== "authorized") fail("wecom-cli 尚未完成企业微信授权");
}

function parseDocId(urlValue) {
  let url;
  try { url = new URL(urlValue); }
  catch { fail("智能表格链接格式不正确"); }
  const match = url.pathname.match(/^\/smartsheet\/([^/]+)$/);
  if (!match) fail("配置的链接不是企业微信智能表格链接");
  return match[1];
}

function cliJson(args, action) {
  let payload;
  try { payload = JSON.parse(run("wecom-cli", args)); }
  catch (error) {
    if (error instanceof SyntaxError) fail(`${action}返回了无法识别的数据`);
    throw error;
  }
  if (payload.errcode !== 0) fail(`${action}失败：${payload.errmsg || "请检查权限"}`);
  return payload;
}

function quoteIdentifier(value) {
  return `\`${String(value).replaceAll("`", "``")}\``;
}

function configuredFieldNames(config) {
  const fields = config.source.fields;
  return [fields.title, fields.date].filter(Boolean);
}

function verifyStructure(config, docid) {
  const sheets = cliJson([
    "smartsheet", "sheets", "list", "--json", JSON.stringify({ docid }),
  ], "读取子表");
  const sheet = sheets.sheets?.find((item) => item.title === config.source.sheet && item.type === "smartsheet");
  if (!sheet) fail(`未找到配置的子表“${config.source.sheet}”`);

  const fields = cliJson([
    "smartsheet", "fields", "list", "--json",
    JSON.stringify({ docid, sheet_title: config.source.sheet, limit: 1000 }),
  ], "读取字段").fields || [];
  const byTitle = new Map(fields.map((field) => [field.field_title, field]));
  for (const fieldName of configuredFieldNames(config)) {
    if (!byTitle.has(fieldName)) fail(`子表“${config.source.sheet}”缺少配置字段“${fieldName}”`);
  }
  const dateField = byTitle.get(config.source.fields.date);
  if (!new Set(["date_time", "created_time", "modified_time"]).has(dateField.field_type)) {
    fail(`字段“${config.source.fields.date}”必须是日期类型`);
  }
}

function readRows(config, docid) {
  const fields = config.source.fields;
  const selected = [];
  const add = (expression, alias) => {
    if (selected.some((item) => item.alias === alias)) return;
    selected.push({ expression, alias });
  };
  add(quoteIdentifier(fields.title), fields.title);
  add(`DATE_FORMAT(${quoteIdentifier(fields.date)}, "%Y-%m-%d")`, fields.date);
  const sql = `SELECT ${selected.map((item) => `${item.expression} AS ${quoteIdentifier(item.alias)}`).join(", ")} FROM ${quoteIdentifier(config.source.sheet)} LIMIT 501`;
  const payload = cliJson(["smartsheet", "records", "query", "--docid", docid, "--sql", sql], "读取记录");
  const first = payload.values?.[0];
  const result = typeof first === "string" ? JSON.parse(first) : first;
  const rows = result?.rows || [];
  if (rows.length > 500) fail("校历有效范围超过 500 行，请缩小子表数据范围");
  return rows;
}

function text(value) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join("、");
  if (typeof value === "object") return value.name ? String(value.name) : JSON.stringify(value);
  return String(value).trim();
}

function eventType(rawType, calendarConfig) {
  const sourceType = text(rawType);
  const mapped = calendarConfig.typeMap?.[sourceType] || sourceType || calendarConfig.defaultType || "activity";
  return ALLOWED_TYPES.has(mapped) ? mapped : (calendarConfig.defaultType || "activity");
}

export function makeCalendar(config, rows) {
  const fields = config.source.fields;
  const seen = new Map();
  const events = [];
  rows.forEach((row, index) => {
    const title = text(row[fields.title]);
    const date = text(row[fields.date]);
    if (!title && !date) return;
    if (!title || !date) fail(`第 ${index + 1} 行缺少事件或日期`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail(`第 ${index + 1} 行日期格式不正确`);
    const note = '';
    const type = 'activity';
    const content = [title, date, note, type].join("\n");
    if (INJECTION_PATTERN.test(content)) fail(`第 ${index + 1} 行包含不能同步的指令性文本`);
    if (note.length > 120) fail(`第 ${index + 1} 行备注超过 120 个字符`);

    const base = `${date}|${title}|${type}|${note}`;
    const occurrence = (seen.get(base) || 0) + 1;
    seen.set(base, occurrence);
    const id = `wecom-${crypto.createHash("sha256").update(`${base}|${occurrence}`).digest("hex").slice(0, 20)}`;
    const parsed = calendarText.expand([{ id, date, title, type, note }]);
    if (!parsed.length || parsed.some(event => event.title.length > 5000)) fail(`第 ${index + 1} 行事件为空或过长`);
    events.push(...parsed);
  });
  if (events.length > 500) fail('解析后的事件超过 500 条，拒绝截断发布');
  return { schoolName: config.calendar.schoolName, academicYear: config.calendar.academicYear, events };
}

async function publish(config, calendar) {
  let secret = process.env.CALENDAR_SYNC_SECRET || "";
  if (!secret && process.platform === "darwin") {
    const keychain = spawnSync("security", ["find-generic-password", "-s", "ssfyx-calendar-sync", "-w"], {
      encoding: "utf8",
    });
    if (keychain.status === 0) secret = keychain.stdout.trim();
  }
  if (!secret) fail("未找到同步密钥；请配置 CALENDAR_SYNC_SECRET 或 macOS 钥匙串项目 ssfyx-calendar-sync");
  const response = await fetch(config.destination.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Calendar-Sync-Secret": secret },
    body: JSON.stringify({ calendar }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) fail(`网站接收失败：${body.error || response.status}`);
  return body;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const config = readConfig(options.config);
  checkCli();
  const docid = parseDocId(config.source.url);
  verifyStructure(config, docid);
  const calendar = makeCalendar(config, readRows(config, docid));
  if (options.dryRun) {
    console.log(JSON.stringify({ ok: true, mode: "dry-run", eventCount: calendar.events.length, calendar }, null, 2));
    return;
  }
  const result = await publish(config, calendar);
  console.log(JSON.stringify({ ok: true, eventCount: result.eventCount, syncedAt: result.syncedAt }, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`同步失败：${error.message}`);
    process.exitCode = 1;
  });
}
