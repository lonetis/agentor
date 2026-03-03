import { describe, it, expect } from 'vitest';
import { listGitProviders, getAllGitCloneDomains, GIT_PROVIDER_REGISTRY } from '../../utils/git-providers';

describe('git-providers', () => {
  describe('listGitProviders', () => {
    it('returns array with github', () => {
      const providers = listGitProviders();
      expect(providers).toBeInstanceOf(Array);
      const ids = providers.map((p) => p.id);
      expect(ids).toContain('github');
    });
  });

  describe('github provider fields', () => {
    it('has correct fields', () => {
      const github = GIT_PROVIDER_REGISTRY.github;
      expect(github.id).toBe('github');
      expect(github.displayName).toBe('GitHub');
      expect(github.placeholder).toBeTruthy();
      expect(github.tokenConfigKey).toBe('githubToken');
      expect(github.tokenEnvVar).toBe('GITHUB_TOKEN');
    });
  });

  describe('getAllGitCloneDomains', () => {
    it('returns domains from all providers', () => {
      const domains = getAllGitCloneDomains();
      expect(domains).toBeInstanceOf(Array);
      expect(domains.length).toBeGreaterThan(0);
    });

    it('deduplicates domains', () => {
      const domains = getAllGitCloneDomains();
      const unique = new Set(domains);
      expect(domains.length).toBe(unique.size);
    });

    it('includes github.com', () => {
      const domains = getAllGitCloneDomains();
      expect(domains).toContain('github.com');
    });
  });
});
