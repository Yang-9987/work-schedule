const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../assets/js/local-console.js'), 'utf8');

test('changing sheet invalidates old fields and displayed mappings, without rewriting saved sources', () => {
  const start = source.indexOf('  function invalidateSourceFields()');
  const end = source.indexOf('\n  function ', start + 10);
  const module = {source:{fields:[{name:'班次'}]}};
  const draft = {fields:[{name:'班次'}],sheet:'旧表'};
  const calls=[];
  const context = {discoveredFields:[{name:'班次'}],currentModule:()=>module,draftFor:()=>draft,
    els:{sheetSelect:{value:'新表'},saveHint:{}},
    renderFields:()=>calls.push('fields'),renderMappings:()=>calls.push('mappings'),clearPreview:()=>calls.push('preview')};
  vm.runInNewContext(source.slice(start,end) + '\ninvalidateSourceFields();', context);
  assert.equal(context.discoveredFields.length,0);
  assert.equal(draft.fields.length,0);
  assert.equal(draft.sheet,'新表');
  assert.equal(module.source.fields[0].name,'班次');
  assert.deepEqual(calls,['fields','mappings','preview']);
  assert.match(source,/sheetSelect\.addEventListener\("change", invalidateSourceFields\)/);
  assert.match(source,/if \(!discoveredFields.length\) errors.push/);
});

test('timeline header and entries share an independent column, not the clock grid rows', () => {
  const html=fs.readFileSync(require.resolve('../modules/work-schedule/index.html'),'utf8');
  const panel=html.match(/<section class="schedule-timeline"[\s\S]*?<\/section>/)[0];
  assert(panel.includes('timeline-title'));
  assert(panel.includes('id="timeline"'));
  assert(!panel.includes('heroClock'));
});

test('every work-schedule category keeps a visible color in the final stylesheet', () => {
  const html=fs.readFileSync(require.resolve('../modules/work-schedule/index.html'),'utf8');
  const css=fs.readFileSync(require.resolve('../assets/css/work-schedule.css'),'utf8');
  const typeBlock=html.match(/var TYPE_META = \{[\s\S]*?\n\};/)[0];
  const classes=[...typeBlock.matchAll(/className:\s*"([^"]+)"/g)].map(match=>match[1]);
  assert.equal(classes.length,12);
  const backgrounds=new Set();
  for (const className of classes) {
    const rule=css.match(new RegExp('\\.'+className+'\\{([^}]*)\\}'));
    assert(rule,`missing final style for ${className}`);
    const background=rule[1].match(/background:([^;]+)/);
    assert(background,`missing background for ${className}`);
    assert.notEqual(background[1].trim(),'#fff');
    backgrounds.add(background[1].trim());
  }
  assert.equal(backgrounds.size,classes.length);
});
