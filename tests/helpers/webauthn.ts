import type { Page, CDPSession } from '@playwright/test';

/**
 * Helpers for end-to-end passkey tests using Chrome DevTools' virtual
 * WebAuthn authenticator. The virtual authenticator behaves like a real
 * platform credential (Touch ID, Windows Hello, etc.) but is fully
 * scriptable from Playwright — no real biometric prompt ever appears.
 *
 * Usage:
 *   const auth = await installVirtualAuthenticator(page);
 *   // ... run passkey flows ...
 *   await auth.dispose();
 */
export interface VirtualAuthenticator {
  cdp: CDPSession;
  authenticatorId: string;
  /** Remove the virtual authenticator and its credentials. */
  dispose: () => Promise<void>;
  /** List the credentials currently held by the authenticator. */
  listCredentials: () => Promise<unknown[]>;
  /** Remove all stored credentials (forgets all passkeys). */
  clearCredentials: () => Promise<void>;
}

export async function installVirtualAuthenticator(page: Page): Promise<VirtualAuthenticator> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable', { enableUI: false });

  const result: any = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      ctap2Version: 'ctap2_1',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      automaticPresenceSimulation: true,
      isUserVerified: true,
    },
  });
  const authenticatorId: string = result.authenticatorId;

  return {
    cdp,
    authenticatorId,
    async listCredentials() {
      const r: any = await cdp.send('WebAuthn.getCredentials', { authenticatorId });
      return r.credentials || [];
    },
    async clearCredentials() {
      await cdp.send('WebAuthn.clearCredentials', { authenticatorId });
    },
    async dispose() {
      try {
        await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
      } catch {
        // Ignore — page may have already been closed.
      }
      try {
        await cdp.detach();
      } catch {
        // Ignore.
      }
    },
  };
}
