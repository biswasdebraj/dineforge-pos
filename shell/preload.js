const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dineforge', {
  getApiBase: async () => {
    const port = await ipcRenderer.invoke('get-api-port');
    return `http://127.0.0.1:${port}`;
  },
  onBackendRestarted: (callback) => {
    ipcRenderer.on('backend-restarted', () => callback());
  },
  testPrint: () => ipcRenderer.invoke('test-print'),
  openCashDrawer: () => ipcRenderer.invoke('open-cash-drawer'),
  printReceipt: (orderId) => ipcRenderer.invoke('print-receipt', orderId),
  printKOT: (orderId, itemIds) => ipcRenderer.invoke('print-kot', orderId, itemIds),
  getLanInfo: () => ipcRenderer.invoke('get-lan-info'),
});
