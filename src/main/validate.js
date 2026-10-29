const textUtil = require('../shared/text');

const STATUSES = new Set(['estimate', 'in-progress', 'waiting-parts', 'ready', 'closed']);

function fail(error) {
  return { ok: false, error: error };
}

function ok(value) {
  return { ok: true, value: value };
}

function plain(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return null;
  const keys = Object.keys(value);
  for (let i = 0; i < keys.length; i += 1) {
    if (keys[i] === '__proto__' || keys[i] === 'constructor' || keys[i] === 'prototype') return null;
  }
  return value;
}

function asText(value, label, min, max) {
  if (value == null) value = '';
  if (typeof value !== 'string') return fail(label + ' must be text.');
  const clean = value.replace(/\r\n/g, '\n').trim();
  if (clean.length < min) return fail(label + ' is required.');
  if (clean.length > max) return fail(label + ' is too long.');
  return ok(clean);
}

function optionalId(value) {
  if (value == null || value === '') return ok('');
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) return fail('Invalid id.');
  return ok(value);
}

function isoDate(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return fail(label + ' must be a real date.');
  }
  const bits = value.split('-').map(Number);
  const dt = new Date(Date.UTC(bits[0], bits[1] - 1, bits[2]));
  if (dt.getUTCFullYear() !== bits[0] || dt.getUTCMonth() !== bits[1] - 1 || dt.getUTCDate() !== bits[2]) {
    return fail(label + ' must be a real date.');
  }
  return ok(value);
}

function timeValue(value) {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    return fail('Time must be HH:MM.');
  }
  return ok(value);
}

function phone(value) {
  const parsed = asText(value, 'Phone', 0, 24);
  if (!parsed.ok || !parsed.value) return parsed;
  if (!/^[0-9+().\-\s]{7,24}$/.test(parsed.value)) return fail('Phone number looks wrong.');
  return parsed;
}

function email(value, label) {
  const parsed = asText(value, label || 'Email', 0, 120);
  if (!parsed.ok || !parsed.value) return parsed;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parsed.value)) return fail((label || 'Email') + ' looks wrong.');
  return parsed;
}

function plate(value) {
  const parsed = asText(value, 'Plate', 0, 10);
  if (!parsed.ok || !parsed.value) return parsed;
  if (!/^[A-Za-z0-9 -]{2,10}$/.test(parsed.value)) return fail('Plate looks wrong.');
  return ok(parsed.value.toUpperCase());
}

function vin(value) {
  const parsed = asText(value, 'VIN', 0, 17);
  if (!parsed.ok || !parsed.value) return parsed;
  if (!/^[A-HJ-NPR-Z0-9]{11,17}$/i.test(parsed.value)) {
    return fail('VIN must be 11 to 17 letters and numbers, without I, O, or Q.');
  }
  return ok(parsed.value.toUpperCase());
}

function mileage(value) {
  if (value == null || value === '') return ok(null);
  const raw = typeof value === 'number' ? String(value) : String(value).replace(/,/g, '').trim();
  if (!/^\d+$/.test(raw)) return fail('Mileage must be a whole number.');
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n > 2000000) return fail('Mileage must be a whole number.');
  return ok(n);
}

function validateAppointment(input) {
  const obj = plain(input);
  if (!obj) return fail('That appointment could not be read.');
  const id = optionalId(obj.id);
  if (!id.ok) return id;
  const customer = asText(obj.customer, 'Customer', 1, 80);
  if (!customer.ok) return customer;
  const vehicle = asText(obj.vehicle, 'Vehicle', 1, 80);
  if (!vehicle.ok) return vehicle;
  const service = asText(obj.service, 'Service', 1, 120);
  if (!service.ok) return service;
  const date = isoDate(obj.date, 'Date');
  if (!date.ok) return date;
  const time = timeValue(obj.time);
  if (!time.ok) return time;
  const notes = asText(obj.notes, 'Notes', 0, 500);
  if (!notes.ok) return notes;
  return ok({
    id: id.value,
    customer: customer.value,
    vehicle: vehicle.value,
    service: service.value,
    date: date.value,
    time: time.value,
    notes: textUtil.autoCapitalize(notes.value),
    done: obj.done === true,
    sample: obj.sample === true,
  });
}

function lineItem(input) {
  const obj = plain(input);
  if (!obj) return fail('A line item could not be read.');
  const id = optionalId(obj.id);
  if (!id.ok) return id;
  const description = asText(obj.description, 'Line description', 1, 120);
  if (!description.ok) return description;
  let qtyHundredths = null;
  let unitCents = null;
  if (obj.qtyHundredths != null && obj.unitCents != null && obj.qty == null && obj.unitPrice == null) {
    qtyHundredths = Number(obj.qtyHundredths);
    unitCents = Number(obj.unitCents);
    if (!Number.isInteger(qtyHundredths) || qtyHundredths <= 0 || qtyHundredths > 99999) {
      return fail('Quantity looks wrong.');
    }
    if (!Number.isInteger(unitCents) || unitCents < 0 || unitCents > 100000000) {
      return fail('Price looks wrong.');
    }
  } else {
    qtyHundredths = textUtil.qtyToHundredths(obj.qty == null ? '' : String(obj.qty));
    unitCents = textUtil.dollarsToCents(obj.unitPrice == null ? '' : String(obj.unitPrice));
    if (qtyHundredths == null) return fail('Quantity must be greater than 0, with at most two decimals.');
    if (unitCents == null) return fail('Price must be a dollar amount with at most two decimals.');
  }
  return ok({
    id: id.value,
    description: description.value,
    qtyHundredths: qtyHundredths,
    unitCents: unitCents,
  });
}

function validateRepair(input) {
  const obj = plain(input);
  if (!obj) return fail('That repair order could not be read.');
  const id = optionalId(obj.id);
  if (!id.ok) return id;
  const customer = asText(obj.customer, 'Customer', 1, 80);
  if (!customer.ok) return customer;
  const phoneValue = phone(obj.phone);
  if (!phoneValue.ok) return phoneValue;
  const vehicle = asText(obj.vehicle, 'Vehicle', 1, 80);
  if (!vehicle.ok) return vehicle;
  const plateValue = plate(obj.plate);
  if (!plateValue.ok) return plateValue;
  const vinValue = vin(obj.vin);
  if (!vinValue.ok) return vinValue;
  const mileageValue = mileage(obj.mileage);
  if (!mileageValue.ok) return mileageValue;
  const concern = asText(obj.concern, 'Concern', 1, 2000);
  if (!concern.ok) return concern;
  const comment = asText(obj.advisorComment, 'Comment', 0, 4000);
  if (!comment.ok) return comment;
  const status = typeof obj.status === 'string' ? obj.status : '';
  if (!STATUSES.has(status)) return fail('Choose a status.');
  if (!Array.isArray(obj.lineItems) || obj.lineItems.length > 30) {
    return fail('A repair order can have up to 30 lines.');
  }
  const lines = [];
  for (let i = 0; i < obj.lineItems.length; i += 1) {
    const parsed = lineItem(obj.lineItems[i]);
    if (!parsed.ok) return parsed;
    lines.push(parsed.value);
  }
  let number = null;
  if (obj.number != null && obj.number !== '') {
    number = Number(obj.number);
    if (!Number.isInteger(number) || number < 1 || number > 999999) return fail('Repair order number looks wrong.');
  }
  return ok({
    id: id.value,
    number: number,
    customer: customer.value,
    phone: phoneValue.value,
    vehicle: vehicle.value,
    plate: plateValue.value,
    vin: vinValue.value,
    mileage: mileageValue.value,
    concern: textUtil.autoCapitalize(concern.value),
    status: status,
    advisorComment: textUtil.autoCapitalize(comment.value),
    lineItems: lines,
    sample: obj.sample === true,
  });
}

function validateSettings(input) {
  const obj = plain(input);
  if (!obj) return fail('Settings could not be read.');
  const shopName = asText(obj.shopName, 'Shop name', 1, 80);
  if (!shopName.ok) return shopName;
  const address = asText(obj.address, 'Address', 0, 120);
  if (!address.ok) return address;
  const city = asText(obj.city, 'City', 0, 80);
  if (!city.ok) return city;
  const phoneValue = phone(obj.phone);
  if (!phoneValue.ok) return phoneValue;
  const emailValue = email(obj.email, 'Shop email');
  if (!emailValue.ok) return emailValue;
  const model = asText(obj.geminiModel, 'Model', 1, 80);
  if (!model.ok) return model;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(model.value)) return fail('Model id looks wrong.');
  const urlText = asText(obj.tekmetricUrl, 'Tekmetric address', 1, 200);
  if (!urlText.ok) return urlText;
  let url;
  try {
    url = new URL(urlText.value);
  } catch (err) {
    return fail('Tekmetric address must be an https tekmetric.com page.');
  }
  if (url.protocol !== 'https:' || !(url.hostname === 'tekmetric.com' || url.hostname.endsWith('.tekmetric.com'))) {
    return fail('Tekmetric address must be an https tekmetric.com page.');
  }
  return ok({
    shopName: shopName.value,
    address: address.value,
    city: city.value,
    phone: phoneValue.value,
    email: emailValue.value,
    darkMode: obj.darkMode === true,
    geminiModel: model.value,
    tekmetricUrl: url.origin,
  });
}

function validateSecrets(input) {
  const obj = plain(input);
  if (!obj) return fail('Could not read that.');
  const out = {};
  if (Object.prototype.hasOwnProperty.call(obj, 'geminiApiKey')) {
    if (obj.geminiApiKey == null || obj.geminiApiKey === '') {
      out.geminiApiKey = null;
    } else if (typeof obj.geminiApiKey !== 'string') {
      return fail('API key must be text.');
    } else {
      const key = obj.geminiApiKey.trim();
      if (key.length < 20 || key.length > 256 || /[\s'"`]/.test(key)) return fail('API key looks wrong.');
      out.geminiApiKey = key;
    }
  }
  if (Object.prototype.hasOwnProperty.call(obj, 'tekmetricEmail')) {
    if (obj.tekmetricEmail == null || obj.tekmetricEmail === '') {
      out.tekmetricEmail = null;
    } else {
      const parsed = email(obj.tekmetricEmail, 'Tekmetric email');
      if (!parsed.ok) return parsed;
      out.tekmetricEmail = parsed.value;
    }
  }
  if (Object.prototype.hasOwnProperty.call(obj, 'tekmetricPassword')) {
    if (obj.tekmetricPassword == null || obj.tekmetricPassword === '') {
      out.tekmetricPassword = null;
    } else if (typeof obj.tekmetricPassword !== 'string' || obj.tekmetricPassword.length > 200) {
      return fail('Password must be 200 characters or less.');
    } else {
      out.tekmetricPassword = obj.tekmetricPassword;
    }
  }
  return ok(out);
}

function validateId(value) {
  const parsed = optionalId(value);
  if (!parsed.ok || !parsed.value) return fail('Invalid id.');
  return parsed;
}

module.exports = {
  STATUSES,
  plain,
  validateAppointment,
  validateRepair,
  validateSettings,
  validateSecrets,
  validateId,
};
