import { test, expect } from '@playwright/test';
import { ApiClient } from '../helpers/api-client';

test.describe('Usage API', () => {
  test.describe('GET /api/usage', () => {
    test('returns 200 with agents array', async ({ request }) => {
      const api = new ApiClient(request);
      const { status, body } = await api.getUsageStatus();
      expect(status).toBe(200);
      expect(Array.isArray(body.agents)).toBe(true);
    });

    test('includes all three agents', async ({ request }) => {
      const api = new ApiClient(request);
      const { body } = await api.getUsageStatus();
      const ids = body.agents.map((a: { agentId: string }) => a.agentId);
      expect(ids).toContain('claude');
      expect(ids).toContain('codex');
      expect(ids).toContain('gemini');
    });

    test('each agent has required fields', async ({ request }) => {
      const api = new ApiClient(request);
      const { body } = await api.getUsageStatus();
      for (const agent of body.agents) {
        expect(typeof agent.agentId).toBe('string');
        expect(typeof agent.displayName).toBe('string');
        expect(['oauth', 'api-key', 'none']).toContain(agent.authType);
        expect(typeof agent.usageAvailable).toBe('boolean');
        expect(Array.isArray(agent.windows)).toBe(true);
      }
    });

    test('windows have valid structure when present', async ({ request }) => {
      const api = new ApiClient(request);
      const { body } = await api.getUsageStatus();
      for (const agent of body.agents) {
        for (const window of agent.windows) {
          expect(typeof window.label).toBe('string');
          expect(typeof window.utilization).toBe('number');
          expect(window.utilization).toBeGreaterThanOrEqual(0);
          expect(window.utilization).toBeLessThanOrEqual(100);
          expect(window.resetsAt === null || typeof window.resetsAt === 'string').toBe(true);
        }
      }
    });

    test('agents have lastChecked timestamp', async ({ request }) => {
      const api = new ApiClient(request);
      const { body } = await api.getUsageStatus();
      for (const agent of body.agents) {
        if (agent.lastChecked) {
          expect(typeof agent.lastChecked).toBe('string');
          // Should be a valid ISO date
          expect(new Date(agent.lastChecked).getTime()).not.toBeNaN();
        }
      }
    });
  });
});
