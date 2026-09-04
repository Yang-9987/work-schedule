import { safeEqual } from "./_lib/admin-auth.mjs";
import { hasBlobConfig } from './_lib/blob-config.mjs';
import { validCalendar, writeCalendar } from "./_lib/calendar-store.mjs";

function json(data, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request) {
  const configuredSecret = process.env.CALENDAR_SYNC_SECRET;
  if (!configuredSecret || !hasBlobConfig()) {
    return json({ ok: false, error: "sync service not configured" }, 503);
  }
  if (!safeEqual(request.headers.get("x-calendar-sync-secret") || "", configuredSecret)) {
    return json({ ok: false, error: "同步凭据无效" }, 401);
  }

  let body;
  try { body = await request.json(); }
  catch { return json({ ok: false, error: "invalid json" }, 400); }
  if (!validCalendar(body.calendar)) return json({ ok: false, error: "calendar 格式错误" }, 400);

  try { await writeCalendar(body.calendar); }
  catch { return json({ error: '写入未启用、版本冲突或存储不可用' }, 503); }
  return json({ ok: true, eventCount: body.calendar.events.length, syncedAt: new Date().toISOString() });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: {
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,X-Calendar-Sync-Secret",
  } });
}
