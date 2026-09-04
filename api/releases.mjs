import { tokenFromRequest, verifyAdminToken } from './_lib/admin-auth.mjs';
import { versionedStore } from './_lib/versioned-store.mjs';
import { validCalendar } from './_lib/calendar-store.mjs';
import { validDuty } from './_lib/duty-store.mjs';
import { validConfig } from './config.mjs';
import model from '../shared/module-mapping-model.cjs';
const validators = { 'work-schedule': validConfig, 'school-calendar': validCalendar, 'duty-roster': validDuty, mappings: model.validMappingSet };
const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export async function GET(request) {
  if (!verifyAdminToken(tokenFromRequest(request))) return json({ error: '需要管理员登录' }, 401);
  const url = new URL(request.url);
  const moduleId = url.searchParams.get('moduleId');
  if (!Object.hasOwn(validators, moduleId)) return json({ error: '未知模块' }, 400);
  try { return json(await versionedStore.history(moduleId, url.searchParams.get('cursor'))); }
  catch { return json({ error: '历史版本暂时不可用' }, 503); }
}
export async function POST(request) {
  if (!verifyAdminToken(tokenFromRequest(request))) return json({ error: '需要管理员登录' }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: '请求格式错误' }, 400); }
  const { moduleId, action } = body;
  const actualEnvironment = process.env.VERCEL_ENV === 'production' ? 'main' : process.env.DATA_ENV;
  if (!body.expectedEnvironment || body.expectedEnvironment !== actualEnvironment) return json({error:'目标环境不匹配'},409);
  if (!Object.hasOwn(validators, moduleId) || !['publish', 'rollback'].includes(action)) return json({ error: '模块或操作无效' }, 400);
  if (body.confirm !== moduleId + ':' + action) return json({ error: '请明确确认模块和操作' }, 400);
  try {
    if (action === 'rollback') return json({ ok: true, ...await versionedStore.rollback(moduleId, body.version, validators[moduleId]) });
    if (!validators[moduleId](body.data)) return json({ error: '数据校验失败' }, 400);
    return json({ ok: true, ...await versionedStore.write(moduleId, body.data) });
  } catch { return json({ error: '写入未启用、版本冲突、版本无效或存储不可用；未自动重试' }, 503); }
}
