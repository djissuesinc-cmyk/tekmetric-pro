const { ipcRenderer } = require('electron');

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

// v2.4.1: "No Faults" fills each inspection row: rate green, open "Add Finding" if needed,
// write item-specific wording. Labels come from the task-name cell in the same row
// (Tekmetric does not put the name on the textarea via <label>/aria/placeholder).
const NF_GENERIC = 'No faults found at this time.';
const NF_CLICK = 'button, a, [role="button"], [role="radio"], [role="menuitem"], [role="option"], [role="tab"], input[type="button"], input[type="radio"], input[type="checkbox"]';
const NF_FIELD = 'textarea, input[type="text"], input[type="search"], input:not([type]), [contenteditable="true"], [contenteditable=""]';
const NF_RATE_ARIA = /checked|okay|\bok\b|attention|immediate|not applicable|n\/a|pass|fail|good|fair|poor|satisfactory|green|yellow|red|warning|needs?\s*(work|attention)|approved/i;
const NF_SKIP_TEXT = /^(notes?|findings?|comments?|recommendations?|technician notes?|tech notes?|add (a )?(note|finding|comment)s?|details?|description|good|fair|poor|ok|pass(ed)?|fail(ed)?|green|yellow|red|needs attention|attention|urgent|not inspected|n\/a|na|none|inspection|inspections|status|condition|select|save|cancel|edit|delete|remove|photo|photos|video|media|upload|rating|inspection task|rate all tasks|checked\s*(&|and)\s*okay|requires attention soon|requires immediate attention|not applicable|type here.*|enter .*|write .*)$/i;
const NF_SECTION = /^(interior|exterior|under hood|starting\/?charging(\s+system)?|steering and suspension|brakes|under vehicle|fluid leaks\s*\(\s*general\s*\)|other faults not listed|30 point vehicle inspection|rate all tasks)$/i;

let nfBusy = false;

function nfSleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function nfLog(msg) {
    const line = String(msg || '');
    const out = line.startsWith('no-faults') ? line : ('no-faults ' + line);
    try { console.log('[tekpro-nf] ' + out); } catch (e) {}
    try { ipcRenderer.sendSync('inspection-phrases', { action: 'log', message: out }); } catch (e) {}
}

function nfSnippet(el, n) {
    const t = ((el && (el.innerText || el.textContent)) || '').replace(/\s+/g, ' ').trim();
    return t.slice(0, n || 160);
}

function nfWait(fn, timeout, interval) {
    timeout = timeout == null ? 2000 : timeout;
    interval = interval == null ? 50 : interval;
    return new Promise(resolve => {
        const start = Date.now();
        let obs = null;
        let finished = false;
        const done = (v) => {
            if (finished) return;
            finished = true;
            try { if (obs) obs.disconnect(); } catch (e) {}
            resolve(v);
        };
        const tick = () => {
            if (finished) return;
            try {
                const v = fn();
                if (v) return done(v);
            } catch (e) {}
            if (Date.now() - start >= timeout) return done(null);
            setTimeout(tick, interval);
        };
        try {
            obs = new MutationObserver(() => tick());
            if (document.body) obs.observe(document.body, { childList: true, subtree: true, attributes: true });
        } catch (e) {}
        tick();
    });
}

function nfClick(el) {
    if (!el) return;
    try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) {}
    try { if (typeof el.focus === 'function') el.focus(); } catch (e) {}
    try { el.click(); } catch (e) {
        try {
            const opts = { bubbles: true, cancelable: true, view: window };
            el.dispatchEvent(new MouseEvent('pointerdown', opts));
            el.dispatchEvent(new MouseEvent('mousedown', opts));
            el.dispatchEvent(new MouseEvent('pointerup', opts));
            el.dispatchEvent(new MouseEvent('mouseup', opts));
            el.dispatchEvent(new MouseEvent('click', opts));
        } catch (e2) {}
    }
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
    if (el.matches && el.matches(NF_FIELD)) return true;
    return nfIsContentEditable(el);
}

function nfFields(root) {
    const scope = root || document;
    if (!scope.querySelectorAll) return [];
    return Array.from(scope.querySelectorAll(NF_FIELD)).filter(nfIsField);
}

function nfClickables(root) {
    if (!root || !root.querySelectorAll) return [];
    return Array.from(root.querySelectorAll(NF_CLICK));
}

function nfLooksLikeRating(el) {
    const t = ((el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || '') + ' ' + (el.getAttribute('data-testid') || '') + ' ' + (el.textContent || '')).replace(/\s+/g, ' ').trim();
    return NF_RATE_ARIA.test(t);
}

function nfRatingClusters(root) {
    if (!root) return [];
    const clicks = nfClickables(root);
    const groups = new Map();
    for (const c of clicks) {
        const p = c.parentElement;
        if (!p) continue;
        if (!groups.has(p)) groups.set(p, []);
        groups.get(p).push(c);
    }
    const out = [];
    for (const [p, btns] of groups) {
        if (btns.length < 3 || btns.length > 6) continue;
        const ratingish = btns.filter(b => nfLooksLikeRating(b) || ((b.textContent || '').trim().length <= 2));
        if (ratingish.length >= 3 || btns.length === 4) out.push({ parent: p, buttons: btns });
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
    return false;
}

function nfInnermost(els) {
    return els.filter(el => !els.some(o => o !== el && el.contains(o)));
}

function nfFindAddFinding(root) {
    if (!root || !root.querySelectorAll) return null;
    const els = Array.from(root.querySelectorAll('a, button, span, div, p, [role="button"], [role="link"]'));
    const exact = nfInnermost(els.filter(el => /^add finding$/i.test((el.textContent || '').replace(/\s+/g, ' ').trim())));
    if (exact.length) return exact[0];
    const loose = nfInnermost(els.filter(el => {
        const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
        return /add finding/i.test(t) && t.length < 40;
    }));
    return loose[0] || null;
}

function nfClosestRow(start) {
    if (!start) return null;
    try {
        if (start.closest) {
            const tr = start.closest('tr, [role="row"]');
            if (tr && tr !== document.body && (nfRatingClusters(tr).length === 1 || (tr.children && tr.children.length >= 3))) return tr;
        }
    } catch (e) {}
    let el = start;
    for (let i = 0; i < 18 && el && el !== document.documentElement; i++) {
        const p = el.parentElement;
        if (!p || p === document.body || p === document.documentElement || p === document.head) break;
        const clusters = nfRatingClusters(p);
        if (clusters.length === 1 && p.children && p.children.length >= 2) return p;
        el = p;
    }
    try { return start.closest('tr, [role="row"]') || null; } catch (e) { return null; }
}

function nfStripNoise(s) {
    return String(s || '')
        .replace(/\badd finding\b/ig, ' ')
        .replace(/\b(rating|inspection task|findings)\b/ig, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function nfCellText(el, field) {
    if (!el) return '';
    let t = '';
    const skip = 'button, textarea, input, select, svg, script, style, img, [role="button"], [role="radio"], [role="menuitem"], [contenteditable], [contenteditable="true"]';
    const walk = (n) => {
        if (!n) return;
        if (n === field) return;
        if (n.nodeType === 3) { t += n.textContent; return; }
        if (n.nodeType !== 1) return;
        try { if (n.matches && n.matches(skip)) return; } catch (e) {}
        for (const c of n.childNodes) walk(c);
    };
    walk(el);
    return nfStripNoise(t);
}

function nfCleanLabel(t) {
    const s = nfStripNoise(t).replace(/[:*\u2022\-–—\s]+$/, '').replace(/^[\d.)\s\-–—\u2022]+(?=[a-z])/i, '').trim();
    if (s.length < 2 || s.length > 120 || !/[a-z]/i.test(s) || NF_SKIP_TEXT.test(s) || NF_SECTION.test(s)) return '';
    return s;
}

// Walk up from the field to the row (ancestor that also has the rating buttons / several cells),
// then read the task-name cell — the cell between ratings and findings, excluding field and button text.
function getInspectionLabel(ta, rowHint) {
    try {
        const direct = [];
        const lb = ta && ta.getAttribute && ta.getAttribute('aria-labelledby');
        if (lb) direct.push(lb.split(/\s+/).map(id => { const e = document.getElementById(id); return e ? e.textContent : ''; }).join(' '));
        if (ta && ta.getAttribute) {
            direct.push(ta.getAttribute('aria-label'));
            if (ta.id) { try { const l = document.querySelector('label[for="' + CSS.escape(ta.id) + '"]'); if (l) direct.push(l.textContent); } catch (e) {} }
            const wrap = ta.closest && ta.closest('label');
            if (wrap) direct.push((wrap.textContent || '').replace(nfFieldValue(ta), ''));
            direct.push(ta.getAttribute('placeholder'), ta.getAttribute('title'), ta.getAttribute('name'));
        }
        for (const d of direct) { const c = nfCleanLabel(d); if (c && !/^add finding$/i.test(c)) return c; }

        const row = rowHint || nfClosestRow(ta);
        if (row) {
            const kids = Array.from(row.children);
            const clusters = nfRatingClusters(row);
            const rateEl = clusters[0] && clusters[0].parent;
            const findingIdx = kids.findIndex(k => (ta && k.contains(ta)) || nfFindAddFinding(k) || (k.querySelector && k.querySelector(NF_FIELD)));
            const rateIdx = rateEl ? kids.findIndex(k => k === rateEl || k.contains(rateEl)) : -1;
            const candidates = [];
            kids.forEach((k, i) => {
                if (i === findingIdx) return;
                const text = nfCleanLabel(nfCellText(k, ta));
                if (text) candidates.push(text);
            });
            // If ratings and the name share a child (rateIdx), that child's text (buttons already stripped) is the name.
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

function nfFindRows() {
    const starts = [];
    nfFields(document).forEach(el => starts.push(el));
    const adds = [];
    try {
        Array.from(document.querySelectorAll('a, button, span, div, [role="button"], [role="link"]')).forEach(el => {
            const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
            if (/^add finding$/i.test(t)) adds.push(el);
        });
    } catch (e) {}
    nfInnermost(adds).forEach(el => {
        // Skip if this Add Finding is already inside a row we'll pick up from a field
        starts.push(el);
    });
    const rows = [];
    const seen = new Set();
    for (const s of starts) {
        const row = nfClosestRow(s);
        if (!row) continue;
        if (seen.has(row)) continue;
        seen.add(row);
        rows.push(row);
    }
    rows.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1);
    return rows;
}

async function nfSetValue(el, val) {
    try {
        if (nfIsContentEditable(el)) {
            el.focus();
            el.textContent = val;
            try { el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, data: val, inputType: 'insertText' })); }
            catch (e) { el.dispatchEvent(new Event('input', { bubbles: true, composed: true })); }
            el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
            await nfSleep(80);
            try { el.blur(); } catch (e) {}
            await nfSleep(80);
            return;
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
        await nfSleep(80);
        try { el.blur(); } catch (e) {}
        await nfSleep(80);
    } catch (e) {
        nfLog('set-value error: ' + (e && e.message));
    }
}

function nfInnermostText(root, re, maxLen) {
    if (!root || !root.querySelectorAll) return null;
    const els = Array.from(root.querySelectorAll('a, button, span, div, p, li, label, select, option, [role="button"], [role="menuitem"], [role="option"], [role="link"]'));
    const hits = els.filter(el => {
        const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (!re.test(t)) return false;
        if (maxLen && t.length > maxLen) return false;
        return true;
    });
    hits.sort((a, b) => ((a.textContent || '').length) - ((b.textContent || '').length));
    return hits[0] || null;
}

async function nfRateAllGreen() {
    const control = nfInnermostText(document.body, /rate all tasks/i, 60);
    if (!control) {
        nfLog('rate-all: control not found, will rate each row');
        return false;
    }
    const sel = (control.tagName === 'SELECT' ? control : (control.closest && control.closest('select')));
    if (sel && sel.options) {
        const option = Array.from(sel.options).find(o => /checked\s*(&|and)?\s*okay|\bokay\b|checked/i.test(o.text));
        if (option) {
            const last = sel.value;
            sel.value = option.value;
            if (sel._valueTracker) sel._valueTracker.setValue(last);
            sel.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
            sel.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
            nfLog('rate-all: set <select> to ' + JSON.stringify(option.text));
            await nfSleep(200);
            return true;
        }
    }
    const clickable = (control.closest && control.closest(NF_CLICK)) || control;
    nfLog('rate-all: clicking control');
    nfClick(clickable);
    const opt = await nfWait(() => {
        const els = Array.from(document.querySelectorAll('li, button, [role="menuitem"], [role="option"], [role="listitem"], label, span, div, a'));
        const cands = els.filter(el => {
            const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
            if (t.length > 60 || t.length < 2) return false;
            if (el === control || (control.contains && control.contains(el) && el !== clickable && t.toLowerCase() === (control.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase())) return false;
            return /checked\s*(&|and)\s*okay/i.test(t) || /^checked\s*(&|and)?\s*ok(ay)?$/i.test(t);
        });
        cands.sort((a, b) => ((a.textContent || '').length) - ((b.textContent || '').length));
        return cands[0] || null;
    }, 2000);
    if (opt) {
        nfClick((opt.closest && opt.closest(NF_CLICK)) || opt);
        nfLog('rate-all: chose green/okay ' + JSON.stringify((opt.textContent || '').replace(/\s+/g, ' ').trim()));
        await nfSleep(250);
        return true;
    }
    nfLog('rate-all: menu opened but green option not found, snippet=' + JSON.stringify(nfSnippet(document.body)));
    try { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); } catch (e) {}
    return false;
}

function nfRateRowGreen(row) {
    const clusters = nfRatingClusters(row);
    if (!clusters.length) return 'no-ratings';
    const green = clusters[0].buttons[0];
    if (nfIsSelected(green)) return 'already-green';
    nfClick(green);
    return 'clicked';
}

async function nfOpenFinding(row) {
    let fields = nfFields(row);
    if (fields.length) return fields[0];
    const add = nfFindAddFinding(row);
    if (!add) return null;
    nfClick(add);
    const field = await nfWait(() => {
        const f = nfFields(row);
        return f[0] || null;
    }, 2500);
    return field;
}

function nfIsGenerated(value) {
    let flags = null;
    try { flags = ipcRenderer.sendSync('inspection-phrases', { action: 'clear', values: [value] }); } catch (e) {}
    if (flags && flags[0] === true) return true;
    return String(value || '').trim().toUpperCase() === NF_GENERIC.toUpperCase();
}

async function fillNoFaults() {
    if (nfBusy) return;
    nfBusy = true;
    try { document.documentElement.dataset.tekproNf = 'running'; } catch (e) {}
    try {
        nfLog('fill start url=' + String(location.href || '').slice(0, 180));
        const ratedAll = await nfRateAllGreen();
        const rows = nfFindRows();
        nfLog('fill rows=' + rows.length + ' rateAll=' + ratedAll);
        if (!rows.length) {
            const nFields = nfFields(document).length;
            nfLog('fill: no inspection rows found, fields=' + nFields + ' snippet=' + JSON.stringify(nfSnippet(document.body, 200)));
            return;
        }
        const labels = [];
        const snippets = [];
        for (const row of rows) {
            const field = nfFields(row)[0] || null;
            const label = getInspectionLabel(field, row);
            labels.push(label);
            snippets.push(nfSnippet(row, 160));
        }
        let texts = null;
        try { texts = ipcRenderer.sendSync('inspection-phrases', { action: 'fill', labels, snippets }); } catch (e) {}
        let filled = 0, skipped = 0, failed = 0;
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            try { row.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) {}
            if (!ratedAll) {
                const r = nfRateRowGreen(row);
                if (r !== 'already-green') nfLog('fill #' + i + ' rate-row=' + r);
            }

            const existingField = nfFields(row)[0];
            const existing = existingField ? nfFieldValue(existingField) : '';
            if (existing && !nfIsGenerated(existing)) {
                nfLog('fill #' + i + ' skip existing text label=' + JSON.stringify(labels[i]));
                skipped++;
                continue;
            }
            const field = await nfOpenFinding(row);
            if (!field) {
                nfLog('fill #' + i + ' no field (Add Finding missing?) label=' + JSON.stringify(labels[i]) + ' row=' + JSON.stringify(snippets[i]));
                failed++;
                continue;
            }
            // Re-read the label now that a field exists, in case the first pass had no field yet.
            let label = labels[i] || getInspectionLabel(field, row);
            if (label) labels[i] = label;
            if (!label) nfLog('fill #' + i + ' label="" row=' + JSON.stringify(snippets[i]));
            let use = (texts && texts[i]) || NF_GENERIC;
            // If the first ipc used an empty label and we just recovered one, ask again.
            if (label && use === NF_GENERIC) {
                try {
                    const again = ipcRenderer.sendSync('inspection-phrases', { action: 'fill', labels: [label], snippets: [snippets[i]] });
                    if (again && again[0]) use = again[0];
                } catch (e) {}
            }
            await nfSetValue(field, use);
            nfLog('fill #' + i + ' wrote label=' + JSON.stringify(label) + ' chars=' + use.length);
            filled++;
            await nfSleep(40);
        }
        // Second pass: virtualised rows that appeared after scrolling, or Add Finding that we missed.
        const again = nfFindRows();
        for (const row of again) {
            if (rows.includes(row)) continue;
            try { row.scrollIntoView({ block: 'nearest' }); } catch (e) {}
            if (!ratedAll) nfRateRowGreen(row);
            const existingField = nfFields(row)[0];
            const existing = existingField ? nfFieldValue(existingField) : '';
            if (existing && !nfIsGenerated(existing)) { skipped++; continue; }
            const field = await nfOpenFinding(row);
            if (!field) continue;
            const label = getInspectionLabel(field, row);
            let use = NF_GENERIC;
            try {
                const got = ipcRenderer.sendSync('inspection-phrases', { action: 'fill', labels: [label], snippets: [nfSnippet(row)] });
                if (got && got[0]) use = got[0];
            } catch (e) {}
            if (!label) nfLog('fill extra label="" row=' + JSON.stringify(nfSnippet(row)));
            await nfSetValue(field, use);
            filled++;
            nfLog('fill extra wrote label=' + JSON.stringify(label));
        }
        nfLog('fill done filled=' + filled + ' skipped=' + skipped + ' failed=' + failed + ' rows=' + rows.length);
    } catch (e) {
        nfLog('fill error: ' + (e && e.message) + ' ' + (e && e.stack));
    } finally {
        nfBusy = false;
        try { document.documentElement.dataset.tekproNf = 'done'; } catch (e) {}
    }
}

async function clearNoFaults() {
    if (nfBusy) return;
    nfBusy = true;
    try { document.documentElement.dataset.tekproNf = 'running'; } catch (e) {}
    try {
        nfLog('clear start');
        const fields = nfFields(document).filter(f => nfFieldValue(f));
        if (!fields.length) { nfLog('clear: no filled fields'); return; }
        let flags = null;
        try { flags = ipcRenderer.sendSync('inspection-phrases', { action: 'clear', values: fields.map(f => nfFieldValue(f)) }); } catch (e) {}
        let n = 0;
        for (let i = 0; i < fields.length; i++) {
            const generated = flags ? flags[i] === true : nfFieldValue(fields[i]).toUpperCase() === NF_GENERIC.toUpperCase();
            if (generated) {
                await nfSetValue(fields[i], '');
                n++;
                await nfSleep(30);
            }
        }
        nfLog('clear done removed=' + n + ' of ' + fields.length);
    } catch (e) {
        nfLog('clear error: ' + (e && e.message));
    } finally {
        nfBusy = false;
        try { document.documentElement.dataset.tekproNf = 'done'; } catch (e) {}
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
