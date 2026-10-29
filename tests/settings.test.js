const test = require('node:test');
const assert = require('node:assert/strict');
const shop = require('../lib/settings');

test('a short custom job list is kept', () => {
    const settings = shop.normalizeSettings({
        presets: ['Oil change', 'Brakes', 'Tires']
    });
    assert.deepEqual(settings.presets, ['Oil change', 'Brakes', 'Tires']);
});

test('missing job list gets the shop defaults', () => {
    const settings = shop.normalizeSettings({});
    assert.equal(settings.presets.length > 7, true);
    assert.equal(settings.autoCaps, true);
    assert.equal(settings.hidePremium, true);
    assert.equal(settings.darkMode, false);
});

test('the shop page is not given the Google key or the PIN', () => {
    const view = shop.publicSettings({
        apiKey: 'secret-key',
        adminPin: 'shop-pin',
        autoCaps: false,
        presets: ['Safety']
    });
    assert.equal(view.apiKey, undefined);
    assert.equal(view.adminPin, undefined);
    assert.equal(view.autoCaps, false);
    assert.deepEqual(view.presets, ['Safety']);
});

test('the original PIN still works until a new one is saved', () => {
    assert.equal(shop.expectedPin({}), 'leaside');
    assert.equal(shop.expectedPin({ adminPin: 'baydoor' }), 'baydoor');
});

test('print text keeps normal letters and drops symbols the PDF font cannot draw', () => {
    assert.equal(shop.pdfSafe("O'Brien — Civic"), "O'Brien Civic");
    assert.equal(shop.safeResourceName('local-resource://logo.png'), 'logo.png');
    assert.equal(shop.safeResourceName('local-resource://../../.env'), '');
});

test('menu labels stay readable for short jobs', () => {
    assert.equal(shop.menuJobLabel('SAFETY'), 'Insert: SAFETY');
    assert.equal(shop.menuJobLabel('Level 1 Scan (Document and Clear Codes)'), 'Insert: Level 1 Scan (Docume...');
});

test('error text does not keep a saved key', () => {
    const message = shop.redactSecrets('request failed for secret-key', ['secret-key']);
    assert.equal(message.includes('secret-key'), false);
});
