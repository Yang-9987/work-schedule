const { randomUUID, createHash } = require('node:crypto');
const bridge = require('./wecom-bridge.cjs');
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const active = job => ['reading', 'verifying'].includes(job.state);

function parsePage(payload, names, limit, progress = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
    || (payload.errcode !== undefined && payload.errcode !== 0)) throw new Error('分页响应失败');
  const records = payload.records === undefined && payload.errcode === 0 ? [] : payload.records;
  if (!Array.isArray(records) || records.length > limit) throw new Error('分页记录格式或数量异常');
  const cursor = payload.next_cursor;
  const more = payload.has_more;
  if (cursor !== undefined && typeof cursor !== 'string') throw new Error('分页结束信息无效');
  if (more !== undefined && typeof more !== 'boolean') throw new Error('分页结束信息无效');
  if (more === true && !cursor || more === false && cursor) throw new Error('分页结束信息矛盾');
  // CLI 1.2 omits false/empty terminal fields. Accept only with explicit
  // successful response total matching both source metadata and accumulated rows.
  if (payload.total !== undefined && (!Number.isInteger(payload.total) || payload.total < 0
    || (progress.total !== undefined && payload.total !== progress.total))) throw new Error('分页总数发生变化或无效');
  if (more === undefined && cursor === undefined && !(payload.errcode === 0
    && Number.isInteger(progress.total) && payload.total === progress.total
    && Number.isInteger(progress.count) && progress.count + records.length === progress.total)) {
    throw new Error('缺少分页结束信息，无法确认读取完整');
  }
  if (cursor && !records.length) throw new Error('空页要求继续读取，请重新准备');
  const entries = records.map(record => {
    if (!record || typeof record.record_id !== 'string' || !record.record_id) throw new Error('缺少记录校验信息');
    const values = record.values || record.fields || {};
    if (typeof values !== 'object' || Array.isArray(values)) throw new Error('记录字段格式异常');
    const row = Object.fromEntries(names.map(name => [name, bridge.readableValue(values[name])]));
    return [record.record_id, row];
  });
  bridge.assertSafeRows(entries.map(entry => entry[1]));
  return { entries, cursor: cursor || '', done: !cursor };
}

function createReader({ inspect = bridge.inspectRead, read = bridge.readPage, finish,
  now = Date.now, ttl = 15 * 60 * 1000, maxRows = 10000, maxBytes = 20 * 1024 * 1024, maxPages = 100 } = {}) {
  const jobs = new Map();
  function clear(job, state, error = '') {
    job.state = state; job.error = error; job.entries = []; job.seen = new Set(); job.cursors = new Set();
  }
  function sweep() {
    for (const [id, job] of jobs) if (now() - job.touched > ttl) {
      clear(job, 'expired'); jobs.delete(id);
    }
  }
  function view(job) {
    return { task: job.id, moduleId: job.module.id, state: job.state, sequence: job.sequence, busy: job.busy,
      readCount: job.count, total: job.total, pass: job.pass, pages: job.pages,
      error: job.error, result: job.result };
  }
  function get(owner, id) {
    sweep(); const job = jobs.get(id);
    if (!job || job.owner !== owner) throw new Error('读取任务不存在或已过期，请重新开始');
    job.touched = now(); return job;
  }
  function revoke(moduleId) {
    for (const job of jobs.values()) if (job.module.id === moduleId) clear(job, 'cancelled');
  }
  function start(owner, module) {
    sweep();
    if (jobs.size >= 30) throw new Error('读取任务过多，请稍后再试');
    revoke(module.id);
    const frozen = JSON.parse(JSON.stringify(module));
    const info = inspect(frozen);
    if (!Number.isInteger(info.total) || info.total < 0) throw new Error('未获得源表总行数，不能确认全量数据');
    if (info.total > maxRows) throw new Error('源表超过 10000 行安全上限，请缩小数据源');
    const names = [...new Set(frozen.mappings.map(mapping => mapping.source))];
    if (!names.length || names.length > 100) throw new Error('映射字段数量无效');
    const job = { id: randomUUID(), owner, module: frozen, total: info.total,
      schema: digest(info.fields), names, limit: Math.min(200, Math.floor(9999 / names.length)),
      state: 'reading', pass: 1, pages: 0, sequence: 0, count: 0, bytes: 0,
      cursor: '', cursors: new Set(), entries: [], seen: new Set(), touched: now(), busy: false };
    jobs.set(job.id, job); return view(job);
  }
  async function next(owner, id, sequence) {
    const job = get(owner, id);
    if (job.busy || !active(job)) return view(job);
    // An old sequence is a repeated request, never append that page twice.
    if (!Number.isInteger(sequence) || sequence > job.sequence || sequence < 0) throw new Error('读取批次无效');
    if (sequence < job.sequence) return view(job);
    job.busy = true;
    try {
      if (job.pages >= maxPages) throw new Error('读取批次数超过安全上限');
      const payload = await read(job.module, job.cursor, job.limit);
      if (!active(job)) return view(job);
      const page = parsePage(payload, job.names, job.limit, {total:job.total, count:job.count});
      if (page.cursor && job.cursors.has(page.cursor)) throw new Error('分页重复，已停止读取');
      if (page.cursor) job.cursors.add(page.cursor);
      for (const [id, row] of page.entries) {
        if (job.seen.has(id)) throw new Error('读取到重复记录，请保持源表不变后重新读取');
        job.seen.add(id); job.entries.push([id, row]);
      }
      job.count += page.entries.length;
      job.bytes += Buffer.byteLength(JSON.stringify(page.entries));
      job.pages += 1; job.sequence += 1; job.cursor = page.cursor;
      if (job.count > maxRows || job.count > job.total || job.bytes > maxBytes) throw new Error('源表发生变化或读取数据超过安全上限');
      if (page.done) {
        const info = await inspect(job.module);
        if (!active(job)) return view(job);
        if (info.total !== job.total || job.count !== job.total || digest(info.fields) !== job.schema) throw new Error('源表数量或字段发生变化，请重新读取');
        const signature = digest(job.entries.slice().sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
        if (job.pass === 1) {
          job.signature = signature; job.pass = 2; job.state = 'verifying';
          job.entries = []; job.seen.clear(); job.cursors.clear(); job.count = 0; job.bytes = 0; job.pages = 0;
        } else {
          if (signature !== job.signature) throw new Error('两次读取内容不同，请暂停编辑源表后重新读取');
          job.result = finish(job.module, job.entries.map(entry => entry[1]), {
            complete: true, sourceRowCount: job.count, verifiedPasses: 2, owner: job.owner
          });
          clear(job, 'ready');
        }
      }
    } catch (error) {
      if (active(job)) clear(job, 'failed', error.message);
    } finally { job.busy = false; job.touched = now(); }
    return view(job);
  }
  return { start, next, revoke, sweep, status: (owner, id) => view(get(owner, id)),
    cancel(owner, id) { const job = get(owner, id); clear(job, 'cancelled'); return view(job); } };
}
module.exports = { createReader, parsePage };
