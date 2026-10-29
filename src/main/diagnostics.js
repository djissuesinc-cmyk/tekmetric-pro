const GUIDES = [
  {
    id: 'brakes',
    title: 'Brakes',
    keywords: ['brake', 'brakes', 'rotor', 'pad', 'pulsat', 'grind', 'squeal', 'pedal', 'abs'],
    systems: ['Front brakes', 'Rear brakes', 'Brake hydraulics'],
    steps: [
      'Measure rotor thickness and lateral runout against the vehicle specification.',
      'Inspect pad thickness, taper, slide pins, and caliper piston movement.',
      'If the car pulls or the pedal sinks, check hoses, fluid condition, and for a seized caliper.',
    ],
    questions: [
      'Does it happen only while braking, or also at a steady speed?',
      'Is the pedal soft, long, or pulsating?',
    ],
    safety: 'Do not release the vehicle if the brakes pull, fade, or go toward the floor.',
  },
  {
    id: 'engine',
    title: 'Engine performance',
    keywords: ['misfire', 'rough', 'idle', 'stall', 'no start', 'check engine', 'hesitat', 'power', 'knock'],
    systems: ['Ignition', 'Fuel', 'Air metering', 'Engine mechanical'],
    steps: [
      'Scan and record all codes and freeze-frame data before clearing anything.',
      'Check for misfire counts, fuel trims, and obvious vacuum or ignition faults.',
      'Confirm the complaint on a road test, then inspect the system the data points to.',
    ],
    questions: [
      'Is the light flashing or steady, and did the engine lose power?',
      'Does it happen cold, hot, at idle, or only under load?',
    ],
    safety: 'A flashing check-engine light means a misfire that can damage the catalytic converter. Limit driving.',
  },
  {
    id: 'charging',
    title: 'Charging and starting',
    keywords: ['battery', 'alternator', 'no crank', 'slow crank', 'dim', 'electrical', 'dead'],
    systems: ['Battery', 'Charging system', 'Starter circuit'],
    steps: [
      'Load-test the battery and record voltage before and during cranking.',
      'Measure alternator output and ripple with the electrical load on.',
      'Inspect terminals, grounds, and the belt before replacing parts.',
    ],
    questions: [
      'Was the vehicle jumped, and does it restart after a short drive?',
      'Do the lights dim at idle?',
    ],
    safety: null,
  },
  {
    id: 'cooling',
    title: 'Cooling',
    keywords: ['coolant', 'overheat', 'heat', 'temperature', 'thermostat', 'radiator', 'leak'],
    systems: ['Cooling system', 'Water pump', 'Thermostat'],
    steps: [
      'Pressure-test the system cold and look for external leaks, including the water pump weep hole.',
      'Confirm the cooling fans, thermostat operation, and that the radiator is filling.',
      'Do not open the cap on a hot system.',
    ],
    questions: [
      'Does the temperature climb in traffic, on the highway, or both?',
      'Is there sweet smell, steam, or low coolant?',
    ],
    safety: 'Overheating can warp the head. Stop driving if the gauge is in the red.',
  },
  {
    id: 'steering',
    title: 'Steering and suspension',
    keywords: ['pull', 'vibration', 'shake', 'clunk', 'wander', 'alignment', 'noise', 'bump', 'steering'],
    systems: ['Suspension', 'Steering', 'Wheel balance', 'Alignment'],
    steps: [
      'Road-test to separate a brake pulsation from a balance or driveline vibration.',
      'Inspect tires, wheels, tie rods, ball joints, and strut mounts for play.',
      'Check alignment if the car pulls or the tires are wearing on one edge.',
    ],
    questions: [
      'Is the shake in the seat, the steering wheel, or both, and at what speed?',
      'Did it start after a curb strike or tire work?',
    ],
    safety: 'Play in a ball joint or tie rod is a safety hold. Do not release it that way.',
  },
  {
    id: 'hvac',
    title: 'Heat and A/C',
    keywords: ['a/c', 'ac', 'air conditioning', 'heat', 'blower', 'defrost', 'cold air', 'hot air'],
    systems: ['A/C refrigerant circuit', 'Heater', 'Blower'],
    steps: [
      'Confirm blower speeds and blend-door response before opening the refrigerant system.',
      'For no A/C, check pressures and condenser fan operation rather than adding refrigerant by guess.',
      'For no heat, check coolant level and whether both heater hoses get hot.',
    ],
    questions: [
      'Is the air warm, cool, or not moving at all?',
      'Does it change with engine speed or fan speed?',
    ],
    safety: null,
  },
  {
    id: 'drivetrain',
    title: 'Drivetrain',
    keywords: ['transmission', 'shift', 'slip', 'shudder', 'clutch', 'axle', 'differential', '4wd', 'awd'],
    systems: ['Transmission', 'Axles', 'Differential'],
    steps: [
      'Note which gear, speed, and temperature the complaint shows up in.',
      'Check fluid level and condition before recommending a rebuild.',
      'Inspect CV boots and mounts if the noise is a click on turns or a clunk on takeoff.',
    ],
    questions: [
      'Does it slip, flare, or hit hard, and has the fluid ever been serviced?',
      'Is the noise only while turning?',
    ],
    safety: null,
  },
];

const GENERIC = {
  id: 'general',
  title: 'General confirmation',
  systems: ['Customer complaint', 'Visual inspection', 'Scan tool'],
  steps: [
    'Confirm the complaint on a road test and write down when it happens.',
    'Scan all modules and record codes before disconnecting the battery.',
    'Do a visual check for leaks, obvious damage, and maintenance items related to the visit.',
  ],
  questions: [
    'When did it start, and what changed just before that?',
    'Is it constant, or only in certain weather, speed, or temperature?',
  ],
  safety: null,
};

function unique(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (!item || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

function diagnoseLocal(input) {
  const vehicle = String((input && input.vehicle) || '').trim();
  const symptoms = String((input && input.symptoms) || '').trim();
  const notes = String((input && input.notes) || '').trim();
  if (!symptoms) {
    return {
      ok: false,
      error: 'Describe the symptom first.',
    };
  }
  const haystack = (vehicle + ' ' + symptoms + ' ' + notes).toLowerCase();
  const matched = GUIDES.filter(function (guide) {
    return guide.keywords.some(function (word) {
      return haystack.includes(word);
    });
  });
  const used = matched.length ? matched : [GENERIC];
  const safety = used.map(function (guide) { return guide.safety; }).filter(Boolean);
  return {
    ok: true,
    value: {
      vehicle: vehicle,
      symptoms: symptoms,
      summary: matched.length
        ? 'The wording points at ' + matched.map(function (guide) { return guide.title.toLowerCase(); }).join(' and ') + '.'
        : 'No single system stood out from the wording. Start by confirming the complaint.',
      matches: used.map(function (guide) { return guide.title; }),
      systems: unique(used.flatMap ? used.flatMap(function (guide) { return guide.systems; }) : [].concat.apply([], used.map(function (guide) { return guide.systems; }))),
      steps: unique([].concat.apply([], used.map(function (guide) { return guide.steps; }))),
      questions: unique([].concat.apply([], used.map(function (guide) { return guide.questions; }))),
      safety: safety,
    },
  };
}

module.exports = {
  diagnoseLocal,
};
