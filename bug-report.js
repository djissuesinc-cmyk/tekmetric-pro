// v2.5.4: build a bug-report zip from the PDF log (time window + redaction).
const zlib = require('zlib');
const path = require('path');
const TZ = 'America/Toronto';

function pad2(n) { return String(n).padStart(2, '0'); }

function tzParts(date, tz) {
    const fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hourCycle: 'h23'
    });
    const o = {};
    for (const p of fmt.formatToParts(date)) {
        if (p.type !== 'literal') o[p.type] = p.value;
    }
    return o;
}

function formatToronto(date, tz) {
    tz = tz || TZ;
    const p = tzParts(date, tz);
    return { date: p.year + '-' + p.month + '-' + p.day, time: p.hour + ':' + p.minute };
}

// Offset of `tz` at instant `date`: local-as-UTC minus actual UTC.
function tzOffsetMs(date, tz) {
    const p = tzParts(date, tz);
    const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    return asUtc - date.getTime();
}

// Wall clock in America/Toronto (or tz) -> UTC milliseconds.
function torontoWallToUtcMs(dateStr, timeStr, tz) {
    tz = tz || TZ;
    const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || '').trim());
    const tm = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(timeStr || '').trim());
    if (!dm || !tm) return null;
    const y = +dm[1], mo = +dm[2], d = +dm[3], hh = +tm[1], mm = +tm[2];
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || hh > 23 || mm > 59) return null;
    const wallAsUtc = Date.UTC(y, mo - 1, d, hh, mm, 0);
    let utc = wallAsUtc - tzOffsetMs(new Date(wallAsUtc), tz);
    utc = wallAsUtc - tzOffsetMs(new Date(utc), tz);
    return utc;
}

function defaultBugReportRange(now, tz) {
    now = now || new Date();
    tz = tz || TZ;
    const end = formatToronto(now, tz);
    const start = formatToronto(new Date(now.getTime() - 2 * 60 * 60 * 1000), tz);
    return { date: end.date, fromTime: start.time, toTime: end.time, fromDate: start.date };
}

function rangeToUtcMs(opts) {
    const tz = (opts && opts.tz) || TZ;
    const date = opts && opts.date;
    const fromTime = opts && opts.fromTime;
    const toTime = opts && opts.toTime;
    let start = torontoWallToUtcMs(date, fromTime, tz);
    let end = torontoWallToUtcMs(date, toTime, tz);
    // Last 2 hours can cross midnight: if From is later than To, From is the previous day.
    if (start != null && end != null && start > end) {
        const fromDate = opts.fromDate || (function () {
            const t = torontoWallToUtcMs(date, '00:00', tz);
            const prev = formatToronto(new Date(t - 1), tz);
            return prev.date;
        })();
        start = torontoWallToUtcMs(fromDate, fromTime, tz);
    }
    return { start, end };
}

// Log lines start with ISO-8601 UTC, e.g. 2026-11-27T11:35:54.935Z
const LOG_TS_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\b/;

function parseLogLineTime(line) {
    const m = LOG_TS_RE.exec(String(line || ''));
    if (!m) return null;
    const t = Date.parse(m[1]);
    return Number.isFinite(t) ? t : null;
}

function filterLogLines(text, startMs, endMs) {
    if (startMs == null || endMs == null || startMs > endMs) return '';
    const lines = String(text == null ? '' : text).split(/\r?\n/);
    const out = [];
    for (const line of lines) {
        const t = parseLogLineTime(line);
        if (t == null) continue;
        if (t >= startMs && t <= endMs) out.push(line);
    }
    return out.join('\n');
}

function redactSecrets(text) {
    let s = String(text == null ? '' : text);
    s = s.replace(/AIza[0-9A-Za-z_-]{10,}/g, '[redacted]');
    s = s.replace(/\bBearer\s+[^\s]+/gi, 'Bearer [redacted]');
    s = s.replace(/([?&](?:access_token|token|key|validation)=)[^&\s#"]*/gi, '$1[redacted]');
    s = s.replace(/((?:access_token|api[_-]?key|token)\s*[:=]\s*)[^\s"'&,}]+/gi, '$1[redacted]');
    return s;
}

function crc32(buf) {
    let c = 0xffffffff;
    const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    for (let i = 0; i < b.length; i++) {
        c ^= b[i];
        for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
    return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d) {
    const y = d.getFullYear(), mo = d.getMonth() + 1, day = d.getDate();
    const h = d.getHours(), mi = d.getMinutes(), s = Math.floor(d.getSeconds() / 2);
    const dosTime = (h << 11) | (mi << 5) | s;
    const dosDate = ((y - 1980) << 9) | (mo << 5) | day;
    return { dosTime, dosDate };
}

// Minimal ZIP (DEFLATE or STORE). No extra dependencies.
function makeZipBuffer(files, now) {
    now = now || new Date();
    const { dosTime, dosDate } = dosDateTime(now);
    const locals = [];
    const centrals = [];
    let offset = 0;
    for (const f of files) {
        const name = Buffer.from(String(f.name).replace(/\\/g, '/'), 'utf8');
        const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data || '');
        const deflated = zlib.deflateRawSync(data);
        const useDeflate = deflated.length < data.length;
        const payload = useDeflate ? deflated : data;
        const method = useDeflate ? 8 : 0;
        const crc = crc32(data);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(0, 6);
        local.writeUInt16LE(method, 8);
        local.writeUInt16LE(dosTime, 10);
        local.writeUInt16LE(dosDate, 12);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(payload.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(name.length, 26);
        local.writeUInt16LE(0, 28);
        const localRec = Buffer.concat([local, name, payload]);
        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(0, 8);
        central.writeUInt16LE(method, 10);
        central.writeUInt16LE(dosTime, 12);
        central.writeUInt16LE(dosDate, 14);
        central.writeUInt32LE(crc, 16);
        central.writeUInt32LE(payload.length, 20);
        central.writeUInt32LE(data.length, 24);
        central.writeUInt16LE(name.length, 28);
        central.writeUInt16LE(0, 30);
        central.writeUInt16LE(0, 32);
        central.writeUInt16LE(0, 34);
        central.writeUInt16LE(0, 36);
        central.writeUInt32LE(0, 38);
        central.writeUInt32LE(offset, 42);
        locals.push(localRec);
        centrals.push(Buffer.concat([central, name]));
        offset += localRec.length;
    }
    const centralDir = Buffer.concat(centrals);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(files.length, 8);
    eocd.writeUInt16LE(files.length, 10);
    eocd.writeUInt32LE(centralDir.length, 12);
    eocd.writeUInt32LE(offset, 16);
    eocd.writeUInt16LE(0, 20);
    return Buffer.concat(locals.concat([centralDir, eocd]));
}

function readIfExists(fs, p) {
    try { return fs.readFileSync(p); } catch (e) { return null; }
}

function isForbiddenName(name) {
    const n = String(name || '').toLowerCase();
    const base = n.split(/[/\\]/).pop();
    if (base === '.env' || base === 'settings.json' || base === 'users.json' || base === 'logins.json') return true;
    if (/^(cookies|cookies-journal|oscookies|preferences)$/i.test(base)) return true;
    if (/password|secret|api[-_]?key/i.test(base)) return true;
    if (/session storage|local storage|network.?persistent.?state/i.test(n)) return true;
    return false;
}

function collectCrashDumps(fs, crashDir, startMs, endMs) {
    const out = [];
    if (!crashDir) return out;
    let names;
    try { names = fs.readdirSync(crashDir); } catch (e) { return out; }
    for (const name of names) {
        if (isForbiddenName(name)) continue;
        const full = path.join(crashDir, name);
        let st;
        try { st = fs.statSync(full); } catch (e) { continue; }
        if (!st.isFile()) continue;
        const mt = st.mtimeMs != null ? st.mtimeMs : +st.mtime;
        if (mt < startMs || mt > endMs) continue;
        try { out.push({ name: 'crash-dumps/' + name, data: fs.readFileSync(full) }); } catch (e) {}
    }
    return out;
}

function buildInfoTxt(info) {
    const note = String(info.note == null ? '' : info.note).trim() || '(none)';
    return [
        'Tekmetric Pro bug report',
        'App version: ' + (info.version || ''),
        'Electron: ' + (info.electronVersion || ''),
        'Chrome: ' + (info.chromeVersion || ''),
        'Windows: ' + (info.osVersion || ''),
        'PC name: ' + (info.pcName || ''),
        'Printer: ' + (info.printerName || '(system default)'),
        'Date: ' + (info.date || ''),
        'From: ' + (info.fromTime || '') + ' (America/Toronto)',
        'To: ' + (info.toTime || '') + ' (America/Toronto)',
        'Note:',
        note
    ].join('\n') + '\n';
}

function zipFileName(now, tz) {
    const p = tzParts(now, tz || TZ);
    return 'TekPro-BugReport-' + p.year + '-' + p.month + '-' + p.day + '-' + p.hour + p.minute + '.zip';
}

function buildMailto({ version, pcName, note, date, fromTime, toTime, zipName }) {
    const subject = 'Tekmetric Pro bug report - v' + (version || '') + ' - ' + (pcName || '');
    const body = [
        String(note == null ? '' : note).trim() || '(no note)',
        '',
        'Time range: ' + (date || '') + ' ' + (fromTime || '') + ' to ' + (toTime || '') + ' (America/Toronto)',
        'Please attach the file ' + zipName + ' from your Downloads folder.'
    ].join('\n');
    return 'mailto:shawn@craigsleaside.com?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
}

function createBugReport(opts) {
    const fs = opts.fs;
    const tz = opts.tz || TZ;
    const now = opts.now || new Date();
    const range = rangeToUtcMs(opts);
    if (range.start == null || range.end == null) {
        return { ok: false, message: 'Enter a valid date and time range.' };
    }
    let logText = '';
    for (const p of (opts.logPaths || [])) {
        const buf = readIfExists(fs, p);
        if (buf) logText += buf.toString('utf8') + '\n';
    }
    let excerpt = filterLogLines(logText, range.start, range.end);
    excerpt = redactSecrets(excerpt);
    if (!excerpt) excerpt = 'No log lines in this time range.\n';
    else excerpt += '\n';

    const info = {
        version: opts.version,
        electronVersion: opts.electronVersion,
        chromeVersion: opts.chromeVersion,
        osVersion: opts.osVersion,
        pcName: opts.pcName,
        printerName: opts.printerName,
        date: opts.date,
        fromTime: opts.fromTime,
        toTime: opts.toTime,
        note: opts.note
    };
    const infoTxt = redactSecrets(buildInfoTxt(info));
    const files = [
        { name: 'log-excerpt.txt', data: excerpt },
        { name: 'info.txt', data: infoTxt }
    ].concat(collectCrashDumps(fs, opts.crashDir, range.start, range.end));

    const zipName = zipFileName(now, tz);
    const destDir = opts.downloadsDir;
    const dest = path.join(destDir, zipName);
    const zip = makeZipBuffer(files, now);
    fs.mkdirSync(destDir, { recursive: true });
    fs.writeFileSync(dest, zip);
    return { ok: true, path: dest, zipName: zipName, mailto: buildMailto(Object.assign({ zipName: zipName }, info)), fileCount: files.length };
}

function escapeHtml(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function bugReportDialogHtml(defaults, css) {
    const d = defaults || defaultBugReportRange(new Date(), TZ);
    const date = escapeHtml(d.date);
    const from = escapeHtml(d.fromTime);
    const to = escapeHtml(d.toTime);
    return `${css || ''}<body class="sb-body" style="margin:0;">
        <div class="sb-body-pad" style="padding:18px 20px;">
            <h1 style="margin:0 0 12px;font-family:'Oswald',Impact,sans-serif;font-size:18px;letter-spacing:.04em;text-transform:uppercase;color:#fff;">Create Bug Report</h1>
            <div class="sb-panel" style="margin-bottom:14px;">
                <label style="display:block;font-size:12px;color:#9aa0aa;margin-bottom:8px;">Date
                    <input id="br-date" type="date" value="${date}" style="display:block;width:100%;margin-top:4px;padding:6px 8px;box-sizing:border-box;">
                </label>
                <div style="display:flex;gap:12px;">
                    <label style="flex:1;font-size:12px;color:#9aa0aa;">From
                        <input id="br-from" type="time" value="${from}" style="display:block;width:100%;margin-top:4px;padding:6px 8px;box-sizing:border-box;">
                    </label>
                    <label style="flex:1;font-size:12px;color:#9aa0aa;">To
                        <input id="br-to" type="time" value="${to}" style="display:block;width:100%;margin-top:4px;padding:6px 8px;box-sizing:border-box;">
                    </label>
                </div>
                <label style="display:block;font-size:12px;color:#9aa0aa;margin-top:10px;">What happened? (optional)
                    <textarea id="br-note" rows="5" placeholder="What you clicked, the RO number, and anything else that helps." style="display:block;width:100%;margin-top:4px;padding:8px;box-sizing:border-box;resize:vertical;"></textarea>
                </label>
            </div>
            <p id="br-error" style="color:#E30613;font-size:12px;min-height:16px;margin:0 0 10px;"></p>
            <div style="text-align:right;display:flex;gap:8px;justify-content:flex-end;">
                <button id="br-cancel" type="button" style="background:#2a2c33 !important;">Cancel</button>
                <button id="br-create" type="button">Create</button>
            </div>
        </div>
        <script>
            const api = window.tekproBug;
            document.getElementById('br-cancel').onclick = () => api && api.cancel();
            document.getElementById('br-create').onclick = async () => {
                const err = document.getElementById('br-error');
                err.textContent = '';
                const btn = document.getElementById('br-create');
                btn.disabled = true;
                try {
                    const r = await api.create({
                        date: document.getElementById('br-date').value,
                        fromTime: document.getElementById('br-from').value,
                        toTime: document.getElementById('br-to').value,
                        note: document.getElementById('br-note').value
                    });
                    if (!r || !r.ok) err.textContent = (r && r.message) || 'Could not create the report.';
                } catch (e) {
                    err.textContent = (e && e.message) || 'Could not create the report.';
                }
                btn.disabled = false;
            };
        </script>
    </body>`;
}

module.exports = {
    TZ, formatToronto, torontoWallToUtcMs, defaultBugReportRange, rangeToUtcMs,
    parseLogLineTime, filterLogLines, redactSecrets, makeZipBuffer, buildInfoTxt,
    zipFileName, buildMailto, createBugReport, bugReportDialogHtml, isForbiddenName,
    collectCrashDumps
};
