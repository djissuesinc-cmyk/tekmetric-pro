// v2.4.8: cached PNG embed must give a valid, correct stamped PDF on every run, and be quicker after the first.
const fs = require('fs'), path = require('path');
const { PDFDocument } = require('pdf-lib');
const ps = require('../pdf-stamp');
(async () => {
  const inv = fs.readFileSync('/workspace/realpdf/invoice.pdf');
  const logo = fs.readFileSync(path.join(__dirname, '../logo.png')), wm = fs.readFileSync(path.join(__dirname, '../logo-watermark.png'));
  const header = await ps.findHeader(inv);
  if (!header) throw new Error('header not found');
  const times = [], sizes = [];
  for (let i = 0; i < 4; i++) {
    const t = Date.now();
    const out = await ps.stampPdf(inv, { flipHeader: true, watermark: true, logoPng: logo, watermarkPng: wm, header });
    times.push(Date.now() - t); sizes.push(out.length);
    const doc = await PDFDocument.load(out);
    if (doc.getPageCount() < 1) throw new Error('no pages');
    if (!out.headerFlipped) throw new Error('header not flipped on run ' + i);
    // two images embedded per doc, each with an SMask
    const imgs = doc.context.enumerateIndirectObjects().filter(([, o]) => o && o.dict && String(o.dict.get(require('pdf-lib').PDFName.of('Subtype'))) === '/Image');
    if (imgs.length < 3) throw new Error('expected logo + watermark image objects (+ masks), got ' + imgs.length);
  }
  if (new Set(sizes).size !== 1) throw new Error('sizes differ between runs ' + sizes);
  console.log('stampPdf ms per run', times.join(','), 'bytes', sizes[0]);
  if (times[3] > times[0] + 50) throw new Error('cached runs should not be slower');
  await ps.warm(logo, wm);
  console.log('PRINTPERF UNIT OK');
})().catch(e => { console.error('PRINTPERF UNIT FAIL', e); process.exit(1); });
