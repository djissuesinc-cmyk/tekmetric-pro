const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { createDocumentPdfStamper, viewerLooksBroken } = require('../doc-stamp-window');
const { kindFromUrl } = require('../doc-intercept');

const invoice = fs.readFileSync('/workspace/realpdf/invoice.pdf');

function mockWc(startUrl, { ct = 'application/pdf', failLoad = false } = {}) {
    return {
        url: startUrl,
        isDestroyed() { return false; },
        getURL() { return this.url; },
        async executeJavaScript(code) {
            if (code.includes('document.contentType') && !code.includes('innerText')) return ct;
            return { ct, text: '', title: '', href: this.url };
        },
        async loadURL(u) {
            if (failLoad) throw new Error('load failed');
            this.url = u;
        }
    };
}

(async () => {
    assert.equal(viewerLooksBroken({ text: 'Error: Failed to load PDF document.' }), true);
    assert.equal(viewerLooksBroken({ text: '', title: '' }), false);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tekpro-dstamp-'));
    const docUrl = 'https://shop.tekmetric.com/document/shop/1/repair-order/x/invoice?tz=a';

    // success: stamped bytes written and window swapped to file://
    const marked = Buffer.concat([invoice, Buffer.from('\n%STAMPED\n')]);
    let wrote = null;
    const applyOk = createDocumentPdfStamper({
        fetch: async () => invoice,
        stamp: async (buf, info) => { assert.equal(info.kind, 'invoice'); assert.ok(buf.equals(invoice)); return marked; },
        writeTemp: async (buf) => { wrote = path.join(dir, 'out.pdf'); fs.writeFileSync(wrote, buf); return wrote; },
        log: () => {}
    });
    const wc = mockWc(docUrl);
    const r = await applyOk(wc);
    assert.equal(r.replaced, true);
    assert.ok(wc.url.startsWith('file:'));
    assert.ok(fs.readFileSync(wrote).equals(marked));

    // stamp throws: original URL stays
    const applyFail = createDocumentPdfStamper({
        fetch: async () => invoice,
        stamp: async () => { throw new Error('stamp exploded'); },
        writeTemp: async () => { throw new Error('should not write'); },
        log: () => {}
    });
    const wc2 = mockWc(docUrl);
    const r2 = await applyFail(wc2);
    assert.equal(r2.leftOriginal, true);
    assert.equal(wc2.url, docUrl);

    // reload of stamped file fails: original URL is restored
    const applyRestore = createDocumentPdfStamper({
        fetch: async () => invoice,
        stamp: async () => marked,
        writeTemp: async (buf) => { const p = path.join(dir, 'out2.pdf'); fs.writeFileSync(p, buf); return p; },
        log: () => {}
    });
    const wc3 = mockWc(docUrl, { failLoad: true });
    const r3 = await applyRestore(wc3);
    assert.equal(r3.leftOriginal, true);
    assert.equal(r3.restored, true);
    assert.equal(wc3.url, docUrl);

    // HTML document page is left alone
    const wc4 = mockWc(docUrl, { ct: 'text/html' });
    const r4 = await applyOk(wc4);
    assert.equal(r4.skipped, true);
    assert.equal(wc4.url, docUrl);

    assert.equal(kindFromUrl(docUrl), 'invoice');
    console.log('UNIT-DOC-STAMP OK');
})().catch((e) => { console.error(e); process.exit(1); });
