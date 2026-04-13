<script setup lang="ts">
definePageMeta({ layout: false, auth: false });
useHead({ title: 'Sign in — Agentor' });

const { client, signIn, isLoggedIn } = useAuth();

const email = ref('');
const password = ref('');
const error = ref('');
const loading = ref(false);
const passkeyLoading = ref(false);
const passkeysEnabled = ref(false);

// If already signed in, send to dashboard
onMounted(async () => {
  try {
    const status = await $fetch<{ needsSetup: boolean; passkeysEnabled: boolean }>('/api/setup/status');
    if (status.needsSetup) {
      await navigateTo('/setup');
      return;
    }
    passkeysEnabled.value = status.passkeysEnabled;
  } catch {
    // ignore
  }

  // Check the session directly — `isLoggedIn.value` comes from better-auth's
  // reactive `useSession()` hook which fetches async and may not be ready.
  try {
    const session: any = await $fetch('/api/auth/get-session');
    if (session?.user) {
      if (typeof window !== 'undefined') {
        window.location.href = '/';
      } else {
        await navigateTo('/');
      }
      return;
    }
  } catch {
    // ignore — fall through to the passkey conditional UI
  }

  if (!passkeysEnabled.value) return;

  // Conditional UI: kick off a passkey sign-in attempt that the browser
  // will autofill when the user focuses an input. Silently ignore if the
  // browser doesn't support it. Skip when navigator.webdriver is set
  // (Playwright/automation) — the pending autoFill ceremony interferes
  // with explicit `signIn.passkey()` calls from test runs.
  try {
    if ((navigator as any).webdriver) return;
    const PKC = (window as any).PublicKeyCredential;
    if (PKC?.isConditionalMediationAvailable && (await PKC.isConditionalMediationAvailable())) {
      void client.signIn.passkey({ autoFill: true }).then((result: any) => {
        if (result?.data && !result?.error) {
          window.location.href = '/';
        }
      });
    }
  } catch {
    // ignore — passkey not supported
  }
});

function reload() {
  if (typeof window !== 'undefined') window.location.href = '/';
}

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
    reload();
  } catch (err: any) {
    error.value = err?.message || 'Sign-in failed';
  } finally {
    loading.value = false;
  }
}

async function handlePasskeySignIn() {
  error.value = '';
  passkeyLoading.value = true;
  try {
    const result = await client.signIn.passkey();
    if ((result as any)?.error) {
      error.value = (result as any).error.message || 'Passkey sign-in failed';
      return;
    }
    reload();
  } catch (err: any) {
    error.value = err?.message || 'Passkey sign-in failed';
  } finally {
    passkeyLoading.value = false;
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
            <UInput
              v-model="email"
              type="email"
              placeholder="you@example.com"
              :autocomplete="passkeysEnabled ? 'email webauthn' : 'email'"
              autofocus
              class="w-full"
            />
          </UFormField>

          <UFormField label="Password" required>
            <UInput
              v-model="password"
              type="password"
              placeholder="••••••••"
              :autocomplete="passkeysEnabled ? 'current-password webauthn' : 'current-password'"
              class="w-full"
            />
          </UFormField>

          <p v-if="error" class="text-sm text-red-600 dark:text-red-400">{{ error }}</p>

          <UButton type="submit" :loading="loading" block color="primary">Sign in</UButton>
        </form>

        <template v-if="passkeysEnabled">
          <div class="my-4 flex items-center gap-3 text-xs uppercase tracking-wide text-gray-400 dark:text-gray-500">
            <div class="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
            <span>or</span>
            <div class="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
          </div>

          <UButton
            type="button"
            :loading="passkeyLoading"
            block
            color="neutral"
            variant="outline"
            icon="i-lucide-key-round"
            @click="handlePasskeySignIn"
          >
            Sign in with passkey
          </UButton>
        </template>
      </div>
    </div>
  </div>
</template>
