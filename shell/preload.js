const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dineforge', {
  getApiBase: async () => {
    const port = await ipcRenderer.invoke('get-api-port');
    return `http://127.0.0.1:${port}`;
  },
  onBackendRestarted: (callback) => {
    ipcRenderer.on('backend-restarted', () => callback());
  },
  // token is the caller's own X-Session-Token (from sessionStorage) — GET
  // /api/orders/{id} requires a valid role session, so the main process
  // needs it passed through to authenticate its own fetch on our behalf.
  testPrint: (token) => ipcRenderer.invoke('test-print', token),
  listUsbPrinters: () => ipcRenderer.invoke('list-usb-printers'),
  openCashDrawer: (token) => ipcRenderer.invoke('open-cash-drawer', token),
  printReceipt: (orderId, token) => ipcRenderer.invoke('print-receipt', orderId, token),
  printKOT: (orderId, itemIds, token) => ipcRenderer.invoke('print-kot', orderId, itemIds, token),
  getLanInfo: () => ipcRenderer.invoke('get-lan-info'),
});
