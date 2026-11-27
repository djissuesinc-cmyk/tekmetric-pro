// v2.5.4: the https interceptor must keep cookies, Origin, and POST bodies.
const assert = require('assert');
const { Readable } = require('stream');
const { makeSessionFetch, isNavigation, copyForwardHeaders, SKIP_REQ_HEADERS } = require('../nav-fetch');
const { urlForLog, makeHttpsHandler } = require('../doc-intercept');

function mockNet(capture) {
    return {
        request(opts) {
            capture.opts = opts;
            capture.headers = {};
            const handlers = {};
            return {
                setHeader(k, v) { capture.headers[k.toLowerCase()] = v; },
                on(ev, fn) { handlers[ev] = fn; },
                write(b) { capture.body = Buffer.from(b); },
                abort() { capture.aborted = true; },
                end() {
                    if (opts.redirect === 'manual' && capture.redirectTo) {
                        handlers.redirect(302, opts.method, capture.redirectTo, { 'content-type': ['text/html'] });
                        return;
                    }
                    const s = Readable.from([Buffer.from(capture.resBody || 'ok')]);
                    s.headers = capture.resHeaders || { 'content-type': 'text/plain' };
                    s.statusCode = capture.status || 200;
                    s.statusMessage = 'OK';
                    handlers.response(s);
                }
            };
        }
    };
}

(async () => {
    assert.equal(isNavigation(new Request('https://x.test/', { headers: { 'sec-fetch-mode': 'navigate' } })), true);
    assert.equal(isNavigation(new Request('https://x.test/', { headers: { 'sec-fetch-dest': 'iframe' } })), true);
    assert.equal(isNavigation(new Request('https://x.test/api', { headers: { 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty' } })), false);
    assert.equal(isNavigation(new Request('https://x.test/', { headers: { 'upgrade-insecure-requests': '1', accept: 'text/html,application/xhtml+xml' } })), true);
    assert.equal(isNavigation(new Request('https://x.test/api', { method: 'POST', headers: { accept: 'application/json' } })), false);

    assert.equal(urlForLog('https://shop.tekmetric.com/api/public/shop/16618/parts-tech-punchout/4IBOqwYtD2zE_Sa5TTlcsm1rgoAl8ucYkm2FsbRXapg?vin=secret'),
        'shop.tekmetric.com/api/public/shop/16618/parts-tech-punchout/…');
    assert.equal(urlForLog('https://www1.prodemand.com/Intents/v2/PartsAndLabor/Pick?transferTicket=abc#hash'),
        'www1.prodemand.com/Intents/v2/PartsAndLabor/Pick');
    assert.ok(!urlForLog('https://x.test/path?token=abc').includes('token='));
    assert.ok(!urlForLog('https://x.test/path?token=abc').includes('?'));

    // Hop-by-hop + Cookie are skipped; Origin / Referer / Authorization are copied.
    const headers = {};
    const fakeReq = { setHeader(k, v) { headers[k.toLowerCase()] = v; } };
    copyForwardHeaders(fakeReq, new Request('https://x.test/', {
        headers: { Origin: 'https://shop.tekmetric.com', Referer: 'https://shop.tekmetric.com/ro', Cookie: 'sid=1', Authorization: 'Bearer z', Host: 'x.test' }
    }));
    assert.equal(headers.origin, 'https://shop.tekmetric.com');
    assert.equal(headers.referer, 'https://shop.tekmetric.com/ro');
    assert.equal(headers.authorization, 'Bearer z');
    assert.equal(headers.cookie, undefined);
    assert.equal(headers.host, undefined);
    assert.ok(SKIP_REQ_HEADERS.test('Cookie'));

    // Origin inferred from referrer when the Origin header is missing
    const headers2 = {};
    copyForwardHeaders({ setHeader(k, v) { headers2[k.toLowerCase()] = v; } }, new Request('https://www1.prodemand.com/api', {
        referrer: 'https://shop.tekmetric.com/admin/shop/1/estimate'
    }));
    assert.equal(headers2.origin, 'https://shop.tekmetric.com');


    // GET uses ses.fetch with the original Request and credentials: 'include'
    const getCalls = [];
    const getFetch = makeSessionFetch({}, {
        fetch: async (input, init) => { getCalls.push({ input, init }); return new Response('g'); }
    });
    const getReq = new Request('https://www1.prodemand.com/api/tree', { headers: { 'sec-fetch-mode': 'cors' } });
    await getFetch(getReq);
    assert.strictEqual(getCalls[0].input, getReq);
    assert.equal(getCalls[0].init.bypassCustomProtocolHandlers, true);
    assert.equal(getCalls[0].init.credentials, 'include');

    // POST uses net.request (not ses.fetch(url, init)), with cookies + Origin + body
    const cap = {};
    const sesCalls = [];
    const postFetch = makeSessionFetch(mockNet(cap), { fetch: async (i, init) => { sesCalls.push({ i, init }); return new Response('nope'); } });
    const postRes = await postFetch(new Request('https://shop.tekmetric.com/api/parts-tech', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Origin: 'https://shop.tekmetric.com', 'sec-fetch-mode': 'cors' },
        body: '{"ro":10650}'
    }));
    assert.equal(sesCalls.length, 0, 'POST must not go through ses.fetch(url, init)');
    assert.equal(cap.opts.useSessionCookies, true);
    assert.equal(cap.opts.bypassCustomProtocolHandlers, true);
    assert.equal(cap.opts.redirect, 'follow');
    assert.equal(cap.opts.method, 'POST');
    assert.equal(cap.headers.origin, 'https://shop.tekmetric.com');
    assert.equal(cap.headers['content-type'], 'application/json');
    assert.equal(cap.body.toString(), '{"ro":10650}');
    assert.equal(await postRes.text(), 'ok');

    // CORS preflight: OPTIONS keeps Origin and Access-Control-Request-Method
    const capOpt = {};
    const optFetch = makeSessionFetch(mockNet(capOpt), { fetch: async () => new Response('nope') });
    await optFetch(new Request('https://www1.prodemand.com/api', {
        method: 'OPTIONS',
        headers: { Origin: 'https://shop.tekmetric.com', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' }
    }));
    assert.equal(capOpt.opts.method, 'OPTIONS');
    assert.equal(capOpt.opts.useSessionCookies, true);
    assert.equal(capOpt.headers.origin, 'https://shop.tekmetric.com');
    assert.equal(capOpt.headers['access-control-request-method'], 'POST');

    // Navigation POST uses redirect: 'manual' and returns the 3xx to Chromium
    const capNav = { redirectTo: 'https://app.partstech.com/?vin=x' };
    const navFetch = makeSessionFetch(mockNet(capNav), { fetch: async () => new Response('nope') });
    const navRes = await navFetch(new Request('https://shop.tekmetric.com/punchout', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'upgrade-insecure-requests': '1', accept: 'text/html' },
        body: 'vendor=partstech'
    }));
    assert.equal(capNav.opts.redirect, 'manual');
    assert.equal(capNav.opts.useSessionCookies, true);
    assert.equal(capNav.body.toString(), 'vendor=partstech');
    assert.equal(navRes.status, 302);
    assert.equal(navRes.headers.get('location'), 'https://app.partstech.com/?vin=x');
    assert.equal(capNav.aborted, true);

    // Failed requests are logged as host+path only (no query / tokens)
    const logs = [];
    const h = makeHttpsHandler({
        fetch: async () => new Response('{"error":"Server error"}', { status: 500, headers: { 'content-type': 'application/json' } }),
        stamp: async () => null,
        log: m => logs.push(m)
    });
    const r500 = await h(new Request('https://shop.tekmetric.com/api/public/shop/16618/parts-tech-punchout/4IBOqwYtD2zE_Sa5TTlcsm1rgoAl8ucYkm2FsbRXapg?vin=SECRET'));
    assert.equal(r500.status, 500);
    assert.equal(logs.length, 1);
    assert.ok(logs[0].includes('net POST') || logs[0].includes('net GET'));
    assert.ok(logs[0].includes('shop.tekmetric.com/api/public/shop/16618/parts-tech-punchout/…'));
    assert.ok(logs[0].includes('-> 500'));
    assert.ok(!logs[0].includes('SECRET'));
    assert.ok(!logs[0].includes('4IBOqwYt'));
    assert.ok(!logs[0].includes('?'));

    const logs2 = [];
    const h2 = makeHttpsHandler({
        fetch: async () => { throw new Error('net::ERR_FAILED'); },
        stamp: async () => null,
        log: m => logs2.push(m)
    });
    await assert.rejects(() => h2(new Request('https://www1.prodemand.com/Intents/v2/Pick?transferTicket=abc')), /ERR_FAILED/);
    assert.equal(logs2.length, 1);
    assert.ok(logs2[0].startsWith('net error GET www1.prodemand.com/Intents/v2/Pick:'));
    assert.ok(!logs2[0].includes('transferTicket'));

    console.log('UNIT-NAV-FETCH OK');
})().catch(e => { console.error(e); process.exit(1); });
