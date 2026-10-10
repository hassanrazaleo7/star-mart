import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { existsSync } from 'node:fs';

// Load .env.local before any server module evaluates (static imports would be hoisted above this line).
process.chdir(dirname(fileURLToPath(import.meta.url)));
if (existsSync('.env.local')) process.loadEnvFile('.env.local');

const [{ createServer: viteServer }, { handle }, { close }] = await Promise.all([
  import('vite'),
  import('./server/api.mjs'),
  import('./server/db.mjs'),
]);

// The API binds to loopback by default; set HOST=0.0.0.0 to expose it on the LAN deliberately.
const host = process.env.HOST || '127.0.0.1',
  port = Number(process.env.API_PORT || 8787);
const api = createServer(handle);
api.listen(port, host, () => console.log(`API http://${host}:${port}`));
const vite = await viteServer({ configFile: 'vite.config.js', server: { host: '127.0.0.1' } });
await vite.listen();
vite.printUrls();

let closing = false;
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, async () => {
    if (closing) return;
    closing = true;
    await vite.close();
    await new Promise(resolve => api.close(resolve));
    await close();
    process.exit(0);
  });
