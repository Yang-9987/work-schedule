import crypto from "node:crypto";
import { hasBlobConfig } from './_lib/blob-config.mjs';
import { versionedStore } from './_lib/versioned-store.mjs';

const ALLOWED_TYPES = new Set([
  "work", "rest", "key", "student_entry", "lesson", "recess", "eye_exercise",
  "lunch", "hygiene", "broadcast", "nap", "club",
]);

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" },
  });
}
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function validConfig(config) {
  return config && typeof config === "object" && !Array.isArray(config)
    && Array.isArray(config.schedule) && Array.isArray(config.workdays)
    && config.workdays.length === 7 && Array.isArray(config.tips)
    && config.schedule.every((item) => item && typeof item === "object" && ALLOWED_TYPES.has(item.type));
}

export async function GET() {
  try {
    const data = await versionedStore.read('work-schedule');
    return data ? json(data) : json({ error: '作息时间尚未发布' }, 404);
  } catch { return json({ error: 'storage unavailable' }, 503); }

}

export async function POST(request) {
  const configuredPass = process.env.ADMIN_PASS;
  if (!configuredPass || !hasBlobConfig()) {
    return json({ ok: false, error: "server not configured" }, 503);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "invalid json" }, 400);
  }
  if (!safeEqual(body.adminPass, configuredPass)) {
    return json({ ok: false, error: "密码错误" }, 401);
  }
  if (!validConfig(body.config)) {
    return json({ ok: false, error: "config 格式错误" }, 400);
  }

  const config = JSON.parse(JSON.stringify(body.config));
  delete config.adminPass;
  try { return json({ ok: true, ...await versionedStore.write('work-schedule', config) }); }
  catch { return json({ error: '写入未启用、版本冲突或存储不可用' }, 503); }
}

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
