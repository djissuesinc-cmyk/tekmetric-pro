'use strict';

const { app, BrowserWindow, Menu, dialog, ipcMain, protocol, net, session, clipboard } = require('electron');
const { autoUpdater } = require('electron-updater');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const shop = require('./lib/settings');

const SHOP_HOME = 'https://shop.tekmetric.com/';
const SHOP_PARTITION = 'persist:tekmetric_session';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-3.5-flash-lite'];

app.commandLine.appendSwitch('disable-quic');
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');

loadEnvFiles();

const userDataPath = app.getPath('userData');
const settingsPath = path.join(userDataPath, 'settings.json');
const usersPath = path.join(userDataPath, 'users.json');
const printDialogs = new Set();
let updateCheckInteractive = false;

function loadEnvFiles() {
    const candidates = [
        path.join(__dirname, '.env'),
        process.resourcesPath ? path.join(process.resourcesPath, '.env') : '',
        path.join(path.dirname(process.execPath), '.env')
    ].filter(Boolean);
    candidates.forEach((candidate) => {
        if (fs.existsSync(candidate)) dotenvConfig(candidate);
    });
}

function dotenvConfig(envPath) {
    require('dotenv').config({ path: envPath });
}

process.on('uncaughtException', (err) => {
    try {
        const secrets = [];
        try {
            const saved = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
            if (saved && saved.apiKey) secrets.push(saved.apiKey);
        } catch (readErr) { /* no saved key to hide */ }
        if (process.env.GEMINI_API_KEY) secrets.push(process.env.GEMINI_API_KEY);
        const details = shop.redactSecrets((err && err.stack) || String(err), secrets);
        const logPath = path.join(app.getPath('desktop'), 'tekmetric-error.log');
        fs.appendFileSync(logPath, new Date().toISOString() + '\n' + details + '\n\n');
        if (app.isReady()) {
            dialog.showErrorBox('Fatal Application Error', 'The application encountered an error and added it to a log file on your Desktop:\n' + logPath);
        }
    } catch (logErr) {
        console.error(logErr);
    }
});

function ensureShopFiles() {
    fs.mkdirSync(userDataPath, { recursive: true });
    if (!fs.existsSync(usersPath)) fs.writeFileSync(usersPath, '[]\n');
}

function readSettingsFile() {
    try {
        if (!fs.existsSync(settingsPath)) return null;
        return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch (err) {
        return null;
    }
}

function saveSettings(settings) {
    const safe = shop.normalizeSettings(settings);
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    const temporary = settingsPath + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(safe, null, 2));
    fs.renameSync(temporary, settingsPath);
    return safe;
}

function loadSettings() {
    const parsed = readSettingsFile();
    if (!parsed) {
        if (!fs.existsSync(settingsPath)) return saveSettings(shop.normalizeSettings(null));
        return shop.normalizeSettings(null);
    }
    const normalized = shop.normalizeSettings(parsed);
    const presetsMissing = !Array.isArray(parsed.presets) || parsed.presets.length === 0;
    const missingChoice = ['darkMode', 'autoCaps', 'hidePremium', 'showSidebar'].some((key) => typeof parsed[key] !== 'boolean');
    if (presetsMissing || missingChoice) return saveSettings(normalized);
    return normalized;
}

function geminiKey() {
    const saved = (loadSettings().apiKey || '').trim();
    if (saved) return saved;
    return String(process.env.GEMINI_API_KEY || '').trim();
}

function shopPreferences(extra) {
    return Object.assign({
        preload: path.join(__dirname, 'preload.js'),
        partition: SHOP_PARTITION,
        contextIsolation: true,
        sandbox: false,
        webSecurity: false,
        spellcheck: true,
        backgroundThrottling: false
    }, extra || {});
}

function utilityPreferences() {
    return {
        preload: path.join(__dirname, 'dialog-preload.js'),
        contextIsolation: true,
        sandbox: false,
        nodeIntegration: false
    };
}

ensureShopFiles();

ipcMain.on('get-settings', (event) => {
    event.returnValue = shop.publicSettings(loadSettings());
});

function getMainWin() {
    const wins = BrowserWindow.getAllWindows();
    return wins.find((win) => win.getTitle() && win.getTitle().indexOf('Tekmetric Pro') !== -1) || wins[0] || null;
}

const globalCSS = `
    #shop-logo-fixed { pointer-events: none !important; display: none !important; }
    ::-webkit-scrollbar { width: 8px; height: 8px; }
    ::-webkit-scrollbar-track { background: transparent !important; }
    ::-webkit-scrollbar-thumb { background: rgba(150,150,150,0.5) !important; border-radius: 4px; }
    ::-webkit-scrollbar-thumb:hover { background: rgba(150,150,150,0.8) !important; }
    @media print {
        html, body { background-color: #ffffff !important; }
        header, nav, .MuiAppBar-root, .MuiDrawer-root, button,
        #leaside-sidebar-tools, #shop-logo-fixed, .leaside-money-icon, .leaside-x-mark { display: none !important; }
    }
`;

const DARK_CSS = 'html { background: #ffffff !important; filter: invert(90%) hue-rotate(180deg) !important; min-height: 100vh !important; } ' +
    'img, picture, video, canvas, iframe, #shop-logo-fixed { filter: invert(100%) hue-rotate(180deg) !important; } ' +
    'header, .MuiAppBar-root { filter: invert(100%) hue-rotate(180deg) !important; } ' +
    'header img, .MuiAppBar-root img { filter: none !important; } ' +
    '.MuiPaper-root, .MuiCard-root, .MuiDrawer-paper, .MuiDialog-paper, main, [class*="bg-white"], [class*="bg-gray-"] { background-color: #ffffff !important; } ' +
    'input, textarea, select { background-color: #ffffff !important; } ' +
    'div[role="alert"], .Toastify__toast, .MuiSnackbarContent-root { background-color: #333333 !important; color: #ffffff !important; filter: invert(100%) hue-rotate(180deg) !important; } ' +
    'div[role="alert"] div, div[role="alert"] span, .MuiSnackbarContent-root div, .MuiSnackbarContent-root span { color: #ffffff !important; }';

function darkModeScript(enabled) {
    if (!enabled) {
        return "var existing = document.getElementById('leaside-dark-mode'); if (existing) existing.remove();";
    }
    return "if (!document.getElementById('leaside-dark-mode')) {" +
        "var style = document.createElement('style');" +
        "style.id = 'leaside-dark-mode';" +
        "style.textContent = " + JSON.stringify(DARK_CSS) + ";" +
        "(document.head || document.documentElement).appendChild(style);}";
}

function applyDarkMode(contents, enabled) {
    if (!contents || contents.isDestroyed()) return;
    contents.executeJavaScript(darkModeScript(!!enabled)).catch(() => {});
}

function attachContextMenu(win) {
    win.webContents.on('context-menu', (event, params) => {
        const menuTemplate = [];
        if (params.dictionarySuggestions && params.dictionarySuggestions.length > 0) {
            params.dictionarySuggestions.forEach((suggestion) => {
                menuTemplate.push({
                    label: suggestion,
                    click: () => win.webContents.replaceMisspelling(suggestion)
                });
            });
            menuTemplate.push({ type: 'separator' });
        }
        if (params.misspelledWord) {
            menuTemplate.push({
                label: 'Add "' + params.misspelledWord + '" to Dictionary',
                click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord)
            });
            menuTemplate.push({ type: 'separator' });
        }
        if (params.selectionText) {
            menuTemplate.push({
                label: '✨ AI: Fix Spelling & Grammar',
                click: async () => {
                    const fixedText = await runGeminiSpellCheck(params.selectionText, win);
                    if (fixedText && !win.isDestroyed()) {
                        clipboard.writeText(fixedText);
                        win.webContents.paste();
                    }
                }
            });
            menuTemplate.push({
                label: '✨ AI: Make Professional',
                click: async () => {
                    const improvedText = await runGemini(params.selectionText, win);
                    if (improvedText && !win.isDestroyed()) {
                        clipboard.writeText(improvedText);
                        win.webContents.paste();
                    }
                }
            });
        }
        menuTemplate.push({ type: 'separator' });
        menuTemplate.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' });
        Menu.buildFromTemplate(menuTemplate).popup({ window: win });
    });
}

function attachShopChrome(win) {
    win.webContents.on('did-finish-load', () => {
        win.webContents.insertCSS(globalCSS).catch(() => {});
        applyDarkMode(win.webContents, loadSettings().darkMode);
    });
    attachContextMenu(win);
    win.webContents.setWindowOpenHandler(({ url: nextUrl }) => {
        if (nextUrl.startsWith('blob:') || /\.pdf($|\?)/i.test(nextUrl) || nextUrl.includes('/print') || nextUrl.includes('/download')) {
            return { action: 'deny' };
        }
        return {
            action: 'allow',
            overrideBrowserWindowOptions: {
                icon: path.join(__dirname, 'logo.png'),
                webPreferences: shopPreferences()
            }
        };
    });
    win.webContents.on('did-create-window', (childWindow) => {
        childWindow.setIcon(path.join(__dirname, 'logo.png'));
        childWindow.maximize();
        attachShopChrome(childWindow);
    });
}

function createWindow(targetUrl) {
    const homeUrl = targetUrl || SHOP_HOME;
    const win = new BrowserWindow({
        width: 1400,
        height: 900,
        show: false,
        title: "Craig's Leaside Automotive - Tekmetric Pro",
        icon: path.join(__dirname, 'logo.png'),
        webPreferences: shopPreferences()
    });

    win.once('ready-to-show', () => {
        win.maximize();
        win.show();
    });

    win.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (!isMainFrame || errorCode === -3 || win.isDestroyed()) return;
        const parent = win.isDestroyed() ? null : win;
        const box = parent ? dialog.showMessageBox(parent, connectionOptions()) : dialog.showMessageBox(connectionOptions());
        box.then((result) => {
            if (result.response === 0 && !win.isDestroyed()) win.loadURL(homeUrl);
        }).catch(() => {});
    });

    attachShopChrome(win);
    win.loadURL(homeUrl);
    return win;
}

function connectionOptions() {
    return {
        type: 'warning',
        title: 'Connection problem',
        message: 'Tekmetric did not open. Check the internet connection, then try again.',
        buttons: ['Try again', 'Close'],
        defaultId: 0,
        cancelId: 1
    };
}

function toggleDarkMode() {
    const settings = loadSettings();
    settings.darkMode = !settings.darkMode;
    saveSettings(settings);
    BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed() && win.isVisible()) applyDarkMode(win.webContents, settings.darkMode);
    });
}

ipcMain.on('document-ready', async (event, urlLoc, isMainWindow = false) => {
    const senderId = event.sender.id;
    if (printDialogs.has(senderId)) return;
    printDialogs.add(senderId);
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    try {
        if (!senderWin || senderWin.isDestroyed() || !senderWin.isVisible()) return;
        let urlObj;
        try {
            urlObj = new URL(urlLoc);
        } catch (err) {
            return;
        }
        const pathParts = urlObj.pathname.split('/');
        pathParts.pop();
        const basePath = urlObj.origin + pathParts.join('/');
        const search = urlObj.search;
        const estimateUrl = basePath + '/estimate' + search;
        const repairUrl = basePath + '/repair' + search;
        const invoiceUrl = basePath + '/invoice' + search;
        const inspectUrl = basePath + '/inspections' + search;
        const params = new URLSearchParams(urlObj.search);
        params.set('hideImages', 'true');
        const inspectNoImgUrl = basePath + '/inspections?' + params.toString();

        const promptHost = new BrowserWindow({ show: false, alwaysOnTop: true });
        const { response } = await dialog.showMessageBox(promptHost, {
            type: 'question',
            buttons: [
                'Cancel',
                'Estimate x1',
                'Estimate + Inspection x1',
                'Inspection x1',
                'Work Order x1',
                'Work Order + Inspection x1',
                'Invoice x1',
                'Invoices x2',
                'Invoices x2 + Inspection x1'
            ],
            title: 'Leaside Smart Print',
            message: 'Select shop bundle:',
            icon: path.join(__dirname, 'logo.png')
        });
        if (!promptHost.isDestroyed()) promptHost.close();

        if (response > 0 && !isMainWindow && senderWin && !senderWin.isDestroyed()) senderWin.close();
        if (response === 1) silentPrint(estimateUrl, 1);
        if (response === 2) { silentPrint(estimateUrl, 1); checkAndPrintInspection(inspectUrl); }
        if (response === 3) checkAndPrintInspection(inspectUrl);
        if (response === 4) silentPrint(repairUrl, 1);
        if (response === 5) { silentPrint(repairUrl, 1); checkAndPrintInspection(inspectNoImgUrl); }
        if (response === 6) silentPrint(invoiceUrl, 1);
        if (response === 7) silentPrint(invoiceUrl, 2);
        if (response === 8) { silentPrint(invoiceUrl, 2); checkAndPrintInspection(inspectUrl); }
    } finally {
        printDialogs.delete(senderId);
    }
});

function tellMain(title, message) {
    const win = getMainWin();
    const options = { type: 'warning', title: title, message: message, buttons: ['OK'] };
    if (win && !win.isDestroyed()) dialog.showMessageBox(win, options);
    else dialog.showMessageBox(options);
}

function watchHiddenWindow(printWin) {
    const failSafe = setTimeout(() => {
        if (!printWin.isDestroyed()) printWin.close();
    }, 45000);
    printWin.on('closed', () => clearTimeout(failSafe));
    printWin.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (!isMainFrame || errorCode === -3) return;
        tellMain('Print problem', 'That shop page did not open, so nothing was printed.');
        if (!printWin.isDestroyed()) printWin.close();
    });
}

function checkAndPrintInspection(urlLoc) {
    const printUrl = new URL(urlLoc);
    printUrl.searchParams.set('hiddenPrinter', 'true');
    printUrl.searchParams.set('copies', '1');
    const checkWin = new BrowserWindow({
        show: false,
        webPreferences: shopPreferences()
    });
    watchHiddenWindow(checkWin);
    checkWin.loadURL(printUrl.toString());
    checkWin.webContents.once('did-finish-load', () => {
        const current = checkWin.webContents.getURL();
        if (current.includes('error') || current.includes('dashboard')) {
            tellMain('Inspection Missing', 'No inspection is attached to this order.');
            if (!checkWin.isDestroyed()) checkWin.close();
            return;
        }
        checkWin.webContents.insertCSS(globalCSS).catch(() => {});
        setTimeout(() => {
            if (checkWin.isDestroyed()) return;
            checkWin.webContents.print({ silent: true, printBackground: true, copies: 1, duplexMode: 'longEdge' }, (success, failureReason) => {
                if (!success && failureReason) tellMain('Print problem', 'The inspection did not print.\n\n' + failureReason);
                setTimeout(() => { if (!checkWin.isDestroyed()) checkWin.close(); }, 3000);
            });
        }, 1500);
    });
}

function silentPrint(urlLoc, copies) {
    const printUrl = new URL(urlLoc);
    const copyCount = parseInt(copies, 10) || 1;
    printUrl.searchParams.set('hiddenPrinter', 'true');
    printUrl.searchParams.set('copies', String(copyCount));
    const printWin = new BrowserWindow({
        show: false,
        webPreferences: shopPreferences()
    });
    watchHiddenWindow(printWin);
    printWin.loadURL(printUrl.toString());
    printWin.webContents.once('did-finish-load', () => {
        printWin.webContents.insertCSS(globalCSS).catch(() => {});
        setTimeout(() => {
            if (printWin.isDestroyed()) return;
            printWin.webContents.print({
                silent: true,
                printBackground: true,
                copies: copyCount,
                duplexMode: 'longEdge'
            }, (success, failureReason) => {
                if (!success && failureReason) tellMain('Print problem', 'The page did not print.\n\n' + failureReason);
                setTimeout(() => { if (!printWin.isDestroyed()) printWin.close(); }, 3000);
            });
        }, 1500);
    });
}

async function runGeminiSpellCheck(text, parentWin) {
    const prompt = 'Fix all spelling and grammar errors in the following text. Do not rewrite, do not expand, and do not change the meaning. Return only the corrected text: ' + text;
    const result = await processGeminiRequest(prompt, parentWin);
    const settings = loadSettings();
    return (result && settings.autoCaps) ? result.toUpperCase() : result;
}

async function runGemini(text, parentWin) {
    const prompt = 'You are an expert automotive service advisor. Rewrite the following repair note to sound professional, clear, and concise. \n    \n    STRICT RULES:\n    1. DO NOT invent, assume, or add any parts, actions, or results that are not explicitly stated in the original text.\n    2. If the original text only states a problem, only return a professional version of that problem.\n    3. Correct all spelling and grammar.\n    4. Return ONLY the rewritten text.\n    \n    Original Text: ' + text;
    const result = await processGeminiRequest(prompt, parentWin);
    const settings = loadSettings();
    return (result && settings.autoCaps) ? result.toUpperCase() : result;
}

async function processGeminiRequest(prompt, parentWin) {
    const apiKey = geminiKey();
    const host = parentWin && !parentWin.isDestroyed() ? parentWin : getMainWin();
    try {
        if (!apiKey) {
            await showOn(host, {
                type: 'error',
                title: 'AI Offline',
                message: 'API key is missing. Please add it via Tools > System Settings.'
            });
            return null;
        }
        const genAI = new GoogleGenerativeAI(apiKey);
        let lastError = null;
        for (let index = 0; index < GEMINI_MODELS.length; index += 1) {
            try {
                const model = genAI.getGenerativeModel({ model: GEMINI_MODELS[index] });
                const timeout = new Promise((resolve, reject) => {
                    setTimeout(() => reject(new Error('AI Request Timed Out')), 15000);
                });
                const result = await Promise.race([model.generateContent(prompt), timeout]);
                const text = result.response.text().trim();
                if (text) return text;
                lastError = new Error('Empty response');
            } catch (err) {
                lastError = err;
                const message = String(err && err.message ? err.message : err);
                if (/timed out/i.test(message)) break;
                const missingModel = /not found|not supported|404|unknown model/i.test(message);
                if (!missingModel || index === GEMINI_MODELS.length - 1) break;
            }
        }
        throw lastError || new Error('Empty response');
    } catch (err) {
        const safeMessage = shop.redactSecrets(err && err.message ? err.message : String(err), [apiKey]);
        await showOn(host, {
            type: 'error',
            title: 'AI Server Error',
            message: 'Failed to process AI request.\n\nError: ' + safeMessage
        });
        return null;
    }
}

function requireAdmin(callback) {
    const parentWin = getMainWin();
    const authWin = new BrowserWindow({
        width: 350,
        height: 240,
        parent: parentWin && !parentWin.isDestroyed() ? parentWin : undefined,
        modal: !!(parentWin && !parentWin.isDestroyed()),
        alwaysOnTop: true,
        autoHideMenuBar: true,
        resizable: false,
        show: false,
        title: 'Admin Verification',
        webPreferences: utilityPreferences()
    });
    const html = `
        <body style="font-family: sans-serif; background: #121212; color: #fff; text-align: center; padding: 20px;">
            <h3 style="margin-top: 0;">Admin Access</h3>
            <p style="font-size: 12px; color: #aaa;">Enter PIN to modify settings.</p>
            <input type="password" id="pin" style="padding: 8px; width: 60%; text-align: center; background: #222; color: white; border: 1px solid #555; border-radius: 4px;">
            <br><br>
            <button id="btn" style="padding: 8px 20px; background: #d32f2f; color: white; border: none; border-radius: 4px; cursor: pointer;">Verify</button>
            <p id="error-msg" style="color: #ff5252; font-size: 12px; font-weight: bold; margin-top: 10px;"></p>
            <script>
                document.getElementById('btn').onclick = () => window.leaside.submitPin(document.getElementById('pin').value);
                document.getElementById('pin').addEventListener('keypress', (e) => { if (e.key === 'Enter') document.getElementById('btn').click(); });
                window.leaside.onAuthFailed(() => {
                    document.getElementById('error-msg').innerText = 'Incorrect PIN';
                    document.getElementById('pin').value = '';
                });
            </script>
        </body>
    `;
    authWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    authWin.once('ready-to-show', () => authWin.show());

    const authHandler = (event, pin) => {
        if (String(pin || '') === shop.expectedPin(loadSettings())) {
            ipcMain.removeListener('auth-attempt', authHandler);
            authWin.once('closed', () => callback());
            authWin.close();
        } else if (!authWin.isDestroyed()) {
            authWin.webContents.send('auth-failed');
        }
    };
    ipcMain.on('auth-attempt', authHandler);
    authWin.on('closed', () => ipcMain.removeListener('auth-attempt', authHandler));
}

function openUtilityWindow(title, width, height, html) {
    const parentWin = getMainWin();
    const win = new BrowserWindow({
        width: width,
        height: height,
        parent: parentWin && !parentWin.isDestroyed() ? parentWin : undefined,
        modal: !!(parentWin && !parentWin.isDestroyed()),
        alwaysOnTop: true,
        autoHideMenuBar: true,
        title: title,
        icon: path.join(__dirname, 'logo.png'),
        webPreferences: utilityPreferences()
    });
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    return win;
}

ipcMain.handle('settings:form', () => {
    const settings = loadSettings();
    return { hasApiKey: !!settings.apiKey || !!String(process.env.GEMINI_API_KEY || '').trim() };
});

ipcMain.handle('settings:save', (event, payload) => {
    const settings = loadSettings();
    const nextKey = payload && typeof payload.apiKey === 'string' ? payload.apiKey.trim() : '';
    const nextPin = payload && typeof payload.adminPin === 'string' ? payload.adminPin.trim() : '';
    const removeKey = !!(payload && payload.removeKey);
    if (nextPin && nextPin.length < 4) {
        return { ok: false, message: 'PIN must be at least 4 characters.' };
    }
    if (removeKey) settings.apiKey = '';
    else if (nextKey) settings.apiKey = nextKey;
    if (nextPin) settings.adminPin = nextPin;
    saveSettings(settings);
    return { ok: true, message: 'Settings saved successfully. Close this window to continue.' };
});

function openSettingsEditor() {
    const html = `
        <body style="font-family: sans-serif; padding: 20px; background: #121212; color: #e0e0e0;">
            <h2>System Settings</h2>
            <label for="api">Gemini API Key:</label><br>
            <input type="password" id="api" autocomplete="off" style="width: 100%; padding: 8px; margin-top: 5px; margin-bottom: 8px; background: #222; color: #fff; border: 1px solid #444;">
            <label style="font-size: 13px;"><input type="checkbox" id="remove-key"> Remove the saved key</label>
            <p id="key-hint" style="color: #aaa; font-size: 12px;"></p>
            <label for="pin">New admin PIN (leave blank to keep the current one):</label><br>
            <input type="password" id="pin" autocomplete="off" style="width: 100%; padding: 8px; margin-top: 5px; margin-bottom: 20px; background: #222; color: #fff; border: 1px solid #444;">
            <button id="save" style="padding: 10px 20px; background: #d32f2f; color: #fff; border: none; cursor: pointer;">Save Settings</button>
            <p id="msg" style="color: #4caf50; font-weight: bold; margin-top: 15px;"></p>
            <script>
                window.leaside.settingsForm().then((form) => {
                    document.getElementById('key-hint').textContent = form.hasApiKey
                        ? 'A key is already saved. Leave the box blank to keep it.'
                        : 'Paste the Google Gemini key for writing help.';
                });
                document.getElementById('save').onclick = () => {
                    window.leaside.saveSettings({
                        apiKey: document.getElementById('api').value,
                        adminPin: document.getElementById('pin').value,
                        removeKey: document.getElementById('remove-key').checked
                    }).then((result) => {
                        const msg = document.getElementById('msg');
                        msg.style.color = result.ok ? '#4caf50' : '#ff5252';
                        msg.textContent = result.message;
                    });
                };
            </script>
        </body>
    `;
    openUtilityWindow('API Settings', 600, 460, html);
}

ipcMain.handle('users:get', () => fs.readFileSync(usersPath, 'utf8'));

ipcMain.handle('users:save', (event, text) => {
    let data;
    try {
        data = JSON.parse(text);
    } catch (err) {
        return { ok: false, message: 'Invalid JSON format. Please check your syntax.' };
    }
    if (!Array.isArray(data)) return { ok: false, message: 'The file must be a list of people, starting with [ and ending with ].' };
    const valid = data.every((user) => user && typeof user.name === 'string' && typeof user.email === 'string' && typeof user.pass === 'string');
    if (!valid) return { ok: false, message: 'Each person needs a name, an email, and a pass.' };
    fs.writeFileSync(usersPath, JSON.stringify(data, null, 2));
    return { ok: true };
});

function openUserEditor() {
    const html = `
        <body style="font-family: sans-serif; padding: 20px; background: #121212; color: #e0e0e0;">
            <h2>Shop User Profiles</h2>
            <p>Edit the list below. Each person needs a name, an email, and a pass. Keep the brackets and quotes intact.</p>
            <textarea id="users" style="width: 100%; height: 350px; padding: 10px; font-family: monospace; background: #222; color: #fff; border: 1px solid #444;"></textarea>
            <br><br>
            <button id="save" style="padding: 10px 20px; background: #d32f2f; color: #fff; border: none; cursor: pointer;">Save Users & Restart Application</button>
            <p id="msg" style="color: #ff5252; font-weight: bold; margin-top: 15px;"></p>
            <script>
                window.leaside.getUsers().then((text) => { document.getElementById('users').value = text; });
                document.getElementById('save').onclick = () => {
                    window.leaside.saveUsers(document.getElementById('users').value).then((result) => {
                        if (!result.ok) {
                            document.getElementById('msg').textContent = result.message;
                            return;
                        }
                        window.leaside.restart();
                    });
                };
            </script>
        </body>
    `;
    openUtilityWindow('Edit User Info', 800, 600, html);
}

ipcMain.handle('presets:get', () => loadSettings().presets.join('\n'));

ipcMain.handle('presets:save', (event, text) => {
    const lines = String(text || '').split('\n').map((line) => line.trim()).filter((line) => line !== '');
    if (lines.length === 0) return { ok: false, message: 'Add at least one job.' };
    const settings = loadSettings();
    settings.presets = lines;
    saveSettings(settings);
    return { ok: true };
});

function openPresetsEditor() {
    const html = `
        <body style="font-family: sans-serif; padding: 20px; background: #121212; color: #e0e0e0;">
            <h2>Shop Text Presets</h2>
            <p>Enter one preset job per line. Do not use quotes or commas to separate items.</p>
            <textarea id="presets" style="width: 100%; height: 350px; padding: 10px; font-family: monospace; background: #222; color: #fff; border: 1px solid #444; white-space: pre;"></textarea>
            <br><br>
            <button id="save" style="padding: 10px 20px; background: #d32f2f; color: #fff; border: none; cursor: pointer; font-weight: bold;">Save & Restart App</button>
            <p id="msg" style="color: #ff5252; font-weight: bold; margin-top: 15px;"></p>
            <script>
                window.leaside.getPresets().then((text) => { document.getElementById('presets').value = text; });
                document.getElementById('save').onclick = () => {
                    window.leaside.savePresets(document.getElementById('presets').value).then((result) => {
                        if (!result.ok) {
                            document.getElementById('msg').textContent = result.message;
                            return;
                        }
                        window.leaside.restart();
                    });
                };
            </script>
        </body>
    `;
    openUtilityWindow('Edit Text Presets', 700, 600, html);
}

function openAboutWindow() {
    const parentWin = getMainWin();
    const aboutWin = new BrowserWindow({
        width: 450,
        height: 680,
        parent: parentWin && !parentWin.isDestroyed() ? parentWin : undefined,
        modal: !!(parentWin && !parentWin.isDestroyed()),
        alwaysOnTop: true,
        title: 'About System',
        icon: path.join(__dirname, 'logo.png'),
        autoHideMenuBar: true,
        resizable: false,
        backgroundColor: '#0d0d0d',
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }
    });
    const version = String(app.getVersion()).replace(/[^0-9A-Za-z.+-]/g, '');
    const htmlContent = `
        <body style="font-family: 'Segoe UI', Tahoma, sans-serif; background-color: #0d0d0d; color: #e0e0e0; margin: 0; padding: 0; display: flex; flex-direction: column; height: 100vh; overflow: hidden;">
            <div style="flex: 1; padding: 40px 30px; text-align: center;">
                <img src="local-resource://logo.png" style="width: 100px; margin-bottom: 20px;" alt="">
                <h1 style="margin: 0; font-size: 26px; color: #ffffff; letter-spacing: 1px;">Tekmetric Pro</h1>
                <p style="color: #ef5350; margin-top: 5px; font-size: 13px; font-weight: bold; text-transform: uppercase;">Version ${version}</p>
                <div style="margin: 30px 0; border-top: 1px solid #222; border-bottom: 1px solid #222; padding: 20px 0;">
                    <p style="margin: 0; font-size: 14px; line-height: 1.5; color: #bbb;">
                        Engineered specifically to automate workflow operations and integrate local AI diagnostic assistance.
                    </p>
                </div>
                <p style="font-size: 12px; color: #888; margin-bottom: 0;">
                    Developed by Shawn Bradbury<br>
                    <strong>Craig's Leaside Automotive Inc.</strong>
                </p>
            </div>
            <div style="background: #151515; padding: 20px 30px 10px 30px; border-top: 1px solid #2a2a2a; font-size: 10px; color: #666; text-align: justify; line-height: 1.4;">
                <strong style="color: #888;">LEGAL DISCLAIMER:</strong> This software operates as a standalone container alongside Tekmetric. It does not reflect the views or official software of Tekmetric. Unauthorized distribution or deployment outside of the authorized facility is prohibited.
            </div>
            <div style="background: #151515; padding-bottom: 25px; text-align: center;">
                <button onclick="window.close()" style="background-color: #d32f2f; color: #ffffff; border: none; padding: 10px 30px; border-radius: 4px; font-weight: bold; cursor: pointer; text-transform: uppercase; letter-spacing: 1px; font-size: 13px;">Acknowledged</button>
            </div>
        </body>
    `;
    aboutWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(htmlContent));
}

ipcMain.on('restart-app', () => {
    app.relaunch();
    app.exit();
});

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;

function showOn(host, options) {
    if (host && !host.isDestroyed()) return dialog.showMessageBox(host, options);
    return dialog.showMessageBox(options);
}

function showUpdateBox(options) {
    const win = getMainWin();
    if (win && !win.isDestroyed()) return dialog.showMessageBox(win, options);
    return dialog.showMessageBox(options);
}

autoUpdater.on('update-available', (info) => {
    showUpdateBox({
        type: 'question',
        title: 'Update Available',
        message: 'Version ' + info.version + ' is available. Do you want to download it now?',
        buttons: ['Download Update', 'Later']
    }).then((result) => {
        if (result.response === 0) autoUpdater.downloadUpdate();
    }).catch(() => {});
});

autoUpdater.on('update-not-available', () => {
    if (!updateCheckInteractive) return;
    showUpdateBox({ type: 'info', title: 'Up to Date', message: 'You are already running the latest version.' });
});

autoUpdater.on('error', (err) => {
    if (!updateCheckInteractive) return;
    const msg = shop.redactSecrets((err && err.message) ? err.message : String(err), [geminiKey()]);
    showUpdateBox({
        type: 'info',
        title: 'Updater Notification',
        message: 'Update check failed or offline mode active.\n\nDetails: ' + msg
    });
});

autoUpdater.on('update-downloaded', (info) => {
    showUpdateBox({
        type: 'question',
        title: 'Update Ready',
        message: 'Version ' + info.version + ' has been downloaded. Restart the application to apply the updates now?',
        buttons: ['Restart & Install', 'Later']
    }).then((result) => {
        if (result.response === 0) autoUpdater.quitAndInstall();
    }).catch(() => {});
});

function checkForUpdates(interactive) {
    updateCheckInteractive = !!interactive;
    if (!app.isPackaged) {
        if (interactive) {
            showUpdateBox({
                type: 'info',
                title: 'Updater',
                message: 'Update checks run from the installed app. Use npm start while you are trying the folder copy.'
            });
        }
        return;
    }
    autoUpdater.checkForUpdates().catch(() => {});
}

function broadcastSettings() {
    const view = shop.publicSettings(loadSettings());
    BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) win.webContents.send('settings-changed', view);
    });
}

function setupMenu() {
    let userMenu = [];
    try {
        if (fs.existsSync(usersPath)) {
            const users = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
            if (Array.isArray(users)) {
                userMenu = users.map((user) => ({
                    label: 'Login as ' + user.name,
                    click: () => {
                        const win = getMainWin();
                        if (win && !win.isDestroyed()) win.webContents.send('fill-login', user);
                    }
                }));
            }
        }
    } catch (err) {
        console.error('Failed to load users.');
    }
    if (userMenu.length === 0) {
        userMenu.push({ label: 'No saved logins yet', enabled: false });
    }

    const presetJobs = loadSettings().presets || [];
    const template = [
        {
            label: 'Shop Admin',
            submenu: [
                { label: 'Login Selection', submenu: userMenu },
                { label: 'Edit User Info', click: () => requireAdmin(openUserEditor) },
                { label: 'Edit Text Presets', click: () => requireAdmin(openPresetsEditor) },
                { type: 'separator' },
                {
                    label: 'Purge System Cache',
                    click: () => {
                        const count = purgeTempFiles();
                        showUpdateBox({ type: 'info', title: 'System Purge', message: 'Purged ' + count + ' temporary print files.' });
                    }
                },
                { type: 'separator' },
                { label: 'Check for Updates', click: () => checkForUpdates(true) },
                { label: 'About System', click: () => openAboutWindow() },
                { role: 'quit' }
            ]
        },
        {
            label: 'Quick Actions',
            submenu: [
                {
                    label: 'Fill "No Faults"',
                    accelerator: 'CmdOrCtrl+Alt+N',
                    click: () => {
                        const win = getMainWin();
                        if (win && !win.isDestroyed()) win.webContents.send('fill-no-faults');
                    }
                },
                {
                    label: 'Clear "No Faults"',
                    accelerator: 'CmdOrCtrl+Alt+C',
                    click: () => {
                        const win = getMainWin();
                        if (win && !win.isDestroyed()) win.webContents.send('clear-no-faults');
                    }
                },
                { type: 'separator' },
                ...presetJobs.map((job) => ({
                    label: shop.menuJobLabel(job),
                    click: () => {
                        const win = getMainWin();
                        if (win && !win.isDestroyed()) win.webContents.send('insert-text', job);
                    }
                }))
            ]
        },
        {
            label: 'View',
            submenu: [
                {
                    label: 'Toggle Quick Actions Panel',
                    click: () => {
                        const settings = loadSettings();
                        settings.showSidebar = !settings.showSidebar;
                        saveSettings(settings);
                        broadcastSettings();
                    }
                },
                { type: 'separator' },
                { label: 'Toggle Dark Mode', click: () => toggleDarkMode() },
                { label: 'New Window (Ctrl+N)', accelerator: 'CmdOrCtrl+N', click: () => createWindow() },
                { type: 'separator' },
                {
                    label: 'Zoom In',
                    accelerator: 'CmdOrCtrl+=',
                    click: () => {
                        const win = getMainWin();
                        if (win && !win.isDestroyed()) win.webContents.setZoomLevel(win.webContents.getZoomLevel() + 0.5);
                    }
                },
                {
                    label: 'Zoom Out',
                    accelerator: 'CmdOrCtrl+-',
                    click: () => {
                        const win = getMainWin();
                        if (win && !win.isDestroyed()) win.webContents.setZoomLevel(win.webContents.getZoomLevel() - 0.5);
                    }
                },
                {
                    label: 'Reset Zoom',
                    accelerator: 'CmdOrCtrl+0',
                    click: () => {
                        const win = getMainWin();
                        if (win && !win.isDestroyed()) win.webContents.setZoomLevel(0);
                    }
                },
                { type: 'separator' },
                { role: 'reload' }
            ]
        },
        {
            label: 'Tools',
            submenu: [
                { label: 'System Settings (API Keys)', click: () => requireAdmin(openSettingsEditor) },
                {
                    label: 'Toggle Auto Uppercase',
                    click: () => {
                        const settings = loadSettings();
                        settings.autoCaps = !settings.autoCaps;
                        saveSettings(settings);
                        broadcastSettings();
                    }
                },
                {
                    label: 'Toggle Premium Features View',
                    click: () => {
                        const settings = loadSettings();
                        settings.hidePremium = !settings.hidePremium;
                        saveSettings(settings);
                        broadcastSettings();
                    }
                }
            ]
        }
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function purgeTempFiles() {
    const tempDir = app.getPath('temp');
    let count = 0;
    try {
        fs.readdirSync(tempDir).forEach((file) => {
            if (file.startsWith('Leaside_RO_') && file.endsWith('.pdf')) {
                fs.unlinkSync(path.join(tempDir, file));
                count += 1;
            }
        });
    } catch (err) {
        console.error('Cleanup error.');
    }
    return count;
}

async function processPdfData(arrayData, shopData) {
    const buffer = Buffer.from(arrayData);
    const pdfDoc = await PDFDocument.load(buffer);
    const pages = pdfDoc.getPages();
    if (!pages.length) throw new Error('This PDF has no pages.');
    const firstPage = pages[0];
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const boxX = 35;
    const boxY = 660;
    firstPage.drawRectangle({ x: boxX, y: boxY, width: 300, height: 60, color: rgb(1, 1, 1) });
    let textY = boxY + 40;
    const customer = shop.pdfSafe(shopData && shopData.customer).toUpperCase();
    const vehicle = shop.pdfSafe(shopData && shopData.vehicle).toUpperCase();
    const phone = shop.pdfSafe(shopData && shopData.phone);
    if (customer) {
        firstPage.drawText('CLIENT: ' + customer, { x: boxX, y: textY, size: 12, font: helveticaBold, color: rgb(0, 0, 0) });
        textY -= 15;
    }
    if (vehicle) {
        firstPage.drawText('VEHICLE: ' + vehicle.substring(0, 30), { x: boxX, y: textY, size: 12, font: helveticaBold, color: rgb(0, 0, 0) });
        textY -= 15;
    }
    if (phone) {
        firstPage.drawText('PHONE: ' + phone, { x: boxX, y: textY, size: 12, font: helveticaBold, color: rgb(0, 0, 0) });
    }
    const pdfBytes = await pdfDoc.save();
    const tempPath = path.join(app.getPath('temp'), 'Leaside_RO_' + Date.now() + '.pdf');
    fs.writeFileSync(tempPath, pdfBytes);
    return tempPath;
}

function openPdfWindow(tempPath, copies, silent) {
    const pdfWin = new BrowserWindow({
        width: silent ? 800 : 1000,
        height: silent ? 600 : 900,
        title: 'Leaside Document Output',
        icon: path.join(__dirname, 'logo.png'),
        autoHideMenuBar: true,
        show: false,
        webPreferences: { plugins: true, backgroundThrottling: false }
    });
    if (silent) watchHiddenWindow(pdfWin);
    pdfWin.loadURL(pathToFileURL(tempPath).toString());
    pdfWin.webContents.on('did-finish-load', () => {
        if (!silent) pdfWin.show();
        setTimeout(() => {
            if (pdfWin.isDestroyed()) return;
            const printOptions = {
                silent: !!silent,
                printBackground: true,
                copies: parseInt(copies, 10) || 1
            };
            if (silent) printOptions.duplexMode = 'longEdge';
            pdfWin.webContents.print(printOptions, (success, failureReason) => {
                if (!success && failureReason) tellMain('Print problem', 'The PDF did not print.\n\n' + failureReason);
                setTimeout(() => { if (!pdfWin.isDestroyed()) pdfWin.close(); }, silent ? 3000 : 5000);
            });
        }, silent ? 1000 : 800);
    });
}

ipcMain.on('modify-pdf-blob', async (event, arrayData, shopData) => {
    try {
        const tempPath = await processPdfData(arrayData, shopData);
        openPdfWindow(tempPath, 1, false);
    } catch (err) {
        dialog.showErrorBox('PDF Error', shop.redactSecrets(err.message, [geminiKey()]));
    }
});

ipcMain.on('modify-pdf-blob-silent', async (event, arrayData, shopData, copies) => {
    try {
        const tempPath = await processPdfData(arrayData, shopData);
        openPdfWindow(tempPath, copies, true);
    } catch (err) {
        console.error('Silent PDF Error.');
        tellMain('PDF Error', 'A print file could not be prepared.');
    }
});

app.whenReady().then(() => {
    app.userAgentFallback = USER_AGENT;
    const shopSession = session.fromPartition(SHOP_PARTITION);
    shopSession.setUserAgent(USER_AGENT);
    try {
        shopSession.setSpellCheckerLanguages(['en-CA', 'en-US']);
        session.defaultSession.setSpellCheckerLanguages(['en-CA', 'en-US']);
    } catch (err) {
        console.error('Spell check languages could not be set.');
    }
    purgeTempFiles();
    app.setAppUserModelId('com.craigsleaside.tekmetricpro');
    protocol.handle('local-resource', (request) => {
        if (shop.safeResourceName(request.url) !== 'logo.png') {
            return new Response('Not found', { status: 404 });
        }
        return net.fetch(pathToFileURL(path.join(__dirname, 'logo.png')).toString());
    });
    createWindow();
    setupMenu();
    checkForUpdates(false);
});
