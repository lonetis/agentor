<script setup lang="ts">
const open = defineModel<boolean>('open', { default: false });

const { client, user: currentUser } = useAuth();

// Profile form (name + email)
const profile = reactive({ name: '', email: '' });
const profileLoading = ref(false);
const profileError = ref('');
const profileSuccess = ref('');

// Password form
const password = reactive({ current: '', next: '', confirm: '' });
const passwordLoading = ref(false);
const passwordError = ref('');
const passwordSuccess = ref('');

function resetMessages() {
  profileError.value = '';
  profileSuccess.value = '';
  passwordError.value = '';
  passwordSuccess.value = '';
}

watch(open, (v) => {
  if (v) {
    const u = currentUser.value as any;
    profile.name = u?.name || '';
    profile.email = u?.email || '';
    password.current = '';
    password.next = '';
    password.confirm = '';
    resetMessages();
  }
});

async function handleProfileSave() {
  resetMessages();
  const u = currentUser.value as any;
  if (!u) return;

  const newName = profile.name.trim();
  const newEmail = profile.email.trim().toLowerCase();

  if (!newName) {
    profileError.value = 'Name is required';
    return;
  }
  if (!newEmail || !newEmail.includes('@')) {
    profileError.value = 'Valid email is required';
    return;
  }

  profileLoading.value = true;
  try {
    // Update name only if changed
    if (newName !== u.name) {
      const res = await client.updateUser({ name: newName });
      if ((res as any)?.error) {
        profileError.value = (res as any).error.message || 'Failed to update name';
        return;
      }
    }

    // Update email only if changed (separate endpoint)
    if (newEmail !== u.email) {
      const res = await client.changeEmail({ newEmail });
      if ((res as any)?.error) {
        profileError.value = (res as any).error.message || 'Failed to update email';
        return;
      }
    }

    profileSuccess.value = 'Profile updated';
  } catch (err: any) {
    profileError.value = err?.message || 'Failed to update profile';
  } finally {
    profileLoading.value = false;
  }
}

async function handlePasswordSave() {
  resetMessages();

  if (!password.current || !password.next || !password.confirm) {
    passwordError.value = 'All password fields are required';
    return;
  }
  if (password.next.length < 8) {
    passwordError.value = 'New password must be at least 8 characters';
    return;
  }
  if (password.next !== password.confirm) {
    passwordError.value = 'New passwords do not match';
    return;
  }

  passwordLoading.value = true;
  try {
    const res = await client.changePassword({
      currentPassword: password.current,
      newPassword: password.next,
      revokeOtherSessions: false,
    });
    if ((res as any)?.error) {
      passwordError.value = (res as any).error.message || 'Failed to change password';
      return;
    }
    passwordSuccess.value = 'Password changed';
    password.current = '';
    password.next = '';
    password.confirm = '';
  } catch (err: any) {
    passwordError.value = err?.message || 'Failed to change password';
  } finally {
    passwordLoading.value = false;
  }
}
</script>

<template>
  <UModal v-model:open="open" :ui="{ content: 'sm:max-w-lg' }">
    <template #content>
      <div class="p-6 space-y-6 max-h-[90vh] overflow-y-auto">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Account settings</h2>
          <UButton size="sm" color="neutral" variant="ghost" @click="open = false">Close</UButton>
        </div>

        <!-- Profile section -->
        <section class="space-y-3">
          <h3 class="text-sm font-medium text-gray-900 dark:text-gray-100">Profile</h3>
          <UFormField label="Name" required>
            <UInput v-model="profile.name" autocomplete="name" class="w-full" />
          </UFormField>
          <UFormField label="Email" required>
            <UInput v-model="profile.email" type="email" autocomplete="email" class="w-full" />
          </UFormField>

          <p v-if="profileError" class="text-sm text-red-600 dark:text-red-400">{{ profileError }}</p>
          <p v-if="profileSuccess" class="text-sm text-emerald-600 dark:text-emerald-400">{{ profileSuccess }}</p>

          <div class="flex justify-end">
            <UButton size="sm" :loading="profileLoading" @click="handleProfileSave">Save profile</UButton>
          </div>
        </section>

        <div class="border-t border-gray-200 dark:border-gray-800"></div>

        <!-- Password section -->
        <section class="space-y-3">
          <h3 class="text-sm font-medium text-gray-900 dark:text-gray-100">Change password</h3>
          <UFormField label="Current password" required>
            <UInput v-model="password.current" type="password" autocomplete="current-password" class="w-full" />
          </UFormField>
          <UFormField label="New password" required hint="Minimum 8 characters">
            <UInput v-model="password.next" type="password" autocomplete="new-password" class="w-full" />
          </UFormField>
          <UFormField label="Confirm new password" required>
            <UInput v-model="password.confirm" type="password" autocomplete="new-password" class="w-full" />
          </UFormField>

          <p v-if="passwordError" class="text-sm text-red-600 dark:text-red-400">{{ passwordError }}</p>
          <p v-if="passwordSuccess" class="text-sm text-emerald-600 dark:text-emerald-400">{{ passwordSuccess }}</p>

          <div class="flex justify-end">
            <UButton size="sm" :loading="passwordLoading" @click="handlePasswordSave">Change password</UButton>
          </div>
        </section>
      </div>
    </template>
  </UModal>
</template>
