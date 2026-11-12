// v2.4.1: item-specific wording for the Quick Actions "Fill No Faults" button.
// Each rule: canonical item name, keyword patterns (tested against the lower-cased item label),
// and the sentence written in the Findings field. Order matters: most specific rules first.
// Finding text is the sentence only — the row already shows the item name.
'use strict';

const GENERIC = 'No faults found at this time.';

const RULES = [
    // Combined / exact shop task names first, so a broad keyword later does not steal them.
    { name: 'WARNING LIGHTS ON DASH', kw: [/warning light/, /dash ?(board)? ?light/, /check engine/, /\bmil\b/, /indicator light/, /instrument (cluster|panel)/], text: 'No warning lights are illuminated on the dashboard.' },
    { name: 'BATTERY AND ALTERNATOR', kw: [/battery.*(alternator|charging)|(alternator|charging).*battery/], text: 'Battery and alternator passed load and amperage testing, no faults found.' },
    { name: 'TIRES TREAD, CONDITION, & PSI', kw: [/tires?.*tread/, /tread.*condition/, /tires?.*\bpsi\b/, /tire(s)? (tread|condition|pressure)/], text: 'Tire tread, condition and pressure are good. No faults found at this time.' },
    { name: 'BODY, FRAME, & CONDITION', kw: [/body.*frame/, /frame.*condition/, /body,?\s*frame/], text: 'Body and frame are in good condition. No faults found at this time.' },
    { name: 'CONTROL ARMS AND BALL JOINTS', kw: [/control arms?.*ball ?joints?/, /ball ?joints?.*control arms?/], text: 'Control arms and ball joints are in good condition, no play found.' },
    { name: 'BRAKE LINES & FUEL LINES', kw: [/brake (lines?|hoses?).*fuel/, /fuel lines?/, /brake (lines?|hoses?)/], text: 'Brake lines and fuel lines are in good condition, no leaks or damage found.' },
    { name: 'WIPER BLADES & WINDSHIELD', kw: [/wiper.*windshield/, /windshield.*wiper/, /wiper/], text: 'Wiper blades and windshield are in good condition. No faults found at this time.' },
    { name: 'SHOCKS, STRUTS & SPRINGS', kw: [/shocks?.*struts?/, /struts?.*springs?/, /shocks?\b/, /struts?\b/, /dampers?/], text: 'Shocks, struts and springs are in good condition. No faults found at this time.' },
    { name: 'FRONT BRAKE PADS AND ROTORS', kw: [/front brake/, /brakes?.*\bfront\b/, /\bfront\b.*(pads?|rotors?)/], text: 'Front brake pads and rotors are in good condition. No faults found at this time.' },
    { name: 'REAR BRAKE PADS AND ROTORS/DRUMS', kw: [/rear brake/, /brakes?.*\brear\b/, /\brear\b.*(pads?|rotors?|shoes?|drums?)/], text: 'Rear brake pads and rotors/drums are in good condition. No faults found at this time.' },
    { name: 'SWAY BAR BUSHINGS & STABILIZER LINKS', kw: [/sway ?bar/, /stabili[sz]er/, /end links?/, /anti-?roll/], text: 'Sway bar bushings and stabilizer links are in good condition, no play found.' },
    { name: 'CV AXLE & BOOTS', kw: [/\bcv\b/, /axles?\b/, /half ?shaft/], text: 'CV axles and boots are in good condition, no tears or leaks found.' },
    { name: 'CABIN AIR FILTER', kw: [/cabin/, /pollen filter/], text: 'The cabin air filter is clean and in good condition. No faults found at this time.' },
    { name: 'BATTERY & TERMINALS', kw: [/batter(y|ies)/], text: 'The battery and terminals are in good condition. No faults found at this time.' },
    { name: 'ALTERNATOR', kw: [/alternator/, /charging/], text: 'Battery and alternator passed load and amperage testing, no faults found.' },
    { name: 'FLUID LEVELS', kw: [/fluid levels?/, /fluid (condition|check|status)/], text: 'All fluid levels are good. No faults found at this time.' },
    { name: 'LIGHT CHECK', kw: [/light check/, /lights? (check|operation|function)/], text: 'All exterior and interior lights are working. No faults found at this time.' },
    { name: 'OTHER FAULTS FOUND', kw: [/other faults?( found| not listed)?/, /additional faults?/], text: GENERIC },

    // Dash / electrical
    { name: 'STARTER', kw: [/starter/, /starting system/, /cranking/], text: 'The starter cranked the engine normally, no faults found.' },
    { name: 'TPMS', kw: [/\btpms\b/, /tire pressure monitor/, /pressure sensor/], text: 'The tire pressure monitoring system is working, no warning on the dash.' },
    { name: 'BRAKE LIGHTS', kw: [/brake lights?/, /stop lights?/, /third brake/], text: 'Brake lights are working, no faults found.' },
    { name: 'HEADLIGHTS', kw: [/head ?lights?/, /head ?lamps?/, /high beams?/, /low beams?/], text: 'Headlights are working on low and high beam, no faults found.' },
    { name: 'TURN SIGNALS', kw: [/turn signals?/, /signal lights?/, /blinkers?/, /hazard/], text: 'Turn signals and hazard lights are working, no faults found.' },
    { name: 'EXTERIOR LIGHTS', kw: [/exterior light/, /tail ?lights?/, /park(ing)? lights?/, /fog lights?/, /license plate light/, /reverse lights?/, /backup lights?/], text: 'All exterior lights are working, no faults found.' },
    { name: 'HORN', kw: [/\bhorn\b/], text: 'The horn is working. No faults found at this time.' },

    // Fluids / leaks
    { name: 'BRAKE FLUID', kw: [/brake fluid/, /brake reservoir/, /master cylinder/], text: 'Brake fluid level and condition are good, no leaks found.' },
    { name: 'POWER STEERING', kw: [/power steering/, /\bp\/?s fluid/], text: 'Power steering fluid level is good and the system is operating normally, no leaks found.' },
    { name: 'TRANSMISSION FLUID', kw: [/trans(mission)? fluid/, /\batf\b/, /\bcvt fluid/], text: 'Transmission fluid level and condition are good, no leaks found.' },
    { name: 'WASHER FLUID', kw: [/washer/], text: 'Washer fluid level is good and the washers are spraying normally.' },
    { name: 'OIL LEAKS', kw: [/oil leak/, /leak.*oil/], text: 'No oil leaks were found at this time.' },
    { name: 'FLUID LEAKS', kw: [/leak/], text: 'No fluid leaks were found at this time.' },
    { name: 'RADIATOR AND HOSES', kw: [/radiator/, /coolant hoses?/], text: 'Radiator and coolant hoses are in good condition, no leaks or cracks found.' },
    { name: 'COOLANT', kw: [/coolant/, /antifreeze/, /anti-freeze/, /cooling system/], text: 'Coolant level and condition are good, no leaks found.' },
    { name: 'ENGINE OIL', kw: [/\boil\b/, /oil level/, /oil condition/], text: 'Engine oil level and condition are good, no faults found.' },

    // Filters / belts
    { name: 'ENGINE AIR FILTER', kw: [/air filter/, /air cleaner/], text: 'The engine air filter is clean and in good condition. No faults found at this time.' },
    { name: 'SEAT BELTS', kw: [/seat ?belts?/, /safety belts?/], text: 'Seat belts latch and retract normally, no faults found.' },
    { name: 'DRIVE BELT', kw: [/belts?\b/], text: 'Drive belt(s) are in good condition, no cracks, glazing or fraying found.' },

    // Glass / body
    { name: 'WINDSHIELD AND GLASS', kw: [/windshield/, /windscreen/, /\bglass\b/, /windows?\b/], text: 'Windshield and glass are in good condition, no cracks or chips found.' },
    { name: 'DOORS, LATCHES AND HINGES', kw: [/doors?\b/, /latch/, /hinge/, /\block(s)?\b/], text: 'Doors, latches and hinges are working, no faults found.' },

    // Brakes
    { name: 'PARKING BRAKE', kw: [/parking brake/, /park brake/, /e-?brake/, /emergency brake/, /hand ?brake/], text: 'The parking brake holds and releases normally, no faults found.' },
    { name: 'BRAKE CALIPERS', kw: [/caliper/], text: 'Brake calipers are secure and working, no leaks found.' },
    { name: 'BRAKE ROTORS', kw: [/rotors?\b/, /drums?\b/], text: 'Brake rotors are in good condition, no scoring or warping found.' },
    { name: 'BRAKE PADS', kw: [/pads?\b/, /shoes?\b/, /lining/], text: 'Brake pads have good thickness left, no faults found.' },
    { name: 'BRAKES', kw: [/brake/], text: 'Brakes are in good condition, no faults found.' },

    // Tires / wheels
    { name: 'WHEEL BEARINGS', kw: [/wheel bearing/, /hub bearing/, /\bbearings?\b/, /\bhubs?\b/], text: 'No noise or play was found in the wheel bearings.' },
    { name: 'TIRE PRESSURE', kw: [/tire pressure/, /tyre pressure/, /\bpsi\b/, /inflation/], text: 'Tire pressures were checked, no faults found.' },
    { name: 'TIRE TREAD', kw: [/tread/], text: 'Tire tread depth is good on all tires, no faults found.' },
    { name: 'SPARE TIRE', kw: [/spare/], text: 'The spare tire is in good condition, no faults found.' },
    { name: 'TIRES', kw: [/tires?\b/, /tyres?\b/, /sidewall/, /wheels?\b/], text: 'Tires have good tread depth and pressure, no damage or uneven wear found.' },

    // Steering / suspension
    { name: 'TIE RODS', kw: [/tie ?rods?/], text: 'No play was found in the inner or outer tie rods.' },
    { name: 'STEERING RACK', kw: [/steering rack/, /\brack\b/, /steering gear/], text: 'The steering rack is in good condition, no leaks or play found.' },
    { name: 'BALL JOINTS', kw: [/ball ?joints?/], text: 'No play was found in the ball joints.' },
    { name: 'CONTROL ARMS AND BUSHINGS', kw: [/control arms?/, /bushings?/, /\barms?\b/], text: 'Control arms and bushings are in good condition, no cracks or play found.' },
    { name: 'SUSPENSION', kw: [/suspension/, /springs?\b/], text: 'Suspension components are in good condition, no faults found.' },
    { name: 'STEERING', kw: [/steering/], text: 'Steering is operating normally, no play or noise found.' },

    // Underbody / driveline
    { name: 'EXHAUST SYSTEM', kw: [/exhaust/, /muffler/, /catalytic/, /tail ?pipe/], text: 'The exhaust system is secure, no leaks or damage found.' },
    { name: 'DIFFERENTIAL', kw: [/differential/, /\bdiff\b/, /transfer case/], text: 'The differential is in good condition, no leaks or noise found.' },
    { name: 'DRIVELINE', kw: [/driveline/, /drive ?shaft/, /u-?joints?/, /prop(eller)? ?shaft/], text: 'Driveline components are in good condition, no leaks, play or noise found.' },
    { name: 'ENGINE MOUNTS', kw: [/mounts?\b/], text: 'Engine and transmission mounts are in good condition, no cracks or excess movement found.' },
    { name: 'UNDERCARRIAGE', kw: [/under ?carriage/, /under ?body/, /under ?side/, /frame/, /under vehicle/], text: 'The underbody is in good condition, no damage or leaks found.' },
    { name: 'TRANSMISSION', kw: [/transmission/, /\btrans\b/, /gearbox/], text: 'The transmission is shifting normally, no leaks found.' },

    // Comfort / road test / leftover lights
    { name: 'A/C SYSTEM', kw: [/\ba\/?c\b/, /air ?condition/], text: 'A/C is blowing cold, no faults found.' },
    { name: 'HEATING AND A/C', kw: [/hvac/, /heater/, /heating/, /climate/, /blower/, /defrost/], text: 'Heating and A/C are working, no faults found.' },
    { name: 'ROAD TEST', kw: [/road ?test/, /test drive/, /drive test/], text: 'Vehicle drove, steered and braked normally, no faults found.' },
    { name: 'LIGHTS', kw: [/lights?\b/, /lamps?\b/, /bulbs?\b/], text: 'All exterior and interior lights are working. No faults found at this time.' },
];

// 2.4.0 sentences (and the old "At time of inspection" prefix form) so Clear still
// removes text that an earlier build wrote.
const LEGACY = [
    'At time of inspection, no faults were found, no warning lights were on.',
    'At time of inspection, battery and alternator passed load and amperage testing, no faults found.',
    'At time of inspection, battery passed load testing, terminals and hold-down secure, no faults found.',
    'At time of inspection, charging system passed amperage and voltage output testing, no faults found.',
    'At time of inspection, starter cranked the engine normally, no faults found.',
    'At time of inspection, tire pressure monitoring system worked, no warning on dash.',
    'At time of inspection, brake lights worked, no faults found.',
    'At time of inspection, headlights worked on low and high beam, no faults found.',
    'At time of inspection, turn signals and hazard lights worked, no faults found.',
    'At time of inspection, all exterior lights worked, no faults found.',
    'At time of inspection, horn worked, no faults found.',
    'At time of inspection, brake lines and hoses were in good condition, no leaks or damage found.',
    'At time of inspection, brake fluid level and condition were good, no leaks found.',
    'At time of inspection, power steering fluid level was good and system operated normally, no leaks found.',
    'At time of inspection, transmission fluid level and condition were good, no leaks found.',
    'At time of inspection, washer fluid level was good and washers sprayed normally.',
    'At time of inspection, no oil leaks were found.',
    'At time of inspection, no fluid leaks were found.',
    'At time of inspection, radiator and coolant hoses were in good condition, no leaks or cracks found.',
    'At time of inspection, coolant level and condition were good, no leaks found.',
    'At time of inspection, engine oil level and condition were good, no faults found.',
    'At time of inspection, cabin air filter was clean, no faults found.',
    'At time of inspection, engine air filter was clean, no faults found.',
    'At time of inspection, seat belts latched and retracted normally, no faults found.',
    'At time of inspection, drive belt was in good condition, no cracks, glazing or fraying found.',
    'At time of inspection, wiper blades cleared the windshield cleanly, no streaking or damage found.',
    'At time of inspection, windshield and glass were in good condition, no cracks or chips found.',
    'At time of inspection, doors, latches and hinges worked, no faults found.',
    'At time of inspection, parking brake held and released normally, no faults found.',
    'At time of inspection, front brake pads, rotors and calipers were in good condition, no faults found.',
    'At time of inspection, rear brakes were in good condition with good lining left, no faults found.',
    'At time of inspection, brake calipers were secure and working, no leaks found.',
    'At time of inspection, brake rotors were in good condition, no scoring or warping found.',
    'At time of inspection, brake pads had good thickness left, no faults found.',
    'At time of inspection, brakes were in good condition, no faults found.',
    'At time of inspection, no noise or play was found in the wheel bearings.',
    'At time of inspection, tire pressures were checked, no faults found.',
    'At time of inspection, tire tread depth was good on all tires, no faults found.',
    'At time of inspection, spare tire was in good condition, no faults found.',
    'At time of inspection, tires had good tread depth and pressure, no damage or uneven wear found.',
    'At time of inspection, no play was found in the inner or outer tie rods.',
    'At time of inspection, steering rack was in good condition, no leaks or play found.',
    'At time of inspection, shocks and struts were in good condition, no leaks or damage found.',
    'At time of inspection, no play was found in the ball joints.',
    'At time of inspection, sway bar links and bushings were in good condition, no play found.',
    'At time of inspection, control arms and bushings were in good condition, no cracks or play found.',
    'At time of inspection, CV axles and boots were in good condition, no tears or leaks found.',
    'At time of inspection, suspension components were in good condition, no faults found.',
    'At time of inspection, steering operated normally, no play or noise found.',
    'At time of inspection, exhaust system was secure, no leaks or damage found.',
    'At time of inspection, differential was in good condition, no leaks or noise found.',
    'At time of inspection, driveline components were in good condition, no leaks, play or noise found.',
    'At time of inspection, engine and transmission mounts were in good condition, no cracks or excess movement found.',
    'At time of inspection, underbody was in good condition, no damage or leaks found.',
    'At time of inspection, transmission shifted normally, no leaks found.',
    'At time of inspection, A/C blew cold, no faults found.',
    'At time of inspection, heating and A/C worked, no faults found.',
    'At time of road test, vehicle drove, steered and braked normally, no faults found.',
    'At time of inspection, all lights worked, no faults found.',
];

// Words that show up near Tekmetric textareas but are not an inspection item name.
const GENERIC_LABEL = /^(notes?|findings?|comments?|recommendations?|technician notes?|tech notes?|add (a )?(note|finding|comment)s?|details?|description|good|fair|poor|ok|pass(ed)?|fail(ed)?|green|yellow|red|needs attention|attention|urgent|not inspected|n\/a|na|none|inspection|inspections|status|condition|select|save|cancel|edit|delete|remove|photo|photos|video|media|upload|rating|inspection task|rate all tasks|type here.*|enter .*|write .*)$/i;

function norm(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase(); }

function cleanLabel(label) {
    let s = String(label == null ? '' : label).replace(/\s+/g, ' ').trim();
    s = s.replace(/[:*\u2022\-–—\s]+$/, '').replace(/^[\d.)\s\-–—\u2022]+(?=[a-z])/i, '').trim();
    return s;
}

function isUsefulLabel(label) {
    const s = cleanLabel(label);
    if (s.length < 2 || s.length > 120) return false;
    if (GENERIC_LABEL.test(s)) return false;
    if (!/[a-z]/i.test(s)) return false;
    return true;
}

function matchRule(label) {
    const l = norm(cleanLabel(label));
    if (!l) return null;
    for (const r of RULES) if (r.kw.some(re => re.test(l))) return r;
    return null;
}

// Returns { text, rule, header } for one item label. Unknown or empty -> the generic sentence.
// v2.4.1: text is the sentence only (no item-name first line); the inspection row already shows the name.
function phraseFor(label) {
    const rule = matchRule(label);
    const c = cleanLabel(label);
    const header = rule ? ((c && c.length <= 80 ? c : rule.name).toUpperCase()) : (c ? c.toUpperCase() : null);
    if (!rule) return { text: GENERIC, rule: null, header };
    return { text: rule.text, rule: rule.name, header };
}

const SENTENCES = new Set(RULES.map(r => norm(r.text)).concat(LEGACY.map(norm)));
SENTENCES.add(norm(GENERIC));

// True only for text that is exactly something Fill wrote (any case / spacing, e.g. after Auto Uppercase):
// the generic sentence, a library sentence on its own, or one header line + a library/legacy sentence.
function isGeneratedPhrase(value) {
    const raw = String(value == null ? '' : value).replace(/\r\n?/g, '\n').trim();
    if (!raw) return false;
    const n = norm(raw);
    if (SENTENCES.has(n) || n === norm(GENERIC)) return true;
    const nl = raw.indexOf('\n');
    if (nl < 0) return false;
    const header = raw.slice(0, nl).trim(), body = norm(raw.slice(nl + 1));
    if (!header || header.length > 80) return false;
    return SENTENCES.has(body);
}

module.exports = { GENERIC, RULES, LEGACY, phraseFor, matchRule, isGeneratedPhrase, isUsefulLabel, cleanLabel, norm };
