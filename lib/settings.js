'use strict';

const DEFAULT_PIN = 'leaside';

function defaultPresets() {
    return [
        'LOF, 30 POINT INSPECTION + BRAKE INSPECTION',
        '30 POINT INSPECTION',
        'TIRE ROTATION WITH SERVICE',
        'TIRE REPAIR',
        'SEASONAL TIRE CHANGE',
        'TIRE STORAGE',
        'SAFETY',
        'Alignment',
        'Krown Rust Proofing',
        'Krown Detailing',
        'Level 1 Scan (Document and Clear Codes)',
        'Level 2 / 3 Scan (Documents Codes, In-depth Diagnostics and trouble shooting + Clearing Codes)',
        'A.V.R. (Diagnostics and trouble shooting)'
    ];
}

function defaultSettings() {
    return {
        darkMode: false,
        autoCaps: true,
        hidePremium: true,
        showSidebar: true,
        apiKey: '',
        presets: defaultPresets()
    };
}

function cleanPresetList(value) {
    if (!Array.isArray(value)) return [];
    return value
        .filter((item) => typeof item === 'string')
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
}

function normalizeSettings(raw) {
    const base = defaultSettings();
    const source = raw && typeof raw === 'object' ? raw : {};
    const presets = cleanPresetList(source.presets);
    const adminPin = typeof source.adminPin === 'string' ? source.adminPin.trim() : '';
    const settings = {
        darkMode: typeof source.darkMode === 'boolean' ? source.darkMode : base.darkMode,
        autoCaps: typeof source.autoCaps === 'boolean' ? source.autoCaps : base.autoCaps,
        hidePremium: typeof source.hidePremium === 'boolean' ? source.hidePremium : base.hidePremium,
        showSidebar: typeof source.showSidebar === 'boolean' ? source.showSidebar : base.showSidebar,
        apiKey: typeof source.apiKey === 'string' ? source.apiKey.trim() : '',
        presets: presets.length > 0 ? presets : base.presets.slice()
    };
    if (adminPin) settings.adminPin = adminPin;
    return settings;
}

function publicSettings(settings) {
    const safe = normalizeSettings(settings);
    return {
        darkMode: safe.darkMode,
        autoCaps: safe.autoCaps,
        hidePremium: safe.hidePremium,
        showSidebar: safe.showSidebar,
        presets: safe.presets.slice()
    };
}

function expectedPin(settings) {
    const pin = settings && typeof settings.adminPin === 'string' ? settings.adminPin.trim() : '';
    return pin || DEFAULT_PIN;
}

function pdfSafe(value) {
    return String(value || '').replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, ' ').trim();
}

function safeResourceName(requestUrl) {
    const raw = String(requestUrl || '').replace(/^local-resource:\/\//, '');
    let name = raw.split('?')[0].split('#')[0];
    try {
        name = decodeURIComponent(name);
    } catch (err) {
        return '';
    }
    name = name.replace(/\\/g, '/').split('/').pop();
    return name === 'logo.png' ? name : '';
}

function menuJobLabel(job) {
    const text = String(job || '');
    if (text.length > 20) return 'Insert: ' + text.slice(0, 20) + '...';
    return 'Insert: ' + text;
}

function redactSecrets(text, secrets) {
    let clean = String(text || '');
    (secrets || []).forEach((secret) => {
        if (typeof secret === 'string' && secret.length >= 4) {
            clean = clean.split(secret).join('[hidden]');
        }
    });
    return clean;
}

module.exports = {
    DEFAULT_PIN,
    defaultPresets,
    defaultSettings,
    normalizeSettings,
    publicSettings,
    expectedPin,
    pdfSafe,
    safeResourceName,
    menuJobLabel,
    redactSecrets
};
