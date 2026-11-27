// v2.5.3: render the Admin / System Settings window (signboard header, logo, fonts, same controls).
// Does not read real settings or .env. Run: xvfb-run -a npx electron test/e2e-admin.js
const { app, BrowserWindow } = require('electron');
const { settingsEditorHtml } = require('../settings-html');
const { signboardCss, signboardHeader } = require('../brand');
const path = require('path'), fs = require('fs'), os = require('os');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'tekpro-admin-')));

function fail(msg) { console.error('ADMIN E2E FAIL:', msg); app.exit(1); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

app.whenReady().then(async () => {
  try {
    const html = settingsEditorHtml({
      css: signboardCss(),
      header: signboardHeader(),
      apiKey: '',
      settingsPathLiteral: JSON.stringify('/tmp/tekpro-fake-settings.json')
    });
    const win = new BrowserWindow({
      width: 640, height: 540, show: true, autoHideMenuBar: true,
      title: 'API Settings', backgroundColor: '#0d0e11',
      webPreferences: { nodeIntegration: false, contextIsolation: true }
    });
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    await win.webContents.executeJavaScript(`Promise.all([document.fonts.ready, Promise.all([...document.images].map(img => img.complete && img.naturalWidth ? 1 : new Promise(r => { img.onload = img.onerror = r; })))])`);
    await sleep(150);
    const info = await win.webContents.executeJavaScript(`({
      title: document.querySelector('h2') && document.querySelector('h2').textContent.trim(),
      header: document.getElementById('signboard-header') && document.getElementById('signboard-header').innerText,
      logoOk: (() => { const i = document.getElementById('signboard-logo'); return !!(i && i.complete && i.naturalWidth > 0 && String(i.src).indexOf('data:image') === 0); })(),
      fonts: document.fonts.check('700 20px Oswald') && document.fonts.check('400 16px Inter'),
      api: !!document.getElementById('api') && document.getElementById('api').type === 'password',
      save: !!document.getElementById('save') && /Save Settings/i.test(document.getElementById('save').textContent),
      label: (document.querySelector('label[for="api"]') || document.querySelector('label')) && (document.querySelector('label[for="api"]') || document.querySelector('label')).textContent,
      msg: !!document.getElementById('msg')
    })`);
    if (!/System Settings/i.test(info.title || '')) return fail('title: ' + info.title);
    if (!/Leaside/i.test(info.header || '') || !/Automotive/i.test(info.header || '') || !/Parts/i.test(info.header || '')) {
      return fail('header text: ' + JSON.stringify(info.header));
    }
    if (!info.logoOk) return fail('signboard logo did not load');
    if (!info.fonts) return fail('Oswald/Inter did not load');
    if (!info.api) return fail('API key password field missing');
    if (!info.save) return fail('Save Settings button missing');
    if (!/Gemini API Key/i.test(info.label || '')) return fail('label: ' + info.label);
    if (!info.msg) return fail('#msg missing');
    const shotDir = '/workspace/out29';
    fs.mkdirSync(shotDir, { recursive: true });
    const png = await win.capturePage();
    fs.writeFileSync(path.join(shotDir, 'admin.png'), png.toPNG());
    console.log('ADMIN E2E OK screenshot=' + path.join(shotDir, 'admin.png'));
    app.exit(0);
  } catch (e) { fail(e && e.stack || e); }
});
setTimeout(() => fail('timeout'), 20000);
