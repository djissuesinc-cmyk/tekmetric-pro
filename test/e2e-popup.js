// Electron e2e (v2.3.7): redirects + POST-form punchout popup through the real https handler + session fetch
const { app, BrowserWindow, session, net } = require('electron');
const { makeHttpsHandler } = require('../doc-intercept');
const { makeSessionFetch } = require('../nav-fetch');
app.whenReady().then(async () => {
  const ses = session.fromPartition('persist:e2epop');
  const logs = [];
  ses.protocol.handle('https', makeHttpsHandler({ fetch: makeSessionFetch(net, ses, m => logs.push(m)), stamp: async () => null, log: m => logs.push(m) }));
  const w = new BrowserWindow({ show: false, webPreferences: { partition: 'persist:e2epop' } });
  await w.loadURL('https://httpbin.org/redirect-to?url=https%3A%2F%2Fexample.com%2F').catch(e => logs.push('nav err ' + e.message));
  const redirOk = w.webContents.getURL() === 'https://example.com/';
  const title = await w.webContents.executeJavaScript('document.title');
  w.webContents.setWindowOpenHandler(() => ({ action: 'allow', overrideBrowserWindowOptions: { show: false, webPreferences: { partition: 'persist:e2epop' } } }));
  const child = new Promise(r => w.webContents.once('did-create-window', c => c.webContents.on('did-finish-load', () => { if (c.webContents.getURL().startsWith('https://httpbin.org/anything')) r(c); })));
  // punchout pattern: window.open('') then POST form into it, which then 302s
  await w.webContents.executeJavaScript(`(()=>{window.open('','parts');const f=document.createElement('form');f.method='POST';f.action='https://httpbin.org/redirect-to?url=https%3A%2F%2Fhttpbin.org%2Fanything&status_code=307';f.target='parts';const i=document.createElement('input');i.name='vendor';i.value='partstech';f.appendChild(i);document.body.appendChild(f);f.submit();})()`, true);
  const c = await Promise.race([child, new Promise(r => setTimeout(() => r(null), 20000))]);
  const body = c ? await c.webContents.executeJavaScript('document.body.innerText') : 'TIMEOUT';
  const postOk = /partstech/.test(body);
  // XHR POST still works
  const xhr = await w.webContents.executeJavaScript(`fetch('https://httpbin.org/post',{method:'POST',body:'abc123'}).then(r=>r.text())`).catch(e => 'ERR ' + e.message);
  await w.loadURL('https://httpbin.org/cookies/set?tp=1').catch(() => {});
  const cookieOk = /"tp": ?"1"/.test(await w.webContents.executeJavaScript('document.body.innerText'));
  console.log('cookie via redirect', cookieOk, w.webContents.getURL());
  console.log('redirect', redirOk, title, '| popup', c && c.webContents.getURL(), 'post body ok', postOk, '| fetch POST ok', /abc123/.test(xhr));
  console.log(logs.join('\n'));
  console.log(redirOk && cookieOk && postOk && /abc123/.test(xhr) ? 'POPUP E2E OK' : 'POPUP E2E FAIL'); app.exit(0);
});
