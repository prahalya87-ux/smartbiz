// Vite config for the SmartBiz client.
// Key job: start the Express API (server/server.js) automatically whenever the
// Vite dev server starts, and stop it when Vite stops — so the app never shows
// "server unavailable" because the backend was forgotten.
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiEntry = path.resolve(__dirname, '..', 'server', 'server.js');
const apiCwd = path.resolve(__dirname, '..', 'server');

function smartbizApi() {
  let api = null;
  const stopApi = () => {
    if (!api) return;
    const child = api;
    api = null;
    if (process.platform === 'win32') {
      // plain .kill() cannot stop a Windows console child; kill its whole tree
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      child.kill('SIGTERM');
    }
  };
  return {
    name: 'smartbiz-api',
    apply: 'serve', // dev server only, never during build
    configureServer() {
      if (api) return;
      api = spawn(process.execPath, [apiEntry], { cwd: apiCwd, stdio: 'inherit' });
      api.on('exit', (code) => {
        api = null;
        // EADDRINUSE just means the API is already running elsewhere — fine.
        if (code && code !== 0) console.warn(`[smartbiz] API process exited (code ${code}). If the port is already in use, another API instance is running.`);
      });
    },
    buildEnd: stopApi,
    closeBundle: stopApi,
  };
}

export default {
  plugins: [smartbizApi()],
};
