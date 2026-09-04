import model from "../shared/module-mapping-model.cjs";
import { hasBlobConfig } from './_lib/blob-config.mjs';
import { tokenFromRequest, verifyAdminToken } from "./_lib/admin-auth.mjs";
import { readMappings, writeMappings } from "./_lib/mapping-store.mjs";

function json(data, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

function authorized(request) {
  return verifyAdminToken(tokenFromRequest(request));
}

export async function GET(request) {
  if (!authorized(request)) return json({ ok: false, error: "需要管理员登录" }, 401);
  try {
    return json({ ok: true, mappingSet: await readMappings() });
  } catch (error) {
    console.error("Failed to read module mappings", error);
    return json({ ok: false, error: "映射存储暂时不可用" }, 503);
  }
}

export async function POST(request) {
  if (!authorized(request)) return json({ ok: false, error: "需要管理员登录" }, 401);
  if (!hasBlobConfig()) return json({ ok: false, error: "映射存储尚未配置" }, 503);
  let body;
  try { body = await request.json(); }
  catch { return json({ ok: false, error: "请求格式不正确" }, 400); }
  if (!model.validMappingSet(body.mappingSet)) return json({ ok: false, error: "映射配置校验失败" }, 400);
  const action = body.action === "publish" ? "publish" : "save";
  const prepared = model.prepareForSave(body.mappingSet, action);
  try {
    await writeMappings(prepared);
    return json({ ok: true, action, mappingSet: prepared });
  } catch (error) {
    console.error("Failed to write module mappings", error);
    return json({ ok: false, error: "映射保存失败" }, 503);
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: {
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
  } });
}
