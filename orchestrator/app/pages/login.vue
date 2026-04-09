<script setup lang="ts">
definePageMeta({ layout: false, auth: false });
useHead({ title: 'Sign in — Agentor' });

const { signIn, isLoggedIn } = useAuth();

const email = ref('');
const password = ref('');
const error = ref('');
const loading = ref(false);

// If already signed in, send to dashboard
onMounted(async () => {
  // Check setup status — if needed, redirect to setup
  try {
    const status = await $fetch<{ needsSetup: boolean }>('/api/setup/status');
    if (status.needsSetup) {
      await navigateTo('/setup');
      return;
    }
  } catch {
    // ignore — proceed to login form
  }
  if (isLoggedIn.value) {
    await navigateTo('/');
  }
});

async function handleSubmit() {
  error.value = '';
  if (!email.value || !password.value) {
    error.value = 'Email and password required';
    return;
  }
  loading.value = true;
  try {
    const result = await signIn(email.value, password.value);
    if ((result as any)?.error) {
      error.value = (result as any).error.message || 'Sign-in failed';
      return;
    }
    // Force a full page reload so the global auth middleware picks up the
    // new session cookie and lets us into the dashboard.
    if (typeof window !== 'undefined') {
      window.location.href = '/';
      return;
    }
    await navigateTo('/');
  } catch (err: any) {
    error.value = err?.message || 'Sign-in failed';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 p-4">
    <div class="w-full max-w-sm">
      <div class="text-center mb-8">
        <h1 class="text-3xl font-bold text-gray-900 dark:text-gray-100">Agentor</h1>
        <p class="text-gray-500 dark:text-gray-400 mt-1">Orchestrator</p>
      </div>

      <div class="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-800 p-6">
        <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Sign in</h2>

        <form @submit.prevent="handleSubmit" class="space-y-4">
          <UFormField label="Email" required>
            <UInput v-model="email" type="email" placeholder="you@example.com" autocomplete="email" autofocus class="w-full" />
          </UFormField>

          <UFormField label="Password" required>
            <UInput v-model="password" type="password" placeholder="••••••••" autocomplete="current-password" class="w-full" />
          </UFormField>

          <p v-if="error" class="text-sm text-red-600 dark:text-red-400">{{ error }}</p>

          <UButton type="submit" :loading="loading" block color="primary">Sign in</UButton>
        </form>
      </div>
    </div>
  </div>
</template>
