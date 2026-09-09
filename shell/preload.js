const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('foodnest', {
  apiBase: `http://127.0.0.1:${process.env.FOODNEST_API_PORT}`,
});
