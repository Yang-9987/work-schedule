import { tokenFromRequest, verifyAdminToken } from './_lib/admin-auth.mjs';
import { versionedStore } from './_lib/versioned-store.mjs';
import { validCalendar } from './_lib/calendar-store.mjs';
import { validDuty } from './_lib/duty-store.mjs';
import { validConfig } from './config.mjs';
import { dataIssues } from '../shared/data-validation.cjs';
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
  if (!verifyAdminToken(tokenFromRequest(request))) return json({ error: '需要管理员登录', writeStarted: false }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: '请求格式错误', writeStarted: false }, 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: '请求格式错误', writeStarted: false }, 400);
  const { moduleId, action } = body;
  const actualEnvironment = process.env.VERCEL_ENV === 'production' ? 'main' : process.env.DATA_ENV;
  if (!body.expectedEnvironment || body.expectedEnvironment !== actualEnvironment) return json({error:'目标环境不匹配', writeStarted:false},409);
  if (!Object.hasOwn(validators, moduleId) || !['publish', 'rollback'].includes(action)) return json({ error: '模块或操作无效', writeStarted: false }, 400);
  if (body.confirm !== moduleId + ':' + action) return json({ error: '请明确确认模块和操作', writeStarted: false }, 400);
  try {
    if (action === 'rollback') return json({ ok: true, ...await versionedStore.rollback(moduleId, body.version, validators[moduleId]) });
    if (!validators[moduleId](body.data)) return json({ error: moduleId === 'mappings' ? '映射校验失败' : dataIssues(moduleId, body.data).join('；'), code: 'VALIDATION_FAILED', writeStarted: false }, 400);
    return json({ ok: true, ...await versionedStore.write(moduleId, body.data) });
  } catch (error) {
    console.error('release write failed', { moduleId, action, code: error?.code, name: error?.name });
    const known = typeof error.writeStarted === 'boolean';
    return json({ error: known ? error.message : '存储不可用，请核对目标数据；未自动重试', ...(known ? { code: error.code, writeStarted: error.writeStarted } : {}) }, known ? error.status : 503);
  }
}
