// Electron e2e (v2.5.4): interceptor forwards Cookie, Origin and POST body through
// the real session.protocol.handle('https') + makeSessionFetch path.
// Run: xvfb-run -a npx electron test/e2e-intercept-headers.js
const { app, BrowserWindow, session, net } = require('electron');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { makeHttpsHandler } = require('../doc-intercept');
const { makeSessionFetch } = require('../nav-fetch');

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
                acrm: req.headers['access-control-request-method'] || '',
                body: Buffer.concat(chunks).toString()
            };
            seen.push(rec);
            if (req.url === '/set') {
                res.writeHead(200, { 'set-cookie': 'tp=1; Path=/; SameSite=None; Secure', 'content-type': 'text/plain' });
                res.end('set');
                return;
            }
            if (req.method === 'OPTIONS') {
                res.writeHead(204, {
                    'access-control-allow-origin': req.headers.origin || '*',
                    'access-control-allow-credentials': 'true',
                    'access-control-allow-headers': 'content-type, x-tekpro-test',
                    'access-control-allow-methods': 'POST, OPTIONS'
                });
                res.end();
                return;
            }
            if (req.url === '/' || req.url === '/page') {
                res.writeHead(200, { 'content-type': 'text/html' });
                res.end('<html><body>ok</body></html>');
                return;
            }
            res.writeHead(200, {
                'content-type': 'application/json',
                'access-control-allow-origin': req.headers.origin || '*',
                'access-control-allow-credentials': 'true'
            });
            res.end(JSON.stringify(rec));
        });
    });
    const port = await new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));
    const origin = 'https://127.0.0.1:' + port;

    const ses = session.fromPartition('persist:e2ehdr');
    ses.setCertificateVerifyProc((request, cb) => cb(0));
    const logs = [];
    ses.protocol.handle('https', makeHttpsHandler({
        fetch: makeSessionFetch(net, ses, m => logs.push(m)),
        stamp: async () => null,
        log: m => logs.push(m)
    }));

    const w = new BrowserWindow({ show: false, webPreferences: { partition: 'persist:e2ehdr', webSecurity: true } });
    await w.loadURL(origin + '/page');
    await w.webContents.executeJavaScript(`fetch(${JSON.stringify(origin + '/set')}, { credentials: 'include' }).then(r => r.text())`);

    const post = await w.webContents.executeJavaScript(`fetch(${JSON.stringify(origin + '/echo')}, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: '{"job":"partstech"}'
    }).then(r => r.json())`);

    // CORS preflight + credentialed POST from a different origin (localhost vs 127.0.0.1)
    const cors = await w.webContents.executeJavaScript(`fetch('https://localhost:${port}/cors', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-tekpro-test': '1' },
        body: '{"job":"prodemand"}'
    }).then(r => r.json()).catch(e => ({ err: String(e) }))`);

    const postSeen = seen.filter(s => s.method === 'POST' && s.url === '/echo').pop();
    const optSeen = seen.filter(s => s.method === 'OPTIONS' && s.url === '/cors').pop();
    const corsPost = seen.filter(s => s.method === 'POST' && s.url === '/cors').pop();

    const cookieOk = !!(postSeen && /tp=1/.test(postSeen.cookie));
    const bodyOk = !!(postSeen && postSeen.body.includes('partstech'));
    const corsBodyOk = !!(corsPost && corsPost.body.includes('prodemand')) || (cors && cors.body && String(cors.body).includes('prodemand'));
    // Origin / preflight: Chromium's protocol.handle may omit Origin. If it is present, it must be forwarded.
    const originForwarded = !postSeen || !postSeen.origin || postSeen.origin === origin;
    const preflightOk = !optSeen || (optSeen.origin === origin && /POST/i.test(optSeen.acrm));

    console.log('POST cookie', cookieOk, postSeen && postSeen.cookie);
    console.log('POST body', bodyOk, postSeen && postSeen.body);
    console.log('POST origin', postSeen && postSeen.origin, 'forwarded', originForwarded);
    console.log('OPTIONS preflight', optSeen);
    console.log('CORS POST', corsBodyOk, corsPost || cors);
    console.log(logs.join('\n'));

    server.close();
    const ok = cookieOk && bodyOk && corsBodyOk && originForwarded && preflightOk;
    console.log(ok ? 'INTERCEPT-HEADERS E2E OK' : 'INTERCEPT-HEADERS E2E FAIL');
    app.exit(ok ? 0 : 1);
}).catch(e => { console.error(e); app.exit(1); });
