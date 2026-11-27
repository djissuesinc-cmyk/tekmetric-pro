// Electron e2e (v2.5.6): /document/ PDFs load natively (Fetch stamp off).
// A local HTTPS server stands in for shop.tekmetric.com /document/ URLs.
const { app, BrowserWindow, session } = require('electron');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { installDocumentInterceptor } = require('../doc-intercept');

const pdf = fs.readFileSync('/workspace/realpdf/workorder.pdf');
const logs = [];
setTimeout(() => { console.log('E2E_RESULT TIMEOUT'); console.log(logs.join('\n')); app.exit(1); }, 20000);

app.whenReady().then(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tekpro-net-'));
    const key = path.join(dir, 'key.pem');
    const cert = path.join(dir, 'cert.pem');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-keyout', key, '-out', cert, '-days', '1', '-nodes',
        '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost']);

    const server = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, (req, res) => {
        if (req.url === '/page' || req.url === '/') {
            res.writeHead(200, { 'content-type': 'text/html' });
            res.end('<html><body>ok</body></html>');
            return;
        }
        if (/\/document\//.test(req.url)) {
            res.writeHead(200, { 'content-type': 'application/pdf', 'content-length': String(pdf.length) });
            res.end(pdf);
            return;
        }
        res.writeHead(404);
        res.end('no');
    });
    const port = await new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));
    const origin = 'https://127.0.0.1:' + port;
    const docUrl = origin + '/document/shop/1/repair-order/x/work-order?tz=a';

    const ses = session.fromPartition('persist:e2e');
    ses.setCertificateVerifyProc((request, cb) => cb(0));
    installDocumentInterceptor(ses, 'e2e-net', { stamp: async () => { throw new Error('stamp should not run'); }, log: m => logs.push(m) });

    const w = new BrowserWindow({ show: false, webPreferences: { partition: 'persist:e2e' } });
    await w.loadURL(origin + '/page');
    const normal = await w.webContents.executeJavaScript('document.body.innerText');

    const r = await w.webContents.executeJavaScript(`fetch(${JSON.stringify(docUrl)}).then(r=>r.arrayBuffer()).then(b=>{const u=new Uint8Array(b); let s=''; for (let i=0;i<4;i++) s+=String.fromCharCode(u[i]); return s+':' + u.length; })`);

    await w.loadURL(docUrl).catch(e => logs.push('nav ' + e.message));
    const navUrl = w.webContents.getURL();
    const info = await w.webContents.executeJavaScript(`({ ct: document.contentType, text: (document.body && document.body.innerText) || '', ready: document.readyState })`).catch(e => ({ err: String(e) }));
    const viewerOk = info && info.ct === 'application/pdf' && !/failed to load pdf document/i.test(info.text || '');

    console.log('normal page:', JSON.stringify(normal));
    console.log('fetch magic:', JSON.stringify(r));
    console.log('nav url:', navUrl);
    console.log('viewer:', info);
    console.log(logs.join('\n'));
    server.close();
    const ok = r.startsWith('%PDF') && /\/document\//.test(navUrl) && viewerOk && logs.some(l => /Fetch stamp off/i.test(l));
    console.log(ok ? 'E2E OK' : 'E2E FAIL');
    app.exit(ok ? 0 : 1);
}).catch(e => { console.error(e); app.exit(1); });
