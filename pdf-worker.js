// v2.3.8: runs the heavy PDF work (pdfjs text scan + pdf-lib stamping/PNG decode) off the Electron
// main thread so the app doesn't freeze while a document is being stamped.
const { parentPort } = require('worker_threads');
const { stampPdf, findHeader, detectKind } = require('./pdf-stamp');
const fns = {
    findHeader: (b) => findHeader(b),
    detectKind: (b, header, urlKind) => detectKind(b, header, urlKind),
    stampPdf: async (b, opts) => { const out = await stampPdf(b, opts); return { bytes: out, headerFlipped: out.headerFlipped, docKind: out.docKind }; }
};
parentPort.on('message', async ({ id, fn, args }) => {
    try { parentPort.postMessage({ id, ok: true, result: await fns[fn](...args) }); }
    catch (e) { parentPort.postMessage({ id, ok: false, error: String(e && e.stack || e) }); }
});
