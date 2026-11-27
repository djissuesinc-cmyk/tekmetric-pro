// v2.5.4: open the About window, check version, program section, experimental notice, bug-report button, save a screenshot.
// Run: xvfb-run -a npx electron test/e2e-about.js
const { app, BrowserWindow } = require('electron');
const { aboutHtml } = require('../about-info');
const { signboardCss, signboardHeader } = require('../brand');
const path = require('path'), fs = require('fs'), os = require('os');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'tekpro-about-')));

function fail(msg) { console.error('ABOUT E2E FAIL:', msg); app.exit(1); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

app.whenReady().then(async () => {
  try {
    const version = require('../package.json').version;
    if (!version) return fail('package.json version missing');
    const win = new BrowserWindow({
      width: 560, height: 820, show: true, autoHideMenuBar: true,
      title: 'About System', backgroundColor: '#0d0e11',
      webPreferences: { nodeIntegration: false, contextIsolation: true }
    });
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(aboutHtml(version, { css: signboardCss(), header: signboardHeader() })));
    await win.webContents.executeJavaScript(`Promise.all([document.fonts.ready, Promise.all([...document.images].map(img => img.complete && img.naturalWidth ? 1 : new Promise(r => { img.onload = img.onerror = r; })))])`);
    await sleep(150);
    const info = await win.webContents.executeJavaScript(`({
      heading: document.getElementById('about-app-title') && document.getElementById('about-app-title').textContent.trim(),
      version: document.getElementById('about-version') && document.getElementById('about-version').textContent.trim(),
      program: !!document.getElementById('about-program'),
      programText: document.getElementById('about-program') && document.getElementById('about-program').innerText,
      features: document.getElementById('about-features') && document.getElementById('about-features').innerText,
      shortcuts: document.getElementById('about-shortcuts') && document.getElementById('about-shortcuts').innerText,
      scrollOverflow: document.getElementById('about-scroll') && getComputedStyle(document.getElementById('about-scroll')).overflowY,
      header: document.getElementById('signboard-header') && document.getElementById('signboard-header').innerText,
      logoOk: (() => { const i = document.getElementById('signboard-logo'); return !!(i && i.complete && i.naturalWidth > 0 && String(i.src).indexOf('data:image') === 0); })(),
      fonts: document.fonts.check('700 20px Oswald') && document.fonts.check('400 16px Inter') && document.fonts.check('600 16px Inter'),
      leasideColor: (() => { const s = document.querySelector('#signboard-header .sb-name span'); return s && getComputedStyle(s).color; })(),
      headerBorder: (() => { const h = document.getElementById('signboard-header'); return h && getComputedStyle(h).borderBottomColor; })(),
      experimental: document.getElementById('about-experimental') && document.getElementById('about-experimental').innerText,
      emailHref: document.getElementById('about-bug-email') && document.getElementById('about-bug-email').getAttribute('href'),
      emailText: document.getElementById('about-bug-email') && document.getElementById('about-bug-email').textContent.trim(),
      bugBtn: document.getElementById('about-bug-report') && document.getElementById('about-bug-report').textContent.trim(),
      noticeBorder: (() => { const n = document.getElementById('about-experimental'); return n && getComputedStyle(n).borderLeftColor; })()
    })`);
    if (info.heading !== 'Tekmetric Pro' && !/Tekmetric Pro/i.test(info.heading || '')) return fail('heading: ' + info.heading);
    if (info.version !== 'Version ' + version) return fail('version render: ' + JSON.stringify(info.version) + ' expected Version ' + version);
    if (!info.program) return fail('about-program section not rendered');
    const blob = (info.programText || '') + '\n' + (info.features || '') + '\n' + (info.shortcuts || '');
    for (const s of ['shop.tekmetric.com', 'Quick Actions', 'No Faults', 'Reset Print Spooler', 'Ctrl+Alt+N', 'Ctrl+Alt+C']) {
      if (!blob.includes(s)) return fail('missing in rendered section: ' + s + ' :: ' + blob.slice(0, 400));
    }
    if (!['auto', 'scroll', 'overlay'].includes(info.scrollOverflow)) return fail('scroll overflow: ' + info.scrollOverflow);
    if (!/Leaside/i.test(info.header || '') || !/Automotive/i.test(info.header || '') || !/Parts/i.test(info.header || '') || !/Tires/i.test(info.header || '')) {
      return fail('header text: ' + JSON.stringify(info.header));
    }
    if (!info.logoOk) return fail('signboard logo did not load');
    if (!info.fonts) return fail('Oswald/Inter did not load: ' + JSON.stringify(info.fonts));
    if (!info.experimental || !/experimental and may contain bugs/i.test(info.experimental) || !/shawn@craigsleaside.com/.test(info.experimental)) {
      return fail('experimental notice: ' + JSON.stringify(info.experimental));
    }
    if (info.emailHref !== 'mailto:shawn@craigsleaside.com') return fail('email href: ' + info.emailHref);
    if (info.emailText !== 'shawn@craigsleaside.com') return fail('email text: ' + info.emailText);
    if (info.bugBtn !== 'Create Bug Report') return fail('bug report button: ' + info.bugBtn);
    const shotDir = '/workspace/out30';
    fs.mkdirSync(shotDir, { recursive: true });
    const png = await win.capturePage();
    fs.writeFileSync(path.join(shotDir, 'about.png'), png.toPNG());
    console.log('ABOUT E2E OK version=' + version + ' screenshot=' + path.join(shotDir, 'about.png'));
    app.exit(0);
  } catch (e) { fail(e && e.stack || e); }
});
setTimeout(() => fail('timeout'), 20000);
