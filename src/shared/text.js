(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TekmetricText = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function autoCapitalize(text) {
    if (typeof text !== 'string') return '';
    return text
      .replace(/(^|\n)(\s*)([a-z])/g, function (_, lead, space, ch) {
        return lead + space + ch.toUpperCase();
      })
      .replace(/([.!?])(\s+)([a-z])/g, function (_, mark, space, ch) {
        return mark + space + ch.toUpperCase();
      });
  }

  function dollarsToCents(value) {
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) return null;
      value = value.toFixed(2);
    }
    if (typeof value !== 'string') return null;
    const cleaned = value.trim().replace(/[$,\s]/g, '');
    if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
    const parts = cleaned.split('.');
    const dollars = Number(parts[0]);
    const fraction = ((parts[1] || '') + '00').slice(0, 2);
    if (!Number.isSafeInteger(dollars)) return null;
    return dollars * 100 + Number(fraction);
  }

  function qtyToHundredths(value) {
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) return null;
      value = String(value);
    }
    if (typeof value !== 'string') return null;
    const cleaned = value.trim();
    if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
    const parts = cleaned.split('.');
    const whole = Number(parts[0]);
    const fraction = ((parts[1] || '') + '00').slice(0, 2);
    const hundredths = whole * 100 + Number(fraction);
    if (hundredths <= 0 || hundredths > 99999) return null;
    return hundredths;
  }

  function lineTotalCents(qtyHundredths, unitCents) {
    const qty = Number(qtyHundredths);
    const unit = Number(unitCents);
    if (!Number.isInteger(qty) || !Number.isInteger(unit)) return 0;
    return Math.round((qty * unit) / 100);
  }

  function formatMoney(cents) {
    const n = Math.round(Number(cents));
    if (!Number.isFinite(n)) return '$0.00';
    const sign = n < 0 ? '-' : '';
    const abs = Math.abs(n);
    const dollars = Math.floor(abs / 100);
    const rem = String(abs % 100).padStart(2, '0');
    const grouped = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return sign + '$' + grouped + '.' + rem;
  }

  function centsToInput(cents) {
    const n = Math.round(Number(cents));
    if (!Number.isFinite(n)) return '';
    return Math.floor(Math.abs(n) / 100) + '.' + String(Math.abs(n) % 100).padStart(2, '0');
  }

  function hundredthsToInput(value) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return '';
    const whole = Math.floor(n / 100);
    const frac = String(n % 100).padStart(2, '0');
    if (frac === '00') return String(whole);
    if (frac[1] === '0') return whole + '.' + frac[0];
    return whole + '.' + frac;
  }

  function sanitizeWinAnsi(text) {
    const map = {
      '\u2018': "'",
      '\u2019': "'",
      '\u201C': '"',
      '\u201D': '"',
      '\u2013': '-',
      '\u2014': '-',
      '\u2026': '...',
      '\u00A0': ' ',
      '\u2022': '-',
    };
    let out = '';
    for (const ch of String(text == null ? '' : text)) {
      if (map[ch]) {
        out += map[ch];
        continue;
      }
      const code = ch.codePointAt(0);
      if ((code >= 32 && code <= 126) || (code >= 160 && code <= 255)) out += ch;
      else if (code === 10 || code === 9) out += ' ';
    }
    return out;
  }

  function shopDateParts(date) {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Toronto',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    const map = {};
    for (const part of fmt.formatToParts(date || new Date())) {
      if (part.type !== 'literal') map[part.type] = part.value;
    }
    let hour = Number(map.hour);
    if (hour === 24) hour = 0;
    const weekdayIndex = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[map.weekday];
    return {
      iso: map.year + '-' + map.month + '-' + map.day,
      weekday: map.weekday,
      weekdayIndex: weekdayIndex,
      hour: hour,
      minute: map.minute,
    };
  }

  function addDays(iso, days) {
    const bits = String(iso).split('-').map(Number);
    const dt = new Date(Date.UTC(bits[0], bits[1] - 1, bits[2]));
    dt.setUTCDate(dt.getUTCDate() + days);
    return dt.toISOString().slice(0, 10);
  }

  function mondayOf(iso) {
    const bits = String(iso).split('-').map(Number);
    const dt = new Date(Date.UTC(bits[0], bits[1] - 1, bits[2]));
    const day = dt.getUTCDay();
    const delta = day === 0 ? -6 : 1 - day;
    return addDays(iso, delta);
  }

  function weekdayIndex(iso) {
    const bits = String(iso).split('-').map(Number);
    return new Date(Date.UTC(bits[0], bits[1] - 1, bits[2])).getUTCDay();
  }

  function weekdayHours(index) {
    if (index === 0 || index === 6) return null;
    if (index === 5) return { open: '07:00', close: '14:00' };
    return { open: '07:00', close: '16:00' };
  }

  function formatTime(hhmm) {
    const bits = String(hhmm || '').split(':');
    const h = Number(bits[0]);
    const m = Number(bits[1]);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return '';
    const suffix = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return h12 + ':' + String(m).padStart(2, '0') + ' ' + suffix;
  }

  function formatPretty(iso) {
    const bits = String(iso).split('-').map(Number);
    const dt = new Date(Date.UTC(bits[0], bits[1] - 1, bits[2]));
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    }).format(dt);
  }

  function formatWeekday(iso) {
    const bits = String(iso).split('-').map(Number);
    const dt = new Date(Date.UTC(bits[0], bits[1] - 1, bits[2]));
    return new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(dt);
  }

  function greeting(hour) {
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  }

  function stripModelFences(text) {
    let out = String(text || '').replace(/\r\n/g, '\n').trim();
    if (out.startsWith('```')) {
      out = out.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim();
    }
    return out.slice(0, 2000);
  }

  return {
    autoCapitalize: autoCapitalize,
    dollarsToCents: dollarsToCents,
    qtyToHundredths: qtyToHundredths,
    lineTotalCents: lineTotalCents,
    formatMoney: formatMoney,
    centsToInput: centsToInput,
    hundredthsToInput: hundredthsToInput,
    sanitizeWinAnsi: sanitizeWinAnsi,
    shopDateParts: shopDateParts,
    addDays: addDays,
    mondayOf: mondayOf,
    weekdayIndex: weekdayIndex,
    weekdayHours: weekdayHours,
    formatTime: formatTime,
    formatPretty: formatPretty,
    formatWeekday: formatWeekday,
    greeting: greeting,
    stripModelFences: stripModelFences,
  };
});
