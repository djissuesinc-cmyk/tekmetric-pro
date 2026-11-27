// v2.3.7: fetch helpers for the session-wide https handler (doc-intercept.js).
// v2.5.4: non-document traffic is a strict passthrough. The old
// `ses.fetch(req.url, { method, headers, body })` path built a new Request,
// which drops forbidden headers (Cookie, Origin, Referer). That broke
// credentialed XHR/fetch and CORS preflight used by ProDemand (iframe) and
// Tekmetric's PartsTech punchout API. Navigations still use net.request with
// redirect: 'manual' so Chromium sees the 3xx (ses.fetch follows redirects
// and leaves the page on the original URL = blank punchout).
const { Readable } = require('stream');

function isNavigation(req) {
    const h = req.headers;
    const mode = (h.get('sec-fetch-mode') || '').toLowerCase();
    const dest = (h.get('sec-fetch-dest') || '').toLowerCase();
    if (mode === 'navigate' || dest === 'document' || dest === 'iframe' || dest === 'frame') return true;
    // Electron's protocol handler doesn't pass Sec-Fetch-*; Chromium sends Upgrade-Insecure-Requests
    // + an HTML Accept only on document/frame navigations.
    return h.get('upgrade-insecure-requests') === '1' && /^text\/html/i.test(h.get('accept') || '');
}

async function readBody(req) {
    if (req.method === 'GET' || req.method === 'HEAD' || !req.body) return null;
    return Buffer.from(await req.arrayBuffer());
}

function headersToObj(h) {
    const o = {};
    h.forEach((v, k) => { o[k] = v; });
    return o;
}

// Hop-by-hop headers must not be forwarded. Cookie is omitted because
// useSessionCookies: true attaches the session's cookies for the URL.
const SKIP_REQ_HEADERS = /^(host|content-length|connection|cookie)$/i;

function inferredOrigin(req) {
    try {
        const existing = req.headers && req.headers.get && req.headers.get('origin');
        if (existing) return existing;
    } catch (e) {}
    try {
        const ref = req.referrer;
        if (ref && ref !== 'about:client' && /^https?:/i.test(ref)) return new URL(ref).origin;
    } catch (e) {}
    return null;
}

function copyForwardHeaders(r, req) {
    const hdrs = headersToObj(req.headers);
    for (const k of Object.keys(hdrs)) {
        if (SKIP_REQ_HEADERS.test(k)) continue;
        try { r.setHeader(k, hdrs[k]); } catch (e) {}
    }
    // protocol.handle often omits Origin; fill it from Referer when we can.
    if (!hdrs.origin && !hdrs.Origin) {
        const o = inferredOrigin(req);
        if (o) { try { r.setHeader('Origin', o); } catch (e) {} }
    }
}

function headersFromNet(responseHeaders, { skipSetCookie }) {
    const h = new Headers();
    for (const [k, v] of Object.entries(responseHeaders || {})) {
        if (skipSetCookie && /^set-cookie$/i.test(k)) continue;
        for (const x of [].concat(v)) h.append(k, x);
    }
    return h;
}

function netExchange(net, ses, req, body, { redirect, skipSetCookie }) {
    return new Promise((resolve, reject) => {
        const r = net.request({
            method: req.method,
            url: req.url,
            session: ses,
            useSessionCookies: true,
            redirect,
            bypassCustomProtocolHandlers: true
        });
        copyForwardHeaders(r, req);
        if (redirect === 'manual') {
            r.on('redirect', (status, method, redirectUrl, responseHeaders) => {
                const h = headersFromNet(responseHeaders, { skipSetCookie: true });
                h.set('location', redirectUrl);
                try { r.abort(); } catch (e) {}
                resolve(new Response(null, { status, headers: h }));
            });
        }
        r.on('response', (res) => {
            const h = headersFromNet(res.headers, { skipSetCookie: !!skipSetCookie });
            h.delete('content-encoding'); h.delete('content-length'); // net decodes the body
            const nullBody = [101, 204, 205, 304].includes(res.statusCode) || req.method === 'HEAD';
            resolve(new Response(nullBody ? null : Readable.toWeb(res), { status: res.statusCode, statusText: res.statusMessage, headers: h }));
        });
        r.on('error', reject);
        if (body) r.write(body);
        r.end();
    });
}

function netNavigate(net, ses, req, body) {
    return netExchange(net, ses, req, body, { redirect: 'manual', skipSetCookie: true });
}

// deps: electron { net }, session
function makeSessionFetch(net, ses, log) {
    return async (req) => {
        // v2.3.9: GET/HEAD assets (parts catalogs load hundreds) skip body buffering entirely.
        // credentials: 'include' so session cookies go with the original Request (protocol.handle
        // often omits the Cookie header; the default is not to attach session cookies).
        const nav = isNavigation(req);
        if (!nav && (req.method === 'GET' || req.method === 'HEAD')) {
            return ses.fetch(req, { bypassCustomProtocolHandlers: true, credentials: 'include' });
        }
        const body = await readBody(req);
        if (nav) {
            if (log && req.method !== 'GET') {
                const { urlForLog } = require('./doc-intercept');
                log('nav ' + req.method + ' ' + urlForLog(req.url) + ' body=' + (body ? body.length : 0));
            }
            return netNavigate(net, ses, req, body);
        }
        // v2.5.4: POST/PUT/PATCH/OPTIONS/DELETE go through net.request so Origin,
        // Referer, Authorization, and session cookies survive (unlike ses.fetch(url, init)).
        return netExchange(net, ses, req, body, { redirect: 'follow', skipSetCookie: false });
    };
}

module.exports = { makeSessionFetch, isNavigation, copyForwardHeaders, SKIP_REQ_HEADERS };
