const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('tekproAbout', {
    openBugReport: () => ipcRenderer.send('about-open-bug-report')
});
