import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mock node:fs/promises ---
const mockReadFile = vi.fn();
const mockWriteFile = vi.fn().mockResolvedValue(undefined);
const mockStat = vi.fn();
const mockChown = vi.fn().mockResolvedValue(undefined);

vi.mock('node:fs/promises', () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  stat: (...args: unknown[]) => mockStat(...args),
  chown: (...args: unknown[]) => mockChown(...args),
}));

// --- Mock dockerode ---
const mockContainerInspect = vi.fn();
const mockGetContainer = vi.fn().mockReturnValue({
  inspect: mockContainerInspect,
});

vi.mock('dockerode', () => {
  const MockDocker = vi.fn().mockImplementation(() => ({
    getContainer: mockGetContainer,
  }));
  return { default: MockDocker };
});

import { CredentialMountManager, AGENT_CREDENTIAL_MAPPINGS } from '../../utils/credential-mounts';
import Docker from 'dockerode';

describe('CredentialMountManager', () => {
  let docker: Docker;
  let manager: CredentialMountManager;

  beforeEach(() => {
    vi.clearAllMocks();
    docker = new Docker();
    manager = new CredentialMountManager(docker);
  });

  describe('isEnabled', () => {
    it('false before init', () => {
      expect(manager.isEnabled()).toBe(false);
    });

    it('false when HOSTNAME not set', async () => {
      const origHostname = process.env.HOSTNAME;
      delete process.env.HOSTNAME;

      await manager.init();
      expect(manager.isEnabled()).toBe(false);

      // Restore
      if (origHostname !== undefined) process.env.HOSTNAME = origHostname;
    });
  });

  describe('getBindMounts', () => {
    it('returns empty before init', () => {
      expect(manager.getBindMounts()).toEqual([]);
    });

    it('returns correct bind mount paths when hostPath set', async () => {
      const origHostname = process.env.HOSTNAME;
      process.env.HOSTNAME = 'test-container';

      mockContainerInspect.mockResolvedValueOnce({
        Mounts: [
          { Destination: '/cred', Source: '/host/path/to/cred' },
        ],
      });
      // All credential files exist
      mockStat.mockResolvedValue({});

      await manager.init();
      const binds = manager.getBindMounts();
      expect(binds).toHaveLength(3);
      expect(binds[0]).toBe('/host/path/to/cred/claude.json:/home/agent/.claude/.credentials.json');
      expect(binds[1]).toBe('/host/path/to/cred/codex.json:/home/agent/.codex/auth.json');
      expect(binds[2]).toBe('/host/path/to/cred/gemini.json:/home/agent/.gemini/oauth_creds.json');

      if (origHostname !== undefined) process.env.HOSTNAME = origHostname;
      else delete process.env.HOSTNAME;
    });
  });

  describe('AGENT_CREDENTIAL_MAPPINGS', () => {
    it('has correct entries for claude, codex, gemini', () => {
      expect(AGENT_CREDENTIAL_MAPPINGS).toHaveLength(3);

      const claude = AGENT_CREDENTIAL_MAPPINGS.find((m) => m.agentId === 'claude');
      expect(claude).toBeDefined();
      expect(claude!.fileName).toBe('claude.json');
      expect(claude!.containerPath).toBe('/home/agent/.claude/.credentials.json');

      const codex = AGENT_CREDENTIAL_MAPPINGS.find((m) => m.agentId === 'codex');
      expect(codex).toBeDefined();
      expect(codex!.fileName).toBe('codex.json');
      expect(codex!.containerPath).toBe('/home/agent/.codex/auth.json');

      const gemini = AGENT_CREDENTIAL_MAPPINGS.find((m) => m.agentId === 'gemini');
      expect(gemini).toBeDefined();
      expect(gemini!.fileName).toBe('gemini.json');
      expect(gemini!.containerPath).toBe('/home/agent/.gemini/oauth_creds.json');
    });
  });

  describe('getCredentialStatus', () => {
    it('returns true for file with content', async () => {
      mockReadFile.mockResolvedValueOnce('{"claudeAiOauth": {"accessToken": "tok"}}');
      const result = await manager.getCredentialStatus('claude.json');
      expect(result).toBe(true);
    });

    it('returns false for empty/missing file', async () => {
      mockReadFile.mockResolvedValueOnce('{}');
      const result = await manager.getCredentialStatus('claude.json');
      expect(result).toBe(false);
    });

    it('returns false for file read error', async () => {
      mockReadFile.mockRejectedValueOnce(new Error('ENOENT'));
      const result = await manager.getCredentialStatus('nonexistent.json');
      expect(result).toBe(false);
    });
  });

  describe('init', () => {
    it('creates missing credential files', async () => {
      const origHostname = process.env.HOSTNAME;
      process.env.HOSTNAME = 'test-container';

      mockContainerInspect.mockResolvedValueOnce({
        Mounts: [
          { Destination: '/cred', Source: '/host/path/to/cred' },
        ],
      });

      // First file exists, second and third don't
      mockStat
        .mockResolvedValueOnce({}) // claude.json exists
        .mockRejectedValueOnce(new Error('ENOENT')) // codex.json missing
        .mockRejectedValueOnce(new Error('ENOENT')); // gemini.json missing

      await manager.init();

      // Should have written 2 missing files
      expect(mockWriteFile).toHaveBeenCalledTimes(2);
      expect(mockChown).toHaveBeenCalledTimes(2);

      if (origHostname !== undefined) process.env.HOSTNAME = origHostname;
      else delete process.env.HOSTNAME;
    });
  });
});
