import test from 'node:test';
import { hasBlobConfig } from '../api/_lib/blob-config.mjs';
import assert from 'node:assert/strict';
import { createVersionedStore, assertWritable, storageScope } from '../api/_lib/versioned-store.mjs';
import { makeCalendar } from './sync-wecom-calendar.mjs';
import { validDuty } from '../api/_lib/duty-store.mjs';
import { GET as calendarRead, POST as calendarWrite } from '../api/calendar.mjs';
import { POST as dutyWrite } from '../api/duty-roster.mjs';
import { GET as dutyRead } from '../api/duty-roster.mjs';
import { GET as historyRead, POST as releaseWrite } from '../api/releases.mjs';

test('Blob accepts runtime OIDC without weakening production write gates', () => {
  assert.equal(hasBlobConfig({BLOB_STORE_ID:'store_test'}), false);
  assert.equal(hasBlobConfig({BLOB_READ_WRITE_TOKEN:'test'}), true);
  const env = {VERCEL:'1', VERCEL_ENV:'preview', DATA_ENV:'dev', BLOB_STORE_ID:'store_test'};
  assert.equal(hasBlobConfig(env), true);
  assert.doesNotThrow(() => assertWritable(env));
  assert.throws(() => assertWritable({...env, VERCEL_ENV:'production', DATA_ENV:'main'}));
});

function memoryStore() {
  const records = new Map(); let serial = 0;
  const io = {
    async get(path) {
      const value = records.get(path);
      if (!value) return null;
      return { statusCode: 200, blob: { etag: value.etag }, stream: new Response(value.body).body };
    },
    async put(path, body, opts) {
      const old = records.get(path);
      if (opts.ifMatch && old?.etag !== opts.ifMatch) throw new Error('conflict');
      if (old && !opts.allowOverwrite) throw new Error('already exists');
      records.set(path, { body, etag: String(++serial) });
    },
    async list({ prefix }) { return {blobs: [...records.keys()].filter(p => p.startsWith(prefix)).map(pathname => ({pathname})), hasMore:false}; },
  };
  return { records, io, store: createVersionedStore(io, { VERCEL_ENV:'preview', DATA_ENV:'dev', BLOB_READ_WRITE_TOKEN:'test-only' }) };
}
test('environment gates reject unapproved production writes', () => {
  assert.throws(() => assertWritable({VERCEL_ENV:'production', DATA_ENV:'main', BLOB_READ_WRITE_TOKEN:'x'}));
  assert.throws(() => storageScope({VERCEL_ENV:'preview'}));
  assert.equal(storageScope({VERCEL_ENV:'preview', DATA_ENV:'dev'}), 'dev/');
  assert.throws(() => storageScope({VERCEL_ENV:'production', DATA_ENV:'dev'}));
});
test('backup and rollback preserve latest state and isolate dev path', async () => {
  const {store, records} = memoryStore();
  await store.write('school-calendar', {revision:1});
  const {backupVersion} = await store.write('school-calendar', {revision:2});
  assert.deepEqual(await store.read('school-calendar'), {revision:2});
  assert.equal((await store.history('school-calendar')).versions.length, 1);
  await store.rollback('school-calendar', backupVersion, d => Number.isInteger(d.revision));
  assert.deepEqual(await store.read('school-calendar'), {revision:1});
  assert.equal((await store.history('school-calendar')).versions.length, 2);
  assert([...records.keys()].every(p => p.startsWith('dev/')));
  await assert.rejects(store.rollback('school-calendar', '../bad', () => true));
});
test('backup failure prevents current data overwrite', async () => {
  const {store, io} = memoryStore();
  await store.write('school-calendar', {revision:1});
  const put = io.put;
  io.put = async (path, ...args) => { if (path.includes('/history/')) throw new Error('failure'); return put(path, ...args); };
  await assert.rejects(store.write('school-calendar', {revision:2}));
  assert.deepEqual(await store.read('school-calendar'), {revision:1});
});
test('concurrent changes are not silently overwritten', async () => {
  const {store, io, records} = memoryStore();
  await store.write('school-calendar', {revision:1});
  const put = io.put;
  io.put = async (path, ...args) => {
    if (path.includes('/history/')) records.set('dev/school-calendar/calendar.json', {body:'{"revision":99}',etag:'external'});
    return put(path, ...args);
  };
  await assert.rejects(store.write('school-calendar', {revision:2}));
  assert.deepEqual(await store.read('school-calendar'), {revision:99});
});
test('calendar sync uses multiline parser and no longer needs old columns', () => {
  const config = {source:{fields:{date:'日期',title:'事件'}},calendar:{schoolName:'测试',academicYear:'2026'}};
  const data = makeCalendar(config, [{日期:'2026-09-01',事件:'1. 开学\n2. '+ '活动内容'.repeat(15)}]);
  assert.equal(data.events.length,2);
  assert.equal(data.events[0].title,'开学');
  assert(data.events.every(e => e.type === 'activity' && e.note === ''));
});
test('duty validator rejects missing people and invalid dates', () => {
  assert(validDuty({title:'值周',rows:[{date:'2026-09-01',type:'normal',leaders:['甲'],cadres:[]}]}));
  assert(!validDuty({title:'值周',rows:[{date:'2026-02-30',type:'holiday',leaders:[],cadres:[]}]}));
});
test('unauthenticated write/history requests stay blocked without network', async () => {
  const request = new Request('https://test.invalid/api', {method:'POST',body:'{}'});
  for (const handler of [dutyWrite, historyRead, releaseWrite]) assert.equal((await handler(request.clone())).status,401);
  const originalPass = process.env.ADMIN_PASS;
  const originalToken = process.env.BLOB_READ_WRITE_TOKEN;
  process.env.ADMIN_PASS='test'; process.env.BLOB_READ_WRITE_TOKEN='test';
  try { assert.equal((await calendarWrite(request.clone())).status,401); }
  finally {
    if (originalPass === undefined) delete process.env.ADMIN_PASS; else process.env.ADMIN_PASS=originalPass;
    if (originalToken === undefined) delete process.env.BLOB_READ_WRITE_TOKEN; else process.env.BLOB_READ_WRITE_TOKEN=originalToken;
  }
});
test('anonymous reads do not request admin login', async () => {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  try {
    assert.equal((await calendarRead(new Request('https://test.invalid/api/calendar'))).status, 200);
    assert.equal((await dutyRead(new Request('https://test.invalid/api/duty-roster'))).status, 404);
  } finally { if (token !== undefined) process.env.BLOB_READ_WRITE_TOKEN=token; }
});
