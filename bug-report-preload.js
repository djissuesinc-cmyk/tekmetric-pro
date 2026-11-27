const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('tekproBug', {
    create: (payload) => ipcRenderer.invoke('bug-report-create', payload),
    cancel: () => ipcRenderer.send('bug-report-cancel')
});
