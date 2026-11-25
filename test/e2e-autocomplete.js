// v2.4.8 Electron e2e: picking a supplier/part from an autocomplete list must register on the FIRST click.
// Auto-caps is ON and the typed text is lowercase, so on blur the old code rewrote the box to uppercase,
// fired input, the page re-rendered the list and the click on the option was lost.
// Uses real mouse events (sendInputEvent) so the input really blurs on mousedown.
// Run: xvfb-run -a npx electron test/e2e-autocomplete.js
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path'), fs = require('fs'), os = require('os');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'tekpro-ac-')));
ipcMain.on('get-settings', e => { e.returnValue = { showSidebar: false, presets: [], autoCaps: true }; });
ipcMain.on('get-small-logo', e => { e.returnValue = ''; });
ipcMain.on('get-pdf-hook', e => { e.returnValue = ''; });
ipcMain.on('document-ready', () => {});

// Each variant: input markup, and how the list is built (all lists live in a portal on <body>).
// The list is rebuilt on EVERY input event (like a real autocomplete re-filtering), so a rewrite of the
// value on blur replaces the option node between mousedown and mouseup and the click is lost.
const VARIANTS = {
  mui: { inputAttrs: 'role="combobox" aria-autocomplete="list" aria-expanded="true"', listAttrs: 'role="listbox" class="MuiAutocomplete-popper"', optAttrs: 'role="option"' },
  plain: { inputAttrs: '', listAttrs: '', optAttrs: '' },                                  // no ARIA, no classes at all
  aria: { inputAttrs: 'aria-controls="lb"', listAttrs: 'id="lb" role="listbox"', optAttrs: 'role="option"' },
  inline: { inputAttrs: '', listAttrs: 'class="sugg-list"', optAttrs: 'class="sugg-item"', inline: true } // list inside the same container, no roles
};
function page(v) {
  return `<!doctype html><html><body style="margin:0"><div id="root" style="padding:20px">
<label>Supplier</label><div id="field"><input id="sup" type="text" ${v.inputAttrs} style="width:240px;height:28px" /></div>
${v.inline ? '<div id="inlinehost"></div>' : ''}
<button id="save" type="button" style="margin-top:300px">Save</button>
<textarea id="plainta" style="display:block;width:200px;height:40px"></textarea>
<textarea id="finding" class="block border-0 py-2 outline-none" placeholder="Enter finding" style="display:block;width:200px;height:40px"></textarea>
</div>
<script>
window.__clicks = 0; window.__selected = null; window.__downs = 0; window.__listRebuilds = 0;
const ALL = ['NAPA AUTO PARTS', 'NAPA DISTRIBUTION', 'CARQUEST', 'LORDCO'];
const input = document.getElementById('sup');
let host = null;
function ensureHost() {
  if (host) return host;
  host = document.createElement('div');
  host.setAttribute('data-host','1');
  host.setAttribute('data-listattrs', ${JSON.stringify(v.listAttrs)});
  ${v.listAttrs ? `for (const m of ${JSON.stringify(v.listAttrs)}.matchAll(/([\\w-]+)="([^"]*)"/g)) host.setAttribute(m[1], m[2]);` : ''}
  host.style.cssText = 'position:absolute;left:20px;top:56px;width:260px;background:#fff;border:1px solid #888;z-index:99999';
  (${v.inline ? 'document.getElementById("inlinehost")' : 'document.body'}).appendChild(host);
  return host;
}
function render() {
  window.__listRebuilds++;
  const q = input.value.toLowerCase();
  const h = ensureHost();
  h.innerHTML = '';
  ALL.filter(x => x.toLowerCase().includes(q)).forEach(x => {
    const d = document.createElement('div');
    d.textContent = x;
    d.style.cssText = 'padding:8px;height:20px';
    ${v.optAttrs ? `for (const m of ${JSON.stringify(v.optAttrs)}.matchAll(/([\\w-]+)="([^"]*)"/g)) d.setAttribute(m[1], m[2]);` : ''}
    d.addEventListener('click', () => { window.__clicks++; window.__selected = x; input.value = x; h.remove(); host = null; });
    h.appendChild(d);
  });
}
input.addEventListener('input', render);
document.addEventListener('mousedown', () => window.__downs++, true);
</script></body></html>`;
}

function fail(msg) { console.error('AUTOCOMPLETE E2E FAIL:', msg); app.exit(1); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: true, width: 700, height: 700, webPreferences: { preload: path.join(__dirname, '../preload.js'), contextIsolation: true } });
  const ev = (type, x, y, extra) => w.webContents.sendInputEvent(Object.assign({ type, x, y, button: 'left', clickCount: 1 }, extra || {}));
  const center = async (sel) => w.webContents.executeJavaScript(`(()=>{const r=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`);
  const click = async (sel) => { const c = await center(sel); ev('mouseMove', c.x, c.y); ev('mouseDown', c.x, c.y); await sleep(30); ev('mouseUp', c.x, c.y); await sleep(250); };
  const results = [];
  try {
    for (const [name, v] of Object.entries(VARIANTS)) {
      await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(page(v)));
      await sleep(250);
      w.focus(); w.webContents.focus();
      await click('#sup');
      w.webContents.insertText('napa');           // lowercase typed text, auto-caps ON
      await sleep(200);
      const before = await w.webContents.executeJavaScript(`({val: document.getElementById('sup').value, opts: document.querySelectorAll('[data-host] > div').length, focused: document.activeElement.id})`);
      if (before.val !== 'napa' || before.opts < 2) throw new Error(name + ': setup wrong ' + JSON.stringify(before));
      const rebuildsBefore = await w.webContents.executeJavaScript('window.__listRebuilds');
      // ONE click on the second option
      await click('[data-host] > div:nth-child(2)');
      const s = await w.webContents.executeJavaScript(`({clicks: window.__clicks, selected: window.__selected, value: document.getElementById('sup').value, rebuilds: window.__listRebuilds})`);
      console.log(name, 'after ONE click:', JSON.stringify(s), 'rebuilds before click', rebuildsBefore);
      if (s.clicks !== 1 || s.selected !== 'NAPA DISTRIBUTION') throw new Error(name + ': one click did not select ' + JSON.stringify(s));
      if (s.rebuilds !== rebuildsBefore) throw new Error(name + ': list was rebuilt by blur (auto-caps rewrote the box) ' + JSON.stringify(s));
      results.push(name);
    }

    // Regression: plain textarea + Inspection 'Enter finding' box must still be uppercased synchronously on blur
    await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(page(VARIANTS.plain)));
    await sleep(250);
    w.focus(); w.webContents.focus();
    // value as seen by a React-style onBlur (React 17+ listens to focusout on the root) must already be uppercase
    await w.webContents.executeJavaScript(`
      window.__saved = {};
      document.getElementById('root').addEventListener('focusout', e => { window.__saved[e.target.id] = e.target.value; });
    `);
    for (const id of ['plainta', 'finding']) {
      await click('#' + id);
      w.webContents.insertText('rotors are worn');
      await sleep(100);
      await click('#save');   // plain button in the same root: blur, no popup
      await sleep(100);
    }
    const r = await w.webContents.executeJavaScript(`({plain: document.getElementById('plainta').value, finding: document.getElementById('finding').value, saved: window.__saved})`);
    console.log('regression', JSON.stringify(r));
    if (r.plain !== 'ROTORS ARE WORN' || r.finding !== 'ROTORS ARE WORN') throw new Error('auto-caps no longer uppercases plain boxes: ' + JSON.stringify(r));
    if (r.saved.plainta !== 'ROTORS ARE WORN' || r.saved.finding !== 'ROTORS ARE WORN') throw new Error('page blur handler saw lowercase text (not synchronous): ' + JSON.stringify(r));

    console.log('AUTOCOMPLETE E2E OK', results.join(','));
    app.exit(0);
  } catch (e) { fail(e.message); }
});
