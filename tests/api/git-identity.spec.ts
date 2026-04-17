import { test, expect } from '@playwright/test';
import { ApiClient } from '../helpers/api-client';
import { createWorker, cleanupWorker, waitForWorkerRunning } from '../helpers/worker-lifecycle';
import { TerminalWsClient } from '../helpers/terminal-ws';

/**
 * Helper: connect to terminal, run a command, return output.
 */
async function execInWorker(containerId: string, command: string, timeoutMs = 30_000): Promise<string> {
  const ws = new TerminalWsClient(containerId);
  try {
    await ws.connect();
    await ws.waitForOutput(/[\$#>]\s*$/, 30_000);
    ws.clearBuffer();

    const marker = `END_${Date.now()}_MK`;
    ws.sendLine(`${command}; echo ${marker}`);
    await ws.waitForOutput(new RegExp(`\\n${marker}\\n`), timeoutMs);

    return ws.getBuffer();
  } finally {
    ws.close();
  }
}

test.describe.serial('Git identity — user-based config', () => {
  let containerId: string;

  test.beforeAll(async ({ request }) => {
    const container = await createWorker(request, { displayName: `GitId-${Date.now()}` });
    containerId = container.id;
  });

  test.afterAll(async ({ request }) => {
    await cleanupWorker(request, containerId);
  });

  test('git user.name is set from creating user profile', async () => {
    const output = await execInWorker(containerId, 'git config --global user.name');
    expect(output).toContain('Test Admin');
  });

  test('git user.email is set from creating user profile', async () => {
    const output = await execInWorker(containerId, 'git config --global user.email');
    expect(output).toContain('admin@agentor.test');
  });

  test('no git wrapper installed at /usr/local/bin/git', async () => {
    const output = await execInWorker(containerId, 'test -f /usr/local/bin/git && echo EXISTS || echo ABSENT');
    expect(output).toContain('ABSENT');
  });

  test('WORKER env var contains gitName and gitEmail', async () => {
    const output = await execInWorker(containerId, 'echo "$WORKER" | jq -r ".gitName"');
    expect(output).toContain('Test Admin');
    const output2 = await execInWorker(containerId, 'echo "$WORKER" | jq -r ".gitEmail"');
    expect(output2).toContain('admin@agentor.test');
  });
});

test.describe.serial('Git identity — persists across rebuild', () => {
  let containerId: string;

  test.beforeAll(async ({ request }) => {
    const container = await createWorker(request, { displayName: `GitRebuild-${Date.now()}` });
    containerId = container.id;
  });

  test.afterAll(async ({ request }) => {
    await cleanupWorker(request, containerId);
  });

  test('git identity set before rebuild', async () => {
    const output = await execInWorker(containerId, 'git config --global user.name');
    expect(output).toContain('Test Admin');
  });

  test('git identity persists after rebuild', async ({ request }) => {
    const api = new ApiClient(request);
    const { status, body } = await api.rebuildContainer(containerId);
    expect(status).toBe(200);
    containerId = body.id;
    await waitForWorkerRunning(request, containerId, 90_000);

    const nameOutput = await execInWorker(containerId, 'git config --global user.name');
    expect(nameOutput).toContain('Test Admin');

    const emailOutput = await execInWorker(containerId, 'git config --global user.email');
    expect(emailOutput).toContain('admin@agentor.test');
  });
});

test.describe.serial('Git identity — persists across archive/unarchive', () => {
  let containerId: string;
  let containerName: string;

  test.beforeAll(async ({ request }) => {
    const container = await createWorker(request, { displayName: `GitArchive-${Date.now()}` });
    containerId = container.id;
    containerName = container.name;
  });

  test.afterAll(async ({ request }) => {
    await cleanupWorker(request, containerId);
  });

  test('git identity set before archive', async () => {
    const output = await execInWorker(containerId, 'git config --global user.email');
    expect(output).toContain('admin@agentor.test');
  });

  test('git identity persists after archive and unarchive', async ({ request }) => {
    const api = new ApiClient(request);
    await api.archiveContainer(containerId);

    const { status, body } = await api.unarchiveWorker(containerName);
    expect(status).toBe(200);
    containerId = body.id;
    await waitForWorkerRunning(request, containerId, 90_000);

    const nameOutput = await execInWorker(containerId, 'git config --global user.name');
    expect(nameOutput).toContain('Test Admin');

    const emailOutput = await execInWorker(containerId, 'git config --global user.email');
    expect(emailOutput).toContain('admin@agentor.test');
  });
});

test.describe('Git identity — container API response', () => {
  const createdContainerIds: string[] = [];

  test.afterEach(async ({ request }) => {
    for (const id of createdContainerIds) {
      await cleanupWorker(request, id);
    }
    createdContainerIds.length = 0;
  });

  test('created container includes gitName and gitEmail', async ({ request }) => {
    const container = await createWorker(request, { displayName: `GitFields-${Date.now()}` });
    createdContainerIds.push(container.id);

    expect(container.gitName).toBe('Test Admin');
    expect(container.gitEmail).toBe('admin@agentor.test');
  });

  test('container list includes gitName and gitEmail', async ({ request }) => {
    const container = await createWorker(request, { displayName: `GitList-${Date.now()}` });
    createdContainerIds.push(container.id);

    const api = new ApiClient(request);
    const { body } = await api.listContainers();
    const found = body.find((c: { id: string }) => c.id === container.id);
    expect(found).toBeTruthy();
    expect(found.gitName).toBe('Test Admin');
    expect(found.gitEmail).toBe('admin@agentor.test');
  });
});
