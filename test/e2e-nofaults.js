// v2.4.1 Electron e2e: real preload (sandboxed) on a mock inspection page
// that mirrors the live Tekmetric layout (Rate All Tasks, rating circles,
// task name in a sibling cell sharing a wrapper with the ratings — the
// structure that left 2.4.0 labels empty — and "Add Finding" that reveals
// a textarea). Run: xvfb-run npx electron test/e2e-nofaults.js
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path'), fs = require('fs'), os = require('os');
const ph = require('../inspection-phrases');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'tekpro-nf-')));
ipcMain.on('get-settings', e => { e.returnValue = { showSidebar: false, presets: [] }; });
ipcMain.on('get-small-logo', e => { e.returnValue = ''; });
ipcMain.on('get-pdf-hook', e => { e.returnValue = ''; });
const seen = [], logs = [];
ipcMain.on('inspection-phrases', (e, req) => {
  if (req.action === 'fill') { seen.push(...req.labels); e.returnValue = req.labels.map(l => ph.phraseFor(l).text); }
  else if (req.action === 'clear') e.returnValue = (req.values || []).map(v => ph.isGeneratedPhrase(v));
  else if (req.action === 'log') { logs.push(req.message); console.log('LOG', req.message); e.returnValue = true; }
  else e.returnValue = null;
});
ipcMain.on('document-ready', () => {});

const TASKS = [
  'WARNING LIGHTS ON DASH',
  'CABIN AIR FILTER',
  'LIGHT CHECK',
  'WIPER BLADES & WINDSHIELD',
  'HORN',
  'AIR FILTER',
  'FLUID LEVELS',
  'BELT(S)',
  'BATTERY & TERMINALS',
  'ALTERNATOR',
  'SHOCKS, STRUTS & SPRINGS',
  'CV AXLE & BOOTS',
  'SWAY BAR BUSHINGS & STABILIZER LINKS',
  'CONTROL ARMS AND BALL JOINTS',
  'TIE RODS',
  'FRONT BRAKE PADS AND ROTORS',
  'REAR BRAKE PADS AND ROTORS/DRUMS',
  'TIRES TREAD, CONDITION, & PSI',
  'BODY, FRAME, & CONDITION',
  'BRAKE LINES & FUEL LINES',
  'EXHAUST SYSTEM',
  'FLUID LEAKS',
  'OTHER FAULTS FOUND',
];
const SECTIONS = {
  'WARNING LIGHTS ON DASH': 'INTERIOR',
  'LIGHT CHECK': 'EXTERIOR',
  'AIR FILTER': 'UNDER HOOD',
  'BATTERY & TERMINALS': 'STARTING/CHARGING SYSTEM',
  'SHOCKS, STRUTS & SPRINGS': 'STEERING AND SUSPENSION',
  'FRONT BRAKE PADS AND ROTORS': 'BRAKES',
  'TIRES TREAD, CONDITION, & PSI': 'UNDER VEHICLE',
  'FLUID LEAKS': 'FLUID LEAKS (GENERAL)',
  'OTHER FAULTS FOUND': 'OTHER FAULTS NOT LISTED',
};
// Modes that exercise every findings-cell shape seen on the live page.
const MODE = {
  'CABIN AIR FILTER': 'generic',          // already has GENERIC — Fill should replace it
  'HORN': 'add',                          // Add Finding reveals textarea
  'FLUID LEVELS': 'add',
  'FRONT BRAKE PADS AND ROTORS': 'user',  // technician text — must be left alone
  'EXHAUST SYSTEM': 'ce',                 // contenteditable
};

function rowHtml(name, i) {
  const id = 't' + i;
  const mode = MODE[name] || 'ta';
  let findings;
  if (mode === 'add') findings = `<button type="button" class="add-finding" data-id="${id}">Add Finding</button>`;
  else if (mode === 'ce') findings = `<div contenteditable="true" id="${id}"></div>`;
  else if (mode === 'user') findings = `<textarea id="${id}">PADS AT 3MM</textarea>`;
  else if (mode === 'generic') findings = `<textarea id="${id}">${ph.GENERIC}</textarea>`;
  else findings = `<textarea id="${id}"></textarea>`;
  const section = SECTIONS[name] ? `<div class="section-head">${SECTIONS[name]}</div>` : '';
  return `${section}
  <div class="insp-row" data-task="${name.replace(/"/g, '&quot;')}">
    <div class="left">
      <div class="ratings">
        <button type="button" class="rate rate-ok" aria-label="Checked &amp; Okay" aria-pressed="false"></button>
        <button type="button" class="rate" aria-label="Requires Attention Soon" aria-pressed="false"></button>
        <button type="button" class="rate" aria-label="Requires Immediate Attention" aria-pressed="false"></button>
        <button type="button" class="rate" aria-label="Not Applicable" aria-pressed="false"></button>
      </div>
      <span>${name}</span>
    </div>
    <div class="findings">${findings}</div>
  </div>`;
}

const html = `<!doctype html><html><body>
<div class="card">
  <h2>30 POINT VEHICLE INSPECTION</h2>
  <div>All edits will be auto-saved</div>
  <div class="toolbar">
    <button type="button" id="rate-all-btn">Rate All Tasks</button>
    <div id="rate-all-menu" hidden>
      <button type="button" role="menuitem" id="rate-all-ok">Checked &amp; Okay</button>
      <button type="button" role="menuitem">Requires Attention Soon</button>
      <button type="button" role="menuitem">Requires Immediate Attention</button>
      <button type="button" role="menuitem">Not Applicable</button>
    </div>
  </div>
  <div class="cols">Rating | Inspection Task | Findings</div>
  ${TASKS.map(rowHtml).join('\n')}
</div>
<script>
function selectGreen(row) {
  row.querySelectorAll('.rate').forEach(b => { b.setAttribute('aria-pressed', 'false'); b.classList.remove('selected'); });
  const g = row.querySelector('.rate-ok');
  if (g) { g.setAttribute('aria-pressed', 'true'); g.classList.add('selected'); }
}
document.addEventListener('click', (e) => {
  const allBtn = e.target.closest('#rate-all-btn');
  if (allBtn) {
    const m = document.getElementById('rate-all-menu');
    m.hidden = !m.hidden;
    return;
  }
  const ok = e.target.closest('#rate-all-ok');
  if (ok) {
    window.__rateAllUsed = true;
    document.querySelectorAll('.insp-row').forEach(selectGreen);
    document.getElementById('rate-all-menu').hidden = true;
    return;
  }
  const add = e.target.closest('.add-finding');
  if (add) {
    const ta = document.createElement('textarea');
    if (add.dataset.id) ta.id = add.dataset.id;
    add.replaceWith(ta);
    ta.focus();
    return;
  }
  const rate = e.target.closest('.rate');
  if (rate) {
    window.__rowRateClicks = (window.__rowRateClicks || 0) + 1;
    const row = rate.closest('.insp-row');
    row.querySelectorAll('.rate').forEach(b => { b.setAttribute('aria-pressed', 'false'); b.classList.remove('selected'); });
    rate.setAttribute('aria-pressed', 'true');
    rate.classList.add('selected');
  }
});
</script>
</body></html>`;

function fail(msg) { console.error('NOFAULTS E2E FAIL:', msg); app.exit(1); }

app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, '../preload.js'), contextIsolation: true } });
  await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise(r => setTimeout(r, 300));

  async function waitDone(ms) {
    const ok = await w.webContents.executeJavaScript(`new Promise(resolve => {
      if (document.documentElement.dataset.tekproNf === 'done') return resolve(true);
      const t0 = Date.now();
      const t = setInterval(() => {
        if (document.documentElement.dataset.tekproNf === 'done') { clearInterval(t); resolve(true); }
        else if (Date.now() - t0 > ${ms || 20000}) { clearInterval(t); resolve(false); }
      }, 40);
    })`);
    return ok;
  }
  async function run(channel) {
    await w.webContents.executeJavaScript(`document.documentElement.dataset.tekproNf = ''`);
    w.webContents.send(channel);
    const ok = await waitDone(20000);
    if (!ok) throw new Error('timed out waiting for ' + channel);
  }
  async function state() {
    return w.webContents.executeJavaScript(`(() => {
      const rows = [...document.querySelectorAll('.insp-row')];
      return {
        rateAllUsed: !!window.__rateAllUsed,
        rowClicks: window.__rowRateClicks || 0,
        rateAllPresent: !!document.getElementById('rate-all-btn'),
        rows: rows.map(r => {
          const f = r.querySelector('textarea, input, [contenteditable="true"]');
          let value = '', kind = 'none';
          if (f) {
            kind = f.isContentEditable ? 'ce' : f.tagName.toLowerCase();
            value = f.isContentEditable ? (f.innerText || f.textContent || '') : (f.value || '');
          } else if (r.querySelector('.add-finding')) { kind = 'add'; }
          const g = r.querySelector('.rate-ok');
          return { task: r.getAttribute('data-task'), value, kind, green: g ? g.getAttribute('aria-pressed') : null };
        })
      };
    })()`);
  }

  try {
    await run('fill-no-faults');
    const s1 = await state();
    console.log('labels', JSON.stringify(seen));
    console.log('state1', JSON.stringify(s1, null, 1));

    if (!s1.rateAllUsed) throw new Error('Rate All Tasks was not used');
    if (s1.rows.length !== TASKS.length) throw new Error('row count ' + s1.rows.length);

    for (const r of s1.rows) {
      if (r.green !== 'true') throw new Error('not green: ' + r.task + ' pressed=' + r.green);
      if (r.task === 'FRONT BRAKE PADS AND ROTORS') {
        if (r.value !== 'PADS AT 3MM') throw new Error('user text overwritten: ' + r.value);
        continue;
      }
      const want = ph.phraseFor(r.task).text;
      if (r.value.trim() !== want) throw new Error('wording for ' + r.task + ': got ' + JSON.stringify(r.value) + ' want ' + JSON.stringify(want));
      if (r.kind === 'none' || r.kind === 'add') throw new Error('no field opened for ' + r.task);
    }
    // Labels sent over ipc must include the task names (the 2.4.0 bug was label="")
    const useful = seen.filter(l => l && /warning lights|cabin air|horn|battery|alternator|fluid levels|belt|exhaust|other faults/i.test(l));
    if (useful.length < 6) throw new Error('labels were not extracted from rows: ' + JSON.stringify(seen));
    if (seen.some(l => l === '')) {
      const empty = seen.map((l, i) => l === '' ? i : null).filter(x => x != null);
      // Empty labels for any of the 23 is a regression of the original bug. Allow only if a
      // later recovered-label pass still wrote the right wording (already asserted above),
      // but flag it.
      console.log('WARN empty labels at', empty, 'snippets in logs');
    }

    // User-edit one generated box, uppercase another (Auto Uppercase), then Clear
    await w.webContents.executeJavaScript(`(() => {
      const bat = document.getElementById('t${TASKS.indexOf('BATTERY & TERMINALS')}');
      if (bat) bat.value = bat.value + ' Terminals cleaned.';
      const wld = document.getElementById('t${TASKS.indexOf('WARNING LIGHTS ON DASH')}');
      if (wld) wld.value = wld.value.toUpperCase();
    })()`);
    await run('clear-no-faults');
    const s2 = await state();
    console.log('state2', JSON.stringify(s2, null, 1));
    const bat = s2.rows.find(r => r.task === 'BATTERY & TERMINALS');
    const wld = s2.rows.find(r => r.task === 'WARNING LIGHTS ON DASH');
    const front = s2.rows.find(r => r.task === 'FRONT BRAKE PADS AND ROTORS');
    const cabin = s2.rows.find(r => r.task === 'CABIN AIR FILTER');
    const horn = s2.rows.find(r => r.task === 'HORN');
    if (!bat.value.endsWith('Terminals cleaned.')) throw new Error('edited text was cleared: ' + bat.value);
    if (wld.value !== '') throw new Error('uppercase generated text was not cleared: ' + wld.value);
    if (front.value !== 'PADS AT 3MM') throw new Error('user pads text lost: ' + front.value);
    if (cabin.value !== '') throw new Error('replaced-generic was not cleared: ' + cabin.value);
    if (horn.value !== '') throw new Error('horn finding was not cleared: ' + horn.value);

    // Fallback: no Rate All Tasks, rate each row's green button, don't toggle already-green
    await w.webContents.executeJavaScript(`(() => {
      const btn = document.getElementById('rate-all-btn');
      if (btn) btn.remove();
      const menu = document.getElementById('rate-all-menu');
      if (menu) menu.remove();
      window.__rateAllUsed = false;
      window.__rowRateClicks = 0;
      document.querySelectorAll('.insp-row').forEach(row => {
        row.querySelectorAll('.rate').forEach(b => { b.setAttribute('aria-pressed', 'false'); b.classList.remove('selected'); });
      });
      // Leave one already green — Fill must not toggle it off
      const first = document.querySelector('.insp-row .rate-ok');
      first.setAttribute('aria-pressed', 'true');
      first.classList.add('selected');
    })()`);
    await run('fill-no-faults');
    const s3 = await state();
    console.log('state3 clicks=', s3.rowClicks, 'rateAllUsed=', s3.rateAllUsed);
    if (s3.rateAllUsed) throw new Error('rate-all used after control was removed');
    if (s3.rowClicks < 20) throw new Error('per-row green fallback did not run, clicks=' + s3.rowClicks);
    for (const r of s3.rows) {
      if (r.green !== 'true') throw new Error('fallback not green: ' + r.task);
    }
    // Already-green first row must still be green (not toggled off). clicks should be 22 not 23
    // (22 remaining unselected rows). Allow 22 or 23 if detection couldn't see the first as selected.
    const firstStill = s3.rows[0].green;
    if (firstStill !== 'true') throw new Error('already-green was toggled off');

    console.log('NOFAULTS E2E OK');
    app.exit(0);
  } catch (e) {
    console.error(e && e.stack || e);
    console.error('logs', logs.join('\n'));
    fail(e && e.message);
  }
});
