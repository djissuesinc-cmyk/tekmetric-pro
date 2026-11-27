// v2.5.2: Quick Actions insert formatting. Run: node test/unit-inject.js
const assert = require('assert');
const { splitPresetParts, stripTrailingSeps, nextInjectValue } = require('../inject-text');

const tests = [];
const t = (n, f) => tests.push([n, f]);

t('splits the LOF preset on top-level comma and plus', () => {
  assert.deepStrictEqual(splitPresetParts('LOF, 30 POINT INSPECTION + BRAKE INSPECTION'), [
    'LOF', '30 POINT INSPECTION', 'BRAKE INSPECTION'
  ]);
});

t('keeps comma and plus inside parentheses as one part', () => {
  const s = 'Level 2 / 3 Scan (Documents Codes, In-depth Diagnostics and trouble shooting + Clearing Codes)';
  assert.deepStrictEqual(splitPresetParts(s), [s]);
});

t('single job with no separators is one part', () => {
  assert.deepStrictEqual(splitPresetParts('SEASONAL TIRE CHANGE'), ['SEASONAL TIRE CHANGE']);
  assert.deepStrictEqual(splitPresetParts('  Alignment  '), ['Alignment']);
});

t('trims parts and drops empties', () => {
  assert.deepStrictEqual(splitPresetParts('  LOF  ,   , +  SAFETY + '), ['LOF', 'SAFETY']);
  assert.deepStrictEqual(splitPresetParts(''), []);
  assert.deepStrictEqual(splitPresetParts('   +  , '), []);
});

t('Level 1 and AVR parens stay one part', () => {
  assert.deepStrictEqual(splitPresetParts('Level 1 Scan (Document and Clear Codes)'), ['Level 1 Scan (Document and Clear Codes)']);
  assert.deepStrictEqual(splitPresetParts('A.V.R. (Diagnostics and trouble shooting)'), ['A.V.R. (Diagnostics and trouble shooting)']);
});

t('textarea: empty field, then LOF, then another job, no trailing +', () => {
  let v = nextInjectValue('', 'LOF, 30 POINT INSPECTION + BRAKE INSPECTION', true);
  assert.strictEqual(v, '+ LOF\n+ 30 POINT INSPECTION\n+ BRAKE INSPECTION');
  v = nextInjectValue(v, 'SEASONAL TIRE CHANGE', true);
  assert.strictEqual(v, '+ LOF\n+ 30 POINT INSPECTION\n+ BRAKE INSPECTION\n+ SEASONAL TIRE CHANGE');
  assert(!v.endsWith(' + ') && !v.endsWith('+'));
});

t('textarea: strips trailing + / comma / whitespace before append', () => {
  const v = nextInjectValue('+ LOF +\n', 'SEASONAL TIRE CHANGE', true);
  assert.strictEqual(v, '+ LOF\n+ SEASONAL TIRE CHANGE');
  const v2 = nextInjectValue('old jobs +  ', 'SAFETY', true);
  assert.strictEqual(v2, 'old jobs\n+ SAFETY');
});

t('textarea: paren-comma preset is a single + line', () => {
  const s = 'Level 2 / 3 Scan (Documents Codes, In-depth Diagnostics and trouble shooting + Clearing Codes)';
  const v = nextInjectValue('', s, true);
  assert.strictEqual(v, '+ ' + s);
  assert.strictEqual(v.split('\n').length, 1);
});

t('input: keeps old + joining, including trailing +', () => {
  let v = nextInjectValue('', 'LOF, 30 POINT INSPECTION + BRAKE INSPECTION', false);
  assert.strictEqual(v, 'LOF, 30 POINT INSPECTION + BRAKE INSPECTION + ');
  v = nextInjectValue(v, 'SEASONAL TIRE CHANGE', false);
  assert.strictEqual(v, 'LOF, 30 POINT INSPECTION + BRAKE INSPECTION + SEASONAL TIRE CHANGE + ');
});

t('input: empty vs trailing plus/comma spacing matches old behavior', () => {
  assert.strictEqual(nextInjectValue('  ', 'SAFETY', false), 'SAFETY + ');
  assert.strictEqual(nextInjectValue('LOF', 'SAFETY', false), 'LOF + SAFETY + ');
  assert.strictEqual(nextInjectValue('LOF +', 'SAFETY', false), 'LOF + SAFETY + ');
  assert.strictEqual(nextInjectValue('LOF,', 'SAFETY', false), 'LOF, SAFETY + ');
});

t('stripTrailingSeps only touches the end', () => {
  assert.strictEqual(stripTrailingSeps('+ LOF\n+ 30 POINT INSPECTION + '), '+ LOF\n+ 30 POINT INSPECTION');
  assert.strictEqual(stripTrailingSeps('A + B +'), 'A + B');
});


t('preload.js inlined helpers stay in sync with inject-text.js', () => {
  const fs = require('fs');
  const path = require('path');
  const preload = fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8');
  const mod = fs.readFileSync(path.join(__dirname, '../inject-text.js'), 'utf8');
  for (const name of ['splitPresetParts', 'stripTrailingSeps', 'nextInjectValue']) {
    const grab = (src) => {
      const start = src.indexOf('function ' + name);
      if (start < 0) throw new Error(name + ' missing');
      let i = src.indexOf('{', start), depth = 0;
      for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
      }
      throw new Error(name + ' unclosed');
    };
    const a = grab(preload).replace(/\s+/g, ' ').trim();
    const b = grab(mod).replace(/\s+/g, ' ').trim();
    assert.strictEqual(a, b, name + ' drifted between preload.js and inject-text.js');
  }
});

(async () => {
  for (const [n, f] of tests) {
    await f();
    console.log('ok:', n);
  }
  console.log('INJECT UNIT OK');
})().catch((e) => { console.error('INJECT UNIT FAIL:', e && e.stack || e); process.exit(1); });
