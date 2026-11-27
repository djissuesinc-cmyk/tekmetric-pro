// Electron e2e (v2.5.6): Tekmetric print path — a new window loads a /document/ PDF
// in Chromium's built-in viewer. Production has Fetch stamping off, so the file
// must render (and not show "Failed to load PDF document") even when a stamp
// function would throw. Blob print stamping is covered by test/e2e.js.
// Run: xvfb-run -a npx electron test/e2e-doc-viewer.js
const { app, BrowserWindow, session } = require('electron');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { installDocumentInterceptor } = require('../doc-intercept');

const invoice = fs.readFileSync('/workspace/realpdf/invoice.pdf');
const logs = [];
setTimeout(() => { console.log('DOC-VIEWER TIMEOUT'); console.log(logs.join('\n')); app.exit(1); }, 25000);

function viewerInfo(wc) {
    return wc.executeJavaScript(`({
        ct: document.contentType,
        text: ((document.body && document.body.innerText) || '') + ' ' + (document.documentElement && document.documentElement.innerText || ''),
        ready: document.readyState,
        href: location.href
    })`).catch(e => ({ err: String(e) }));
}

app.whenReady().then(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tekpro-docv-'));
    const key = path.join(dir, 'key.pem');
    const cert = path.join(dir, 'cert.pem');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-keyout', key, '-out', cert, '-days', '1', '-nodes',
        '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost']);

    const server = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, (req, res) => {
        if (req.url === '/shop' || req.url === '/') {
            res.writeHead(200, { 'content-type': 'text/html' });
            res.end('<html><body>RO page</body></html>');
            return;
        }
        if (/\/document\//.test(req.url)) {
            res.writeHead(200, { 'content-type': 'application/pdf', 'content-length': String(invoice.length) });
            res.end(invoice);
            return;
        }
        res.writeHead(404);
        res.end('no');
    });
    const port = await new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));
    const origin = 'https://127.0.0.1:' + port;
    const docUrl = origin + '/document/shop/1/repair-order/x/invoice?tz=a';

    const ses = session.fromPartition('persist:e2edocv');
    ses.setCertificateVerifyProc((request, cb) => cb(0));
    // Production settings: Fetch stamp off. Stamp would throw if it were called.
    installDocumentInterceptor(ses, 'e2edocv', {
        stamp: async () => { throw new Error('stamp failed on purpose'); },
        log: m => logs.push(m)
    });

    const parent = new BrowserWindow({ show: false, webPreferences: { partition: 'persist:e2edocv' } });
    await parent.loadURL(origin + '/shop');
    parent.webContents.setWindowOpenHandler(() => ({
        action: 'allow',
        overrideBrowserWindowOptions: { show: false, webPreferences: { partition: 'persist:e2edocv' } }
    }));

    const childP = new Promise((resolve, reject) => {
        parent.webContents.once('did-create-window', (c) => {
            c.webContents.once('did-finish-load', () => resolve(c));
            c.webContents.once('did-fail-load', (e, code, desc, url, isMain) => {
                if (isMain) reject(new Error('child fail ' + code + ' ' + desc));
            });
        });
        setTimeout(() => reject(new Error('child timeout')), 15000);
    });
    await parent.webContents.executeJavaScript(`window.open(${JSON.stringify(docUrl)}); "ok"`);
    const child = await childP;
    const info = await viewerInfo(child.webContents);
    const childUrl = child.webContents.getURL();
    const rendered = info && info.ct === 'application/pdf' && !/failed to load pdf document/i.test(info.text || '') && !info.err;
    const loadOk = /\/document\//.test(childUrl);

    // Print should be invoked without the viewer error path. No printer in CI is ok.
    const printResult = await new Promise((resolve) => {
        try {
            child.webContents.print({ silent: true, printBackground: true, deviceName: '' }, (success, failureReason) => {
                resolve({ success: !!success, reason: failureReason || '' });
            });
        } catch (e) { resolve({ success: false, reason: String(e) }); }
    });
    const printOk = printResult.success || !/failed to load pdf document/i.test(printResult.reason || '');

    console.log('child url', childUrl);
    console.log('viewer', info);
    console.log('print', printResult);
    console.log(logs.join('\n'));
    server.close();
    const ok = rendered && loadOk && printOk && logs.some(l => /Fetch stamp off/i.test(l)) && !logs.some(l => /stamp failed on purpose/i.test(l));
    console.log(ok ? 'DOC-VIEWER E2E OK' : 'DOC-VIEWER E2E FAIL');
    app.exit(ok ? 0 : 1);
}).catch(e => { console.error(e); app.exit(1); });
