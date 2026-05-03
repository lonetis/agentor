import { test, expect } from '@playwright/test';
import { ApiClient } from '../helpers/api-client';
import { createWorker, cleanupWorker, uniquePort } from '../helpers/worker-lifecycle';
import { TerminalWsClient } from '../helpers/terminal-ws';

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL_INSIDE_NETWORK || 'http://agentor-orchestrator:3000';

/**
 * Run a single curl from inside the worker's tmux shell and return the body.
 *
 * Reading shell output through a tmux WebSocket is hostile: the terminal echoes
 * the typed command back, response bodies can contain shell metacharacters,
 * and embedded newlines / cat-into-printf chains get unreliably folded by the
 * pty. We avoid every one of those by:
 *  1. Splitting the marker across two shell variables so the literal marker
 *     only exists in the actual output stream, never in the echoed command.
 *  2. Writing the body to a temp file and base64-encoding it inline. The
 *     output is two stable `KEY=VALUE` lines (`STATUS=...` and `BODY_B64=...`)
 *     plus a sentinel `END_TOKEN`, which is trivial to grep regardless of what
 *     the response body contains.
 */
async function curlInside(ws: TerminalWsClient, path: string, opts: { method?: string; data?: unknown } = {}): Promise<{ status: number; body: string }> {
  const tag = `M${Math.random().toString(36).slice(2, 10)}`;
  const endA = '__End';
  const endB = `_${tag}__`;
  const endMarker = `${endA}${endB}`;

  const dataFlag = opts.data !== undefined ? `-d '${JSON.stringify(opts.data).replace(/'/g, "'\\''")}'` : '';
  const methodFlag = opts.method ? `-X ${opts.method}` : '';
  const tmp = `/tmp/curl-${tag}`;
  const cmd =
    `EA='${endA}'; EB='${endB}'; ` +
    `curl -sS -o ${tmp} -w '%{http_code}' -H 'Content-Type: application/json' ${methodFlag} ${dataFlag} '${ORCHESTRATOR_URL}${path}' > ${tmp}.code; ` +
    `echo STATUS=$(cat ${tmp}.code); ` +
    `echo BODY_B64=$(base64 -w0 < ${tmp}); ` +
    `printf '%s%s\\n' "$EA" "$EB"; ` +
    `rm -f ${tmp} ${tmp}.code`;

  ws.clearBuffer();
  ws.sendLine(cmd);
  await ws.waitForOutput(new RegExp(endMarker), 30_000);
  const buf = ws.getBuffer();
  const endIdx = buf.indexOf(endMarker);
  if (endIdx === -1) {
    throw new Error(`curlInside end marker not found. Buffer (last 1000 chars):\n${buf.slice(-1000)}`);
  }
  // Walk back from the end marker, take the last STATUS= and BODY_B64= matches
  // (the echoed command line never starts with these tokens at column 0, but
  // taking the last match is robust against any future terminal weirdness).
  const head = buf.slice(0, endIdx);
  const statusMatches = [...head.matchAll(/^STATUS=(\d+)\s*$/gm)];
  const bodyMatches = [...head.matchAll(/^BODY_B64=([A-Za-z0-9+/=]*)\s*$/gm)];
  if (statusMatches.length === 0 || bodyMatches.length === 0) {
    throw new Error(`curlInside could not parse output. Buffer (last 1500 chars):\n${buf.slice(-1500)}`);
  }
  const status = parseInt(statusMatches[statusMatches.length - 1][1], 10);
  const b64 = bodyMatches[bodyMatches.length - 1][1];
  const body = b64 ? Buffer.from(b64, 'base64').toString('utf-8') : '';
  return { status, body };
}

test.describe.serial('Worker-self API', () => {
  let containerId: string;
  let containerName: string;
  let workerName: string;

  test.beforeAll(async ({ request }) => {
    const container = await createWorker(request);
    containerId = container.id;
    workerName = container.name;
    containerName = container.containerName as string;

    // Give the worker a moment to settle into a shell prompt
    const api = new ApiClient(request);
    const start = Date.now();
    while (Date.now() - start < 60_000) {
      const { status: createStatus, body } = await api.createPane(containerId, 'readiness-probe');
      if (createStatus === 201) {
        await api.deletePane(containerId, body.index);
        break;
      }
      await new Promise(r => setTimeout(r, 2000));
    }
  });

  test.afterAll(async ({ request }) => {
    await cleanupWorker(request, containerId);
  });

  test('GET /api/worker-self/info returns the calling worker identity', async () => {
    const ws = new TerminalWsClient(containerId);
    try {
      await ws.connect();
      await ws.waitForOutput(/[\$#>]\s*$/, 15_000);
      const { status, body } = await curlInside(ws, '/api/worker-self/info');
      expect(status).toBe(200);
      const json = JSON.parse(body);
      expect(json.workerName).toBe(workerName);
      expect(json.containerName).toBe(containerName);
      expect(json.userId).toBeTruthy();
      expect(json.status).toBe('running');
    } finally {
      ws.close();
    }
  });

  test('GET /api/worker-self/info from outside the docker network is 401', async ({ request }) => {
    // Hitting the public host URL bypasses the docker bridge — the source IP
    // does not resolve to any managed worker.
    const res = await request.get('/api/worker-self/info');
    expect(res.status()).toBe(401);
  });

  test('POST /api/worker-self/port-mappings creates a mapping owned by the calling worker', async ({ request }) => {
    const port = uniquePort();
    const ws = new TerminalWsClient(containerId);
    try {
      await ws.connect();
      await ws.waitForOutput(/[\$#>]\s*$/, 15_000);
      const { status, body } = await curlInside(ws, '/api/worker-self/port-mappings', {
        method: 'POST',
        data: { externalPort: port, type: 'localhost', internalPort: 9999 },
      });
      expect(status).toBe(201);
      const json = JSON.parse(body);
      expect(json.externalPort).toBe(port);
      expect(json.internalPort).toBe(9999);
      expect(json.type).toBe('localhost');
      expect(json.workerName).toBe(workerName);
      expect(json.containerName).toBe(containerName);

      const list = await curlInside(ws, '/api/worker-self/port-mappings');
      expect(list.status).toBe(200);
      const arr = JSON.parse(list.body);
      expect(Array.isArray(arr)).toBe(true);
      expect(arr.find((m: { externalPort: number }) => m.externalPort === port)).toBeTruthy();

      const del = await curlInside(ws, `/api/worker-self/port-mappings/${port}`, { method: 'DELETE' });
      expect(del.status).toBe(200);
    } finally {
      ws.close();
      // Belt-and-suspenders cleanup via the admin API in case the in-worker DELETE failed
      const api = new ApiClient(request);
      await api.deletePortMapping(port).catch(() => undefined);
    }
  });

  test('POST /api/worker-self/port-mappings rejects body with workerName ignored', async ({ request }) => {
    const port = uniquePort();
    const ws = new TerminalWsClient(containerId);
    try {
      await ws.connect();
      await ws.waitForOutput(/[\$#>]\s*$/, 15_000);
      // Even if the caller tries to specify a different workerName in the body,
      // the worker-self route ignores it and uses the resolved caller.
      const { status, body } = await curlInside(ws, '/api/worker-self/port-mappings', {
        method: 'POST',
        data: { externalPort: port, type: 'localhost', internalPort: 9998, workerName: 'evil-target' },
      });
      expect(status).toBe(201);
      const json = JSON.parse(body);
      expect(json.workerName).toBe(workerName);
      expect(json.containerName).toBe(containerName);
    } finally {
      ws.close();
      const api = new ApiClient(request);
      await api.deletePortMapping(port).catch(() => undefined);
    }
  });

  test('GET /api/worker-self/port-mappings filters out other workers\' mappings', async ({ request }) => {
    // Create a second worker (admin), make it own a port mapping, verify the first worker doesn't see it.
    const api = new ApiClient(request);
    const second = await createWorker(request);
    const otherPort = uniquePort();
    try {
      const { status: createStatus } = await api.createPortMapping({
        externalPort: otherPort,
        type: 'localhost',
        internalPort: 9000,
        workerName: second.name,
      });
      expect(createStatus).toBe(201);

      const ws = new TerminalWsClient(containerId);
      try {
        await ws.connect();
        await ws.waitForOutput(/[\$#>]\s*$/, 15_000);
        const list = await curlInside(ws, '/api/worker-self/port-mappings');
        expect(list.status).toBe(200);
        const arr = JSON.parse(list.body) as Array<{ externalPort: number }>;
        expect(arr.find((m) => m.externalPort === otherPort)).toBeFalsy();
      } finally {
        ws.close();
      }
    } finally {
      await api.deletePortMapping(otherPort).catch(() => undefined);
      await cleanupWorker(request, second.id);
    }
  });

  test('DELETE /api/worker-self/port-mappings/:port refuses other workers\' mappings', async ({ request }) => {
    const api = new ApiClient(request);
    const second = await createWorker(request);
    const otherPort = uniquePort();
    try {
      await api.createPortMapping({
        externalPort: otherPort,
        type: 'localhost',
        internalPort: 9000,
        workerName: second.name,
      });
      const ws = new TerminalWsClient(containerId);
      try {
        await ws.connect();
        await ws.waitForOutput(/[\$#>]\s*$/, 15_000);
        const del = await curlInside(ws, `/api/worker-self/port-mappings/${otherPort}`, { method: 'DELETE' });
        expect(del.status).toBe(403);
        // And the mapping is still present
        const { body } = await api.listPortMappings();
        expect(body.find((m: { externalPort: number }) => m.externalPort === otherPort)).toBeTruthy();
      } finally {
        ws.close();
      }
    } finally {
      await api.deletePortMapping(otherPort).catch(() => undefined);
      await cleanupWorker(request, second.id);
    }
  });

  test('GET /api/worker-self/port-mapper/status returns counts', async () => {
    const ws = new TerminalWsClient(containerId);
    try {
      await ws.connect();
      await ws.waitForOutput(/[\$#>]\s*$/, 15_000);
      const { status, body } = await curlInside(ws, '/api/worker-self/port-mapper/status');
      expect(status).toBe(200);
      const json = JSON.parse(body);
      expect(typeof json.totalMappings).toBe('number');
      expect(typeof json.localhostCount).toBe('number');
      expect(typeof json.externalCount).toBe('number');
    } finally {
      ws.close();
    }
  });

  test('GET /api/worker-self/domain-mapper/status reports availability', async () => {
    const ws = new TerminalWsClient(containerId);
    try {
      await ws.connect();
      await ws.waitForOutput(/[\$#>]\s*$/, 15_000);
      const { status, body } = await curlInside(ws, '/api/worker-self/domain-mapper/status');
      expect(status).toBe(200);
      const json = JSON.parse(body);
      expect(typeof json.enabled).toBe('boolean');
      expect(Array.isArray(json.baseDomains)).toBe(true);
    } finally {
      ws.close();
    }
  });

  test('GET /api/worker-self/usage returns the owner\'s usage status', async () => {
    const ws = new TerminalWsClient(containerId);
    try {
      await ws.connect();
      await ws.waitForOutput(/[\$#>]\s*$/, 15_000);
      // Force a refresh first so the per-user state is populated.
      const refresh = await curlInside(ws, '/api/worker-self/usage/refresh', { method: 'POST' });
      expect(refresh.status).toBe(200);

      const { status, body } = await curlInside(ws, '/api/worker-self/usage');
      expect(status).toBe(200);
      const json = JSON.parse(body);
      expect(Array.isArray(json.agents)).toBe(true);
      // After a refresh, all three agents are reported.
      const ids = json.agents.map((a: { agentId: string }) => a.agentId);
      expect(ids).toContain('claude');
      expect(ids).toContain('codex');
      expect(ids).toContain('gemini');
    } finally {
      ws.close();
    }
  });
});
