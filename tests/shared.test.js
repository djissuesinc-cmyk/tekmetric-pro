const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const sharedSource = fs.readFileSync(path.join(root, 'extension', 'shared.js'), 'utf8');
eval(sharedSource);
const api = globalThis.TekmetricPro;

function control(partial) {
  return Object.assign({
    tagName: 'TEXTAREA',
    type: '',
    name: '',
    id: '',
    disabled: false,
    readOnly: false,
    value: 'hello',
    getAttribute: function (key) {
      if (key === 'autocomplete') return this.autocomplete || '';
      if (key === 'inputmode') return '';
      if (key === 'aria-label') return this.ariaLabel || '';
      if (key === 'type') return this.type;
      return '';
    }
  }, partial);
}

function nodeWith(paths, labels) {
  return {
    querySelectorAll: function (selector) {
      if (selector.indexOf('path') !== -1) {
        return paths.map(function (drawn) {
          return { getAttribute: function () { return drawn; } };
        });
      }
      return labels.map(function (text) {
        return { textContent: text };
      });
    }
  };
}

test('shop hosts stay limited to Tekmetric shop sites', function () {
  assert.equal(api.isShopHost('shop.tekmetric.com'), true);
  assert.equal(api.isShopHost('sandbox.tekmetric.com'), true);
  assert.equal(api.isShopHost('shop.tekmetric.com.evil.test'), false);
  assert.equal(api.isShopHost('example.com'), false);
});

test('login help only runs on the sign-in page and never retries after one try', function () {
  const settings = {
    autoFillLogin: true,
    autoPressSignIn: true,
    email: 'tech@example.com',
    password: 'local-only'
  };
  assert.equal(api.shouldFillLogin('/', settings), true);
  assert.equal(api.shouldFillLogin('/login', settings), true);
  assert.equal(api.shouldFillLogin('/admin/shop/1', settings), false);
  assert.equal(api.shouldFillLogin('/second-step/otp', settings), false);
  assert.equal(api.shouldPressSignIn('/', settings, false), true);
  assert.equal(api.shouldPressSignIn('/', settings, true), false);
});

test('saved password is dropped unless sign-in fill is on', function () {
  const kept = api.normalizeSettings({
    autoFillLogin: true,
    email: 'tech@example.com',
    password: 'local-only',
    autoPressSignIn: true
  });
  assert.equal(kept.password, 'local-only');
  assert.equal(kept.autoPressSignIn, true);

  const dropped = api.normalizeSettings({
    autoFillLogin: false,
    email: 'tech@example.com',
    password: 'local-only',
    autoPressSignIn: true
  });
  assert.equal(dropped.password, '');
  assert.equal(dropped.autoPressSignIn, false);
  assert.equal(dropped.darkMode, true);
});

test('sentence capitalization waits for a finished sentence and skips secrets', function () {
  assert.equal(api.capitalizeSentences('brake pads worn. next visit'), 'Brake pads worn. Next visit');
  assert.equal(api.capitalizeSentences('i checked the fluid'), 'I checked the fluid');
  assert.equal(api.capitalizeSentences('U.S. army'), 'U.S. Army');
  assert.equal(api.isWritableNote(control({ value: 'pads' })), true);
  assert.equal(api.isWritableNote(control({
    tagName: 'INPUT',
    type: 'password',
    name: 'password',
    value: 'secret'
  })), false);
  assert.equal(api.isSensitiveControl(control({
    tagName: 'INPUT',
    type: 'text',
    name: 'email',
    autocomplete: 'username',
    value: 'tech@example.com'
  })), true);
});

test('finished appointments are the arrived check or the finished repair-order icon', function () {
  assert.equal(api.appointmentIsDone(nodeWith([api.ARRIVED_ICON_PATH], [])), true);
  assert.equal(api.appointmentIsDone(nodeWith([api.FINISHED_RO_ICON_PATH], [])), true);
  assert.equal(api.appointmentIsDone(nodeWith([], ['Arrived'])), true);
  assert.equal(api.appointmentIsDone(nodeWith([], ['Confirmed'])), false);
  assert.equal(api.appointmentIsDone(nodeWith([], ['Customer arrived early'])), false);
});

test('writing requests go to Google with the key in a header, not the address or the note', async function () {
  const calls = [];
  const fetchImpl = function (url, options) {
    calls.push({ url: url, options: options });
    if (String(url).indexOf('gemini-3.5-flash-lite') !== -1) {
      return Promise.resolve({
        ok: false,
        status: 404,
        json: function () { return Promise.resolve({ error: { message: 'model not found' } }); }
      });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: function () {
        return Promise.resolve({
          candidates: [{ content: { parts: [{ thought: true, text: 'hidden' }, { text: 'Check the pads.' }] } }]
        });
      }
    });
  };

  const result = await api.askGemini({
    geminiApiKey: 'secret-key',
    email: 'tech@example.com',
    password: 'local-only'
  }, 'diagnose', 'grinding from the front', fetchImpl);

  assert.equal(result.ok, true);
  assert.equal(result.text, 'Check the pads.');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url.indexOf('secret-key'), -1);
  assert.equal(calls[0].options.headers['x-goog-api-key'], 'secret-key');
  assert.equal(calls[0].options.body.indexOf('secret-key'), -1);
  assert.equal(calls[0].options.body.indexOf('local-only'), -1);
  assert.equal(calls[0].options.body.indexOf('tech@example.com'), -1);
  assert.match(calls[1].url, /gemini-2\.5-flash:generateContent$/);
});

test('missing key and empty notes fail before any network call', async function () {
  let called = false;
  const fetchImpl = function () {
    called = true;
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({}); } });
  };
  const missing = await api.askGemini({}, 'clean', 'hello');
  assert.equal(missing.ok, false);
  assert.match(missing.message, /Google Gemini key/);
  const empty = await api.askGemini({ geminiApiKey: 'abc' }, 'draft', '   ');
  assert.equal(empty.ok, false);
  assert.equal(called, false);
});

test('extension files do not shadow the browser top global or request every site', function () {
  const files = ['shared.js', 'content.js', 'background.js', 'popup.js'];
  files.forEach(function (file) {
    const source = fs.readFileSync(path.join(root, 'extension', file), 'utf8');
    assert.equal(/^\s*(const|let|var)\s+top\b/m.test(source), false, file);
    assert.equal(source.indexOf('update_url'), -1, file);
    assert.equal(source.indexOf('<all_urls>'), -1, file);
  });
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'extension', 'manifest.json'), 'utf8'));
  assert.equal(manifest.update_url, undefined);
  assert.deepEqual(manifest.host_permissions, [
    'https://shop.tekmetric.com/*',
    'https://sandbox.tekmetric.com/*',
    'https://generativelanguage.googleapis.com/*'
  ]);
  assert.equal(JSON.stringify(manifest).indexOf('eval'), -1);
});
