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
  let apiUrl = null;
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
    configResolved(config) {
      apiUrl = config.env.VITE_API_URL || 'http://localhost:5000/api';
    },
    async configureServer() {
      if (api) return;
      let target;
      try {
        target = new URL(apiUrl);
      } catch (err) {
        throw new Error(`[smartbiz] Invalid VITE_API_URL: ${apiUrl}`, { cause: err });
      }
      if (!['localhost', '127.0.0.1', '::1'].includes(target.hostname)) {
        console.info(`[smartbiz] Using remote API at ${target.origin}; local API auto-start skipped.`);
        return;
      }

      const apiPort = target.port || (target.protocol === 'https:' ? '443' : '80');
      const healthPath = `${target.pathname.replace(/\/+$/, '')}/health`;
      let occupied = false;
      try {
        const response = await fetch(`${target.protocol}//${target.host}${healthPath}`, {
          signal: AbortSignal.timeout(1500),
        });
        occupied = true;
        if (response.ok) {
          const health = await response.json();
          if (health.status === 'ok' && health.aiAssistant === 'local') {
            console.info(`[smartbiz] Reusing the SmartBiz API already running at ${target.origin}.`);
            return;
          }
          if (health.status === 'ok') {
            console.warn(`[smartbiz] The API on port ${apiPort} is an older SmartBiz version. Restart the backend; the current assistant does not need an AI API key.`);
          }
        }
      } catch (err) {
        if (err.cause?.code !== 'ECONNREFUSED') {
          occupied = true;
          console.warn(`[smartbiz] Could not verify the API on port ${apiPort}: ${err.message}`);
        }
      }
      if (occupied) {
        console.warn(`[smartbiz] Port ${apiPort} is occupied by a service that did not identify itself as the SmartBiz API. The API was not started; check VITE_API_URL.`);
        return;
      }

      api = spawn(process.execPath, [apiEntry], { cwd: apiCwd, stdio: 'inherit' });
      api.on('error', (err) => {
        api = null;
        console.error(`[smartbiz] Could not start the API process: ${err.message}`);
      });
      api.on('exit', (code) => {
        api = null;
        if (code && code !== 0) console.warn(`[smartbiz] API process exited with code ${code}.`);
      });
    },
    buildEnd: stopApi,
    closeBundle: stopApi,
  };
}

export default {
  plugins: [smartbizApi()],
};
