// Electron e2e: mimics Tekmetric printing (about:blank window then blob PDF). Run: xvfb-run npx electron test/e2e.js <variant>
const { app, session, BrowserWindow } = require('electron');
const fs = require('fs'), path = require('path'), os = require('os');
const variant = process.argv[process.argv.length - 1];
const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'tekpro-e2e-'));
app.setPath('userData', ud);
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ invoiceLogoRight: true, workOrderWatermark: true, presets: ['A'], presetsMigrated: true }));
const pdf = fs.readFileSync('/workspace/realpdf/' + (variant.includes('wo') ? 'workorder.pdf' : 'invoice.pdf')).toString('base64');
const scripts = {
  location: `const w = window.open(''); setTimeout(() => { w.location = URL.createObjectURL(b); }, 300);`,
  iframe: `const w = window.open('about:blank'); setTimeout(() => { w.document.write('<iframe src="' + URL.createObjectURL(b) + '" style="width:100%;height:100%"></iframe>'); }, 300);`,
  embed: `const w = window.open(''); setTimeout(() => { w.document.body.innerHTML = '<embed type="application/pdf" src="' + URL.createObjectURL(b) + '">'; }, 300);`,
  inpage: `const f = document.createElement('iframe'); f.src = URL.createObjectURL(b); document.body.appendChild(f);`,
  direct: `window.open(URL.createObjectURL(b));`,
  revoke: `const w = window.open(''); setTimeout(() => { const u = URL.createObjectURL(b); w.location = u; setTimeout(() => URL.revokeObjectURL(u), 50); }, 300);`,
  octet: `const b2 = new Blob([bytes], { type: 'application/octet-stream' }); const w = window.open(''); setTimeout(() => { w.location = URL.createObjectURL(b2); }, 300);`,
  childblob: `const w = window.open(''); setTimeout(() => { w.eval('location = URL.createObjectURL(new Blob([opener.__bytes], {type:"application/pdf"}))'); }, 300); window.__bytes = bytes;`,
  anchor: `const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.target = '_blank'; document.body.appendChild(a); a.click();`,
  embedrevoke: `const w = window.open(''); setTimeout(() => { const u = URL.createObjectURL(b); w.document.body.innerHTML = '<embed type="application/pdf" src="' + u + '">'; setTimeout(() => URL.revokeObjectURL(u), 50); }, 300);`,
};
const key = variant.replace('-wo', '');
const html = `<html><body>RO page<script>
const bytes = Uint8Array.from(atob('${pdf}'), c => c.charCodeAt(0));
const b = new Blob([bytes], { type: 'application/pdf' });
setTimeout(() => { ${scripts[key]} }, 1500);
</script></body></html>`;
app.whenReady().then(() => {
  session.fromPartition('persist:tekmetric_session').protocol.handle('https', () => new Response(html, { headers: { 'content-type': 'text/html' } }));
  const origPrint = require('electron').webContents.prototype;
});
app.on('browser-window-created', (e, w) => {
  w.webContents.on('did-finish-load', () => {
    const u = w.webContents.getURL();
    if (u.startsWith('file:') && u.includes('Leaside_RO_')) {
      const out = '/workspace/e2e-' + variant + '.pdf';
      fs.copyFileSync(require('url').fileURLToPath(u), out);
      console.log('E2E_RESULT stamped pdf ->', out);
      console.log(fs.readFileSync(path.join(ud, 'pdf-stamp.log'), 'utf8'));
      setTimeout(() => app.exit(0), 300);
    }
  });
});
setTimeout(() => { console.log('E2E_RESULT TIMEOUT'); try { console.log(fs.readFileSync(path.join(ud, 'pdf-stamp.log'), 'utf8')); } catch (e) {} app.exit(1); }, 20000);
require('../main.js');
