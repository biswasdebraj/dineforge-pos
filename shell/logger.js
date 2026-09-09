const fs = require('fs');
const path = require('path');
const { app } = require('electron');

let logFile = null;
let logDir = null;

function ensureLogFile() {
  if (logFile) return logFile;
  logDir = path.join(app.getPath('userData'), 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  logFile = path.join(logDir, 'foodnest.log');
  return logFile;
}

function write(level, message) {
  const file = ensureLogFile();
  const line = `[${new Date().toISOString()}] [${level}] ${message}`;
  fs.appendFile(file, line + '\n', () => {});
  if (level === 'ERROR' || level === 'WARN') {
    console.error(line);
  } else {
    console.log(line);
  }
}

module.exports = {
  info: (msg) => write('INFO', msg),
  warn: (msg) => write('WARN', msg),
  error: (msg) => write('ERROR', msg),
  getLogDir: () => {
    ensureLogFile();
    return logDir;
  },
};
