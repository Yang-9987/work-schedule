import crypto from "node:crypto";

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const configuredPass = process.env.ADMIN_PASS;
  if (!configuredPass) {
    return Response.json({ ok: false, error: "server not configured" }, { status: 503 });
  }
  if (!safeEqual(body.adminPass, configuredPass)) {
    return Response.json({ ok: false, error: "密码错误" }, { status: 401 });
  }
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
