const { app, BrowserWindow, Tray, Menu, nativeImage, shell, dialog, ipcMain } = require('electron');
const path = require('path');
const net = require('net');
const http = require('http');
const { spawn } = require('child_process');
const logger = require('./logger');
const printerModule = require('./printer');

const ICON_PATH = path.join(__dirname, 'assets', 'icon.png');
const MAX_RESTART_ATTEMPTS = 5;

let phpProcess = null;
let mainWindow = null;
let tray = null;
let currentApiPort = null;
let restartAttempts = 0;
let isQuitting = false;

process.on('uncaughtException', (err) => {
  logger.error(`Uncaught exception: ${err.stack || err.message}`);
});
process.on('unhandledRejection', (reason) => {
  logger.error(`Unhandled rejection: ${reason}`);
});

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

function spawnPhpProcess(port) {
  const docroot = path.join(__dirname, '..', 'backend', 'public');
  const child = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', docroot], {
    cwd: docroot,
    windowsHide: true,
  });

  child.stdout.on('data', (d) => logger.info(`[php] ${d}`.trim()));
  child.stderr.on('data', (d) => {
    // php -S writes its normal request access log to stderr, not just
    // real errors — only flag lines that look like an actual problem.
    const msg = `[php] ${d}`.trim();
    if (/error|warning|fatal/i.test(msg)) {
      logger.warn(msg);
    } else {
      logger.info(msg);
    }
  });

  return child;
}

function waitForServer(port, retries = 30) {
  return new Promise((resolve, reject) => {
    const tryOnce = (attempt) => {
      http
        .get(`http://127.0.0.1:${port}/api/ping`, (res) => {
          res.resume();
          resolve();
        })
        .on('error', () => {
          if (attempt >= retries) {
            reject(new Error('PHP server did not start in time'));
            return;
          }
          setTimeout(() => tryOnce(attempt + 1), 200);
        });
    };
    tryOnce(0);
  });
}

async function launchPhp() {
  const port = await getFreePort();
  const child = spawnPhpProcess(port);
  phpProcess = child;

  child.on('exit', (code, signal) => {
    logger.warn(`PHP backend exited (code=${code}, signal=${signal})`);
    if (isQuitting || phpProcess !== child) {
      // Either a deliberate shutdown, or this listener belongs to an
      // already-superseded process (manual restart) — do nothing.
      return;
    }

    if (restartAttempts >= MAX_RESTART_ATTEMPTS) {
      logger.error('PHP backend crashed too many times; giving up automatic restarts');
      dialog.showErrorBox(
        'FoodNest POS — Backend Error',
        'The backend process stopped responding and could not be restarted automatically.\n\n' +
          'Check the logs (tray menu → Open Logs Folder) and restart the app.'
      );
      return;
    }

    restartAttempts += 1;
    const delay = 1000 * restartAttempts;
    logger.info(`Restarting PHP backend in ${delay}ms (attempt ${restartAttempts}/${MAX_RESTART_ATTEMPTS})`);
    setTimeout(() => {
      launchPhp().catch((err) => logger.error(`Auto-restart failed: ${err.message}`));
    }, delay);
  });

  await waitForServer(port);
  currentApiPort = port;
  restartAttempts = 0;
  logger.info(`PHP backend ready on port ${port}`);
  return port;
}

async function restartBackend() {
  logger.info('Manual backend restart requested');
  if (phpProcess) {
    phpProcess.removeAllListeners('exit');
    phpProcess.kill();
  }
  await launchPhp();
  if (mainWindow) {
    mainWindow.webContents.send('backend-restarted');
  }
}

function buildAppMenu() {
  return Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [
        { label: 'Restart Backend', click: () => restartBackend().catch((e) => logger.error(e.message)) },
        { label: 'Open Logs Folder', click: () => shell.openPath(logger.getLogDir()) },
        { type: 'separator' },
        {
          label: 'Quit',
          accelerator: 'CmdOrCtrl+Q',
          click: () => {
            isQuitting = true;
            app.quit();
          },
        },
      ],
    },
    {
      label: 'View',
      submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'togglefullscreen' }],
    },
  ]);
}

function createTray() {
  const icon = nativeImage.createFromPath(ICON_PATH).resize({ width: 16, height: 16 });
  const t = new Tray(icon);
  t.setToolTip('FoodNest POS');
  t.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: 'Show FoodNest POS',
        click: () => {
          mainWindow.show();
          mainWindow.focus();
        },
      },
      { type: 'separator' },
      { label: 'Restart Backend', click: () => restartBackend().catch((e) => logger.error(e.message)) },
      { label: 'Open Logs Folder', click: () => shell.openPath(logger.getLogDir()) },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ])
  );
  t.on('click', () => {
    mainWindow.show();
    mainWindow.focus();
  });
  return t;
}

async function createWindow() {
  await launchPhp();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    icon: ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'frontend', 'src', 'index.html'));
}

ipcMain.handle('get-api-port', () => currentApiPort);

function fetchJson(path) {
  return new Promise((resolve, reject) => {
    http
      .get(`http://127.0.0.1:${currentApiPort}${path}`, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(err);
          }
        });
      })
      .on('error', reject);
  });
}

ipcMain.handle('test-print', async () => {
  try {
    const settings = await fetchJson('/api/settings');
    return await printerModule.testPrint(settings);
  } catch (err) {
    logger.error(`test-print failed: ${err.message}`);
    return { success: false, message: err.message };
  }
});

ipcMain.handle('open-cash-drawer', async () => {
  try {
    const settings = await fetchJson('/api/settings');
    return await printerModule.openCashDrawer(settings);
  } catch (err) {
    logger.error(`open-cash-drawer failed: ${err.message}`);
    return { success: false, message: err.message };
  }
});

ipcMain.handle('print-receipt', async (event, orderId) => {
  try {
    const [order, settings] = await Promise.all([fetchJson(`/api/orders/${orderId}`), fetchJson('/api/settings')]);
    return await printerModule.printReceipt(settings, order);
  } catch (err) {
    logger.error(`print-receipt failed: ${err.message}`);
    return { success: false, message: err.message };
  }
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(buildAppMenu());
    tray = createTray();
    createWindow().catch((err) => {
      logger.error(`Failed to start app: ${err.message}`);
      dialog.showErrorBox('FoodNest POS — Startup Error', err.message);
      app.quit();
    });
  });

  app.on('before-quit', () => {
    isQuitting = true;
    if (phpProcess) {
      phpProcess.removeAllListeners('exit');
      phpProcess.kill();
    }
  });

  app.on('window-all-closed', () => {
    // Windows/Linux: window close hides to tray instead (see mainWindow 'close'
    // handler), so this only fires on macOS-style full teardown or explicit quit.
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
