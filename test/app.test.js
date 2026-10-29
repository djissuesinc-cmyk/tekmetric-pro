const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const test = require('node:test');

const text = require('../src/shared/text');
const validate = require('../src/main/validate');
const security = require('../src/main/security');
const diagnostics = require('../src/main/diagnostics');
const secrets = require('../src/main/secrets');
const store = require('../src/main/store');
const gemini = require('../src/main/gemini');
const { buildWorkOrderPdf } = require('../src/main/pdf');
const { PDFDocument } = require('pdf-lib');

test('auto-capitalizes after typing a sentence, not mid-word', function () {
  assert.strictEqual(text.autoCapitalize('brake noise. pads worn'), 'Brake noise. Pads worn');
  assert.strictEqual(text.autoCapitalize('already Good. fine'), 'Already Good. Fine');
  assert.strictEqual(text.autoCapitalize('hello\nworld'), 'Hello\nWorld');
  assert.strictEqual(text.autoCapitalize(''), '');
  assert.strictEqual(text.autoCapitalize(null), '');
});

test('money math stays in cents', function () {
  assert.strictEqual(text.dollarsToCents('19.99'), 1999);
  assert.strictEqual(text.dollarsToCents('$1,299.50'), 129950);
  assert.strictEqual(text.dollarsToCents('19.999'), null);
  assert.strictEqual(text.dollarsToCents('-5.00'), null);
  assert.strictEqual(text.dollarsToCents('abc'), null);
  assert.strictEqual(text.qtyToHundredths('2.5'), 250);
  assert.strictEqual(text.qtyToHundredths('0'), null);
  assert.strictEqual(text.lineTotalCents(250, 14900), 37250);
  assert.strictEqual(text.formatMoney(1999), '$19.99');
  assert.strictEqual(text.formatMoney(129950), '$1,299.50');
});

test('pdf text drops characters standard fonts cannot draw', function () {
  assert.strictEqual(text.sanitizeWinAnsi('Craig\u2019s \u2014 brake'), "Craig's - brake");
});

test('appointment and repair validation rejects bad and unsafe payloads', function () {
  const bad = validate.validateAppointment({ customer: 'A', vehicle: 'Car', service: 'Oil', date: '2026-02-31', time: '08:00' });
  assert.strictEqual(bad.ok, false);
  const proto = validate.validateRepair(JSON.parse('{"__proto__": {"polluted": true}, "customer": "A"}'));
  assert.strictEqual(proto.ok, false);
  const repair = validate.validateRepair({
    customer: 'Alex Morgan',
    phone: '416-555-0142',
    vehicle: '2018 Honda CR-V',
    plate: 'CLAT 104',
    vin: '',
    mileage: '98,420',
    concern: 'pulsation while braking.',
    status: 'in-progress',
    advisorComment: 'front rotors are low.',
    lineItems: [{ description: 'Front pads', qty: '1', unitPrice: '89.95' }],
  });
  assert.strictEqual(repair.ok, true);
  assert.strictEqual(repair.value.concern, 'Pulsation while braking.');
  assert.strictEqual(repair.value.advisorComment, 'Front rotors are low.');
  assert.strictEqual(repair.value.lineItems[0].unitCents, 8995);
  assert.strictEqual(repair.value.mileage, 98420);
  const key = validate.validateSecrets({ geminiApiKey: 'short' });
  assert.strictEqual(key.ok, false);
  const site = validate.validateSettings(Object.assign({}, store.DEFAULT_SETTINGS, { tekmetricUrl: 'https://evil.example/phish' }));
  assert.strictEqual(site.ok, false);
  const notTek = validate.validateSettings(Object.assign({}, store.DEFAULT_SETTINGS, { tekmetricUrl: 'https://nottekmetric.com' }));
  assert.strictEqual(notTek.ok, false);
});

test('local diagnostics work without a network or API key', function () {
  const empty = diagnostics.diagnoseLocal({ symptoms: '   ' });
  assert.strictEqual(empty.ok, false);
  const brakes = diagnostics.diagnoseLocal({
    vehicle: '2018 Honda CR-V',
    symptoms: 'Steering wheel pulsates when braking from highway speed.',
  });
  assert.strictEqual(brakes.ok, true);
  assert.ok(brakes.value.matches.includes('Brakes'));
  assert.ok(brakes.value.steps.length > 0);
  assert.ok(brakes.value.safety.length > 0);
});

test('secrets stay encrypted and out of the public shop state', async function () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tekmetric-'));
  const vault = secrets.createSecretStore({
    filePath: path.join(dir, 'secrets.json'),
    adapter: secrets.createLocalAes(path.join(dir, 'secret.key')),
  });
  const saved = await vault.apply({
    geminiApiKey: 'AIzaTESTKEY0123456789abcdef',
    tekmetricEmail: 'advisor@craigsleaside.com',
    tekmetricPassword: 'correct horse battery',
  });
  assert.strictEqual(saved.ok, true);
  const raw = fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8');
  assert.strictEqual(raw.includes('correct horse'), false);
  assert.strictEqual(raw.includes('AIzaTESTKEY'), false);
  const again = secrets.createSecretStore({
    filePath: path.join(dir, 'secrets.json'),
    adapter: secrets.createLocalAes(path.join(dir, 'secret.key')),
  });
  await again.ready;
  assert.strictEqual(again.tekmetricLogin().password, 'correct horse battery');
  assert.strictEqual(again.status('').gemini, 'saved');
  assert.strictEqual(again.status('').geminiHint.endsWith('cdef'), true);
  const shop = store.createStore(path.join(dir, 'shop.json'));
  const pub = JSON.stringify(shop.getPublic());
  assert.strictEqual(pub.includes('password'), false);
  assert.strictEqual(pub.includes('apiKey'), false);
  const toggled = await shop.toggleAppointment('apt-sample-1');
  assert.strictEqual(toggled.ok, true);
  const done = toggled.data.appointments.find(function (item) { return item.id === 'apt-sample-1'; });
  assert.strictEqual(done.done, false);
  fs.writeFileSync(path.join(dir, 'broken.json'), '{');
  const recovered = store.createStore(path.join(dir, 'broken.json'));
  assert.match(recovered.getPublic().notice, /damaged/);
  assert.ok(fs.readdirSync(dir).some(function (name) { return name.includes('corrupt'); }));
});

test('work order PDF builds with and without lines', async function () {
  const repair = validate.validateRepair({
    id: 'ro-1',
    number: 4821,
    customer: 'Alex Morgan',
    phone: '416-555-0142',
    vehicle: '2018 Honda CR-V',
    concern: 'Steering wheel shakes when braking.',
    status: 'in-progress',
    advisorComment: 'Craig\u2019s note \u2014 rotors are low.',
    lineItems: [{ description: 'Front rotors', qty: '2', unitPrice: '124.50' }],
  }).value;
  const bytes = await buildWorkOrderPdf(repair, store.DEFAULT_SETTINGS);
  assert.ok(bytes.slice(0, 5).toString() === '%PDF-');
  const doc = await PDFDocument.load(bytes);
  assert.ok(doc.getPageCount() >= 1);
  const empty = Object.assign({}, repair, { lineItems: [] });
  const emptyBytes = await buildWorkOrderPdf(empty, store.DEFAULT_SETTINGS);
  assert.strictEqual(emptyBytes.slice(0, 5).toString(), '%PDF-');
});

test('gemini errors stay generic and prompts do not ask for invented prices', async function () {
  assert.match(gemini.mapGeminiError(new Error('API key not valid')), /rejected the API key/);
  assert.match(gemini.mapGeminiError(new Error('ENOTFOUND')), /Could not reach Gemini/);
  const prompt = gemini.buildCommentPrompt({
    vehicle: '2018 Honda CR-V',
    concern: 'Pulsation',
    status: 'in-progress',
    lineItems: [],
    advisorComment: '',
  }, 'shorter');
  assert.match(prompt, /Do not invent prices/);
  const result = await gemini.generateText({
    apiKey: 'AIzaTESTKEY0123456789abcdef',
    model: 'gemini-2.5-flash',
    prompt: 'hello',
    client: { models: { generateContent: async function () { return { text: '```\nBrake noise is confirmed.\n```' }; } } },
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.text, 'Brake noise is confirmed.');
  const missing = await gemini.generateText({ apiKey: '', prompt: 'x' });
  assert.strictEqual(missing.ok, false);
});

test('electron security flags cannot be overridden and autofill cannot break out', function () {
  const prefs = security.secureWebPreferences({
    nodeIntegration: true,
    contextIsolation: false,
    webSecurity: false,
    preload: '/tmp/preload.js',
  });
  assert.strictEqual(prefs.nodeIntegration, false);
  assert.strictEqual(prefs.contextIsolation, true);
  assert.strictEqual(prefs.sandbox, true);
  assert.strictEqual(prefs.webSecurity, true);
  assert.strictEqual(prefs.webviewTag, false);
  assert.strictEqual(prefs.preload, '/tmp/preload.js');
  assert.strictEqual(security.isTekmetricLoginHost('https://shop.tekmetric.com/login'), true);
  assert.strictEqual(security.isTekmetricLoginHost('https://shop.tekmetric.com.evil.com/'), false);
  assert.strictEqual(security.isTekmetricLoginHost('http://shop.tekmetric.com/'), false);
  assert.strictEqual(security.isTekmetricSite('https://nottekmetric.com/'), false);
  assert.strictEqual(security.isTekmetricSite('https://shop.tekmetric.com/'), true);
  const script = security.buildAutofillScript('a"@b.com', 'p\');alert(1);//</script>');
  assert.doesNotThrow(function () { new vm.Script(script); });
  assert.strictEqual(script.includes('return { password'), false);
  const main = fs.readFileSync(path.join(__dirname, '../src/main/main.js'), 'utf8');
  assert.match(main, /partition: 'persist:tekmetric'/);
  assert.doesNotMatch(main, /nodeIntegration:\s*true/);
  assert.doesNotMatch(main, /contextIsolation:\s*false/);
  assert.match(security.friendlyUpdateError(new Error('404 no published releases')), /No published update/);
  assert.strictEqual(security.redact('key AIzaTESTKEY0123456789 secret').includes('AIzaTESTKEY'), false);
});

test('packaged files do not include env secrets', function () {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
  const files = pkg.build.files.join('\n');
  assert.match(files, /!\*\*\/\.env/);
  const example = fs.readFileSync(path.join(__dirname, '../.env.example'), 'utf8');
  assert.doesNotMatch(example, /AIza[0-9A-Za-z\-_]{10,}/);
  const root = path.join(__dirname, '..');
  const skip = new Set(['node_modules', 'dist', '.git', 'test']);
  function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      if (skip.has(name)) continue;
      const full = path.join(dir, name);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) walk(full);
      else if (name !== 'package-lock.json' && /\.(js|json|html|css|md|example)$/.test(name)) {
        const body = fs.readFileSync(full, 'utf8');
        assert.doesNotMatch(body, /AIza[0-9A-Za-z\-_]{20,}/, full);
      }
    }
  }
  walk(root);
});
