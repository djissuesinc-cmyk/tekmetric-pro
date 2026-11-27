// v2.5.2: Quick Actions presets insert one job per line in a textarea; inputs keep " + " joining.
// Run: xvfb-run -a npx electron test/e2e-inject.js
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path'), fs = require('fs'), os = require('os');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'tekpro-inject-')));
const PRESETS = [
  'LOF, 30 POINT INSPECTION + BRAKE INSPECTION',
  'SEASONAL TIRE CHANGE',
  'Level 2 / 3 Scan (Documents Codes, In-depth Diagnostics and trouble shooting + Clearing Codes)'
];
ipcMain.on('get-settings', e => { e.returnValue = { showSidebar: true, presets: PRESETS, autoCaps: false }; });
ipcMain.on('get-small-logo', e => { e.returnValue = ''; });
ipcMain.on('get-pdf-hook', e => { e.returnValue = ''; });
ipcMain.on('document-ready', () => {});

const page = `<!doctype html><html><body style="margin:0;padding:80px 16px 16px 260px;background:#fff">
<nav class="MuiDrawer-paper" style="position:fixed;left:0;top:0;width:70px;height:100%"></nav>
<textarea id="jobs" style="width:420px;height:180px;display:block"></textarea>
<input id="oneline" type="text" style="width:420px;height:28px;margin-top:12px;display:block" />
</body></html>`;

function fail(msg) { console.error('INJECT E2E FAIL:', msg); app.exit(1); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: true, width: 900, height: 700, webPreferences: { preload: path.join(__dirname, '../preload.js'), contextIsolation: true } });
  const ev = (type, x, y, extra) => w.webContents.sendInputEvent(Object.assign({ type, x, y, button: 'left', clickCount: 1 }, extra || {}));
  const center = async (sel) => w.webContents.executeJavaScript(`(()=>{const r=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`);
  const click = async (sel) => { const c = await center(sel); ev('mouseMove', c.x, c.y); ev('mouseDown', c.x, c.y); await sleep(30); ev('mouseUp', c.x, c.y); await sleep(200); };
  const clickBtn = async (substr) => {
    const c = await w.webContents.executeJavaScript(`(()=>{const b=[...document.querySelectorAll('#leaside-quick-scroll button')].find(x=>x.textContent.includes(${JSON.stringify(substr)}));if(!b)return null;const r=b.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`);
    if (!c) return fail('missing preset button ' + substr);
    ev('mouseMove', c.x, c.y); ev('mouseDown', c.x, c.y); await sleep(30); ev('mouseUp', c.x, c.y); await sleep(250);
  };
  try {
    await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(page));
    await sleep(400);
    const ready = await w.webContents.executeJavaScript(`!!document.getElementById('leaside-quick-scroll')`);
    if (!ready) return fail('Quick Actions panel not injected');

    await click('#jobs');
    await clickBtn('LOF');
    let v = await w.webContents.executeJavaScript(`document.getElementById('jobs').value`);
    if (v !== '+ LOF\n+ 30 POINT INSPECTION\n+ BRAKE INSPECTION') return fail('textarea LOF split: ' + JSON.stringify(v));
    console.log('1 ok: textarea LOF split onto three lines');

    await click('#jobs');
    await clickBtn('SEASONAL');
    v = await w.webContents.executeJavaScript(`document.getElementById('jobs').value`);
    if (v !== '+ LOF\n+ 30 POINT INSPECTION\n+ BRAKE INSPECTION\n+ SEASONAL TIRE CHANGE') return fail('textarea append: ' + JSON.stringify(v));
    console.log('2 ok: next job appended as its own + line');

    await click('#jobs');
    await clickBtn('Level 2');
    v = await w.webContents.executeJavaScript(`document.getElementById('jobs').value`);
    const expectedLine = '+ Level 2 / 3 Scan (Documents Codes, In-depth Diagnostics and trouble shooting + Clearing Codes)';
    if (!v.endsWith('\n' + expectedLine) || v.split('\n').length !== 5) return fail('paren-comma should stay one line: ' + JSON.stringify(v));
    console.log('3 ok: paren comma/plus stayed on one line');

    await click('#oneline');
    await clickBtn('LOF');
    const inp = await w.webContents.executeJavaScript(`document.getElementById('oneline').value`);
    if (inp !== 'LOF, 30 POINT INSPECTION + BRAKE INSPECTION + ') return fail('input fallback: ' + JSON.stringify(inp));
    console.log('4 ok: single-line input keeps old + joining');

    console.log('INJECT E2E OK');
    app.exit(0);
  } catch (e) { fail(e && e.stack || e); }
});
setTimeout(() => fail('timeout'), 30000);
