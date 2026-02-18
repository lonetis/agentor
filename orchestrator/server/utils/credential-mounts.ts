import Docker from 'dockerode';
import { readFile, writeFile, stat, chown } from 'node:fs/promises';
import { join } from 'node:path';

interface AgentCredentialMapping {
  agentId: string;
  fileName: string;
  containerPath: string;
}

export const AGENT_CREDENTIAL_MAPPINGS: AgentCredentialMapping[] = [
  { agentId: 'claude', fileName: 'claude.json', containerPath: '/home/agent/.claude/.credentials.json' },
  { agentId: 'codex', fileName: 'codex.json', containerPath: '/home/agent/.codex/auth.json' },
  { agentId: 'gemini', fileName: 'gemini.json', containerPath: '/home/agent/.gemini/oauth_creds.json' },
];

const CRED_CONTAINER_PATH = '/cred';
const AGENT_UID = 1000;
const AGENT_GID = 1000;

export class CredentialMountManager {
  private docker: Docker;
  private hostPath: string | null = null;

  constructor(docker: Docker) {
    this.docker = docker;
  }

  async init(): Promise<void> {
    // Resolve host path of /cred mount via container self-inspection
    const hostname = process.env.HOSTNAME;
    if (!hostname) {
      console.log('[credential-mounts] HOSTNAME not set — credential bind mounts disabled');
      return;
    }

    try {
      const container = this.docker.getContainer(hostname);
      const info = await container.inspect();

      const credMount = info.Mounts?.find(
        (m: { Destination: string }) => m.Destination === CRED_CONTAINER_PATH
      );
      if (!credMount) {
        console.log('[credential-mounts] /cred not mounted on orchestrator — credential bind mounts disabled');
        return;
      }

      this.hostPath = credMount.Source;
      console.log(`[credential-mounts] resolved host path: ${this.hostPath}`);

      // Ensure each credential file exists (create as {} if missing)
      for (const mapping of AGENT_CREDENTIAL_MAPPINGS) {
        const filePath = join(CRED_CONTAINER_PATH, mapping.fileName);
        try {
          await stat(filePath);
        } catch {
          await writeFile(filePath, '{}', { mode: 0o600 });
          await chown(filePath, AGENT_UID, AGENT_GID);
          console.log(`[credential-mounts] created ${mapping.fileName}`);
        }
      }
    } catch (err: unknown) {
      console.error('[credential-mounts] init failed:', err instanceof Error ? err.message : err);
    }
  }

  getBindMounts(): string[] {
    if (!this.hostPath) return [];

    return AGENT_CREDENTIAL_MAPPINGS.map(
      (m) => `${join(this.hostPath!, m.fileName)}:${m.containerPath}`
    );
  }

  isEnabled(): boolean {
    return this.hostPath !== null;
  }

  /**
   * Read a credential file and return whether it has real content (>3 bytes, i.e., more than `{}`).
   */
  async getCredentialStatus(fileName: string): Promise<boolean> {
    try {
      const content = await readFile(join(CRED_CONTAINER_PATH, fileName), 'utf-8');
      return content.trim().length > 2;
    } catch {
      return false;
    }
  }
}
