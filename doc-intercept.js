// Network-layer interception of Tekmetric print documents (v2.3.3).
// Tekmetric opens https://shop.tekmetric.com/document/shop/<id>/repair-order/<key>/<invoice|estimate|work-order|...>
// Any Tekmetric response that is a PDF (by content-type or %PDF magic) is buffered and passed to `stamp`;
// everything else is returned untouched (streamed).
const DOC_RE = /^https:\/\/shop\.tekmetric\.com\/document\//i;
const TEK_HOST_RE = /^https:\/\/([a-z0-9-]+\.)*tekmetric\.com\//i;

function kindFromUrl(u) {
    const p = String(u).split(/[?#]/)[0].toLowerCase();
    if (/\/work-?order\b/.test(p)) return 'workorder';
    if (/\/invoice\b/.test(p)) return 'invoice';
    if (/\/estimate\b/.test(p)) return 'estimate';
    if (/\/inspection\b/.test(p)) return 'inspection';
    return null;
}

function isPdfBytes(buf) {
    return buf && buf.length >= 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46;
}

// deps: { fetch(req) -> Promise<Response>, stamp(buf, {url, kind}) -> Promise<Buffer|null>, log(msg) }
function makeHttpsHandler(deps) {
    const log = deps.log || (() => {});
    return async function handle(req) {
        const u = req.url;
        const isDoc = DOC_RE.test(u);
        const isTek = TEK_HOST_RE.test(u);
        let res;
        try { res = await deps.fetch(req); }
        catch (e) { if (isDoc) log('doc fetch error ' + u + ': ' + (e && e.message)); throw e; }
        if (!isTek) return res;
        const ct = (res.headers.get('content-type') || '').toLowerCase();
        const maybePdf = ct.includes('application/pdf') || ct.includes('octet-stream') || ct.includes('application/x-pdf');
        if (isDoc) log('doc ' + req.method + ' ' + u + ' -> ' + res.status + ' ct=' + (ct || '(none)'));
        if (!maybePdf && !isDoc) return res; // normal Tekmetric traffic: untouched
        if (!maybePdf && isDoc && !/text\/html|json|text\/plain/.test(ct)) return res;
        let buf;
        try { buf = Buffer.from(await res.arrayBuffer()); }
        catch (e) { log('read body failed ' + u + ': ' + e.message); return new Response(null, { status: 502 }); }
        const headers = new Headers(res.headers);
        headers.delete('content-encoding'); // body is already decoded
        let out = buf;
        if (isPdfBytes(buf)) {
            const kind = kindFromUrl(u);
            log('PDF caught (' + buf.length + ' bytes) kind=' + kind + ' ' + u);
            try { const s = await deps.stamp(buf, { url: u, kind }); if (s && s.length) out = Buffer.from(s); }
            catch (e) { log('network stamp failed: ' + (e && e.stack || e)); }
        } else if (isDoc) {
            log('doc body is not a PDF; first 300 chars: ' + buf.slice(0, 300).toString('utf8').replace(/\s+/g, ' '));
        }
        headers.set('content-length', String(out.length));
        const nullBody = [101, 204, 205, 304].includes(res.status);
        return new Response(nullBody ? null : out, { status: res.status, statusText: res.statusText, headers });
    };
}

module.exports = { makeHttpsHandler, kindFromUrl, isPdfBytes, DOC_RE };
