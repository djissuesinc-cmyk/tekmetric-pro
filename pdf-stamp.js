// Stamps Tekmetric invoice / estimate / work-order PDFs (Chrome "print" blobs).
// Header regions are located from the PDF's own text positions (pdfjs-dist), so nothing is hard-coded.
// stampPdf(bytes, {flipHeader, watermark, logoPng, watermarkPng, opacity}) -> Uint8Array
const { PDFDocument, rgb } = require('pdf-lib');

let pdfjs = null;
function getPdfjs() {
  if (!pdfjs) pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
  return pdfjs;
}

// Group page-1 text into lines (top-down coords) and find the two header blocks.
async function findHeader(bytes) {
  const doc = await getPdfjs().getDocument({ data: new Uint8Array(bytes), disableFontFace: true, isEvalSupported: false, verbosity: 0 }).promise;
  try {
    const page = await doc.getPage(1);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const items = tc.items.filter(i => i.str && i.str.trim()).map(i => {
      const base = vp.height - i.transform[5], h = i.height || Math.abs(i.transform[3]) || 9;
      return { s: i.str.trim(), x0: i.transform[4], x1: i.transform[4] + i.width, base, top: base - h * 0.95, bottom: base + h * 0.3 };
    }).filter(i => i.base < vp.height * 0.25); // header lives in the top quarter
    // a "line" = items sharing a baseline within the same column (left or right half)
    const lines = [];
    for (const it of items.sort((a, b) => a.base - b.base || a.x0 - b.x0)) {
      const side = it.x0 < vp.width / 2 ? 'L' : 'R';
      const ln = lines.find(l => l.side === side && Math.abs(l.base - it.base) < 1.5);
      if (ln) { ln.s += ' ' + it.s; ln.x0 = Math.min(ln.x0, it.x0); ln.x1 = Math.max(ln.x1, it.x1); ln.top = Math.min(ln.top, it.top); ln.bottom = Math.max(ln.bottom, it.bottom); }
      else lines.push({ side, ...it });
    }
    const block = (startRe, endRe, side) => {
      const a = lines.findIndex(l => l.side === side && startRe.test(l.s));
      if (a < 0) return null;
      const rest = lines.slice(a).filter(l => l.side === side);
      const b = rest.findIndex(l => endRe.test(l.s));
      if (b < 0 || b > 10) return null;
      return rest.slice(0, b + 1);
    };
    const shop = block(/^Craig's Leaside Automotive/i, /^https?:\/\//i, 'L');
    const info = block(/^(Invoice for |Estimate for )?RO #/i, /^Vehicle:/i, 'R');
    if (!shop || !info) return null;
    const bbox = ls => ({ x0: Math.min(...ls.map(l => l.x0)), x1: Math.max(...ls.map(l => l.x1)), top: Math.min(...ls.map(l => l.top)), bottom: Math.max(...ls.map(l => l.bottom)) });
    const first = info[0].s; const kind = /^Invoice/i.test(first) ? 'invoice' : /^Estimate/i.test(first) ? 'estimate' : 'workorder';
    return { kind, width: vp.width, height: vp.height, shop: bbox(shop), info: info.map(l => ({ x0: l.x0, x1: l.x1, top: l.top, bottom: l.bottom })), infoBox: bbox(info) };
  } finally { doc.destroy(); }
}

async function stampPdf(bytes, opts = {}) {
  const { flipHeader = true, watermark = true, logoPng, watermarkPng, opacity = 0.045 } = opts;
  const pdf = await PDFDocument.load(bytes);
  const pages = pdf.getPages();
  let headerFlipped = false, docKind = null;

  if (watermark && watermarkPng) {
    const wm = await pdf.embedPng(watermarkPng);
    for (const p of pages) {
      const { width, height } = p.getSize();
      const w = Math.min(width * 0.62, 460), h = w * wm.height / wm.width;
      // drawn on top at very low opacity (Chrome PDFs paint opaque backgrounds, so "behind" would be hidden)
      p.drawImage(wm, { x: (width - w) / 2, y: (height - h) / 2 - 20, width: w, height: h, opacity });
    }
  }

  if (flipHeader && logoPng && pages.length) {
    let hd = null;
    try { hd = await findHeader(bytes); } catch (e) { hd = null; }
    if (hd) docKind = hd.kind;
    if (hd && (!opts.kinds || opts.kinds.includes(hd.kind))) {
      const page = pages[0];
      const H = t => hd.height - t;           // top-down -> pdf y
      const margin = 36, right = hd.width - 36;
      const srcDoc = await PDFDocument.load(bytes); // pristine copy so copied regions exclude the watermark
      const src = srcDoc.getPages()[0];
      const emb = (x0, x1, top, bottom) => pdf.embedPage(src, { left: x0, right: x1, bottom: H(bottom), top: H(top) });
      const ro = [];
      for (const l of hd.info) ro.push({ l, e: await emb(l.x0 - 1, l.x1 + 1, l.top - 0.5, l.bottom + 0.5) });
      const s = hd.shop;
      const shop = await emb(s.x0 - 1, s.x1 + 1, s.top - 0.5, s.bottom + 0.5);
      const logo = await pdf.embedPng(logoPng);

      const bandTop = Math.min(s.top, hd.infoBox.top) - 12, bandBottom = Math.max(s.bottom, hd.infoBox.bottom) + 0.5;
      page.drawRectangle({ x: margin - 6, y: H(bandBottom), width: right - margin + 12, height: bandBottom - bandTop, color: rgb(1, 1, 1) });

      // RO / doc info block, left-aligned at the margin
      for (const r of ro) page.drawPage(r.e, { x: margin - 1, y: H(r.l.bottom + 0.5) });
      // New logo far right, shop text block to its left
      const lh = Math.min(56, bandBottom - bandTop - 4), lw = lh * logo.width / logo.height;
      const lx = right - lw;
      page.drawImage(logo, { x: lx, y: H(bandTop + 6 + lh), width: lw, height: lh });
      const sw = s.x1 - s.x0 + 2;
      page.drawPage(shop, { x: lx - 10 - sw, y: H(s.bottom + 0.5) });
      headerFlipped = true;
    }
  }
  const out = await pdf.save();
  out.headerFlipped = headerFlipped; out.docKind = docKind;
  return out;
}
module.exports = { stampPdf, findHeader };
