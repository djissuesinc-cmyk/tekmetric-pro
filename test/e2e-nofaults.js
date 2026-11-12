// v2.4.4 Electron e2e: Fill "No Faults" on a mock inspection page, including a
// live-Tekmetric layout (MUI Select via mousedown + portal menu, ratings in a
// sibling cell, Add finding opening a portal, global search + concerns that
// must not be touched), a heavy 5000-node page with no long task > 200ms, a
// shared-parent page where Concerns sits above the inspection with its own
// Add finding / Rate buttons / Add Concern (must never be clicked), and a
// no-card page that must log "card not found" and do nothing.
// Run: xvfb-run npx electron test/e2e-nofaults.js
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path'), fs = require('fs'), os = require('os');
const ph = require('../inspection-phrases');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'tekpro-nf-')));

ipcMain.on('get-settings', e => { e.returnValue = { showSidebar: false, presets: [], autoCaps: true }; });
ipcMain.on('get-small-logo', e => { e.returnValue = ''; });
ipcMain.on('get-pdf-hook', e => { e.returnValue = ''; });

const seen = [], logs = [];
function phrasesIpc(req) {
  if (!req) return null;
  if (req.action === 'fill') { seen.push(...(req.labels || [])); return (req.labels || []).map(l => ph.phraseFor(l).text); }
  if (req.action === 'clear') return (req.values || []).map(v => ph.isGeneratedPhrase(v));
  if (req.action === 'book') {
    return { generic: ph.GENERIC, sentences: ph.RULES.map(r => r.text).concat(ph.LEGACY || []).concat([ph.GENERIC]) };
  }
  if (req.action === 'log') { logs.push(req.message); return true; }
  return null;
}
ipcMain.handle('inspection-phrases', async (e, req) => phrasesIpc(req));
ipcMain.on('inspection-phrases', (e, req) => { e.returnValue = phrasesIpc(req); });
ipcMain.on('inspection-phrases-log', (e, batch) => {
  (Array.isArray(batch) ? batch : [batch]).forEach(m => { logs.push(m); console.log('LOG', m); });
});
ipcMain.on('document-ready', () => {});

const TASKS = [
  'WARNING LIGHTS ON DASH', 'CABIN AIR FILTER', 'LIGHT CHECK', 'WIPER BLADES & WINDSHIELD',
  'HORN', 'AIR FILTER', 'FLUID LEVELS', 'BELT(S)', 'BATTERY & TERMINALS', 'ALTERNATOR',
  'SHOCKS, STRUTS & SPRINGS', 'CV AXLE & BOOTS', 'SWAY BAR BUSHINGS & STABILIZER LINKS',
  'CONTROL ARMS AND BALL JOINTS', 'TIE RODS', 'FRONT BRAKE PADS AND ROTORS',
  'REAR BRAKE PADS AND ROTORS/DRUMS', 'TIRES TREAD, CONDITION, & PSI',
  'BODY, FRAME, & CONDITION', 'BRAKE LINES & FUEL LINES', 'EXHAUST SYSTEM',
  'FLUID LEAKS', 'OTHER FAULTS FOUND',
];
const SECTIONS = {
  'WARNING LIGHTS ON DASH': 'INTERIOR', 'LIGHT CHECK': 'EXTERIOR', 'AIR FILTER': 'UNDER HOOD',
  'BATTERY & TERMINALS': 'STARTING/CHARGING SYSTEM', 'SHOCKS, STRUTS & SPRINGS': 'STEERING AND SUSPENSION',
  'FRONT BRAKE PADS AND ROTORS': 'BRAKES', 'TIRES TREAD, CONDITION, & PSI': 'UNDER VEHICLE',
  'FLUID LEAKS': 'FLUID LEAKS (GENERAL)', 'OTHER FAULTS FOUND': 'OTHER FAULTS NOT LISTED',
};
const MODE = {
  'CABIN AIR FILTER': 'generic',
  'HORN': 'add',
  'FLUID LEVELS': 'add',
  'FRONT BRAKE PADS AND ROTORS': 'user',
  'EXHAUST SYSTEM': 'ce',
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
  <div class="insp-row" data-task="${name}">
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

const htmlClassic = `<!doctype html><html><body>
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

// Live-Tekmetric layout: global search, concerns, MUI Select (mousedown + body portal,
// first option is an icon with aria-label only), ratings in a SIBLING of an inner
// [role=row] that only has the name + "Add finding", and Add finding opens a
// popover portal on document.body (not inside the small row). Plus 5000 junk nodes.
const LIVE_TASKS = [
  'WARNING LIGHTS ON DASH', 'CABIN AIR FILTER', 'HORN', 'AIR FILTER',
  'BATTERY & TERMINALS', 'ALTERNATOR', 'FRONT BRAKE PADS AND ROTORS',
  'TIE RODS', 'FLUID LEAKS', 'OTHER FAULTS FOUND',
];
function liveRow(name) {
  // Live page: each inspection task already has a <textarea> (2.4.0 found all 23).
  // HORN stays "Add finding" so the fallback path is still tested.
  const finding = name === 'HORN'
    ? `<button type="button" class="add-finding">Add finding</button>`
    : `<textarea class="insp-ta" data-task="${name}"></textarea>`;
  return `<div class="grid-row insp-row" data-task="${name}">
    <div class="rating-cell">
      <div class="ratings">
        <button type="button" class="rate rate-ok" aria-label="Checked &amp; Okay" aria-pressed="false"></button>
        <button type="button" class="rate" aria-label="Requires Attention Soon" aria-pressed="false"></button>
        <button type="button" class="rate" aria-label="Requires Immediate Attention" aria-pressed="false"></button>
        <button type="button" class="rate" aria-label="Not Applicable" aria-pressed="false"></button>
      </div>
    </div>
    <div class="name-cell">
      <div role="row">
        <span>${name}</span>
        ${finding}
      </div>
    </div>
  </div>`;
}
const htmlLive = `<!doctype html><html><body>
<div id="page" class="px-3 sm:px-6 relative xl:max-w-7xl">
<header>
  <input id="global-search" type="text" placeholder="Search Tekmetric..." />
</header>
<div class="concerns">
  <h3>Concerns</h3>
  <div class="concern-row">
    4 NEW WINTER TIRES
    <button type="button" class="add-finding">Add finding</button>
    <button type="button">Add media</button>
    <button type="button">Edit</button>
  </div>
  <div class="concern-row">
    -&gt; SUMMERS IN BAGS INTO VEHICLE PLEASE
    <button type="button" class="add-finding">Add finding</button>
    <button type="button">Add media</button>
    <button type="button">Edit</button>
  </div>
</div>
<div class="insp-card" id="insp-card">
  <div class="flex w-full min-w-0 flex-col gap-2 py-1.5" id="insp-header">
    <div class="truncate">30 POINT VEHICLE INSPECTION</div>
    <div class="flex">
      <label id="rate-all-label">Rate All Tasks</label>
      <div id="rate-all-mui" role="button" aria-haspopup="listbox" aria-labelledby="rate-all-label" tabindex="0"></div>
      <span>All edits will be auto-saved</span>
      <button type="button" id="insp-done">Done</button>
    </div>
  </div>
  <div class="insp-rows">
    <div class="cols">Rating | Inspection Task | Findings</div>
    ${LIVE_TASKS.map(liveRow).join('\n')}
  </div>
</div>
</div>
<div id="junk"></div>
<script>
window.__rateAllUsed = false;
window.__rowRateClicks = 0;
window.__concernClicked = false;
window.__portals = 0;
window.__longTasks = [];
window.__longTaskErr = '';
// Observer is started AFTER the 5000 junk nodes are built, so page setup is not counted.

function selectGreen(row) {
  row.querySelectorAll('.rate').forEach(b => { b.setAttribute('aria-pressed', 'false'); b.classList.remove('selected'); });
  const g = row.querySelector('.rate-ok');
  if (g) { g.setAttribute('aria-pressed', 'true'); g.classList.add('selected'); }
}

// MUI Select: opens on mousedown only. A plain click does nothing.
const mui = document.getElementById('rate-all-mui');
mui.addEventListener('mousedown', (e) => {
  e.preventDefault();
  if (document.getElementById('mui-portal-menu')) return;
  const menu = document.createElement('ul');
  menu.id = 'mui-portal-menu';
  menu.setAttribute('role', 'listbox');
  menu.className = 'MuiMenu-list';
  const opt1 = document.createElement('li');
  opt1.setAttribute('role', 'option');
  opt1.setAttribute('aria-label', 'Checked & Okay');
  opt1.setAttribute('data-value', 'ok');
  opt1.innerHTML = '<svg width="16" height="16"><circle cx="8" cy="8" r="7" fill="green"></circle></svg>';
  const pick = (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    window.__rateAllUsed = true;
    document.querySelectorAll('.insp-card .insp-row').forEach(selectGreen);
    menu.remove();
  };
  opt1.addEventListener('mousedown', pick);
  opt1.addEventListener('click', pick);
  menu.appendChild(opt1);
  ['Requires Attention Soon', 'Requires Immediate Attention', 'Not Applicable'].forEach(t => {
    const li = document.createElement('li');
    li.setAttribute('role', 'option');
    li.textContent = t;
    menu.appendChild(li);
  });
  document.body.appendChild(menu);
});

document.addEventListener('mousedown', (e) => {
  const concern = e.target.closest('.concerns .add-finding');
  if (concern) { window.__concernClicked = true; return; }
  const add = e.target.closest('.insp-card .add-finding');
  if (!add) return;
  e.preventDefault();
  const row = add.closest('.insp-row');
  const task = row.getAttribute('data-task');
  const pop = document.createElement('div');
  pop.className = 'MuiPopover-root';
  const ta = document.createElement('textarea');
  ta.className = 'portal-finding';
  ta.setAttribute('data-task', task);
  const save = () => { row.setAttribute('data-finding', ta.value || ''); };
  ta.addEventListener('input', save);
  ta.addEventListener('change', save);
  ta.addEventListener('blur', save);
  pop.appendChild(ta);
  document.body.appendChild(pop);
  ta.focus();
  window.__portals = (window.__portals || 0) + 1;
});

document.addEventListener('click', (e) => {
  const rate = e.target.closest('.insp-card .rate');
  if (!rate) return;
  window.__rowRateClicks = (window.__rowRateClicks || 0) + 1;
  const row = rate.closest('.insp-row');
  row.querySelectorAll('.rate').forEach(b => { b.setAttribute('aria-pressed', 'false'); b.classList.remove('selected'); });
  rate.setAttribute('aria-pressed', 'true');
  rate.classList.add('selected');
});

const junk = document.getElementById('junk');
const frag = document.createDocumentFragment();
for (let i = 0; i < 5000; i++) {
  const d = document.createElement('div');
  d.className = 'junk-item';
  const s = document.createElement('span');
  s.textContent = 'Junk item ' + i + ' Warning Lights cabin filter battery';
  const b = document.createElement('button');
  b.textContent = 'x';
  const a = document.createElement('a');
  a.href = '#';
  a.textContent = 'link';
  d.appendChild(s); d.appendChild(b); d.appendChild(a);
  frag.appendChild(d);
}
junk.appendChild(frag);
new MutationObserver(() => { window.__obsCount = (window.__obsCount || 0) + 1; })
  .observe(document.body, { childList: true, subtree: true });
try {
  const po = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) window.__longTasks.push(e.duration);
  });
  po.observe({ type: 'longtask', buffered: false });
} catch (err) { window.__longTaskErr = String(err); }
</script>
</body></html>`;


// Scenario C: Concerns sits ABOVE the inspection, sharing one #page parent
// (no separate insp-card wrapper). Concerns has "Customer Concerns", "Add Concern",
// Add finding, Add media, Edit, Rate-like buttons, and a pre-existing listbox
// plus a stale portal textarea — none of these may be clicked or written.
const SHARE_TASKS = ['WARNING LIGHTS ON DASH', 'CABIN AIR FILTER', 'HORN', 'BATTERY & TERMINALS', 'ALTERNATOR', 'OTHER FAULTS FOUND'];
function shareRow(name) {
  const isAdd = name === 'HORN';
  const findings = isAdd
    ? `<button type="button" class="add-finding insp-add">Add finding</button>`
    : `<textarea class="insp-ta" data-task="${name}"></textarea>`;
  return `<div class="grid-row insp-row" data-task="${name}">
    <div class="rating-cell">
      <div class="ratings">
        <button type="button" class="rate rate-ok insp-rate" aria-label="Checked &amp; Okay" aria-pressed="false"></button>
        <button type="button" class="rate insp-rate" aria-label="Requires Attention Soon" aria-pressed="false"></button>
        <button type="button" class="rate insp-rate" aria-label="Requires Immediate Attention" aria-pressed="false"></button>
        <button type="button" class="rate insp-rate" aria-label="Not Applicable" aria-pressed="false"></button>
      </div>
    </div>
    <div class="name-cell"><div role="row"><span>${name}</span>${findings}</div></div>
  </div>`;
}
function concernRow(label) {
  return `<div class="concern-row" data-concern="${label}">
    <div class="ratings">
      <button type="button" class="rate rate-ok concern-rate" aria-label="Checked &amp; Okay" aria-pressed="false"></button>
      <button type="button" class="rate concern-rate" aria-label="Requires Attention Soon" aria-pressed="false"></button>
      <button type="button" class="rate concern-rate" aria-label="Requires Immediate Attention" aria-pressed="false"></button>
      <button type="button" class="rate concern-rate" aria-label="Not Applicable" aria-pressed="false"></button>
    </div>
    <span>${label}</span>
    <button type="button" class="add-finding concern-add">Add finding</button>
    <button type="button" class="concern-media">Add media</button>
    <button type="button" class="concern-edit">Edit</button>
  </div>`;
}
const htmlShared = `<!doctype html><html><body>
<div id="page">
  <header>
    <input id="global-search" type="text" placeholder="Search Tekmetric..." />
  </header>
  <div id="concerns-section" class="concerns">
    <h3 id="concerns-heading">Customer Concerns</h3>
    <button type="button" id="add-concern">Add Concern</button>
    ${concernRow('4 NEW WINTER TIRES')}
    ${concernRow('-> SUMMERS IN BAGS INTO VEHICLE PLEASE')}
    <ul id="concern-fake-menu" role="listbox">
      <li role="option" id="concern-green" aria-label="Checked &amp; Okay" data-value="ok">trap</li>
    </ul>
  </div>
  <h2>30 POINT VEHICLE INSPECTION</h2>
  <div>All edits will be auto-saved</div>
  <div class="toolbar">
    <button type="button" id="rate-all-btn">Rate All Tasks</button>
    <div id="rate-all-menu" hidden>
      <button type="button" role="menuitem" id="rate-all-ok">Checked &amp; Okay</button>
      <button type="button" role="menuitem">Requires Attention Soon</button>
    </div>
  </div>
  <div class="cols">Rating | Inspection Task | Findings</div>
  ${SHARE_TASKS.map(shareRow).join('\\n')}
</div>
<div class="MuiPopover-root" id="stale-concern-portal">
  <textarea id="stale-concern-ta" class="portal-finding">do not touch</textarea>
</div>
<script>
window.__rateAllUsed = false;
window.__rowRateClicks = 0;
window.__concernClicked = false;
window.__concernRated = false;
window.__concernsOpened = false;
window.__addConcernClicked = false;
window.__concernMedia = false;
window.__concernMenuClicked = false;
window.__concernEdit = false;
function markConcern(which) {
  window.__concernsOpened = true;
  if (which) window[which] = true;
}
document.getElementById('concerns-heading').addEventListener('click', () => markConcern());
document.getElementById('add-concern').addEventListener('click', () => markConcern('__addConcernClicked'));
document.getElementById('concern-green').addEventListener('mousedown', () => markConcern('__concernMenuClicked'));
document.getElementById('concern-green').addEventListener('click', () => markConcern('__concernMenuClicked'));
document.addEventListener('mousedown', (e) => {
  if (e.target.closest('.concern-add')) { markConcern('__concernClicked'); return; }
  if (e.target.closest('.concern-media')) { markConcern('__concernMedia'); return; }
  if (e.target.closest('.concern-edit')) { markConcern('__concernEdit'); return; }
  if (e.target.closest('.concern-rate')) { markConcern('__concernRated'); return; }
  const add = e.target.closest('.insp-add');
  if (!add) return;
  e.preventDefault();
  const row = add.closest('.insp-row');
  const ta = document.createElement('textarea');
  ta.className = 'insp-ta portal-finding';
  ta.setAttribute('data-task', row.getAttribute('data-task'));
  const pop = document.createElement('div');
  pop.className = 'MuiPopover-root';
  pop.appendChild(ta);
  document.body.appendChild(pop);
  ta.focus();
  const save = () => { row.setAttribute('data-finding', ta.value || ''); };
  ta.addEventListener('input', save);
  ta.addEventListener('change', save);
  ta.addEventListener('blur', save);
});
document.addEventListener('click', (e) => {
  if (e.target.closest('#rate-all-btn')) {
    document.getElementById('rate-all-menu').hidden = !document.getElementById('rate-all-menu').hidden;
    return;
  }
  if (e.target.closest('#rate-all-ok')) {
    window.__rateAllUsed = true;
    document.querySelectorAll('.insp-row').forEach(row => {
      row.querySelectorAll('.insp-rate').forEach(b => { b.setAttribute('aria-pressed', 'false'); b.classList.remove('selected'); });
      const g = row.querySelector('.insp-rate.rate-ok');
      if (g) { g.setAttribute('aria-pressed', 'true'); g.classList.add('selected'); }
    });
    document.getElementById('rate-all-menu').hidden = true;
    return;
  }
  const rate = e.target.closest('.insp-rate');
  if (rate) {
    window.__rowRateClicks = (window.__rowRateClicks || 0) + 1;
    const row = rate.closest('.insp-row');
    row.querySelectorAll('.insp-rate').forEach(b => { b.setAttribute('aria-pressed', 'false'); b.classList.remove('selected'); });
    rate.setAttribute('aria-pressed', 'true');
    rate.classList.add('selected');
  }
});
</script>
</body></html>`;

// Scenario D: only Concerns + header, no inspection card. Fill must do nothing.
const htmlNoCard = `<!doctype html><html><body>
<header><input id="global-search" type="text" placeholder="Search Tekmetric..." /></header>
<div id="concerns-section" class="concerns">
  <h3 id="concerns-heading">Client Concerns</h3>
  <button type="button" id="add-concern">Add Concern</button>
  <div class="concern-row">
    4 NEW WINTER TIRES
    <button type="button" class="add-finding concern-add">Add finding</button>
    <button type="button">Add media</button>
    <button type="button">Edit</button>
  </div>
</div>
<script>
window.__concernClicked = false;
window.__addConcernClicked = false;
window.__concernsOpened = false;
document.getElementById('concerns-heading').addEventListener('click', () => { window.__concernsOpened = true; });
document.getElementById('add-concern').addEventListener('click', () => { window.__addConcernClicked = true; window.__concernsOpened = true; });
document.addEventListener('mousedown', (e) => {
  if (e.target.closest('.concern-add')) window.__concernClicked = true;
});
</script>
</body></html>`;


function fail(msg) { console.error('NOFAULTS E2E FAIL:', msg); app.exit(1); }

app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, '../preload.js'), contextIsolation: true } });

  async function waitDone(ms) {
    return w.webContents.executeJavaScript(`new Promise(resolve => {
      if (document.documentElement.dataset.tekproNf === 'done') return resolve(true);
      const t0 = Date.now();
      const t = setInterval(() => {
        if (document.documentElement.dataset.tekproNf === 'done') { clearInterval(t); resolve(true); }
        else if (Date.now() - t0 > ${ms || 20000}) { clearInterval(t); resolve(false); }
      }, 40);
    })`);
  }
  async function run(channel) {
    await w.webContents.executeJavaScript(`document.documentElement.dataset.tekproNf = ''`);
    w.webContents.send(channel);
    const ok = await waitDone(20000);
    if (!ok) throw new Error('timed out waiting for ' + channel);
  }
  async function classicState() {
    return w.webContents.executeJavaScript(`(() => {
      const rows = [...document.querySelectorAll('.insp-row')];
      return {
        rateAllUsed: !!window.__rateAllUsed,
        rowClicks: window.__rowRateClicks || 0,
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
    // ---------- Scenario A: classic in-row fields (regression) ----------
    await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(htmlClassic));
    await new Promise(r => setTimeout(r, 200));
    seen.length = 0;
    await run('fill-no-faults');
    const s1 = await classicState();
    console.log('A labels', JSON.stringify(seen));
    console.log('A state', JSON.stringify(s1, null, 1));
    if (!s1.rateAllUsed) throw new Error('A: Rate All Tasks was not used');
    if (s1.rows.length !== TASKS.length) throw new Error('A: row count ' + s1.rows.length);
    for (const r of s1.rows) {
      if (r.green !== 'true') throw new Error('A: not green: ' + r.task);
      if (r.task === 'FRONT BRAKE PADS AND ROTORS') {
        if (r.value !== 'PADS AT 3MM') throw new Error('A: user text overwritten: ' + r.value);
        continue;
      }
      const want = ph.phraseFor(r.task).text;
      if (r.value.trim() !== want) throw new Error('A: wording for ' + r.task + ': got ' + JSON.stringify(r.value) + ' want ' + JSON.stringify(want));
    }
    const useful = seen.filter(l => l && /warning lights|cabin air|horn|battery|alternator|fluid levels|belt|exhaust|other faults/i.test(l));
    if (useful.length < 6) throw new Error('A: labels not extracted: ' + JSON.stringify(seen));

    await w.webContents.executeJavaScript(`(() => {
      const bat = document.getElementById('t${TASKS.indexOf('BATTERY & TERMINALS')}');
      if (bat) bat.value = bat.value + ' Terminals cleaned.';
      const wld = document.getElementById('t${TASKS.indexOf('WARNING LIGHTS ON DASH')}');
      if (wld) wld.value = wld.value.toUpperCase();
    })()`);
    await run('clear-no-faults');
    const s2 = await classicState();
    const bat = s2.rows.find(r => r.task === 'BATTERY & TERMINALS');
    const wld = s2.rows.find(r => r.task === 'WARNING LIGHTS ON DASH');
    const front = s2.rows.find(r => r.task === 'FRONT BRAKE PADS AND ROTORS');
    if (!bat.value.endsWith('Terminals cleaned.')) throw new Error('A: edited text was cleared: ' + bat.value);
    if (wld.value !== '') throw new Error('A: uppercase generated text was not cleared: ' + wld.value);
    if (front.value !== 'PADS AT 3MM') throw new Error('A: user pads text lost: ' + front.value);

    await w.webContents.executeJavaScript(`(() => {
      const btn = document.getElementById('rate-all-btn'); if (btn) btn.remove();
      const menu = document.getElementById('rate-all-menu'); if (menu) menu.remove();
      window.__rateAllUsed = false; window.__rowRateClicks = 0;
      document.querySelectorAll('.insp-row').forEach(row => {
        row.querySelectorAll('.rate').forEach(b => { b.setAttribute('aria-pressed', 'false'); b.classList.remove('selected'); });
      });
      const first = document.querySelector('.insp-row .rate-ok');
      first.setAttribute('aria-pressed', 'true'); first.classList.add('selected');
    })()`);
    await run('fill-no-faults');
    const s3 = await classicState();
    console.log('A fallback clicks=', s3.rowClicks, 'rateAllUsed=', s3.rateAllUsed);
    if (s3.rateAllUsed) throw new Error('A: rate-all used after control was removed');
    if (s3.rowClicks < 20) throw new Error('A: per-row green fallback did not run, clicks=' + s3.rowClicks);
    for (const r of s3.rows) {
      if (r.green !== 'true') throw new Error('A: fallback not green: ' + r.task);
    }
    if (s3.rows[0].green !== 'true') throw new Error('A: already-green was toggled off');
    console.log('NOFAULTS E2E A OK');

    // ---------- Scenario B: live layout + heavy page ----------
    seen.length = 0;
    await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(htmlLive));
    await new Promise(r => setTimeout(r, 400));
    // Drop any leftover setup longtasks so we only measure fill.
    await w.webContents.executeJavaScript('window.__longTasks = []; true');
    const tFill = Date.now();
    await run('fill-no-faults');
    const elapsed = Date.now() - tFill;
    const sB = await w.webContents.executeJavaScript(`(() => ({
      rateAllUsed: !!window.__rateAllUsed,
      rowClicks: window.__rowRateClicks || 0,
      concernClicked: !!window.__concernClicked,
      portals: window.__portals || 0,
      search: (document.getElementById('global-search') || {}).value || '',
      longTasks: window.__longTasks || [],
      longTaskErr: window.__longTaskErr || '',
      maxSlice: document.documentElement.dataset.tekproNfMaxSlice || '',
      obs: window.__obsCount || 0,
      rows: [...document.querySelectorAll('.insp-card .insp-row, .insp-rows .insp-row')].map(r => {
        const ta = r.querySelector('textarea');
        return {
          task: r.getAttribute('data-task'),
          finding: (ta && ta.value) || r.getAttribute('data-finding') || '',
          green: (r.querySelector('.rate-ok') || {}).getAttribute ? r.querySelector('.rate-ok').getAttribute('aria-pressed') : null
        };
      }),
      concernText: [...document.querySelectorAll('.concern-row')].map(r => r.innerText)
    }))()`);
    console.log('B state', JSON.stringify(sB, null, 1));
    console.log('B elapsed ms', elapsed);

    if (sB.search !== '') throw new Error('B: wrote into the global search box: ' + JSON.stringify(sB.search));
    if (sB.concernClicked) throw new Error('B: clicked a Concerns "Add finding" button');
    if (!sB.rateAllUsed) throw new Error('B: Rate All Tasks (MUI mousedown + portal) was not used');
    if (sB.rows.length !== LIVE_TASKS.length) throw new Error('B: row count ' + sB.rows.length);
    for (const r of sB.rows) {
      if (r.green !== 'true') throw new Error('B: not green: ' + r.task + ' pressed=' + r.green);
      const want = ph.phraseFor(r.task).text;
      if ((r.finding || '').trim() !== want) {
        throw new Error('B: wording for ' + r.task + ': got ' + JSON.stringify(r.finding) + ' want ' + JSON.stringify(want));
      }
    }
    // Labels must be clean task names, never "Search Tekmetric", concerns, or "DASHAdd finding"
    const badLab = seen.filter(l => /search tekmetric|winter tires|summers in bags|add finding/i.test(l || ''));
    if (badLab.length) throw new Error('B: bad labels sent: ' + JSON.stringify(badLab));
    const liveLabs = seen.filter(l => LIVE_TASKS.includes(l));
    if (liveLabs.length < 8) throw new Error('B: missing live task labels: ' + JSON.stringify(seen));

    if (elapsed > 10000) throw new Error('B: fill took too long: ' + elapsed + 'ms');
    const slice = parseFloat(sB.maxSlice || '0');
    if (slice > 200) throw new Error('B: max sync slice ' + slice + 'ms exceeds 200ms');
    const long = (sB.longTasks || []).filter(d => d > 200);
    if (long.length) throw new Error('B: longtask > 200ms: ' + JSON.stringify(long));

    console.log('NOFAULTS E2E B OK elapsed=' + elapsed + ' maxSlice=' + slice + ' portals=' + sB.portals);

    // ---------- Scenario C: Concerns above, shared parent, rate-like buttons ----------
    seen.length = 0;
    logs.length = 0;
    await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(htmlShared));
    await new Promise(r => setTimeout(r, 200));
    await run('fill-no-faults');
    const sC = await w.webContents.executeJavaScript(`(() => ({
      rateAllUsed: !!window.__rateAllUsed,
      rowClicks: window.__rowRateClicks || 0,
      concernClicked: !!window.__concernClicked,
      concernRated: !!window.__concernRated,
      concernsOpened: !!window.__concernsOpened,
      addConcernClicked: !!window.__addConcernClicked,
      concernMedia: !!window.__concernMedia,
      concernMenuClicked: !!window.__concernMenuClicked,
      concernEdit: !!window.__concernEdit,
      search: (document.getElementById('global-search') || {}).value || '',
      stale: (document.getElementById('stale-concern-ta') || {}).value || '',
      rows: [...document.querySelectorAll('.insp-row')].map(r => {
        const ta = r.querySelector('textarea');
        const finding = (ta && ta.value) || r.getAttribute('data-finding') || '';
        const g = r.querySelector('.insp-rate.rate-ok');
        return { task: r.getAttribute('data-task'), finding, green: g ? g.getAttribute('aria-pressed') : null };
      }),
      concernText: [...document.querySelectorAll('.concern-row')].map(r => r.innerText)
    }))()`);
    console.log('C state', JSON.stringify(sC, null, 1));
    if (sC.search !== '') throw new Error('C: wrote into the global search box: ' + JSON.stringify(sC.search));
    if (sC.stale !== 'do not touch') throw new Error('C: wrote into a pre-existing Concerns portal: ' + JSON.stringify(sC.stale));
    if (sC.concernClicked) throw new Error('C: clicked a Concerns "Add finding" button');
    if (sC.concernRated) throw new Error('C: clicked a Concerns rate button');
    if (sC.concernsOpened) throw new Error('C: opened the Customer Concerns section');
    if (sC.addConcernClicked) throw new Error('C: clicked Add Concern');
    if (sC.concernMedia) throw new Error('C: clicked Add media');
    if (sC.concernMenuClicked) throw new Error('C: clicked the Concerns listbox trap');
    if (sC.concernEdit) throw new Error('C: clicked Concerns Edit');
    if (!sC.rateAllUsed) throw new Error('C: Rate All Tasks was not used');
    if (sC.rows.length !== SHARE_TASKS.length) throw new Error('C: row count ' + sC.rows.length);
    for (const r of sC.rows) {
      if (r.green !== 'true') throw new Error('C: not green: ' + r.task);
      const want = ph.phraseFor(r.task).text;
      if ((r.finding || '').trim() !== want) {
        throw new Error('C: wording for ' + r.task + ': got ' + JSON.stringify(r.finding) + ' want ' + JSON.stringify(want));
      }
    }
    const cBad = seen.filter(l => /search tekmetric|winter tires|summers in bags|add finding|add concern|client concern|customer concern/i.test(l || ''));
    if (cBad.length) throw new Error('C: bad labels sent: ' + JSON.stringify(cBad));
    console.log('NOFAULTS E2E C OK');

    // ---------- Scenario D: no inspection card — do nothing ----------
    seen.length = 0;
    logs.length = 0;
    await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(htmlNoCard));
    await new Promise(r => setTimeout(r, 150));
    await run('fill-no-faults');
    const sD = await w.webContents.executeJavaScript(`(() => ({
      concernClicked: !!window.__concernClicked,
      addConcernClicked: !!window.__addConcernClicked,
      concernsOpened: !!window.__concernsOpened,
      search: (document.getElementById('global-search') || {}).value || ''
    }))()`);
    console.log('D state', JSON.stringify(sD), 'logs', JSON.stringify(logs.filter(l => /card/i.test(l || ''))));
    if (sD.concernClicked || sD.addConcernClicked || sD.concernsOpened) {
      throw new Error('D: touched Concerns when no inspection card was present: ' + JSON.stringify(sD));
    }
    if (sD.search !== '') throw new Error('D: wrote into search: ' + JSON.stringify(sD.search));
    if (logs.some(l => /wrote label=/i.test(l || ''))) {
      throw new Error('D: wrote into a field when there is no inspection: ' + JSON.stringify(logs));
    }
    const dIdle = logs.some(l => /no finding fields|fill fields=0|fill done filled=0/i.test(l || ''));
    if (!dIdle) {
      console.log('D logs (ok if no writes):', JSON.stringify(logs));
    }
    console.log('NOFAULTS E2E D OK');

    console.log('NOFAULTS E2E OK');
    app.exit(0);
  } catch (e) {
    console.error(e && e.stack || e);
    console.error('recent logs:\n' + logs.slice(-40).join('\n'));
    fail(e && e.message);
  }
});
