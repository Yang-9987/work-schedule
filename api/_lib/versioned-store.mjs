import { get, put, list } from '@vercel/blob';
import { randomUUID } from 'node:crypto';
import { hasBlobConfig } from './blob-config.mjs';

export const PATHS = {
  'work-schedule': 'schedule/config.json',
  'school-calendar': 'school-calendar/calendar.json',
  'duty-roster': 'duty-roster/roster.json',
  mappings: 'admin/module-mappings.json',
};

export function storageScope(env = process.env) {
  if (env.VERCEL_ENV === 'preview') {
    if (env.DATA_ENV !== 'dev') throw new Error('Preview 必须配置 DATA_ENV=dev');
    return 'dev/';
  }
  if (env.VERCEL_ENV === 'production') {
    if (env.DATA_ENV && env.DATA_ENV !== 'main') throw new Error('Production 必须使用 DATA_ENV=main');
    return ''; // Keep existing production paths compatible.
  }
  return env.DATA_ENV === 'dev' ? 'dev/' : '';
}

export function assertWritable(env = process.env) {
  storageScope(env);
  if (!hasBlobConfig(env)) throw new Error('未配置存储');
  if (env.DATA_ENV !== 'dev' && env.DATA_ENV !== 'main') throw new Error('写入必须显式配置 DATA_ENV');
  if ((env.VERCEL_ENV === 'production' || env.DATA_ENV === 'main') && env.PRODUCTION_DATA_WRITES_ENABLED !== 'true') {
    throw new Error('生产数据写入尚未批准启用');
  }
}

// Injectable storage enables failure/concurrency tests without accessing a real store.
export function createVersionedStore(io = { get, put, list }, env = process.env) {
  function target(moduleId) {
    if (!Object.hasOwn(PATHS, moduleId)) throw new Error('未知模块');
    return storageScope(env) + PATHS[moduleId];
  }
  async function readPath(path) {
    try {
      const result = await io.get(path, { access: 'private', useCache: false });
      if (!result || result.statusCode === 404) return null;
      if (result.statusCode !== 200 || !result.stream) throw new Error('读取存储失败');
      return { data: await new Response(result.stream).json(), etag: result.blob?.etag };
    } catch (error) {
      if (error.name === 'BlobNotFoundError') return null;
      throw error;
    }
  }
  const options = { access: 'private', addRandomSuffix: false, contentType: 'application/json', cacheControlMaxAge: 60 };
  async function read(moduleId) {
    const path = target(moduleId);
    if (!hasBlobConfig(env)) return null;
    return (await readPath(path))?.data ?? null;
  }
  async function write(moduleId, data) {
    assertWritable(env);
    const path = target(moduleId);
    const old = await readPath(path);
    const version = Date.now() + '-' + randomUUID();
    if (old) {
      if (!old.etag) throw new Error('缺少版本标识，拒绝覆盖');
      // Fail closed: no current-data overwrite if backup fails.
      await io.put(storageScope(env) + 'history/' + moduleId + '/' + version + '.json', JSON.stringify({ moduleId, version, savedAt: new Date().toISOString(), data: old.data }), { ...options, allowOverwrite: false });
    }
    await io.put(path, JSON.stringify(data), { ...options, allowOverwrite: !!old, ...(old ? { ifMatch: old.etag } : {}) });
    return { backupVersion: old ? version : null };
  }
  async function history(moduleId, cursor) {
    target(moduleId);
    const result = await io.list({ prefix: storageScope(env) + 'history/' + moduleId + '/', limit: 100, ...(cursor ? { cursor } : {}) });
    return { versions: result.blobs.map(blob => ({ version: blob.pathname.split('/').pop().replace(/\.json$/, ''), savedAt: blob.uploadedAt })), cursor: result.cursor, hasMore: result.hasMore };
  }
  async function rollback(moduleId, version, validate) {
    target(moduleId);
    if (!/^\d{13}-[a-f0-9-]{36}$/.test(version || '')) throw new Error('版本号无效');
    const old = await readPath(storageScope(env) + 'history/' + moduleId + '/' + version + '.json');
    if (!old || old.data.moduleId !== moduleId || !validate(old.data.data)) throw new Error('版本不存在或数据不兼容');
    return write(moduleId, old.data.data);
  }
  return { read, write, history, rollback };
}
export const versionedStore = createVersionedStore();
