/**
 * Global route middleware that enforces auth for all client-side pages.
 * - /setup and /login are always allowed.
 * - If no users exist (first-run), redirect to /setup.
 * - If not signed in, redirect to /login.
 */
export default defineNuxtRouteMiddleware(async (to) => {
  // Always allow the setup and login pages
  if (to.path === '/setup' || to.path === '/login') return;

  // Check first-run setup status (cheap, cached in memory after first call)
  let needsSetup = false;
  try {
    const status = await $fetch<{ needsSetup: boolean }>('/api/setup/status');
    needsSetup = status.needsSetup;
  } catch {
    // If the status endpoint fails, proceed and let the session check handle it
  }

  if (needsSetup) {
    return navigateTo('/setup');
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
