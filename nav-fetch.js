// v2.3.7: fetch helpers for the session-wide https handler (doc-intercept.js).
// ses.fetch(req) silently dropped POST form bodies and followed redirects without telling Chromium,
// so a punchout popup (Nexpart / PartsTech: about:blank -> POST form -> 302) opened with an empty
// POST and a wrong page URL = white screen. Here: request bodies are buffered and passed explicitly,
// and top-level navigations use net.request with manual redirects so Chromium follows them itself.
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

// Navigation fetch with redirect: 'manual' via electron.net (ses.fetch can't return a 3xx)
function netNavigate(net, ses, req, body) {
    return new Promise((resolve, reject) => {
        const r = net.request({ method: req.method, url: req.url, session: ses, useSessionCookies: true, redirect: 'manual', bypassCustomProtocolHandlers: true });
        const hdrs = headersToObj(req.headers);
        for (const k of Object.keys(hdrs)) {
            if (/^(host|content-length|connection|cookie)$/i.test(k)) continue;
            try { r.setHeader(k, hdrs[k]); } catch (e) {}
        }
        r.on('redirect', (status, method, redirectUrl, responseHeaders) => {
            const h = new Headers();
            for (const [k, v] of Object.entries(responseHeaders || {})) {
                if (/^set-cookie$/i.test(k)) continue; // already stored in the session by net
                for (const x of [].concat(v)) h.append(k, x);
            }
            h.set('location', redirectUrl);
            try { r.abort(); } catch (e) {}
            resolve(new Response(null, { status, headers: h }));
        });
        r.on('response', (res) => {
            const h = new Headers();
            for (const [k, v] of Object.entries(res.headers || {})) {
                if (/^set-cookie$/i.test(k)) continue;
                for (const x of [].concat(v)) h.append(k, x);
            }
            h.delete('content-encoding'); h.delete('content-length'); // net decodes the body
            const nullBody = [101, 204, 205, 304].includes(res.statusCode) || req.method === 'HEAD';
            resolve(new Response(nullBody ? null : Readable.toWeb(res), { status: res.statusCode, statusText: res.statusMessage, headers: h }));
        });
        r.on('error', reject);
        if (body) r.write(body);
        r.end();
    });
}

// deps: electron { net }, session
function makeSessionFetch(net, ses, log) {
    return async (req) => {
        const body = await readBody(req);
        if (isNavigation(req)) {
            if (log && req.method !== 'GET') log('nav ' + req.method + ' ' + req.url + ' body=' + (body ? body.length : 0));
            return netNavigate(net, ses, req, body);
        }
        const init = { method: req.method, headers: req.headers, bypassCustomProtocolHandlers: true };
        if (body) init.body = body;
        return ses.fetch(req.url, init);
    };
}

module.exports = { makeSessionFetch, isNavigation };
