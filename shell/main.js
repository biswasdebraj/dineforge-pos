const { app, BrowserWindow } = require('electron');
const path = require('path');
const net = require('net');
const http = require('http');
const { spawn } = require('child_process');

let phpProcess = null;

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

function startPhpServer(port) {
  const docroot = path.join(__dirname, '..', 'backend', 'public');
  const php = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', docroot], {
    cwd: docroot,
    windowsHide: true,
  });

  php.stdout.on('data', (d) => console.log(`[php] ${d}`.trim()));
  php.stderr.on('data', (d) => console.error(`[php] ${d}`.trim()));
  php.on('exit', (code) => console.log(`[php] exited with code ${code}`));

  return php;
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

async function createWindow() {
  const apiPort = await getFreePort();
  process.env.FOODNEST_API_PORT = String(apiPort);

  phpProcess = startPhpServer(apiPort);
  await waitForServer(apiPort);

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, '..', 'frontend', 'src', 'index.html'));
}

app.whenReady().then(createWindow);

app.on('before-quit', () => {
  if (phpProcess) phpProcess.kill();
});

app.on('window-all-closed', () => {
  if (phpProcess) phpProcess.kill();
  if (process.platform !== 'darwin') app.quit();
});
