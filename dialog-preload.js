'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('leaside', {
    submitPin: (pin) => ipcRenderer.send('auth-attempt', pin),
    onAuthFailed: (callback) => {
        ipcRenderer.on('auth-failed', () => callback());
    },
    settingsForm: () => ipcRenderer.invoke('settings:form'),
    saveSettings: (payload) => ipcRenderer.invoke('settings:save', payload),
    getUsers: () => ipcRenderer.invoke('users:get'),
    saveUsers: (text) => ipcRenderer.invoke('users:save', text),
    getPresets: () => ipcRenderer.invoke('presets:get'),
    savePresets: (text) => ipcRenderer.invoke('presets:save', text),
    restart: () => ipcRenderer.send('restart-app')
});
