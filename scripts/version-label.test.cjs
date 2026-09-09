const test=require('node:test');
const assert=require('node:assert/strict');
const labels=require('../assets/js/version-label.js');

test('release history labels are readable and never expose opaque version ids',()=>{
  const version='1788926400000-123e4567-e89b-12d3-a456-426614174000';
  const label=labels.format(version,'2026-09-09T04:00:00.000Z','值班排班',0);
  assert.match(label,/值班排班/);
  assert.match(label,/2026/);
  assert.match(label,/最近更新前/);
  assert(!label.includes('123e4567'));
});

test('older release history labels have a useful order',()=>{
  assert.match(labels.format('bad','bad','校历',2),/时间未知/);
  assert.match(labels.format('bad','bad','校历',2),/更早备份 3/);
});
