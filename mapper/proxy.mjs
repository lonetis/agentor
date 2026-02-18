import { createServer, createConnection } from 'node:net';
import { readFileSync } from 'node:fs';

const CONFIG_PATH = '/data/port-mappings.json';

function loadMappings() {
  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

const servers = [];

function startProxy(externalPort, targetHost, targetPort, bindAddress) {
  return new Promise((resolve, reject) => {
    const server = createServer((client) => {
      const target = createConnection({ host: targetHost, port: targetPort }, () => {
        client.pipe(target);
        target.pipe(client);
      });
      target.on('error', () => client.destroy());
      client.on('error', () => target.destroy());
    });

    server.on('error', reject);
    server.listen(externalPort, bindAddress, () => {
      console.log(`[mapper] proxy ${bindAddress}:${externalPort} -> ${targetHost}:${targetPort}`);
      resolve(server);
    });
  });
}

async function main() {
  const mappings = loadMappings();
  console.log(`[mapper] loaded ${mappings.length} mapping(s)`);

  for (const m of mappings) {
    try {
      const bindAddress = m.type === 'localhost' ? '127.0.0.1' : '0.0.0.0';
      const server = await startProxy(m.externalPort, m.workerName, m.internalPort, bindAddress);
      servers.push(server);
    } catch (err) {
      console.error(`[mapper] failed to bind :${m.externalPort} -> ${m.workerName}:${m.internalPort}: ${err.message}`);
    }
  }

  console.log(`[mapper] running ${servers.length} proxy(ies)`);
}

function shutdown() {
  console.log('[mapper] shutting down');
  for (const s of servers) {
    s.close();
  }
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

main();
