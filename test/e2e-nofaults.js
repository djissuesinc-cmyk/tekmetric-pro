// v2.4.0 Electron e2e: real preload (sandboxed) on a mock inspection page. Run: xvfb-run npx electron test/e2e-nofaults.js
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path'), fs = require('fs'), os = require('os');
const ph = require('../inspection-phrases');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'tekpro-nf-')));
ipcMain.on('get-settings', e => { e.returnValue = { showSidebar: false, presets: [] }; });
ipcMain.on('get-small-logo', e => { e.returnValue = ''; });
ipcMain.on('get-pdf-hook', e => { e.returnValue = ''; });
const seen = [];
ipcMain.on('inspection-phrases', (e, req) => {
  if (req.action === 'fill') { seen.push(...req.labels); e.returnValue = req.labels.map(l => ph.phraseFor(l).text); }
  else e.returnValue = req.values.map(v => ph.isGeneratedPhrase(v));
});
ipcMain.on('document-ready', () => {});
const html = `<html><body>
<div class="inspection-item"><div class="item-title">Warning Lights on Dash</div><div class="status"><button>Good</button><button>Needs Attention</button></div><div><span>Notes</span><textarea id="a"></textarea></div></div>
<div class="row"><h4>Battery</h4><div><div><textarea id="b"></textarea></div></div></div>
<div><label for="c">Front Brakes</label><textarea id="c"></textarea></div>
<div><textarea id="d" aria-label="Tires"></textarea></div>
<div class="MuiBox"><p>Glove Box</p><textarea id="e"></textarea></div>
<div><span class="name">Rear Brakes</span><textarea id="f">PADS AT 3MM</textarea></div>
<table><tr><td>Brake Fluid</td><td><textarea id="g"></textarea></td></tr></table>
</body></html>`;
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, '../preload.js'), contextIsolation: true } });
  await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise(r => setTimeout(r, 300));
  const vals = () => w.webContents.executeJavaScript(`Object.fromEntries([...document.querySelectorAll('textarea')].map(t => [t.id, t.value]))`);
  w.webContents.send('fill-no-faults'); await new Promise(r => setTimeout(r, 400));
  const v1 = await vals(); console.log('labels', JSON.stringify(seen)); console.log(JSON.stringify(v1, null, 1));
  const ok = v1.a.startsWith('WARNING LIGHTS ON DASH\n') && v1.b.startsWith('BATTERY\n') && v1.c.startsWith('FRONT BRAKES\n') && v1.d.startsWith('TIRES\n') && v1.e === ph.GENERIC && v1.f === 'PADS AT 3MM' && v1.g.startsWith('BRAKE FLUID\n');
  // user edits one generated box, then Clear
  await w.webContents.executeJavaScript(`(() => { const t = document.getElementById('b'); t.value = t.value + ' Terminals cleaned.'; })()`);
  await w.webContents.executeJavaScript(`(() => { const t = document.getElementById('c'); t.value = t.value.toUpperCase(); })()`);
  w.webContents.send('clear-no-faults'); await new Promise(r => setTimeout(r, 400));
  const v2 = await vals(); console.log(JSON.stringify(v2, null, 1));
  const ok2 = v2.a === '' && v2.c === '' && v2.d === '' && v2.e === '' && v2.b.endsWith('Terminals cleaned.') && v2.f === 'PADS AT 3MM' && v2.g === '';
  console.log(ok && ok2 ? 'NOFAULTS E2E OK' : 'NOFAULTS E2E FAIL'); app.exit(ok && ok2 ? 0 : 1);
});
