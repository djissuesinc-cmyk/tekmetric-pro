// v2.5.1: hide the left-nav hamburger and force the side menu back open if it was collapsed.
// Mock page: Tekmetric's data-testid toggle, .MuiDrawer-paperAnchorLeft.closed, localStorage "sidebar".
// Run: xvfb-run -a npx electron test/e2e-nav.js
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'tekpro-nav-')));
ipcMain.on('get-settings', e => { e.returnValue = { showSidebar: false, presets: [], autoCaps: false }; });
ipcMain.on('get-small-logo', e => { e.returnValue = ''; });
ipcMain.on('get-pdf-hook', e => { e.returnValue = ''; });
ipcMain.on('document-ready', () => {});

function page(startExpanded) {
  return `<!doctype html><html><body style="margin:0">
<header style="display:flex;align-items:center;height:56px;background:#111">
  <div><button type="button" data-testid="toggle-app-sidebar-menu" aria-label="Toggle menu" style="width:40px;height:40px">☰</button></div>
  <div id="logo">tekmetric</div>
</header>
<aside id="leftnav" class="MuiDrawer-paper MuiDrawer-paperAnchorLeft" style="position:fixed;left:0;top:56px;height:400px;background:#222;color:#fff">
  <a href="#job">Job Board</a>
  <a href="#appt">Appointments</a>
  <a href="#inv">Inventory</a>
</aside>
<main id="main">Shop content</main>
<aside id="rightbar" class="MuiDrawer-paper MuiDrawer-paperAnchorRight" style="position:fixed;right:0;top:56px;width:280px">
  <button type="button" id="collapse-all">Collapse all</button>
</aside>
<script>
window.__clicks = 0;
window.__expanded = ${startExpanded ? 'true' : 'false'};
function apply(expanded) {
  window.__expanded = expanded;
  const nav = document.getElementById('leftnav');
  const main = document.getElementById('main');
  if (expanded) {
    nav.classList.remove('closed');
    nav.style.width = '256px';
    main.className = 'w-screen-minus-sidebar-expanded';
    localStorage.setItem('sidebar', 'true');
  } else {
    nav.classList.add('closed');
    nav.style.width = '70px';
    main.className = 'w-screen-minus-sidebar-minimized';
    localStorage.setItem('sidebar', 'false');
  }
}
localStorage.setItem('ro-sidebar', 'true');
document.querySelector('[data-testid="toggle-app-sidebar-menu"]').addEventListener('click', () => {
  window.__clicks++;
  apply(!window.__expanded);
});
apply(${startExpanded ? 'true' : 'false'});
</script>
</body></html>`;
}

function fail(msg) { console.error('NAV E2E FAIL:', msg); app.exit(1); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

function snapshot(w) {
  return w.webContents.executeJavaScript(`(() => {
    const btn = document.querySelector('[data-testid="toggle-app-sidebar-menu"]');
    const nav = document.getElementById('leftnav');
    const collapse = document.getElementById('collapse-all');
    const r = nav.getBoundingClientRect();
    return {
      burgerDisplay: btn ? getComputedStyle(btn).display : 'missing',
      burgerVisible: !!(btn && getComputedStyle(btn).display !== 'none'),
      closed: nav.classList.contains('closed'),
      width: Math.round(r.width),
      expanded: window.__expanded,
      clicks: window.__clicks,
      sidebar: localStorage.getItem('sidebar'),
      roSidebar: localStorage.getItem('ro-sidebar'),
      mainClass: document.getElementById('main').className,
      collapseVisible: !!(collapse && getComputedStyle(collapse).display !== 'none' && collapse.textContent === 'Collapse all')
    };
  })()`);
}

app.whenReady().then(async () => {
  let html = page(false);
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(html);
  });
  const port = await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
    server.on('error', reject);
  });
  const url = 'http://127.0.0.1:' + port + '/shop';
  const w = new BrowserWindow({
    show: true, width: 900, height: 700,
    webPreferences: { preload: path.join(__dirname, '../preload.js'), contextIsolation: true }
  });
  try {
    // 1) Start collapsed (Tekmetric saved localStorage sidebar=false)
    html = page(false);
    await w.loadURL(url);
    await sleep(500);
    let s = await snapshot(w);
    console.log('1 collapsed-start:', JSON.stringify(s));
    if (s.burgerVisible) return fail('hamburger still visible after collapsed start: ' + JSON.stringify(s));
    if (s.closed || s.width <= 90 || s.expanded !== true || s.sidebar !== 'true') return fail('nav not expanded after collapsed start: ' + JSON.stringify(s));
    if (s.roSidebar !== 'true') return fail('ro-sidebar was changed: ' + JSON.stringify(s));
    if (!s.collapseVisible) return fail('Collapse all was hidden: ' + JSON.stringify(s));
    if (s.mainClass.indexOf('minimized') !== -1) return fail('main still has minimized class: ' + JSON.stringify(s));
    const clicksAfterOpen = s.clicks;
    if (clicksAfterOpen < 1) return fail('expected a programmatic click to expand: ' + JSON.stringify(s));

    // Stay expanded; do not click again and collapse it
    await sleep(800);
    s = await snapshot(w);
    console.log('1b still-expanded:', JSON.stringify(s));
    if (s.closed || s.expanded !== true || s.clicks !== clicksAfterOpen) return fail('nav was toggled again: ' + JSON.stringify(s));

    // 2) React re-render: hamburger comes back, nav collapses again
    await w.webContents.executeJavaScript(`(() => { apply(false); })()`);
    await sleep(900);
    s = await snapshot(w);
    console.log('2 after-rerender:', JSON.stringify(s));
    if (s.burgerVisible) return fail('hamburger visible after re-render: ' + JSON.stringify(s));
    if (s.closed || s.expanded !== true || s.sidebar !== 'true') return fail('nav not re-expanded after re-render: ' + JSON.stringify(s));
    if (s.roSidebar !== 'true' || !s.collapseVisible) return fail('right sidebar disturbed: ' + JSON.stringify(s));

    // 3) Start already expanded — hide hamburger, do not click (which would collapse)
    html = page(true);
    await w.loadURL(url + '?expanded=1');
    await sleep(500);
    s = await snapshot(w);
    console.log('3 expanded-start:', JSON.stringify(s));
    if (s.burgerVisible) return fail('hamburger visible on expanded start: ' + JSON.stringify(s));
    if (s.closed || s.width <= 90 || s.expanded !== true || s.sidebar !== 'true') return fail('expanded nav was changed: ' + JSON.stringify(s));
    if (s.clicks !== 0) return fail('clicked the hamburger on an already-open nav: ' + JSON.stringify(s));
    if (s.roSidebar !== 'true' || !s.collapseVisible) return fail('right sidebar disturbed on expanded start: ' + JSON.stringify(s));

    console.log('NAV E2E OK');
    server.close();
    app.exit(0);
  } catch (e) { fail(e && e.stack || e); }
});
setTimeout(() => fail('timeout'), 30000);
