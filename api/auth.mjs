import { adminUser, createAdminToken, safeEqual } from "./_lib/admin-auth.mjs";
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
  const username = body.adminUser || adminUser();
  if (!safeEqual(username, adminUser()) || !safeEqual(body.adminPass, configuredPass)) {
    return Response.json({ ok: false, error: "管理员账号或密码错误" }, { status: 401 });
  }
  return Response.json(
    { ok: true, token: createAdminToken(username), adminUser: username },
    { headers: { "Cache-Control": "no-store" } },
  );
}
