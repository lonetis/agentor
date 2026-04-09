<script setup lang="ts">
definePageMeta({ layout: false, auth: false });
useHead({ title: 'Setup — Agentor' });

const { signIn } = useAuth();

const name = ref('');
const email = ref('');
const password = ref('');
const confirmPassword = ref('');
const error = ref('');
const loading = ref(false);

onMounted(async () => {
  // If setup is already complete, redirect to login
  try {
    const status = await $fetch<{ needsSetup: boolean }>('/api/setup/status');
    if (!status.needsSetup) {
      await navigateTo('/login');
    }
  } catch {
    // ignore
  }
});

async function handleSubmit() {
  error.value = '';

  if (!name.value || !email.value || !password.value) {
    error.value = 'All fields required';
    return;
  }
  if (password.value.length < 8) {
    error.value = 'Password must be at least 8 characters';
    return;
  }
  if (password.value !== confirmPassword.value) {
    error.value = 'Passwords do not match';
    return;
  }

  loading.value = true;
  try {
    await $fetch('/api/setup/create-admin', {
      method: 'POST',
      body: { email: email.value, password: password.value, name: name.value },
    });

    // Sign in as the newly created admin
    await signIn(email.value, password.value);
    await navigateTo('/');
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

        <form @submit.prevent="handleSubmit" class="space-y-4">
          <UFormField label="Name" required>
            <UInput v-model="name" placeholder="Admin" autocomplete="name" autofocus class="w-full" />
          </UFormField>

          <UFormField label="Email" required>
            <UInput v-model="email" type="email" placeholder="admin@example.com" autocomplete="email" class="w-full" />
          </UFormField>

          <UFormField label="Password" required hint="Minimum 8 characters">
            <UInput v-model="password" type="password" autocomplete="new-password" class="w-full" />
          </UFormField>

          <UFormField label="Confirm password" required>
            <UInput v-model="confirmPassword" type="password" autocomplete="new-password" class="w-full" />
          </UFormField>

          <p v-if="error" class="text-sm text-red-600 dark:text-red-400">{{ error }}</p>

          <UButton type="submit" :loading="loading" block color="primary">Create admin & sign in</UButton>
        </form>
      </div>
    </div>
  </div>
</template>
