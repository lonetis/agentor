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

/** A failed session check without an HTTP answer, or a gateway / server error. */
function isServerUnreachable(error: unknown): boolean {
  if (!error) return false;
  const status = (error as { status?: number }).status;
  return status === undefined || status === 0 || status >= 500;
}

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
    // The session could not be checked at all (network down, server restarting)
    // — that is not "signed out". With the PWA worker active, show its offline
    // page, which reconnects by itself, instead of a login form that cannot work.
    if (isServerUnreachable(session.value?.error) && navigator.serviceWorker?.controller) {
      window.location.replace('/offline.html');
      return abortNavigation();
    }
    // Carry an OAuth authorization's signed query over to the login page, so
    // signing in resumes the authorization instead of opening the dashboard.
    if (to.path === '/oauth/consent') return navigateTo({ path: '/login', query: to.query });
    return navigateTo('/login');
  }
});
