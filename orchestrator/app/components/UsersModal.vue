<script setup lang="ts">
const open = defineModel<boolean>('open', { default: false });

const { client, user: currentUser } = useAuth();

interface UserRow {
  id: string;
  email: string;
  name: string;
  role?: string | null;
  banned?: boolean | null;
  createdAt?: string;
}

const users = ref<UserRow[]>([]);
const loading = ref(false);
const error = ref('');

const creating = ref(false);
const newUser = reactive({ name: '', email: '', password: '', role: 'user' as 'user' | 'admin' });

async function refresh() {
  loading.value = true;
  error.value = '';
  try {
    const result = await client.admin.listUsers({ query: { limit: 200 } });
    if ((result as any)?.error) {
      error.value = (result as any).error.message || 'Failed to load users';
      users.value = [];
      return;
    }
    const data = (result as any)?.data;
    users.value = (data?.users ?? data ?? []) as UserRow[];
  } catch (e: any) {
    error.value = e?.message || 'Failed to load users';
    users.value = [];
  } finally {
    loading.value = false;
  }
}

watch(open, (v) => {
  if (v) refresh();
});

function startCreate() {
  creating.value = true;
  newUser.name = '';
  newUser.email = '';
  newUser.password = '';
  newUser.role = 'user';
}

function cancelCreate() {
  creating.value = false;
}

async function handleCreate() {
  if (!newUser.name || !newUser.email || !newUser.password) return;
  error.value = '';
  loading.value = true;
  try {
    const result = await client.admin.createUser({
      name: newUser.name,
      email: newUser.email,
      password: newUser.password,
      role: newUser.role,
    });
    if ((result as any)?.error) {
      error.value = (result as any).error.message || 'Failed to create user';
      return;
    }
    creating.value = false;
    await refresh();
  } catch (e: any) {
    error.value = e?.message || 'Failed to create user';
  } finally {
    loading.value = false;
  }
}

async function handleSetRole(u: UserRow, role: 'admin' | 'user') {
  error.value = '';
  try {
    const result = await client.admin.setRole({ userId: u.id, role });
    if ((result as any)?.error) {
      error.value = (result as any).error.message || 'Failed to update role';
      return;
    }
    await refresh();
  } catch (e: any) {
    error.value = e?.message || 'Failed to update role';
  }
}

async function handleDelete(u: UserRow) {
  if (!confirm(`Delete user ${u.email}? This cannot be undone.`)) return;
  error.value = '';
  try {
    const result = await client.admin.removeUser({ userId: u.id });
    if ((result as any)?.error) {
      error.value = (result as any).error.message || 'Failed to delete user';
      return;
    }
    await refresh();
  } catch (e: any) {
    error.value = e?.message || 'Failed to delete user';
  }
}

async function handleResetPassword(u: UserRow) {
  const newPassword = prompt(`Set a new password for ${u.email} (min 8 characters):`);
  if (newPassword === null) return; // cancelled
  if (newPassword.length < 8) {
    error.value = 'Password must be at least 8 characters';
    return;
  }
  error.value = '';
  try {
    const result = await client.admin.setUserPassword({
      userId: u.id,
      newPassword,
    });
    if ((result as any)?.error) {
      error.value = (result as any).error.message || 'Failed to reset password';
      return;
    }
    // No refresh needed — list doesn't show passwords
  } catch (e: any) {
    error.value = e?.message || 'Failed to reset password';
  }
}
</script>

<template>
  <UModal v-model:open="open" :ui="{ content: 'sm:max-w-3xl' }">
    <template #content>
      <div class="p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-semibold text-gray-900 dark:text-white">Users</h2>
          <div class="flex gap-2">
            <UButton v-if="!creating" size="sm" @click="startCreate">New</UButton>
            <UButton size="sm" color="neutral" variant="ghost" @click="open = false">Close</UButton>
          </div>
        </div>

        <p v-if="error" class="text-sm text-red-600 dark:text-red-400">{{ error }}</p>

        <!-- Create form -->
        <div v-if="creating" class="p-4 rounded-lg border border-gray-200 dark:border-gray-800 space-y-3">
          <h3 class="text-sm font-medium text-gray-900 dark:text-gray-100">New user</h3>
          <UFormField label="Name" required>
            <UInput v-model="newUser.name" class="w-full" />
          </UFormField>
          <UFormField label="Email" required>
            <UInput v-model="newUser.email" type="email" class="w-full" />
          </UFormField>
          <UFormField label="Password" required hint="Minimum 8 characters">
            <UInput v-model="newUser.password" type="password" class="w-full" />
          </UFormField>
          <UFormField label="Role">
            <USelect v-model="newUser.role" :items="[{ label: 'User', value: 'user' }, { label: 'Admin', value: 'admin' }]" class="w-full" />
          </UFormField>
          <div class="flex gap-2 justify-end">
            <UButton size="sm" color="neutral" variant="ghost" @click="cancelCreate">Cancel</UButton>
            <UButton size="sm" :loading="loading" @click="handleCreate">Create</UButton>
          </div>
        </div>

        <!-- User list -->
        <div v-else class="space-y-2">
          <div v-if="loading && users.length === 0" class="text-sm text-gray-500">Loading...</div>
          <div v-else-if="users.length === 0" class="text-sm text-gray-500">No users</div>
          <div
            v-for="u in users"
            :key="u.id"
            :data-user-row="u.email"
            class="flex items-center gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-800"
          >
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2">
                <span class="font-medium text-gray-900 dark:text-gray-100 truncate">{{ u.name }}</span>
                <UBadge v-if="u.role === 'admin'" size="xs" color="warning">admin</UBadge>
                <UBadge v-else size="xs" color="neutral" variant="soft">user</UBadge>
                <span v-if="u.id === (currentUser as any)?.id" class="text-xs text-gray-500">(you)</span>
              </div>
              <div class="text-xs text-gray-500 truncate">{{ u.email }}</div>
            </div>
            <div class="flex gap-1">
              <UButton
                v-if="u.role !== 'admin'"
                size="xs"
                variant="ghost"
                @click="handleSetRole(u, 'admin')"
              >
                Make admin
              </UButton>
              <UButton
                v-else-if="u.id !== (currentUser as any)?.id"
                size="xs"
                variant="ghost"
                @click="handleSetRole(u, 'user')"
              >
                Demote
              </UButton>
              <UButton
                size="xs"
                variant="ghost"
                title="Set a new password for this user"
                @click="handleResetPassword(u)"
              >
                Reset password
              </UButton>
              <UButton
                v-if="u.id !== (currentUser as any)?.id"
                size="xs"
                color="error"
                variant="ghost"
                @click="handleDelete(u)"
              >
                Delete
              </UButton>
            </div>
          </div>
        </div>
      </div>
    </template>
  </UModal>
</template>
