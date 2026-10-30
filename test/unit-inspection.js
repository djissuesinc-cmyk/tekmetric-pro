// v2.3.8: inspection kind via URL (query string), via remembered /document/ page, and worker stamping
const assert = require('assert'); const fs = require('fs');
const { makeHttpsHandler, kindFromUrl } = require('../doc-intercept');
const { detectKind, findHeader } = require('../pdf-stamp');
const pa = require('../pdf-async');
(async () => {
  assert.equal(kindFromUrl('https://shop.tekmetric.com/document/shop/16618/repair-order/AbC/inspections?tz=America%2FToronto&hideImages=true'), 'inspection');
  const inv = fs.readFileSync('/workspace/realpdf/invoice.pdf'), wo = fs.readFileSync('/workspace/realpdf/workorder.pdf');
  // header fallback 'workorder' must not beat an inspection URL; real invoice header still wins
  assert.equal(await detectKind(wo, await findHeader(wo), 'inspection'), 'inspection');
  assert.equal(await detectKind(inv, await findHeader(inv), 'inspection'), 'invoice');
  assert.equal(await detectKind(wo, await findHeader(wo), null), 'workorder');
  // HTML doc page then PDF from an unrelated URL -> kind remembered
  const kinds = [];
  const h = makeHttpsHandler({ fetch: async (req) => /document/.test(req.url) ? new Response('<html>x</html>', { headers: { 'content-type': 'text/html' } }) : new Response(wo, { headers: { 'content-type': 'application/pdf' } }),
    stamp: async (b, i) => { kinds.push(i.kind); return null; }, log: () => {} });
  const html = await h(new Request('https://shop.tekmetric.com/document/shop/1/repair-order/x/inspections?tz=a&hideImages=true'));
  assert.equal(await html.text(), '<html>x</html>'); // HTML passes through unchanged
  await h(new Request('https://api.tekmetric.com/x/pdf'));
  assert.deepEqual(kinds, ['inspection']);
  // worker path: same result as in-process, page size unchanged
  const out = await pa.stampPdf(inv, { flipHeader: true, watermark: true, logoPng: fs.readFileSync(__dirname + '/../logo.png'), watermarkPng: fs.readFileSync(__dirname + '/../logo-watermark.png') });
  assert.equal(out.headerFlipped, true);
  const { PDFDocument } = require('pdf-lib');
  const a = (await PDFDocument.load(inv)).getPages().map(p => JSON.stringify(p.getSize())), b = (await PDFDocument.load(out)).getPages().map(p => JSON.stringify(p.getSize()));
  assert.deepEqual(a, b);
  console.log('INSPECTION UNIT OK'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
