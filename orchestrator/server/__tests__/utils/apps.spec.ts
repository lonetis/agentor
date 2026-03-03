import { describe, it, expect } from 'vitest';
import { getAppType, listAppTypes } from '../../utils/apps';

describe('apps', () => {
  describe('getAppType', () => {
    it('returns chromium config', () => {
      const app = getAppType('chromium');
      expect(app).toBeDefined();
      expect(app!.id).toBe('chromium');
      expect(app!.displayName).toBe('Chromium');
    });

    it('returns socks5 config', () => {
      const app = getAppType('socks5');
      expect(app).toBeDefined();
      expect(app!.id).toBe('socks5');
      expect(app!.displayName).toBe('SOCKS5 Proxy');
    });

    it('returns undefined for nonexistent type', () => {
      expect(getAppType('nonexistent')).toBeUndefined();
    });
  });

  describe('listAppTypes', () => {
    it('returns array with all registered types', () => {
      const types = listAppTypes();
      expect(types).toBeInstanceOf(Array);
      const ids = types.map((t) => t.id);
      expect(ids).toContain('chromium');
      expect(ids).toContain('socks5');
    });
  });

  describe('port ranges', () => {
    it('chromium port range: 9222-9322', () => {
      const app = getAppType('chromium')!;
      expect(app.ports[0].internalPortStart).toBe(9222);
      expect(app.ports[0].internalPortEnd).toBe(9322);
    });

    it('socks5 port range: 1080-1180', () => {
      const app = getAppType('socks5')!;
      expect(app.ports[0].internalPortStart).toBe(1080);
      expect(app.ports[0].internalPortEnd).toBe(1180);
    });
  });

  describe('registry invariants', () => {
    it('all app types have maxInstances > 0', () => {
      for (const app of listAppTypes()) {
        expect(app.maxInstances).toBeGreaterThan(0);
      }
    });

    it('all app types have manageScript set', () => {
      for (const app of listAppTypes()) {
        expect(app.manageScript).toBeTruthy();
      }
    });
  });
});
