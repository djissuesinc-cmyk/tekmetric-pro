const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain, dialog, Menu, session, safeStorage } = require('electron');

if (!app.isPackaged) {
  try {
    const dotenv = require('dotenv');
    const result = dotenv.config({ path: path.join(__dirname, '../../.env'), quiet: true });
    if (result && result.error && result.error.code !== 'ENOENT') {
      console.error('Could not read .env');
    }
  } catch (err) {
    console.error('Could not read .env');
  }
}

const { createStore } = require('./store');
const { createSecretStore, createLocalAes } = require('./secrets');
const { validateRepair, validateSecrets } = require('./validate');
const { diagnoseLocal } = require('./diagnostics');
const { buildWorkOrderPdf } = require('./pdf');
const { generateText, buildCommentPrompt, buildDiagnosticPrompt } = require('./gemini');
const {
  secureWebPreferences,
  isHttpsUrl,
  isTekmetricSite,
  isTekmetricLoginHost,
  isAppDocument,
  redact,
  buildAutofillScript,
  friendlyUpdateError,
} = require('./security');

process.on('unhandledRejection', function (err) {
  console.error(redact(err && err.stack ? err.stack : err));
});
process.on('uncaughtException', function (err) {
  console.error(redact(err && err.stack ? err.stack : err));
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let mainWindow = null;
let tekWindow = null;
let store = null;
let secrets = null;
let updater = null;
let updaterWired = false;
let updateAvailable = false;
let updateDownloaded = false;
let checkingUpdates = false;
let fillToken = 0;

function envKey() {
  return process.env.GEMINI_API_KEY || '';
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function statePayload() {
  return Object.assign(store.getPublic(), {
    secretStatus: secrets.status(envKey()),
    app: {
      version: app.getVersion(),
      packaged: app.isPackaged,
      name: 'Tekmetric Pro',
    },
  });
}

function handle(channel, fn) {
  ipcMain.handle(channel, async function (event, payload) {
    try {
      if (!mainWindow || event.sender !== mainWindow.webContents) {
        return { ok: false, error: 'Rejected.' };
      }
      return await fn(payload);
    } catch (err) {
      console.error(channel, redact(err && err.stack ? err.stack : err));
      return { ok: false, error: 'Something went wrong. Try again.' };
    }
  });
}

function wireUpdater() {
  if (updaterWired) return;
  updaterWired = true;
  updater = require('electron-updater').autoUpdater;
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.allowPrerelease = false;
  updater.on('error', function (err) {
    send('update', { state: 'error', message: friendlyUpdateError(err) });
  });
  updater.on('update-available', function (info) {
    updateAvailable = true;
    send('update', {
      state: 'available',
      message: 'Update ' + (info && info.version ? info.version : '') + ' is available.',
    });
  });
  updater.on('update-not-available', function () {
    updateAvailable = false;
    send('update', { state: 'current', message: 'You are on the latest version.' });
  });
  updater.on('download-progress', function (progress) {
    const percent = progress && Number.isFinite(progress.percent) ? Math.round(progress.percent) : 0;
    send('update', { state: 'downloading', message: 'Downloading update ' + percent + '%.' });
  });
  updater.on('update-downloaded', function () {
    updateDownloaded = true;
    send('update', { state: 'downloaded', message: 'Update downloaded. Restart to install it.' });
  });
}

function denyPermissions(ses) {
  ses.setPermissionRequestHandler(function (_contents, _permission, callback) {
    callback(false);
  });
}

function attachGuards(contents) {
  contents.setWindowOpenHandler(function (details) {
    if (tekWindow && !tekWindow.isDestroyed() && contents.id === tekWindow.webContents.id && isHttpsUrl(details.url)) {
      contents.loadURL(details.url).catch(function () {});
    }
    return { action: 'deny' };
  });
  contents.on('will-navigate', function (event, url) {
    if (isAppDocument(url)) return;
    if (tekWindow && !tekWindow.isDestroyed() && contents.id === tekWindow.webContents.id && isHttpsUrl(url)) return;
    event.preventDefault();
  });
  contents.on('will-redirect', function (event, url) {
    if (isAppDocument(url)) return;
    if (tekWindow && !tekWindow.isDestroyed() && contents.id === tekWindow.webContents.id && isHttpsUrl(url)) return;
    event.preventDefault();
  });
}

function delay(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

async function maybeFill(win) {
  const login = secrets.tekmetricLogin();
  if (!login) return { filled: false, reason: 'nocreds' };
  const token = ++fillToken;
  const script = buildAutofillScript(login.email, login.password);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (token !== fillToken || win.isDestroyed()) return { filled: false, reason: 'closed' };
    if (isTekmetricLoginHost(win.webContents.getURL())) {
      try {
        const result = await win.webContents.executeJavaScript(script, true);
        if (result && result.filled) return result;
      } catch (err) {
        /* The login form is not ready yet. */
      }
    }
    await delay(700);
  }
  return { filled: false, reason: 'noform' };
}

async function openTekmetric() {
  const target = store.getSettings().tekmetricUrl;
  if (!isTekmetricSite(target)) {
    return { ok: false, error: 'The Tekmetric address in Settings is not an https tekmetric.com page.' };
  }
  if (tekWindow && !tekWindow.isDestroyed()) {
    if (tekWindow.isMinimized()) tekWindow.restore();
    tekWindow.focus();
    return { ok: true, message: 'Tekmetric is already open.' };
  }
  tekWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    title: "Tekmetric — Craig's Leaside",
    autoHideMenuBar: true,
    webPreferences: secureWebPreferences({ partition: 'persist:tekmetric' }),
  });
  tekWindow.on('closed', function () {
    fillToken += 1;
    tekWindow = null;
  });
  tekWindow.webContents.on('did-fail-load', function (_event, code, _desc, _url, isMain) {
    if (!isMain || code === -3) return;
    dialog.showMessageBox(tekWindow, {
      type: 'warning',
      title: 'Tekmetric',
      message: 'Could not open Tekmetric.',
      detail: 'Check the network connection and try again.',
    }).catch(function () {});
  });
  try {
    await tekWindow.loadURL(target);
  } catch (err) {
    return { ok: false, error: 'Could not open Tekmetric. Check the network connection and try again.' };
  }
  const filled = await maybeFill(tekWindow);
  if (filled.reason === 'nocreds') {
    return { ok: true, message: 'Tekmetric is open. Save a login in Settings to fill the form next time.' };
  }
  if (filled.filled && filled.submitted) {
    return { ok: true, message: 'Tekmetric login was filled and submitted.' };
  }
  if (filled.filled) {
    return { ok: true, message: 'Tekmetric login was filled. Submit the form if it did not send.' };
  }
  return { ok: true, message: 'Tekmetric is open. The login form was not on that page, so nothing was typed.' };
}

async function saved(result) {
  const resolved = await result;
  if (!resolved || !resolved.ok) return resolved;
  return { ok: true, data: statePayload() };
}

function registerIpc() {
  handle('state:get', async function () {
    return { ok: true, data: statePayload() };
  });
  handle('notice:dismiss', function () { return saved(store.dismissNotice()); });
  handle('settings:save', function (payload) { return saved(store.saveSettings(payload)); });
  handle('secrets:save', async function (payload) {
    const parsed = validateSecrets(payload);
    if (!parsed.ok) return parsed;
    const applied = await secrets.apply(parsed.value);
    if (!applied.ok) return applied;
    return { ok: true, data: statePayload() };
  });
  handle('appointment:save', function (payload) { return saved(store.saveAppointment(payload)); });
  handle('appointment:toggle', function (id) { return saved(store.toggleAppointment(id)); });
  handle('appointment:delete', function (id) { return saved(store.deleteAppointment(id)); });
  handle('repair:save', function (payload) { return saved(store.saveRepair(payload)); });
  handle('repair:delete', function (id) { return saved(store.deleteRepair(id)); });
  handle('repair:clear-samples', function () { return saved(store.clearSamples()); });
  handle('ai:comment', async function (payload) {
    const repairInput = payload && payload.repair ? payload.repair : null;
    const parsed = validateRepair(repairInput);
    if (!parsed.ok) return parsed;
    const instruction = payload && typeof payload.instruction === 'string' ? payload.instruction.slice(0, 400) : '';
    const result = await generateText({
      apiKey: secrets.geminiKey(envKey()),
      model: store.getSettings().geminiModel,
      prompt: buildCommentPrompt(parsed.value, instruction),
    });
    if (!result.ok) {
      if (result.detail) console.error(redact(result.detail));
      return { ok: false, error: result.error };
    }
    return { ok: true, data: { text: result.text } };
  });
  handle('ai:diagnose', async function (payload) {
    const local = diagnoseLocal(payload || {});
    if (!local.ok) return local;
    const useGemini = Boolean(payload && payload.useGemini);
    if (!useGemini) return { ok: true, data: { local: local.value, note: '', noteError: '' } };
    const notes = payload && typeof payload.notes === 'string' ? payload.notes.slice(0, 2000) : '';
    const result = await generateText({
      apiKey: secrets.geminiKey(envKey()),
      model: store.getSettings().geminiModel,
      prompt: buildDiagnosticPrompt(local.value, notes),
    });
    if (!result.ok && result.detail) console.error(redact(result.detail));
    return {
      ok: true,
      data: {
        local: local.value,
        note: result.ok ? result.text : '',
        noteError: result.ok ? '' : result.error,
      },
    };
  });
  handle('pdf:export', async function (id) {
    if (typeof id !== 'string') return { ok: false, error: 'Invalid id.' };
    const repair = store.getRepair(id);
    if (!repair) return { ok: false, error: 'That repair order is no longer on file.' };
    let bytes;
    try {
      bytes = await buildWorkOrderPdf(repair, store.getSettings());
    } catch (err) {
      console.error('pdf', redact(err && err.message));
      return { ok: false, error: 'Could not build the PDF.' };
    }
    if (process.env.TEKMETRIC_CAPTURE === '1' && process.env.TEKMETRIC_CAPTURE_DIR) {
      const dest = path.join(process.env.TEKMETRIC_CAPTURE_DIR, 'RO-' + repair.number + '.pdf');
      fs.writeFileSync(dest, bytes);
      return { ok: true, data: { file: dest } };
    }
    const picked = await dialog.showSaveDialog(mainWindow, {
      title: 'Save work order',
      defaultPath: 'Craigs-Leaside-RO-' + repair.number + '.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (picked.canceled || !picked.filePath) return { ok: false, cancelled: true };
    const dest = picked.filePath.toLowerCase().endsWith('.pdf') ? picked.filePath : picked.filePath + '.pdf';
    try {
      fs.writeFileSync(dest, bytes);
    } catch (err) {
      return { ok: false, error: 'Could not save the PDF. Check that the folder is writable.' };
    }
    return { ok: true, data: { file: dest } };
  });
  handle('updates:check', async function () {
    if (!app.isPackaged) {
      return { ok: true, data: { state: 'dev', message: 'Update checks run in the installed app, not from a source checkout.' } };
    }
    if (checkingUpdates) return { ok: false, error: 'An update check is already running.' };
    checkingUpdates = true;
    try {
      wireUpdater();
      await updater.checkForUpdates();
      return { ok: true, data: { state: 'checking', message: 'Checking for updates.' } };
    } catch (err) {
      return { ok: false, error: friendlyUpdateError(err) };
    } finally {
      checkingUpdates = false;
    }
  });
  handle('updates:download', async function () {
    if (!app.isPackaged) return { ok: false, error: 'Update checks run in the installed app, not from a source checkout.' };
    if (!updateAvailable) return { ok: false, error: 'No update is available to download.' };
    try {
      wireUpdater();
      await updater.downloadUpdate();
      return { ok: true, data: { state: 'downloading', message: 'Downloading the update.' } };
    } catch (err) {
      return { ok: false, error: friendlyUpdateError(err) };
    }
  });
  handle('updates:install', function () {
    if (!updateDownloaded || !updater) return { ok: false, error: 'No update has been downloaded.' };
    updater.quitAndInstall(false, true);
    return { ok: true };
  });
  handle('tekmetric:open', function () { return openTekmetric(); });
}

function buildMenu() {
  const viewItem = function (label, view, accelerator) {
    return {
      label: label,
      accelerator: accelerator,
      click: function () { send('nav', view); },
    };
  };
  const viewMenu = [
    viewItem('Dashboard', 'dashboard', 'CmdOrCtrl+1'),
    viewItem('Calendar', 'calendar', 'CmdOrCtrl+2'),
    viewItem('Repair orders', 'repairs', 'CmdOrCtrl+3'),
    viewItem('Diagnostics', 'diagnostics', 'CmdOrCtrl+4'),
    viewItem('Settings', 'settings', 'CmdOrCtrl+5'),
    { type: 'separator' },
    { role: 'reload' },
    { role: 'togglefullscreen' },
  ];
  if (!app.isPackaged) viewMenu.push({ role: 'toggleDevTools' });
  const template = [
    {
      label: 'File',
      submenu: [
        viewItem('Repair orders', 'repairs'),
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { label: 'View', submenu: viewMenu },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Check for updates',
          click: function () { send('nav', 'settings'); },
        },
        {
          label: 'About Tekmetric Pro',
          click: function () {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About Tekmetric Pro',
              message: 'Tekmetric Pro',
              detail: "Craig's Leaside Automotive\nUnofficial shop companion. Not affiliated with Tekmetric.\n\nVersion " + app.getVersion() + '\nDeveloped by Shawn Bradbury.',
            });
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createMainWindow() {
  const publicState = store.getPublic();
  const iconPath = path.join(__dirname, '../../assets/icon.png');
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    useContentSize: true,
    show: false,
    backgroundColor: publicState.settings.darkMode ? '#1a1b1e' : '#f5f4f1',
    title: "Tekmetric Pro — Craig's Leaside Automotive",
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: secureWebPreferences({
      preload: path.join(__dirname, 'preload.js'),
      spellcheck: true,
    }),
  });
  mainWindow.once('ready-to-show', function () { mainWindow.show(); });
  const query = process.env.TEKMETRIC_CAPTURE === '1' ? { capture: '1' } : undefined;
  const loaded = new Promise(function (resolve, reject) {
    mainWindow.webContents.once('did-finish-load', function () { resolve(); });
    mainWindow.webContents.once('did-fail-load', function () { reject(new Error('The app window failed to load.')); });
  });
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'), query ? { query: query } : undefined);
  mainWindow.on('closed', function () { mainWindow = null; });
  return loaded;
}

async function captureScreens() {
  const dir = process.env.TEKMETRIC_CAPTURE_DIR;
  if (!dir) throw new Error('Missing capture directory.');
  fs.mkdirSync(dir, { recursive: true });
  const ready = await mainWindow.webContents.executeJavaScript(
    'new Promise(function (resolve) {' +
      'var start = Date.now();' +
      'var tick = function () {' +
        'if (window.__ready) resolve(true);' +
        'else if (Date.now() - start > 8000) resolve(false);' +
        'else setTimeout(tick, 50);' +
      '}; tick();' +
    '})',
    true
  );
  if (!ready) throw new Error('The shop screen did not finish loading.');
  await mainWindow.webContents.executeJavaScript('window.__setDark(false)', true);
  const views = ['dashboard', 'calendar', 'repairs', 'diagnostics', 'settings'];
  for (let i = 0; i < views.length; i += 1) {
    const view = views[i];
    await mainWindow.webContents.executeJavaScript('window.__showView(' + JSON.stringify(view) + ')', true);
    await delay(300);
    if (view === 'diagnostics') {
      await mainWindow.webContents.executeJavaScript(
        "(function () {" +
          "var vehicle = document.querySelector('#diag-vehicle');" +
          "var symptoms = document.querySelector('#diag-symptoms');" +
          "if (vehicle) vehicle.value = '2018 Honda CR-V';" +
          "if (symptoms) symptoms.value = 'Steering wheel pulsates when braking from highway speed.';" +
          "var button = document.querySelector('[data-action=\"diagnose-local\"]');" +
          "if (button) button.click();" +
        "})()",
        true
      );
      await delay(700);
    }
    const image = await mainWindow.webContents.capturePage();
    fs.writeFileSync(path.join(dir, view + '.png'), image.toPNG());
  }
  await mainWindow.webContents.executeJavaScript('window.__setDark(true)', true);
  await mainWindow.webContents.executeJavaScript('window.__showView("dashboard")', true);
  await delay(350);
  const dark = await mainWindow.webContents.capturePage();
  fs.writeFileSync(path.join(dir, 'dashboard-dark.png'), dark.toPNG());
}

function setupSpellcheck() {
  try {
    const available = session.defaultSession.availableSpellCheckerLanguages || [];
    const wanted = ['en-CA', 'en-US'].filter(function (lang) { return available.indexOf(lang) !== -1; });
    if (wanted.length) session.defaultSession.setSpellCheckerLanguages(wanted);
  } catch (err) {
    console.error('Spellcheck dictionary unavailable');
  }
}

app.on('second-instance', function () {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on('web-contents-created', function (_event, contents) {
  attachGuards(contents);
});

app.on('window-all-closed', function () {
  app.quit();
});

if (gotLock) {
  if (process.env.TEKMETRIC_CAPTURE === '1') {
    setTimeout(function () {
      console.error('Capture timed out');
      app.exit(1);
    }, 30000);
  }
  app.whenReady().then(async function () {
    const userData = app.getPath('userData');
    store = createStore(path.join(userData, 'shop.json'));
    let adapter = null;
    try {
      if (await safeStorage.isAsyncEncryptionAvailable()) {
        adapter = {
          scheme: 'safeStorage',
          encrypt: async function (plain) {
            const encrypted = await safeStorage.encryptStringAsync(String(plain));
            return Buffer.from(encrypted).toString('base64');
          },
          decrypt: async function (payload) {
            const decrypted = await safeStorage.decryptStringAsync(Buffer.from(payload, 'base64'));
            return decrypted && decrypted.result ? decrypted.result : '';
          },
        };
      }
    } catch (err) {
      adapter = null;
    }
    if (!adapter) adapter = createLocalAes(path.join(userData, 'secret.key'));
    secrets = createSecretStore({
      filePath: path.join(userData, 'secrets.json'),
      adapter: adapter,
    });
    await secrets.ready;
    denyPermissions(session.defaultSession);
    denyPermissions(session.fromPartition('persist:tekmetric'));
    setupSpellcheck();
    registerIpc();
    buildMenu();
    try {
      await createMainWindow();
      if (process.env.TEKMETRIC_CAPTURE === '1') {
        await captureScreens();
        app.exit(0);
      }
    } catch (err) {
      console.error(redact(err && err.stack ? err.stack : err));
      app.exit(1);
    }
  }).catch(function (err) {
    console.error(redact(err && err.stack ? err.stack : err));
    app.exit(1);
  });
}
