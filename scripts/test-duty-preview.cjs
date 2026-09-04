const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const model = require('../shared/module-mapping-model.cjs');
const { pageData } = require('../shared/preview-model.cjs');

const seed = model.cloneSeed();
assert(model.validMappingSet(seed));
const duty = seed.modules.find((item) => item.id === 'duty-roster');
const built = pageData(duty, [
  { 日期: '2026-09-04', 值班领导: [{ name: '测试甲' }], 值班干部: '测试乙', 类型: '正常', 备注: '不应出现在今日卡片的备注', 地点: '校内' },
  { 日期: '2026-10-01', 类型: '放假', 备注: '<script>test</script>' },
  { 日期: '2026-10-10', 值班领导: '测试甲、测试丙', 类型: '补课' },
  { 日期: '', 值班领导: '', 类型: '' }
]);
assert.equal(built.data.rows.length, 3);
assert.equal(built.issues.length, 0);
assert.deepEqual(built.data.rows[0].cadres, ['测试乙']);
assert.equal(built.data.rows[1].type, 'holiday');
assert.deepEqual(built.data.rows[1].leaders, []);
assert.equal(built.data.rows[2].type, 'makeup');
assert.equal(built.data.personnel.length, 3);
assert(pageData(duty, [{ 日期: '2026-02-30', 类型: '正常' }]).issues.length >= 2);
assert(pageData(duty, [{ 日期: '2026-09-04', 类型: '未知' }]).issues.some((issue) => issue.includes('无法识别')));

const legacy = model.cloneSeed();
const old = legacy.modules.find((item) => item.id === 'duty-roster');
old.schema.id = 'duty-roster.v1';
old.schema.fields = old.schema.fields.filter((field) => !['cadre', 'type'].includes(field.key));
old.mappings = old.mappings.filter((mapping) => !['cadre', 'type'].includes(mapping.target));
old.source.documentUrl = 'https://example.com/saved-sheet';
const before = JSON.stringify(legacy);
const upgraded = model.upgradeMappingSet(legacy);
assert.equal(JSON.stringify(legacy), before);
assert(model.validMappingSet(upgraded));
assert.equal(upgraded.modules[2].source.documentUrl, old.source.documentUrl);
assert.deepEqual(upgraded.modules[0], legacy.modules[0]);
assert.deepEqual(model.upgradeMappingSet(upgraded), upgraded);

// Exercise rendering/filtering with synthetic data, without enterprise access.
const elements = new Map();
const document = { querySelectorAll() { return []; }, getElementById(id) {
  if (!elements.has(id)) elements.set(id, { value: id === 'rosterScope' ? 'all' : '', addEventListener(event, callback) { this[event] = callback; } });
  return elements.get(id);
} };
class TestDate extends Date { constructor(...args) { super(...(args.length ? args : ['2026-09-04T12:00:00'])); } }
const context = vm.createContext({ Date: TestDate, document, location: { search: '?localPreview=1' }, URLSearchParams, sessionStorage: { getItem: () => '' }, fetch: async () => ({ ok: true, json: async () => ({ preview: { ...built, generatedAt: new Date().toISOString() } }) }) });
vm.runInContext(fs.readFileSync(require.resolve('../assets/js/duty-roster.js'), 'utf8'), context);
setImmediate(() => {
  const content = document.getElementById('rosterContent');
  const click = (id, dataset) => document.getElementById(id).click({ target: { closest: () => ({ dataset }) } });
  assert(content.innerHTML.includes('8月31日 — 9月6日'));
  assert(document.getElementById('todayDuty').innerHTML.includes('测试乙'));
  assert(!document.getElementById('todayDuty').innerHTML.includes('hero-tip'));
  assert(!document.getElementById('todayDuty').innerHTML.includes('不应出现在今日卡片的备注'));
  click('rosterContent', {act: 'next'});
  assert(content.innerHTML.includes('9月7日 — 9月13日'));
  click('tabbar', {view: 'month'});
  click('rosterContent', {act: 'next'});
  assert(content.innerHTML.includes('2026年10月'));
  click('rosterContent', {date: '2026-10-01'});
  assert(content.innerHTML.includes('不安排值周'));
  assert(!content.innerHTML.includes('<script>'));
  click('rosterContent', {date: '2026-10-10'});
  assert(content.innerHTML.includes('补课值班'));
  click('rosterContent', {act: 'next'});
  click('rosterContent', {act: 'next'});
  click('rosterContent', {act: 'next'});
  assert(content.innerHTML.includes('2027年1月'));
  click('tabbar', {view: 'person'});
  click('rosterContent', {person: '测试乙'});
  assert(content.innerHTML.includes('共 <b>1</b> 天'));
  click('tabbar', {view: 'notice'});
  assert(content.innerHTML.includes('尚未配置'));
  assert(content.innerHTML.includes('暂无时间段数据'));
  built.data.rows[0].shift = '早 7:35-8:15；午 12:00（在班级内与学生一起用餐，学生餐）；下午 15:20；16:20；17:20；17:25；17:30（至最后一名学生安全离校）';
  built.data.rows[2].shift = built.data.rows[0].shift;
  built.data.rows[1].shift = '放假不应展示';
  click('tabbar', {view: 'notice'});
  assert.equal(content.innerHTML.split('7:35-8:15').length - 1, 1);
  assert.equal(content.innerHTML.split('早晨值周').length - 1, 1);
  assert(content.innerHTML.includes('中午陪餐'));
  assert(content.innerHTML.includes('下午到岗'));
  assert(content.innerHTML.includes('12:00（在班级内与学生一起用餐，学生餐）'));
  assert(content.innerHTML.includes('15:20；16:20；17:20；17:25；17:30（至最后一名学生安全离校）'));
  assert(!content.innerHTML.includes('时间段中未识别'));
  assert(!content.innerHTML.includes('放假不应展示'));
  built.data.rows[0].shift = '早晨：7:35–8:15\n中午 12:00（说明：下午 13:00另有安排）\n下午：15:20;16:20';
  built.data.rows[2].shift = built.data.rows[0].shift;
  click('tabbar', {view: 'notice'});
  assert(content.innerHTML.includes('12:00（说明：下午 13:00另有安排）'));
  assert(content.innerHTML.includes('15:20;16:20'));
  assert(!content.innerHTML.includes('时间段中未识别'));
  built.data.rows[2].shift = '<script>不同时间段</script>';
  click('tabbar', {view: 'notice'});
  assert(content.innerHTML.includes('适用日期：2026-09-04'));
  assert(content.innerHTML.includes('适用日期：2026-10-10'));
  assert(content.innerHTML.includes('&lt;script&gt;'));
  assert(!content.innerHTML.includes('<script>'));
  built.data.rows[2].shift = '';
  click('tabbar', {view: 'notice'});
  assert(content.innerHTML.includes('部分值班记录未填写时间段'));
  built.data.rows[0].location = '测试地点不在周列表显示';
  built.data.rows[0].note = '测试备注不在周列表显示';
  click('tabbar', {view: 'week'});
  click('rosterContent', {act: 'now'});
  assert(content.innerHTML.includes('测试甲'));
  assert(content.innerHTML.includes('测试乙'));
  assert(content.innerHTML.includes('day-row off'));
  assert(!content.innerHTML.includes('7:35'));
  assert(!content.innerHTML.includes('测试地点'));
  assert(!content.innerHTML.includes('测试备注'));
  click('tabbar', {view: 'person'});
  click('rosterContent', {person: '测试甲'});
  assert(content.innerHTML.includes('共 <b>2</b> 天'));
  assert(content.innerHTML.includes('<time datetime="2026-09-04">9月4日 周五</time>'));
  assert(content.innerHTML.includes('<time datetime="2026-10-10">10月10日 周六</time>'));
  for (const hidden of ['7:35', '测试地点', '测试备注', 'day-note', 'day-tag', '领导／人员', '干部：']) {
    assert(!content.innerHTML.includes(hidden));
  }
  built.data.rows[2].date = '2026-09-04';
  click('rosterContent', {person: '测试甲'});
  assert(content.innerHTML.includes('共 <b>1</b> 天'));
  assert.equal(content.innerHTML.split('<time datetime="2026-09-04">').length - 1, 1);
  built.data.rows[2].date = '2026-10-10';
  click('rosterContent', {person: '无排班人员'});
  assert(content.innerHTML.includes('暂无值班日期'));
  click('tabbar', {view: 'notice'});
  assert(content.innerHTML.includes('7:35'));
  console.log('Duty migration, data, today, week/month navigation, escaping, person and notice views passed.');
});
