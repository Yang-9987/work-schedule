const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createRequire} = require('node:module');

// Run the real HTTP routing without opening a port, reading credentials, or
// recovering a real sync journal. No writes or network requests are performed.
function serverHandler(local) {
  const root = path.resolve(__dirname, '..');
  const filename = path.join(root, 'server.js');
  const requireHere = createRequire(filename);
  let handler;
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    require(name) {
      if (name === 'http') return {createServer(fn) { handler = fn; return {listen() {}}; }};
      if (name === './shared/dev-sync.cjs') return {createSync() { return {}; }};
      return requireHere(name);
    },
    __dirname: root, process: {env: {LOCAL_CONSOLE_MODE: local ? '1' : '0'}},
    URL, Buffer, console: {log() {}}, setInterval() {return {unref() {}};},
  }, {filename});
  return function get(url) {
    return new Promise(resolve => {
      const result = {};
      handler({url, method:'GET', headers:{host:'127.0.0.1'}}, {
        writeHead(status, headers) {result.status=status;result.headers=headers || {};},
        end(body) {result.body=String(body || '');resolve(result);},
      });
    });
  };
}

for (const local of [false, true]) {
  test(`anonymous display routes remain public (local console: ${local})`, async () => {
    const get = serverHandler(local);
    for (const route of ['/', '/work-schedule/', '/school-calendar/', '/duty-roster/', '/smart-campus-manual/']) {
      const result = await get(route);
      assert.equal(result.status, 200, route);
      assert(!/管理员|管理后台|管理入口/.test(result.body), route);
      if (route !== '/') assert(!/class=["']module-nav/.test(result.body), route);
    }
    const calendar = await get('/school-calendar/');
    assert(calendar.body.includes('id="imageReader"'));
    assert(calendar.body.includes('/assets/js/pdf-reader.js'));
    assert(!calendar.body.includes('/assets/js/calendar.js'));
    const pdf = await get('/assets/documents/school-calendar-2026-2027-term1.pdf');
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers['Content-Type'], 'application/pdf');
    assert(pdf.body.startsWith('%PDF-'));
    for (const [route, asset, count] of [
      ['/smart-campus-manual/', 'smart-campus-manual', 42],
      ['/school-calendar/', 'school-calendar-2026-2027-term1', 2],
    ]) {
      const page = await get(route);
      const imagePaths = [...page.body.matchAll(/<img src="([^"]+)"/g)].map(match => match[1]);
      assert.equal(imagePaths.length, count);
      for (const imagePath of imagePaths) {
        const image = await get(imagePath);
        assert.equal(image.status, 200, imagePath);
        assert.equal(image.headers['Content-Type'], 'image/jpeg');
      }
      const original = await get('/assets/documents/' + asset + '.pdf');
      assert.equal(original.status, 200);
      assert(original.body.startsWith('%PDF-'));
    }
    for (const route of ['/admin/mappings/', '/admin/mappings/index.html', '/admin/calendar/']) {
      const result = await get(route);
      assert.equal(result.status, local ? 302 : 404, route);
      if (local) assert.equal(result.headers.Location, '/local-console/');
    }
    assert.equal((await get('/local-console/')).status, local ? 200 : 404);
  });
}
