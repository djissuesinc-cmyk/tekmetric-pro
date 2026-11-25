'use strict';
// v2.5.0: put an AI answer back into the field the user selected the text in, even if focus moved
// while the request was running. Both scripts run in the page (main world) via executeJavaScript.

// Remember the field and the selected range at the moment the menu item is clicked.
function captureSrc(id) {
  return `(() => {
    try {
      const id = ${JSON.stringify(String(id))};
      const store = (window.__tekAiTargets = window.__tekAiTargets || {});
      const ids = Object.keys(store); if (ids.length > 6) delete store[ids[0]];
      const el = document.activeElement;
      if (el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && /^(text|search|)$/i.test(el.type || ''))) && el.selectionEnd > el.selectionStart) {
        store[id] = { el, kind: 'field', start: el.selectionStart, end: el.selectionEnd, sel: el.value.slice(el.selectionStart, el.selectionEnd) };
        return 'field';
      }
      if (el && el.isContentEditable) {
        const s = window.getSelection();
        if (s && s.rangeCount && !s.isCollapsed) { store[id] = { el, kind: 'editable', range: s.getRangeAt(0).cloneRange(), sel: String(s) }; return 'editable'; }
      }
    } catch (e) {}
    return 'none';
  })()`;
}

// Replace the remembered selection with the answer. Returns 'inserted' or a short reason string.
function applySrc(id, text) {
  return `(() => {
    const id = ${JSON.stringify(String(id))}, text = ${JSON.stringify(String(text))};
    const store = window.__tekAiTargets || {};
    const t = store[id]; delete store[id];
    if (!t || !t.el || !t.el.isConnected) return 'no-target';
    const el = t.el;
    try {
      if (t.kind === 'field') {
        const cur = el.value; let s = t.start, e = t.end;
        if (cur.slice(s, e) !== t.sel) { const i = cur.indexOf(t.sel); if (i < 0) return 'text-changed'; s = i; e = i + t.sel.length; }
        el.focus({ preventScroll: true });
        el.setSelectionRange(s, e);
        const want = cur.slice(0, s) + text + cur.slice(e);
        let ok = false;
        try { ok = document.execCommand('insertText', false, text); } catch (x) {}
        if (!ok || el.value !== want) {
          const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, want);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.setSelectionRange(s + text.length, s + text.length);
        }
        return el.value === want ? 'inserted' : 'not-applied';
      }
      if (t.kind === 'editable') {
        el.focus({ preventScroll: true });
        const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(t.range);
        if (String(sel) !== t.sel) return 'text-changed';
        return document.execCommand('insertText', false, text) ? 'inserted' : 'not-applied';
      }
    } catch (e) { return 'error:' + (e && e.message); }
    return 'no-target';
  })()`;
}

module.exports = { captureSrc, applySrc };
