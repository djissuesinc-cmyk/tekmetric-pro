const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const textUtil = require('../shared/text');
const validate = require('./validate');

const DEFAULT_SETTINGS = {
  shopName: "Craig's Leaside Automotive",
  address: 'Unit 10, 25 Commercial Road',
  city: 'Toronto, ON M4G 1Z4',
  phone: '416-421-3030',
  email: 'info@craigsleaside.com',
  darkMode: false,
  geminiModel: 'gemini-2.5-flash',
  tekmetricUrl: 'https://shop.tekmetric.com',
};

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function seed() {
  const today = textUtil.shopDateParts(new Date()).iso;
  const monday = textUtil.mondayOf(today);
  const appointments = [
    {
      id: 'apt-sample-1',
      customer: 'Alex Morgan',
      vehicle: '2018 Honda CR-V',
      service: 'Oil change and inspection',
      date: today,
      time: '08:00',
      notes: 'Waiting in the lobby.',
      done: true,
      sample: true,
    },
    {
      id: 'apt-sample-2',
      customer: 'Priya Shah',
      vehicle: '2015 Mazda3',
      service: 'Brake inspection',
      date: today,
      time: '10:30',
      notes: 'Pulsation from the front.',
      done: false,
      sample: true,
    },
    {
      id: 'apt-sample-3',
      customer: 'Sam Okonkwo',
      vehicle: '2020 Ram 1500',
      service: 'Check engine light',
      date: today,
      time: '13:15',
      notes: 'Rough idle on cold start.',
      done: false,
      sample: true,
    },
    {
      id: 'apt-sample-4',
      customer: 'Riley Chen',
      vehicle: '2012 Subaru Outback',
      service: 'Coolant leak check',
      date: textUtil.addDays(monday, 0),
      time: '09:00',
      notes: '',
      done: false,
      sample: true,
    },
    {
      id: 'apt-sample-5',
      customer: 'Jordan Hale',
      vehicle: '2016 Toyota RAV4',
      service: 'Seasonal tire swap',
      date: textUtil.addDays(monday, 4),
      time: '08:30',
      notes: 'Store the all-seasons.',
      done: false,
      sample: true,
    },
  ];
  const repairs = [
    validate.validateRepair({
      id: 'ro-sample-1',
      number: 4821,
      customer: 'Alex Morgan',
      phone: '416-555-0142',
      vehicle: '2018 Honda CR-V',
      plate: 'CLAT 104',
      vin: '2HKRM4H75JH000001',
      mileage: 98420,
      concern: 'Steering wheel shakes when braking from highway speed.',
      status: 'in-progress',
      advisorComment: 'Front rotors are below discard and the pads are tapered. Recommended front pads and rotors.',
      lineItems: [
        { description: 'Front brake pads', qty: '1', unitPrice: '89.95' },
        { description: 'Front rotors', qty: '2', unitPrice: '124.50' },
        { description: 'Brake labor', qty: '1.5', unitPrice: '149.00' },
      ],
      sample: true,
    }).value,
    validate.validateRepair({
      id: 'ro-sample-2',
      number: 4822,
      customer: 'Priya Shah',
      phone: '416-555-0177',
      vehicle: '2015 Mazda3',
      plate: 'BXYZ 219',
      vin: '',
      mileage: 142330,
      concern: 'Due for an oil service. Customer also asked us to look at a slow driver window.',
      status: 'ready',
      advisorComment: 'Oil and filter replaced. Window switch is noisy but still works. Customer will book that later.',
      lineItems: [
        { description: 'Oil and filter', qty: '1', unitPrice: '79.95' },
        { description: 'Shop supplies', qty: '1', unitPrice: '6.50' },
      ],
      sample: true,
    }).value,
    validate.validateRepair({
      id: 'ro-sample-3',
      number: 4823,
      customer: 'Sam Okonkwo',
      phone: '647-555-0190',
      vehicle: '2020 Ram 1500',
      plate: 'CRDS 880',
      vin: '1C6SRFFT0LN000003',
      mileage: 76110,
      concern: 'Check engine light and a rough idle for the first minute after a cold start.',
      status: 'waiting-parts',
      advisorComment: 'Stored misfire on cylinder 3. Coil and plug are ordered. Vehicle is safe to leave parked in the lot.',
      lineItems: [
        { description: 'Ignition coil', qty: '1', unitPrice: '68.00' },
        { description: 'Spark plug', qty: '1', unitPrice: '18.40' },
      ],
      sample: true,
    }).value,
    validate.validateRepair({
      id: 'ro-sample-4',
      number: 4824,
      customer: 'Riley Chen',
      phone: '416-555-0118',
      vehicle: '2012 Subaru Outback',
      plate: 'SUBB 412',
      vin: '',
      mileage: 188904,
      concern: 'Coolant smell after parking and the overflow bottle is low.',
      status: 'estimate',
      advisorComment: '',
      lineItems: [],
      sample: true,
    }).value,
  ];
  return {
    version: 1,
    settings: Object.assign({}, DEFAULT_SETTINGS),
    appointments: appointments,
    repairOrders: repairs,
    notice: '',
  };
}

function createStore(file) {
  let state = load(file);
  let queue = Promise.resolve();

  function load(target) {
    if (!fs.existsSync(target)) {
      const fresh = seed();
      writeJson(target, fresh);
      return fresh;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
      if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.appointments) || !Array.isArray(parsed.repairOrders)) {
        throw new Error('bad shape');
      }
      return normalize(parsed);
    } catch (err) {
      const backup = target + '.corrupt-' + Date.now();
      try { fs.renameSync(target, backup); } catch (renameErr) { /* keep going */ }
      const fresh = seed();
      fresh.notice = 'The saved shop file was damaged. It was set aside and the board was started again.';
      writeJson(target, fresh);
      return fresh;
    }
  }

  function normalize(parsed) {
    const settingsResult = validate.validateSettings(Object.assign({}, DEFAULT_SETTINGS, parsed.settings || {}));
    const settings = settingsResult.ok ? settingsResult.value : Object.assign({}, DEFAULT_SETTINGS);
    const appointments = [];
    const repairOrders = [];
    let skipped = 0;
    for (const row of parsed.appointments) {
      const result = validate.validateAppointment(row);
      if (result.ok) appointments.push(result.value);
      else skipped += 1;
    }
    for (const row of parsed.repairOrders) {
      const result = validate.validateRepair(row);
      if (result.ok) repairOrders.push(Object.assign({}, result.value, { updatedAt: row.updatedAt || '' }));
      else skipped += 1;
    }
    return {
      version: 1,
      settings: settings,
      appointments: appointments,
      repairOrders: repairOrders,
      notice: skipped
        ? 'Some saved records were unreadable and were left off the board.'
        : (typeof parsed.notice === 'string' ? parsed.notice : ''),
    };
  }

  function commit(mutator) {
    const run = queue.then(function () {
      const next = mutator();
      writeJson(file, state);
      return next;
    });
    queue = run.then(function () { return null; }, function () { return null; });
    return run;
  }

  function nextNumber() {
    const numbers = state.repairOrders.map(function (order) { return order.number; }).filter(function (n) {
      return Number.isInteger(n);
    });
    return (numbers.length ? Math.max.apply(null, numbers) : 4800) + 1;
  }

  function publicState() {
    const clock = textUtil.shopDateParts(new Date());
    const hours = textUtil.weekdayHours(clock.weekdayIndex);
    const minutes = clock.hour * 60 + Number(clock.minute);
    let openLabel = 'Closed today';
    if (hours) {
      const openAt = Number(hours.open.slice(0, 2)) * 60 + Number(hours.open.slice(3));
      const closeAt = Number(hours.close.slice(0, 2)) * 60 + Number(hours.close.slice(3));
      if (minutes >= openAt && minutes < closeAt) openLabel = 'Open until ' + textUtil.formatTime(hours.close);
      else if (minutes < openAt) openLabel = 'Opens ' + textUtil.formatTime(hours.open);
      else openLabel = 'Closed';
    }
    return {
      settings: state.settings,
      appointments: state.appointments,
      repairOrders: state.repairOrders,
      notice: state.notice || '',
      shopClock: {
        iso: clock.iso,
        weekday: clock.weekday,
        hour: clock.hour,
        minute: clock.minute,
        greeting: textUtil.greeting(clock.hour),
        openLabel: openLabel,
        hours: hours,
      },
    };
  }

  return {
    getPublic: function () {
      return publicState();
    },
    getSettings: function () {
      return state.settings;
    },
    getRepair: function (id) {
      return state.repairOrders.find(function (order) { return order.id === id; }) || null;
    },
    dismissNotice: function () {
      return commit(function () {
        state.notice = '';
        return { ok: true, data: publicState() };
      });
    },
    saveSettings: function (input) {
      const parsed = validate.validateSettings(input);
      if (!parsed.ok) return Promise.resolve(parsed);
      return commit(function () {
        state.settings = parsed.value;
        return { ok: true, data: publicState() };
      });
    },
    saveAppointment: function (input) {
      const parsed = validate.validateAppointment(input);
      if (!parsed.ok) return Promise.resolve(parsed);
      return commit(function () {
        const value = parsed.value;
        if (!value.id) value.id = crypto.randomUUID();
        value.sample = false;
        const index = state.appointments.findIndex(function (row) { return row.id === value.id; });
        if (index === -1) state.appointments.push(value);
        else state.appointments[index] = value;
        return { ok: true, data: publicState() };
      });
    },
    toggleAppointment: function (id) {
      const parsed = validate.validateId(id);
      if (!parsed.ok) return Promise.resolve(parsed);
      return commit(function () {
        const row = state.appointments.find(function (item) { return item.id === parsed.value; });
        if (!row) return { ok: false, error: 'That appointment is no longer on the board.' };
        row.done = !row.done;
        row.sample = false;
        return { ok: true, data: publicState() };
      });
    },
    deleteAppointment: function (id) {
      const parsed = validate.validateId(id);
      if (!parsed.ok) return Promise.resolve(parsed);
      return commit(function () {
        state.appointments = state.appointments.filter(function (item) { return item.id !== parsed.value; });
        return { ok: true, data: publicState() };
      });
    },
    saveRepair: function (input) {
      const parsed = validate.validateRepair(input);
      if (!parsed.ok) return Promise.resolve(parsed);
      return commit(function () {
        const value = parsed.value;
        value.updatedAt = new Date().toISOString();
        value.sample = false;
        if (!value.id) {
          value.id = crypto.randomUUID();
          value.number = value.number || nextNumber();
          state.repairOrders.unshift(value);
        } else {
          const index = state.repairOrders.findIndex(function (order) { return order.id === value.id; });
          if (index === -1) return { ok: false, error: 'That repair order is no longer on file.' };
          value.number = state.repairOrders[index].number;
          value.sample = false;
          state.repairOrders[index] = value;
        }
        return { ok: true, data: publicState() };
      });
    },
    deleteRepair: function (id) {
      const parsed = validate.validateId(id);
      if (!parsed.ok) return Promise.resolve(parsed);
      return commit(function () {
        state.repairOrders = state.repairOrders.filter(function (order) { return order.id !== parsed.value; });
        return { ok: true, data: publicState() };
      });
    },
    clearSamples: function () {
      return commit(function () {
        state.appointments = state.appointments.filter(function (item) { return !item.sample; });
        state.repairOrders = state.repairOrders.filter(function (order) { return !order.sample; });
        return { ok: true, data: publicState() };
      });
    },
  };
}

module.exports = {
  DEFAULT_SETTINGS,
  createStore,
  seed,
};
