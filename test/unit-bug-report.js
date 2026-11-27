// v2.5.4: time-window filter, Toronto conversion, and secret redaction for bug reports.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const {
    torontoWallToUtcMs, formatToronto, defaultBugReportRange, rangeToUtcMs,
    parseLogLineTime, filterLogLines, redactSecrets, makeZipBuffer, buildInfoTxt,
    createBugReport, isForbiddenName, zipFileName, buildMailto
} = require('../bug-report');

// 27 Nov 2026 is Eastern Standard Time (UTC-5). 6:30 AM Toronto = 11:30 UTC.
const start = torontoWallToUtcMs('2026-11-27', '06:30', 'America/Toronto');
const end = torontoWallToUtcMs('2026-11-27', '06:37', 'America/Toronto');
assert.equal(start, Date.parse('2026-11-27T11:30:00.000Z'));
assert.equal(end, Date.parse('2026-11-27T11:37:00.000Z'));
assert.deepEqual(formatToronto(new Date('2026-11-27T11:35:54.935Z'), 'America/Toronto'), { date: '2026-11-27', time: '06:35' });

// Summer DST: 1 Jul 2026 is Eastern Daylight (UTC-4). 10:00 AM Toronto = 14:00 UTC.
assert.equal(torontoWallToUtcMs('2026-07-01', '10:00', 'America/Toronto'), Date.parse('2026-07-01T14:00:00.000Z'));

const log = [
    '2026-11-27T11:29:59.000Z too early',
    '2026-11-27T11:30:08.256Z main#1 did-start-navigation main https://shop.tekmetric.com/admin/shop/16618/repair-orders',
    '2026-11-27T11:35:54.714Z main#1 did-frame-navigate https://www1.prodemand.com/Intents/v2/PartsAndLabor/Pick?transferTicket=abc&validation=SECRET',
    '2026-11-27T11:36:05.733Z main#1 did-frame-navigate https://intents.mitchell1.com/home/registry',
    '2026-11-27T11:37:00.000Z on the end',
    '2026-11-27T11:37:01.000Z too late',
    'not a log line'
].join('\n');

const filtered = filterLogLines(log, start, end);
assert.ok(filtered.includes('11:30:08.256Z'));
assert.ok(filtered.includes('11:35:54.714Z'));
assert.ok(filtered.includes('11:36:05.733Z'));
assert.ok(filtered.includes('11:37:00.000Z'));
assert.ok(!filtered.includes('too early'));
assert.ok(!filtered.includes('too late'));
assert.ok(!filtered.includes('not a log line'));
assert.equal(parseLogLineTime('2026-11-27T11:35:54.935Z hello'), Date.parse('2026-11-27T11:35:54.935Z'));
assert.equal(parseLogLineTime('hello'), null);

const red = redactSecrets('key=AIzaSyDummyTestKeyValue1234567890abc and Bearer ya29.token val https://app.partstech.com/?vin=X&validation=SECRET&vehicle=1 access_token=abc token=zzz api_key: hunter2');
assert.ok(red.includes('[redacted]'));
assert.ok(!red.includes('AIzaSyDummyTestKeyValue1234567890abc'));
assert.ok(!red.includes('ya29.token'));
assert.ok(!red.includes('validation=SECRET'));
assert.ok(red.includes('validation=[redacted]'));
assert.ok(!red.includes('access_token=abc'));
assert.ok(!red.includes('token=zzz'));
assert.ok(!red.includes('hunter2'));
assert.ok(!red.includes('Bearer ya29'));
// transferTicket is not a listed secret pattern; VIN-looking text without those keys stays
assert.ok(redactSecrets('https://x/?transferTicket=abc').includes('transferTicket=abc'));

const def = defaultBugReportRange(new Date('2026-11-27T11:52:00Z'), 'America/Toronto');
assert.equal(def.date, '2026-11-27');
assert.equal(def.toTime, '06:52');
assert.equal(def.fromTime, '04:52');

// Across midnight: date is today 00:30, last 2 hours started yesterday 22:30
const cross = defaultBugReportRange(new Date('2026-11-27T05:30:00Z'), 'America/Toronto'); // 00:30 Toronto
assert.equal(cross.date, '2026-11-27');
assert.equal(cross.toTime, '00:30');
assert.equal(cross.fromTime, '22:30');
assert.equal(cross.fromDate, '2026-11-26');
const xs = rangeToUtcMs({ date: cross.date, fromTime: cross.fromTime, toTime: cross.toTime, fromDate: cross.fromDate, tz: 'America/Toronto' });
assert.equal(xs.start, Date.parse('2026-11-27T03:30:00.000Z')); // 22:30 Nov 26 EST
assert.equal(xs.end, Date.parse('2026-11-27T05:30:00.000Z'));

const info = buildInfoTxt({
    version: '2.5.4', electronVersion: '40.6.0', chromeVersion: '140',
    osVersion: 'Windows 10', pcName: 'SHOP-PC', printerName: 'Brother',
    date: '2026-11-27', fromTime: '04:52', toTime: '06:52', note: 'ProDemand blank'
});
assert.ok(info.includes('App version: 2.5.4'));
assert.ok(info.includes('Printer: Brother'));
assert.ok(info.includes('ProDemand blank'));
assert.ok(!info.includes('apiKey'));

assert.equal(isForbiddenName('settings.json'), true);
assert.equal(isForbiddenName('.env'), true);
assert.equal(isForbiddenName('users.json'), true);
assert.equal(isForbiddenName('dmp.dmp'), false);

assert.equal(zipFileName(new Date('2026-11-27T11:52:00Z'), 'America/Toronto'), 'TekPro-BugReport-2026-11-27-0652.zip');
const mail = buildMailto({ version: '2.5.4', pcName: 'SHOP-PC', note: 'blank guide', date: '2026-11-27', fromTime: '04:52', toTime: '06:52', zipName: 'TekPro-BugReport-2026-11-27-0652.zip' });
assert.ok(mail.startsWith('mailto:shawn@craigsleaside.com?'));
assert.ok(mail.includes(encodeURIComponent('Tekmetric Pro bug report - v2.5.4 - SHOP-PC')));
assert.ok(decodeURIComponent(mail).includes('Please attach the file TekPro-BugReport-2026-11-27-0652.zip from your Downloads folder.'));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tekpro-br-'));
const userData = path.join(dir, 'ud');
const downloads = path.join(dir, 'dl');
const crash = path.join(dir, 'crashes');
fs.mkdirSync(userData); fs.mkdirSync(downloads); fs.mkdirSync(crash);
fs.writeFileSync(path.join(userData, 'pdf-stamp.log'), log + '\n2026-11-27T11:35:55.000Z Authorization: Bearer ya29.secret\n');
fs.writeFileSync(path.join(userData, 'pdf-stamp.log.old'), '2026-11-27T11:31:00.000Z older file line\n');
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ apiKey: 'AIzaShouldNotAppear', printerName: 'Brother' }));
fs.writeFileSync(path.join(crash, 'dump.dmp'), 'CRASH');
fs.utimesSync(path.join(crash, 'dump.dmp'), new Date('2026-11-27T11:35:00Z'), new Date('2026-11-27T11:35:00Z'));
fs.writeFileSync(path.join(crash, 'settings.json'), 'nope');
const result = createBugReport({
    fs,
    date: '2026-11-27', fromTime: '06:30', toTime: '06:37',
    note: 'No Information Available on RO 10650',
    logPaths: [path.join(userData, 'pdf-stamp.log'), path.join(userData, 'pdf-stamp.log.old')],
    crashDir: crash,
    downloadsDir: downloads,
    version: '2.5.4', electronVersion: '40.6.0', chromeVersion: '140.0',
    osVersion: 'Windows 10', pcName: 'SHOP-PC', printerName: 'Brother',
    now: new Date('2026-11-27T11:52:00Z'), tz: 'America/Toronto'
});
assert.equal(result.ok, true);
assert.equal(result.zipName, 'TekPro-BugReport-2026-11-27-0652.zip');
assert.ok(fs.existsSync(result.path));
const unzipDir = path.join(dir, 'out');
fs.mkdirSync(unzipDir);
execFileSync('python3', ['-c',
    'import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])',
    result.path, unzipDir]);
const names = fs.readdirSync(unzipDir);
assert.deepEqual(names.sort(), ['crash-dumps', 'info.txt', 'log-excerpt.txt'].sort());
assert.deepEqual(fs.readdirSync(path.join(unzipDir, 'crash-dumps')), ['dump.dmp']);
const excerpt = fs.readFileSync(path.join(unzipDir, 'log-excerpt.txt'), 'utf8');
const infoOut = fs.readFileSync(path.join(unzipDir, 'info.txt'), 'utf8');
assert.ok(excerpt.includes('11:30:08.256Z'));
assert.ok(excerpt.includes('older file line'));
assert.ok(excerpt.includes('validation=[redacted]'));
assert.ok(!excerpt.includes('SECRET'));
assert.ok(!excerpt.includes('ya29.secret'));
assert.ok(excerpt.includes('Bearer [redacted]'));
assert.ok(infoOut.includes('No Information Available on RO 10650'));
assert.ok(!infoOut.includes('AIzaShouldNotAppear'));
assert.ok(!infoOut.includes('apiKey'));
assert.ok(!fs.existsSync(path.join(unzipDir, 'settings.json')));
assert.ok(!fs.existsSync(path.join(unzipDir, '.env')));

// empty window
const empty = createBugReport({
    fs, date: '2026-11-26', fromTime: '08:00', toTime: '09:00', note: '',
    logPaths: [path.join(userData, 'pdf-stamp.log')], crashDir: crash,
    downloadsDir: downloads, version: '2.5.4', electronVersion: '1', chromeVersion: '1',
    osVersion: 'Windows', pcName: 'PC', printerName: '', now: new Date('2026-11-27T12:00:00Z'), tz: 'America/Toronto'
});
const emptyDir = path.join(dir, 'empty');
fs.mkdirSync(emptyDir);
execFileSync('python3', ['-c', 'import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])', empty.path, emptyDir]);
assert.ok(fs.readFileSync(path.join(emptyDir, 'log-excerpt.txt'), 'utf8').includes('No log lines in this time range'));

console.log('UNIT-BUG-REPORT OK');
