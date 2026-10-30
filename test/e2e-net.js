// Electron e2e: real session.protocol.handle('https') with the app's handler; /document/ served by a fake upstream
const { app, BrowserWindow, session } = require('electron');
const fs = require('fs');
const { makeHttpsHandler } = require('../doc-intercept');
const pdf = fs.readFileSync('/workspace/realpdf/workorder.pdf');
app.whenReady().then(async () => {
  const ses = session.fromPartition('persist:e2e');
  const logs = [];
  ses.protocol.handle('https', makeHttpsHandler({
    fetch: (req) => /\/document\//.test(req.url) ? Promise.resolve(new Response(pdf, { headers: { 'content-type': 'application/pdf' } })) : ses.fetch(req, { bypassCustomProtocolHandlers: true }),
    stamp: async (b) => Buffer.concat([b, Buffer.from('\n%STAMPED\n')]), log: m => logs.push(m) }));
  const w = new BrowserWindow({ show: false, webPreferences: { partition: 'persist:e2e' } });
  let normal = 'skip';
  try { await w.loadURL('https://example.com/'); normal = await w.webContents.executeJavaScript('document.title'); } catch (e) { normal = 'offline:' + e.message; }
  const r = await w.webContents.executeJavaScript(`fetch('https://shop.tekmetric.com/document/shop/1/repair-order/x/work-order?tz=a').then(r=>r.arrayBuffer()).then(b=>{const t=new TextDecoder().decode(new Uint8Array(b).slice(-12));return t})`);
  await w.loadURL('https://shop.tekmetric.com/document/shop/1/repair-order/x/work-order?tz=a').catch(e => logs.push('nav ' + e.message));
  console.log('normal page title:', normal); console.log('tail:', JSON.stringify(r)); console.log(logs.join('\n'));
  console.log(r.includes('STAMPED') ? 'E2E OK' : 'E2E FAIL'); app.exit(0);
});
