const { app, BrowserWindow, Tray, Menu, nativeImage, shell, dialog, ipcMain } = require('electron');
const path = require('path');
const net = require('net');
const http = require('http');
const os = require('os');
const { spawn } = require('child_process');
const QRCode = require('qrcode');
const { autoUpdater } = require('electron-updater');
const logger = require('./logger');
const printerModule = require('./printer');

const ICON_PATH = path.join(__dirname, 'assets', 'icon.png');
const MAX_RESTART_ATTEMPTS = 5;

// Packaged builds get backend/, frontend/, and the bundled PHP runtime
// copied into resources/ (see electron-builder's extraResources config in
// package.json) since they live outside shell/ in the repo. Dev mode reads
// them straight from the sibling source directories instead.
function resourcePath(...segments) {
  const base = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..');
  return path.join(base, ...segments);
}

function getPhpBinaryPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'php', 'php.exe')
    : path.join(__dirname, 'resources', 'php', 'php.exe');
}

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
  const docroot = resourcePath('backend', 'public');
  const phpBinary = getPhpBinaryPath();
  const phpIni = path.join(path.dirname(phpBinary), 'php.ini');
  const dataDir = path.join(app.getPath('userData'), 'data');
  const frontendDir = resourcePath('frontend', 'src');

  // 0.0.0.0 (not 127.0.0.1) so LAN devices — waiters/kitchen tablets
  // scanning the QR code — can reach it too, not just this machine. Every
  // protected route already requires a valid role session regardless of
  // which interface the request arrived on (see backend/src/support/guard.php),
  // so this doesn't weaken anything that matters.
  // index.php is passed explicitly as the router script — without one, PHP's
  // built-in server only falls through to index.php for extensionless URLs
  // (like /api/ping); a URL with a file extension (/styles.css, /js/app.js)
  // that doesn't exist under docroot gets a 404 straight from the PHP server
  // itself, never reaching serve_static_frontend() in index.php.
  const routerScript = path.join(docroot, 'index.php');
  const child = spawn(phpBinary, ['-c', phpIni, '-S', `0.0.0.0:${port}`, '-t', docroot, routerScript], {
    cwd: docroot,
    windowsHide: true,
    env: { ...process.env, DINEFORGE_DATA_DIR: dataDir, DINEFORGE_FRONTEND_DIR: frontendDir },
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
        'DineForge POS — Backend Error',
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

// Update plumbing: checks GitHub Releases on biswasdebraj/dineforge-pos (see
// the "publish" block in package.json). This only works once a release with
// installer + latest.yml has actually been published there (`npm run
// release`, with GH_TOKEN set) — until then, checkForUpdates() just resolves
// with "no update available" or a harmless 404, never installed silently.
let manualUpdateCheck = false;

function setupAutoUpdater() {
  autoUpdater.logger = {
    info: (msg) => logger.info(`[updater] ${msg}`),
    warn: (msg) => logger.warn(`[updater] ${msg}`),
    error: (msg) => logger.error(`[updater] ${msg}`),
    debug: () => {},
  };
  // Install automatically on quit even if the user dismisses the "restart
  // now" prompt below — a POS terminal that's rarely explicitly restarted
  // should still end up current the next time it's closed.
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-not-available', () => {
    if (manualUpdateCheck) {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'DineForge POS',
        message: "You're up to date.",
      });
    }
    manualUpdateCheck = false;
  });

  autoUpdater.on('error', (err) => {
    logger.warn(`Update check failed: ${err.message}`);
    // A background check finding no releases yet (404) is expected right now
    // and shouldn't alarm anyone at a live terminal — only surface errors
    // when someone explicitly asked via "Check for Updates...".
    if (manualUpdateCheck) {
      dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: 'DineForge POS',
        message: 'Could not check for updates.',
        detail: err.message,
      });
    }
    manualUpdateCheck = false;
  });

  autoUpdater.on('update-downloaded', (info) => {
    manualUpdateCheck = false;
    dialog
      .showMessageBox(mainWindow, {
        type: 'info',
        title: 'Update ready',
        message: `DineForge POS ${info.version} has been downloaded.`,
        detail: 'Restart now to install it, or it will install automatically the next time you quit.',
        buttons: ['Restart Now', 'Later'],
        defaultId: 0,
      })
      .then(({ response }) => {
        if (response === 0) {
          isQuitting = true;
          autoUpdater.quitAndInstall();
        }
      });
  });
}

function checkForUpdates(manual = false) {
  if (!app.isPackaged) {
    if (manual) {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'DineForge POS',
        message: 'Updates are only available in the installed app, not in development.',
      });
    }
    return;
  }
  manualUpdateCheck = manual;
  autoUpdater.checkForUpdates().catch((err) => logger.warn(`checkForUpdates failed: ${err.message}`));
}

function buildAppMenu() {
  return Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [
        { label: 'Restart Backend', click: () => restartBackend().catch((e) => logger.error(e.message)) },
        { label: 'Check for Updates...', click: () => checkForUpdates(true) },
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
  t.setToolTip('DineForge POS');
  t.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: 'Show DineForge POS',
        click: () => {
          mainWindow.show();
          mainWindow.focus();
        },
      },
      { type: 'separator' },
      { label: 'Restart Backend', click: () => restartBackend().catch((e) => logger.error(e.message)) },
      { label: 'Check for Updates...', click: () => checkForUpdates(true) },
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

  mainWindow.loadFile(resourcePath('frontend', 'src', 'index.html'));
}

ipcMain.handle('get-api-port', () => currentApiPort);

function getLanIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return null;
}

ipcMain.handle('get-lan-info', async () => {
  const ip = getLanIp();
  if (!ip || !currentApiPort) {
    return { available: false };
  }
  const url = `http://${ip}:${currentApiPort}/`;
  try {
    const qrDataUrl = await QRCode.toDataURL(url, { margin: 1, width: 240 });
    return { available: true, url, qrDataUrl };
  } catch (err) {
    logger.error(`QR code generation failed: ${err.message}`);
    return { available: false, url };
  }
});

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

ipcMain.handle('print-kot', async (event, orderId, itemIds) => {
  try {
    const [order, settings, tables] = await Promise.all([
      fetchJson(`/api/orders/${orderId}`),
      fetchJson('/api/settings'),
      fetchJson('/api/tables'),
    ]);
    const table = tables.find((t) => t.id === order.table_id);
    return await printerModule.printKOT(settings, { ...order, table_label: table?.label }, itemIds);
  } catch (err) {
    logger.error(`print-kot failed: ${err.message}`);
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
    setupAutoUpdater();
    createWindow()
      .then(() => checkForUpdates(false))
      .catch((err) => {
        logger.error(`Failed to start app: ${err.message}`);
        dialog.showErrorBox('DineForge POS — Startup Error', err.message);
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
