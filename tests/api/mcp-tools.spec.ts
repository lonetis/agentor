import { test, expect } from '@playwright/test';
import type { Client } from '@modelcontextprotocol/client';
import { createTestUser, deleteTestUser, signedInContext } from '../helpers/test-users';
import { connectMcp, type McpConnection } from '../helpers/mcp';

type Tool = Awaited<ReturnType<Client['listTools']>>['tools'][number];

/** Tools a user needs to drive the whole platform — one per dashboard capability. */
const CORE_TOOLS = [
  // workers + lifecycle
  'list_containers', 'create_container', 'update_container_settings', 'stop_container', 'restart_container',
  'rebuild_container', 'archive_container', 'delete_container', 'get_container_logs', 'suggest_display_name',
  'list_archived_workers', 'unarchive_worker', 'delete_archived_worker',
  // interaction
  'exec_command', 'list_tmux_windows', 'create_tmux_window', 'rename_tmux_window', 'delete_tmux_window',
  'send_tmux_keys', 'capture_tmux_window', 'get_desktop_screenshot', 'send_desktop_input',
  'get_desktop_status', 'get_editor_status', 'upload_to_workspace', 'download_workspace',
  // apps + mappings
  'list_app_types', 'list_all_apps', 'list_app_instances', 'start_app_instance', 'stop_app_instance',
  'list_port_mappings', 'create_port_mapping', 'delete_port_mapping', 'get_port_mapper_status',
  'list_domain_mappings', 'create_domain_mapping', 'create_domain_mappings_batch', 'delete_domain_mapping',
  'get_domain_mapper_status',
  // configuration resources
  'list_environments', 'get_environment', 'create_environment', 'update_environment', 'delete_environment',
  'list_capabilities', 'get_capability', 'create_capability', 'update_capability', 'delete_capability',
  'list_instructions', 'get_instruction', 'create_instruction', 'update_instruction', 'delete_instruction',
  'list_init_scripts', 'get_init_script', 'create_init_script', 'update_init_script', 'delete_init_script',
  // account, usage, metrics, git providers
  'get_current_user', 'update_account_profile', 'get_account_env_vars', 'put_account_env_vars',
  'get_account_ssh_key', 'put_account_ssh_key', 'get_account_agent_credentials', 'list_authorized_apps',
  'get_usage', 'refresh_usage', 'list_worker_metrics', 'get_worker_metrics',
  'list_git_providers', 'list_git_repos', 'list_git_branches', 'create_git_repo',
];

const ADMIN_TOOLS = [
  'list_users', 'create_user', 'update_user', 'set_user_password', 'delete_user',
  'get_logs', 'clear_logs', 'get_log_sources', 'get_settings', 'apply_updates', 'trigger_update_check', 'prune_images',
];

const NEVER_EXPOSED = [
  // worker-internal (source-IP auth), first-run setup, health probe
  'worker_self_info', 'worker_self_create_port_mapping', 'create_initial_admin', 'get_setup_status', 'health_check',
  // credential management and multi-GB bundles stay out of MCP
  'set_own_password', 'remove_own_password', 'export_worker', 'import_worker',
];

function byName(tools: Tool[]): Map<string, Tool> {
  return new Map(tools.map((t) => [t.name, t]));
}

test.describe('MCP tool catalog', () => {
  let admin: McpConnection;
  let adminTools: Map<string, Tool>;

  test.beforeAll(async ({ request }) => {
    admin = await connectMcp(request);
    adminTools = byName((await admin.client.listTools()).tools);
  });

  test.afterAll(async () => {
    await admin?.close();
  });

  test('exposes a tool for every dashboard capability', () => {
    for (const name of [...CORE_TOOLS, ...ADMIN_TOOLS]) {
      expect(adminTools.has(name), name).toBe(true);
    }
  });

  test('never exposes worker-internal, setup, credential or bundle routes', () => {
    for (const name of NEVER_EXPOSED) {
      expect(adminTools.has(name), name).toBe(false);
    }
  });

  test('every tool has a valid name, a description and an object input schema', () => {
    for (const tool of adminTools.values()) {
      expect(tool.name).toMatch(/^[a-z0-9_]{1,64}$/);
      expect(tool.description?.length ?? 0, tool.name).toBeGreaterThan(10);
      expect(tool.inputSchema.type, tool.name).toBe('object');
    }
  });

  test('input schemas come from the OpenAPI route metadata', () => {
    const exec = adminTools.get('exec_command')!;
    expect(Object.keys(exec.inputSchema.properties ?? {})).toEqual(expect.arrayContaining(['id', 'command', 'cwd', 'timeoutSeconds']));
    expect(exec.inputSchema.required).toEqual(expect.arrayContaining(['id', 'command']));

    const create = adminTools.get('create_container')!;
    expect(Object.keys(create.inputSchema.properties ?? {})).toEqual(
      expect.arrayContaining(['displayName', 'environmentId', 'repos', 'mounts', 'initScript']),
    );

    const input = adminTools.get('send_desktop_input')!;
    const action = (input.inputSchema.properties as Record<string, { enum?: string[] }>).action;
    expect(action.enum).toEqual(expect.arrayContaining(['click', 'type', 'key', 'scroll', 'drag']));
  });

  test('annotations follow HTTP semantics', () => {
    expect(adminTools.get('list_containers')!.annotations).toMatchObject({ readOnlyHint: true });
    expect(adminTools.get('capture_tmux_window')!.annotations).toMatchObject({ readOnlyHint: true });
    expect(adminTools.get('delete_container')!.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(adminTools.get('create_container')!.annotations).toMatchObject({ readOnlyHint: false });
  });

  test('the server explains Agentor to the agent', async () => {
    const instructions = admin.client.getInstructions() ?? '';
    expect(instructions).toContain('Agentor');
    for (const concept of ['Worker', 'Environment', 'Capability', 'Instruction', 'Init script', 'Port mapping', 'Domain mapping']) {
      expect(instructions, concept).toContain(concept);
    }
    // The workflows reference real tool names.
    for (const tool of ['create_container', 'send_tmux_keys', 'capture_tmux_window', 'exec_command', 'get_desktop_screenshot']) {
      expect(instructions).toContain(tool);
      expect(adminTools.has(tool), tool).toBe(true);
    }
  });

  test('the guide is also available as a resource', async () => {
    const { resources } = await admin.client.listResources();
    expect(resources.map((r) => r.uri)).toContain('agentor://guide');
    const { contents } = await admin.client.readResource({ uri: 'agentor://guide' });
    expect(contents[0]).toMatchObject({ mimeType: 'text/markdown' });
    expect((contents[0] as { text: string }).text).toBe(admin.client.getInstructions());
  });

  test('regular users do not see admin-only tools', async () => {
    const user = await createTestUser('MCP Catalog User');
    const session = await signedInContext(user.email, user.password);
    const mcp = await connectMcp(session);
    try {
      const tools = byName((await mcp.client.listTools()).tools);
      for (const name of CORE_TOOLS) expect(tools.has(name), name).toBe(true);
      for (const name of ADMIN_TOOLS) expect(tools.has(name), name).toBe(false);
    } finally {
      await mcp.close();
      await session.dispose();
      await deleteTestUser(user.id);
    }
  });
});
