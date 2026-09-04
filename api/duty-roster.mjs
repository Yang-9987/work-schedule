import { tokenFromRequest, verifyAdminToken } from './_lib/admin-auth.mjs';
import { readDuty, validDuty, writeDuty } from './_lib/duty-store.mjs';
const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
export async function GET(request) {
  try {
    const data = await readDuty();
    return data ? json({ data }) : json({ error: '值周排班尚未发布' }, 404);
  } catch { return json({ error: '值周数据暂时不可用' }, 503); }
}
export async function POST(request) {
  if (!verifyAdminToken(tokenFromRequest(request))) return json({ error: '需要管理员登录' }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: '请求格式错误' }, 400); }
  if (!validDuty(body.data)) return json({ error: '值周数据格式错误' }, 400);
  try { return json({ ok: true, ...await writeDuty(body.data) }); }
  catch { return json({ error: '写入未启用、版本冲突或存储不可用' }, 503); }
}
