import { APIRequestContext } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

/**
 * Typed API client wrapper for Agentor orchestrator API.
 * Provides typed methods for all API endpoints with proper error handling.
 */
export class ApiClient {
  readonly baseUrl = BASE_URL;
  constructor(public readonly request: APIRequestContext) {}

  // ─── Auth ─────────────────────────────────────────────────────
  async signInEmail(email: string, password: string) {
    const res = await this.request.post(`${BASE_URL}/api/auth/sign-in/email`, {
      data: { email, password },
    });
    return { status: res.status(), body: await res.json().catch(() => ({})) };
  }

  async signOut() {
    const res = await this.request.post(`${BASE_URL}/api/auth/sign-out`, {
      headers: { 'Content-Type': 'application/json' },
      data: {},
    });
    return { status: res.status(), body: await res.json().catch(() => ({})) };
  }

  async getAuthSession() {
    const res = await this.request.get(`${BASE_URL}/api/auth/get-session`);
    return { status: res.status(), body: await res.json().catch(() => ({})) };
  }

  // ─── Setup ────────────────────────────────────────────────────
  async getSetupStatus() {
    const res = await this.request.get(`${BASE_URL}/api/setup/status`);
    return { status: res.status(), body: await res.json().catch(() => ({})) };
  }

  async createAdmin(data: { email: string; password: string; name: string }) {
    const res = await this.request.post(`${BASE_URL}/api/setup/create-admin`, { data });
    return { status: res.status(), body: await res.json().catch(() => ({})) };
  }

  // ─── Health ───────────────────────────────────────────────────
  async health() {
    const res = await this.request.get(`${BASE_URL}/api/health`);
    return { status: res.status(), body: await res.json() };
  }

  // ─── Containers ───────────────────────────────────────────────
  async listContainers() {
    const res = await this.request.get(`${BASE_URL}/api/containers`);
    return { status: res.status(), body: await res.json() };
  }

  async createContainer(data: Record<string, unknown> = {}) {
    const res = await this.request.post(`${BASE_URL}/api/containers`, { data });
    return { status: res.status(), body: await res.json() };
  }

  async generateName() {
    const res = await this.request.get(`${BASE_URL}/api/containers/generate-name`);
    return { status: res.status(), body: await res.json() };
  }

  async stopContainer(id: string) {
    const res = await this.request.post(`${BASE_URL}/api/containers/${id}/stop`);
    return { status: res.status(), body: await res.json() };
  }

  async restartContainer(id: string) {
    const res = await this.request.post(`${BASE_URL}/api/containers/${id}/restart`);
    return { status: res.status(), body: await res.json() };
  }

  async removeContainer(id: string) {
    const res = await this.request.delete(`${BASE_URL}/api/containers/${id}`);
    return { status: res.status(), body: await res.json() };
  }

  async rebuildContainer(id: string) {
    const res = await this.request.post(`${BASE_URL}/api/containers/${id}/rebuild`);
    return { status: res.status(), body: await res.json() };
  }

  async archiveContainer(id: string) {
    const res = await this.request.post(`${BASE_URL}/api/containers/${id}/archive`);
    return { status: res.status(), body: await res.json() };
  }

  async getContainerLogs(id: string, tail?: number) {
    const url = tail
      ? `${BASE_URL}/api/containers/${id}/logs?tail=${tail}`
      : `${BASE_URL}/api/containers/${id}/logs`;
    const res = await this.request.get(url);
    return { status: res.status(), body: await res.json() };
  }

  async downloadWorkspace(id: string) {
    const res = await this.request.get(`${BASE_URL}/api/containers/${id}/workspace`);
    return { status: res.status(), headers: res.headers(), body: await res.body() };
  }

  async uploadToWorkspace(id: string, files: { name: string; content: Buffer; mimeType?: string }[]) {
    // Use FormData (the recommended way in Playwright for file uploads)
    const form = new FormData();
    for (const f of files) {
      const blob = new Blob([f.content], { type: f.mimeType || 'application/octet-stream' });
      const file = new File([blob], f.name, { type: f.mimeType || 'application/octet-stream' });
      form.append('files', file, f.name);
    }
    const res = await this.request.post(`${BASE_URL}/api/containers/${id}/workspace`, {
      multipart: form,
    });
    return { status: res.status(), body: await res.json() };
  }

  // ─── Tmux Panes ───────────────────────────────────────────────
  async listPanes(containerId: string) {
    const res = await this.request.get(`${BASE_URL}/api/containers/${containerId}/panes`);
    return { status: res.status(), body: await res.json() };
  }

  async createPane(containerId: string, name?: string) {
    const data = name ? { name } : {};
    const res = await this.request.post(`${BASE_URL}/api/containers/${containerId}/panes`, { data });
    return { status: res.status(), body: await res.json() };
  }

  async renamePane(containerId: string, windowIndex: number, newName: string) {
    const res = await this.request.put(`${BASE_URL}/api/containers/${containerId}/panes/${windowIndex}`, {
      data: { newName },
    });
    return { status: res.status(), body: await res.json() };
  }

  async deletePane(containerId: string, windowIndex: number) {
    const res = await this.request.delete(`${BASE_URL}/api/containers/${containerId}/panes/${windowIndex}`);
    return { status: res.status(), body: await res.json() };
  }

  // ─── Service Status ───────────────────────────────────────────
  async getDesktopStatus(containerId: string) {
    const res = await this.request.get(`${BASE_URL}/api/containers/${containerId}/desktop/status`);
    return { status: res.status(), body: await res.json() };
  }

  async getEditorStatus(containerId: string) {
    const res = await this.request.get(`${BASE_URL}/api/containers/${containerId}/editor/status`);
    return { status: res.status(), body: await res.json() };
  }

  // ─── VS Code Tunnel ──────────────────────────────────────────
  async getVsCodeTunnelStatus(containerId: string) {
    const res = await this.request.get(`${BASE_URL}/api/containers/${containerId}/vscode-tunnel/status`);
    return { status: res.status(), body: await res.json() };
  }

  async startVsCodeTunnel(containerId: string) {
    const res = await this.request.post(`${BASE_URL}/api/containers/${containerId}/vscode-tunnel/start`);
    return { status: res.status(), body: await res.json() };
  }

  async stopVsCodeTunnel(containerId: string) {
    const res = await this.request.post(`${BASE_URL}/api/containers/${containerId}/vscode-tunnel/stop`);
    return { status: res.status(), body: await res.json() };
  }

  // ─── Apps ─────────────────────────────────────────────────────
  async listApps(containerId: string) {
    const res = await this.request.get(`${BASE_URL}/api/containers/${containerId}/apps`);
    return { status: res.status(), body: await res.json() };
  }

  async listAppsByType(containerId: string, appType: string) {
    const res = await this.request.get(`${BASE_URL}/api/containers/${containerId}/apps/${appType}`);
    return { status: res.status(), body: await res.json() };
  }

  async startApp(containerId: string, appType: string) {
    const res = await this.request.post(`${BASE_URL}/api/containers/${containerId}/apps/${appType}`);
    return { status: res.status(), body: await res.json() };
  }

  async stopApp(containerId: string, appType: string, instanceId: string) {
    const res = await this.request.delete(`${BASE_URL}/api/containers/${containerId}/apps/${appType}/${instanceId}`);
    return { status: res.status(), body: await res.json() };
  }

  // ─── App Types ────────────────────────────────────────────────
  async listAppTypes() {
    const res = await this.request.get(`${BASE_URL}/api/app-types`);
    return { status: res.status(), body: await res.json() };
  }

  // ─── Port Mappings ────────────────────────────────────────────
  async listPortMappings() {
    const res = await this.request.get(`${BASE_URL}/api/port-mappings`);
    return { status: res.status(), body: await res.json() };
  }

  async createPortMapping(data: Record<string, unknown>) {
    const res = await this.request.post(`${BASE_URL}/api/port-mappings`, { data });
    return { status: res.status(), body: await res.json() };
  }

  async deletePortMapping(port: number) {
    const res = await this.request.delete(`${BASE_URL}/api/port-mappings/${port}`);
    return { status: res.status(), body: await res.json() };
  }

  async getPortMapperStatus() {
    const res = await this.request.get(`${BASE_URL}/api/port-mapper/status`);
    return { status: res.status(), body: await res.json() };
  }

  // ─── Domain Mappings ──────────────────────────────────────────
  async listDomainMappings() {
    const res = await this.request.get(`${BASE_URL}/api/domain-mappings`);
    return { status: res.status(), body: await res.json() };
  }

  async createDomainMapping(data: Record<string, unknown>) {
    const res = await this.request.post(`${BASE_URL}/api/domain-mappings`, { data });
    return { status: res.status(), body: await res.json() };
  }

  async deleteDomainMapping(id: string) {
    const res = await this.request.delete(`${BASE_URL}/api/domain-mappings/${id}`);
    return { status: res.status(), body: await res.json() };
  }

  async getDomainMapperStatus() {
    const res = await this.request.get(`${BASE_URL}/api/domain-mapper/status`);
    return { status: res.status(), body: await res.json() };
  }

  async getCaCert() {
    const res = await this.request.get(`${BASE_URL}/api/domain-mapper/ca-cert`);
    return { status: res.status(), body: await res.text(), headers: res.headers() };
  }

  // ─── Environments ─────────────────────────────────────────────
  async listEnvironments() {
    const res = await this.request.get(`${BASE_URL}/api/environments`);
    return { status: res.status(), body: await res.json() };
  }

  async createEnvironment(data: Record<string, unknown>) {
    const res = await this.request.post(`${BASE_URL}/api/environments`, { data });
    return { status: res.status(), body: await res.json() };
  }

  async getEnvironment(id: string) {
    const res = await this.request.get(`${BASE_URL}/api/environments/${id}`);
    return { status: res.status(), body: await res.json() };
  }

  async updateEnvironment(id: string, data: Record<string, unknown>) {
    const res = await this.request.put(`${BASE_URL}/api/environments/${id}`, { data });
    return { status: res.status(), body: await res.json() };
  }

  async deleteEnvironment(id: string) {
    const res = await this.request.delete(`${BASE_URL}/api/environments/${id}`);
    return { status: res.status(), body: await res.json() };
  }

  // ─── Archived Workers ─────────────────────────────────────────
  async listArchived() {
    const res = await this.request.get(`${BASE_URL}/api/archived`);
    return { status: res.status(), body: await res.json() };
  }

  async unarchiveWorker(name: string) {
    const res = await this.request.post(`${BASE_URL}/api/archived/${name}/unarchive`);
    return { status: res.status(), body: await res.json() };
  }

  async deleteArchivedWorker(name: string) {
    const res = await this.request.delete(`${BASE_URL}/api/archived/${name}`);
    return { status: res.status(), body: await res.json() };
  }

  // ─── Git Providers ────────────────────────────────────────────
  async listGitProviders() {
    const res = await this.request.get(`${BASE_URL}/api/git-providers`);
    return { status: res.status(), body: await res.json() };
  }

  // ─── GitHub ───────────────────────────────────────────────────
  async listGitHubRepos() {
    const res = await this.request.get(`${BASE_URL}/api/github/repos`);
    return { status: res.status(), body: await res.json() };
  }

  async listGitHubBranches(owner: string, repo: string) {
    const res = await this.request.get(`${BASE_URL}/api/github/repos/${owner}/${repo}/branches`);
    return { status: res.status(), body: await res.json() };
  }

  async createGitHubRepo(data: Record<string, unknown>) {
    const res = await this.request.post(`${BASE_URL}/api/github/repos`, { data });
    return { status: res.status(), body: await res.json() };
  }

  // ─── Orchestrator Env Vars ────────────────────────────────────
  async listOrchestratorEnvVars() {
    const res = await this.request.get(`${BASE_URL}/api/orchestrator-env-vars`);
    return { status: res.status(), body: await res.json() };
  }

  // ─── Package Manager Domains ──────────────────────────────────
  async listPackageManagerDomains() {
    const res = await this.request.get(`${BASE_URL}/api/package-manager-domains`);
    return { status: res.status(), body: await res.json() };
  }

  // ─── Usage ──────────────────────────────────────────────────
  async getUsageStatus() {
    const res = await this.request.get(`${BASE_URL}/api/usage`);
    return { status: res.status(), body: await res.json() };
  }

  // ─── Updates ──────────────────────────────────────────────────
  async getUpdateStatus() {
    const res = await this.request.get(`${BASE_URL}/api/updates`);
    return { status: res.status(), body: await res.json() };
  }

  async checkForUpdates() {
    const res = await this.request.post(`${BASE_URL}/api/updates/check`);
    return { status: res.status(), body: await res.json() };
  }

  async applyUpdates(images?: string[]) {
    const data = images ? { images } : {};
    const res = await this.request.post(`${BASE_URL}/api/updates/apply`, { data });
    return { status: res.status(), body: await res.json() };
  }

  async pruneImages() {
    const res = await this.request.post(`${BASE_URL}/api/updates/prune`);
    return { status: res.status(), body: await res.json() };
  }

  // ─── Capabilities ──────────────────────────────────────────────
  async listCapabilities() {
    const res = await this.request.get(`${BASE_URL}/api/capabilities`);
    return { status: res.status(), body: await res.json() };
  }

  async createCapability(data: Record<string, unknown>) {
    const res = await this.request.post(`${BASE_URL}/api/capabilities`, { data });
    return { status: res.status(), body: await res.json() };
  }

  async getCapability(id: string) {
    const res = await this.request.get(`${BASE_URL}/api/capabilities/${id}`);
    return { status: res.status(), body: await res.json() };
  }

  async updateCapability(id: string, data: Record<string, unknown>) {
    const res = await this.request.put(`${BASE_URL}/api/capabilities/${id}`, { data });
    return { status: res.status(), body: await res.json() };
  }

  async deleteCapability(id: string) {
    const res = await this.request.delete(`${BASE_URL}/api/capabilities/${id}`);
    return { status: res.status(), body: await res.json() };
  }

  // ─── Instructions ──────────────────────────────────────────────
  async listInstructions() {
    const res = await this.request.get(`${BASE_URL}/api/instructions`);
    return { status: res.status(), body: await res.json() };
  }

  async createInstruction(data: Record<string, unknown>) {
    const res = await this.request.post(`${BASE_URL}/api/instructions`, { data });
    return { status: res.status(), body: await res.json() };
  }

  async getInstruction(id: string) {
    const res = await this.request.get(`${BASE_URL}/api/instructions/${id}`);
    return { status: res.status(), body: await res.json() };
  }

  async updateInstruction(id: string, data: Record<string, unknown>) {
    const res = await this.request.put(`${BASE_URL}/api/instructions/${id}`, { data });
    return { status: res.status(), body: await res.json() };
  }

  async deleteInstruction(id: string) {
    const res = await this.request.delete(`${BASE_URL}/api/instructions/${id}`);
    return { status: res.status(), body: await res.json() };
  }

  // ─── Init Scripts ──────────────────────────────────────────────
  async listInitScripts() {
    const res = await this.request.get(`${BASE_URL}/api/init-scripts`);
    return { status: res.status(), body: await res.json() };
  }

  async createInitScript(data: Record<string, unknown>) {
    const res = await this.request.post(`${BASE_URL}/api/init-scripts`, { data });
    return { status: res.status(), body: await res.json() };
  }

  async getInitScript(id: string) {
    const res = await this.request.get(`${BASE_URL}/api/init-scripts/${id}`);
    return { status: res.status(), body: await res.json() };
  }

  async updateInitScript(id: string, data: Record<string, unknown>) {
    const res = await this.request.put(`${BASE_URL}/api/init-scripts/${id}`, { data });
    return { status: res.status(), body: await res.json() };
  }

  async deleteInitScript(id: string) {
    const res = await this.request.delete(`${BASE_URL}/api/init-scripts/${id}`);
    return { status: res.status(), body: await res.json() };
  }

  // ─── Settings ──────────────────────────────────────────────────
  async getSettings() {
    const res = await this.request.get(`${BASE_URL}/api/settings`);
    return { status: res.status(), body: await res.json() };
  }

  // ─── Account env vars (per-user) ──────────────────────────────
  async getAccountEnvVars() {
    const res = await this.request.get(`${BASE_URL}/api/account/env-vars`);
    return { status: res.status(), body: await res.json().catch(() => ({})) };
  }

  async putAccountEnvVars(data: Record<string, unknown>) {
    const res = await this.request.put(`${BASE_URL}/api/account/env-vars`, { data });
    return { status: res.status(), body: await res.json().catch(() => ({})) };
  }

  // ─── Account agent credentials (per-user OAuth file status) ───
  async listAccountAgentCredentials() {
    const res = await this.request.get(`${BASE_URL}/api/account/agent-credentials`);
    return { status: res.status(), body: await res.json().catch(() => ({})) };
  }

  async resetAccountAgentCredential(agentId: string) {
    const res = await this.request.delete(`${BASE_URL}/api/account/agent-credentials/${agentId}`);
    return { status: res.status(), body: await res.json().catch(() => ({})) };
  }

  // ─── Agent API Domains ─────────────────────────────────────────
  async listAgentApiDomains() {
    const res = await this.request.get(`${BASE_URL}/api/agent-api-domains`);
    return { status: res.status(), body: await res.json() };
  }

  // ─── Usage Refresh ─────────────────────────────────────────────
  async refreshUsage() {
    const res = await this.request.post(`${BASE_URL}/api/usage/refresh`);
    return { status: res.status(), body: await res.json() };
  }

  // ─── Logs ────────────────────────────────────────────────────────
  async queryLogs(query?: Record<string, string | number>) {
    const params = new URLSearchParams();
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        params.set(k, String(v));
      }
    }
    const qs = params.toString();
    const url = qs ? `${BASE_URL}/api/logs?${qs}` : `${BASE_URL}/api/logs`;
    const res = await this.request.get(url);
    return { status: res.status(), body: await res.json() };
  }

  async clearLogs() {
    const res = await this.request.delete(`${BASE_URL}/api/logs`);
    return { status: res.status(), body: await res.json() };
  }

  async getLogSources() {
    const res = await this.request.get(`${BASE_URL}/api/log-sources`);
    return { status: res.status(), body: await res.json() };
  }

  // ─── Domain Mappings Batch ─────────────────────────────────────
  async createDomainMappingsBatch(data: Record<string, unknown>) {
    const res = await this.request.post(`${BASE_URL}/api/domain-mappings/batch`, { data });
    return { status: res.status(), body: await res.json() };
  }
}
