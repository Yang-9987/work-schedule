import crypto from "node:crypto";
import { get, put } from "@vercel/blob";

const CONFIG_PATH = "schedule/config.json";
const FALLBACK_CONFIG = {
  company: "联调测试公司",
  schedule: [
    { name: "上午工作", start: "09:00", end: "12:00", type: "work", desc: "专注" },
  ],
  workdays: [false, true, true, true, true, true, false],
  tips: ["测试"],
};

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

function validConfig(config) {
  return config && typeof config === "object" && !Array.isArray(config)
    && Array.isArray(config.schedule) && Array.isArray(config.workdays)
    && config.workdays.length === 7 && Array.isArray(config.tips);
}

export async function GET() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return json(FALLBACK_CONFIG);
  try {
    const result = await get(CONFIG_PATH, { access: "private" });
    if (!result || result.statusCode !== 200 || !result.stream) return json(FALLBACK_CONFIG);
    const stored = await new Response(result.stream).json();
    return json(stored);
  } catch (error) {
    if (error?.name === "BlobNotFoundError") return json(FALLBACK_CONFIG);
    console.error("Failed to read schedule config", error);
    return json({ ok: false, error: "storage unavailable" }, 503);
  }
}

export async function POST(request) {
  const configuredPass = process.env.ADMIN_PASS;
  if (!configuredPass || !process.env.BLOB_READ_WRITE_TOKEN) {
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
  await put(CONFIG_PATH, JSON.stringify(config, null, 2), {
    access: "private",
    allowOverwrite: true,
    contentType: "application/json; charset=utf-8",
    cacheControlMaxAge: 60,
  });
  return json({ ok: true });
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
