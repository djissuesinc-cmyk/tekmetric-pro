'use strict';
// v2.5.0: pick the printer for silent prints. The choice is saved per PC in settings.json (printerName).
// '' (or no setting) means "System default": no deviceName is passed and Windows decides.

// printers: array from webContents.getPrintersAsync() ({ name, displayName, isDefault })
function resolvePrinter(saved, printers) {
  const want = String(saved || '').trim();
  if (!want) return { deviceName: undefined, label: 'System default', fellBack: false };
  const list = Array.isArray(printers) ? printers : [];
  const exact = list.find(p => p && p.name === want);
  if (exact) return { deviceName: exact.name, label: exact.displayName || exact.name, fellBack: false };
  const lower = want.toLowerCase();
  const loose = list.find(p => p && String(p.name).toLowerCase() === lower);
  if (loose) return { deviceName: loose.name, label: loose.displayName || loose.name, fellBack: false };
  return { deviceName: undefined, label: 'System default', fellBack: true, missing: want };
}

// Menu items: System default + every printer, plus the saved one flagged if it is not installed on this PC.
function printerMenuModel(saved, printers) {
  const want = String(saved || '').trim();
  const list = (Array.isArray(printers) ? printers : []).filter(p => p && p.name);
  const items = [{ name: '', label: 'System default', checked: !want }];
  let found = false;
  for (const p of list) {
    const checked = !!want && p.name === want;
    if (checked) found = true;
    items.push({ name: p.name, label: (p.displayName || p.name) + (p.isDefault ? ' (Windows default)' : ''), checked });
  }
  if (want && !found) items.push({ name: want, label: want + ' (not found on this PC, using default)', checked: true });
  return items;
}

module.exports = { resolvePrinter, printerMenuModel };
