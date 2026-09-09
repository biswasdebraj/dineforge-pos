const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('foodnest', {
  getApiBase: async () => {
    const port = await ipcRenderer.invoke('get-api-port');
    return `http://127.0.0.1:${port}`;
  },
  onBackendRestarted: (callback) => {
    ipcRenderer.on('backend-restarted', () => callback());
  },
});
