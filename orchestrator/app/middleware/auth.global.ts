/**
 * Global route middleware that enforces auth for all client-side pages.
 * - /setup and /login are always allowed.
 * - If no users exist (first-run), redirect to /setup.
 * - If not signed in, redirect to /login.
 */

// First-run setup only flips true→false (once an admin exists it never reverts
// within the SPA's lifetime). Cache the resolved `false` so navigation no longer
// round-trips /api/setup/status on every route change. A `true` result is NOT
// cached so that completing setup is picked up on the next navigation.
let setupCompleted = false;

export default defineNuxtRouteMiddleware(async (to) => {
  // Always allow the setup and login pages
  if (to.path === '/setup' || to.path === '/login') return;

  if (!setupCompleted) {
    try {
      const status = await $fetch<{ needsSetup: boolean }>('/api/setup/status');
      if (status.needsSetup) {
        return navigateTo('/setup');
      }
      // Only cache a confirmed "setup complete" — a failed fetch falls through
      // and is re-checked on the next navigation.
      setupCompleted = true;
    } catch {
      // If the status endpoint fails, proceed and let the session check handle it
    }
  }

  const { isLoggedIn, isLoading, session } = useAuth();

  // Better-auth's useSession fetches asynchronously. Wait one tick if still loading.
  if (isLoading.value) {
    await new Promise<void>((resolve) => {
      const stop = watch([isLoading, session], () => {
        if (!isLoading.value) {
          stop();
          resolve();
        }
      }, { immediate: true });
    });
  }

  if (!isLoggedIn.value) {
    return navigateTo('/login');
  }
});
