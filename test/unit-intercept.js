const fs = require('fs'); const assert = require('assert');
const { makeHttpsHandler, kindFromUrl } = require('../doc-intercept');
const { stampPdf, findHeader } = require('../pdf-stamp');
const logs = []; const log = m => logs.push(m);
const logo = fs.readFileSync(__dirname + '/../logo.png'), wmk = fs.readFileSync(__dirname + '/../logo-watermark.png');
const seen = {};
const stamp = async (buf, info) => { const h = await findHeader(buf); const k = (h && h.kind) || info.kind;
  const fl = k !== 'workorder' && !!h, wm = k === 'invoice'; seen[k] = { headerFlipped: fl, watermark: wm }; if (!fl && !wm) return null;
  return Buffer.from(await stampPdf(buf, { flipHeader: fl, watermark: wm, opacity: 0.045, logoPng: logo, watermarkPng: wmk })); };
(async () => {
  assert.equal(kindFromUrl('https://shop.tekmetric.com/document/shop/1/repair-order/x/work-order?tz=a'), 'workorder');
  assert.equal(kindFromUrl('https://shop.tekmetric.com/document/shop/1/repair-order/x/invoice?tz=a'), 'invoice');
  for (const [f, seg] of [['invoice.pdf', 'invoice'], ['workorder.pdf', 'work-order']]) {
    const pdf = fs.readFileSync('/workspace/realpdf/' + f);
    const url = 'https://shop.tekmetric.com/document/shop/16618/repair-order/-FGV/' + seg + '?tz=America%252FToronto';
    const h = makeHttpsHandler({ fetch: async () => new Response(pdf, { status: 200, headers: { 'content-type': 'application/pdf', 'content-length': String(pdf.length) } }), stamp, log });
    const r = await h(new Request(url));
    const out = Buffer.from(await r.arrayBuffer());
    assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'application/pdf');
    assert.equal(+r.headers.get('content-length'), out.length); assert.ok(out.slice(0, 4).toString() === '%PDF');
    if (seg === 'invoice') assert.notDeepEqual(out, pdf, 'stamped'); else assert.deepEqual(out, pdf, 'work order unchanged');
    fs.writeFileSync('/tmp/unit-' + f, out);
  }
  assert.deepEqual(seen.invoice, { headerFlipped: true, watermark: true }, 'invoice gets both');
  assert.deepEqual(seen.workorder, { headerFlipped: false, watermark: false }, 'work order untouched');
  // HTML document page: unchanged, logged
  const html = '<html><body>loading pdf...</body></html>';
  const h2 = makeHttpsHandler({ fetch: async () => new Response(html, { headers: { 'content-type': 'text/html' } }), stamp, log });
  assert.equal(await (await h2(new Request('https://shop.tekmetric.com/document/shop/1/repair-order/x/estimate'))).text(), html);
  // non-tekmetric + normal tekmetric: same Response object passed through
  const orig = new Response('x', { headers: { 'content-type': 'text/javascript' } });
  const h3 = makeHttpsHandler({ fetch: async () => orig, stamp, log });
  assert.strictEqual(await h3(new Request('https://shop.tekmetric.com/app.js')), orig);
  assert.strictEqual(await h3(new Request('https://google.com/')), orig);
  // PDF from an API host (octet-stream) caught too
  const pdf = fs.readFileSync('/workspace/realpdf/invoice.pdf');
  const h4 = makeHttpsHandler({ fetch: async () => new Response(pdf, { headers: { 'content-type': 'application/octet-stream' } }), stamp, log });
  const o4 = Buffer.from(await (await h4(new Request('https://api.tekmetric.com/x/pdf'))).arrayBuffer());
  assert.notDeepEqual(o4, pdf);
  console.log(logs.join('\n')); console.log('UNIT OK');
})().catch(e => { console.error(e); process.exit(1); });
