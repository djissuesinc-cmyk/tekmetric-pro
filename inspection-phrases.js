// v2.4.0: item-specific wording for the Quick Actions "Fill No Faults" button.
// Each rule: canonical item name, keyword patterns (tested against the lower-cased item label),
// and the sentence written under the item name. Order matters: most specific rules first.
'use strict';

const GENERIC = 'No faults found at this time.';
const AT = 'At time of inspection, ';

const RULES = [
    // Dash / electrical
    { name: 'WARNING LIGHTS ON DASH', kw: [/warning light/, /dash ?(board)? ?light/, /check engine/, /\bmil\b/, /indicator light/, /instrument (cluster|panel)/], text: AT + 'no faults were found, no warning lights were on.' },
    { name: 'BATTERY AND ALTERNATOR', kw: [/battery.*(alternator|charging)|(alternator|charging).*battery/], text: AT + 'battery and alternator passed load and amperage testing, no faults found.' },
    { name: 'BATTERY', kw: [/batter(y|ies)/], text: AT + 'battery passed load testing, terminals and hold-down secure, no faults found.' },
    { name: 'CHARGING SYSTEM', kw: [/alternator/, /charging/], text: AT + 'charging system passed amperage and voltage output testing, no faults found.' },
    { name: 'STARTER', kw: [/starter/, /starting system/, /cranking/], text: AT + 'starter cranked the engine normally, no faults found.' },
    { name: 'TPMS', kw: [/\btpms\b/, /tire pressure monitor/, /pressure sensor/], text: AT + 'tire pressure monitoring system worked, no warning on dash.' },
    { name: 'BRAKE LIGHTS', kw: [/brake lights?/, /stop lights?/, /third brake/], text: AT + 'brake lights worked, no faults found.' },
    { name: 'HEADLIGHTS', kw: [/head ?lights?/, /head ?lamps?/, /high beams?/, /low beams?/], text: AT + 'headlights worked on low and high beam, no faults found.' },
    { name: 'TURN SIGNALS', kw: [/turn signals?/, /signal lights?/, /blinkers?/, /hazard/], text: AT + 'turn signals and hazard lights worked, no faults found.' },
    { name: 'EXTERIOR LIGHTS', kw: [/exterior light/, /tail ?lights?/, /park(ing)? lights?/, /fog lights?/, /license plate light/, /reverse lights?/, /backup lights?/], text: AT + 'all exterior lights worked, no faults found.' },
    { name: 'HORN', kw: [/\bhorn\b/], text: AT + 'horn worked, no faults found.' },

    // Fluids / leaks
    { name: 'BRAKE LINES AND HOSES', kw: [/brake (lines?|hoses?)/], text: AT + 'brake lines and hoses were in good condition, no leaks or damage found.' },
    { name: 'BRAKE FLUID', kw: [/brake fluid/, /brake reservoir/, /master cylinder/], text: AT + 'brake fluid level and condition were good, no leaks found.' },
    { name: 'POWER STEERING', kw: [/power steering/, /\bp\/?s fluid/], text: AT + 'power steering fluid level was good and system operated normally, no leaks found.' },
    { name: 'TRANSMISSION FLUID', kw: [/trans(mission)? fluid/, /\batf\b/, /\bcvt fluid/], text: AT + 'transmission fluid level and condition were good, no leaks found.' },
    { name: 'WASHER FLUID', kw: [/washer/], text: AT + 'washer fluid level was good and washers sprayed normally.' },
    { name: 'OIL LEAKS', kw: [/oil leak/, /leak.*oil/], text: AT + 'no oil leaks were found.' },
    { name: 'FLUID LEAKS', kw: [/leak/], text: AT + 'no fluid leaks were found.' },
    { name: 'RADIATOR AND HOSES', kw: [/radiator/, /hoses?\b/], text: AT + 'radiator and coolant hoses were in good condition, no leaks or cracks found.' },
    { name: 'COOLANT', kw: [/coolant/, /antifreeze/, /anti-freeze/, /cooling system/], text: AT + 'coolant level and condition were good, no leaks found.' },
    { name: 'ENGINE OIL', kw: [/\boil\b/, /oil level/, /oil condition/], text: AT + 'engine oil level and condition were good, no faults found.' },

    // Filters / belts
    { name: 'CABIN AIR FILTER', kw: [/cabin/, /pollen filter/], text: AT + 'cabin air filter was clean, no faults found.' },
    { name: 'ENGINE AIR FILTER', kw: [/air filter/, /air cleaner/], text: AT + 'engine air filter was clean, no faults found.' },
    { name: 'SEAT BELTS', kw: [/seat ?belts?/, /safety belts?/], text: AT + 'seat belts latched and retracted normally, no faults found.' },
    { name: 'DRIVE BELT', kw: [/belts?\b/], text: AT + 'drive belt was in good condition, no cracks, glazing or fraying found.' },

    // Wipers / glass / body
    { name: 'WIPER BLADES', kw: [/wiper/], text: AT + 'wiper blades cleared the windshield cleanly, no streaking or damage found.' },
    { name: 'WINDSHIELD AND GLASS', kw: [/windshield/, /windscreen/, /\bglass\b/, /windows?\b/], text: AT + 'windshield and glass were in good condition, no cracks or chips found.' },
    { name: 'DOORS, LATCHES AND HINGES', kw: [/doors?\b/, /latch/, /hinge/, /\block(s)?\b/], text: AT + 'doors, latches and hinges worked, no faults found.' },

    // Brakes
    { name: 'PARKING BRAKE', kw: [/parking brake/, /park brake/, /e-?brake/, /emergency brake/, /hand ?brake/], text: AT + 'parking brake held and released normally, no faults found.' },
    { name: 'FRONT BRAKES', kw: [/front brake/, /brakes?.*\bfront\b/, /\bfront\b.*(pads?|rotors?)/], text: AT + 'front brake pads, rotors and calipers were in good condition, no faults found.' },
    { name: 'REAR BRAKES', kw: [/rear brake/, /brakes?.*\brear\b/, /\brear\b.*(pads?|rotors?|shoes?|drums?)/], text: AT + 'rear brakes were in good condition with good lining left, no faults found.' },
    { name: 'BRAKE CALIPERS', kw: [/caliper/], text: AT + 'brake calipers were secure and working, no leaks found.' },
    { name: 'BRAKE ROTORS', kw: [/rotors?\b/, /drums?\b/], text: AT + 'brake rotors were in good condition, no scoring or warping found.' },
    { name: 'BRAKE PADS', kw: [/pads?\b/, /shoes?\b/, /lining/], text: AT + 'brake pads had good thickness left, no faults found.' },
    { name: 'BRAKES', kw: [/brake/], text: AT + 'brakes were in good condition, no faults found.' },

    // Tires / wheels
    { name: 'WHEEL BEARINGS', kw: [/wheel bearing/, /hub bearing/, /\bbearings?\b/, /\bhubs?\b/], text: AT + 'no noise or play was found in the wheel bearings.' },
    { name: 'TIRE PRESSURE', kw: [/tire pressure/, /tyre pressure/, /\bpsi\b/, /inflation/], text: AT + 'tire pressures were checked, no faults found.' },
    { name: 'TIRE TREAD', kw: [/tread/], text: AT + 'tire tread depth was good on all tires, no faults found.' },
    { name: 'SPARE TIRE', kw: [/spare/], text: AT + 'spare tire was in good condition, no faults found.' },
    { name: 'TIRES', kw: [/tires?\b/, /tyres?\b/, /sidewall/, /wheels?\b/], text: AT + 'tires had good tread depth and pressure, no damage or uneven wear found.' },

    // Steering / suspension
    { name: 'TIE RODS', kw: [/tie ?rods?/], text: AT + 'no play was found in the inner or outer tie rods.' },
    { name: 'STEERING RACK', kw: [/steering rack/, /\brack\b/, /steering gear/], text: AT + 'steering rack was in good condition, no leaks or play found.' },
    { name: 'SHOCKS AND STRUTS', kw: [/shocks?\b/, /struts?\b/, /dampers?/], text: AT + 'shocks and struts were in good condition, no leaks or damage found.' },
    { name: 'BALL JOINTS', kw: [/ball ?joints?/], text: AT + 'no play was found in the ball joints.' },
    { name: 'SWAY BAR LINKS', kw: [/sway ?bar/, /stabili[sz]er/, /end links?/, /anti-?roll/], text: AT + 'sway bar links and bushings were in good condition, no play found.' },
    { name: 'CONTROL ARMS AND BUSHINGS', kw: [/control arms?/, /bushings?/, /\barms?\b/], text: AT + 'control arms and bushings were in good condition, no cracks or play found.' },
    { name: 'CV AXLES AND BOOTS', kw: [/\bcv\b/, /axles?\b/, /boots?\b/, /half ?shaft/], text: AT + 'CV axles and boots were in good condition, no tears or leaks found.' },
    { name: 'SUSPENSION', kw: [/suspension/, /springs?\b/], text: AT + 'suspension components were in good condition, no faults found.' },
    { name: 'STEERING', kw: [/steering/], text: AT + 'steering operated normally, no play or noise found.' },

    // Underbody / driveline
    { name: 'EXHAUST SYSTEM', kw: [/exhaust/, /muffler/, /catalytic/, /tail ?pipe/], text: AT + 'exhaust system was secure, no leaks or damage found.' },
    { name: 'DIFFERENTIAL', kw: [/differential/, /\bdiff\b/, /transfer case/], text: AT + 'differential was in good condition, no leaks or noise found.' },
    { name: 'DRIVELINE', kw: [/driveline/, /drive ?shaft/, /u-?joints?/, /prop(eller)? ?shaft/], text: AT + 'driveline components were in good condition, no leaks, play or noise found.' },
    { name: 'ENGINE MOUNTS', kw: [/mounts?\b/], text: AT + 'engine and transmission mounts were in good condition, no cracks or excess movement found.' },
    { name: 'UNDERCARRIAGE', kw: [/under ?carriage/, /under ?body/, /under ?side/, /frame/, /under vehicle/], text: AT + 'underbody was in good condition, no damage or leaks found.' },
    { name: 'TRANSMISSION', kw: [/transmission/, /\btrans\b/, /gearbox/], text: AT + 'transmission shifted normally, no leaks found.' },

    // Comfort / road test
    { name: 'A/C SYSTEM', kw: [/\ba\/?c\b/, /air ?condition/], text: AT + 'A/C blew cold, no faults found.' },
    { name: 'HEATING AND A/C', kw: [/hvac/, /heater/, /heating/, /climate/, /blower/, /defrost/], text: AT + 'heating and A/C worked, no faults found.' },
    { name: 'ROAD TEST', kw: [/road ?test/, /test drive/, /drive test/], text: 'At time of road test, vehicle drove, steered and braked normally, no faults found.' },
    { name: 'LIGHTS', kw: [/lights?\b/, /lamps?\b/, /bulbs?\b/], text: AT + 'all lights worked, no faults found.' },
];

// Words that show up near Tekmetric textareas but are not an inspection item name.
const GENERIC_LABEL = /^(notes?|findings?|comments?|recommendations?|technician notes?|tech notes?|add (a )?(note|finding|comment)s?|details?|description|good|fair|poor|ok|pass(ed)?|fail(ed)?|green|yellow|red|needs attention|attention|urgent|not inspected|n\/a|na|none|inspection|inspections|status|condition|select|save|cancel|edit|delete|remove|photo|photos|video|media|upload|type here.*|enter .*|write .*)$/i;

function norm(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase(); }

function cleanLabel(label) {
    let s = String(label == null ? '' : label).replace(/\s+/g, ' ').trim();
    s = s.replace(/[:*\u2022\-–—\s]+$/, '').replace(/^[\d.)\s\-–—\u2022]+(?=[a-z])/i, '').trim();
    return s;
}

function isUsefulLabel(label) {
    const s = cleanLabel(label);
    if (s.length < 2 || s.length > 80) return false;
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

// Returns { text, rule, header } for one item label. Unknown or empty -> the old generic sentence.
function phraseFor(label) {
    const rule = matchRule(label);
    if (!rule) return { text: GENERIC, rule: null, header: null };
    const c = cleanLabel(label);
    const header = (c && c.length <= 60 ? c : rule.name).toUpperCase();
    return { text: header + '\n' + rule.text, rule: rule.name, header };
}

const SENTENCES = new Set(RULES.map(r => norm(r.text)));

// True only for text that is exactly something Fill wrote (any case / spacing, e.g. after Auto Uppercase):
// the old generic sentence, a library sentence on its own, or one header line + a library sentence.
function isGeneratedPhrase(value) {
    const raw = String(value == null ? '' : value).replace(/\r\n?/g, '\n').trim();
    if (!raw) return false;
    const n = norm(raw);
    if (n === norm(GENERIC) || SENTENCES.has(n)) return true;
    const nl = raw.indexOf('\n');
    if (nl < 0) return false;
    const header = raw.slice(0, nl).trim(), body = norm(raw.slice(nl + 1));
    if (!header || header.length > 80) return false;
    return SENTENCES.has(body);
}

module.exports = { GENERIC, RULES, phraseFor, matchRule, isGeneratedPhrase, isUsefulLabel, cleanLabel, norm };
