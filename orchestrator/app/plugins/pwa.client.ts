// Progressive Web App bootstrap: install-prompt capture + service worker.
//
// The outcome of the registration is exposed as `<html data-pwa-sw="…">`
// (unsupported | dev | insecure | registered | failed) for tests and debugging.

import { initPwa } from '~/composables/usePwa';

type ServiceWorkerState = 'unsupported' | 'dev' | 'insecure' | 'registered' | 'failed';

function setServiceWorkerState(state: ServiceWorkerState) {
  document.documentElement.dataset.pwaSw = state;
}

/** Our worker is the one at the root scope; code-server registers its own under /editor/<id>/. */
function isOwnRegistration(registration: ServiceWorkerRegistration): boolean {
  return new URL(registration.scope).pathname === '/';
}

async function unregisterOwnServiceWorker() {
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.filter(isOwnRegistration).map((r) => r.unregister()));
}

async function registerServiceWorker() {
  try {
    // updateViaCache 'none': the browser always revalidates sw.js itself.
    await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
    setServiceWorkerState('registered');
  } catch (err) {
    setServiceWorkerState('failed');
    console.warn('[pwa] service worker registration failed', err);
  }
}

export default defineNuxtPlugin(() => {
  initPwa();

  if (!('serviceWorker' in navigator)) {
    setServiceWorkerState('unsupported');
    return;
  }
  if (import.meta.dev) {
    // A worker left over from a production build on the same origin would
    // otherwise keep answering navigations during development.
    setServiceWorkerState('dev');
    unregisterOwnServiceWorker().catch((err) => {
      console.warn('[pwa] could not unregister the service worker', err);
    });
    return;
  }
  if (!window.isSecureContext) {
    // Plain http on a LAN address: no service worker and no install, which is fine.
    setServiceWorkerState('insecure');
    return;
  }
  // Register after load so the worker's install never competes with first paint.
  if (document.readyState === 'complete') void registerServiceWorker();
  else window.addEventListener('load', () => void registerServiceWorker(), { once: true });
});
