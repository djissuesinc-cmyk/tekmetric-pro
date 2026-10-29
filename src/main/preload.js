const { contextBridge, ipcRenderer } = require('electron');

const VIEWS = new Set(['dashboard', 'calendar', 'repairs', 'diagnostics', 'settings']);

function subscribe(channel, callback) {
  if (typeof callback !== 'function') return function () {};
  const listener = function (_event, payload) {
    callback(payload);
  };
  ipcRenderer.on(channel, listener);
  return function () {
    ipcRenderer.removeListener(channel, listener);
  };
}

contextBridge.exposeInMainWorld('tekmetric', {
  getState: function () { return ipcRenderer.invoke('state:get'); },
  dismissNotice: function () { return ipcRenderer.invoke('notice:dismiss'); },
  saveSettings: function (settings) { return ipcRenderer.invoke('settings:save', settings); },
  saveSecrets: function (secrets) { return ipcRenderer.invoke('secrets:save', secrets); },
  saveAppointment: function (appointment) { return ipcRenderer.invoke('appointment:save', appointment); },
  toggleAppointment: function (id) { return ipcRenderer.invoke('appointment:toggle', id); },
  deleteAppointment: function (id) { return ipcRenderer.invoke('appointment:delete', id); },
  saveRepair: function (repair) { return ipcRenderer.invoke('repair:save', repair); },
  deleteRepair: function (id) { return ipcRenderer.invoke('repair:delete', id); },
  clearSamples: function () { return ipcRenderer.invoke('repair:clear-samples'); },
  draftComment: function (payload) { return ipcRenderer.invoke('ai:comment', payload); },
  diagnose: function (payload) { return ipcRenderer.invoke('ai:diagnose', payload); },
  exportPdf: function (id) { return ipcRenderer.invoke('pdf:export', id); },
  checkForUpdates: function () { return ipcRenderer.invoke('updates:check'); },
  downloadUpdate: function () { return ipcRenderer.invoke('updates:download'); },
  installUpdate: function () { return ipcRenderer.invoke('updates:install'); },
  openTekmetric: function () { return ipcRenderer.invoke('tekmetric:open'); },
  onNavigate: function (callback) {
    return subscribe('nav', function (view) {
      if (VIEWS.has(view)) callback(view);
    });
  },
  onUpdate: function (callback) {
    return subscribe('update', callback);
  },
});
