const crypto = require('node:crypto');
function target(environment, env = process.env) {
  if (!['dev', 'main'].includes(environment)) throw new Error('环境无效');
  const raw = env[environment === 'dev' ? 'RELEASE_DEV_URL' : 'RELEASE_MAIN_URL'];
  if (!raw) throw new Error('目标环境尚未配置');
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('发布地址必须是 HTTPS 网站根地址');
  return url.origin;
}
function fingerprint(module) { return crypto.createHash('sha256').update(JSON.stringify(module)).digest('hex'); }
function publishData(preview, module, owner) {
  if (!preview || preview.mappingFingerprint !== fingerprint(module)) throw new Error('映射已变更或没有预览，请重新生成网页预览');
  if (preview.complete !== true || preview.verifiedPasses !== 2) throw new Error('请先完整读取并预览，部分数据不能发布');
  if (owner !== undefined && preview.owner !== owner) throw new Error('请在当前登录会话重新生成完整预览');
  if (!Number.isInteger(preview.sourceRowCount)) throw new Error('旧预览缺少完整性检查，请重新生成');
  if (preview.issues.length || !preview.rowCount) throw new Error('预览存在错误或为空，不能发布');
  return preview.data;
}
async function remote(environment, endpoint, options = {}, env = process.env, fetcher = fetch) {
  const response = await fetcher(target(environment, env) + endpoint, { ...options, redirect: 'error', signal: AbortSignal.timeout(20000) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || '目标服务请求失败');
  return body;
}
module.exports = { target, fingerprint, publishData, remote };
