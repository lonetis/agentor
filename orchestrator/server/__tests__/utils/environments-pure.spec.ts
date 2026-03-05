import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DEFAULT_PACKAGE_MANAGER_DOMAINS, getPackageManagerDomains } from '../../utils/environments';

describe('environments pure logic', () => {
  describe('DEFAULT_PACKAGE_MANAGER_DOMAINS', () => {
    it('is a non-empty array', () => {
      expect(DEFAULT_PACKAGE_MANAGER_DOMAINS).toBeInstanceOf(Array);
      expect(DEFAULT_PACKAGE_MANAGER_DOMAINS.length).toBeGreaterThan(0);
    });

    it('includes registry.npmjs.org', () => {
      expect(DEFAULT_PACKAGE_MANAGER_DOMAINS).toContain('registry.npmjs.org');
    });

    it('includes pypi.org', () => {
      expect(DEFAULT_PACKAGE_MANAGER_DOMAINS).toContain('pypi.org');
    });

    it('has expected count (about 98)', () => {
      expect(DEFAULT_PACKAGE_MANAGER_DOMAINS.length).toBeGreaterThanOrEqual(90);
      expect(DEFAULT_PACKAGE_MANAGER_DOMAINS.length).toBeLessThanOrEqual(110);
    });
  });

  describe('getPackageManagerDomains', () => {
    beforeEach(() => {
      vi.stubEnv('PACKAGE_MANAGER_DOMAINS', '');
      vi.stubEnv('GITHUB_TOKEN', '');
      vi.stubEnv('ANTHROPIC_API_KEY', '');
      vi.stubEnv('OPENAI_API_KEY', '');
      vi.stubEnv('GEMINI_API_KEY', '');
      vi.stubEnv('BASE_DOMAINS', '');
      vi.stubEnv('DASHBOARD_BASE_DOMAIN', '');
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('returns defaults when env var not set', () => {
      const domains = getPackageManagerDomains();
      expect(domains).toEqual(DEFAULT_PACKAGE_MANAGER_DOMAINS);
    });

    it('returns custom list when PACKAGE_MANAGER_DOMAINS is set', () => {
      vi.stubEnv('PACKAGE_MANAGER_DOMAINS', 'custom.registry.com,another.org');
      const domains = getPackageManagerDomains();
      expect(domains).toEqual(['custom.registry.com', 'another.org']);
    });
  });
});
