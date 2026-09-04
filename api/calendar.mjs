import { tokenFromRequest, verifyAdminToken } from "./_lib/admin-auth.mjs";
import { hasBlobConfig } from './_lib/blob-config.mjs';
import { readCalendar, validCalendar, writeCalendar } from "./_lib/calendar-store.mjs";

function json(data, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}
export async function GET(request) {
  try {
    return json(await readCalendar());
  } catch (error) {
    console.error("Failed to read calendar", error);
    return json({ ok: false, error: "storage unavailable" }, 503);
  }
}

export async function POST(request) {
  if (!process.env.ADMIN_PASS || !hasBlobConfig()) {
    return json({ ok: false, error: "server not configured" }, 503);
  }
  if (!verifyAdminToken(tokenFromRequest(request))) return json({ ok: false, error: "需要管理员登录" }, 401);
  let body;
  try { body = await request.json(); }
  catch { return json({ ok: false, error: "invalid json" }, 400); }
  if (!validCalendar(body.calendar)) return json({ ok: false, error: "calendar 格式错误" }, 400);
  try { return json({ ok: true, ...await writeCalendar(body.calendar) }); }
  catch { return json({ error: '写入未启用、版本冲突或存储不可用' }, 503); }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: {
    "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
  } });
}
