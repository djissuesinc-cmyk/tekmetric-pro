// v2.4.1: item-specific "No Faults" phrases (sentence only, no item-name header)
const assert = require('assert');
const p = require('../inspection-phrases');

const t = (l) => p.phraseFor(l).text;

const SHOP = {
    'WARNING LIGHTS ON DASH': 'No warning lights are illuminated on the dashboard.',
    'CABIN AIR FILTER': 'The cabin air filter is clean and in good condition. No faults found at this time.',
    'LIGHT CHECK': 'All exterior and interior lights are working. No faults found at this time.',
    'WIPER BLADES & WINDSHIELD': 'Wiper blades and windshield are in good condition. No faults found at this time.',
    'HORN': 'The horn is working. No faults found at this time.',
    'AIR FILTER': 'The engine air filter is clean and in good condition. No faults found at this time.',
    'FLUID LEVELS': 'All fluid levels are good. No faults found at this time.',
    'BELT(S)': 'Drive belt(s) are in good condition, no cracks, glazing or fraying found.',
    'BATTERY & TERMINALS': 'The battery and terminals are in good condition. No faults found at this time.',
    'ALTERNATOR': 'Battery and alternator passed load and amperage testing, no faults found.',
    'SHOCKS, STRUTS & SPRINGS': 'Shocks, struts and springs are in good condition. No faults found at this time.',
    'CV AXLE & BOOTS': 'CV axles and boots are in good condition, no tears or leaks found.',
    'SWAY BAR BUSHINGS & STABILIZER LINKS': 'Sway bar bushings and stabilizer links are in good condition, no play found.',
    'CONTROL ARMS AND BALL JOINTS': 'Control arms and ball joints are in good condition, no play found.',
    'TIE RODS': 'No play was found in the inner or outer tie rods.',
    'FRONT BRAKE PADS AND ROTORS': 'Front brake pads and rotors are in good condition. No faults found at this time.',
    'REAR BRAKE PADS AND ROTORS/DRUMS': 'Rear brake pads and rotors/drums are in good condition. No faults found at this time.',
    'TIRES TREAD, CONDITION, & PSI': 'Tire tread, condition and pressure are good. No faults found at this time.',
    'BODY, FRAME, & CONDITION': 'Body and frame are in good condition. No faults found at this time.',
    'BRAKE LINES & FUEL LINES': 'Brake lines and fuel lines are in good condition, no leaks or damage found.',
    'EXHAUST SYSTEM': 'The exhaust system is secure, no leaks or damage found.',
    'FLUID LEAKS': 'No fluid leaks were found at this time.',
    'OTHER FAULTS FOUND': 'No faults found at this time.',
};

for (const [name, text] of Object.entries(SHOP)) {
    assert.equal(t(name), text, 'wording for ' + name);
    assert.equal(t(name.toLowerCase()), text, 'case for ' + name);
    assert.ok(!/\n/.test(t(name)), 'no header line for ' + name);
    assert.ok(p.isGeneratedPhrase(text), 'generated ' + name);
    assert.ok(p.isGeneratedPhrase(text.toUpperCase()), 'upper ' + name);
}

assert.equal(p.phraseFor('Warning Lights on Dash').rule, 'WARNING LIGHTS ON DASH');
assert.equal(p.phraseFor('Battery').rule, 'BATTERY & TERMINALS');
assert.equal(p.phraseFor('Battery and Alternator').rule, 'BATTERY AND ALTERNATOR');
assert.equal(t('Battery and Alternator'), 'Battery and alternator passed load and amperage testing, no faults found.');
assert.equal(p.phraseFor('Front Brakes').rule, 'FRONT BRAKE PADS AND ROTORS');
assert.equal(p.phraseFor('Rear Brakes').rule, 'REAR BRAKE PADS AND ROTORS/DRUMS');
assert.equal(p.phraseFor('Tires').rule, 'TIRES');
assert.equal(p.phraseFor('Brake Fluid').rule, 'BRAKE FLUID');
assert.ok(!/flush/i.test(t('Brake Fluid')));
assert.equal(p.phraseFor('Brake Lights').rule, 'BRAKE LIGHTS');
assert.equal(p.phraseFor('Brake Hoses').rule, 'BRAKE LINES & FUEL LINES');
assert.equal(p.phraseFor('Cabin Air Filter').rule, 'CABIN AIR FILTER');
assert.equal(p.phraseFor('Engine Air Filter').rule, 'ENGINE AIR FILTER');
assert.equal(p.phraseFor('Seat Belts').rule, 'SEAT BELTS');
assert.equal(p.phraseFor('Serpentine Belt').rule, 'DRIVE BELT');
assert.equal(p.phraseFor('TPMS').rule, 'TPMS');
assert.equal(p.phraseFor('Check Engine Light').rule, 'WARNING LIGHTS ON DASH');
assert.equal(p.phraseFor('Oil Leaks').rule, 'OIL LEAKS');
assert.equal(p.phraseFor('Engine Oil Level & Condition').rule, 'ENGINE OIL');
assert.equal(p.phraseFor('Road Test').rule, 'ROAD TEST');
assert.equal(t('  front brakes:  '), SHOP['FRONT BRAKE PADS AND ROTORS']);

// unknown / empty -> generic sentence, still no header
assert.equal(t('Glove Box'), 'No faults found at this time.');
assert.equal(t(''), 'No faults found at this time.');
assert.equal(t(null), 'No faults found at this time.');

for (const r of p.RULES) {
    assert.ok(!/\b(ensure|crucial|vital|navigate|whether|enhancing|delve|unlock|elevate)\b/i.test(r.text), r.name);
    assert.ok(!/flush/i.test(r.text), r.name + ' flush');
    assert.ok(!/\n/.test(r.text), r.name + ' newline');
    assert.ok(r.text.length > 10, r.name + ' short');
    assert.equal(r.name, r.name.toUpperCase());
}

// clear recognises generated text (also after Auto Uppercase / whitespace) but never user edits
for (const l of Object.keys(SHOP).concat(['Glove Box', 'Front Brakes', 'Tires'])) {
    const g = t(l);
    assert.ok(p.isGeneratedPhrase(g), l);
    assert.ok(p.isGeneratedPhrase(g.toUpperCase()), l + ' upper');
    assert.ok(p.isGeneratedPhrase('  ' + g.replace(/ /g, '  ') + ' '), l + ' spacing');
}
assert.ok(p.isGeneratedPhrase('NO FAULTS FOUND AT THIS TIME.'));
assert.ok(!p.isGeneratedPhrase(t('Front Brakes') + ' Pads at 4mm.'));
assert.ok(!p.isGeneratedPhrase('FRONT BRAKES\nPads at 3mm, recommend replacement.'));
assert.ok(!p.isGeneratedPhrase('No faults found at this time. Customer declined.'));
assert.ok(!p.isGeneratedPhrase(''));
assert.ok(!p.isGeneratedPhrase('NOTE\nLINE 2\n' + p.RULES[0].text));

// Clear still removes 2.4.0 wording (header + "At time of inspection..." sentence)
assert.ok(p.isGeneratedPhrase('WARNING LIGHTS ON DASH\nAt time of inspection, no faults were found, no warning lights were on.'));
assert.ok(p.isGeneratedPhrase('At time of inspection, battery passed load testing, terminals and hold-down secure, no faults found.'));
assert.ok(p.isGeneratedPhrase('BATTERY\nAt time of inspection, battery passed load testing, terminals and hold-down secure, no faults found.'.toUpperCase()));

assert.ok(!p.isUsefulLabel('Notes'));
assert.ok(!p.isUsefulLabel('Good'));
assert.ok(!p.isUsefulLabel('Add Finding'));
assert.ok(p.isUsefulLabel('Front Brakes'));
assert.ok(p.isUsefulLabel('WARNING LIGHTS ON DASH'));

// glued "Add finding" (live Tekmetric concatenates it onto the task name)
assert.equal(p.cleanLabel('WARNING LIGHTS ON DASHAdd finding'), 'WARNING LIGHTS ON DASH');
assert.equal(p.phraseFor('HORNAdd finding').rule, 'HORN');
assert.equal(p.phraseFor('WARNING LIGHTS ON DASHAdd finding').rule, 'WARNING LIGHTS ON DASH');
assert.equal(p.phraseFor('HORNAdd finding').text, p.phraseFor('HORN').text);

console.log('PHRASES UNIT OK (' + p.RULES.length + ' rules, ' + Object.keys(SHOP).length + ' shop items)');
