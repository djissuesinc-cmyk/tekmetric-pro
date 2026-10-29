const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function createLocalAes(keyPath) {
  function loadKey() {
    if (fs.existsSync(keyPath)) {
      const existing = fs.readFileSync(keyPath);
      if (existing.length === 32) return existing;
    }
    const key = crypto.randomBytes(32);
    fs.mkdirSync(path.dirname(keyPath), { recursive: true });
    fs.writeFileSync(keyPath, key, { mode: 0o600 });
    try { fs.chmodSync(keyPath, 0o600); } catch (err) { /* windows */ }
    return key;
  }

  return {
    scheme: 'local-aes',
    encrypt: function (plain) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', loadKey(), iv);
      const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      return Buffer.concat([iv, tag, enc]).toString('base64');
    },
    decrypt: function (payload) {
      const buf = Buffer.from(payload, 'base64');
      if (buf.length < 29) throw new Error('unreadable');
      const iv = buf.subarray(0, 12);
      const tag = buf.subarray(12, 28);
      const enc = buf.subarray(28);
      const decipher = crypto.createDecipheriv('aes-256-gcm', loadKey(), iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
    },
  };
}

function maskEmail(email) {
  if (!email || !email.includes('@')) return '';
  const bits = email.split('@');
  const name = bits[0];
  const host = bits[1];
  const visible = name.slice(0, 1);
  return visible + '***@' + host;
}

function hintKey(key) {
  if (!key || key.length < 4) return '';
  return '•••• ' + key.slice(-4);
}

function createSecretStore(options) {
  const filePath = options.filePath;
  const adapter = options.adapter;
  let unlocked = true;
  let cache = {
    geminiApiKey: '',
    tekmetricEmail: '',
    tekmetricPassword: '',
  };

  function emptyFile() {
    return { scheme: adapter.scheme, fields: {} };
  }

  function readFile() {
    if (!fs.existsSync(filePath)) return emptyFile();
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || parsed.scheme !== adapter.scheme || typeof parsed.fields !== 'object') {
        unlocked = false;
        return null;
      }
      return parsed;
    } catch (err) {
      unlocked = false;
      return null;
    }
  }

  function writeFile(data) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
    fs.renameSync(tmp, filePath);
    try { fs.chmodSync(filePath, 0o600); } catch (err) { /* windows */ }
  }

  async function load() {
    const data = readFile();
    if (!data) return;
    unlocked = true;
    const next = { geminiApiKey: '', tekmetricEmail: '', tekmetricPassword: '' };
    const names = Object.keys(next);
    for (let i = 0; i < names.length; i += 1) {
      const name = names[i];
      if (!data.fields[name]) continue;
      try {
        next[name] = await adapter.decrypt(data.fields[name]);
      } catch (err) {
        unlocked = false;
        return;
      }
    }
    cache = next;
  }

  async function persist() {
    const fields = {};
    if (cache.geminiApiKey) fields.geminiApiKey = await adapter.encrypt(cache.geminiApiKey);
    if (cache.tekmetricEmail) fields.tekmetricEmail = await adapter.encrypt(cache.tekmetricEmail);
    if (cache.tekmetricPassword) fields.tekmetricPassword = await adapter.encrypt(cache.tekmetricPassword);
    writeFile({ scheme: adapter.scheme, fields: fields });
    unlocked = true;
  }

  const ready = load();

  return {
    ready: ready,
    storage: adapter.scheme === 'safeStorage' ? 'os-keychain' : 'local-key-file',
    unlocked: function () { return unlocked; },
    status: function (envKey) {
      const saved = cache.geminiApiKey;
      const usingEnv = !saved && Boolean(envKey);
      const active = saved || (usingEnv ? envKey : '');
      return {
        gemini: saved ? 'saved' : usingEnv ? 'environment' : 'none',
        geminiHint: hintKey(active),
        hasEnvKey: Boolean(envKey),
        tekmetricEmail: maskEmail(cache.tekmetricEmail),
        hasTekmetricPassword: Boolean(cache.tekmetricPassword),
        storage: adapter.scheme === 'safeStorage' ? 'os-keychain' : 'local-key-file',
        locked: !unlocked,
      };
    },
    geminiKey: function (envKey) {
      return cache.geminiApiKey || envKey || '';
    },
    tekmetricLogin: function () {
      if (!cache.tekmetricEmail || !cache.tekmetricPassword) return null;
      return { email: cache.tekmetricEmail, password: cache.tekmetricPassword };
    },
    apply: function (patch) {
      return ready.then(async function () {
        if (!unlocked && fs.existsSync(filePath)) {
          return { ok: false, error: 'Saved secrets could not be unlocked on this computer. Remove the secrets file in the app data folder and enter them again.' };
        }
        if (Object.prototype.hasOwnProperty.call(patch, 'geminiApiKey')) {
          cache.geminiApiKey = patch.geminiApiKey || '';
        }
        if (Object.prototype.hasOwnProperty.call(patch, 'tekmetricEmail')) {
          cache.tekmetricEmail = patch.tekmetricEmail || '';
        }
        if (Object.prototype.hasOwnProperty.call(patch, 'tekmetricPassword')) {
          cache.tekmetricPassword = patch.tekmetricPassword || '';
        }
        await persist();
        return { ok: true };
      });
    },
  };
}

module.exports = {
  createLocalAes,
  createSecretStore,
  maskEmail,
  hintKey,
};
