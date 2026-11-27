// v2.5.7: stamp shop.tekmetric.com /document/ PDFs without a scheme-wide https
// handler and without debugger Fetch (that broke Chromium's PDF viewer in 2.5.5).
// The window loads the original PDF natively first. We then fetch the same URL
// with the window's session cookies, stamp the bytes, and swap in a file:// temp
// PDF the built-in viewer can display. If anything fails, the original stays.
const { pathToFileURL } = require('url');
const { isDocumentUrl, isPdfBytes, kindFromUrl, urlForLog } = require('./doc-intercept');

function viewerLooksBroken(info) {
    if (!info) return false;
    const text = String((info.text || '') + ' ' + (info.title || ''));
    return /failed to load pdf document/i.test(text);
}

function createDocumentPdfStamper(deps) {
    const log = (deps && deps.log) || (() => {});
    const inFlight = new WeakMap();
    const finished = new WeakSet();

    async function readViewer(wc) {
        try {
            return await wc.executeJavaScript(`({
                ct: document.contentType,
                text: ((document.body && document.body.innerText) || '') + ' ' + ((document.documentElement && document.documentElement.innerText) || ''),
                title: document.title || '',
                href: location.href
            })`);
        } catch (e) {
            return { err: String(e && e.message) };
        }
    }

    async function applyInner(wc) {
        if (!wc || (wc.isDestroyed && wc.isDestroyed())) return { skipped: true };
        if (finished.has(wc)) return { skipped: true, already: true };
        let u;
        try { u = wc.getURL(); } catch (e) { return { skipped: true }; }
        if (!u || /^(file:|blob:|about:)/i.test(u)) return { skipped: true };
        const intercept = isDocumentUrl(u) || (deps.shouldIntercept && deps.shouldIntercept(u));
        if (!intercept) return { skipped: true };

        let ct = '';
        try { ct = await wc.executeJavaScript('document.contentType'); } catch (e) {}
        if (ct && !/pdf/i.test(ct) && !/octet-stream/i.test(ct)) return { skipped: true, reason: 'not-pdf' };

        let buf;
        try {
            buf = await deps.fetch(u, wc);
            if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
        } catch (e) {
            log('document stamp fetch failed, leaving original: ' + (e && e.message));
            finished.add(wc);
            return { leftOriginal: true, error: String(e && e.message) };
        }
        if (!isPdfBytes(buf)) {
            finished.add(wc);
            return { leftOriginal: true, error: 'not a pdf' };
        }

        let out = buf;
        let stamped = false;
        try {
            const s = deps.stamp && await deps.stamp(buf, { url: u, kind: kindFromUrl(u) });
            if (s && s.length) {
                out = Buffer.from(s);
                stamped = true;
            }
        } catch (e) {
            log('document stamp failed, leaving original: ' + (e && e.message));
            finished.add(wc);
            return { leftOriginal: true, error: String(e && e.message) };
        }
        if (!stamped) {
            log('document stamp unchanged ' + urlForLog(u));
            finished.add(wc);
            return { leftOriginal: true, unchanged: true };
        }
        if (!isPdfBytes(out)) {
            log('document stamp produced invalid PDF, leaving original');
            finished.add(wc);
            return { leftOriginal: true, error: 'invalid stamp output' };
        }

        let tempPath;
        try {
            tempPath = await deps.writeTemp(out);
            await wc.loadURL(pathToFileURL(tempPath).toString());
        } catch (e) {
            log('document stamp reload failed, restoring original: ' + (e && e.message));
            try { await wc.loadURL(u); } catch (e2) {}
            finished.add(wc);
            return { leftOriginal: true, restored: true, error: String(e && e.message) };
        }

        const info = await readViewer(wc);
        if (viewerLooksBroken(info)) {
            log('stamped PDF failed in viewer, restoring original');
            try { await wc.loadURL(u); } catch (e2) {}
            finished.add(wc);
            return { leftOriginal: true, restored: true, error: 'viewer failed' };
        }
        finished.add(wc);
        log('document stamp replaced ' + urlForLog(u) + ' bytes=' + out.length);
        return { replaced: true, stamped: true, path: tempPath, bytes: out.length };
    }

    function apply(wc) {
        if (!wc || (wc.isDestroyed && wc.isDestroyed())) return Promise.resolve({ skipped: true });
        if (inFlight.has(wc)) return inFlight.get(wc);
        const p = applyInner(wc);
        inFlight.set(wc, p);
        return p;
    }

    return apply;
}

module.exports = { createDocumentPdfStamper, viewerLooksBroken };
