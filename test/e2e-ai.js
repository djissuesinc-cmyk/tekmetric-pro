// v2.5.0 Electron e2e for the AI path:
//  1) net.fetch (what main.js uses) works with the AI client against a local server, incl. abort on a hung server
//  2) the answer goes back into the ORIGINAL field even after focus moved, and falls back safely when it can't
// Run: xvfb-run -a npx electron test/e2e-ai.js
const { app, BrowserWindow, net } = require('electron');
const http = require('http'), path = require('path'), fs = require('fs'), os = require('os');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'tekpro-ai-')));
const { createAiClient } = require('../ai-request');
const { captureSrc, applySrc } = require('../ai-insert');
const fail = (m) => { console.error('AI E2E FAIL: ' + m); app.exit(1); };

const server = http.createServer((req, res) => {
  let body = ''; req.on('data', d => body += d); req.on('end', () => {
    if (!req.headers['x-goog-api-key']) { res.writeHead(401); return res.end('{}'); }
    if (/hang/.test(req.url)) return; // never answers
    if (/flaky/.test(req.url)) { server.n = (server.n || 0) + 1; if (server.n === 1) { res.writeHead(503, { 'content-type': 'application/json' }); return res.end('{"error":{"message":"busy","status":"UNAVAILABLE"}}'); } }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Replaced text.' }] }, finishReason: 'STOP' }] }));
  });
});

app.whenReady().then(async () => {
  try {
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const base = 'http://127.0.0.1:' + server.address().port + '/';
    const aiFetch = (u, init) => net.fetch(u, Object.assign({}, init, { bypassCustomProtocolHandlers: true }));
    const mk = (prefix, o) => createAiClient(Object.assign({ fetch: aiFetch, getKey: () => 'k', endpoint: base + prefix, models: ['m1'], log: () => {}, sleep: async () => {} }, o));

    let r = await mk('ok/').request('hello');
    if (!r.ok || r.text !== 'Replaced text.') return fail('net.fetch happy path ' + JSON.stringify(r));
    r = await mk('flaky/', { maxRetries: 2 }).request('hello');
    if (!r.ok) return fail('503 then ok via net.fetch ' + JSON.stringify(r));
    const t0 = Date.now();
    r = await mk('hang/', { timeoutMs: 700, deadlineMs: 2500, maxRetries: 0 }).request('hello');
    if (r.ok || r.kind !== 'timeout' || Date.now() - t0 > 2500) return fail('hung server must time out fast: ' + JSON.stringify(r) + ' ' + (Date.now() - t0) + 'ms');
    console.log('net.fetch client ok (timeout in ' + (Date.now() - t0) + 'ms)');

    const win = new BrowserWindow({ show: true, width: 700, height: 500 });
    await win.loadURL('data:text/html,' + encodeURIComponent(`<body>
      <textarea id="a" style="width:300px;height:80px">the brke part is wornn out</textarea>
      <textarea id="b" style="width:300px;height:80px">other</textarea>
      <input id="i" value="leaking gasket">
      <div id="ce" contenteditable="true">seats tore</div>
      <script>window.__inputs=0; document.getElementById('a').addEventListener('input',()=>window.__inputs++);</script></body>`));
    const js = (c) => win.webContents.executeJavaScript(c);
    const sel = (id, s, e) => js(`(()=>{const el=document.getElementById('${id}'); el.focus(); el.setSelectionRange(${s},${e});})()`);

    // A) textarea: select, capture, move focus away, then apply
    await sel('a', 0, 26);
    if (await js(captureSrc('A')) !== 'field') return fail('capture A');
    await js(`document.getElementById('b').focus()`);
    let how = await js(applySrc('A', 'THE BRAKE PART IS WORN OUT'));
    let v = await js(`[document.getElementById('a').value, document.getElementById('b').value, window.__inputs]`);
    if (how !== 'inserted' || v[0] !== 'THE BRAKE PART IS WORN OUT' || v[1] !== 'other' || v[2] < 1) return fail('A: ' + how + ' ' + JSON.stringify(v));
    console.log('A ok: result went into the original field (focus had moved), input event fired x' + v[2]);

    // B) selection in the middle of the text keeps the rest
    await js(`document.getElementById('a').value='fix the brke part now'`);
    await sel('a', 8, 17);
    await js(captureSrc('B')); await js(`document.getElementById('b').focus()`);
    how = await js(applySrc('B', 'brake part'));
    v = await js(`document.getElementById('a').value`);
    if (how !== 'inserted' || v !== 'fix the brake part now') return fail('B: ' + how + ' ' + v);
    console.log('B ok: rest of the text kept');

    // C) the user typed in the field meanwhile: text moved but is still found
    await js(`document.getElementById('a').value='fix the brke part now'`);
    await sel('a', 8, 17);
    await js(captureSrc('C'));
    await js(`document.getElementById('a').value='PLEASE ' + document.getElementById('a').value`);
    how = await js(applySrc('C', 'brake part'));
    v = await js(`document.getElementById('a').value`);
    if (how !== 'inserted' || v !== 'PLEASE fix the brake part now') return fail('C: ' + how + ' ' + v);
    console.log('C ok: text shifted while waiting, still replaced the right words');

    // D) selected words were deleted meanwhile: do not overwrite anything
    await js(`document.getElementById('a').value='fix the brke part now'`);
    await sel('a', 8, 17);
    await js(captureSrc('D'));
    await js(`document.getElementById('a').value='something else entirely'`);
    how = await js(applySrc('D', 'brake part'));
    v = await js(`document.getElementById('a').value`);
    if (how !== 'text-changed' || v !== 'something else entirely') return fail('D: ' + how + ' ' + v);
    console.log('D ok: field changed under us -> left alone (main falls back to paste)');

    // E) field removed from the page
    await sel('b', 0, 3); await js(captureSrc('E'));
    await js(`document.getElementById('b').remove()`);
    how = await js(applySrc('E', 'x'));
    if (how !== 'no-target') return fail('E: ' + how);
    console.log('E ok: removed field -> no-target');

    // F) <input>
    await sel('i', 0, 7);
    if (await js(captureSrc('F')) !== 'field') return fail('capture F');
    await js(`document.getElementById('a').focus()`);
    how = await js(applySrc('F', 'LEAKY'));
    v = await js(`document.getElementById('i').value`);
    if (how !== 'inserted' || v !== 'LEAKY gasket') return fail('F: ' + how + ' ' + v);
    console.log('F ok: <input>');

    // G) contenteditable
    await js(`(()=>{const ce=document.getElementById('ce'); ce.focus(); const r=document.createRange(); r.selectNodeContents(ce); const s=getSelection(); s.removeAllRanges(); s.addRange(r);})()`);
    if (await js(captureSrc('G')) !== 'editable') return fail('capture G');
    await js(`document.getElementById('a').focus()`);
    how = await js(applySrc('G', 'SEATS TORN'));
    v = await js(`document.getElementById('ce').textContent`);
    if (how !== 'inserted' || v !== 'SEATS TORN') return fail('G: ' + how + ' ' + v);
    console.log('G ok: contenteditable');

    // H) no selection inside a field (e.g. text selected on the page) -> capture says none
    await js(`document.getElementById('a').blur(); getSelection().removeAllRanges()`);
    if (await js(captureSrc('H')) !== 'none') return fail('capture H should be none');
    console.log('H ok: nothing capturable -> main uses paste fallback');

    console.log('AI E2E OK');
    server.close(); app.exit(0);
  } catch (e) { fail(e && e.stack || e); }
});
setTimeout(() => fail('timeout'), 60000);
