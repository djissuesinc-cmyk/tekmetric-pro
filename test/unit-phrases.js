// v2.4.0: item-specific "No Faults" phrases
const assert = require('assert');
const p = require('../inspection-phrases');

const t = (l) => p.phraseFor(l).text;
assert.equal(t('Warning Lights on Dash'), 'WARNING LIGHTS ON DASH\nAt time of inspection, no faults were found, no warning lights were on.');
assert.equal(p.phraseFor('Battery').rule, 'BATTERY');
assert.ok(t('Battery').startsWith('BATTERY\nAt time of inspection, battery passed load testing'));
assert.equal(p.phraseFor('Battery and Alternator').rule, 'BATTERY AND ALTERNATOR');
assert.ok(/battery and alternator passed load and amperage testing, no faults found\.$/.test(t('Battery and Alternator')));
assert.equal(p.phraseFor('Front Brakes').rule, 'FRONT BRAKES');
assert.equal(p.phraseFor('Rear Brakes').rule, 'REAR BRAKES');
assert.equal(p.phraseFor('Tires').rule, 'TIRES');
assert.equal(p.phraseFor('Brake Fluid').rule, 'BRAKE FLUID');
assert.ok(!/flush/i.test(t('Brake Fluid')));
assert.equal(p.phraseFor('Brake Lights').rule, 'BRAKE LIGHTS');
assert.equal(p.phraseFor('Brake Hoses').rule, 'BRAKE LINES AND HOSES');
assert.equal(p.phraseFor('Cabin Air Filter').rule, 'CABIN AIR FILTER');
assert.equal(p.phraseFor('Engine Air Filter').rule, 'ENGINE AIR FILTER');
assert.equal(p.phraseFor('Seat Belts').rule, 'SEAT BELTS');
assert.equal(p.phraseFor('Serpentine Belt').rule, 'DRIVE BELT');
assert.equal(p.phraseFor('TPMS').rule, 'TPMS');
assert.equal(p.phraseFor('Check Engine Light').rule, 'WARNING LIGHTS ON DASH');
assert.equal(p.phraseFor('Oil Leaks').rule, 'OIL LEAKS');
assert.equal(p.phraseFor('Engine Oil Level & Condition').rule, 'ENGINE OIL');
assert.equal(p.phraseFor('Road Test').rule, 'ROAD TEST');
assert.equal(p.phraseFor('  front brakes:  ').text.split('\n')[0], 'FRONT BRAKES');
// unknown / empty -> old generic sentence
assert.equal(t('Glove Box'), 'No faults found at this time.');
assert.equal(t(''), 'No faults found at this time.');
assert.equal(t(null), 'No faults found at this time.');
// no fluff words, every rule has the header + sentence shape
for (const r of p.RULES) {
  assert.ok(!/\b(ensure|crucial|vital|navigate|whether)\b/i.test(r.text), r.name);
  assert.ok(/^At time of (inspection|road test), /.test(r.text), r.name);
  assert.equal(r.name, r.name.toUpperCase());
}
// clear recognises generated text (also after Auto Uppercase / whitespace changes) but never user edits
for (const l of ['Warning Lights on Dash', 'Battery', 'Front Brakes', 'Tires', 'Glove Box']) {
  const g = t(l);
  assert.ok(p.isGeneratedPhrase(g), l);
  assert.ok(p.isGeneratedPhrase(g.toUpperCase()), l + ' upper');
  assert.ok(p.isGeneratedPhrase('  ' + g.replace('\n', '\r\n').replace(/ /g, '  ') + ' '), l + ' spacing');
}
assert.ok(p.isGeneratedPhrase('NO FAULTS FOUND AT THIS TIME.'));
assert.ok(!p.isGeneratedPhrase(t('Front Brakes') + ' Pads at 4mm.'));
assert.ok(!p.isGeneratedPhrase('FRONT BRAKES\nPads at 3mm, recommend replacement.'));
assert.ok(!p.isGeneratedPhrase('No faults found at this time. Customer declined.'));
assert.ok(!p.isGeneratedPhrase(''));
assert.ok(!p.isGeneratedPhrase('NOTE\nLINE 2\n' + p.RULES[0].text));
// generic label words are rejected
assert.ok(!p.isUsefulLabel('Notes')); assert.ok(!p.isUsefulLabel('Good')); assert.ok(p.isUsefulLabel('Front Brakes'));
console.log('PHRASES UNIT OK (' + p.RULES.length + ' rules)');
