<script setup lang="ts">
definePageMeta({ layout: false, auth: false });
useHead({ title: 'Setup — Agentor' });

const { client, signIn } = useAuth();

const mode = ref<'password' | 'passkey'>('password');
const passkeysEnabled = ref(false);
const name = ref('');
const email = ref('');
const password = ref('');
const confirmPassword = ref('');
const error = ref('');
const loading = ref(false);

onMounted(async () => {
  try {
    const status = await $fetch<{ needsSetup: boolean; passkeysEnabled: boolean }>('/api/setup/status');
    if (!status.needsSetup) {
      await navigateTo('/login');
      return;
    }
    passkeysEnabled.value = status.passkeysEnabled;
    // If passkeys aren't available force password mode — the toggle is hidden.
    if (!passkeysEnabled.value) {
      mode.value = 'password';
    }
  } catch {
    // ignore
  }
});

function reload() {
  if (typeof window !== 'undefined') window.location.href = '/';
}

async function handleSubmit() {
  error.value = '';
  if (!name.value || !email.value) {
    error.value = 'Name and email are required';
    return;
  }

  loading.value = true;
  try {
    if (mode.value === 'password') {
      if (!password.value || password.value.length < 8) {
        error.value = 'Password must be at least 8 characters';
        return;
      }
      if (password.value !== confirmPassword.value) {
        error.value = 'Passwords do not match';
        return;
      }
      await $fetch('/api/setup/create-admin', {
        method: 'POST',
        body: { email: email.value, password: password.value, name: name.value },
      });
      await signIn(email.value, password.value);
      reload();
      return;
    }

    // Passkey path
    const tokenRes = await $fetch<{ token: string }>('/api/setup/create-admin-passkey-token', {
      method: 'POST',
      body: { email: email.value, name: name.value },
    });

    const result: any = await client.passkey.addPasskey({
      name: 'Primary passkey',
      context: tokenRes.token,
    });
    if (result?.error) {
      error.value = result.error.message || 'Passkey registration failed';
      return;
    }

    // The user is created but not yet signed in. Trigger a passkey sign-in.
    const signInRes: any = await client.signIn.passkey();
    if (signInRes?.error) {
      error.value = signInRes.error.message || 'Sign-in after registration failed';
      return;
    }
    reload();
  } catch (err: any) {
    error.value = err?.data?.statusMessage || err?.message || 'Setup failed';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 p-4">
    <div class="w-full max-w-md">
      <div class="text-center mb-8">
        <h1 class="text-3xl font-bold text-gray-900 dark:text-gray-100">Welcome to Agentor</h1>
        <p class="text-gray-500 dark:text-gray-400 mt-1">Create the first admin account to get started</p>
      </div>

      <div class="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-800 p-6">
        <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Initial setup</h2>

        <!-- Method toggle — only shown when passkeys are enabled -->
        <div v-if="passkeysEnabled" class="flex rounded-md bg-gray-100 dark:bg-gray-800 p-0.5 mb-4 text-sm">
          <button
            type="button"
            class="flex-1 px-3 py-1.5 rounded transition-colors"
            :class="mode === 'password'
              ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm font-medium'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'"
            @click="mode = 'password'"
          >
            Password
          </button>
          <button
            type="button"
            class="flex-1 px-3 py-1.5 rounded transition-colors"
            :class="mode === 'passkey'
              ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm font-medium'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'"
            @click="mode = 'passkey'"
          >
            Passkey
          </button>
        </div>

        <form @submit.prevent="handleSubmit" class="space-y-4">
          <UFormField label="Name" required>
            <UInput v-model="name" placeholder="Admin" autocomplete="name" autofocus class="w-full" />
          </UFormField>

          <UFormField label="Email" required>
            <UInput v-model="email" type="email" placeholder="admin@example.com" autocomplete="email" class="w-full" />
          </UFormField>

          <template v-if="mode === 'password'">
            <UFormField label="Password" required hint="Minimum 8 characters">
              <UInput v-model="password" type="password" autocomplete="new-password" class="w-full" />
            </UFormField>

            <UFormField label="Confirm password" required>
              <UInput v-model="confirmPassword" type="password" autocomplete="new-password" class="w-full" />
            </UFormField>
          </template>

          <p v-if="mode === 'passkey'" class="text-sm text-gray-600 dark:text-gray-400">
            Your browser will prompt you to register a passkey on this device. You won't need a password.
          </p>

          <p v-if="error" class="text-sm text-red-600 dark:text-red-400">{{ error }}</p>

          <UButton type="submit" :loading="loading" block color="primary">
            {{ mode === 'passkey' ? 'Create admin with passkey' : 'Create admin & sign in' }}
          </UButton>
        </form>
      </div>
    </div>
  </div>
</template>
