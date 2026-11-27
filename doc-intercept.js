// Network-layer interception of Tekmetric print documents (v2.3.3).
// v2.5.5: do not register session.protocol.handle('https'). That hook is scheme-wide
// (Electron cannot scope it by host) and a main-process ses.fetch / net.request
// passthrough has no top-level-site or initiator context, so Partitioned / CHIPS
// and some CORS modes do not match the renderer. Punchouts and shop/ProDemand
// XHR go through Chromium untouched.
// v2.5.6: the debugger Fetch stamp on /document/ PDFs (v2.5.5) made Chromium's PDF
// viewer show "Failed to load PDF document" on every shop PC, even when fulfill
// returned 200. Production therefore does not attach Fetch. /document/ PDFs load
// natively (unstamped). Blob/print stamping is unchanged. Pass stampViaFetch:true
// only in tests that specifically exercise the old hook.
// Tekmetric opens https://shop.tekmetric.com/document/shop/<id>/repair-order/<key>/<invoice|estimate|work-order|...>
const DOC_RE = /^https:\/\/shop\.tekmetric\.com\/document\//i;
const TEK_DOC_RE = /^https:\/\/([a-z0-9-]+\.)*tekmetric\.com\/document\//i;
const TEK_HOST_RE = /^https:\/\/([a-z0-9-]+\.)*tekmetric\.com\//i;

function kindFromUrl(u) {
    const p = String(u).split(/[?#]/)[0].toLowerCase();
    if (/\/work-?order\b/.test(p)) return 'workorder';
    if (/\/invoice\b/.test(p)) return 'invoice';
    if (/\/estimate\b/.test(p)) return 'estimate';
    if (/\/(inspections?|dvi)\b/.test(p)) return 'inspection';
    return null;
}

function isPdfBytes(buf) {
    return buf && buf.length >= 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46;
}

function isDocumentUrl(u) {
    return TEK_DOC_RE.test(u) || DOC_RE.test(u);
}

// Host + path only. No query string, hash, or long token-like path segments.
function urlForLog(u) {
    try {
        const x = new URL(u);
        const path = x.pathname.replace(/\/[^/]+/g, (seg) => {
            const s = seg.slice(1);
            // Token-like (long mixed-case / base64). Keep ordinary lowercase path names.
            if (s.length >= 16 && (/[A-Z]/.test(s) || !/-/.test(s))) return '/…';
            return seg;
        });
        return x.host + path;
    } catch (e) {
        return 'invalid-url';
    }
}

function headerVal(headers, name) {
    if (!headers) return '';
    if (typeof headers.get === 'function') return headers.get(name) || '';
    const want = name.toLowerCase();
    if (Array.isArray(headers)) {
        for (const h of headers) {
            if (h && String(h.name || '').toLowerCase() === want) return String(h.value || '');
        }
        return '';
    }
    for (const k of Object.keys(headers)) {
        if (k.toLowerCase() === want) {
            const v = headers[k];
            return Array.isArray(v) ? String(v[0] || '') : String(v || '');
        }
    }
    return '';
}

function headersFromCdp(list) {
    const h = new Headers();
    for (const item of list || []) {
        if (!item || !item.name) continue;
        if (/^content-encoding$|^content-length$/i.test(item.name)) continue;
        try { h.append(item.name, item.value == null ? '' : String(item.value)); } catch (e) {}
    }
    return h;
}

function cdpHeadersFromResponse(headers) {
    const out = [];
    headers.forEach((v, k) => { out.push({ name: k, value: v }); });
    return out;
}

function lastDocRef() {
    return { kind: null, t: 0 };
}

// After a /document/ fetch, stamp PDF bytes; HTML document pages and other traffic are unchanged.
async function processFetchedResponse(u, res, deps, lastDoc) {
    const log = (deps && deps.log) || (() => {});
    const isDoc = isDocumentUrl(u) || !!(deps && deps.shouldIntercept && deps.shouldIntercept(u));
    const isTek = TEK_HOST_RE.test(u) || isDoc;
    if (!isTek) return res;
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    const maybePdf = ct.includes('application/pdf') || ct.includes('octet-stream') || ct.includes('application/x-pdf');
    if (isDoc && kindFromUrl(u)) {
        lastDoc.kind = kindFromUrl(u);
        lastDoc.t = Date.now();
    }
    if (isDoc) log('doc ' + (deps.method || 'GET') + ' ' + u + ' -> ' + res.status + ' ct=' + (ct || '(none)'));
    if (!maybePdf && !isDoc) return res;
    if (!maybePdf && isDoc && !/text\/html|json|text\/plain/.test(ct)) return res;
    let buf;
    try { buf = Buffer.from(await res.arrayBuffer()); }
    catch (e) { log('read body failed ' + urlForLog(u) + ': ' + e.message); return new Response(null, { status: 502 }); }
    const headers = new Headers(res.headers);
    headers.delete('content-encoding');
    let out = buf;
    if (isPdfBytes(buf)) {
        const kind = kindFromUrl(u) || (lastDoc && Date.now() - lastDoc.t < 60000 ? lastDoc.kind : null);
        log('PDF caught (' + buf.length + ' bytes) kind=' + kind + ' ' + u);
        try {
            const s = deps.stamp && await deps.stamp(buf, { url: u, kind });
            if (s && s.length) out = Buffer.from(s);
        } catch (e) { log('network stamp failed: ' + (e && e.stack || e)); }
    } else if (isDoc) {
        log('doc body is not a PDF; first 300 chars: ' + buf.slice(0, 300).toString('utf8').replace(/\s+/g, ' '));
    }
    headers.set('content-length', String(out.length));
    const nullBody = [101, 204, 205, 304].includes(res.status);
    return new Response(nullBody ? null : out, { status: res.status, statusText: res.statusText, headers });
}

function shouldPauseForStamp(u, responseHeaders, lastDoc, extraIntercept) {
    if (extraIntercept && extraIntercept(u)) return true;
    if (isDocumentUrl(u)) return true;
    if (!TEK_HOST_RE.test(u)) return false;
    const ct = headerVal(responseHeaders, 'content-type').toLowerCase();
    const maybePdf = ct.includes('application/pdf') || ct.includes('octet-stream') || ct.includes('application/x-pdf');
    return maybePdf && lastDoc && lastDoc.kind && (Date.now() - lastDoc.t < 60000);
}

// deps: { fetch(req) -> Promise<Response>, stamp(buf, {url, kind}) -> Promise<Buffer|null>, log(msg) }
function makeHttpsHandler(deps) {
    const log = deps.log || (() => {});
    const lastDoc = lastDocRef();
    return async function handle(req) {
        const u = req.url;
        let res;
        try { res = await deps.fetch(req); }
        catch (e) {
            log('net error ' + req.method + ' ' + urlForLog(u) + ': ' + (e && e.message));
            throw e;
        }
        if (res && res.status >= 400) log('net ' + req.method + ' ' + urlForLog(u) + ' -> ' + res.status);
        return processFetchedResponse(u, res, Object.assign({ method: req.method }, deps), lastDoc);
    };
}

function installFailedRequestLogging(ses, log) {
    if (!ses || !ses.webRequest) return;
    const write = log || (() => {});
    ses.webRequest.onCompleted({ urls: ['https://*/*', 'http://*/*'] }, (d) => {
        if (!d || d.statusCode < 400) return;
        write('net ' + (d.method || '?') + ' ' + urlForLog(d.url) + ' -> ' + d.statusCode);
    });
    ses.webRequest.onErrorOccurred({ urls: ['https://*/*', 'http://*/*'] }, (d) => {
        if (!d) return;
        write('net error ' + (d.method || '?') + ' ' + urlForLog(d.url) + ': ' + (d.error || 'error'));
    });
}

const DEFAULT_FETCH_PATTERNS = [
    { urlPattern: 'https://shop.tekmetric.com/document/*', requestStage: 'Response' },
    { urlPattern: 'https://*.tekmetric.com/document/*', requestStage: 'Response' }
];
const BROAD_FETCH_PATTERNS = DEFAULT_FETCH_PATTERNS.concat([
    { urlPattern: 'https://*.tekmetric.com/*', requestStage: 'Response' }
]);

function defaultFetchPatterns() {
    return DEFAULT_FETCH_PATTERNS.slice();
}

async function fulfillOrContinue(dbg, requestId, outRes, origStatus, origHeaders) {
    if (!outRes) {
        await dbg.sendCommand('Fetch.continueResponse', { requestId });
        return;
    }
    const status = outRes.status || origStatus || 200;
    const headers = cdpHeadersFromResponse(outRes.headers);
    const nullBody = [101, 204, 205, 304].includes(status);
    let body;
    if (!nullBody) {
        const buf = Buffer.from(await outRes.arrayBuffer());
        body = buf.toString('base64');
    }
    await dbg.sendCommand('Fetch.fulfillRequest', {
        requestId,
        responseCode: status,
        responseHeaders: headers.length ? headers : (origHeaders || []),
        body: body
    });
}

// deps: { stamp, log, patterns?, shouldIntercept?(url)? }
function installDocumentInterceptor(ses, name, deps) {
    const log = (deps && deps.log) || (() => {});
    const lastDoc = lastDocRef();
    const extraIntercept = deps && deps.shouldIntercept;
    const basePatterns = (deps && deps.patterns) || DEFAULT_FETCH_PATTERNS;
    const attached = new WeakMap(); // WebContents -> Promise

    installFailedRequestLogging(ses, log);

    // v2.5.6: off by default. Fetch.fulfillRequest of a stamped (or even unchanged)
    // PDF is what broke the built-in viewer in 2.5.5.
    if (!(deps && deps.stampViaFetch)) {
        log('network interceptor installed on ' + (name || 'session') + ' (document Fetch stamp off; PDFs load natively)');
        return { attach: async () => {}, lastDoc: lastDocRef() };
    }

    async function attach(wc) {
        if (!wc || wc.isDestroyed && wc.isDestroyed()) return;
        if (attached.has(wc)) return attached.get(wc);
        let resolveDone;
        const done = new Promise((r) => { resolveDone = r; });
        attached.set(wc, done);
        const finish = () => { try { resolveDone(); } catch (e) {} };
        if (ses && wc.session && wc.session !== ses) {
            finish();
            return done;
        }
        const typ = typeof wc.getType === 'function' ? wc.getType() : 'window';
        if (typ === 'remote' || typ === 'devtools') { finish(); return done; }
        const dbg = wc.debugger;
        if (!dbg) { finish(); return done; }
        try {
            if (!dbg.isAttached()) dbg.attach('1.3');
        } catch (e) {
            attached.delete(wc);
            finish();
            log('document stamp hook attach failed' + (name ? ' on ' + name : '') + ': ' + (e && e.message));
            return done;
        }
        const enable = (patterns) => dbg.sendCommand('Fetch.enable', { patterns: patterns || basePatterns }).catch((e) => {
            log('Fetch.enable failed' + (name ? ' on ' + name : '') + ': ' + (e && e.message));
        });
        await enable(basePatterns);
        log('document stamp hook attached wc#' + wc.id + (name ? ' on ' + name : ''));

        const onNav = (details, u) => {
            const url = (details && typeof details === 'object' && details.url) ? details.url : u;
            if (isDocumentUrl(url) || (extraIntercept && extraIntercept(url))) {
                enable(BROAD_FETCH_PATTERNS.concat(basePatterns.filter((p) => !BROAD_FETCH_PATTERNS.some((b) => b.urlPattern === p.urlPattern))));
            }
        };
        try { wc.on('did-start-navigation', onNav); } catch (e) {}

        const seenIds = new Set();
        const onMessage = async (event, method, params) => {
            if (method !== 'Fetch.requestPaused') return;
            const requestId = params && params.requestId;
            if (!requestId) return;
            if (seenIds.has(requestId)) return;
            seenIds.add(requestId);
            const u = params.request && params.request.url;
            try {
                if (params.hasOwnProperty('responseErrorReason') && !params.responseStatusCode) {
                    await dbg.sendCommand('Fetch.continueRequest', { requestId }).catch(() => {});
                    return;
                }
                const pause = shouldPauseForStamp(u, params.responseHeaders, lastDoc, extraIntercept);
                if (pause) log('fetch paused ' + ((params.request && params.request.method) || '?') + ' ' + urlForLog(u || '') + ' status=' + (params.responseStatusCode || ''));
                if (!pause) {
                    await dbg.sendCommand('Fetch.continueResponse', { requestId }).catch(() => {
                        return dbg.sendCommand('Fetch.continueRequest', { requestId });
                    });
                    return;
                }
                const bodyRes = await dbg.sendCommand('Fetch.getResponseBody', { requestId });
                const buf = Buffer.from(bodyRes.body || '', bodyRes.base64Encoded === false ? 'utf8' : 'base64');
                const headers = headersFromCdp(params.responseHeaders);
                if (!headers.has('content-type') && isPdfBytes(buf)) headers.set('content-type', 'application/pdf');
                const res = new Response(buf, {
                    status: params.responseStatusCode || 200,
                    statusText: params.responseStatusText || '',
                    headers
                });
                const out = await processFetchedResponse(u, res, Object.assign({ method: (params.request && params.request.method) || 'GET' }, deps), lastDoc);
                await fulfillOrContinue(dbg, requestId, out, params.responseStatusCode, params.responseHeaders);
            } catch (e) {
                log('document stamp hook error ' + urlForLog(u || '') + ': ' + (e && e.message));
                try { await dbg.sendCommand('Fetch.continueRequest', { requestId }); } catch (e2) {}
            }
        };
        dbg.on('message', onMessage);
        dbg.on('detach', () => { attached.delete(wc); });
        wc.on('destroyed', () => { try { if (dbg.isAttached()) dbg.detach(); } catch (e) {} });
        finish();
        return done;
    }

    function onCreated(event, wc) { attach(wc).catch(() => {}); }

    let electron;
    try { electron = require('electron'); } catch (e) { electron = null; }
    if (electron && electron.app && typeof electron.app.on === 'function') {
        electron.app.on('web-contents-created', onCreated);
    }
    try {
        if (electron && electron.webContents && electron.webContents.getAllWebContents) {
            for (const wc of electron.webContents.getAllWebContents()) attach(wc).catch(() => {});
        }
    } catch (e) {}

    log('network interceptor installed on ' + (name || 'session') + ' (document URLs only)');
    return { attach, lastDoc };
}

module.exports = {
    makeHttpsHandler,
    kindFromUrl,
    isPdfBytes,
    isDocumentUrl,
    DOC_RE,
    TEK_DOC_RE,
    TEK_HOST_RE,
    urlForLog,
    processFetchedResponse,
    shouldPauseForStamp,
    installFailedRequestLogging,
    installDocumentInterceptor,
    defaultFetchPatterns,
    lastDocRef
};
