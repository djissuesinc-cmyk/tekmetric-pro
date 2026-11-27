// Electron e2e (v2.5.7): Tekmetric print path — window.open a /document/ PDF.
// The built-in viewer must load it (no "Failed to load PDF document"), then the
// app swaps in a stamped file:// PDF (invoice header flip + watermark). If the
// stamp throws, the original PDF stays and the viewer still works.
// Run: xvfb-run -a npx electron test/e2e-doc-viewer.js
const { app, BrowserWindow, session } = require('electron');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { fileURLToPath } = require('url');
const { installDocumentInterceptor } = require('../doc-intercept');
const { createDocumentPdfStamper } = require('../doc-stamp-window');
const { stampJob } = require('../pdf-async');

const invoice = fs.readFileSync('/workspace/realpdf/invoice.pdf');
const workorder = fs.readFileSync('/workspace/realpdf/workorder.pdf');
const logs = [];
setTimeout(() => { console.log('DOC-VIEWER TIMEOUT'); console.log(logs.join('\n')); app.exit(1); }, 40000);

function viewerInfo(wc) {
    return wc.executeJavaScript(`({
        ct: document.contentType,
        text: ((document.body && document.body.innerText) || '') + ' ' + (document.documentElement && document.documentElement.innerText || ''),
        ready: document.readyState,
        href: location.href
    })`).catch(e => ({ err: String(e) }));
}

function viewerOk(info, urlMust) {
    if (!info || info.err) return false;
    if (info.ct && info.ct !== 'application/pdf') return false;
    if (/failed to load pdf document/i.test(info.text || '')) return false;
    if (urlMust && !(info.href || '').includes(urlMust) && !String(urlMust === 'file' ? (info.href || '') : '').startsWith('file:')) {
        // handled by caller
    }
    return true;
}

async function openDocWindow(parent, docUrl) {
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
    return childP;
}

app.whenReady().then(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tekpro-docv-'));
    const key = path.join(dir, 'key.pem');
    const cert = path.join(dir, 'cert.pem');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-keyout', key, '-out', cert, '-days', '1', '-nodes',
        '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost']);

    const files = {
        '/document/shop/1/repair-order/x/invoice?tz=a': invoice,
        '/document/shop/1/repair-order/x/work-order?tz=a': workorder
    };
    const server = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, (req, res) => {
        if (req.url === '/shop' || req.url === '/') {
            res.writeHead(200, { 'content-type': 'text/html' });
            res.end('<html><body>RO page</body></html>');
            return;
        }
        const pdf = files[req.url] || (/\/invoice/.test(req.url) ? invoice : /\/work-order|\/repair/.test(req.url) ? workorder : null);
        if (pdf) {
            res.writeHead(200, { 'content-type': 'application/pdf', 'content-length': String(pdf.length) });
            res.end(pdf);
            return;
        }
        res.writeHead(404);
        res.end('no');
    });
    const port = await new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));
    const origin = 'https://127.0.0.1:' + port;
    const invoiceUrl = origin + '/document/shop/1/repair-order/x/invoice?tz=a';
    const woUrl = origin + '/document/shop/1/repair-order/x/work-order?tz=a';

    const logoPath = path.join(__dirname, '../logo.png');
    const wmPath = path.join(__dirname, '../logo-watermark.png');
    const stampInvoice = async (buf, info) => {
        const r = await stampJob(buf, {
            urlKind: info && info.kind,
            flipHeader: true,
            watermark: true,
            forceWm: true,
            opacity: 0.045,
            logoPath,
            watermarkPath: wmPath
        });
        if (!r || r.skipped || !r.bytes) return null;
        return Buffer.from(r.bytes);
    };

    const ses = session.fromPartition('persist:e2edocv');
    ses.setCertificateVerifyProc((request, cb) => cb(0));
    installDocumentInterceptor(ses, 'e2edocv', { stamp: async () => { throw new Error('Fetch stamp must stay off'); }, log: m => logs.push(m) });

    const apply = createDocumentPdfStamper({
        log: m => logs.push(m),
        shouldIntercept: (u) => /\/document\//.test(u),
        fetch: async (u, wc) => {
            const res = await wc.session.fetch(u, { bypassCustomProtocolHandlers: true, credentials: 'include' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return Buffer.from(await res.arrayBuffer());
        },
        stamp: stampInvoice,
        writeTemp: async (buf) => {
            const p = path.join(dir, 'Leaside_RO_' + Date.now() + '.pdf');
            await fs.promises.writeFile(p, buf);
            return p;
        }
    });

    const parent = new BrowserWindow({ show: false, webPreferences: { partition: 'persist:e2edocv' } });
    await parent.loadURL(origin + '/shop');
    parent.webContents.setWindowOpenHandler(() => ({
        action: 'allow',
        overrideBrowserWindowOptions: { show: false, webPreferences: { partition: 'persist:e2edocv' } }
    }));

    // --- A: invoice (multi-page) stamps and the viewer still loads it ---
    const invWin = await openDocWindow(parent, invoiceUrl);
    const before = await viewerInfo(invWin.webContents);
    const beforeOk = viewerOk(before);
    const result = await apply(invWin.webContents);
    const after = await viewerInfo(invWin.webContents);
    const afterOk = viewerOk(after);
    const fileUrl = invWin.webContents.getURL();
    const isFile = /^file:/i.test(fileUrl);
    let stampedBytes = null;
    if (isFile) {
        try { stampedBytes = fs.readFileSync(fileURLToPath(fileUrl)); } catch (e) { logs.push('read stamped: ' + e.message); }
    }
    const stampPresent = !!(stampedBytes && stampedBytes.slice(0, 4).toString() === '%PDF' && !stampedBytes.equals(invoice) && stampedBytes.length > invoice.length);
    const invoiceOk = beforeOk && afterOk && result && result.replaced && isFile && stampPresent;
    console.log('invoice before', before);
    console.log('invoice after', after, 'replaced', result, 'file', isFile, 'bytes', stampedBytes && stampedBytes.length, 'orig', invoice.length);

    // --- B: stamp throws — original invoice stays, viewer still works ---
    const applyFail = createDocumentPdfStamper({
        log: m => logs.push(m),
        shouldIntercept: (u) => /\/document\//.test(u),
        fetch: async (u, wc) => {
            const res = await wc.session.fetch(u, { bypassCustomProtocolHandlers: true, credentials: 'include' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return Buffer.from(await res.arrayBuffer());
        },
        stamp: async () => { throw new Error('stamp failed on purpose'); },
        writeTemp: async () => { throw new Error('should not write'); }
    });
    const failWin = await openDocWindow(parent, invoiceUrl);
    const failResult = await applyFail(failWin.webContents);
    const failInfo = await viewerInfo(failWin.webContents);
    const failUrl = failWin.webContents.getURL();
    const failSafeOk = failResult && failResult.leftOriginal && viewerOk(failInfo) && failUrl === invoiceUrl;
    console.log('fail-safe', failResult, failInfo, failUrl);

    // --- C: work order also opens in the viewer (stamp may no-op flip/wm for this kind) ---
    const woWin = await openDocWindow(parent, woUrl);
    const woBefore = await viewerInfo(woWin.webContents);
    const woResult = await apply(woWin.webContents);
    const woAfter = await viewerInfo(woWin.webContents);
    const woOk = viewerOk(woBefore) && viewerOk(woAfter) && (woResult.replaced || woResult.leftOriginal || woResult.unchanged || woResult.skipped);
    console.log('workorder', woResult, woAfter);

    console.log(logs.join('\n'));
    server.close();
    const ok = invoiceOk && failSafeOk && woOk && logs.some(l => /Fetch stamp off/i.test(l));
    console.log(ok ? 'DOC-VIEWER E2E OK' : 'DOC-VIEWER E2E FAIL', { invoiceOk, failSafeOk, woOk });
    app.exit(ok ? 0 : 1);
}).catch(e => { console.error(e); app.exit(1); });
