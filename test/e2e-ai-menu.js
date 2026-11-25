// v2.5.0: the real main.js right-click AI actions with a stubbed net.fetch.
// Checks: result lands in the original field after focus moved, double click = one request, busy title/progress
// clears, errors show one dialog and leave the text alone, the log has model/ms/status and no key or text.
// Run: xvfb-run -a npx electron test/e2e-ai-menu.js
const electron = require('electron');
const { app, Menu, dialog, BrowserWindow } = electron;
const fs = require('fs'), path = require('path'), os = require('os');
const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'tekpro-aim-'));
app.setPath('userData', ud);
const KEY = 'SECRET-TEST-KEY-9876';
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ apiKey: KEY, autoCaps: true, invoiceLogoRight: false, workOrderWatermark: false, presets: ['A'], presetsMigrated: true }));
const fail = (m) => { console.error('AI MENU E2E FAIL: ' + m); app.exit(1); };
let fetchCalls = [], mode = 'ok', gate = null;
const realFetch = electron.net.fetch;
electron.net.fetch = async (u, init) => {
  if (!/generativelanguage/.test(String(u))) return realFetch.call(electron.net, u, init);
  fetchCalls.push({ u: String(u), key: init.headers['x-goog-api-key'], body: init.body });
  if (gate) await gate;
  if (mode === 'down') return new Response(JSON.stringify({ error: { message: 'down', status: 'UNAVAILABLE' } }), { status: 503 });
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'the brake part is worn out.' }] }, finishReason: 'STOP' }] }), { status: 200 });
};
const dialogs = [];
dialog.showMessageBox = async (...a) => { dialogs.push(a[a.length - 1]); return { response: 0 }; };
let popped = null;
Menu.prototype.popup = function () { popped = this; };
require('../main.js');
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const logText = () => { try { return fs.readFileSync(path.join(ud, 'pdf-stamp.log'), 'utf8'); } catch (e) { return ''; } };
app.whenReady().then(async () => {
  try {
    await wait(3500);
    const win = BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w.webContents.getURL().startsWith('http')) || BrowserWindow.getAllWindows()[0];
    await win.loadURL('data:text/html,' + encodeURIComponent('<body><textarea id="a" style="width:300px;height:80px">the brke part is wornn out</textarea><textarea id="b" style="width:300px;height:80px">other</textarea></body>'));
    const js = (c) => win.webContents.executeJavaScript(c);
    const open = async () => { popped = null; win.webContents.emit('context-menu', {}, { selectionText: 'the brke part is wornn out', dictionarySuggestions: [], misspelledWord: '' }); return popped.items.find(i => /Fix Spelling/.test(i.label)); };
    const select = () => js(`(()=>{const a=document.getElementById('a'); a.focus(); a.setSelectionRange(0, a.value.length);})()`);

    // 1) normal run, with focus moved to the other box while waiting, and a double click
    await select();
    let release; gate = new Promise(r => { release = r; });
    let item = await open();
    item.click(); item.click();
    await wait(300);
    await js(`document.getElementById('b').focus()`);
    const busyTitle = win.getTitle();
    release(); gate = null;
    await wait(800);
    const v = await js(`[document.getElementById('a').value, document.getElementById('b').value]`);
    if (v[0] !== 'THE BRAKE PART IS WORN OUT.' || v[1] !== 'other') return fail('field result ' + JSON.stringify(v));
    if (fetchCalls.length !== 1) return fail('double click made ' + fetchCalls.length + ' requests');
    if (!/AI working/.test(busyTitle) || /AI working/.test(win.getTitle())) return fail('busy title: "' + busyTitle + '" -> "' + win.getTitle() + '"');
    if (fetchCalls[0].key !== KEY || fetchCalls[0].u.includes(KEY) || !/gemini-3\.5-flash-lite/.test(fetchCalls[0].u)) return fail('request shape ' + fetchCalls[0].u);
    console.log('1 ok: original field filled after focus moved; double click = 1 request; title "' + busyTitle + '" then cleared');

    // 2) AI down: one dialog, field untouched, busy cleared, next click works
    mode = 'down'; fetchCalls = [];
    await select(); item = await open(); item.click();
    for (let i = 0; i < 40 && !dialogs.length; i++) await wait(500);
    await wait(300);
    if (dialogs.length !== 1 || !/AI Server Error/.test(dialogs[0].title) || !/503/.test(dialogs[0].message)) return fail('error dialog ' + JSON.stringify(dialogs));
    const v2 = await js(`document.getElementById('a').value`);
    if (v2 !== 'THE BRAKE PART IS WORN OUT.') return fail('field changed after failure: ' + v2);
    if (/AI working/.test(win.getTitle())) return fail('busy title stuck');
    console.log('2 ok: 503 everywhere -> tried ' + fetchCalls.length + ' calls, 1 clear dialog, text untouched');
    mode = 'ok'; fetchCalls = [];
    await js(`document.getElementById('a').value='the brke part is wornn out'`);
    await select(); item = await open(); item.click(); await wait(600);
    if ((await js(`document.getElementById('a').value`)) !== 'THE BRAKE PART IS WORN OUT.') return fail('did not recover after failure');
    console.log('3 ok: works again right after a failure');

    const log = logText();
    if (log.includes(KEY) || log.includes('brke part')) return fail('log leaks key or text');
    if (!/ai#\d+ model=gemini-3\.5-flash-lite try=1 status=200 ok \d+ms/.test(log) || !/status=503/.test(log)) return fail('log lines missing:\n' + log.split('\n').filter(l => /ai#|ai /.test(l)).join('\n'));
    console.log(log.split('\n').filter(l => /ai#|ai spell/.test(l)).slice(0, 6).join('\n'));
    console.log('AI MENU E2E OK');
    app.exit(0);
  } catch (e) { fail(e && e.stack || e); }
});
setTimeout(() => fail('timeout'), 90000);
