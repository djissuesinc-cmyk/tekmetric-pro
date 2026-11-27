const { app, BrowserWindow, Menu, dialog, ipcMain, protocol, net, session, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const { createAiClient } = require('./ai-request');
const { captureSrc, applySrc } = require('./ai-insert');
const { resolvePrinter, printerMenuModel } = require('./printer-pick');
const { aboutHtml } = require('./about-info');
const { bugReportDialogHtml, defaultBugReportRange, createBugReport } = require('./bug-report');
const { resetPrintSpooler } = require('./spooler-reset');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const url = require('url');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const { stampPdf, findHeader, detectKind, stampJob, prewarm: prewarmPdfWorker } = require('./pdf-async'); // v2.3.9: long-lived worker + combined stampJob
const { brandCss, brandHeader, signboardCss, signboardHeader } = require('./brand');
const { settingsEditorHtml } = require('./settings-html');
const { kindFromUrl, DOC_RE, installDocumentInterceptor } = require('./doc-intercept');
const { createDocumentPdfStamper } = require('./doc-stamp-window');
const os = require('os');
// Bulletproof startup marker: written synchronously on 'ready' to every candidate folder
app.on('ready', () => {
    const line = new Date().toISOString() + ' === STARTUP Tekmetric Pro v' + app.getVersion() + ' exe=' + (process.env.PORTABLE_EXECUTABLE_FILE || process.execPath) + '\n';
    const dirs = [];
    try { dirs.push(app.getPath('userData')); } catch (e) {}
    try { dirs.push(os.tmpdir()); } catch (e) {}
    if (process.env.PORTABLE_EXECUTABLE_DIR) dirs.push(process.env.PORTABLE_EXECUTABLE_DIR);
    for (const d of dirs) {
        try { fs.mkdirSync(d, { recursive: true }); fs.appendFileSync(path.join(d, d === dirs[0] ? 'pdf-stamp.log' : 'tekmetric-pro-pdf-stamp.log'), line); } catch (e) {}
    }
});
const PDF_HOOK_SRC = require('./pdf-hook');

// Network & Anti-Bot Cloaking
app.commandLine.appendSwitch('disable-quic');
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');

process.on('uncaughtException', (err) => {
    const e = err instanceof Error ? err : new Error(String(err));
    let logPath = '(log could not be written)';
    try {
        logPath = path.join(app.getPath('desktop'), 'tekmetric-error.log');
        fs.writeFileSync(logPath, e.toString() + "\n" + e.stack);
    } catch (logErr) { console.error('Failed to write error log:', logErr); }
    try {
        dialog.showErrorBox("Fatal Application Error", "The application encountered an error and generated a log file on your Desktop:\n" + logPath + "\n\nError: " + e.message);
    } catch (dlgErr) { console.error(e); }
});

process.on('unhandledRejection', (reason) => { console.error('Unhandled promise rejection:', reason); try { pdfLog('unhandledRejection: ' + (reason && reason.stack || reason)); } catch (e) {} });

function escapeHtml(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Safe to drop inside a <script> block (keeps quotes/backslashes in paths and text intact)
function jsLiteral(value) {
    return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function isAlive(w) { return !!(w && !w.isDestroyed()); }

const logoDataUrlCache = new Map();
function logoDataUrl(name = 'logo.png') {
    if (logoDataUrlCache.has(name)) return logoDataUrlCache.get(name);
    try {
        const v = 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, name)).toString('base64');
        logoDataUrlCache.set(name, v);
        return v;
    } catch (e) { return 'local-resource://' + name; }
}

require('dotenv').config({ path: path.join(__dirname, '.env') });

const userDataPath = app.getPath('userData');
const settingsPath = path.join(userDataPath, 'settings.json');
const usersPath = path.join(userDataPath, 'users.json');

if (!fs.existsSync(userDataPath)) fs.mkdirSync(userDataPath, { recursive: true });
if (!fs.existsSync(usersPath)) {
    fs.writeFileSync(usersPath, JSON.stringify([{ name: "Admin", email: "admin@leaside.com", pass: "password123" }], null, 2));
}

function purgeTempFiles() {
    const tempDir = app.getPath('temp');
    try {
        const files = fs.readdirSync(tempDir);
        files.forEach(file => {
            if (file.startsWith('Leaside_RO_') && file.endsWith('.pdf')) {
                fs.unlinkSync(path.join(tempDir, file));
            }
        });
    } catch (err) {
        console.error("Cleanup error:", err);
    }
}

function loadSettings() {
    const defaultPresets = [
        "LOF, 30 POINT INSPECTION + BRAKE INSPECTION",
        "30 POINT INSPECTION",
        "TIRE ROTATION WITH SERVICE",
        "TIRE REPAIR",
        "SEASONAL TIRE CHANGE",
        "TIRE STORAGE",
        "SAFETY",
        "Alignment",
        "Krown Rust Proofing",
        "Krown Detailing",
        "Level 1 Scan (Document and Clear Codes)",
        "Level 2 / 3 Scan (Documents Codes, In-depth Diagnostics and trouble shooting + Clearing Codes)",
        "A.V.R. (Diagnostics and trouble shooting)"
    ];

    try {
        if (!fs.existsSync(settingsPath)) {
            fs.writeFileSync(settingsPath, JSON.stringify({ darkMode: false, autoCaps: true, hidePremium: true, showSidebar: true, invoiceLogoRight: true, workOrderWatermark: false, apiKey: '', presets: defaultPresets, presetsMigrated: true }, null, 2));
        }
        const s = JSON.parse(fs.readFileSync(settingsPath));
        if (s.autoCaps === undefined) s.autoCaps = true;
        if (s.hidePremium === undefined) s.hidePremium = true;
        if (s.showSidebar === undefined) s.showSidebar = true;
        if (s.invoiceLogoRight === undefined) s.invoiceLogoRight = true;
        if (s.workOrderWatermark === undefined) s.workOrderWatermark = false;
        
        // One-time upgrade of the old short preset list. After that a shorter list saved
        // in the presets editor is kept instead of being reset on every launch.
        if (!s.presets || !Array.isArray(s.presets) || (!s.presetsMigrated && s.presets.length <= 7)) {
            s.presets = defaultPresets;
            s.presetsMigrated = true;
            fs.writeFileSync(settingsPath, JSON.stringify(s, null, 2));
        } else if (!s.presetsMigrated) {
            s.presetsMigrated = true;
            fs.writeFileSync(settingsPath, JSON.stringify(s, null, 2));
        }
        return s;
    } catch (e) {
        return { darkMode: false, autoCaps: true, hidePremium: true, showSidebar: true, invoiceLogoRight: true, workOrderWatermark: false, apiKey: '', presets: defaultPresets };
    }
}

ipcMain.on('get-settings', (event) => {
    event.returnValue = loadSettings();
});

// The Tekmetric page replaces the window title, so track the shop windows directly.
const shopWindows = new Set();

function getMainWin() {
    const shop = Array.from(shopWindows).filter(isAlive);
    const focused = BrowserWindow.getFocusedWindow();
    if (focused && shop.includes(focused)) return focused;
    if (shop.length) return shop[0];
    const wins = BrowserWindow.getAllWindows().filter(w => !w.__tekproSpare);
    return wins.find(w => w.title && w.title.includes("Tekmetric Pro")) || wins[0] || null;
}

const globalCSS = `
    #shop-logo-fixed { pointer-events: none !important; display: none !important; }
    [data-testid="toggle-app-sidebar-menu"] { display: none !important; }
    
    ::-webkit-scrollbar { width: 8px; height: 8px; }
    ::-webkit-scrollbar-track { background: transparent !important; }
    ::-webkit-scrollbar-thumb { background: rgba(150,150,150,0.5) !important; border-radius: 4px; }
    ::-webkit-scrollbar-thumb:hover { background: rgba(150,150,150,0.8) !important; }
    
    ::selection { background: rgba(211, 47, 47, 0.25); }
    
    @media print {
        html, body { background-color: #ffffff !important; }
        header, nav, .MuiAppBar-root, .MuiDrawer-root, button { display: none !important; }
    }
`;

// Mouse back/forward buttons + Alt+Left/Alt+Right on shop windows
function navGo(wc, dir) {
    if (!wc || wc.isDestroyed()) return;
    const h = wc.navigationHistory;
    if (dir === 'back') { if (h ? h.canGoBack() : wc.canGoBack()) (h ? h.goBack() : wc.goBack()); }
    else { if (h ? h.canGoForward() : wc.canGoForward()) (h ? h.goForward() : wc.goForward()); }
}
function attachNavControls(win) {
    if (!win || win.isDestroyed()) return;
    win.on('app-command', (e, cmd) => {
        if (cmd === 'browser-backward') navGo(win.webContents, 'back');
        else if (cmd === 'browser-forward') navGo(win.webContents, 'forward');
    });
    win.webContents.on('before-input-event', (event, input) => {
        if (input.type !== 'keyDown' || !input.alt || input.control || input.meta || input.shift) return;
        if (input.key === 'ArrowLeft') { event.preventDefault(); navGo(win.webContents, 'back'); }
        else if (input.key === 'ArrowRight') { event.preventDefault(); navGo(win.webContents, 'forward'); }
    });
}
let lastMouseNav = 0;
ipcMain.on('mouse-nav', (event, dir) => {
    // Fallback for systems where app-command isn't fired; debounce in case both fire
    const now = Date.now(); if (now - lastMouseNav < 250) return; lastMouseNav = now;
    navGo(event.sender, dir === 'forward' ? 'forward' : 'back');
});

function createWindow(targetUrl = 'https://shop.tekmetric.com/') {
    const win = new BrowserWindow({
        width: 1400, height: 900,
        show: false,
        title: 'Tekmetric Pro v' + app.getVersion() + " - Craig's Leaside Automotive",
        icon: path.join(__dirname, 'logo.png'), 
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            partition: 'persist:tekmetric_session',
            contextIsolation: true,
            webSecurity: false,
            spellcheck: true 
        }
    });

    win.once('ready-to-show', () => {
        win.maximize();
        win.show();
    });

    win.loadURL(targetUrl).catch(() => {});

    shopWindows.add(win);
    // Keep the build version visible in the title bar (Tekmetric sets its own page titles)
    win.on('page-title-updated', (e, t) => {
        e.preventDefault();
        try { win.setTitle('Tekmetric Pro v' + app.getVersion() + (t ? ' - ' + t : '') + (win._aiBusy ? AI_BUSY_SUFFIX : '')); } catch (err) {}
    });
    attachNavControls(win);
    try { instrumentPdfWindow(win, 'main', null); } catch (e) { pdfLog('instrument main failed: ' + e.message); }
    win.on('closed', () => { shopWindows.delete(win); if (!shopWindowOpen()) closeSparePdfWin(); });

    win.webContents.on('did-finish-load', () => {
        win.webContents.insertCSS(globalCSS).catch(() => {});
        // Re-apply the saved dark mode preference after every page load
        applyDarkMode(win, !!loadSettings().darkMode);
    });

    win.webContents.on('context-menu', (event, params) => {
        const menuTemplate = [];
        if (params.dictionarySuggestions && params.dictionarySuggestions.length > 0) {
            params.dictionarySuggestions.forEach(suggestion => {
                menuTemplate.push({ label: suggestion, click: () => win.webContents.replaceMisspelling(suggestion) });
            });
            menuTemplate.push({ type: 'separator' });
        }
        
        if (params.misspelledWord) {
            menuTemplate.push({
                label: `Add "${params.misspelledWord}" to Dictionary`,
                click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord)
            });
            menuTemplate.push({ type: 'separator' });
        }

        if (params.selectionText) {
            menuTemplate.push({
                label: '✨ AI: Fix Spelling & Grammar',
                click: () => runAiMenuAction(win, params.selectionText, runGeminiSpellCheck, 'spell')
            });
            menuTemplate.push({
                label: '✨ AI: Make Professional',
                click: () => runAiMenuAction(win, params.selectionText, runGemini, 'pro')
            });
        }
        
        menuTemplate.push({ type: 'separator' });
        menuTemplate.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' });
        Menu.buildFromTemplate(menuTemplate).popup(win);
    });

    win.webContents.setWindowOpenHandler(({ url, frameName, features, disposition }) => {
        pdfLog('window.open url=' + url + ' frameName=' + frameName + ' features=' + features + ' disposition=' + disposition);
        if (url.startsWith('blob:') || url.match(/\.pdf$/i) || url.includes('/print') || url.includes('/download')) {
            // Tekmetric opens its print PDF as a blob: URL. The preload window.open override runs in the
            // isolated world and never sees the page's call, so grab the bytes here (from the page's own
            // world, where the blob lives) and send them down the same modify-pdf-blob print path.
            if (url.startsWith('blob:')) { pdfLog('window.open blob: ' + url); captureBlobPdf(win, url); }
            return { action: 'deny' }; 
        }
        return { 
            action: 'allow', 
            overrideBrowserWindowOptions: {
                icon: path.join(__dirname, 'logo.png'),
                webPreferences: { preload: path.join(__dirname, 'preload.js'), partition: 'persist:tekmetric_session' }
            }
        };
    });

    win.webContents.on('did-create-window', (childWindow, details) => {
        pdfLog('did-create-window url=' + (details && details.url) + ' frameName=' + (details && details.frameName));
        try { instrumentPdfWindow(childWindow, 'child', win); } catch (e) { pdfLog('instrument child failed: ' + e.message); }
        childWindow.maximize();
        attachNavControls(childWindow);
        watchChildForPdf(win, childWindow);
        // v2.3.7: log what popups (e.g. Nexpart / PartsTech) actually load, to diagnose blank windows
        const cwc = childWindow.webContents;
        cwc.on('did-navigate', (e, u, code) => pdfLog('child navigated ' + code + ' ' + u));
        cwc.on('did-fail-load', (e, code, desc, u, main) => { if (main) pdfLog('child load FAILED ' + code + ' ' + desc + ' ' + u); });
        cwc.on('render-process-gone', (e, d) => pdfLog('child renderer gone: ' + (d && d.reason)));
    });

    return win;
}

// v2.3.9: only PDF/print windows need hook injection + frame scanning. Parts punchouts
// (Nexpart / PartsTech) leave about:blank for an external host — stop watching them.
function isPdfWatchUrl(u) {
    if (!u || u === 'about:blank') return true;
    if (/^blob:/i.test(u)) return true;
    if (/tekmetric\.com/i.test(u)) return true;
    return false;
}

// Tekmetric prints by opening about:blank and then pointing it at a blob: PDF (or writing an
// <embed>/<iframe> with the blob into it). Catch that, stamp the bytes and show our print pop-up.
function watchChildForPdf(opener, child) {
    if (!child || child.isDestroyed()) return;
    const wc = child.webContents;
    let done = false;
    const grab = (blobUrl, how) => {
        if (done || !blobUrl || !blobUrl.startsWith('blob:')) return false;
        done = true;
        pdfLog('child window ' + how + ': ' + blobUrl);
        captureBlobPdf(opener, blobUrl, () => { if (!child.isDestroyed()) child.close(); });
        return true;
    };
    wc.on('will-navigate', (e, u) => { if (grab(u, 'will-navigate')) e.preventDefault(); });
    wc.on('did-start-navigation', (details, u) => {
        const target = typeof details === 'object' && details && details.url ? details.url : u;
        grab(target, 'did-start-navigation');
    });
    // Poll the about:blank document briefly for an embed/iframe/object with a blob src
    let tries = 0;
    const poll = setInterval(() => {
        if (done || child.isDestroyed() || ++tries > 100) { clearInterval(poll); return; }
        const cur = wc.getURL();
        if (!isPdfWatchUrl(cur)) { clearInterval(poll); return; } // parts punchout — leave alone
        if (cur.startsWith('blob:')) { grab(cur, 'loaded'); return; }
        wc.executeJavaScript("(() => { const el = document.querySelector('embed[src^=\"blob:\"],iframe[src^=\"blob:\"],object[data^=\"blob:\"]'); return el ? (el.src || el.data) : ''; })()")
            .then(src => { if (src) grab(src, 'embedded'); }).catch(() => {});
    }, 100);
    child.on('closed', () => clearInterval(poll));
}

function pdfLogPath() { return path.join(app.getPath('userData'), 'pdf-stamp.log'); }
// v2.3.9: coalesce log lines so parts-popup subframe noise does not sync-write on every request
let _pdfLogBuf = '';
let _pdfLogTimer = null;
function pdfLogFlush() {
    _pdfLogTimer = null;
    const chunk = _pdfLogBuf; _pdfLogBuf = '';
    if (!chunk) return;
    try {
        fs.mkdirSync(app.getPath('userData'), { recursive: true });
        const p = pdfLogPath();
        try { if (fs.statSync(p).size > 5 * 1024 * 1024) fs.renameSync(p, p + '.old'); } catch (e) {}
        fs.appendFileSync(p, chunk);
    } catch (e) {
        try { fs.appendFileSync(path.join(os.tmpdir(), 'tekmetric-pro-pdf-stamp.log'), chunk); } catch (e2) {}
    }
    try { if (process.env.PORTABLE_EXECUTABLE_DIR) fs.appendFileSync(path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'tekmetric-pro-pdf-stamp.log'), chunk); } catch (e3) {}
}
function pdfLog(msg) {
    _pdfLogBuf += new Date().toISOString() + ' ' + msg + '\n';
    if (!_pdfLogTimer) _pdfLogTimer = setTimeout(pdfLogFlush, 50);
}

// ---- v2.5.0: printer choice (Shop > Print Settings > Printer), saved per PC ----------------------
let printerCache = { t: 0, list: null };
async function getPrinters(wc, maxAgeMs = 5 * 60 * 1000) {
    if (printerCache.list && Date.now() - printerCache.t < maxAgeMs) return printerCache.list;
    try {
        if (!wc || wc.isDestroyed()) return printerCache.list || [];
        const list = await Promise.race([wc.getPrintersAsync(), new Promise((_, rej) => setTimeout(() => rej(new Error('timed out')), 3000))]);
        printerCache = { t: Date.now(), list: Array.isArray(list) ? list : [] };
    } catch (e) { pdfLog('getPrintersAsync failed: ' + e.message); }
    return printerCache.list || [];
}
// Silent print on webContents wc. Passes the saved printer as deviceName; if it is not installed on this PC
// (or Windows refuses it) the job goes to the default printer instead. Logs the printer used.
async function printSilent(wc, base, tm, done) {
    let pick = { deviceName: undefined, label: 'System default', fellBack: false };
    try {
        const saved = String(loadSettings().printerName || '').trim();
        if (saved) pick = resolvePrinter(saved, await getPrinters(wc));
        if (pick.fellBack) pdfLog(tm.id + ' saved printer "' + pick.missing + '" not found, using System default');
    } catch (e) { pdfLog(tm.id + ' printer lookup failed: ' + e.message); }
    if (!wc || wc.isDestroyed()) return;
    pdfLog(tm.id + ' printer=' + pick.label + (pick.deviceName ? ' (deviceName set)' : ''));
    const opts = pick.deviceName ? Object.assign({}, base, { deviceName: pick.deviceName }) : base;
    wc.print(opts, (success, failureReason) => {
        if (!success && pick.deviceName && !wc.isDestroyed()) {
            pdfLog(tm.id + ' print to "' + pick.label + '" failed (' + failureReason + '), retrying on System default');
            try { wc.print(base, done); return; } catch (e) {}
        }
        done(success, failureReason);
    });
}

// ---- v2.4.8: print timing + faster waits ------------------------------------------------------
// printTimer logs one line per stage ("print#3 stamp +85ms (total 412ms)") so the PDF log shows where
// the time between pressing Print and the printer starting goes.
let printSeq = 0;
function printTimer(kind) {
    const id = kind + '#' + (++printSeq);
    const t0 = Date.now();
    let last = t0;
    return {
        id, t0,
        mark(stage, extra) {
            const n = Date.now();
            pdfLog(id + ' ' + stage + ' +' + (n - last) + 'ms (total ' + (n - t0) + 'ms)' + (extra ? ' ' + extra : ''));
            last = n;
        }
    };
}

// Chrome's PDF viewer reports loadState_ 'success' once the document is up. Poll it instead of always
// sleeping a fixed time. Never waits less than the viewer needs and never longer than before unless the
// viewer says it is still loading: if the viewer can't be probed we fall back to the old fixed delay.
function waitPdfViewerReady(wc, fallbackMs, capMs) {
    return new Promise((resolve) => {
        const started = Date.now();
        let finished = false;
        const done = (how) => { if (finished) return; finished = true; resolve({ how, ms: Date.now() - started }); };
        const probe = async () => {
            if (finished) return;
            if (!wc || wc.isDestroyed()) return done('gone');
            let state = 'unknown';
            try {
                const ext = wc.mainFrame.framesInSubtree.find(f => /^chrome-extension:/.test(f.url || ''));
                if (ext) {
                    state = await ext.executeJavaScript("(() => { const v = document.querySelector('pdf-viewer'); return v && typeof v.loadState_ === 'string' ? v.loadState_ : 'unknown'; })()");
                }
            } catch (e) { state = 'unknown'; }
            if (finished) return;
            const waited = Date.now() - started;
            if (state === 'success') { setTimeout(() => done('viewer-ready'), 100); return; }
            if (waited >= capMs) return done('cap');
            if (waited >= fallbackMs && state !== 'loading') return done('fixed-fallback');
            setTimeout(probe, 60);
        };
        setTimeout(probe, 30);
    });
}

// Hidden live page (Smart Print): ready when images + fonts are loaded and the DOM has been quiet for a
// moment, instead of a flat 1500 ms. minMs/maxMs bound it either way.
const PAGE_SETTLE_JS = (minMs, quietMs, maxMs) => "new Promise((resolve) => {" +
    "const t0 = Date.now(); let last = Date.now(); let n = 0;" +
    "try { new MutationObserver(() => { last = Date.now(); n++; }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true }); } catch (e) {}" +
    "try { document.querySelectorAll('img[loading=\"lazy\"]').forEach(i => { i.loading = 'eager'; }); } catch (e) {}" +
    "const imgsDone = () => (Date.now() - t0) >= 1500 || Array.from(document.images).every(i => i.complete);" +
    "const tick = () => {" +
    "  const now = Date.now();" +
    "  const ready = document.readyState === 'complete' && imgsDone() && (now - last) >= " + quietMs + " && (document.body && document.body.textContent.trim().length > 20);" +
    "  if ((now - t0 >= " + minMs + " && ready) || now - t0 >= " + maxMs + ") {" +
    "    const f = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();" +
    "    f.then(() => requestAnimationFrame(() => resolve({ ms: Date.now() - t0, mutations: n, timedOut: now - t0 >= " + maxMs + " }))).catch(() => resolve({ ms: Date.now() - t0, mutations: n }));" +
    "    return;" +
    "  }" +
    "  setTimeout(tick, 50);" +
    "};" +
    "tick();" +
"})";
async function waitPageSettled(wc, minMs, quietMs, maxMs) {
    try { return await wc.executeJavaScript(PAGE_SETTLE_JS(minMs, quietMs, maxMs)); }
    catch (e) { await new Promise(r => setTimeout(r, maxMs)); return { ms: maxMs, error: String(e && e.message) }; }
}

// One idle hidden window kept ready for the print pop-up, so the next print doesn't pay window +
// renderer start-up. Single use: it is closed after printing and a new one is made afterwards.
// It is flagged so it is never treated as a real window (main window lookup, quit).
let sparePdfWin = null;
function makePdfWin() {
    const w = new BrowserWindow({
        width: 1000,
        height: 900,
        title: 'Leaside Document Output',
        icon: path.join(__dirname, 'logo.png'),
        autoHideMenuBar: true,
        show: false
    });
    w.__tekproSpare = true;
    return w;
}
function shopWindowOpen() { return Array.from(shopWindows).some(isAlive); }
function refillSparePdfWin(delayMs) {
    setTimeout(() => {
        try {
            if (isAlive(sparePdfWin) || !shopWindowOpen()) return;
            sparePdfWin = makePdfWin();
            sparePdfWin.loadURL('about:blank').catch(() => {});
        } catch (e) { pdfLog('spare window failed: ' + (e && e.message)); }
    }, delayMs || 0);
}
function closeSparePdfWin() {
    const w = sparePdfWin; sparePdfWin = null;
    try { if (isAlive(w)) w.destroy(); } catch (e) {}
}
function takePdfWin() {
    const w = sparePdfWin; sparePdfWin = null;
    if (isAlive(w)) { w.__tekproSpare = false; return { win: w, reused: true }; }
    return { win: makePdfWin(), reused: false };
}
// v2.4.2: item-specific "No Faults" wording (preload is sandboxed, so the library lives here)
const inspectionPhrases = require('./inspection-phrases');
function handleInspectionPhrases(req) {
    if (!req) return null;
    if (req.action === 'fill') {
        const out = (req.labels || []).map(l => inspectionPhrases.phraseFor(l));
        out.forEach((r, i) => {
            let msg = 'no-faults fill #' + i + ' label=' + JSON.stringify(req.labels[i] || '') + ' -> ' + (r.rule || 'GENERIC');
            if (!(req.labels[i]) && req.snippets && req.snippets[i]) msg += ' row=' + JSON.stringify(String(req.snippets[i]).slice(0, 160));
            pdfLog(msg);
        });
        return out.map(r => r.text);
    }
    if (req.action === 'clear') return (req.values || []).map(v => inspectionPhrases.isGeneratedPhrase(v));
    if (req.action === 'book') {
        const sentences = inspectionPhrases.RULES.map(r => r.text).concat(inspectionPhrases.LEGACY || []).concat([inspectionPhrases.GENERIC]);
        return { generic: inspectionPhrases.GENERIC, sentences, names: inspectionPhrases.RULES.map(r => r.name) };
    }
    if (req.action === 'log') {
        pdfLog(String(req.message || ''));
        return true;
    }
    return null;
}
ipcMain.handle('inspection-phrases', (event, req) => {
    try { return handleInspectionPhrases(req); }
    catch (e) { pdfLog('inspection-phrases error: ' + (e && e.message)); return null; }
});
ipcMain.on('inspection-phrases', (event, req) => {
    try { event.returnValue = handleInspectionPhrases(req); }
    catch (e) { pdfLog('inspection-phrases error: ' + (e && e.message)); event.returnValue = null; }
});
ipcMain.on('inspection-phrases-log', (event, batch) => {
    (Array.isArray(batch) ? batch : [batch]).forEach(m => pdfLog(String(m || '')));
});
ipcMain.on('get-pdf-hook', (event) => { event.returnValue = PDF_HOOK_SRC; });

// Logging + main-world hook + fallback PDF detector for any window (main or child)
// v2.3.8: if a Tekmetric /document/ invoice or inspection is rendered as an HTML page (not a PDF), the PDF
// stamper never sees it; add the same faint watermark element used for silent prints (no header flip).
function htmlDocWatermark(wc, id) {
    try {
        const u = wc.getURL();
        if (!DOC_RE.test(u)) return;
        const k = kindFromUrl(u);
        if (k !== 'inspection' && k !== 'invoice') return;
        if (!loadSettings().workOrderWatermark) return;
        wc.executeJavaScript("document.contentType").then(ct => {
            pdfLog(id + ' document page kind=' + k + ' contentType=' + ct);
            if (ct !== 'text/html') return; // PDFs are handled by the network stamper
            const w = BrowserWindow.fromWebContents(wc);
            if (w) applyPrintLayout(w, k === 'invoice' ? 'invoice-wm-only' : 'inspection').catch(() => {});
        }).catch(() => {});
    } catch (e) {}
}

function instrumentPdfWindow(win, label, opener) {
    if (!isAlive(win)) return;
    const wc = win.webContents;
    const id = label + '#' + wc.id;
    const inject = () => {
        if (wc.isDestroyed()) return;
        if (!isPdfWatchUrl(wc.getURL())) return; // v2.3.9: never inject PDF hook into Nexpart/PartsTech
        wc.executeJavaScript(PDF_HOOK_SRC).then(r => { if (r === 'installed') pdfLog(id + ' hook injected from main @ ' + wc.getURL()); })
            .catch(e => pdfLog(id + ' hook inject error: ' + (e && e.message)));
    };
    wc.on('console-message', (...args) => {
        const ev = args[0];
        const m = (ev && typeof ev.message === 'string') ? ev.message : args[2];
        if (typeof m === 'string' && m.startsWith('[tekpro-pdf]')) pdfLog(id + ' ' + m);
    });
    wc.on('did-start-navigation', (details, u, isInPlace, isMainFrame) => {
        const url = (details && typeof details === 'object' && details.url) ? details.url : u;
        const main = (details && typeof details === 'object' && 'isMainFrame' in details) ? details.isMainFrame : isMainFrame;
        // v2.3.9: skip noisy subframe logs on external punchout catalogs
        if (!main && !isPdfWatchUrl(wc.getURL())) return;
        if (main || isPdfWatchUrl(url)) pdfLog(id + ' did-start-navigation ' + (main ? 'main' : 'sub') + ' ' + url);
    });
    wc.on('did-navigate', (e, u) => { pdfLog(id + ' did-navigate ' + u); if (isPdfWatchUrl(u)) detect('did-navigate'); });
    wc.on('did-frame-navigate', (e, u, code, status, isMain) => {
        if (typeof u === 'string' && u.startsWith('blob:')) detect('frame-blob');
        else if (!isMain && isPdfWatchUrl(wc.getURL())) pdfLog(id + ' did-frame-navigate ' + u);
    });
    wc.on('dom-ready', inject);
    wc.on('did-finish-load', () => {
        pdfLog(id + ' did-finish-load ' + wc.getURL());
        inject();
        detect('did-finish-load');
        htmlDocWatermark(wc, id);
        applyDocumentPdfStamp(wc).catch((e) => pdfLog(id + ' document stamp apply error: ' + (e && e.message)));
    });
    wc.on('did-fail-load', (e, code, desc, u) => pdfLog(id + ' did-fail-load ' + code + ' ' + desc + ' ' + u));
    wc.on('render-process-gone', (e, d) => pdfLog(id + ' render-process-gone ' + (d && d.reason)));
    inject();

    // Fallback detector: look at every frame for a PDF document or a blob: embed/iframe/object
    const handled = new Set();
    const isChild = !!opener;
    async function detect(why) {
        if (wc.isDestroyed()) return;
        if (!isPdfWatchUrl(wc.getURL())) return; // v2.3.9: parts popup — do not walk frames
        let frames = [];
        try { frames = wc.mainFrame ? wc.mainFrame.framesInSubtree : []; } catch (e) {}
        for (const f of frames) {
            try {
                if (!f || f.isDestroyed && f.isDestroyed()) continue;
                const furl = f.url || '';
                const info = await f.executeJavaScript("(() => { const el = document.querySelector('embed[src^=\"blob:\"],iframe[src^=\"blob:\"],object[data^=\"blob:\"],embed[type=\"application/pdf\"]'); return { ct: document.contentType, href: location.href, el: el ? (el.src || el.data || '') : '' }; })()").catch(() => null);
                let blobUrl = '';
                if (info && info.ct === 'application/pdf' && /^blob:/.test(info.href)) blobUrl = info.href;
                else if (/^blob:/.test(furl)) blobUrl = furl;
                else if (info && /^blob:/.test(info.el)) blobUrl = info.el;
                if (info) pdfLog(id + ' detect(' + why + ') frame ' + furl + ' ct=' + info.ct + (info.el ? ' el=' + info.el : ''));
                if (!blobUrl || handled.has(blobUrl)) continue;
                handled.add(blobUrl);
                pdfLog(id + ' fallback found PDF blob ' + blobUrl);
                const data = await readBlobFrom([f, wc, opener && isAlive(opener) ? opener.webContents : null], blobUrl, id);
                if (!data) { handled.delete(blobUrl); continue; }
                if (recentBlobUrls.has(blobUrl)) { pdfLog(id + ' already handled ' + blobUrl); if (isChild && isAlive(win)) win.close(); continue; }
                recentBlobUrls.set(blobUrl, Date.now());
                const docUrl = opener && isAlive(opener) ? opener.webContents.getURL() : wc.getURL();
                openPdfForPrint(data, { docType: docTypeFromUrl(docUrl) });
                if (isChild && isAlive(win)) win.close();
            } catch (e) { pdfLog(id + ' detect error: ' + (e && e.message)); }
        }
    }
    win.__tekproDetect = detect;
}

// Try each context in turn to read a blob: URL; returns a %PDF Uint8Array or null
async function readBlobFrom(contexts, blobUrl, id) {
    const js = "(async () => { const u = " + JSON.stringify(blobUrl) + "; if (window.__tekproReadBlob) return await window.__tekproReadBlob(u); " +
        "const b = await (await fetch(u)).blob(); const a = new Uint8Array(await b.arrayBuffer()); let s=''; for (let i=0;i<a.length;i+=0x8000) s+=String.fromCharCode.apply(null,a.subarray(i,i+0x8000)); return btoa(s); })()";
    for (const c of contexts) {
        if (!c || (c.isDestroyed && c.isDestroyed())) continue;
        try {
            const b64 = await c.executeJavaScript(js);
            const data = new Uint8Array(Buffer.from(String(b64 || ''), 'base64'));
            if (data.length >= 5 && Buffer.from(data.slice(0, 4)).toString('latin1') === '%PDF') { pdfLog(id + ' read ' + data.length + ' bytes of PDF'); return data; }
            pdfLog(id + ' blob is not a PDF (' + data.length + ' bytes)');
            return null;
        } catch (e) { pdfLog(id + ' read attempt failed: ' + (e && e.message)); }
    }
    return null;
}

ipcMain.on('get-small-logo', (event) => { event.returnValue = logoDataUrl('logo-small.png'); });

const recentBlobUrls = new Map();
ipcMain.on('tekpro-pdf-blob-url', (event, blobUrl, shopData) => {
    const w = BrowserWindow.fromWebContents(event.sender);
    if (!w || typeof blobUrl !== 'string' || !blobUrl.startsWith('blob:')) return;
    const su = event.sender.getURL();
    if (!/tekmetric\.com/i.test(su) && !/^about:blank/.test(su)) { pdfLog('ignored blob from ' + su); return; }
    pdfLog('in-page embed/iframe blob: ' + blobUrl);
    captureBlobPdf(w, blobUrl, null, shopData);
});

async function captureBlobPdf(win, blobUrl, onPdf, shopData) {
    // Dedupe: the same blob can be seen by several hooks
    const now = Date.now();
    for (const [k, t] of recentBlobUrls) if (now - t > 30000) recentBlobUrls.delete(k);
    if (recentBlobUrls.has(blobUrl)) { if (onPdf) onPdf(); return; }
    recentBlobUrls.set(blobUrl, now);
    return captureBlobPdfInner(win, blobUrl, onPdf, shopData);
}

async function captureBlobPdfInner(win, blobUrl, onPdf, shopData) {
    if (!isAlive(win)) return;
    const tRead = Date.now();
    try {
        // Only PDFs go to the print pop-up (readBlobFrom checks the %PDF magic bytes)
        const data = await readBlobFrom([win.webContents], blobUrl, 'capture');
        pdfLog('print capture: blob read took ' + (Date.now() - tRead) + 'ms');
        if (!data) { pdfLog('not a readable PDF, left alone: ' + blobUrl); recentBlobUrls.delete(blobUrl); return; }
        if (onPdf) onPdf();
        const sd = Object.assign({}, shopData || {}, { docType: (shopData && shopData.docType && shopData.docType !== 'other') ? shopData.docType : docTypeFromUrl(win.webContents.getURL()) });
        openPdfForPrint(data, sd);
    } catch (e) { recentBlobUrls.delete(blobUrl); pdfLog('capture failed: ' + (e && e.message)); console.error('Blob PDF capture failed:', e); }
}

function toggleDarkMode(enabled) {
    // Apply to every open shop window so they all match the saved setting
    Array.from(shopWindows).filter(isAlive).forEach(w => applyDarkMode(w, enabled));
}

function applyDarkMode(win, enabled) {
    if (!isAlive(win)) return;
    // Explicit on/off keeps the page in sync with the saved setting
    const script = "if (" + (enabled ? "false" : "true") + ") {" +
                   "    const old = document.getElementById('leaside-dark-mode'); if (old) old.remove();" +
                   "} else if (!document.getElementById('leaside-dark-mode')) {" +
                   "    const style = document.createElement('style');" +
                   "    style.id = 'leaside-dark-mode';" +
                   "    style.innerHTML = 'html { background: #ffffff !important; filter: invert(90%) hue-rotate(180deg) !important; min-height: 100vh !important; } " +
                   "    img, picture, video, canvas, iframe, #shop-logo-fixed { filter: invert(100%) hue-rotate(180deg) !important; } " +
                   "    header, .MuiAppBar-root { filter: invert(100%) hue-rotate(180deg) !important; } " +
                   "    header img, .MuiAppBar-root img { filter: none !important; } " +
                   "    .MuiPaper-root, .MuiCard-root, .MuiDrawer-paper, .MuiDialog-paper, main, [class*=\"bg-white\"], [class*=\"bg-gray-\"] { background-color: #ffffff !important; } " +
                   "    input, textarea, select { background-color: #ffffff !important; } " +
                   "    div[role=\"alert\"], .Toastify__toast, .MuiSnackbarContent-root { background-color: #333333 !important; color: #ffffff !important; filter: invert(100%) hue-rotate(180deg) !important; } " +
                   "    div[role=\"alert\"] div, div[role=\"alert\"] span, .MuiSnackbarContent-root div, .MuiSnackbarContent-root span { color: #ffffff !important; } " +
                   "    div[role=\"alert\"] button, div[role=\"alert\"] button svg, div[role=\"alert\"] button svg path, .MuiAlert-action button, .MuiAlert-action svg, .MuiAlert-action svg path, .MuiSnackbarContent-action button, .MuiSnackbarContent-action svg, .MuiSnackbarContent-action svg path, .Toastify__close-button, .Toastify__close-button svg, .Toastify__close-button svg path { color: #ffffff !important; fill: #ffffff !important; opacity: 1 !important; } ';" +
                   "    document.head.appendChild(style);" +
                   "}";
                   
    win.webContents.executeJavaScript(script).catch(() => {});
}

ipcMain.on('document-ready', async (event, urlLoc, isMainWindow = false) => {
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    if (!senderWin || !senderWin.isVisible()) return;

    let urlObj;
    try { urlObj = new URL(urlLoc); } catch(e) { return; }

    const pathParts = urlObj.pathname.split('/');
    pathParts.pop(); 
    const basePath = urlObj.origin + pathParts.join('/');
    const search = urlObj.search; 

    const estimateUrl = basePath + '/estimate' + search;
    const repairUrl = basePath + '/repair' + search;
    const invoiceUrl = basePath + '/invoice' + search;
    const inspectUrl = basePath + '/inspections' + search;
    const params = new URLSearchParams(urlObj.search);
    params.set('hideImages', 'true');
    const inspectNoImgUrl = basePath + '/inspections?' + params.toString();

    const topWin = new BrowserWindow({ show: false, alwaysOnTop: true });

    let response = 0;
    try {
      ({ response } = await dialog.showMessageBox(topWin, {
        type: 'question',
        buttons: [
            'Cancel', 
            'Estimate x1', 
            'Estimate + Inspection x1',
            'Inspection x1', 
            'Work Order x1', 
            'Work Order + Inspection x1',
            'Invoice x1',
            'Invoices x2', 
            'Invoices x2 + Inspection x1'
        ],
        title: 'Leaside Smart Print',
        message: 'Select shop bundle:',
        icon: path.join(__dirname, 'logo.png')
      }));
    } finally {
      if (isAlive(topWin)) topWin.close();
    }

    if (response > 0) {
        // Never close the last visible window (that would quit the whole app)
        const others = BrowserWindow.getAllWindows().filter(w => w !== senderWin && isAlive(w) && w.isVisible());
        if (!isMainWindow && isAlive(senderWin) && others.length > 0) {
            senderWin.close();
        }
    }

    if (response === 1) silentPrint(estimateUrl, 1);
    if (response === 2) { silentPrint(estimateUrl, 1); checkAndPrintInspection(inspectUrl); }
    if (response === 3) checkAndPrintInspection(inspectUrl);
    if (response === 4) silentPrint(repairUrl, 1);
    if (response === 5) { silentPrint(repairUrl, 1); checkAndPrintInspection(inspectNoImgUrl); }
    if (response === 6) silentPrint(invoiceUrl, 1);
    if (response === 7) silentPrint(invoiceUrl, 2);
    if (response === 8) { silentPrint(invoiceUrl, 2); checkAndPrintInspection(inspectUrl); }
});

function docTypeFromUrl(u) {
    try {
        const p = new URL(u).pathname.toLowerCase().replace(/\/+$/, '');
        if (p.endsWith('/invoice')) return 'invoice';
        if (p.endsWith('/repair')) return 'repair';
        if (p.endsWith('/estimate')) return 'estimate';
        if (p.endsWith('/inspections')) return 'inspection';
    } catch (e) {}
    return 'other';
}

// Runs inside the hidden print page (stringified), so it must be self-contained.
function printLayoutInPage(opts) {
    return new Promise((resolve) => {
        const started = Date.now();
        const findHeaderLogo = () => Array.from(document.images).filter(i => {
            if (i.id === 'shop-logo-fixed' || i.closest('#leaside-watermark')) return false;
            const r = i.getBoundingClientRect();
            return r.width >= 40 && r.height >= 20 && r.top < 320;
        }).sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];

        const flipHeader = (logo) => {
            let el = logo.parentElement;
            for (let d = 0; el && el !== document.body && d < 8; d++, el = el.parentElement) {
                const cs = getComputedStyle(el);
                const kids = Array.from(el.children).filter(c => c.getBoundingClientRect().width > 0);
                if (kids.length < 2 || el.getBoundingClientRect().width < document.documentElement.clientWidth * 0.5) continue;
                if (cs.display.includes('flex') && !cs.flexDirection.startsWith('column')) {
                    el.style.setProperty('flex-direction', cs.flexDirection === 'row-reverse' ? 'row' : 'row-reverse', 'important');
                    return 'flex';
                }
                if (cs.display.includes('grid') || cs.display === 'table-row' || el.tagName === 'TR') {
                    el.style.setProperty('direction', 'rtl', 'important');
                    kids.forEach(k => k.style.setProperty('direction', 'ltr', 'important'));
                    return 'grid';
                }
            }
            // Plain block header: float the logo to the right edge
            logo.style.setProperty('float', 'right', 'important');
            logo.style.setProperty('margin-left', '16px', 'important');
            return 'float';
        };

        const tick = () => {
            try {
                if (opts.logoRight && !document.documentElement.hasAttribute('data-leaside-logo-right')) {
                    const logo = findHeaderLogo();
                    if (logo) document.documentElement.setAttribute('data-leaside-logo-right', flipHeader(logo));
                }
                if (opts.watermark && opts.logo && !document.getElementById('leaside-watermark')) {
                    const wm = document.createElement('div');
                    wm.id = 'leaside-watermark';
                    wm.style.cssText = 'position:fixed;inset:0;overflow:hidden;display:flex;align-items:center;justify-content:center;pointer-events:none;z-index:2147483646;-webkit-print-color-adjust:exact;print-color-adjust:exact;';
                    const img = document.createElement('img');
                    img.src = opts.logo;
                    img.style.cssText = 'width:62%;max-width:460px;max-height:80vh;object-fit:contain;opacity:' + opts.opacity + ';filter:grayscale(100%);';
                    wm.appendChild(img);
                    document.body.appendChild(wm);
                }
            } catch (e) {}
            const waiting = opts.logoRight && !document.documentElement.hasAttribute('data-leaside-logo-right');
            if (waiting && Date.now() - started < 1500) setTimeout(tick, 100);
            else resolve(); // v2.3.9: no extra 200ms delay after layout is ready
        };
        tick();
    });
}

async function applyPrintLayout(win, docType) {
    if (!isAlive(win)) return;
    const s = loadSettings();
    const opts = {
        logoRight: docType === 'invoice' && !!s.invoiceLogoRight,
        watermark: (docType === 'invoice' || docType === 'inspection' || docType === 'invoice-wm-only') && !!s.workOrderWatermark,
        opacity: 0.045,
        logo: null
    };
    if (!opts.logoRight && !opts.watermark) return;
    if (opts.watermark) opts.logo = logoDataUrl('logo-watermark.png');
    try {
        await win.webContents.executeJavaScript('(' + printLayoutInPage.toString() + ')(' + jsLiteral(opts) + ')');
    } catch (e) { console.error('Print layout tweak failed:', e); }
}

function checkAndPrintInspection(urlLoc) {
    const tm = printTimer('smart-inspection');
    const printUrl = new URL(urlLoc);
    printUrl.searchParams.set('hiddenPrinter', 'true');
    printUrl.searchParams.set('copies', '1');
    
    const checkWin = new BrowserWindow({ 
        show: false, 
        webPreferences: { 
            partition: 'persist:tekmetric_session', 
            preload: path.join(__dirname, 'preload.js'),
            backgroundThrottling: false // v2.4.9: hidden window must not throttle timers or image loads
        } 
    });
    
    const closeCheck = () => { if (isAlive(checkWin)) checkWin.close(); };
    checkWin.webContents.once('did-fail-load', () => closeCheck());
    checkWin.loadURL(printUrl.toString()).catch(() => {});
    
    checkWin.webContents.once('did-finish-load', () => {
        if (!isAlive(checkWin)) return;
        tm.mark('did-finish-load');
        const current = checkWin.webContents.getURL();
        if (current.includes('error') || current.includes('dashboard')) {
            const win = getMainWin();
            const opts = { type: 'warning', title: 'Inspection Missing', message: 'No inspection is attached to this order.', buttons: ['OK'] };
            (isAlive(win) ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts)).catch(() => {});
            closeCheck();
        } else {
            checkWin.webContents.insertCSS(globalCSS).catch(() => {});
            (async () => {
                try { await applyDocumentPdfStamp(checkWin.webContents); } catch (e) { pdfLog(tm.id + ' document stamp apply error: ' + (e && e.message)); }
                if (!isAlive(checkWin)) return;
                // v2.4.8: wait for the page to actually be ready instead of a flat 1500 ms
                const st = await waitPageSettled(checkWin.webContents, 400, 350, 6000);
                tm.mark('page settled', JSON.stringify(st));
                if (!isAlive(checkWin)) return;
                await applyPrintLayout(checkWin, 'inspection'); // v2.3.8: inspections get the faint watermark too
                tm.mark('print layout');
                if (!checkWin.isDestroyed()) {
                    tm.mark('print() called');
                    printSilent(checkWin.webContents,
                        { silent: true, printBackground: true, copies: 1, duplexMode: 'longEdge' }, tm,
                        (success, failureReason) => {
                            pdfLog(tm.id + ' print done success=' + success + (failureReason ? ' reason=' + failureReason : '') + ' (total ' + (Date.now() - tm.t0) + 'ms)');
                            setTimeout(closeCheck, 3000);
                        }
                    );
                }
            })();
        }
    });
}

function silentPrint(urlLoc, copies) {
    const tm = printTimer('smart-print');
    const printUrl = new URL(urlLoc);
    printUrl.searchParams.set('hiddenPrinter', 'true');
    printUrl.searchParams.set('copies', copies);
    
    const pWin = new BrowserWindow({ 
        show: false, 
        webPreferences: { 
            partition: 'persist:tekmetric_session', 
            preload: path.join(__dirname, 'preload.js'),
            backgroundThrottling: false // v2.4.9: hidden window must not throttle timers or image loads
        } 
    });
    
    const closeP = () => { if (isAlive(pWin)) pWin.close(); };
    pWin.webContents.once('did-fail-load', () => closeP());
    pWin.loadURL(printUrl.toString()).catch(() => {});
    
    pWin.webContents.once('did-finish-load', () => {
        if (!isAlive(pWin)) return;
        pWin.webContents.insertCSS(globalCSS).catch(() => {});
        tm.mark('did-finish-load');
        (async () => {
            try { await applyDocumentPdfStamp(pWin.webContents); } catch (e) { pdfLog(tm.id + ' document stamp apply error: ' + (e && e.message)); }
            if (!isAlive(pWin)) return;
            // v2.4.8: wait for the page to actually be ready instead of a flat 1500 ms
            const st = await waitPageSettled(pWin.webContents, 400, 350, 6000);
            tm.mark('page settled', JSON.stringify(st));
            if (!isAlive(pWin)) return;
            // Optional invoice header flip / work-order watermark (Tools menu), applied just before printing
            await applyPrintLayout(pWin, docTypeFromUrl(urlLoc));
            tm.mark('print layout');
            if (!pWin.isDestroyed()) {
                tm.mark('print() called');
                printSilent(pWin.webContents,
                    { silent: true, printBackground: true, copies: parseInt(copies) || 1, duplexMode: 'longEdge' }, tm,
                    (success, failureReason) => {
                        pdfLog(tm.id + ' print done success=' + success + (failureReason ? ' reason=' + failureReason : '') + ' (total ' + (Date.now() - tm.t0) + 'ms)');
                        setTimeout(closeP, 3000);
                    }
                );
            }
        })();
    });
}

async function runGeminiSpellCheck(text, parentWin) {
    const prompt = "Fix all spelling and grammar errors in the following text. Do not rewrite, do not expand, and do not change the meaning. Return only the corrected text: " + text;
    let result = await processGeminiRequest(prompt, parentWin);
    const settings = loadSettings();
    return (result && settings.autoCaps) ? result.toUpperCase() : result;
}

async function runGemini(text, parentWin) {
    const prompt = `You are an expert automotive service advisor. Rewrite the following repair note to sound professional, clear, and concise. 
    
    STRICT RULES:
    1. DO NOT invent, assume, or add any parts, actions, or results that are not explicitly stated in the original text.
    2. If the original text only states a problem, only return a professional version of that problem.
    3. Correct all spelling and grammar.
    4. Return ONLY the rewritten text.
    
    Original Text: ` + text;
    
    let result = await processGeminiRequest(prompt, parentWin);
    const settings = loadSettings();
    return (result && settings.autoCaps) ? result.toUpperCase() : result;
}

// ---- AI (v2.5.0) ---------------------------------------------------------------------------
// All requests go through ai-request.js: hard timeout, retries with backoff, fallback models,
// safe parsing, single request at a time. net.fetch uses Chromium's network stack, so the PC's
// proxy settings apply (the old SDK used Node's fetch, which ignores them).
const AI_BUSY_SUFFIX = '  -  AI working...';
const aiFetch = (u, init) => {
    try { return net.fetch(u, Object.assign({}, init, { bypassCustomProtocolHandlers: true })); }
    catch (e) { return fetch(u, init); }
};
const aiClient = createAiClient({
    fetch: aiFetch,
    getKey: () => { const s = loadSettings(); return s.apiKey || process.env.GEMINI_API_KEY || ''; },
    log: (m) => pdfLog(m)
});

function setAiBusy(win, busy) {
    if (!isAlive(win)) return;
    win._aiBusy = busy;
    try {
        const base = win.getTitle().replace(AI_BUSY_SUFFIX, '');
        win.setTitle(busy ? base + AI_BUSY_SUFFIX : base);
        win.setProgressBar(busy ? 2 : -1, busy ? { mode: 'indeterminate' } : undefined);
    } catch (e) {}
}

let aiMenuBusy = false;
async function runAiMenuAction(win, selectionText, runner, tag) {
    // Set synchronously so a fast double click can never start two runs
    if (aiMenuBusy) { pdfLog('ai ' + tag + ' ignored: a request is already running'); return; }
    aiMenuBusy = true;
    let out = null, captured = 'none';
    const id = Date.now().toString(36);
    try {
        try { if (isAlive(win)) captured = await win.webContents.executeJavaScript(captureSrc(id)); } catch (e) {}
        setAiBusy(win, true);
        try { out = await runner(selectionText, win); }
        finally { setAiBusy(win, false); }
    } catch (e) {
        pdfLog('ai ' + tag + ' unexpected error: ' + (e && e.message));
    } finally { aiMenuBusy = false; }
    if (!out || !isAlive(win)) return;
    let how = 'none';
    if (captured !== 'none') {
        try { how = await win.webContents.executeJavaScript(applySrc(id, out)); } catch (e) { how = 'error:' + e.message; }
    }
    if (how !== 'inserted') {
        // Field is gone or its text changed: fall back to pasting at the cursor, like before
        pdfLog('ai ' + tag + ' insert=' + how + ', pasting at cursor');
        const { clipboard } = require('electron');
        clipboard.writeText(out);
        win.webContents.paste();
    } else {
        pdfLog('ai ' + tag + ' insert=inserted');
    }
}

async function processGeminiRequest(prompt, parentWin) {
    const showErr = (opts) => {
        (isAlive(parentWin) ? dialog.showMessageBox(parentWin, opts) : dialog.showMessageBox(opts)).catch(() => {});
    };
    const r = await aiClient.request(prompt);
    if (r.ok) return r.text;
    if (r.kind === 'busy') return null; // second click while one request is running: ignored
    if (r.kind === 'nokey') showErr({ type: 'error', title: 'AI Offline', message: r.message });
    else showErr({ type: 'error', title: 'AI Server Error', message: 'Failed to process AI request.\n\n' + r.message });
    return null;
}

function requireAdmin(callback) {
    const parentWin = getMainWin();
    const authWin = new BrowserWindow({
        width: 350, height: 320, 
        parent: parentWin || undefined, 
        modal: !!parentWin, 
        alwaysOnTop: true,
        autoHideMenuBar: true, resizable: false, show: false,
        title: 'Admin Verification',
        backgroundColor: '#121212',
        webPreferences: { nodeIntegration: true, contextIsolation: false }
    });
    
    const html = `
        ${brandCss()}<body style="font-family: sans-serif; background: #121212; color: #fff; text-align: center; padding: 20px;">
            ${brandHeader(48)}
            <h3 style="margin-top: 0;">Admin Access</h3>
            <p style="font-size: 12px; color: #aaa;">Enter PIN to modify settings.</p>
            <input type="password" id="pin" autofocus style="padding: 8px; width: 60%; text-align: center; background: #222; color: white; border: 1px solid #555; border-radius: 4px;">
            <br><br>
            <button id="btn" style="padding: 8px 20px; background: #d32f2f; color: white; border: none; border-radius: 4px; cursor: pointer;">Verify</button>
            <p id="error-msg" style="color: #ff5252; font-size: 12px; font-weight: bold; margin-top: 10px;"></p>
            <script>
                const { ipcRenderer } = require('electron');
                window.addEventListener('load', () => document.getElementById('pin').focus());
                window.addEventListener('focus', () => document.getElementById('pin').focus());
                document.getElementById('btn').onclick = () => ipcRenderer.send('auth-attempt', document.getElementById('pin').value);
                document.getElementById('pin').addEventListener('keypress', (e) => { if (e.key === 'Enter') document.getElementById('btn').click(); });
                ipcRenderer.on('auth-failed', () => { document.getElementById('error-msg').innerText = 'Incorrect PIN'; document.getElementById('pin').value = ''; });
            </script>
        </body>
    `;
    authWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    const focusPin = () => {
        if (!isAlive(authWin)) return;
        authWin.focus();
        authWin.webContents.focus();
        authWin.webContents.executeJavaScript("(() => { const i = document.getElementById('pin'); if (i) { i.focus(); i.select(); } })()").catch(() => {});
    };
    authWin.once('ready-to-show', () => { authWin.show(); focusPin(); setTimeout(focusPin, 150); });
    authWin.on('show', focusPin);

    const authHandler = (event, pin) => {
        // Only accept PIN attempts from this verification window
        if (!isAlive(authWin) || event.sender !== authWin.webContents) return;
        if (pin === 'leaside') {
            ipcMain.removeListener('auth-attempt', authHandler);
            authWin.once('closed', () => {
                callback();
            });
            authWin.close();
        } else {
            authWin.webContents.send('auth-failed');
        }
    };

    ipcMain.on('auth-attempt', authHandler);
    authWin.on('closed', () => ipcMain.removeListener('auth-attempt', authHandler));
}

function openSettingsEditor() {
    const parentWin = getMainWin();
    const win = new BrowserWindow({ 
        width: 640, height: 540, 
        parent: parentWin || undefined, 
        modal: !!parentWin, 
        alwaysOnTop: true,
        autoHideMenuBar: true, title: "API Settings", icon: path.join(__dirname, 'logo.png'),
        backgroundColor: '#0d0e11', 
        webPreferences: { nodeIntegration: true, contextIsolation: false } 
    });
    const s = loadSettings();
    const safePath = jsLiteral(settingsPath);
    
    const html = settingsEditorHtml({
        css: signboardCss(),
        header: signboardHeader(),
        apiKey: s.apiKey || '',
        settingsPathLiteral: safePath
    });
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
}

function openUserEditor() {
    const parentWin = getMainWin();
    const win = new BrowserWindow({ 
        width: 800, height: 680, 
        parent: parentWin || undefined, 
        modal: !!parentWin, 
        alwaysOnTop: true,
        autoHideMenuBar: true, title: "Edit User Info", icon: path.join(__dirname, 'logo.png'),
        backgroundColor: '#121212', 
        webPreferences: { nodeIntegration: true, contextIsolation: false } 
    });
    const usersData = fs.readFileSync(usersPath, 'utf8');
    const safePath = jsLiteral(usersPath);
    
    const html = `
        ${brandCss()}<body style="font-family: sans-serif; padding: 20px; background: #121212; color: #e0e0e0;">
            ${brandHeader(44)}
            <h2 style="text-align:center;margin-top:0">Shop User Profiles</h2>
            <p>Edit the JSON data below. Keep the brackets and quotes intact.</p>
            <textarea id="users" style="width: 100%; height: 350px; padding: 10px; font-family: monospace; background: #222; color: #fff; border: 1px solid #444;">${escapeHtml(usersData)}</textarea>
            <br><br>
            <button id="save" style="padding: 10px 20px; background: #d32f2f; color: #fff; border: none; cursor: pointer;">Save Users & Restart Application</button>
            <p id="msg" style="color: #ff5252; font-weight: bold; margin-top: 15px;"></p>
            <script>
                const fs = require('fs');
                const { ipcRenderer } = require('electron');
                document.getElementById('save').onclick = () => {
                    try {
                        const data = document.getElementById('users').value;
                        JSON.parse(data);
                        fs.writeFileSync(${safePath}, data);
                        ipcRenderer.send('restart-app');
                    } catch (e) {
                        document.getElementById('msg').innerText = 'Invalid JSON format. Please check your syntax.';
                    }
                };
            </script>
        </body>
    `;
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
}

function openPresetsEditor() {
    const parentWin = getMainWin();
    const win = new BrowserWindow({ 
        width: 700, height: 680, 
        parent: parentWin || undefined, 
        modal: !!parentWin, 
        alwaysOnTop: true,
        autoHideMenuBar: true, title: "Edit Text Presets", icon: path.join(__dirname, 'logo.png'),
        backgroundColor: '#121212', 
        webPreferences: { nodeIntegration: true, contextIsolation: false } 
    });
    const s = loadSettings();
    const safePath = jsLiteral(settingsPath);
    
    const html = `
        ${brandCss()}<body style="font-family: sans-serif; padding: 20px; background: #121212; color: #e0e0e0;">
            ${brandHeader(44)}
            <h2 style="text-align:center;margin-top:0">Shop Text Presets</h2>
            <p>Enter one preset job per line. Do not use quotes or commas to separate items.</p>
            <textarea id="presets" style="width: 100%; height: 350px; padding: 10px; font-family: monospace; background: #222; color: #fff; border: 1px solid #444; white-space: pre;"></textarea>
            <br><br>
            <button id="save" style="padding: 10px 20px; background: #d32f2f; color: #fff; border: none; cursor: pointer; font-weight: bold;">Save & Restart App</button>
            <script>
                const fs = require('fs');
                const { ipcRenderer } = require('electron');
                document.getElementById('presets').value = ${jsLiteral((s.presets || []).join('\n'))};
                
                document.getElementById('save').onclick = () => {
                    const lines = document.getElementById('presets').value.split('\\n').map(l => l.trim()).filter(l => l !== '');
                    let set = JSON.parse(fs.readFileSync(${safePath}));
                    set.presets = lines;
                    fs.writeFileSync(${safePath}, JSON.stringify(set, null, 2));
                    ipcRenderer.send('restart-app');
                };
            </script>
        </body>
    `;
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
}

function openMailtoExternal(raw) {
    if (!raw || !/^mailto:/i.test(String(raw))) return false;
    shell.openExternal(String(raw)).catch((e) => { try { pdfLog('mailto open failed: ' + (e && e.message)); } catch (err) {} });
    return true;
}

function attachMailtoHandlers(win) {
    if (!win || win.isDestroyed()) return;
    win.webContents.setWindowOpenHandler(({ url }) => {
        openMailtoExternal(url);
        return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (e, u) => {
        if (openMailtoExternal(u)) e.preventDefault();
    });
}

function openAboutWindow() {
    const parentWin = getMainWin();
    const aboutWin = new BrowserWindow({
        width: 560, height: 820, 
        parent: parentWin || undefined, 
        modal: !!parentWin, 
        alwaysOnTop: true,
        title: 'About System', icon: path.join(__dirname, 'logo.png'),
        autoHideMenuBar: true, resizable: false, backgroundColor: '#0d0e11',
        webPreferences: {
            preload: path.join(__dirname, 'about-preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    const htmlContent = aboutHtml(app.getVersion(), { css: signboardCss(), header: signboardHeader() });
    aboutWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(htmlContent));
    attachMailtoHandlers(aboutWin);
}

let bugReportWin = null;

function openBugReportWindow() {
    if (bugReportWin && !bugReportWin.isDestroyed()) {
        bugReportWin.focus();
        return;
    }
    const parentWin = getMainWin();
    const defaults = defaultBugReportRange(new Date(), 'America/Toronto');
    bugReportWin = new BrowserWindow({
        width: 460, height: 520,
        parent: parentWin || undefined,
        modal: !!parentWin,
        alwaysOnTop: true,
        title: 'Create Bug Report', icon: path.join(__dirname, 'logo.png'),
        autoHideMenuBar: true, resizable: false, backgroundColor: '#0d0e11',
        webPreferences: {
            preload: path.join(__dirname, 'bug-report-preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        }
    });
    const html = bugReportDialogHtml(defaults, signboardCss());
    bugReportWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    bugReportWin.on('closed', () => { bugReportWin = null; });
}

function osVersionLabel() {
    try {
        if (typeof os.version === 'function') return os.type() + ' ' + os.version() + ' (' + os.release() + ')';
    } catch (e) {}
    return os.type() + ' ' + os.release();
}

ipcMain.on('about-open-bug-report', () => { openBugReportWindow(); });
ipcMain.on('bug-report-cancel', (event) => {
    const w = BrowserWindow.fromWebContents(event.sender);
    if (w && !w.isDestroyed()) w.close();
});
ipcMain.handle('bug-report-create', async (event, payload) => {
    const parent = getMainWin();
    try {
        const s = loadSettings();
        const printerName = (s && typeof s.printerName === 'string') ? s.printerName : '';
        let crashDir = '';
        try { crashDir = app.getPath('crashDumps'); } catch (e) { crashDir = ''; }
        const result = createBugReport({
            fs,
            date: payload && payload.date,
            fromTime: payload && payload.fromTime,
            toTime: payload && payload.toTime,
            note: payload && payload.note,
            logPaths: [pdfLogPath(), path.join(app.getPath('userData'), 'pdf-stamp.log.old')],
            crashDir,
            downloadsDir: app.getPath('downloads'),
            version: app.getVersion(),
            electronVersion: process.versions.electron,
            chromeVersion: process.versions.chrome,
            osVersion: osVersionLabel(),
            pcName: os.hostname(),
            printerName,
            now: new Date(),
            tz: 'America/Toronto'
        });
        if (!result.ok) return result;
        try { shell.showItemInFolder(result.path); } catch (e) { pdfLog('showItemInFolder failed: ' + (e && e.message)); }
        if (result.mailto) {
            try { await shell.openExternal(result.mailto); } catch (e) { pdfLog('bug report mailto failed: ' + (e && e.message)); }
        }
        const msg = 'The file ' + result.zipName + ' was saved in your Downloads folder.\n\nA new email to shawn@craigsleaside.com is open in your mail app. Please attach that zip file before you send it.';
        const box = { type: 'info', title: 'Bug report saved', message: msg };
        if (parent && isAlive(parent)) await dialog.showMessageBox(parent, box);
        else await dialog.showMessageBox(box);
        const w = BrowserWindow.fromWebContents(event.sender);
        if (w && !w.isDestroyed()) w.close();
        return result;
    } catch (e) {
        const message = 'Could not create the bug report. ' + (e && e.message ? e.message : String(e));
        try { pdfLog('bug report error: ' + message); } catch (err) {}
        return { ok: false, message };
    }
});

const SPOOLER_CONFIRM = 'This clears all stuck print jobs on this PC and restarts printing. Windows will ask for admin permission.';
let spoolerResetBusy = false;

async function resetPrintSpoolerFromMenu() {
    if (process.platform !== 'win32') return;
    if (spoolerResetBusy) return;
    const win = getMainWin();
    const opt = {
        type: 'question',
        title: 'Reset Print Spooler',
        message: SPOOLER_CONFIRM,
        buttons: ['Reset Print Spooler', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        noLink: true
    };
    const result = win ? await dialog.showMessageBox(win, opt) : await dialog.showMessageBox(opt);
    if (!result || result.response !== 0) return;
    spoolerResetBusy = true;
    pdfLog('print spooler reset requested');
    try {
        const r = await resetPrintSpooler({ platform: process.platform, spawn, log: pdfLog });
        pdfLog('print spooler reset result: kind=' + r.kind + (r.out ? ' out=' + String(r.out).slice(0, 200) : '') + (r.code != null ? ' code=' + r.code : ''));
        const done = {
            type: r.ok ? 'info' : 'warning',
            title: 'Reset Print Spooler',
            message: r.message || (r.ok ? 'Print spooler reset, printing is ready' : 'Could not reset the print spooler.')
        };
        if (win && isAlive(win)) await dialog.showMessageBox(win, done);
        else await dialog.showMessageBox(done);
    } catch (e) {
        const msg = 'Could not reset the print spooler. ' + (e && e.message ? e.message : String(e));
        pdfLog('print spooler reset error: ' + msg);
        const done = { type: 'warning', title: 'Reset Print Spooler', message: msg };
        if (win && isAlive(win)) await dialog.showMessageBox(win, done);
        else await dialog.showMessageBox(done);
    } finally {
        spoolerResetBusy = false;
    }
}

ipcMain.on('restart-app', () => {
    app.relaunch();
    app.exit();
});

// Quiet updater: launch check is silent (log only); downloads in background,
// one small "Restart now / Later" notice per session, installs on quit otherwise.
// Auto-update only works for the installed (NSIS) build. Dev runs and the
// portable exe skip it quietly.
function canAutoUpdate() { return app.isPackaged && !process.env.PORTABLE_EXECUTABLE_FILE; }
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
let manualUpdateCheck = false;
let updateNoticeShown = false;

function updaterDialog(options) {
    const win = getMainWin();
    return win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options);
}

autoUpdater.on('update-available', (info) => {
    console.log('[Updater] Update available:', info && info.version, '- downloading in background');
    if (manualUpdateCheck) {
        manualUpdateCheck = false;
        updaterDialog({ type: 'info', title: 'Update Available', message: `Version ${info.version} is available and is downloading in the background. You'll be notified when it's ready.` });
    }
});

autoUpdater.on('update-not-available', () => {
    console.log('[Updater] Up to date');
    if (manualUpdateCheck) {
        manualUpdateCheck = false;
        updaterDialog({ type: 'info', title: 'Up to Date', message: 'You are already running the latest version.' });
    }
});

autoUpdater.on('error', (err) => {
    const msg = (err && err.message) ? err.message : String(err);
    console.log('[Updater] Error:', msg);
    if (manualUpdateCheck) {
        manualUpdateCheck = false;
        updaterDialog({ type: 'info', title: 'Updater Notification', message: 'Update check failed or offline mode active.\n\nDetails: ' + msg });
    }
});

autoUpdater.on('update-downloaded', (info) => {
    console.log('[Updater] Update downloaded:', info && info.version);
    if (updateNoticeShown) return;
    updateNoticeShown = true;
    updaterDialog({
        type: 'info', title: 'Update Ready',
        message: `Tekmetric Pro ${info.version} is ready.`,
        detail: 'Restart now to apply it, or it will install automatically when you close the app.',
        buttons: ['Restart now', 'Later'], defaultId: 1, cancelId: 1, noLink: true
    }).then((result) => { if (result.response === 0) autoUpdater.quitAndInstall(); }).catch(() => {});
});

async function refreshPrinterMenu() {
    const w = getMainWin();
    if (!isAlive(w)) return;
    const before = JSON.stringify((printerCache.list || []).map(p => p.name));
    const list = await getPrinters(w.webContents, 0);
    pdfLog('printers on this PC: ' + (list.map(p => p.name).join(' | ') || '(none)') + '; saved=' + (loadSettings().printerName || 'System default'));
    if (JSON.stringify(list.map(p => p.name)) !== before) setupMenu();
}

function setupMenu() {
    let userMenu = [];
    try {
        if (fs.existsSync(usersPath)) {
            const users = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
            if (Array.isArray(users)) {
                userMenu = users.map(u => ({ 
                    label: `Login as ${u.name}`, 
                    click: () => {
                        const win = getMainWin();
                        if (win) win.webContents.send('fill-login', u);
                    } 
                }));
            }
        }
    } catch (e) { console.error("Failed to load users:", e); }

    const s = loadSettings();
    const presetJobs = s.presets || [];

    const template = [
        { label: 'Shop', submenu: [
            { label: 'Login Selection', submenu: userMenu },
            { label: 'New Window', accelerator: 'CmdOrCtrl+N', click: () => createWindow() },
            { type: 'separator' },
            { label: 'Print Settings', submenu: [
                { label: 'Printer', submenu: printerMenuModel(s.printerName, printerCache.list).map(it => ({
                    label: it.label, type: 'radio', checked: it.checked,
                    click: () => {
                        const cur = loadSettings();
                        cur.printerName = it.name;
                        fs.writeFileSync(settingsPath, JSON.stringify(cur, null, 2));
                        pdfLog('printer choice saved: ' + (it.name || 'System default'));
                        setupMenu();
                    }
                })).concat([{ type: 'separator' }, { label: 'Refresh Printer List', click: () => refreshPrinterMenu() }]) },
                { type: 'separator' },
                { label: 'Reset Print Spooler...', visible: process.platform === 'win32', click: () => { resetPrintSpoolerFromMenu().catch((e) => { try { pdfLog('print spooler reset menu error: ' + (e && e.message ? e.message : e)); } catch (err) {} }); } },
                { type: 'separator' },
                { label: 'Invoice Header: Shop Logo on Right', type: 'checkbox', checked: !!s.invoiceLogoRight, click: (item) => {
                    const cur = loadSettings();
                    cur.invoiceLogoRight = item.checked;
                    fs.writeFileSync(settingsPath, JSON.stringify(cur, null, 2));
                }},
                { label: 'Invoices & Inspections: Faint Watermark', type: 'checkbox', checked: !!s.workOrderWatermark, click: (item) => {
                    const cur = loadSettings();
                    cur.workOrderWatermark = item.checked;
                    fs.writeFileSync(settingsPath, JSON.stringify(cur, null, 2));
                }}
            ]},
            { label: 'Admin (PIN)', submenu: [
                { label: 'Edit User Info...', click: () => requireAdmin(openUserEditor) },
                { label: 'Edit Text Presets...', click: () => requireAdmin(openPresetsEditor) },
                { label: 'System Settings (API Keys)...', click: () => requireAdmin(openSettingsEditor) }
            ]},
            { label: 'Purge System Cache', click: () => {
                const tempDir = app.getPath('temp');
                let count = 0;
                try {
                    const files = fs.readdirSync(tempDir);
                    files.forEach(file => {
                        if (file.startsWith('Leaside_RO_') && file.endsWith('.pdf')) {
                            fs.unlinkSync(path.join(tempDir, file));
                            count++;
                        }
                    });
                    const win = getMainWin();
                    const opt = { type: 'info', title: 'System Purge', message: `Purged ${count} temporary print files.` };
                    if (win) dialog.showMessageBox(win, opt); else dialog.showMessageBox(opt);
                } catch(e) {
                    dialog.showErrorBox('Purge Error', e.message);
                }
            }},
            { type: 'separator' },
            { role: 'quit' }
        ]},
        { label: 'Quick Actions', submenu: [
            { 
                label: 'Fill "No Faults"', 
                accelerator: 'CmdOrCtrl+Alt+N',
                click: () => {
                    const win = getMainWin();
                    if (win) win.webContents.send('fill-no-faults');
                }
            },
            { 
                label: 'Clear "No Faults"', 
                accelerator: 'CmdOrCtrl+Alt+C',
                click: () => {
                    const win = getMainWin();
                    if (win) win.webContents.send('clear-no-faults');
                }
            },
            { type: 'separator' },
            ...presetJobs.map(job => ({
                label: `Insert: ${job.substring(0, 20)}...`,
                click: () => {
                    const win = getMainWin();
                    if (win) win.webContents.send('insert-text', job);
                }
            }))
        ]},
        { label: 'View', submenu: [
            // Alt+Left/Right is already handled per window (before-input-event), so only show the shortcut here
            { label: 'Back', accelerator: 'Alt+Left', registerAccelerator: false, click: () => { const w = BrowserWindow.getFocusedWindow(); if (isAlive(w)) navGo(w.webContents, 'back'); } },
            { label: 'Forward', accelerator: 'Alt+Right', registerAccelerator: false, click: () => { const w = BrowserWindow.getFocusedWindow(); if (isAlive(w)) navGo(w.webContents, 'forward'); } },
            { role: 'reload' },
            { type: 'separator' },
            { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: () => {
                const win = getMainWin();
                if (win) win.webContents.setZoomLevel(win.webContents.getZoomLevel() + 0.5);
            }},
            { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => {
                const win = getMainWin();
                if (win) win.webContents.setZoomLevel(win.webContents.getZoomLevel() - 0.5);
            }},
            { label: 'Reset Zoom', accelerator: 'CmdOrCtrl+0', click: () => {
                const win = getMainWin();
                if (win) win.webContents.setZoomLevel(0);
            }},
            { type: 'separator' },
            { label: 'Dark Mode (Toggle)', click: () => {
                const s = loadSettings();
                s.darkMode = !s.darkMode;
                fs.writeFileSync(settingsPath, JSON.stringify(s, null, 2));
                toggleDarkMode(s.darkMode);
            }},
            { label: 'Quick Actions Panel (Toggle)', click: () => {
                const s = loadSettings();
                s.showSidebar = !s.showSidebar;
                fs.writeFileSync(settingsPath, JSON.stringify(s, null, 2));
                BrowserWindow.getAllWindows().forEach(w => w.webContents.send('settings-changed', s));
            }},
            { label: 'Auto Uppercase (Toggle)', click: () => {
                const s = loadSettings();
                s.autoCaps = !s.autoCaps;
                fs.writeFileSync(settingsPath, JSON.stringify(s, null, 2));
                BrowserWindow.getAllWindows().forEach(w => w.webContents.send('settings-changed', s));
            }},
            { label: 'Premium Features View (Toggle)', click: () => {
                const s = loadSettings();
                s.hidePremium = !s.hidePremium;
                fs.writeFileSync(settingsPath, JSON.stringify(s, null, 2));
                BrowserWindow.getAllWindows().forEach(w => w.webContents.send('settings-changed', s));
            }},
        ]},
        { label: 'Help', submenu: [
            { label: 'Check for Updates...', click: () => {
                if (!canAutoUpdate()) {
                    dialog.showMessageBox({ type: 'info', title: 'Updates', message: 'Automatic updates work only in the installed version (Tekmetric-Pro-Setup). This portable/dev copy will not update itself.' }).catch(() => {});
                    return;
                }
                manualUpdateCheck = true;
                autoUpdater.checkForUpdates().catch(() => {});
            }},
            { label: 'Troubleshooting', submenu: [
                { label: 'Open PDF Log', click: () => { pdfLog('Open PDF Log clicked'); require('electron').shell.openPath(pdfLogPath()); } },
                { label: 'Open Log Folder', click: () => { require('electron').shell.openPath(app.getPath('userData')); } }
            ]},
            { type: 'separator' },
            { label: 'About System', click: () => openAboutWindow() }
        ]}
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Stamp a PDF caught at the network layer (Tekmetric /document/ responses), per the Tools toggles
async function networkStamp(buf, info) {
    const settings = loadSettings();
    if (!settings.invoiceLogoRight && !settings.workOrderWatermark) { pdfLog('network PDF: both toggles off, unchanged'); return null; }
    const wmPath = path.join(__dirname, fs.existsSync(path.join(__dirname, 'logo-watermark.png')) ? 'logo-watermark.png' : 'logo.png');
    // v2.3.9: one worker round-trip; PNGs cached inside the worker by path
    const r = await stampJob(buf, {
        urlKind: info.kind,
        flipHeader: !!settings.invoiceLogoRight,
        watermark: !!settings.workOrderWatermark,
        opacity: 0.045,
        logoPath: path.join(__dirname, 'logo.png'),
        watermarkPath: wmPath
    });
    const flip = !!r && !!r.headerFlipped;
    const wm = !!r && !r.skipped && !!settings.workOrderWatermark;
    pdfLog('network PDF kind=' + (r && r.docKind) + ' (url ' + info.kind + ', text ' + (r && r.header && r.header.kind) + ') headerFlipped=' + flip + ' watermark=' + (!!r && !r.skipped && (r.docKind === 'invoice' || r.docKind === 'inspection')) );
    if (!r || r.skipped || !r.bytes) return null;
    return Buffer.from(r.bytes);
}

// v2.5.5: no session.protocol.handle('https'). That is scheme-wide and cannot be
// limited to /document/ URLs; a main-process passthrough also drops Partitioned
// iframe cookies (ProDemand 401) and can break CORS (fonts.gstatic ERR_FAILED).
// Punchouts (v2.3.7) were re-issued only because the https handler ate POST
// bodies and followed redirects; Chromium handles them natively again.
// v2.5.6: debugger Fetch stamping of /document/ PDFs is off (viewer failed to
// load the file). Those PDFs load natively; blob print stamping still runs.
// v2.5.7: after a /document/ PDF loads natively, fetch the bytes with the
// window's session cookies, stamp them, and swap in a file:// temp PDF so the
// built-in viewer still works. If that fails, the original PDF stays on screen.
function installShopDocumentInterceptor(ses, name) {
    try {
        installDocumentInterceptor(ses, name, { stamp: networkStamp, log: pdfLog });
    } catch (e) { pdfLog('network interceptor FAILED on ' + name + ': ' + (e && e.stack || e)); }
}

const applyDocumentPdfStamp = createDocumentPdfStamper({
    log: (m) => pdfLog(m),
    stamp: (buf, info) => networkStamp(buf, info),
    fetch: async (u, wc) => {
        const res = await wc.session.fetch(u, { bypassCustomProtocolHandlers: true, credentials: 'include' });
        if (!res || !res.ok) throw new Error('HTTP ' + (res && res.status));
        return Buffer.from(await res.arrayBuffer());
    },
    writeTemp: async (buf) => {
        const tempPath = path.join(app.getPath('temp'), 'Leaside_RO_' + Date.now() + '.pdf');
        await fs.promises.writeFile(tempPath, buf);
        return tempPath;
    }
});

async function processPdfData(arrayData, shopData, tm) {
    shopData = shopData || {};
    tm = tm || printTimer('pdf');
    const original = Buffer.from(arrayData);
    const settings = loadSettings();
    const urlKind = shopData.docType === 'inspection' ? 'inspection' : null;
    const wantFlip = !!settings.invoiceLogoRight;
    const wantWm = !!settings.workOrderWatermark;
    let header = null, kind = null, buffer = original;
    if (wantFlip || wantWm) {
        try {
            const wmPath = path.join(__dirname, fs.existsSync(path.join(__dirname, 'logo-watermark.png')) ? 'logo-watermark.png' : 'logo.png');
            const r = await stampJob(original, {
                urlKind,
                flipHeader: wantFlip,
                watermark: wantWm,
                forceWm: shopData.docType === 'invoice',
                opacity: 0.045,
                logoPath: path.join(__dirname, 'logo.png'),
                watermarkPath: wmPath
            });
            header = r && r.header;
            kind = (r && r.docKind) || null;
            if (r && !r.skipped && r.bytes) buffer = Buffer.from(r.bytes);
            pdfLog('detected kind=' + kind + ' docType=' + shopData.docType + ' headerFlipped=' + !!(r && r.headerFlipped) + ' watermark=' + !!(r && !r.skipped && wantWm));
            tm.mark('stamp (worker: header scan + logo/watermark)', 'in=' + original.length + 'B out=' + buffer.length + 'B');
        } catch (e) { pdfLog('stamp failed: ' + (e && e.stack || e)); console.error('PDF stamp failed, using original:', e); buffer = original; }
    } else {
        try { header = await findHeader(original); } catch (e) { header = null; }
        try { kind = await detectKind(original, header, urlKind); } catch (e) { kind = null; }
        pdfLog('detected kind=' + kind + ' docType=' + shopData.docType + ' headerFlipped=false watermark=false');
        tm.mark('detect only (no stamping)');
    }
    // v2.4.8: when Tekmetric's own header is recognised nothing else is drawn, so don't parse and re-save
    // the whole (already stamped, ~2 MB) PDF on the main thread just to write the same bytes back out.
    if (header) {
        const tempFast = path.join(app.getPath('temp'), `Leaside_RO_${Date.now()}.pdf`);
        await fs.promises.writeFile(tempFast, buffer);
        tm.mark('write temp file', buffer.length + 'B');
        return tempFast;
    }
    const isWorkOrder = kind === 'workorder' || shopData.docType === 'repair';
    const pdfDoc = await PDFDocument.load(buffer);
    const pages = pdfDoc.getPages();
    if (!pages.length) throw new Error('The document has no pages.');
    const firstPage = pages[0];
    // Standard PDF fonts only support WinAnsi characters; strip others (emoji etc.) so drawText can't throw
    const safe = (t) => String(t || '').replace(/[^\x20-\x7E\xA0-\xFF]/g, '');
    
    // Client/vehicle/phone box: only for PDFs that aren't a recognised Tekmetric header
    // (Tekmetric's own header already shows these, and the box would cover it)
    if (!header) {
        const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    
        const boxX = 35;
        const boxY = 660; 
    
        firstPage.drawRectangle({
            x: boxX,
            y: boxY,
            width: 300, 
            height: 60, 
            color: rgb(1, 1, 1), 
        });

        let textY = boxY + 40; 

        if (shopData.customer) {
            firstPage.drawText(`CLIENT: ${safe(shopData.customer).toUpperCase()}`, {
                x: boxX, 
                y: textY, 
                size: 12,
                font: helveticaBold,
                color: rgb(0, 0, 0),
            });
            textY -= 15;
        }
    
        if (shopData.vehicle) {
            firstPage.drawText(`VEHICLE: ${safe(shopData.vehicle).substring(0, 30).toUpperCase()}`, { 
                x: boxX, 
                y: textY, 
                size: 12,
                font: helveticaBold,
                color: rgb(0, 0, 0),
            });
            textY -= 15;
        }
    
        if (shopData.phone) {
            firstPage.drawText(`PHONE: ${safe(shopData.phone)}`, {
                x: boxX, 
                y: textY, 
                size: 12,
                font: helveticaBold,
                color: rgb(0, 0, 0),
            });
        }
    }

    const pdfBytes = await pdfDoc.save();
    tm.mark('client/vehicle box + save (no Tekmetric header found)');
    const tempPath = path.join(app.getPath('temp'), `Leaside_RO_${Date.now()}.pdf`);
    await fs.promises.writeFile(tempPath, pdfBytes);
    tm.mark('write temp file', pdfBytes.length + 'B');
    return tempPath;
}

function validPdfBytes(a) {
    return (a instanceof Uint8Array || Buffer.isBuffer(a)) && a.length > 4 && a.length < 200 * 1024 * 1024;
}
ipcMain.on('modify-pdf-blob', (event, arrayData, shopData) => {
    if (!validPdfBytes(arrayData)) { pdfLog('modify-pdf-blob: ignored invalid data'); return; }
    openPdfForPrint(arrayData, (shopData && typeof shopData === 'object') ? shopData : {});
});

async function openPdfForPrint(arrayData, shopData) {
    const tm = printTimer('print');
    pdfLog(tm.id + ' openPdfForPrint ' + (arrayData && arrayData.length) + ' bytes docType=' + (shopData && shopData.docType));
    try {
        // Start the window now (it is independent of the stamping) so its start-up overlaps the stamp
        const { win: pdfWin, reused } = takePdfWin();
        let tempPath;
        try { tempPath = await processPdfData(arrayData, shopData, tm); }
        catch (e) { if (isAlive(pdfWin)) pdfWin.destroy(); throw e; }
        tm.mark('window ' + (reused ? 'ready (pre-warmed)' : 'created'));
        refillSparePdfWin(1500);

        // The window may still be finishing its about:blank warm-up: only react to the PDF's own load
        const pwc = pdfWin.webContents;
        const onFail = (e, code, desc, u, isMain) => { if (isMain === false || code === -3) return; if (isAlive(pdfWin)) pdfWin.close(); };
        pwc.on('did-fail-load', onFail);
        pdfWin.loadURL(url.pathToFileURL(tempPath).toString()).catch(() => {});

        // fires once for the PDF: don't open a second print dialog if the viewer fires load again
        const onLoad = async () => {
            if (!isAlive(pdfWin)) return;
            if (!/^file:/i.test(pwc.getURL())) return; // about:blank warm-up finished, not our PDF yet
            pwc.removeListener('did-finish-load', onLoad);
            pwc.removeListener('did-fail-load', onFail);
            tm.mark('did-finish-load');
            pdfWin.show();
            const r = await waitPdfViewerReady(pdfWin.webContents, 800, 4000);
            tm.mark('PDF viewer wait: ' + r.how);
            if (!isAlive(pdfWin)) return;
            tm.mark('print() called');
            pdfWin.webContents.print(
                { silent: false, printBackground: true },
                (success, failureReason) => {
                    pdfLog(tm.id + ' print dialog closed success=' + success + (failureReason ? ' reason=' + failureReason : '') + ' (total ' + (Date.now() - tm.t0) + 'ms)');
                    setTimeout(() => {
                        if (!pdfWin.isDestroyed()) pdfWin.close();
                    }, 5000);
                }
            );
        };
        pwc.on('did-finish-load', onLoad);

    } catch (err) {
        pdfLog('openPdfForPrint error: ' + (err && err.stack || err));
        dialog.showErrorBox("PDF Error", (err && err.message) ? err.message : String(err));
    }
}

ipcMain.on('modify-pdf-blob-silent', async (event, arrayData, shopData, copies) => {
    if (!validPdfBytes(arrayData)) return;
    const tm = printTimer('silent-blob');
    try {
        const pdfWin = new BrowserWindow({ 
            show: false, 
            webPreferences: { plugins: true } 
        });
        let tempPath;
        try { tempPath = await processPdfData(arrayData, shopData, tm); }
        catch (e) { if (isAlive(pdfWin)) pdfWin.destroy(); throw e; }
        
        pdfWin.webContents.once('did-fail-load', () => { if (isAlive(pdfWin)) pdfWin.close(); });
        pdfWin.loadURL(url.pathToFileURL(tempPath).toString()).catch(() => {});
        
        pdfWin.webContents.once('did-finish-load', async () => {
            tm.mark('did-finish-load');
            const r = await waitPdfViewerReady(pdfWin.webContents, 1000, 4000);
            tm.mark('PDF viewer wait: ' + r.how);
            if (!isAlive(pdfWin)) return;
            tm.mark('print() called');
            printSilent(pdfWin.webContents,
                { silent: true, printBackground: true, copies: parseInt(copies) || 1, duplexMode: 'longEdge' }, tm,
                (success, failureReason) => {
                    pdfLog(tm.id + ' silent print done success=' + success + (failureReason ? ' reason=' + failureReason : '') + ' (total ' + (Date.now() - tm.t0) + 'ms)');
                    if (failureReason) console.error("Silent Print failed:", failureReason);
                    setTimeout(() => { if (isAlive(pdfWin)) pdfWin.close(); }, 3000);
                }
            );
        });

    } catch (err) {
        console.error("Silent PDF Error:", (err && err.message) ? err.message : err);
    }
});

app.on('will-quit', () => purgeTempFiles());

app.whenReady().then(() => {
    // Inject Chrome standard User-Agent globally to spoof security
    app.userAgentFallback = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
    
    purgeTempFiles();
    installShopDocumentInterceptor(session.fromPartition('persist:tekmetric_session'), 'persist:tekmetric_session');
    installShopDocumentInterceptor(session.defaultSession, 'default');
    app.setAppUserModelId("com.craigsleaside.tekmetricpro");
    session.defaultSession.setSpellCheckerLanguages(['en-CA', 'en-US']);

    protocol.handle('local-resource', (request) => {
        const filePath = decodeURIComponent(request.url.replace(/^local-resource:\/\//, '').split(/[?#]/)[0]).replace(/\/+$/, '');
        const resolved = path.normalize(path.join(__dirname, filePath));
        // Block path traversal: only serve files from inside the app folder
        if (!resolved.startsWith(__dirname + path.sep)) {
            return new Response('Forbidden', { status: 403 });
        }
        return net.fetch(url.pathToFileURL(resolved).toString());
    });
    
    try {
        const s0 = loadSettings();
        pdfLog('=== Tekmetric Pro ' + app.getVersion() + ' started; electron ' + process.versions.electron + '; userData=' + app.getPath('userData') +
            '; log=' + pdfLogPath() + '; invoiceLogoRight=' + s0.invoiceLogoRight + ' workOrderWatermark=' + s0.workOrderWatermark +
            '; portable=' + (process.env.PORTABLE_EXECUTABLE_FILE || 'no'));
    } catch (e) { pdfLog('startup log error: ' + e.message); }
    try {
        // v2.4.8: load pdfjs/pdf-lib and decode + deflate the logo PNGs now, not on the first print
        const wmP = path.join(__dirname, fs.existsSync(path.join(__dirname, 'logo-watermark.png')) ? 'logo-watermark.png' : 'logo.png');
        prewarmPdfWorker({ logoPath: path.join(__dirname, 'logo.png'), watermarkPath: wmP });
    } catch (e) {}
    createWindow();
    setupMenu();
    setTimeout(() => refreshPrinterMenu().catch(() => {}), 2500); // fill the Printer menu without slowing startup
    refillSparePdfWin(4000); // idle hidden window for the print pop-up
    if (canAutoUpdate()) autoUpdater.checkForUpdates().catch(() => {});
});