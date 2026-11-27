// Electron e2e (v2.5.5): after dropping the session-wide https protocol.handle,
// Chromium handles shop and third-party traffic natively. The document interceptor
// is still installed (as in the app) and must not break cookies or custom headers.
// - same-origin GET with a cookie plus a custom header
// - cross-site iframe sets SameSite=None; Partitioned and reads it back via fetch
// Run: xvfb-run -a npx electron test/e2e-intercept-headers.js
const { app, BrowserWindow, session } = require('electron');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { installDocumentInterceptor } = require('../doc-intercept');

app.whenReady().then(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tekpro-hdr-'));
    const key = path.join(dir, 'key.pem');
    const cert = path.join(dir, 'cert.pem');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-keyout', key, '-out', cert, '-days', '1', '-nodes',
        '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost']);

    const seen = [];
    const server = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, (req, res) => {
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => {
            const rec = {
                method: req.method,
                url: req.url,
                cookie: req.headers.cookie || '',
                origin: req.headers.origin || '',
                referer: req.headers.referer || '',
                csrf: req.headers['x-csrf-token'] || '',
                custom: req.headers['x-tekpro-test'] || '',
                body: Buffer.concat(chunks).toString()
            };
            seen.push(rec);
            const cors = {
                'access-control-allow-origin': req.headers.origin || '*',
                'access-control-allow-credentials': 'true',
                'access-control-allow-headers': 'content-type, x-tekpro-test, x-csrf-token',
                'access-control-allow-methods': 'GET, POST, OPTIONS'
            };
            if (req.method === 'OPTIONS') {
                res.writeHead(204, cors);
                res.end();
                return;
            }
            if (req.url === '/set') {
                res.writeHead(200, { 'set-cookie': 'tp=1; Path=/; SameSite=Lax; Secure', 'content-type': 'text/plain' });
                res.end('set');
                return;
            }
            if (req.url === '/page' || req.url === '/') {
                res.writeHead(200, { 'content-type': 'text/html' });
                res.end('<html><body>shop</body></html>');
                return;
            }
            if (req.url === '/shop-frame') {
                res.writeHead(200, { 'content-type': 'text/html' });
                res.end('<html><body><iframe id="pd" src="https://localhost:' + port + '/pick"></iframe></body></html>');
                return;
            }
            if (req.url === '/pick') {
                res.writeHead(200, {
                    'content-type': 'text/html',
                    'set-cookie': 'pd=1; Path=/; SameSite=None; Secure; Partitioned'
                });
                res.end(`<html><body><script>
fetch('/api/vehicles/m1VehicleId', { credentials: 'include' })
  .then(r => r.text().then(t => document.body.setAttribute('data-pd', r.status + ':' + t)))
  .catch(e => document.body.setAttribute('data-pd', 'err:' + e));
</script></body></html>`);
                return;
            }
            if (req.url === '/api/vehicles/m1VehicleId') {
                const ok = /(?:^|;\s*)pd=1(?:;|$)/.test(req.headers.cookie || '');
                res.writeHead(ok ? 200 : 401, Object.assign({ 'content-type': 'application/json' }, cors));
                res.end(JSON.stringify({ ok, cookie: req.headers.cookie || '' }));
                return;
            }
            if (req.url === '/api/tekmotor/search') {
                const cookieOk = /(?:^|;\s*)tp=1(?:;|$)/.test(req.headers.cookie || '');
                const headerOk = req.headers['x-csrf-token'] === 'tok-1' && req.headers['x-tekpro-test'] === '1';
                const ok = cookieOk && headerOk;
                res.writeHead(ok ? 200 : 403, Object.assign({ 'content-type': 'application/json' }, cors));
                res.end(JSON.stringify({ ok, cookieOk, headerOk, cookie: req.headers.cookie || '' }));
                return;
            }
            res.writeHead(200, Object.assign({ 'content-type': 'application/json' }, cors));
            res.end(JSON.stringify(rec));
        });
    });
    const port = await new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));
    const origin = 'https://127.0.0.1:' + port;

    const ses = session.fromPartition('persist:e2ehdr');
    ses.setCertificateVerifyProc((request, cb) => cb(0));
    const logs = [];
    installDocumentInterceptor(ses, 'e2ehdr', { stamp: async () => null, log: m => logs.push(m) });

    const w = new BrowserWindow({ show: false, webPreferences: { partition: 'persist:e2ehdr', webSecurity: true } });
    await w.loadURL(origin + '/page');

    await w.webContents.executeJavaScript(`fetch(${JSON.stringify(origin + '/set')}, { credentials: 'include' }).then(r => r.text())`);
    const sameOrigin = await w.webContents.executeJavaScript(`fetch(${JSON.stringify(origin + '/api/tekmotor/search')}, {
        credentials: 'include',
        headers: { 'X-CSRF-Token': 'tok-1', 'X-Tekpro-Test': '1' }
    }).then(r => r.json().then(j => Object.assign({ status: r.status }, j))).catch(e => ({ err: String(e) }))`);

    const sameSeen = seen.filter(s => s.method === 'GET' && s.url === '/api/tekmotor/search').pop();
    const cookieOk = !!(sameSeen && /tp=1/.test(sameSeen.cookie) && sameOrigin && sameOrigin.ok && sameOrigin.status === 200);
    const headerOk = !!(sameSeen && sameSeen.csrf === 'tok-1' && sameSeen.custom === '1');

    await w.loadURL(origin + '/shop-frame');
    const iframeOk = await w.webContents.executeJavaScript(`new Promise((resolve) => {
        const start = Date.now();
        const tick = () => {
            const f = document.getElementById('pd');
            try {
                const v = f && f.contentDocument && f.contentDocument.body && f.contentDocument.body.getAttribute('data-pd');
                if (v) return resolve(v);
            } catch (e) {}
            if (Date.now() - start > 12000) return resolve('timeout');
            setTimeout(tick, 50);
        };
        tick();
    })`);
    // iframe document may be cross-origin (localhost vs 127.0.0.1), so parent JS cannot read data-pd.
    // Fall back to the server record and a direct execute in the child frame.
    let iframeStatus = iframeOk;
    if (iframeOk === 'timeout' || iframeOk === '') {
        try {
            const frames = w.webContents.mainFrame.framesInSubtree || [];
            for (const f of frames) {
                if (f.url && f.url.includes('/pick')) {
                    iframeStatus = await f.executeJavaScript(`new Promise((resolve) => {
                        const start = Date.now();
                        const tick = () => {
                            const v = document.body.getAttribute('data-pd');
                            if (v) return resolve(v);
                            if (Date.now() - start > 8000) return resolve('timeout');
                            setTimeout(tick, 50);
                        };
                        tick();
                    })`);
                    break;
                }
            }
        } catch (e) { iframeStatus = 'frame-err:' + e.message; }
    }
    const vehSeen = seen.filter(s => s.url === '/api/vehicles/m1VehicleId').pop();
    const partitionedOk = !!(vehSeen && /pd=1/.test(vehSeen.cookie) && (!iframeStatus || iframeStatus === 'timeout' || /^200:/.test(String(iframeStatus))));

    console.log('same-origin GET cookie', cookieOk, sameSeen && sameSeen.cookie, sameOrigin);
    console.log('same-origin GET custom headers', headerOk, sameSeen && { csrf: sameSeen.csrf, custom: sameSeen.custom });
    console.log('iframe partitioned cookie', partitionedOk, vehSeen && vehSeen.cookie, iframeStatus);
    console.log(logs.join('\n'));

    server.close();
    const ok = cookieOk && headerOk && partitionedOk;
    console.log(ok ? 'INTERCEPT-HEADERS E2E OK' : 'INTERCEPT-HEADERS E2E FAIL');
    app.exit(ok ? 0 : 1);
}).catch(e => { console.error(e); app.exit(1); });
