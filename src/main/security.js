const AUTOFILL_HOSTS = new Set([
  'shop.tekmetric.com',
  'app.tekmetric.com',
  'login.tekmetric.com',
]);

function secureWebPreferences(extra) {
  const prefs = Object.assign({}, extra || {});
  prefs.nodeIntegration = false;
  prefs.contextIsolation = true;
  prefs.sandbox = true;
  prefs.webSecurity = true;
  prefs.allowRunningInsecureContent = false;
  prefs.webviewTag = false;
  prefs.nodeIntegrationInSubFrames = false;
  prefs.nodeIntegrationInWorker = false;
  return prefs;
}

function isHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && url.hostname.includes('.');
  } catch (err) {
    return false;
  }
}

function isTekmetricSite(value) {
  if (!isHttpsUrl(value)) return false;
  const host = new URL(value).hostname;
  return host === 'tekmetric.com' || host.endsWith('.tekmetric.com');
}

function isTekmetricLoginHost(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && AUTOFILL_HOSTS.has(url.hostname);
  } catch (err) {
    return false;
  }
}

function isAppDocument(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'file:' && url.pathname.endsWith('/index.html');
  } catch (err) {
    return false;
  }
}

function redact(value) {
  return String(value == null ? '' : value)
    .replace(/AIza[0-9A-Za-z\-_]{10,}/g, '[redacted]')
    .replace(/(api[_-]?key|password|secret|token)(["'\s:=]+)[^\s"',]+/gi, '$1$2[redacted]');
}

function buildAutofillScript(email, password) {
  const payload = JSON.stringify({
    email: String(email || ''),
    password: String(password || ''),
  });
  return `(function () {
    const creds = ${payload};
    const emailEl = document.querySelector('input[type="email"], input[name="email" i], input[name="username" i], input[autocomplete="username"]');
    const passEl = document.querySelector('input[type="password"]');
    if (!emailEl || !passEl) return { filled: false, submitted: false };
    const setValue = function (el, value) {
      el.focus();
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    setValue(emailEl, creds.email);
    setValue(passEl, creds.password);
    const form = passEl.form || passEl.closest('form');
    const submit = form && form.querySelector('button[type="submit"], input[type="submit"]');
    if (submit) submit.click();
    return { filled: true, submitted: Boolean(submit) };
  })()`;
}

function friendlyUpdateError(err) {
  const raw = String((err && (err.message || err)) || '');
  if (/404|ENOTFOUND|no published|releases/i.test(raw)) {
    return 'No published update was found. The installed app checks again when a release is published.';
  }
  if (/dev-app-update|not packed|is not packed|skip checkForUpdates/i.test(raw)) {
    return 'Update checks run in the installed app, not from a source checkout.';
  }
  return 'Could not check for updates. Try again when this computer is online.';
}

module.exports = {
  AUTOFILL_HOSTS,
  secureWebPreferences,
  isHttpsUrl,
  isTekmetricSite,
  isTekmetricLoginHost,
  isAppDocument,
  redact,
  buildAutofillScript,
  friendlyUpdateError,
};
