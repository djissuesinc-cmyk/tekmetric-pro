// Main-world PDF blob hook. Injected into every Tekmetric window (and its about:blank children) via
// webContents.executeJavaScript, which always runs in the page's main world.
// Keeps every Blob behind a blob: URL so it can still be read after Tekmetric revokes it, and reports
// to the app through console messages tagged [tekpro-pdf].
module.exports = `(() => {
  try {
    if (window.__tekproPdfHook) return 'already';
    window.__tekproPdfHook = true;
    const tag = (m) => { try { console.log('[tekpro-pdf] ' + m); } catch (e) {} };
    const blobs = new Map();
    const origCreate = URL.createObjectURL.bind(URL);
    const origRevoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = function (obj) {
      const u = origCreate(obj);
      try {
        if (obj && typeof obj.size === 'number') {
          blobs.set(u, obj);
          setTimeout(() => blobs.delete(u), 180000);
          tag('createObjectURL type=' + (obj.type || '?') + ' size=' + obj.size + ' url=' + u + ' in=' + location.href);
        }
      } catch (e) {}
      return u;
    };
    URL.revokeObjectURL = function (u) {
      if (blobs.has(u)) { setTimeout(() => origRevoke(u), 60000); return; }
      return origRevoke(u);
    };
    // Read a blob's bytes as base64 (works even after revoke, from our own reference)
    window.__tekproReadBlob = async (u) => {
      let b = blobs.get(u);
      if (!b && window.opener) { try { if (window.opener.__tekproGetBlob) b = window.opener.__tekproGetBlob(u); } catch (e) {} }
      if (!b) b = await (await fetch(u)).blob();
      const buf = new Uint8Array(await b.arrayBuffer());
      let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      return btoa(s);
    };
    window.__tekproGetBlob = (u) => blobs.get(u);
    const seen = new Set();
    const check = (el) => {
      const src = el && (el.src || el.data || '');
      if (typeof src === 'string' && src.startsWith('blob:') && !seen.has(src)) {
        seen.add(src);
        tag('element ' + el.tagName + ' src=' + src);
        window.postMessage({ __tekproPdf: true, url: src }, window.location.origin === 'null' ? '*' : window.location.origin);
      }
    };
    const start = () => {
      new MutationObserver((muts) => {
        for (const m of muts) {
          if (m.type === 'attributes') check(m.target);
          for (const n of m.addedNodes || []) {
            if (n.nodeType !== 1) continue;
            if (/^(IFRAME|EMBED|OBJECT)$/.test(n.tagName)) check(n);
            n.querySelectorAll && n.querySelectorAll('iframe,embed,object').forEach(check);
          }
        }
      }).observe(document.documentElement || document, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'data'] });
      document.querySelectorAll('iframe,embed,object').forEach(check);
    };
    start();
    tag('hook installed in ' + location.href);
    return 'installed';
  } catch (e) { try { console.log('[tekpro-pdf] hook error ' + e); } catch (x) {} return 'error'; }
})();`;
