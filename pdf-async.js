// v2.3.8: promise wrapper around pdf-worker.js. Falls back to running in-process if the worker can't start.
const path = require('path');
const { Worker } = require('worker_threads');
const direct = require('./pdf-stamp');
let worker = null, seq = 0;
const pending = new Map();
function getWorker() {
    if (worker) return worker;
    try {
        // asar-safe: worker file is unpacked or read from the archive by Electron's node
        worker = new Worker(path.join(__dirname, 'pdf-worker.js'));
        worker.on('message', ({ id, ok, result, error }) => {
            const p = pending.get(id); if (!p) return; pending.delete(id);
            if (!pending.size) worker.unref();
            ok ? p.resolve(result) : p.reject(new Error(error));
        });
        const fail = (e) => { for (const p of pending.values()) p.reject(e); pending.clear(); worker = null; };
        worker.on('error', fail);
        worker.on('exit', (c) => { if (c !== 0) fail(new Error('pdf worker exited ' + c)); worker = null; });
        worker.unref();
    } catch (e) { worker = null; }
    return worker;
}
function call(fn, ...args) {
    const w = getWorker();
    if (!w) return null;
    return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); w.ref(); w.postMessage({ id, fn, args }); });
}
async function run(fn, args, local) {
    const p = call(fn, ...args);
    if (p) { try { return await p; } catch (e) { /* worker problem: fall back to in-process */ } }
    return local();
}
const toU8 = (b) => new Uint8Array(b);
module.exports = {
    findHeader: (b) => run('findHeader', [toU8(b)], () => direct.findHeader(b)),
    detectKind: (b, h, k) => run('detectKind', [toU8(b), h, k], () => direct.detectKind(b, h, k)),
    stampPdf: async (b, opts) => {
        const r = await run('stampPdf', [toU8(b), opts], async () => { const o = await direct.stampPdf(b, opts); return { bytes: o, headerFlipped: o.headerFlipped, docKind: o.docKind }; });
        const out = Buffer.from(r.bytes); out.headerFlipped = r.headerFlipped; out.docKind = r.docKind; return out;
    }
};
