// v2.3.9: long-lived PDF worker. Prewarmed at startup; PNG paths resolved inside the worker
// (cached there). Falls back to in-process if the worker can't start.
const path = require('path');
const { Worker } = require('worker_threads');
const direct = require('./pdf-stamp');
let worker = null, seq = 0, starting = null;
const pending = new Map();

function attach(w) {
    w.on('message', ({ id, ok, result, error }) => {
        const p = pending.get(id); if (!p) return; pending.delete(id);
        ok ? p.resolve(result) : p.reject(new Error(error));
    });
    const fail = (e) => {
        for (const p of pending.values()) p.reject(e instanceof Error ? e : new Error(String(e)));
        pending.clear();
        worker = null;
    };
    w.on('error', fail);
    w.on('exit', (c) => { if (pending.size) fail(new Error('pdf worker exited ' + c)); worker = null; });
}

function getWorker() {
    if (worker) return worker;
    try {
        worker = new Worker(path.join(__dirname, 'pdf-worker.js'));
        attach(worker);
    } catch (e) { worker = null; }
    return worker;
}

function call(fn, ...args) {
    const w = getWorker();
    if (!w) return null;
    return new Promise((resolve, reject) => {
        const id = ++seq;
        pending.set(id, { resolve, reject });
        w.postMessage({ id, fn, args });
    });
}

async function run(fn, args, local) {
    const p = call(fn, ...args);
    if (p) { try { return await p; } catch (e) { /* fall back */ } }
    return local();
}

const toU8 = (b) => (b instanceof Uint8Array && !(b instanceof Buffer)) ? b : new Uint8Array(b);

function prewarm() {
    try {
        const w = getWorker();
        if (w) call('ping').catch(() => {});
    } catch (e) {}
}

module.exports = {
    prewarm,
    findHeader: (b) => run('findHeader', [toU8(b)], () => direct.findHeader(b)),
    detectKind: (b, h, k) => run('detectKind', [toU8(b), h, k], () => direct.detectKind(b, h, k)),
    stampPdf: async (b, opts) => {
        const r = await run('stampPdf', [toU8(b), opts], async () => {
            const o = await direct.stampPdf(b, opts);
            return { bytes: o, headerFlipped: o.headerFlipped, docKind: o.docKind };
        });
        const out = Buffer.from(r.bytes); out.headerFlipped = r.headerFlipped; out.docKind = r.docKind; return out;
    },
    stampJob: async (b, job) => {
        const r = await run('stampJob', [toU8(b), job], async () => {
            const header = await direct.findHeader(b).catch(() => null);
            const kind = await direct.detectKind(b, header, job && job.urlKind || null);
            const flip = !!(job && job.flipHeader) && !!header && kind !== 'workorder' && kind !== 'inspection';
            const wm = !!(job && job.watermark) && (kind === 'invoice' || kind === 'inspection' || !!(job && job.forceWm));
            if (!flip && !wm) return { bytes: null, headerFlipped: false, docKind: kind, header, skipped: true };
            const opts = {
                flipHeader: flip, watermark: wm, opacity: (job && job.opacity) || 0.045,
                logoPng: job.logoPng, watermarkPng: job.watermarkPng, header
            };
            if (job.logoPath && !opts.logoPng) opts.logoPng = require('fs').readFileSync(job.logoPath);
            if (job.watermarkPath && !opts.watermarkPng) opts.watermarkPng = require('fs').readFileSync(job.watermarkPath);
            const o = await direct.stampPdf(b, opts);
            return { bytes: o, headerFlipped: o.headerFlipped, docKind: kind || o.docKind, header, skipped: false };
        });
        if (r && r.bytes) r.bytes = Buffer.from(r.bytes);
        return r;
    }
};
