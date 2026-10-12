// Starts the SmartBiz API server and the Vite client together.
// Usage: npm run dev [-- --host 127.0.0.1 --port 5173]
// Host/port arguments are forwarded to Vite; the API always runs on its own
// configured port (default 5000).
const { spawn } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const host = argValue('host', 'localhost');
const port = argValue('port', '5173');

const isWin = process.platform === 'win32';
const viteBin = path.join(root, 'client', 'node_modules', 'vite', 'bin', 'vite.js');

const children = [
  spawn(process.execPath, [path.join(root, 'server', 'server.js')], {
    cwd: path.join(root, 'server'),
    stdio: 'inherit',
  }),
  spawn(process.execPath, [viteBin, '--host', host, '--port', port], {
    cwd: path.join(root, 'client'),
    stdio: 'inherit',
  }),
];

let shuttingDown = false;
const shutdown = (code) => {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (isWin) spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill('SIGTERM');
  }
  process.exit(code);
};

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
for (const child of children) {
  child.on('exit', (code) => {
    if (!shuttingDown) {
      console.error(`A dev process exited (code ${code}). Shutting down.`);
      shutdown(code || 1);
    }
  });
}
