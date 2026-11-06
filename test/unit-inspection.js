// v2.3.8/2.3.9: inspection kind via URL, remembered /document/ page, worker stamping + stampJob
const assert = require('assert'); const fs = require('fs'); const path = require('path');
const { makeHttpsHandler, kindFromUrl } = require('../doc-intercept');
const { detectKind, findHeader } = require('../pdf-stamp');
const pa = require('../pdf-async');
(async () => {
  assert.equal(kindFromUrl('https://shop.tekmetric.com/document/shop/16618/repair-order/AbC/inspections?tz=America%2FToronto&hideImages=true'), 'inspection');
  const inv = fs.readFileSync('/workspace/realpdf/invoice.pdf'), wo = fs.readFileSync('/workspace/realpdf/workorder.pdf');
  assert.equal(await detectKind(wo, await findHeader(wo), 'inspection'), 'inspection');
  assert.equal(await detectKind(inv, await findHeader(inv), 'inspection'), 'invoice');
  assert.equal(await detectKind(wo, await findHeader(wo), null), 'workorder');
  const kinds = [];
  const h = makeHttpsHandler({ fetch: async (req) => /document/.test(req.url) ? new Response('<html>x</html>', { headers: { 'content-type': 'text/html' } }) : new Response(wo, { headers: { 'content-type': 'application/pdf' } }),
    stamp: async (b, i) => { kinds.push(i.kind); return null; }, log: () => {} });
  assert.equal(await (await h(new Request('https://shop.tekmetric.com/document/shop/1/repair-order/x/inspections?tz=a&hideImages=true'))).text(), '<html>x</html>');
  await h(new Request('https://api.tekmetric.com/x/pdf'));
  assert.deepEqual(kinds, ['inspection']);
  // worker path + page size unchanged
  const logo = path.join(__dirname, '../logo.png'), wmk = path.join(__dirname, '../logo-watermark.png');
  const out = await pa.stampPdf(inv, { flipHeader: true, watermark: true, logoPng: fs.readFileSync(logo), watermarkPng: fs.readFileSync(wmk) });
  assert.equal(out.headerFlipped, true);
  const { PDFDocument } = require('pdf-lib');
  const sizes = async (b) => (await PDFDocument.load(b)).getPages().map(p => JSON.stringify(p.getSize()));
  assert.deepEqual(await sizes(inv), await sizes(out));
  // v2.3.9: stampJob one-shot + path-based PNG cache (second call must reuse worker)
  pa.prewarm();
  const j1 = await pa.stampJob(inv, { urlKind: null, flipHeader: true, watermark: true, opacity: 0.045, logoPath: logo, watermarkPath: wmk });
  assert.equal(j1.skipped, false); assert.equal(j1.headerFlipped, true); assert.ok(j1.bytes && j1.bytes.length > 100);
  assert.deepEqual(await sizes(inv), await sizes(j1.bytes));
  const j2 = await pa.stampJob(wo, { urlKind: 'inspection', flipHeader: true, watermark: true, logoPath: logo, watermarkPath: wmk });
  assert.equal(j2.docKind, 'inspection'); assert.equal(j2.headerFlipped, false);
  const j3 = await pa.stampJob(wo, { urlKind: null, flipHeader: true, watermark: false, logoPath: logo, watermarkPath: wmk });
  assert.equal(j3.skipped, true); // work order, no watermark requested effectively for flip-only without matching kind... wait flip is false for workorder
  assert.equal(j3.docKind, 'workorder');
  console.log('INSPECTION UNIT OK'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
