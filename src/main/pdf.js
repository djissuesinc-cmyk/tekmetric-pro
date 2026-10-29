const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const textUtil = require('../shared/text');

const RED = rgb(225 / 255, 6 / 255, 19 / 255);
const INK = rgb(28 / 255, 29 / 255, 31 / 255);
const MUTED = rgb(94 / 255, 97 / 255, 102 / 255);
const WHITE = rgb(1, 1, 1);
const RULE = rgb(228 / 255, 226 / 255, 222 / 255);

function statusLabel(status) {
  return {
    estimate: 'Estimate',
    'in-progress': 'In progress',
    'waiting-parts': 'Waiting on parts',
    ready: 'Ready',
    closed: 'Closed',
  }[status] || status;
}

function wrap(text, font, size, maxWidth) {
  const clean = textUtil.sanitizeWinAnsi(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const words = clean.split(' ');
  const lines = [];
  let line = '';
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    const next = line ? line + ' ' + word : word;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    if (font.widthOfTextAtSize(word, size) <= maxWidth) {
      line = word;
      continue;
    }
    let chunk = '';
    for (const ch of word) {
      if (font.widthOfTextAtSize(chunk + ch, size) > maxWidth && chunk) {
        lines.push(chunk);
        chunk = ch;
      } else {
        chunk += ch;
      }
    }
    line = chunk;
  }
  if (line) lines.push(line);
  return lines;
}

async function buildWorkOrderPdf(repair, settings) {
  if (!repair || !repair.customer || !repair.number) {
    throw new Error('Repair order is incomplete.');
  }
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage([612, 792]);
  let y = 792;

  function footer() {
    const label = textUtil.sanitizeWinAnsi(
      (settings.shopName || "Craig's Leaside Automotive") + '  ·  Prepared locally  ·  Not a Tekmetric invoice'
    );
    page.drawText(label, { x: 40, y: 32, size: 8, font: font, color: MUTED });
  }

  function newPage() {
    page = doc.addPage([612, 792]);
    y = 750;
    footer();
  }

  function ensure(height) {
    if (y - height < 58) newPage();
  }

  function text(value, x, size, face, color) {
    const clean = textUtil.sanitizeWinAnsi(value);
    if (!clean) return;
    page.drawText(clean, { x: x, y: y, size: size, font: face, color: color || INK });
  }

  function paragraph(value, size, face, color, gap) {
    const lines = wrap(value, face, size, 532);
    if (!lines.length) return;
    ensure(lines.length * (size + 3) + (gap || 0));
    for (let i = 0; i < lines.length; i += 1) {
      text(lines[i], 40, size, face, color);
      y -= size + 3;
    }
    y -= gap || 0;
  }

  page.drawRectangle({ x: 0, y: 724, width: 612, height: 68, color: RED });
  y = 768;
  text(settings.shopName || "Craig's Leaside Automotive", 40, 16, bold, WHITE);
  y = 748;
  const contact = [settings.address, settings.city, settings.phone, settings.email].filter(Boolean).join('  ·  ');
  text(contact || 'Leaside, Toronto', 40, 9, font, WHITE);
  y = 700;
  text('WORK ORDER  ' + repair.number, 40, 18, bold, INK);
  y = 678;
  text(statusLabel(repair.status) + '   ·   ' + (repair.updatedAt || '').slice(0, 10), 40, 10, font, MUTED);
  y = 654;
  page.drawRectangle({ x: 40, y: y, width: 532, height: 1, color: RULE });
  y -= 22;

  const facts = [
    ['Customer', repair.customer],
    ['Phone', repair.phone || '—'],
    ['Vehicle', repair.vehicle],
    ['Plate', repair.plate || '—'],
    ['VIN', repair.vin || '—'],
    ['Odometer', repair.mileage == null ? '-' : String(repair.mileage).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + ' km'],
  ];
  for (let i = 0; i < facts.length; i += 2) {
    ensure(28);
    text(facts[i][0].toUpperCase(), 40, 8, bold, MUTED);
    text(facts[i + 1] ? facts[i + 1][0].toUpperCase() : '', 310, 8, bold, MUTED);
    y -= 14;
    text(facts[i][1], 40, 11, font, INK);
    text(facts[i + 1] ? facts[i + 1][1] : '', 310, 11, font, INK);
    y -= 20;
  }

  y -= 6;
  text('CONCERN', 40, 8, bold, MUTED);
  y -= 16;
  paragraph(repair.concern, 11, font, INK, 12);

  text('ADVISOR NOTE', 40, 8, bold, MUTED);
  y -= 16;
  paragraph(repair.advisorComment || 'No advisor note yet.', 11, font, INK, 14);

  ensure(24);
  text('LINES', 40, 8, bold, MUTED);
  y -= 8;
  page.drawRectangle({ x: 40, y: y, width: 532, height: 1, color: RULE });
  y -= 16;

  const items = Array.isArray(repair.lineItems) ? repair.lineItems : [];
  let grand = 0;
  if (!items.length) {
    paragraph('No line items yet.', 11, font, MUTED, 8);
  }
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    const total = textUtil.lineTotalCents(item.qtyHundredths, item.unitCents);
    grand += total;
    const row = wrap(item.description, font, 11, 300);
    ensure(Math.max(18, row.length * 14) + 6);
    const rowTop = y;
    for (let line = 0; line < row.length; line += 1) {
      text(row[line], 40, 11, font, INK);
      y -= 14;
    }
    const qty = textUtil.hundredthsToInput(item.qtyHundredths);
    const price = textUtil.formatMoney(item.unitCents);
    const amount = textUtil.formatMoney(total);
    page.drawText(textUtil.sanitizeWinAnsi(qty), {
      x: 360,
      y: rowTop,
      size: 11,
      font: font,
      color: INK,
    });
    page.drawText(textUtil.sanitizeWinAnsi(price), {
      x: 410,
      y: rowTop,
      size: 11,
      font: font,
      color: INK,
    });
    page.drawText(textUtil.sanitizeWinAnsi(amount), {
      x: 490,
      y: rowTop,
      size: 11,
      font: bold,
      color: INK,
    });
    y -= 6;
  }

  ensure(36);
  page.drawRectangle({ x: 40, y: y, width: 532, height: 1, color: RULE });
  y -= 22;
  text('TOTAL', 400, 12, bold, INK);
  page.drawText(textUtil.sanitizeWinAnsi(textUtil.formatMoney(grand)), {
    x: 470,
    y: y,
    size: 12,
    font: bold,
    color: RED,
  });

  footer();
  const bytes = await doc.save();
  return Buffer.from(bytes);
}

module.exports = {
  buildWorkOrderPdf,
  statusLabel,
};
