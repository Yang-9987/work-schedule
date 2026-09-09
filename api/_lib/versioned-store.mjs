import { get, put, list } from '@vercel/blob';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { hasBlobConfig } from './blob-config.mjs';

function failure(code, message, status = 503) {
  return Object.assign(new Error(message), { code, status, writeStarted: false });
}

export const PATHS = {
  'work-schedule': 'schedule/config.json',
  'school-calendar': 'school-calendar/calendar.json',
  'duty-roster': 'duty-roster/roster.json',
  mappings: 'admin/module-mappings.json',
};

export function storageScope(env = process.env) {
  if (env.VERCEL_ENV === 'preview') {
    if (env.DATA_ENV !== 'dev') throw failure('ENVIRONMENT_CONFIG', 'Preview 必须配置 DATA_ENV=dev');
    return 'dev/';
  }
  if (env.VERCEL_ENV === 'production') {
    if (env.DATA_ENV && env.DATA_ENV !== 'main') throw failure('ENVIRONMENT_CONFIG', 'Production 必须使用 DATA_ENV=main');
    return ''; // Keep existing production paths compatible.
  }
  return env.DATA_ENV === 'dev' ? 'dev/' : '';
}

export function assertWritable(env = process.env) {
  storageScope(env);
  if (!hasBlobConfig(env)) throw failure('STORAGE_CONFIG', '未配置存储');
  if (env.DATA_ENV !== 'dev' && env.DATA_ENV !== 'main') throw failure('ENVIRONMENT_CONFIG', '写入必须显式配置 DATA_ENV');
  if ((env.VERCEL_ENV === 'production' || env.DATA_ENV === 'main') && env.PRODUCTION_DATA_WRITES_ENABLED !== 'true') {
    throw failure('WRITES_DISABLED', '生产数据写入尚未批准启用');
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
    let old;
    try { old = await readPath(path); }
    catch { throw failure('STORAGE_READ_FAILED', '读取当前数据失败，尚未写入'); }
    const version = Date.now() + '-' + randomUUID();
    if (old) {
      if (!old.etag) throw failure('MISSING_ETAG', '缺少版本标识，拒绝覆盖');
      // Fail closed: no current-data overwrite if backup fails.
      try { await io.put(storageScope(env) + 'history/' + moduleId + '/' + version + '.json', JSON.stringify({ moduleId, version, savedAt: new Date().toISOString(), data: old.data }), { ...options, allowOverwrite: false }); }
      catch { throw failure('BACKUP_FAILED', '旧数据备份失败，当前数据未覆盖'); }
    }
    const writeCurrent = etag => io.put(path, JSON.stringify(data), { ...options, allowOverwrite: !!old, ...(etag ? { ifMatch: etag } : {}) });
    try {
      try {
        await writeCurrent(old?.etag);
      } catch (firstError) {
        // A failed response is ambiguous: the write may have succeeded, or the
        // ETag may have changed without a content change. Read once from origin
        // before deciding whether a single conditional retry is safe.
        const current = await readPath(path);
        if (current && isDeepStrictEqual(current.data, data)) return { backupVersion: old ? version : null };
        if (!old || !current || !isDeepStrictEqual(current.data, old.data) || !current.etag) throw firstError;
        try {
          await writeCurrent(current.etag);
        } catch (retryError) {
          const afterRetry = await readPath(path);
          if (!afterRetry || !isDeepStrictEqual(afterRetry.data, data)) throw retryError;
        }
      }
    } catch (error) {
      if (['BlobPreconditionFailedError', 'BlobAlreadyExistsError'].includes(error.name)) {
        throw failure('VERSION_CONFLICT', '目标数据已变化，请重新核对后发布', 409);
      }
      throw Object.assign(new Error('写入响应未确认，请先核对目标数据，勿直接重发'), { code: 'WRITE_UNCONFIRMED', status: 503, writeStarted: true });
    }
    return { backupVersion: old ? version : null };
  }
  async function history(moduleId, cursor) {
    target(moduleId);
    const result = await io.list({ prefix: storageScope(env) + 'history/' + moduleId + '/', limit: 100, ...(cursor ? { cursor } : {}) });
    return { versions: result.blobs.map(blob => ({ version: blob.pathname.split('/').pop().replace(/\.json$/, ''), savedAt: blob.uploadedAt })), cursor: result.cursor, hasMore: result.hasMore };
  }
  async function rollback(moduleId, version, validate) {
    target(moduleId);
    if (!/^\d{13}-[a-f0-9-]{36}$/.test(version || '')) throw failure('INVALID_VERSION', '版本号无效', 400);
    const old = await readPath(storageScope(env) + 'history/' + moduleId + '/' + version + '.json');
    if (!old || old.data.moduleId !== moduleId || !validate(old.data.data)) throw failure('INVALID_VERSION', '版本不存在或数据不兼容', 400);
    return write(moduleId, old.data.data);
  }
  return { read, write, history, rollback };
}
export const versionedStore = createVersionedStore();
