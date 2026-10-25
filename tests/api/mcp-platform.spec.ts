import { test, expect } from '@playwright/test';
import { gunzipSync } from 'node:zlib';
import type { CallToolResult } from '@modelcontextprotocol/client';
import { ApiClient } from '../helpers/api-client';
import { cleanupWorker, uniquePort, waitForWorkerRunning } from '../helpers/worker-lifecycle';
import { createTestUser, deleteTestUser, signedInContext } from '../helpers/test-users';
import { callError, callJson, connectMcp, resultText, type McpConnection } from '../helpers/mcp';

/**
 * End-to-end: an agent drives the whole platform exclusively through MCP tools,
 * exactly as it would from Claude Code — configuration resources, a worker's
 * full lifecycle, command execution, terminal and desktop interaction, files,
 * mappings, apps, account, usage and (as admin) user management.
 */
test.describe.serial('MCP drives the platform end-to-end', () => {
  test.setTimeout(180_000);

  let mcp: McpConnection;
  let workerId: string;
  const stamp = Date.now();

  test.beforeAll(async ({ request }) => {
    mcp = await connectMcp(request);
  });

  test.afterAll(async ({ request }) => {
    if (workerId) await cleanupWorker(request, workerId);
    await mcp?.close();
  });

  test('manages environments, capabilities, instructions and init scripts', async () => {
    const { client } = mcp;
    const env = await callJson(client, 'create_environment', { name: `mcp-env-${stamp}`, networkMode: 'full', dockerEnabled: false, envVars: 'MCP_MARKER=1' });
    expect(env).toMatchObject({ name: `mcp-env-${stamp}`, dockerEnabled: false });
    expect(await callJson(client, 'update_environment', { id: env.id, name: `mcp-env-${stamp}-2`, memoryLimit: '2g' })).toMatchObject({ memoryLimit: '2g' });
    expect(await callJson(client, 'get_environment', { id: env.id })).toMatchObject({ name: `mcp-env-${stamp}-2` });

    const capability = await callJson(client, 'create_capability', {
      name: `mcp-cap-${stamp}`,
      content: `---\nname: mcp-cap-${stamp}\ndescription: test\n---\n# Test capability\n`,
    });
    const instruction = await callJson(client, 'create_instruction', { name: `mcp-ins-${stamp}`, content: '# Be concise' });
    const script = await callJson(client, 'create_init_script', { name: `mcp-init-${stamp}`, content: '#!/bin/bash\necho ready' });
    for (const [tool, id] of [['get_capability', capability.id], ['get_instruction', instruction.id], ['get_init_script', script.id]]) {
      expect(await callJson(client, tool, { id })).toMatchObject({ id });
    }
    const names = (await callJson<{ name: string }[]>(client, 'list_capabilities')).map((c) => c.name);
    expect(names).toContain(`mcp-cap-${stamp}`);

    for (const [tool, id] of [
      ['delete_capability', capability.id], ['delete_instruction', instruction.id],
      ['delete_init_script', script.id], ['delete_environment', env.id],
    ]) {
      const result = await client.callTool({ name: tool, arguments: { id } }) as CallToolResult;
      expect(result.isError, `${tool}: ${resultText(result)}`).toBeFalsy();
    }
  });

  test('creates a worker', async ({ request }) => {
    const scripts = await callJson<{ name: string; id: string }[]>(mcp.client, 'list_init_scripts');
    expect(scripts.map((s) => s.name)).toEqual(expect.arrayContaining(['claude', 'codex', 'antigravity']));

    const worker = await callJson(mcp.client, 'create_container', { displayName: `mcp-worker-${stamp}` });
    workerId = worker.id;
    expect(worker).toMatchObject({ displayName: `mcp-worker-${stamp}` });
    await waitForWorkerRunning(request, workerId);
    const list = await callJson<{ id: string; status: string }[]>(mcp.client, 'list_containers');
    expect(list.find((c) => c.id === workerId)?.status).toBe('running');
  });

  test('executes commands', async () => {
    const ok = await callJson(mcp.client, 'exec_command', { id: workerId, command: 'echo "N=$((7*6))"; whoami' });
    expect(ok).toMatchObject({ exitCode: 0, stdout: 'N=42\nagent\n' });
    const failed = await callJson(mcp.client, 'exec_command', { id: workerId, command: 'exit 5' });
    expect(failed.exitCode).toBe(5);
  });

  test('uploads and downloads workspace files', async () => {
    const uploaded = await callJson(mcp.client, 'upload_to_workspace', {
      id: workerId,
      files: [
        { path: 'mcp/notes.txt', content: 'hello from mcp' },
        { path: 'mcp/data.bin', content: Buffer.from([0, 1, 2, 250]).toString('base64'), encoding: 'base64' },
      ],
    });
    expect(uploaded).toEqual({ uploaded: 2 });
    const check = await callJson(mcp.client, 'exec_command', { id: workerId, command: 'cat mcp/notes.txt; echo; od -An -tu1 mcp/data.bin | tr -s " "' });
    expect(check.stdout).toBe('hello from mcp\n 0 1 2 250\n');

    const download = await mcp.client.callTool({ name: 'download_workspace', arguments: { id: workerId, path: 'mcp' } }) as CallToolResult;
    expect(download.isError).toBeFalsy();
    const blob = download.content.find((c) => c.type === 'resource') as { resource: { mimeType: string; blob: string } };
    expect(blob.resource.mimeType).toBe('application/gzip');
    const tar = gunzipSync(Buffer.from(blob.resource.blob, 'base64')).toString('latin1');
    expect(tar).toContain('mcp/notes.txt');
    expect(tar).toContain('hello from mcp');
  });

  test('refuses oversized downloads and stays responsive', async ({ request }) => {
    // 20 MB of incompressible data: the gzip stream stays above the 16 MiB MCP cap.
    const made = await callJson(mcp.client, 'exec_command', { id: workerId, command: 'mkdir -p big && head -c 20000000 /dev/urandom > big/blob.bin' });
    expect(made.exitCode).toBe(0);
    expect(await callError(mcp.client, 'download_workspace', { id: workerId, path: 'big' })).toMatch(/exceeds the \d+-byte MCP limit/);
    expect((await new ApiClient(request).health()).body.status).toBe('ok');
    // The abandoned archive must not keep Docker's container lock — exec still works.
    expect((await callJson(mcp.client, 'exec_command', { id: workerId, command: 'rm -rf big' })).exitCode).toBe(0);
  });

  test('drives a terminal through tmux windows', async () => {
    const window = await callJson(mcp.client, 'create_tmux_window', { id: workerId, name: 'mcp-term' });
    await callJson(mcp.client, 'send_tmux_keys', { id: workerId, windowIndex: window.index, text: 'echo "TERM_OK=$((40+2))"', enter: true });
    await expect.poll(async () => {
      const { content } = await callJson(mcp.client, 'capture_tmux_window', { id: workerId, windowIndex: window.index });
      return content;
    }, { timeout: 20_000 }).toMatch(/TERM_OK=42/);

    await callJson(mcp.client, 'rename_tmux_window', { id: workerId, windowIndex: window.index, newName: 'mcp-renamed' });
    const windows = await callJson<{ name: string }[]>(mcp.client, 'list_tmux_windows', { id: workerId });
    expect(windows.map((w) => w.name)).toContain('mcp-renamed');
    await callJson(mcp.client, 'delete_tmux_window', { id: workerId, windowIndex: window.index });
  });

  test('sees and operates the virtual desktop', async () => {
    let screenshot: CallToolResult | undefined;
    await expect.poll(async () => {
      screenshot = await mcp.client.callTool({ name: 'get_desktop_screenshot', arguments: { id: workerId } }) as CallToolResult;
      return !screenshot.isError;
    }, { timeout: 60_000 }).toBe(true);
    const image = screenshot!.content[0] as { type: string; mimeType: string; data: string };
    expect(image).toMatchObject({ type: 'image', mimeType: 'image/png' });
    expect(Buffer.from(image.data, 'base64').subarray(1, 4).toString()).toBe('PNG');

    expect(await callJson(mcp.client, 'send_desktop_input', { id: workerId, action: 'click', x: 640, y: 360 })).toEqual({ ok: true });
    const pointer = await callJson(mcp.client, 'exec_command', { id: workerId, command: 'DISPLAY=:99 xdotool getmouselocation --shell | head -2 | tr "\\n" " "' });
    expect(pointer.stdout.trim()).toBe('X=640 Y=360');
  });

  test('maps ports and manages apps', async () => {
    const externalPort = uniquePort();
    const mapping = await callJson(mcp.client, 'create_port_mapping', { workerId, externalPort, internalPort: 8080, type: 'localhost' });
    expect(mapping).toMatchObject({ workerId, externalPort, internalPort: 8080 });
    const mappings = await callJson<{ externalPort: number }[]>(mcp.client, 'list_port_mappings');
    expect(mappings.some((m) => m.externalPort === externalPort)).toBe(true);
    await callJson(mcp.client, 'delete_port_mapping', { port: externalPort });

    const app = await callJson(mcp.client, 'start_app_instance', { id: workerId, appType: 'socks5' });
    const running = await callJson<{ id: string }[]>(mcp.client, 'list_app_instances', { id: workerId, appType: 'socks5' });
    expect(running.map((a) => a.id)).toContain(app.id);
    await callJson(mcp.client, 'stop_app_instance', { id: workerId, appType: 'socks5', instanceId: app.id });
  });

  test('maps domains when domain routing is configured', async () => {
    const status = await callJson(mcp.client, 'get_domain_mapper_status');
    test.skip(!status.enabled, 'BASE_DOMAINS not configured');
    const mapping = await callJson(mcp.client, 'create_domain_mapping', {
      workerId, subdomain: `mcp-${stamp}`, baseDomain: status.baseDomains[0], protocol: 'http', internalPort: 8080,
    });
    expect(mapping).toMatchObject({ subdomain: `mcp-${stamp}`, protocol: 'http' });
    await callJson(mcp.client, 'delete_domain_mapping', { id: mapping.id });
  });

  test('changes settings and runs the lifecycle', async ({ request }) => {
    expect(await callJson(mcp.client, 'update_container_settings', { id: workerId, displayName: `mcp-renamed-${stamp}` }))
      .toMatchObject({ displayName: `mcp-renamed-${stamp}`, pendingRebuild: false });

    await callJson(mcp.client, 'stop_container', { id: workerId });
    await callJson(mcp.client, 'restart_container', { id: workerId });
    await waitForWorkerRunning(request, workerId);

    await callJson(mcp.client, 'archive_container', { id: workerId });
    const archived = await callJson<{ id: string }[]>(mcp.client, 'list_archived_workers');
    expect(archived.map((w) => w.id)).toContain(workerId);
    const restored = await callJson(mcp.client, 'unarchive_worker', { id: workerId });
    expect(restored).toMatchObject({ id: workerId, displayName: `mcp-renamed-${stamp}` });
    await waitForWorkerRunning(request, workerId);

    const logs = await mcp.client.callTool({ name: 'get_container_logs', arguments: { id: workerId, tail: 20 } }) as CallToolResult;
    expect(logs.isError).toBeFalsy();
  });

  test('reads account, usage and metrics', async () => {
    const me = await callJson(mcp.client, 'get_current_user');
    expect(me.role).toBe('admin');
    const usage = await callJson(mcp.client, 'get_usage');
    expect(Array.isArray(usage.agents)).toBe(true);
    const metrics = await callJson(mcp.client, 'list_worker_metrics');
    expect(Array.isArray(metrics.workers)).toBe(true);
    const apps = await callJson<{ name: string }[]>(mcp.client, 'list_authorized_apps');
    expect(apps.map((a) => a.name)).toContain('Agentor MCP tests');
  });

  test('manages users as an admin', async () => {
    const email = `mcp-user-${stamp}@test.example`;
    const user = await callJson(mcp.client, 'create_user', { name: 'MCP Created', email, password: 'mcp-created-pass-1' });
    expect(user).toMatchObject({ email, role: 'user' });
    expect(await callJson(mcp.client, 'update_user', { id: user.id, role: 'admin' })).toMatchObject({ role: 'admin' });
    expect(await callJson(mcp.client, 'set_user_password', { id: user.id, newPassword: 'mcp-changed-pass-2' })).toEqual({ ok: true });
    expect((await callJson<{ id: string }[]>(mcp.client, 'list_users')).map((u) => u.id)).toContain(user.id);
    expect(await callJson(mcp.client, 'delete_user', { id: user.id })).toEqual({ ok: true });
  });

  test('surfaces API errors as tool errors', async () => {
    expect(await callError(mcp.client, 'stop_container', { id: '00000000-0000-4000-8000-000000000000' })).toMatch(/^HTTP 404/);
    // Schema-valid but rejected by the route's own validation.
    expect(await callError(mcp.client, 'exec_command', { id: workerId, command: 'true', cwd: 'relative/dir' })).toMatch(/^HTTP 400: cwd must be an absolute path/);
    // Violations of the OpenAPI-derived input schema are caught before the route runs.
    expect(await callError(mcp.client, 'exec_command', { id: workerId, command: 'true', timeoutSeconds: 9999 })).toMatch(/timeoutSeconds/);
  });

  test('another user\'s MCP session cannot touch this worker', async () => {
    const user = await createTestUser('MCP Outsider');
    const session = await signedInContext(user.email, user.password);
    const outsider = await connectMcp(session);
    try {
      const visible = await callJson<{ id: string }[]>(outsider.client, 'list_containers');
      expect(visible.map((c) => c.id)).not.toContain(workerId);
      expect(await callError(outsider.client, 'exec_command', { id: workerId, command: 'true' })).toMatch(/^HTTP 403/);
      expect(await callError(outsider.client, 'delete_container', { id: workerId })).toMatch(/^HTTP 403/);
    } finally {
      await outsider.close();
      await session.dispose();
      await deleteTestUser(user.id);
    }
  });

  test('deletes the worker', async ({ request }) => {
    await callJson(mcp.client, 'delete_container', { id: workerId });
    const { body } = await new ApiClient(request).listContainers();
    expect(body.some((c: { id: string }) => c.id === workerId)).toBe(false);
    workerId = '';
  });
});
