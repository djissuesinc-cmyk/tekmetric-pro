// v2.5.0: printer picker wiring in the real main.js. getPrintersAsync/print are stubbed (no printer in CI).
// Run: xvfb-run -a npx electron test/e2e-printer.js
const { app, ipcMain, Menu } = require('electron');
const fs = require('fs'), path = require('path'), os = require('os');
const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'tekpro-pr-'));
app.setPath('userData', ud);
const writeSettings = (name) => fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ invoiceLogoRight: false, workOrderWatermark: false, presets: ['A'], presetsMigrated: true, printerName: name }));
writeSettings('Brother MFC-L2750DW series Printer');
const FAKE = [{ name: 'Microsoft Print to PDF', displayName: 'Microsoft Print to PDF', isDefault: false }, { name: 'Brother MFC-L2750DW series Printer', displayName: 'Brother MFC-L2750DW series Printer', isDefault: true }];
const calls = [];
let failFirstNamed = false;
app.on('web-contents-created', (e, wc) => {
  wc.getPrintersAsync = async () => FAKE;
  wc.print = (opts, cb) => { calls.push(opts); setTimeout(() => cb(!(failFirstNamed && opts.deviceName), failFirstNamed && opts.deviceName ? 'Invalid printer settings' : ''), 5); };
});
const fail = (m) => { console.error('PRINTER E2E FAIL: ' + m); app.exit(1); };
const pdf = fs.readFileSync('/workspace/realpdf/invoice.pdf');
require('../main.js');
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const logText = () => { try { return fs.readFileSync(path.join(ud, 'pdf-stamp.log'), 'utf8'); } catch (e) { return ''; } };
const printMenu = () => {
  const shop = Menu.getApplicationMenu().items.find(i => i.label === 'Shop');
  const ps = shop.submenu.items.find(i => i.label === 'Print Settings');
  return ps.submenu.items.find(i => i.label === 'Printer');
};
app.whenReady().then(async () => {
  try {
    await wait(5500); // main.js fills the Printer menu ~2.5 s after start
    const pm = printMenu();
    const labels = pm.submenu.items.map(i => i.label + (i.checked ? '*' : ''));
    console.log('menu:', labels.join(' | '));
    if (!labels.some(l => /^System default$/.test(l)) || !labels.some(l => l.startsWith('Brother MFC-L2750DW series Printer') && l.endsWith('*'))) return fail('menu labels ' + labels);

    // 1) saved printer is passed as deviceName
    ipcMain.emit('modify-pdf-blob-silent', { sender: null }, pdf, {}, 1);
    await wait(6000);
    if (!calls.length || calls[0].deviceName !== 'Brother MFC-L2750DW series Printer' || calls[0].silent !== true) return fail('deviceName not passed: ' + JSON.stringify(calls));
    if (!/printer=Brother MFC-L2750DW series Printer/.test(logText())) return fail('printer not logged');
    console.log('1 ok: deviceName =', calls[0].deviceName);

    // 2) choose "System default" from the menu: no deviceName, choice saved
    calls.length = 0;
    pm.submenu.items.find(i => i.label === 'System default').click();
    if (JSON.parse(fs.readFileSync(path.join(ud, 'settings.json'))).printerName !== '') return fail('choice not saved');
    ipcMain.emit('modify-pdf-blob-silent', { sender: null }, pdf, {}, 1);
    await wait(6000);
    if (!calls.length || 'deviceName' in calls[0]) return fail('default should not pass deviceName: ' + JSON.stringify(calls));
    console.log('2 ok: System default -> no deviceName');

    // 3) saved printer missing on this PC -> default + log
    calls.length = 0; writeSettings('HP Gone Printer');
    ipcMain.emit('modify-pdf-blob-silent', { sender: null }, pdf, {}, 1);
    await wait(6000);
    if (!calls.length || 'deviceName' in calls[0] || !/saved printer "HP Gone Printer" not found/.test(logText())) return fail('missing printer fallback: ' + JSON.stringify(calls));
    console.log('3 ok: missing printer -> System default, logged');

    // 4) Windows refuses the named printer -> one retry on default
    calls.length = 0; failFirstNamed = true; writeSettings('Brother MFC-L2750DW series Printer');
    ipcMain.emit('modify-pdf-blob-silent', { sender: null }, pdf, {}, 1);
    await wait(6000);
    if (calls.length !== 2 || !calls[0].deviceName || 'deviceName' in calls[1] || !/retrying on System default/.test(logText())) return fail('retry on default: ' + JSON.stringify(calls));
    console.log('4 ok: refused printer -> retried once on default');
    console.log('PRINTER E2E OK');
    app.exit(0);
  } catch (e) { fail(e && e.stack || e); }
});
setTimeout(() => fail('timeout'), 90000);
