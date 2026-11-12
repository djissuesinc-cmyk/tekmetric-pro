const { ipcRenderer, webFrame } = require('electron');

const urlParams = new URLSearchParams(window.location.search);
const hiddenCopies = parseInt(urlParams.get('copies')) || 1;
const isHiddenPrinter = window.location.search.includes('hiddenPrinter=true');

let appSettings = ipcRenderer.sendSync('get-settings');
let lastActiveInput = null;

document.addEventListener('focusin', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        lastActiveInput = e.target;
    }
});

function forceNativeInput(el, val, isAutoCaps = false) {
    const activeBefore = document.activeElement;
    const lastValue = el.value;
    const proto = el.tagName === 'INPUT' ? window.HTMLInputElement.prototype : window.HTMLTextAreaElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;

    if (!isAutoCaps) el.focus();
    
    setter.call(el, val);

    if (el._valueTracker) {
        el._valueTracker.setValue(lastValue);
    }

    el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    
    if (!isAutoCaps) {
        el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter' }));
        el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter' }));
        
        setTimeout(() => {
            el.blur();
            if (activeBefore && typeof activeBefore.focus === 'function') {
                activeBefore.focus(); 
            }
        }, 50);
    }
}

const injectText = (textToInsert) => {
    if (lastActiveInput && document.body.contains(lastActiveInput)) {
        let currentVal = (lastActiveInput.value || "").trim();
        
        if (currentVal !== "" && !currentVal.endsWith('+') && !currentVal.endsWith(',')) {
            currentVal += " + ";
        } else if (currentVal !== "") {
            currentVal += " ";
        }
        
        const newVal = currentVal + textToInsert + " + ";
        forceNativeInput(lastActiveInput, newVal);
        lastActiveInput.focus();
    } else {
        alert('Click inside a text box first to inject text.');
    }
};

ipcRenderer.on('settings-changed', (event, newSettings) => {
    appSettings = newSettings;
    
    if (!appSettings.hidePremium) {
        document.querySelectorAll('.leaside-hidden').forEach(el => {
            el.classList.remove('leaside-hidden');
            el.style.removeProperty('display');
        });
    } else {
        cleanUpInterface();
    }
    toggleSidebarVisibility();
});

// v2.4.4: Fill "No Faults" — find finding fields the 2.3.9/2.4.0 way (querySelectorAll
// textarea + forceNativeInput with Enter to commit). Labels from the row (2.4.1 climb +
// glued "Add finding" cleanup), item-specific wording, Rate All Tasks (2.4.3, works live),
// skip Concerns / header search. No card-root gate (that produced rows=0 on the live page).
const NF_GENERIC = 'No faults found at this time.';
const NF_CLICK = 'button, a, [role="button"], [role="radio"], [role="menuitem"], [role="option"], [role="tab"], input[type="button"], input[type="radio"], input[type="checkbox"]';
const NF_FIELD = 'textarea, input[type="text"], input[type="search"], input:not([type]), [contenteditable="true"], [contenteditable=""]';
const NF_RATE_ARIA = /checked|okay|\bok\b|attention|immediate|not applicable|n\/a|pass|fail|good|fair|poor|satisfactory|green|yellow|red|warning|needs?\s*(work|attention)|approved/i;
const NF_SKIP_TEXT = /^(notes?|findings?|comments?|recommendations?|technician notes?|tech notes?|add (a )?(note|finding|comment)s?|details?|description|good|fair|poor|ok|pass(ed)?|fail(ed)?|green|yellow|red|needs attention|attention|urgent|not inspected|n\/a|na|none|inspection|inspections|status|condition|select|save|cancel|edit|delete|remove|photo|photos|video|media|upload|rating|inspection task|rate all tasks|checked\s*(&|and)\s*okay|requires attention soon|requires immediate attention|not applicable|type here.*|enter .*|write .*|search tekmetric.*|search)$/i;
const NF_SECTION = /^(interior|exterior|under hood|starting\/?charging(\s+system)?|steering and suspension|brakes|under vehicle|fluid leaks\s*\(\s*general\s*\)|other faults not listed|30 point vehicle inspection|rate all tasks|concerns?|customer concerns?)$/i;
const NF_CARD_RE = /rate all tasks|30\s*point\s*(vehicle\s*)?inspection|\binspection task\b/i;
const NF_GREEN_RE = /checked\s*(&|and)?\s*ok(ay)?|\bokay\b|\bgood\b|\bpass(ed)?\b|\bgreen\b|\bcheck(ed)?\b/i;
const NF_MENU_SEL = '[role="listbox"], [role="menu"], .MuiMenu-list, .MuiList-root[role], ul.MuiMenu-list, .MuiPopover-root [role="listbox"], .MuiModal-root [role="listbox"]';
const NF_PORTAL_SEL = '.MuiPopover-root, .MuiModal-root, .MuiDialog-root, .MuiPopper-root, [role="dialog"], [role="presentation"] .MuiPaper-root';

let nfBusy = false;
let nfSuppressAutoCaps = false;
let nfBook = null;
let nfLogBuf = [];
let nfLogTimer = null;
let nfMaxSlice = 0;
let nfSliceStart = 0;

// ---- v2.4.3 allow-list: never click/focus/write outside the inspection card ----
const NF_CONCERNS_MARK = /add\s*concern|client\s*concerns?|customer\s*concerns?/i;
const NF_CONCERNS_HEAD = /^(add\s*concern|client\s*concerns?|customer\s*concerns?|concerns?)$/i;
const NF_INSPECT_HDR = /\binspection task\b|30\s*point\s*(vehicle\s*)?inspection/i;
const NF_RATE_ALL_RE = /rate all tasks/i;

let nfActiveCard = null;
let nfConcernsRoots = [];
let nfAllowedPortals = new Set();

function nfIsHeaderOrSearch(el) {
    if (!el) return false;
    if (nfIsSearchBox(el)) return true;
    try { if (el.closest && el.closest('header, [role="banner"], [role="search"], nav')) return true; } catch (e) {}
    return false;
}

function nfElementMarkText(el, max) {
    if (!el) return '';
    return [
        nfOwnTextCheap(el, max || 48),
        el.getAttribute && el.getAttribute('aria-label'),
        el.getAttribute && el.getAttribute('title'),
        el.getAttribute && el.getAttribute('placeholder')
    ].join(' ').replace(/\s+/g, ' ').trim();
}

function nfScanMarks(root, pred, cap) {
    const out = [];
    if (!root || !root.querySelectorAll) return out;
    let els;
    try { els = root.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"],button,a,[role="button"],[role="link"],label'); } catch (e) { return out; }
    const n = Math.min(els.length, cap || 250);
    for (let i = 0; i < n; i++) {
        try {
            if (pred(nfElementMarkText(els[i], 48), els[i])) out.push(els[i]);
        } catch (e) {}
    }
    return out;
}

function nfHasConcernsMarker(el) {
    if (!el) return false;
    return nfScanMarks(el, (t) => NF_CONCERNS_HEAD.test(t) || NF_CONCERNS_MARK.test(t), 250).length > 0;
}

function nfHasInspectHeader(el) {
    if (!el) return false;
    return nfFindText(el, NF_INSPECT_HDR, 3000).length > 0;
}

function nfHasRateAll(el) {
    if (!el) return false;
    if (nfFindText(el, NF_RATE_ALL_RE, 3000).length) return true;
    return nfScanMarks(el, (t) => NF_RATE_ALL_RE.test(t), 250).length > 0;
}

function nfRefreshConcernsRoots() {
    const marks = [];
    try {
        const heads = document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"],button,a,[role="button"],[role="link"],label');
        const cap = Math.min(heads.length, 400);
        for (let i = 0; i < cap; i++) {
            const t = nfElementMarkText(heads[i], 48);
            if (NF_CONCERNS_HEAD.test(t) || NF_CONCERNS_MARK.test(t)) marks.push(heads[i]);
        }
    } catch (e) {}
    try {
        nfFindText(document.body, NF_CONCERNS_MARK, 4000).forEach(n => { if (n.parentElement) marks.push(n.parentElement); });
    } catch (e) {}
    const roots = [];
    const seen = new Set();
    for (const m of marks) {
        let el = m;
        let best = m;
        for (let i = 0; i < 12 && el && el !== document.body && el !== document.documentElement; i++) {
            // Stop before a shared parent that also holds Rate All / Inspection Task.
            if (el !== m && (nfHasInspectHeader(el) || nfHasRateAll(el))) break;
            best = el;
            el = el.parentElement;
        }
        if (best && best !== document.body && best !== document.documentElement && !seen.has(best)) {
            seen.add(best);
            roots.push(best);
        }
    }
    // Keep inner roots (the Concerns section, not a huge wrapper).
    nfConcernsRoots = roots.filter(r => !roots.some(o => o !== r && r.contains(o)));
    return nfConcernsRoots;
}

function nfInConcerns(el) {
    if (!el) return false;
    try {
        for (const r of nfConcernsRoots) {
            if (r && (r === el || (r.contains && r.contains(el)))) return true;
        }
    } catch (e) {}
    // Fallback: only the element itself (or a heading/button ancestor) with its OWN
    // short label. Do NOT use a large parent's concatenated text — that would mark
    // every inspection control "in concerns" because the shared page also says
    // "Customer Concerns".
    try {
        let n = el;
        for (let i = 0; i < 8 && n && n !== document.body && n !== document.documentElement; i++) {
            let isMark = false;
            try { isMark = n.matches && n.matches('h1,h2,h3,h4,h5,h6,[role="heading"],button,a,[role="button"],[role="link"],label'); } catch (e) {}
            if (isMark) {
                const t = nfElementMarkText(n, 48);
                if (NF_CONCERNS_HEAD.test(t) || NF_CONCERNS_MARK.test(t)) return true;
            }
            n = n.parentElement;
        }
    } catch (e) {}
    return false;
}

function nfInAllowedPortal(el) {
    if (!el || !nfAllowedPortals.size) return false;
    try {
        for (const p of nfAllowedPortals) {
            if (p === el || (p.contains && p.contains(el))) return true;
        }
    } catch (e) {}
    return false;
}

function nfDenyReason(el, opts) {
    opts = opts || {};
    if (!el) return 'no-target';
    if (nfIsHeaderOrSearch(el)) return 'header/search';
    if (nfInConcerns(el)) return 'in concerns';
    // 2.4.3 required card.contains(el). The live card root was often just the
    // header bar (title + Rate All, no rows) or a page wrapper; every finding
    // was then refused (rows=0). Guards are Concerns + header/search only.
    if (opts.portal && nfInAllowedPortal(el)) return '';
    return '';
}

function nfIsAllowed(el, opts) {
    return nfDenyReason(el, opts) === '';
}

function nfAllow(el, reason, opts) {
    if (nfIsAllowed(el, opts)) return true;
    nfLog('skip ' + (reason || 'action') + ': ' + nfDenyReason(el, opts) + ' ' + nfDescribe(el));
    return false;
}

function nfSnapshotDom() {
    const s = new Set();
    try {
        document.querySelectorAll(
            NF_PORTAL_SEL + ',' + NF_MENU_SEL + ', [role="menuitem"], [role="option"], textarea, input, [contenteditable="true"], [contenteditable=""]'
        ).forEach(el => s.add(el));
    } catch (e) {}
    return s;
}

function nfGrantNewPortals(before) {
    const granted = [];
    try {
        document.querySelectorAll(NF_PORTAL_SEL + ',' + NF_MENU_SEL).forEach(el => {
            if (before.has(el) || nfInConcerns(el)) return;
            nfAllowedPortals.add(el);
            granted.push(el);
        });
        document.querySelectorAll('textarea, input[type="text"], input:not([type]), [contenteditable="true"], [contenteditable=""]').forEach(el => {
            if (before.has(el) || nfInConcerns(el) || nfIsSearchBox(el) || nfIsHeaderOrSearch(el)) return;
            nfAllowedPortals.add(el);
            granted.push(el);
        });
    } catch (e) {}
    return granted;
}

function nfResetAllowList() {
    nfActiveCard = null;
    nfConcernsRoots = [];
    nfAllowedPortals = new Set();
}

function nfSleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function nfMarkSlice() {
    const n = performance.now() - nfSliceStart;
    if (n > nfMaxSlice) nfMaxSlice = n;
}

async function nfYield() {
    nfMarkSlice();
    await new Promise(r => setTimeout(r, 0));
    nfSliceStart = performance.now();
}

function nfLog(msg) {
    const line = String(msg || '');
    const out = line.startsWith('no-faults') ? line : ('no-faults ' + line);
    try { console.log('[tekpro-nf] ' + out); } catch (e) {}
    nfLogBuf.push(out);
    if (!nfLogTimer) nfLogTimer = setTimeout(nfLogFlush, 40);
}

function nfLogFlush() {
    nfLogTimer = null;
    if (!nfLogBuf.length) return;
    const batch = nfLogBuf.splice(0, nfLogBuf.length);
    try { ipcRenderer.send('inspection-phrases-log', batch); } catch (e) {}
}

async function nfInvoke(req) {
    try { return await ipcRenderer.invoke('inspection-phrases', req); }
    catch (e) {
        try { return ipcRenderer.sendSync('inspection-phrases', req); }
        catch (e2) { nfLog('ipc error: ' + (e && e.message)); return null; }
    }
}

async function nfLoadBook() {
    if (nfBook) return nfBook;
    const b = await nfInvoke({ action: 'book' });
    const sentences = new Set(((b && b.sentences) || []).map(nfNorm));
    sentences.add(nfNorm(NF_GENERIC));
    nfBook = { generic: nfNorm((b && b.generic) || NF_GENERIC), sentences };
    return nfBook;
}

function nfNorm(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase(); }

function nfIsGenerated(value) {
    const raw = String(value == null ? '' : value).replace(/\r\n?/g, '\n').trim();
    if (!raw) return false;
    const n = nfNorm(raw);
    if (n === nfNorm(NF_GENERIC)) return true;
    if (nfBook) {
        if (n === nfBook.generic || nfBook.sentences.has(n)) return true;
        const nl = raw.indexOf('\n');
        if (nl >= 0) {
            const body = nfNorm(raw.slice(nl + 1));
            if (nfBook.sentences.has(body) || body === nfBook.generic) return true;
        }
    }
    return false;
}

function nfOwnTextCheap(el, max) {
    if (!el) return '';
    let s = '';
    const cap = max || 80;
    const walk = (node, depth) => {
        if (s.length >= cap || depth > 4) return;
        if (node.nodeType === 3) { s += node.nodeValue; return; }
        if (node.nodeType !== 1) return;
        try { if (node.matches && node.matches('script,style,svg,textarea,input,select,img')) return; } catch (e) {}
        const kids = node.childNodes;
        for (let i = 0; i < kids.length; i++) walk(kids[i], depth + 1);
    };
    walk(el, 0);
    return s.replace(/\s+/g, ' ').trim();
}

function nfFindText(root, re, maxVisit) {
    const hits = [];
    if (!root) return hits;
    try {
        const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
        let n, visits = 0, cap = maxVisit || 6000;
        while ((n = tw.nextNode()) && visits++ < cap) {
            const t = n.nodeValue;
            if (t && re.test(t)) hits.push(n);
        }
    } catch (e) {}
    return hits;
}

function nfHtmlSnippet(el, n) {
    if (!el) return '';
    try {
        // Shallow only — el.outerHTML on a large tree (the card, the body) would freeze the renderer.
        const open = el.cloneNode(false);
        const kids = [];
        const max = Math.min(el.children ? el.children.length : 0, 4);
        for (let i = 0; i < max; i++) {
            const c = el.children[i];
            kids.push((c.tagName || '') + (c.id ? '#' + c.id : '') + (typeof c.className === 'string' && c.className ? '.' + c.className.split(/\s+/)[0] : ''));
        }
        const text = nfOwnTextCheap(el, 80);
        return ((open.outerHTML || el.tagName) + ' kids[' + (el.children ? el.children.length : 0) + ']=' + kids.join(',') + ' text=' + JSON.stringify(text)).replace(/\s+/g, ' ').slice(0, n || 300);
    } catch (e) { return (el.tagName || '') + ''; }
}

function nfDescribe(el) {
    if (!el || !el.tagName) return String(el == null ? '' : el);
    const cls = (typeof el.className === 'string' ? el.className : '').split(/\s+/).filter(Boolean).slice(0, 4).join('.');
    return el.tagName.toLowerCase()
        + (el.id ? '#' + el.id : '')
        + (cls ? '.' + cls : '')
        + ' role=' + (el.getAttribute('role') || '-')
        + ' aria=' + (el.getAttribute('aria-label') || el.getAttribute('aria-haspopup') || '-')
        + ' ph=' + (el.getAttribute('placeholder') || '-')
        + ' kids=' + (el.children ? el.children.length : 0);
}

function nfIsVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    try {
        const r = el.getBoundingClientRect();
        if (r.width < 2 && r.height < 2) return false;
        const s = window.getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
    } catch (e) { return true; }
    return true;
}

function nfIsSearchBox(el) {
    if (!el) return false;
    const bits = [
        el.getAttribute && el.getAttribute('placeholder'),
        el.getAttribute && el.getAttribute('aria-label'),
        el.getAttribute && el.getAttribute('title'),
        el.getAttribute && el.getAttribute('name'),
        el.id, el.className
    ].join(' ');
    if (/search/i.test(bits)) return true;
    try { if (el.closest && el.closest('header, [role="banner"], [role="search"], nav')) return true; } catch (e) {}
    return false;
}

function nfIsConcernsRow(row) {
    if (!row) return false;
    if (nfInConcerns(row)) return true;
    const t = nfOwnTextCheap(row, 160);
    // Live Concerns rows have "Add media" and "Edit" next to "Add finding". Inspection rows do not.
    if (/add\s*media/i.test(t)) return true;
    if (/add\s*concern/i.test(t)) return true;
    try {
        // Only look at a tight neighbourhood (previous siblings / parent heading).
        // Do NOT querySelector a heading anywhere in body — that would match the
        // page's "Concerns" section and reject every inspection row.
        let el = row;
        for (let i = 0; i < 3 && el && el !== document.body && el !== document.documentElement; i++) {
            for (const c of el.children || []) {
                if (/^H[1-6]$/.test(c.tagName) || (c.getAttribute && c.getAttribute('role') === 'heading')) {
                    if (NF_CONCERNS_HEAD.test(nfOwnTextCheap(c, 40))) return true;
                }
            }
            const prev = el.previousElementSibling;
            if (prev && NF_CONCERNS_HEAD.test(nfOwnTextCheap(prev, 40))) return true;
            el = el.parentElement;
        }
    } catch (e) {}
    return false;
}

function nfIsContentEditable(el) {
    if (!el) return false;
    if (el.isContentEditable) return true;
    const c = el.getAttribute && el.getAttribute('contenteditable');
    return c === 'true' || c === '';
}

function nfFieldValue(el) {
    if (!el) return '';
    if (nfIsContentEditable(el)) return String(el.innerText || el.textContent || '').trim();
    return String(el.value == null ? '' : el.value).trim();
}

function nfIsField(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.disabled || el.readOnly) return false;
    const type = (el.type || '').toLowerCase();
    if (['button', 'submit', 'checkbox', 'radio', 'hidden', 'file', 'password', 'color', 'range', 'number', 'date', 'email'].includes(type)) return false;
    if (nfIsSearchBox(el)) return false;
    if (el.matches && el.matches(NF_FIELD)) return true;
    return nfIsContentEditable(el);
}

function nfFields(root) {
    const scope = root || document;
    if (!scope.querySelectorAll) return [];
    return Array.from(scope.querySelectorAll(NF_FIELD)).filter(nfIsField);
}

function nfVisibleFields(root) {
    return nfFields(root).filter(nfIsVisible);
}

async function nfPointer(el, reason) {
    if (!el) return false;
    if (!nfAllow(el, reason || 'pointer', { portal: true })) return false;
    // Isolated-world dispatchEvent often does not reach page-world React/MUI listeners.
    // Run the pointer sequence in the page world, then also call native click().
    const mark = 'data-tekpro-nf-ptr';
    try { el.setAttribute(mark, '1'); } catch (e) {}
    try {
        if (webFrame && typeof webFrame.executeJavaScript === 'function') {
            await webFrame.executeJavaScript(`(() => {
                const el = document.querySelector('[data-tekpro-nf-ptr="1"]');
                if (!el) return 'no-el';
                el.removeAttribute('data-tekpro-nf-ptr');
                try { el.focus(); } catch (e) {}
                const r = el.getBoundingClientRect();
                const cx = r.left + Math.max(4, Math.min(r.width, 24) / 2);
                const cy = r.top + Math.max(4, Math.min(r.height, 24) / 2);
                const down = { bubbles: true, cancelable: true, composed: true, view: window, button: 0, buttons: 1, clientX: cx, clientY: cy };
                try { el.dispatchEvent(new PointerEvent('pointerdown', Object.assign({ pointerId: 1, pointerType: 'mouse', isPrimary: true }, down))); } catch (e) {}
                try { el.dispatchEvent(new MouseEvent('mousedown', down)); } catch (e) {}
                try { el.dispatchEvent(new PointerEvent('pointerup', Object.assign({ pointerId: 1, pointerType: 'mouse', isPrimary: true, buttons: 0 }, down))); } catch (e) {}
                try { el.dispatchEvent(new MouseEvent('mouseup', Object.assign({}, down, { buttons: 0 }))); } catch (e) {}
                try { el.dispatchEvent(new MouseEvent('click', Object.assign({}, down, { buttons: 0 }))); } catch (e) { try { el.click(); } catch (e2) {} }
                return 'ok';
            })()`);
        } else {
            try { el.removeAttribute(mark); } catch (e) {}
            try { el.click(); } catch (e) {}
        }
    } catch (e) {
        try { el.removeAttribute(mark); } catch (e2) {}
        try { el.click(); } catch (e3) {}
    }
    nfSliceStart = performance.now();
    return true;
}

function nfWait(fn, timeout, interval) {
    timeout = timeout == null ? 500 : timeout;
    interval = interval == null ? 40 : interval;
    return new Promise(resolve => {
        const start = Date.now();
        const tick = () => {
            nfSliceStart = performance.now();
            try {
                const v = fn();
                if (v) { nfSliceStart = performance.now(); return resolve(v); }
            } catch (e) {}
            if (Date.now() - start >= timeout) { nfSliceStart = performance.now(); return resolve(null); }
            setTimeout(tick, interval);
        };
        tick();
    });
}

function nfLooksLikeRating(el) {
    const t = ((el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || '') + ' ' + (el.getAttribute('data-testid') || '') + ' ' + nfOwnTextCheap(el, 40)).replace(/\s+/g, ' ').trim();
    return NF_RATE_ARIA.test(t);
}

// Shallow: group clickable children by parent. If root is huge (the whole card),
// bail with a "many" signal so we do not treat the card as a single row.
function nfRatingClusters(root) {
    if (!root || !root.querySelectorAll) return [];
    let btns;
    try { btns = root.querySelectorAll('button, [role="button"], [role="radio"]'); } catch (e) { return []; }
    if (btns.length > 160) return [{ many: true }, { many: true }];
    const groups = new Map();
    for (const c of btns) {
        const p = c.parentElement;
        if (!p) continue;
        if (!groups.has(p)) groups.set(p, []);
        groups.get(p).push(c);
    }
    const out = [];
    for (const [p, list] of groups) {
        if (list.length < 3 || list.length > 6) continue;
        const ratingish = list.filter(b => nfLooksLikeRating(b) || (nfOwnTextCheap(b, 8).length <= 2));
        if (ratingish.length >= 3 || list.length === 4) out.push({ parent: p, buttons: list });
    }
    return out;
}

function nfIsSelected(btn) {
    if (!btn) return false;
    const attrs = [
        btn.getAttribute('aria-pressed'),
        btn.getAttribute('aria-checked'),
        btn.getAttribute('aria-selected'),
        btn.getAttribute('data-checked'),
        btn.getAttribute('data-selected'),
        btn.getAttribute('data-state')
    ];
    if (attrs.some(a => a && /^(true|checked|selected|on)$/i.test(a))) return true;
    if (attrs.some(a => a && /^(false|off|unchecked)$/i.test(a))) return false;
    const cls = (typeof btn.className === 'string' ? btn.className : (btn.className && btn.className.baseVal) || '').toLowerCase();
    if (/\b(selected|active|checked|mui-selected|mui-checked|is-selected|is-checked|is-active)\b/.test(cls)) return true;
    try {
        const s = window.getComputedStyle(btn);
        const m = (s.backgroundColor || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (m) {
            const r = +m[1], g = +m[2], b = +m[3], a = (s.backgroundColor || '').includes('rgba') ? parseFloat((s.backgroundColor.split(',')[3] || '1')) : 1;
            // Filled green (not a transparent / outline-only button)
            if (a > 0.4 && g > 100 && g > r * 1.15 && g > b * 1.15) return true;
        }
        const svg = btn.querySelector && btn.querySelector('svg, path, circle');
        if (svg) {
            const f = (window.getComputedStyle(svg).fill || svg.getAttribute('fill') || '');
            const m2 = f.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
            if (m2) {
                const r = +m2[1], g = +m2[2], b = +m2[3];
                if (g > 100 && g > r * 1.15 && g > b * 1.15) return true;
            }
        }
    } catch (e) {}
    return false;
}

function nfFindAddFinding(root) {
    if (!root || !root.querySelectorAll) return null;
    let els;
    try { els = root.querySelectorAll('a, button, [role="button"], [role="link"]'); } catch (e) { return null; }
    let exact = null, loose = null;
    for (const el of els) {
        const t = nfOwnTextCheap(el, 40);
        if (/^add finding$/i.test(t)) { exact = el; break; }
        if (!loose && /add finding/i.test(t) && t.length < 40) loose = el;
    }
    return exact || loose;
}

// Climb until the ancestor contains BOTH a rating cluster and the start node.
// Do not stop at an inner [role=row] / tr that only has the name + "Add finding".
function nfClosestRow(start, card) {
    if (!start) return null;
    let el = start;
    for (let i = 0; i < 20 && el && el !== document.documentElement; i++) {
        const p = el.parentElement || el;
        if (!p || p === document.body || p === document.documentElement) break;
        if (card && p !== card && !card.contains(p)) break;
        const clusters = nfRatingClusters(p);
        if (clusters.length === 1 && !clusters[0].many && p.children && p.children.length >= 2) return p;
        if (clusters.length > 1 || (clusters[0] && clusters[0].many)) {
            // Walked past a single row into the card — give up rather than returning the card.
            break;
        }
        if (p === card) break;
        el = p;
    }
    return null;
}

function nfStripNoise(s) {
    return String(s || '')
        .replace(/add\s*finding/ig, ' ')
        .replace(/add\s*media/ig, ' ')
        .replace(/\b(rating|inspection task|findings|edit)\b/ig, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function nfCellText(el, field) {
    if (!el) return '';
    let t = '';
    const skip = 'button, textarea, input, select, svg, script, style, img, [role="button"], [role="radio"], [role="menuitem"], [contenteditable], [contenteditable="true"]';
    const walk = (n, depth) => {
        if (!n || depth > 12 || t.length > 200) return;
        if (n === field) return;
        if (n.nodeType === 3) { t += n.nodeValue; return; }
        if (n.nodeType !== 1) return;
        try { if (n.matches && n.matches(skip)) return; } catch (e) {}
        for (const c of n.childNodes) walk(c, depth + 1);
    };
    walk(el, 0);
    return nfStripNoise(t);
}

function nfCleanLabel(t) {
    const s = nfStripNoise(t).replace(/[:*\u2022\-–—\s]+$/, '').replace(/^[\d.)\s\-–—\u2022]+(?=[a-z])/i, '').trim();
    if (s.length < 2 || s.length > 120 || !/[a-z]/i.test(s) || NF_SKIP_TEXT.test(s) || NF_SECTION.test(s)) return '';
    if (/^search\b/i.test(s)) return '';
    return s;
}

function getInspectionLabel(ta, rowHint) {
    try {
        const direct = [];
        if (ta && ta.getAttribute) {
            const lb = ta.getAttribute('aria-labelledby');
            if (lb) direct.push(lb.split(/\s+/).map(id => { const e = document.getElementById(id); return e ? nfOwnTextCheap(e, 80) : ''; }).join(' '));
            direct.push(ta.getAttribute('aria-label'));
            if (ta.id) { try { const l = document.querySelector('label[for="' + CSS.escape(ta.id) + '"]'); if (l) direct.push(nfOwnTextCheap(l, 80)); } catch (e) {} }
            direct.push(ta.getAttribute('placeholder'), ta.getAttribute('title'), ta.getAttribute('name'));
        }
        for (const d of direct) { const c = nfCleanLabel(d); if (c && !/^add finding$/i.test(c) && !/^search\b/i.test(c)) return c; }

        const row = rowHint || nfClosestRow(ta);
        if (row) {
            const kids = Array.from(row.children);
            const clusters = nfRatingClusters(row);
            const rateEl = clusters[0] && clusters[0].parent;
            const findingIdx = kids.findIndex(k => (ta && k.contains(ta)) || nfFindAddFinding(k) || (k.querySelector && k.querySelector(NF_FIELD)));
            const candidates = [];
            kids.forEach((k, i) => {
                if (i === findingIdx) return;
                const text = nfCleanLabel(nfCellText(k, ta));
                if (text) candidates.push(text);
            });
            const rateIdx = rateEl ? kids.findIndex(k => k === rateEl || k.contains(rateEl)) : -1;
            if (rateIdx >= 0 && rateIdx !== findingIdx) {
                const shared = nfCleanLabel(nfCellText(kids[rateIdx], ta));
                if (shared) candidates.unshift(shared);
            }
            for (const c of candidates) { if (c && !NF_SECTION.test(c)) return c; }
            const all = nfCleanLabel(nfCellText(row, ta));
            if (all && !NF_SECTION.test(all)) return all;
        }
    } catch (e) { nfLog('label error: ' + (e && e.message)); }
    return '';
}

function nfLooksLikeCard(el) {
    if (!el || el === document.body || el === document.documentElement) return false;
    // A card is the smallest ancestor of "Rate All Tasks" / "30 POINT..." that has
    // several inspection rows: 3+ "Add finding" buttons OR 3+ rating clusters.
    // Do not require "Add finding" — some sheets already have open textareas.
    const clusters = nfRatingClusters(el);
    if (clusters.length >= 3 || (clusters[0] && clusters[0].many)) return true;
    let adds = 0;
    let btns;
    try { btns = el.querySelectorAll('button, a, [role="button"], [role="link"]'); } catch (e) { return false; }
    if (btns.length > 800) return false;
    for (const b of btns) {
        if (/^add finding$/i.test(nfOwnTextCheap(b, 32))) {
            adds++;
            if (adds >= 3) return true;
        }
    }
    return false;
}

function nfFindCard() {
    nfRefreshConcernsRoots();
    // Document-wide text search is only used to LOCATE the card, never as a click/write scope.
    const starts = [];
    try {
        nfFindText(document.body, NF_RATE_ALL_RE, 5000).forEach(n => starts.push(n.parentElement || n));
        nfFindText(document.body, NF_INSPECT_HDR, 5000).forEach(n => starts.push(n.parentElement || n));
        nfScanMarks(document.body, (t) => NF_RATE_ALL_RE.test(t) || NF_INSPECT_HDR.test(t), 400).forEach(el => starts.push(el));
    } catch (e) {}
    let bestClean = null, cleanSize = Infinity;
    let bestDirty = null, dirtySize = Infinity;
    const consider = (el, dirty) => {
        if (!el || el === document.body || el === document.documentElement) return;
        let size = 0;
        try { size = el.querySelectorAll('button, a, [role="button"]').length; } catch (e) { size = 99999; }
        if (dirty) {
            if (size < dirtySize && size >= 2) { bestDirty = el; dirtySize = size; }
        } else if (size < cleanSize && size >= 2) { bestClean = el; cleanSize = size; }
    };
    const seen = new Set();
    for (const start of starts) {
        let el = start;
        for (let i = 0; i < 16 && el && el !== document.body && el !== document.documentElement; i++) {
            if (seen.has(el)) { el = el.parentElement; continue; }
            seen.add(el);
            const hasRate = nfHasRateAll(el);
            const hasInsp = nfHasInspectHeader(el);
            const hasConc = nfHasConcernsMarker(el);
            // A usable root has the Inspection Task / 30 POINT header (Rate All may have been removed).
            // Prefer a root that does NOT contain Add Concern / Customer / Client Concerns.
            if (hasInsp && (hasRate || nfLooksLikeCard(el))) {
                if (!hasConc) consider(el, false);
                else { consider(el, true); break; }
            } else if (hasConc && (hasInsp || hasRate)) {
                consider(el, true);
                break;
            }
            el = el.parentElement;
        }
    }
    if (bestClean) return bestClean;
    if (bestDirty) {
        nfLog('card shares a parent with concerns; concerns region will be excluded html=' + JSON.stringify(nfHtmlSnippet(bestDirty, 200)));
        return bestDirty;
    }
    return null;
}

function nfFindRows(card) {
    if (!card) return [];
    const root = card;
    const starts = [];
    // Only start from Add-finding controls and finding fields INSIDE the card.
    // Never from the global search box, the header, or Concerns.
    try {
        const adds = root.querySelectorAll('a, button, [role="button"], [role="link"]');
        for (const el of adds) {
            if (nfInConcerns(el) || nfIsHeaderOrSearch(el)) continue;
            if (/^add finding$/i.test(nfOwnTextCheap(el, 32))) starts.push(el);
        }
    } catch (e) {}
    nfFields(root).forEach(el => {
        if (!nfIsSearchBox(el) && !nfInConcerns(el) && !nfIsHeaderOrSearch(el)) starts.push(el);
    });
    const rows = [];
    const seen = new Set();
    for (const s of starts) {
        const row = nfClosestRow(s, card);
        if (!row) continue;
        if (seen.has(row)) continue;
        if (nfIsConcernsRow(row) || nfInConcerns(row)) continue;
        if (!(row === card || (card.contains && card.contains(row)))) continue;
        seen.add(row);
        rows.push(row);
    }
    rows.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1);
    return rows;
}

function nfLogRowChain(row, tag) {
    try {
        let el = row;
        for (let i = 0; i < 6 && el && el !== document.documentElement; i++) {
            nfLog((tag || 'row-chain') + ' #' + i + ' ' + nfDescribe(el) + ' ratings=' + nfRatingClusters(el).length + ' html=' + JSON.stringify(nfHtmlSnippet(el, 300)));
            el = el.parentElement;
        }
    } catch (e) { nfLog('row-chain error: ' + (e && e.message)); }
}

async function nfSetValue(el, val) {
    if (!nfAllow(el, 'write', { portal: true })) return false;
    try {
        if (nfIsContentEditable(el)) {
            el.focus();
            el.textContent = val;
            try { el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, data: val, inputType: 'insertText' })); }
            catch (e) { el.dispatchEvent(new Event('input', { bubbles: true, composed: true })); }
            el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
            await nfSleep(40);
            try { el.blur(); } catch (e) {}
            await nfSleep(40);
            return true;
        }
        const lastValue = el.value;
        const proto = el.tagName === 'INPUT' ? window.HTMLInputElement.prototype : window.HTMLTextAreaElement.prototype;
        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
        const setter = desc && desc.set;
        el.focus();
        if (setter) setter.call(el, val); else el.value = val;
        if (el._valueTracker) el._valueTracker.setValue(lastValue);
        el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        await nfSleep(40);
        try { el.blur(); } catch (e) {}
        await nfSleep(40);
        return true;
    } catch (e) {
        nfLog('set-value error: ' + (e && e.message));
        return false;
    }
}

function nfAssociatedControl(from) {
    if (!from) return null;
    const sel = 'select, [role="button"][aria-haspopup], [aria-haspopup="listbox"], [aria-haspopup="true"], [aria-haspopup="menu"], [class*="MuiSelect"], [class*="MuiInputBase-root"]';
    let el = from;
    for (let i = 0; i < 8 && el; i++) {
        try {
            if (el.matches && el.matches(sel)) return el;
            if (el.tagName === 'BUTTON' || (el.getAttribute && el.getAttribute('role') === 'button')) return el;
            const inner = el.querySelector && el.querySelector(sel);
            if (inner) return inner;
            const sibs = [el.nextElementSibling, el.previousElementSibling];
            for (const sib of sibs) {
                if (!sib) continue;
                if (sib.matches && sib.matches(sel)) return sib;
                const sInner = sib.querySelector && sib.querySelector(sel);
                if (sInner) return sInner;
            }
        } catch (e) {}
        el = el.parentElement;
    }
    return from.closest && (from.closest('button, [role="button"], [aria-haspopup], select')) || from;
}

function nfFindAllRateAllControls() {
    const out = [];
    const seen = new Set();
    const consider = (host) => {
        if (!host) return;
        const control = nfAssociatedControl(host) || host;
        if (!control || seen.has(control)) return;
        if (nfInConcerns(control) || nfInConcerns(host)) return;
        seen.add(control);
        out.push(control);
    };
    try {
        nfFindText(document.body, /rate all tasks/i, 20000).forEach(n => consider(n.parentElement || n));
        nfScanMarks(document.body, (t) => /rate all tasks/i.test(t), 800).forEach(consider);
    } catch (e) {}
    return out;
}

function nfFindRateAllControl(card) {
    // Prefer a scope if the caller has one, but never refuse to look document-wide —
    // a wrong card root (header bar) would hide the button that 2.4.3 already found live.
    const root = (card && card.querySelectorAll) ? card : document.body;
    const info = { how: '', tag: '', role: '', text: '', aria: '', haspopup: '' };
    const hits = nfFindText(root, /rate all tasks/i, 20000);
    if (hits.length) {
        const node = hits[0];
        const host = node.parentElement || node;
        const control = nfAssociatedControl(host);
        info.how = 'text-node';
        if (control) {
            info.tag = control.tagName;
            info.role = control.getAttribute('role') || '';
            info.text = nfOwnTextCheap(control, 80) || nfOwnTextCheap(host, 80);
            info.aria = control.getAttribute('aria-label') || '';
            info.haspopup = control.getAttribute('aria-haspopup') || '';
            if (nfInConcerns(control) || nfIsHeaderOrSearch(control)) {
                nfLog('rate-all: ignoring control in concerns/header ' + nfDescribe(control));
            } else {
                return { control, info };
            }
        }
    }
    // 2) aria-label / placeholder / title on a compact set of controls
    try {
        const cands = (root).querySelectorAll('button, [role="button"], [aria-haspopup], select, label, [class*="MuiSelect"], [class*="MuiInputBase"]');
        for (const el of cands) {
            const t = [
                nfOwnTextCheap(el, 80),
                el.getAttribute('aria-label'),
                el.getAttribute('placeholder'),
                el.getAttribute('title'),
                el.getAttribute('name')
            ].join(' ');
            if (/rate all tasks/i.test(t)) {
                const control = el.tagName === 'LABEL' ? nfAssociatedControl(el) : (el.matches('select, [role="button"], [aria-haspopup], button') ? el : nfAssociatedControl(el));
                info.how = 'aria';
                info.tag = (control || el).tagName;
                info.role = (control || el).getAttribute('role') || '';
                info.text = t.slice(0, 80);
                info.aria = (control || el).getAttribute('aria-label') || '';
                info.haspopup = (control || el).getAttribute('aria-haspopup') || '';
                const use = control || el;
                if (nfInConcerns(use) || nfIsHeaderOrSearch(use)) {
                    nfLog('rate-all: ignoring control in concerns/header ' + nfDescribe(use));
                } else {
                    return { control: use, info };
                }
            }
        }
    } catch (e) {}
    return { control: null, info: { how: 'not-found' } };
}

async function nfRateAllGreenOn(control) {
    if (!control) return false;
    nfLog('rate-all: ' + JSON.stringify({
        how: 'text-node',
        tag: control.tagName,
        role: control.getAttribute('role') || '',
        text: nfOwnTextCheap(control, 80),
        aria: control.getAttribute('aria-label') || '',
        haspopup: control.getAttribute('aria-haspopup') || ''
    }) + ' desc=' + nfDescribe(control));
    if (nfInConcerns(control) || nfIsHeaderOrSearch(control) && !/rate all tasks/i.test(nfElementMarkText(control, 80))) {
        nfLog('rate-all: skipping control in concerns/header ' + nfDescribe(control));
        return false;
    }
    const sel = (control.tagName === 'SELECT' ? control : (control.closest && control.closest('select')));
    if (sel && sel.options && !nfInConcerns(sel)) {
        const option = Array.from(sel.options).find(o => NF_GREEN_RE.test(o.text)) || Array.from(sel.options).find(o => /checked|okay|ok/i.test(o.text));
        if (option) {
            const last = sel.value;
            sel.value = option.value;
            if (sel._valueTracker) sel._valueTracker.setValue(last);
            sel.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
            sel.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
            nfLog('rate-all: set <select> to ' + JSON.stringify(option.text));
            await nfSleep(80);
            return true;
        }
    }
    // MUI Select opens on mousedown (click alone is not enough). Full pointer sequence.
    // This is the 2.4.3 path that works live (button.MuiButtonBase-root "Rate All Tasks"
    // -> "Checked & Okay").
    const before = nfSnapshotDom();
    const hiddenBefore = new Set();
    try {
        document.querySelectorAll(NF_MENU_SEL + ', [role="menu"], [id*="rate-all-menu"]').forEach(m => {
            if (m.hidden || m.getAttribute('aria-hidden') === 'true') hiddenBefore.add(m);
        });
    } catch (e) {}
    const clicked = await nfPointer(control, 'rate-all');
    if (!clicked) return false;
    nfSliceStart = performance.now();
    const menu = await nfWait(() => {
        try {
            nfGrantNewPortals(before);
            const cands = [];
            try { document.querySelectorAll(NF_MENU_SEL).forEach(m => cands.push(m)); } catch (e) {}
            try {
                const near = control.parentElement && control.parentElement.querySelectorAll('[role="menuitem"], [role="option"]');
                if (near) near.forEach(it => { if (it.parentElement) cands.push(it.parentElement); });
            } catch (e) {}
            for (const m of cands) {
                if (!m) continue;
                if (nfInConcerns(m)) continue;
                const vis = !m.hidden && m.getAttribute('aria-hidden') !== 'true';
                if (!vis) continue;
                const justShown = hiddenBefore.has(m);
                const isNew = !before.has(m);
                const granted = nfInAllowedPortal(m);
                const nearControl = control.parentElement && control.parentElement.contains(m);
                if (justShown || isNew || granted || nearControl) return m;
            }
            const items = document.querySelectorAll('[role="menuitem"], [role="option"]');
            for (const it of items) {
                if (nfInConcerns(it)) continue;
                const par = it.parentElement;
                if (!par || par.hidden || par.getAttribute('aria-hidden') === 'true') continue;
                if (par === control || (control && control.contains(par))) continue;
                const justShown = hiddenBefore.has(par);
                const isNew = !before.has(par) || !before.has(it);
                const granted = nfInAllowedPortal(it) || nfInAllowedPortal(par);
                const nearControl = control.parentElement && control.parentElement.contains(par);
                if (justShown || isNew || granted || nearControl) return par;
            }
        } catch (e) {}
        return null;
    }, 600, 40);
    if (menu) {
        nfGrantNewPortals(before);
        if (!nfInAllowedPortal(menu)) nfAllowedPortals.add(menu);
        const options = Array.from(menu.querySelectorAll('[role="option"], [role="menuitem"], li, .MuiMenuItem-root'));
        const optInfo = options.slice(0, 8).map(o => ({
            text: nfOwnTextCheap(o, 60),
            aria: o.getAttribute('aria-label') || '',
            value: o.getAttribute('data-value') || o.getAttribute('data-val') || ''
        }));
        nfLog('rate-all: options=' + JSON.stringify(optInfo));
        let chosen = options.find(o => NF_GREEN_RE.test(nfOwnTextCheap(o, 60) + ' ' + (o.getAttribute('aria-label') || '') + ' ' + (o.getAttribute('data-value') || '')));
        if (!chosen && options[0]) {
            chosen = options[0];
            nfLog('rate-all: no text match, taking first option');
        }
        if (chosen && !nfInConcerns(chosen) && nfAllow(chosen, 'rate-all-option', { portal: true })) {
            await nfPointer(chosen, 'rate-all-option');
            nfLog('rate-all: chose ' + JSON.stringify(nfOwnTextCheap(chosen, 60) || chosen.getAttribute('aria-label') || 'first'));
            await nfSleep(80);
            return true;
        }
    }
    nfLog('rate-all: menu not found after pointer, html=' + JSON.stringify(nfHtmlSnippet(document.querySelector('.MuiPopover-root, .MuiModal-root, [role="presentation"]'), 200)));
    try { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); } catch (e) {}
    return false;
}

async function nfRateAllGreen(card) {
    // Back-compat wrapper. New fill uses nfFindAllRateAllControls + nfRateAllGreenOn.
    const list = card ? [nfFindRateAllControl(card).control].filter(Boolean) : nfFindAllRateAllControls();
    if (!list.length) {
        nfLog('rate-all: control not found, will rate each row');
        return false;
    }
    let any = false;
    for (const c of list) {
        if (await nfRateAllGreenOn(c)) any = true;
    }
    return any;
}

async function nfRateRowGreen(row) {
    if (!row || nfInConcerns(row) || nfIsConcernsRow(row)) return 'skipped-concerns';
    const clusters = nfRatingClusters(row);
    if (!clusters.length || clusters[0].many || !clusters[0].buttons) return 'no-ratings';
    const green = clusters[0].buttons[0];
    if (nfIsSelected(green)) return 'already-green';
    if (!nfAllow(green, 'rate-row')) return 'blocked';
    await nfPointer(green, 'rate-row');
    nfSliceStart = performance.now();
    return 'clicked';
}

async function nfOpenFinding(row, diagnose) {
    if (!row || nfInConcerns(row) || nfIsConcernsRow(row)) {
        if (diagnose) nfLog('add-finding: skipped concerns row');
        return null;
    }
    const existing = nfVisibleFields(row);
    if (existing.length) {
        const f = existing[0];
        if (!nfIsAllowed(f, { portal: true })) {
            if (diagnose) nfLog('add-finding: existing field not allowed ' + nfDescribe(f));
            return null;
        }
        return f;
    }
    const add = nfFindAddFinding(row);
    if (!add) {
        if (diagnose) nfLog('add-finding: no button in row html=' + JSON.stringify(nfHtmlSnippet(row, 300)));
        return null;
    }
    if (!nfAllow(add, 'add-finding')) return null;
    const before = nfSnapshotDom();
    const prevActive = document.activeElement;
    const clicked = await nfPointer(add, 'add-finding');
    if (!clicked) return null;
    nfSliceStart = performance.now();
    const field = await nfWait(() => {
        // Portals are allowed only if they appeared right after this in-card click.
        nfGrantNewPortals(before);
        // 1) Whatever just received focus (portal editors typically focus the textarea).
        const ae = document.activeElement;
        if (ae && ae !== prevActive && nfIsField(ae) && nfIsAllowed(ae, { portal: true })) return ae;
        // 2) Newly added fields — only ones granted from this click, never a pre-existing Concerns editor.
        let now;
        try { now = document.querySelectorAll('textarea, input[type="text"], input:not([type]), [contenteditable="true"], [contenteditable=""]'); } catch (e) { now = []; }
        for (const f of now) {
            if (!before.has(f) && nfIsField(f) && nfIsAllowed(f, { portal: true })) return f;
        }
        // 3) Visible field inside a NEW popover / dialog — not a leftover Concerns portal.
        try {
            const portals = document.querySelectorAll(NF_PORTAL_SEL);
            for (const p of portals) {
                if (before.has(p) && !nfInAllowedPortal(p)) continue;
                if (nfInConcerns(p)) continue;
                const vis = nfVisibleFields(p);
                for (const f of vis) { if (nfIsAllowed(f, { portal: true })) return f; }
            }
        } catch (e) {}
        // 4) A field that just appeared in the (possibly expanded) row — still must be allowed.
        const nearby = nfVisibleFields(row).concat(row.parentElement ? nfVisibleFields(row.parentElement) : []);
        for (const f of nearby) {
            if (!before.has(f) && nfIsAllowed(f, { portal: true })) return f;
        }
        return null;
    }, 500, 40);
    if (!field && diagnose) {
        const ae = document.activeElement;
        let newDesc = [];
        try {
            document.querySelectorAll('textarea, input[type="text"], [contenteditable="true"]').forEach(f => {
                if (!before.has(f)) newDesc.push(nfDescribe(f) + ' vis=' + nfIsVisible(f) + ' allowed=' + nfIsAllowed(f, { portal: true }));
            });
        } catch (e) {}
        nfLog('add-finding: no field after click. active=' + nfDescribe(ae) + ' new=' + JSON.stringify(newDesc).slice(0, 300)
            + ' portal=' + JSON.stringify(nfHtmlSnippet(document.querySelector(NF_PORTAL_SEL), 300)));
    }
    if (field && !nfIsAllowed(field, { portal: true })) {
        nfLog('add-finding: rejected field ' + nfDescribe(field));
        return null;
    }
    return field || null;
}

function nfPauseWorld() {
    nfSuppressAutoCaps = true;
    try { if (typeof observer !== 'undefined' && observer && observer.disconnect) observer.disconnect(); } catch (e) {}
}

function nfResumeWorld() {
    nfSuppressAutoCaps = false;
    try { if (typeof observer !== 'undefined' && observer && document.body) observer.observe(document.body, { childList: true, subtree: true }); } catch (e) {}
}

async function nfCommit(el, val) {
    // 2.3.9 / 2.4.0 commit: native value setter, input + change, Enter, then blur.
    if (!el) return false;
    if (nfIsHeaderOrSearch(el) || nfIsSearchBox(el) || nfInConcerns(el)) {
        nfLog('skip write: ' + nfDenyReason(el, {}) + ' ' + nfDescribe(el));
        return false;
    }
    try {
        if (nfIsContentEditable(el)) {
            try { el.focus(); } catch (e) {}
            el.textContent = val;
            try { el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, data: val, inputType: 'insertText' })); }
            catch (e) { el.dispatchEvent(new Event('input', { bubbles: true, composed: true })); }
            el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
            try { el.blur(); } catch (e) {}
            return true;
        }
        forceNativeInput(el, val);
        return true;
    } catch (e) {
        nfLog('commit error: ' + (e && e.message));
        return false;
    }
}

function nfCollectFindingFields() {
    // 2.3.9 / 2.4.0: the live sheet already has a <textarea> per inspection task.
    // That query found all 23 fields (2.4.0 log). We also pick up contenteditable
    // (used in tests) and then skip Concerns / header / search.
    const raw = [];
    const seen = new Set();
    const push = (el) => { if (el && !seen.has(el)) { seen.add(el); raw.push(el); } };
    try { document.querySelectorAll('textarea').forEach(push); } catch (e) {}
    try { document.querySelectorAll('[contenteditable="true"], [contenteditable=""]').forEach(push); } catch (e) {}
    const out = [];
    for (const el of raw) {
        if (el.disabled || el.readOnly) continue;
        if (nfIsSearchBox(el) || nfIsHeaderOrSearch(el)) {
            nfLog('skip field header/search ' + nfDescribe(el));
            continue;
        }
        if (nfInConcerns(el)) {
            nfLog('skip field in concerns ' + nfDescribe(el));
            continue;
        }
        // Leftover portals / random page boxes that aren't on an inspection row.
        // (Fields we open via Add finding are added by the caller, with the row remembered.)
        if (!nfClosestRow(el)) {
            nfLog('skip field with no inspection row ' + nfDescribe(el));
            continue;
        }
        out.push(el);
    }
    return out;
}

function nfCollectAddFindingButtons() {
    const out = [];
    try {
        const els = document.querySelectorAll('a, button, [role="button"], [role="link"]');
        for (const el of els) {
            if (!/^add finding$/i.test(nfOwnTextCheap(el, 32))) continue;
            if (nfInConcerns(el) || nfIsHeaderOrSearch(el)) continue;
            out.push(el);
        }
    } catch (e) {}
    return out;
}

async function fillNoFaults() {
    if (nfBusy) { nfLog('fill ignored, already running'); return; }
    nfBusy = true;
    nfMaxSlice = 0;
    nfSliceStart = performance.now();
    const t0 = performance.now();
    const deadline = t0 + 15000;
    nfPauseWorld();
    try { document.documentElement.dataset.tekproNf = 'running'; document.documentElement.dataset.tekproNfMaxSlice = '0'; } catch (e) {}
    try {
        await nfLoadBook();
        nfLog('fill start url=' + String(location.href || '').slice(0, 180));
        nfResetAllowList();
        nfRefreshConcernsRoots();

        // Rate All Tasks — document-wide (the 2.4.3 finder that works live). One
        // control per inspection header if several cards are on the page.
        const rateControls = nfFindAllRateAllControls();
        let ratedAll = false;
        if (!rateControls.length) {
            nfLog('rate-all: control not found, will rate each row');
        }
        for (const ctl of rateControls) {
            const ok = await nfRateAllGreenOn(ctl);
            nfSliceStart = performance.now();
            if (ok) ratedAll = true;
        }
        await nfYield();

        // Primary path: existing finding textareas (2.3.9 / 2.4.0).
        let fields = nfCollectFindingFields();
        const fieldRow = new Map();
        for (const f of fields) {
            const r = nfClosestRow(f);
            if (r) fieldRow.set(f, r);
        }
        nfLog('fill fields=' + fields.length + (fields[0] ? (' first=' + nfDescribe(fields[0]) + ' row=' + JSON.stringify(nfHtmlSnippet(fieldRow.get(fields[0]) || fields[0].parentElement, 300))) : ''));

        // Secondary: "Add finding" only for inspection rows that still have no field.
        // The findings box may open in a body portal — remember the row we clicked so the label still resolves.
        const adds = nfCollectAddFindingButtons();
        for (const add of adds) {
            if (performance.now() > deadline) break;
            const row = nfClosestRow(add) || add.parentElement;
            if (row && (nfInConcerns(row) || nfIsConcernsRow(row))) continue;
            if (row && fields.some(f => fieldRow.get(f) === row || (row.contains && row.contains(f)))) continue;
            const opened = await nfOpenFinding(row || add, fields.length === 0);
            if (opened && !fields.includes(opened) && !nfInConcerns(opened) && !nfIsSearchBox(opened)) {
                fields.push(opened);
                if (row) fieldRow.set(opened, row);
                nfLog('fill opened add-finding into=' + nfDescribe(opened) + ' label-row=' + JSON.stringify(getInspectionLabel(opened, row)) + ' after=' + JSON.stringify(nfHtmlSnippet(opened, 200)));
            }
        }
        nfLog('fill fields after add-finding=' + fields.length + ' rateAll=' + ratedAll);

        if (!fields.length) {
            nfLog('fill: no finding fields (none of the 2.3.9 textarea query, and no Add finding opened one)');
            return;
        }
        if (fields[0]) nfLogRowChain(nfClosestRow(fields[0]) || fields[0].parentElement, 'first-row');

        const labels = [];
        const snippets = [];
        for (const field of fields) {
            const row = fieldRow.get(field) || nfClosestRow(field);
            labels.push(getInspectionLabel(field, row));
            snippets.push(nfStripNoise(nfCellText(row || field, field)).slice(0, 160));
        }
        let texts = null;
        try { texts = await nfInvoke({ action: 'fill', labels, snippets }); } catch (e) {}

        let filled = 0, skipped = 0, failed = 0;
        for (let i = 0; i < fields.length; i++) {
            if (performance.now() > deadline) { nfLog('fill timeout at field ' + i); break; }
            await nfYield();
            const field = fields[i];
            if (nfInConcerns(field) || nfIsSearchBox(field) || nfIsHeaderOrSearch(field)) {
                nfLog('fill #' + i + ' skip concerns/search ' + nfDescribe(field));
                failed++;
                continue;
            }
            const row = fieldRow.get(field) || nfClosestRow(field);
            if (!ratedAll && row && !nfInConcerns(row)) {
                const r = await nfRateRowGreen(row);
                nfSliceStart = performance.now();
                if (r !== 'already-green') nfLog('fill #' + i + ' rate-row=' + r);
            }
            const existing = nfFieldValue(field);
            if (existing && !nfIsGenerated(existing)) {
                nfLog('fill #' + i + ' skip existing text label=' + JSON.stringify(labels[i]));
                skipped++;
                continue;
            }
            let label = labels[i] || getInspectionLabel(field, row);
            if (label) labels[i] = label;
            if (!label) nfLog('fill #' + i + ' label="" row=' + JSON.stringify(snippets[i]));
            let use = (texts && texts[i]) || NF_GENERIC;
            if (label && use === NF_GENERIC) {
                try {
                    const again = await nfInvoke({ action: 'fill', labels: [label], snippets: [snippets[i]] });
                    if (again && again[0]) use = again[0];
                } catch (e) {}
            }
            const wrote = nfCommit(field, use);
            if (!wrote) { failed++; continue; }
            nfLog('fill #' + i + ' wrote label=' + JSON.stringify(label) + ' chars=' + use.length + ' into=' + nfDescribe(field));
            filled++;
        }
        // Let 2.3.9's 50ms blur timers finish.
        await nfSleep(80);
        nfMarkSlice();
        nfLog('fill done filled=' + filled + ' skipped=' + skipped + ' failed=' + failed + ' fields=' + fields.length + ' ms=' + Math.round(performance.now() - t0) + ' maxSlice=' + Math.round(nfMaxSlice));
    } catch (e) {
        nfLog('fill error: ' + (e && e.message) + ' ' + (e && e.stack));
    } finally {
        nfMarkSlice();
        try {
            document.documentElement.dataset.tekproNfMaxSlice = String(Math.round(nfMaxSlice));
            document.documentElement.dataset.tekproNf = 'done';
        } catch (e) {}
        nfResumeWorld();
        nfLogFlush();
        nfResetAllowList();
        nfBusy = false;
    }
}

async function clearNoFaults() {
    if (nfBusy) return;
    nfBusy = true;
    nfPauseWorld();
    nfSliceStart = performance.now();
    try { document.documentElement.dataset.tekproNf = 'running'; } catch (e) {}
    try {
        await nfLoadBook();
        nfLog('clear start');
        nfResetAllowList();
        nfRefreshConcernsRoots();
        // Same 2.3.9 query, then skip Concerns / search. Only remove generated text.
        const fields = nfCollectFindingFields().filter(f => nfFieldValue(f));
        if (!fields.length) { nfLog('clear: no filled fields'); return; }
        let flags = null;
        try { flags = await nfInvoke({ action: 'clear', values: fields.map(f => nfFieldValue(f)) }); } catch (e) {}
        let n = 0;
        for (let i = 0; i < fields.length; i++) {
            const generated = flags ? flags[i] === true : nfIsGenerated(nfFieldValue(fields[i]));
            if (generated) {
                nfCommit(fields[i], '');
                n++;
            }
        }
        await nfSleep(80);
        nfLog('clear done removed=' + n + ' of ' + fields.length);
    } catch (e) {
        nfLog('clear error: ' + (e && e.message));
    } finally {
        try { document.documentElement.dataset.tekproNf = 'done'; } catch (e) {}
        nfResumeWorld();
        nfLogFlush();
        nfResetAllowList();
        nfBusy = false;
    }
}

ipcRenderer.on('fill-no-faults', () => { fillNoFaults(); });

ipcRenderer.on('clear-no-faults', () => { clearNoFaults(); });

ipcRenderer.on('insert-text', (event, textToInsert) => {
    injectText(textToInsert);
});

let cachedLogoSrc = null;
function injectShopBranding() {
    if (document.getElementById('shop-logo-fixed')) return;
    const img = document.createElement('img');
    img.id = 'shop-logo-fixed';
    // data: URI so it also shows on about:blank print windows and outside sites (local-resource:// isn't served there)
    if (cachedLogoSrc === null) { try { cachedLogoSrc = ipcRenderer.sendSync('get-small-logo') || ''; } catch (e) { cachedLogoSrc = ''; } }
    const logoSrc = cachedLogoSrc;
    if (!logoSrc || !document.body) return;
    img.src = logoSrc;
    img.onerror = () => { img.style.display = 'none'; };
    img.style.cssText = "position:fixed; top:8px; left:220px; width:45px; z-index:2147483647; pointer-events:none; opacity: 0.9;";
    document.body.appendChild(img);
}

function injectCustomStyles() {
    if (document.getElementById('leaside-custom-styles')) return;
    const style = document.createElement('style');
    style.id = 'leaside-custom-styles';
    style.innerHTML = `
        .leaside-completed-job {
            background-color: #2c0000 !important;
            box-shadow: inset 0 0 0 1.5px #000000 !important;
            opacity: 0.9 !important;
        }
        .leaside-completed-job .rbc-event-content,
        .leaside-checkedin-job .rbc-event-content {
            display: flex !important;
            flex-direction: column !important;
            align-items: flex-start !important;
        }
        .leaside-completed-job .rbc-event-content::before {
            content: "[Completed]";
            display: inline-block;
            font-weight: bold;
            font-size: 13px;
            color: #ffb3b3;
            background-color: #000000;
            padding: 2px 5px;
            border-radius: 4px;
            text-decoration: none !important;
            margin-bottom: 2px;
        }
        .leaside-completed-job .rbc-event-label,
        .leaside-completed-job .rbc-event-content > div {
            color: #ffffff !important;
            width: 100%;
        }
        .leaside-checkedin-job .rbc-event-content::before {
            content: "[Checked In]";
            display: inline-block;
            font-weight: bold;
            font-size: 13px;
            color: #66bb6a; 
            background-color: #000000;
            padding: 2px 5px;
            border-radius: 4px;
            text-shadow: 1px 1px 2px rgba(0,0,0,0.8); 
            text-decoration: none !important;
            margin-bottom: 2px;
        }
        .leaside-checkedin-job .rbc-event-label,
        .leaside-checkedin-job .rbc-event-content > div {
            text-decoration: none !important;
            width: 100%;
        }
    `;
    document.head.appendChild(style);
}

function handleMarketingSource() {
    const sourceInputs = document.querySelectorAll('input[name="marketingSource"], input[placeholder*="Marketing Source"]');
    sourceInputs.forEach(sourceInput => {
        if (sourceInput && !sourceInput.value && !sourceInput.dataset.leasideFixed) {
            sourceInput.dataset.leasideFixed = "true";
            
            sourceInput.focus();
            sourceInput.click();
            
            forceNativeInput(sourceInput, 'Returning Customer');
            
            setTimeout(() => {
                const options = document.querySelectorAll('[role="option"], li');
                options.forEach(opt => {
                    if (opt.textContent.trim().toLowerCase() === 'returning customer') {
                        opt.click();
                    }
                });
                
                sourceInput.dispatchEvent(new KeyboardEvent('keydown', { 
                    bubbles: true, cancelable: true, key: 'Enter', code: 'Enter' 
                }));
                
                setTimeout(() => sourceInput.blur(), 100);
            }, 400);
        }
    });
}

function syncJobBoardData() {
    const url = window.location.href.toLowerCase();
    
    // --- 1. Aggressively scrape the Job Board and store EXACT names ---
    if (url.includes('repair-orders') || url.includes('board=')) {
        const anyCardsOnBoard = document.querySelectorAll('[data-repair-order-index], .MuiCard-root').length > 0;
        if (anyCardsOnBoard) {
            let unpaidNames = [];
            document.querySelectorAll('[data-repair-order-status="COMPLETE"], .MuiCard-root').forEach(card => {
                let text = (card.textContent || "").toLowerCase();
                const isCompleted = card.getAttribute('data-repair-order-status') === 'COMPLETE' || text.includes('completed');
                
                if (isCompleted && text.includes('balance due')) {
                    // Isolates the exact name from the card bullet point
                    let namePart = text.split('•')[0].replace(/completed/g, '').replace(/in progress/g, '').trim();
                    if (namePart && !unpaidNames.includes(namePart)) {
                        unpaidNames.push(namePart);
                    }
                }
            });
            // Changed registry key to force a clean slate for the array memory
            localStorage.setItem('leaside-unpaid-names', JSON.stringify(unpaidNames));
        }
    }
    
    // --- 2. Dynamically purge memory if an RO is open and paid ---
    if (url.includes('/repair/')) {
        const bodyText = document.body.textContent.toLowerCase();
        const isPaid = bodyText.match(/balance due[:\s]*\$0\.00/i) || bodyText.includes('paid in full') || bodyText.includes('posted');
        
        if (isPaid) {
            const custEl = document.querySelector('[data-testid="customer-name"]') || document.querySelector('.MuiTypography-h4');
            if (custEl) {
                const roCustName = custEl.textContent.trim().toLowerCase();
                let savedUnpaid = JSON.parse(localStorage.getItem('leaside-unpaid-names') || "[]");
                
                // Immediately remove this customer from memory so they cross off instantly
                const newUnpaid = savedUnpaid.filter(name => !name.includes(roCustName) && !roCustName.includes(name));
                if (newUnpaid.length !== savedUnpaid.length) {
                    localStorage.setItem('leaside-unpaid-names', JSON.stringify(newUnpaid));
                }
            }
        }
    }
    
    // --- 3. Process the Calendar Appointments ---
    if (url.includes('appointments') || document.querySelector('.rbc-calendar')) {
        const savedUnpaidNames = JSON.parse(localStorage.getItem('leaside-unpaid-names') || "[]");
        
        document.querySelectorAll('.rbc-event').forEach(eventCard => {
            const isCompleted = eventCard.querySelector('svg[data-testid="PlaylistAddCheckIcon"]');
            
            const oldMoney = eventCard.querySelector('.leaside-money-icon');
            if (oldMoney) oldMoney.remove();
            const oldX = eventCard.querySelector('.leaside-x-mark');
            if (oldX) oldX.remove();
            
            eventCard.classList.remove('leaside-paid-job');
            eventCard.style.boxShadow = ''; 
            eventCard.style.textDecoration = 'none';

            if (isCompleted) {
                const calTextRaw = eventCard.textContent || "";
                
                // Perfectly slices off everything after the name ('s, -, or stray spaces)
                let customerName = calTextRaw.toLowerCase().split(/'s\s|\s-\s|-/)[0].trim();
                
                let isUnpaid = savedUnpaidNames.some(unpaidName => {
                    return customerName.includes(unpaidName) || unpaidName.includes(customerName);
                });

                if (!isUnpaid) {
                    eventCard.classList.add('leaside-paid-job');
                    eventCard.style.textDecoration = 'line-through';
                    
                    const icon = document.createElement('div');
                    icon.className = 'leaside-money-icon';
                    icon.textContent = '💰';
                    icon.style.cssText = 'position: absolute; top: 32px; right: 4px; font-size: 1.5rem; z-index: 999; pointer-events: none; filter: drop-shadow(1px 1px 2px rgba(0,0,0,0.6)); text-decoration: none;';
                    eventCard.appendChild(icon);
                } else {
                    eventCard.style.boxShadow = 'inset 0 0 0 2.5px #ff9800'; 
                }

                const xMark = document.createElement('div');
                xMark.className = 'leaside-x-mark';
                xMark.textContent = '❌';
                xMark.style.cssText = 'position: absolute; top: 4px; right: 4px; font-size: 1.6rem; opacity: 1.0; pointer-events: none; z-index: 999; text-decoration: none;';
                eventCard.appendChild(xMark);
            }
        });
    }
}

function crossOffFinishedJobs() {
    document.querySelectorAll('.rbc-event').forEach(eventCard => {
        const textData = (eventCard.textContent || "").toLowerCase();
        const isCompleted = eventCard.querySelector('svg[data-testid="PlaylistAddCheckIcon"]');
        const isCheckedIn = eventCard.querySelector('svg[data-testid="CheckIcon"]') || textData.includes('checked in');
        
        if (isCompleted) {
            eventCard.classList.remove('leaside-checkedin-job');
            eventCard.classList.add('leaside-completed-job');
        } else if (isCheckedIn) {
            eventCard.classList.remove('leaside-completed-job');
            eventCard.classList.add('leaside-checkedin-job');
        } else {
            eventCard.classList.remove('leaside-completed-job', 'leaside-checkedin-job');
        }
    });

    const finishedStatuses = ["completed", "paid", "invoiced", "picked up"];
    
    document.querySelectorAll('.MuiCard-root, [data-repair-order-index]').forEach(card => {
        const cardText = (card.textContent || "").toLowerCase();
        const isJobBoardCard = card.hasAttribute('data-repair-order-index');
        const isJobBoardCompleted = card.getAttribute('data-repair-order-status') === 'COMPLETE';

        let hasStatusText = false;
        if (!isJobBoardCard) {
            hasStatusText = Array.from(card.querySelectorAll('span, p, div')).some(el => {
                if (el.children.length > 1) return false;
                const text = el.textContent.trim().toLowerCase();
                return finishedStatuses.includes(text);
            });
        }

        const isFinished = hasStatusText || isJobBoardCompleted;
        const hasBalanceDue = cardText.includes('balance due');

        if (isFinished) {
            let titleArea = card.querySelector('h6, p, span, .font-medium');
            if (!titleArea) titleArea = card; 

            if (!card.querySelector('.leaside-x-mark')) {
                const xMark = document.createElement('span');
                xMark.className = 'leaside-x-mark';
                xMark.textContent = ' ❌';
                xMark.style.color = '#ff4444';
                xMark.style.textDecoration = 'none';
                xMark.style.fontWeight = 'bold';
                titleArea.appendChild(xMark);
            }

            if (hasBalanceDue) {
                card.style.opacity = '1';
                card.style.textDecoration = 'none';
                const oldMoney = card.querySelector('.leaside-money-icon');
                if (oldMoney) oldMoney.remove();
            } else {
                card.style.opacity = '0.5';
                card.style.textDecoration = 'line-through';
                if (!card.querySelector('.leaside-money-icon')) {
                    const icon = document.createElement('div');
                    icon.className = 'leaside-money-icon';
                    icon.textContent = '💰';
                    card.style.position = 'relative';
                    icon.style.cssText = 'position: absolute; top: 10px; right: 10px; font-size: 1.5rem; z-index: 999; pointer-events: none; filter: drop-shadow(1px 1px 2px rgba(0,0,0,0.6)); text-decoration: none;';
                    card.appendChild(icon);
                }
            }
        } else {
            card.style.opacity = '1';
            card.style.textDecoration = 'none';
            const oldMoney = card.querySelector('.leaside-money-icon');
            if (oldMoney) oldMoney.remove();
            const oldX = card.querySelector('.leaside-x-mark');
            if (oldX) oldX.remove();
        }
    });
}

function cleanUpInterface() {
    if (!appSettings.hidePremium) return;

    const premiumSidebars = ["Fluids", "Filters & Blades", "Tires", "Batteries", "Specs", "Service Bulletin"];
    const leftNav = ["Shop Dashboard", "Tech Board"];
    
    document.querySelectorAll('.MuiAccordion-root').forEach(acc => {
        const summary = acc.querySelector('.MuiAccordionSummary-content');
        if (summary) {
            const text = summary.textContent.trim();
            if (premiumSidebars.some(t => text.startsWith(t) || text === t + " ✎")) {
                if (!acc.classList.contains('leaside-hidden')) {
                    acc.classList.add('leaside-hidden');
                    acc.style.setProperty('display', 'none', 'important');
                }
            }
        }
    });

    document.querySelectorAll('.MuiListItem-root, a[href]').forEach(el => {
        if (el.children.length > 3) return; 
        const text = el.textContent.trim();
        if (leftNav.some(t => text === t || text.startsWith(t + " ") || text.startsWith(t + "\n"))) {
            if (!el.classList.contains('leaside-hidden')) {
                el.classList.add('leaside-hidden');
                el.style.setProperty('display', 'none', 'important');
            }
        }
    });
}

function enforceSpellcheck() {
    document.querySelectorAll('textarea, input[type="text"], [contenteditable="true"]').forEach(el => {
        if (el.getAttribute('spellcheck') !== 'true') {
            el.setAttribute('spellcheck', 'true');
        }
    });
}

function toggleSidebarVisibility() {
    const sidebar = document.getElementById('leaside-sidebar-tools');
    if (appSettings.showSidebar === false) {
        if (sidebar) sidebar.style.display = 'none';
    } else {
        if (sidebar) {
            sidebar.style.display = 'flex';
        } else {
            injectSidebarButtons();
        }
    }
}

function injectSidebarButtons() {
    if (document.getElementById('leaside-sidebar-tools')) return;
    if (appSettings.showSidebar === false) return;

    const container = document.createElement('div');
    container.id = 'leaside-sidebar-tools';
    
    container.style.cssText = 'position: fixed; bottom: 16px; left: 16px; padding: 14px; display: flex; flex-direction: column; gap: 6px; z-index: 2147483647; background: #ffffff; border: 1px solid #e0e0e0; border-radius: 8px; box-shadow: 0px 6px 20px rgba(0,0,0,0.15); width: 220px; transition: opacity 0.2s ease-in-out;';
    
    const title = document.createElement('div');
    title.textContent = 'QUICK ACTIONS';
    title.style.cssText = 'font-size: 11px; font-weight: bold; color: #777; margin-bottom: 5px; text-transform: uppercase; letter-spacing: 0.5px;';
    container.appendChild(title);
    
    const createBtn = (label, onClick) => {
        const btn = document.createElement('button');
        btn.textContent = label;
        btn.style.cssText = 'background: transparent; border: 1px solid #ccc; padding: 6px; border-radius: 4px; cursor: pointer; text-align: left; font-size: 12px; color: #333; width: 100%; transition: background 0.2s;';
        btn.onmouseover = () => btn.style.background = '#e8e8e8';
        btn.onmouseout = () => btn.style.background = 'transparent';
        btn.onmousedown = onClick;
        return btn;
    };
    
    container.appendChild(createBtn('Fill "No Faults" (Ctrl+Alt+N)', (e) => {
        e.preventDefault();
        fillNoFaults();
    }));

    container.appendChild(createBtn('Undo "No Faults" (Ctrl+Alt+C)', (e) => {
        e.preventDefault();
        clearNoFaults();
    }));

    const scrollBox = document.createElement('div');
    scrollBox.id = 'leaside-quick-scroll';
    scrollBox.style.cssText = 'display: flex; flex-direction: column; gap: 4px; padding-right: 8px; margin-top: 5px; border-top: 1px solid #eee; padding-top: 10px;';

    const presetJobs = appSettings.presets || [];

    presetJobs.forEach(jobText => {
        let label = jobText;
        if (jobText.length > 25) {
            label = jobText.substring(0, 22) + "...";
        }
        scrollBox.appendChild(createBtn('+ ' + label, (e) => {
            e.preventDefault();
            injectText(jobText);
        }));
    });

    container.appendChild(scrollBox);
    document.body.appendChild(container); 
}

let domTimer = null;

const runEnhancements = () => {
    try {
        injectShopBranding();
        injectCustomStyles();
        cleanUpInterface();
        crossOffFinishedJobs();
        syncJobBoardData();
        handleMarketingSource();
        enforceSpellcheck();
        toggleSidebarVisibility();
        
        const quickMenu = document.getElementById('leaside-sidebar-tools');
        const href = window.location.href.toLowerCase();
        
        const isDashboard = href.endsWith('/dashboard') || href.endsWith('/dashboard/') || href.endsWith('.com') || href.endsWith('.com/');
        const isDocumentView = href.includes('/document/') || href.startsWith('blob:') || href.includes('.pdf');
        const isPartsPopup = href.includes('partstech') || href.includes('nexpart') || window.opener !== null;
        
        const hasSidebar = document.querySelector('nav') || document.querySelector('.MuiDrawer-paper');

        let isLargeOverlayActive = false;
        const overlays = document.querySelectorAll('.MuiDialog-paper, .MuiDrawer-paper, [role="dialog"]');
        
        overlays.forEach(overlay => {
            const rect = overlay.getBoundingClientRect();
            if (rect.left < 100 && rect.width < 350) return; 
            
            const style = window.getComputedStyle(overlay);
            const isOnScreen = rect.right > 0 && rect.left < window.innerWidth;
            const isRendered = style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
            
            if (rect.width > 600 && isRendered && isOnScreen) {
                isLargeOverlayActive = true;
            }
        });

        if (quickMenu) {
            if (isDashboard || isDocumentView || isPartsPopup || !hasSidebar || isLargeOverlayActive || appSettings.showSidebar === false) {
                quickMenu.style.display = 'none';
            } else {
                quickMenu.style.display = 'flex';
            }
        }
    } catch (e) {
        console.warn("Enhancement error:", e);
    }
};

const observer = new MutationObserver((mutations) => {
    clearTimeout(domTimer);
    domTimer = setTimeout(runEnhancements, 150);
});

window.addEventListener("DOMContentLoaded", () => {
    runEnhancements();
    if (document.body) observer.observe(document.body, { childList: true, subtree: true });
    
    const href = window.location.href;
    
    if (!isHiddenPrinter && href.includes('/document/') && (href.includes('/estimate') || href.includes('/repair') || href.includes('/invoice') || href.includes('/inspections'))) {
        if (window.top === window) {
            ipcRenderer.send('document-ready', href, false);
        }
    }
});

document.addEventListener('focusout', (event) => {
    if (nfBusy || nfSuppressAutoCaps) return;
    if (!appSettings.autoCaps) return;
    const el = event.target;
    if (!el || !el.tagName) return;
    if (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && (el.type === 'text' || el.type === 'search'))) {
        if (el.type === 'password' || (el.name || "").toLowerCase().includes('email')) return;
        
        if (el.getAttribute('role') === 'combobox' || el.hasAttribute('aria-haspopup') || el.hasAttribute('aria-autocomplete')) {
            return;
        }

        if (window.location.href.toLowerCase().includes('partstech')) {
            return;
        }

        setTimeout(() => {
            if (!el.value) return;
            const upper = el.value.toUpperCase();
            if (el.value !== upper) {
                forceNativeInput(el, upper, true);
            }
        }, 150);
    }
}, { capture: true });

ipcRenderer.on('fill-login', (event, creds) => {
    if (!creds) return;
    // The login form is rendered by React and may not exist yet, so wait for it briefly.
    const started = Date.now();
    const tryFill = () => {
        const email = document.querySelector('input[name="email"]') || document.querySelector('input[type="email"]');
        const pass = document.querySelector('input[name="password"]') || document.querySelector('input[type="password"]');
        if (email && pass) {
            // Quiet React-safe fill (native setter + _valueTracker + input/change events).
            // No synthetic Enter here, so the form isn't submitted before the password is in.
            forceNativeInput(email, creds.email || '', true);
            forceNativeInput(pass, creds.pass || '', true);
            setTimeout(() => {
                const btn = document.querySelector('button[type="submit"]');
                if (btn && !btn.disabled) btn.click();
            }, 500);
        } else if (Date.now() - started < 5000) {
            setTimeout(tryFill, 250);
        }
    };
    tryFill();
});

function getShopData() {
    let customer = "";
    let vehicle = "";
    let phone = "";
    
    try {
        const custEl = document.querySelector('[data-testid="customer-name"]') || document.querySelector('.MuiTypography-h4');
        if (custEl) customer = custEl.textContent.trim();
        
        const vehEl = document.querySelector('[data-testid="vehicle-info"]') || document.querySelector('.MuiTypography-subtitle1') || document.querySelector('h6');
        if (vehEl) vehicle = vehEl.textContent.trim();
        
        const phoneEl = Array.from(document.querySelectorAll('a[href^="tel:"]')).find(el => el.textContent.trim().length > 0);
        if (phoneEl) phone = phoneEl.textContent.trim();
    } catch(e) {}
    
    const path = window.location.pathname.toLowerCase();
    const docType = path.includes('/invoice') ? 'invoice' : path.includes('/repair') ? 'repair' : path.includes('/estimate') ? 'estimate' : path.includes('/inspection') ? 'inspection' : 'other';
    return { customer, vehicle, phone, docType };
}

const originalWindowOpen = window.open;
window.open = function(url, name, features) {
    if (typeof url === 'string' && (url.startsWith('blob:') || url.includes('/print') || url.includes('.pdf'))) {
        fetch(url)
            .then(res => res.arrayBuffer())
            .then(buffer => {
                const uint8Array = new Uint8Array(buffer);
                const shopData = getShopData();
                ipcRenderer.send('modify-pdf-blob', uint8Array, shopData);
            })
            .catch(err => console.error("Blob error:", err));
        
        return { close: () => {}, focus: () => {}, print: () => {}, document: { write: () => {}, close: () => {} } };
    }
    
    return originalWindowOpen.apply(this, arguments);
};
// Mouse back/forward buttons (fallback for app-command): buttons 3 and 4
window.addEventListener('mouseup', (e) => {
    if (e.button === 3 || e.button === 4) {
        e.preventDefault();
        ipcRenderer.send('mouse-nav', e.button === 3 ? 'back' : 'forward');
    }
}, true);

// ---- Main-world PDF blob hook (Tekmetric's own scripts run in the main world, not here) ----
// Remembers which blob: URLs are PDFs, keeps them alive briefly after revoke so they can be read,
// and reports blob PDFs that Tekmetric drops into an <iframe>/<embed>/<object> in this page.
try {
    const { webFrame } = require('electron');
    webFrame.executeJavaScript(ipcRenderer.sendSync('get-pdf-hook'), false).catch(() => {});
} catch (e) { try { console.log('[tekpro-pdf] preload hook inject failed ' + e); } catch (x) {} }

window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.__tekproPdf !== true) return;
    if (isHiddenPrinter) return; // Smart Print hidden windows already print themselves
    if (!/^https:\/\/([a-z0-9-]+\.)*tekmetric\.com$/i.test(e.origin)) return;
    if (typeof e.data.url !== 'string' || !e.data.url.startsWith('blob:')) return;
    ipcRenderer.send('tekpro-pdf-blob-url', e.data.url, getShopData());
});
