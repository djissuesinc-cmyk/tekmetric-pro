// v2.3.9: PDF stamp off the main thread. Long-lived; caches PNG bytes so each print
// does not re-decode logo-watermark.png / logo.png.
const { parentPort } = require('worker_threads');
const fs = require('fs');
const { stampPdf, findHeader, detectKind } = require('./pdf-stamp');

const pngCache = new Map();
function png(filePath) {
    if (!filePath) return null;
    if (pngCache.has(filePath)) return pngCache.get(filePath);
    const b = fs.readFileSync(filePath);
    pngCache.set(filePath, b);
    return b;
}

function resolveOpts(opts) {
    const o = Object.assign({}, opts || {});
    if (o.logoPath) { o.logoPng = png(o.logoPath); delete o.logoPath; }
    if (o.watermarkPath) { o.watermarkPng = png(o.watermarkPath); delete o.watermarkPath; }
    return o;
}

const fns = {
    ping: () => 'ok',
    findHeader: (b) => findHeader(b),
    detectKind: (b, header, urlKind) => detectKind(b, header, urlKind),
    stampPdf: async (b, opts) => {
        const out = await stampPdf(b, resolveOpts(opts));
        return { bytes: out, headerFlipped: out.headerFlipped, docKind: out.docKind };
    },
    // One round-trip: findHeader + detectKind + stamp (no second PDF clone, no re-scan for flip)
    stampJob: async (b, job) => {
        const j = job || {};
        let header = null;
        try { header = await findHeader(b); } catch (e) { header = null; }
        const kind = await detectKind(b, header, j.urlKind || null);
        const flip = !!j.flipHeader && !!header && kind !== 'workorder' && kind !== 'inspection';
        const wm = !!j.watermark && (kind === 'invoice' || kind === 'inspection' || !!j.forceWm);
        if (!flip && !wm) {
            return { bytes: null, headerFlipped: false, docKind: kind, header, skipped: true };
        }
        const out = await stampPdf(b, resolveOpts({
            flipHeader: flip, watermark: wm, opacity: j.opacity || 0.045,
            logoPath: j.logoPath, watermarkPath: j.watermarkPath,
            logoPng: j.logoPng, watermarkPng: j.watermarkPng,
            header // avoid a second findHeader inside stampPdf
        }));
        return { bytes: out, headerFlipped: out.headerFlipped, docKind: kind || out.docKind, header, skipped: false };
    }
};

parentPort.on('message', async ({ id, fn, args }) => {
    try { parentPort.postMessage({ id, ok: true, result: await fns[fn](...(args || [])) }); }
    catch (e) { parentPort.postMessage({ id, ok: false, error: String(e && e.stack || e) }); }
});
