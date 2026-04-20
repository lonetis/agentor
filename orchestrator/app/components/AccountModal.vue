<script setup lang="ts">
const open = defineModel<boolean>('open', { default: false });

const { client, user: currentUser } = useAuth();

interface CredentialSummary {
  hasPassword: boolean;
  passkeyCount: number;
}

interface PasskeyRow {
  id: string;
  name?: string | null;
  createdAt?: string;
  deviceType?: string | null;
}

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

// Passkey state
const passkeys = ref<PasskeyRow[]>([]);
const passkeyError = ref('');
const passkeySuccess = ref('');
const passkeyAddName = ref('');
const passkeyAddLoading = ref(false);

// API keys + custom env vars (per-user, injected into every worker the user creates)
interface EnvVarsForm {
  githubToken: string;
  anthropicApiKey: string;
  claudeCodeOauthToken: string;
  openaiApiKey: string;
  geminiApiKey: string;
  customEnvVars: { key: string; value: string }[];
}
const envForm = reactive<EnvVarsForm>({
  githubToken: '',
  anthropicApiKey: '',
  claudeCodeOauthToken: '',
  openaiApiKey: '',
  geminiApiKey: '',
  customEnvVars: [],
});
const envLoading = ref(false);
const envError = ref('');
const envSuccess = ref('');
const envVisible = reactive<Record<string, boolean>>({});
const { envVars: _envVarsRef, credentials: agentCreds, fetchAll: fetchEnvAndCreds, save: saveEnvVars, resetCredential } = useUserEnvVars();
const credResetConfirmId = ref<string | null>(null);
const credResetError = ref('');
const credResetSuccess = ref('');

// Credential summary (drives the UI: do we have a password? do we have passkeys?)
const credentials = ref<CredentialSummary>({ hasPassword: true, passkeyCount: 0 });

// Whether the server has passkey authentication enabled (depends on Traefik
// routing — the dashboard must be served over HTTPS on a stable hostname).
const passkeysEnabled = ref(false);

const canRemovePassword = computed(
  () =>
    passkeysEnabled.value &&
    credentials.value.hasPassword &&
    credentials.value.passkeyCount > 0,
);

function resetMessages() {
  profileError.value = '';
  profileSuccess.value = '';
  passwordError.value = '';
  passwordSuccess.value = '';
  passkeyError.value = '';
  passkeySuccess.value = '';
  envError.value = '';
  envSuccess.value = '';
  credResetError.value = '';
  credResetSuccess.value = '';
}

async function refreshCredentialSummary() {
  try {
    credentials.value = await $fetch<CredentialSummary>('/api/account/credentials');
  } catch {
    credentials.value = { hasPassword: true, passkeyCount: 0 };
  }
}

async function refreshPasskeys() {
  try {
    const result: any = await client.passkey.listUserPasskeys();
    if (result?.error) {
      passkeyError.value = result.error.message || 'Failed to load passkeys';
      passkeys.value = [];
      return;
    }
    passkeys.value = (result?.data ?? []) as PasskeyRow[];
  } catch (err: any) {
    passkeyError.value = err?.message || 'Failed to load passkeys';
    passkeys.value = [];
  }
}

async function refreshPasskeysEnabled() {
  try {
    const status = await $fetch<{ passkeysEnabled: boolean }>('/api/setup/status');
    passkeysEnabled.value = !!status.passkeysEnabled;
  } catch {
    passkeysEnabled.value = false;
  }
}

async function loadEnvVars() {
  envLoading.value = true;
  try {
    await fetchEnvAndCreds();
    const v = _envVarsRef.value;
    if (v) {
      envForm.githubToken = v.githubToken;
      envForm.anthropicApiKey = v.anthropicApiKey;
      envForm.claudeCodeOauthToken = v.claudeCodeOauthToken;
      envForm.openaiApiKey = v.openaiApiKey;
      envForm.geminiApiKey = v.geminiApiKey;
      envForm.customEnvVars = v.customEnvVars.map((e) => ({ ...e }));
    }
  } catch (err: any) {
    envError.value = err?.data?.statusMessage || err?.message || 'Failed to load env vars';
  } finally {
    envLoading.value = false;
  }
}

watch(open, async (v) => {
  if (v) {
    const u = currentUser.value as any;
    profile.name = u?.name || '';
    profile.email = u?.email || '';
    password.current = '';
    password.next = '';
    password.confirm = '';
    passkeyAddName.value = '';
    resetMessages();
    // Env vars + agent-credentials aren't needed for the password / passkey
    // flow at the top of the modal, so fire them in the background rather
    // than blocking the critical render path.
    loadEnvVars().catch(() => {});
    await Promise.all([
      refreshCredentialSummary(),
      refreshPasskeysEnabled(),
    ]);
    if (passkeysEnabled.value) {
      await refreshPasskeys();
    } else {
      passkeys.value = [];
    }
  }
});

function addCustomEnvVar() {
  envForm.customEnvVars.push({ key: '', value: '' });
}

function removeCustomEnvVar(index: number) {
  envForm.customEnvVars.splice(index, 1);
}

function toggleVisible(field: string) {
  envVisible[field] = !envVisible[field];
}

async function handleEnvSave() {
  resetMessages();
  envLoading.value = true;
  try {
    await saveEnvVars({
      githubToken: envForm.githubToken,
      anthropicApiKey: envForm.anthropicApiKey,
      claudeCodeOauthToken: envForm.claudeCodeOauthToken,
      openaiApiKey: envForm.openaiApiKey,
      geminiApiKey: envForm.geminiApiKey,
      customEnvVars: envForm.customEnvVars
        .map((e) => ({ key: e.key.trim(), value: e.value }))
        .filter((e) => e.key.length > 0),
    });
    envSuccess.value = 'Env vars saved';
  } catch (err: any) {
    envError.value = err?.data?.statusMessage || err?.message || 'Failed to save env vars';
  } finally {
    envLoading.value = false;
  }
}

async function handleResetCredential(agentId: string) {
  credResetError.value = '';
  credResetSuccess.value = '';
  if (credResetConfirmId.value !== agentId) {
    credResetConfirmId.value = agentId;
    return;
  }
  try {
    await resetCredential(agentId);
    credResetSuccess.value = `${agentId} credential reset — log in again inside a worker`;
    credResetConfirmId.value = null;
  } catch (err: any) {
    credResetError.value = err?.data?.statusMessage || err?.message || 'Failed to reset credential';
  }
}

function cancelResetCredential() {
  credResetConfirmId.value = null;
}

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
    if (newName !== u.name) {
      const res = await client.updateUser({ name: newName });
      if ((res as any)?.error) {
        profileError.value = (res as any).error.message || 'Failed to update name';
        return;
      }
    }
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

  if (!password.next || !password.confirm) {
    passwordError.value = 'New password and confirmation are required';
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
    if (credentials.value.hasPassword) {
      // Existing password — must supply current password
      if (!password.current) {
        passwordError.value = 'Current password is required';
        return;
      }
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
    } else {
      // No password yet — set one via the Agentor wrapper endpoint (better-auth's
      // setPassword is server-only and not exposed to the client by default).
      try {
        await $fetch('/api/account/set-password', {
          method: 'POST',
          body: { newPassword: password.next },
          retry: 2,
          retryDelay: 500,
        });
        passwordSuccess.value = 'Password set';
      } catch (err: any) {
        passwordError.value = err?.data?.statusMessage || err?.message || 'Failed to set password';
        return;
      }
    }
    password.current = '';
    password.next = '';
    password.confirm = '';
    await refreshCredentialSummary();
  } catch (err: any) {
    passwordError.value = err?.message || 'Failed to update password';
  } finally {
    passwordLoading.value = false;
  }
}

const removePasswordConfirm = ref(false);

async function handleRemovePassword() {
  resetMessages();
  // Two-step confirmation — first click flips the flag, second click commits.
  // Avoids using window.confirm() which races with Playwright's dialog handler.
  if (!removePasswordConfirm.value) {
    removePasswordConfirm.value = true;
    return;
  }
  passwordLoading.value = true;
  try {
    await $fetch('/api/account/remove-password', { method: 'POST', retry: 2, retryDelay: 500 });
    passwordSuccess.value = 'Password removed';
    removePasswordConfirm.value = false;
    await refreshCredentialSummary();
  } catch (err: any) {
    passwordError.value = err?.data?.statusMessage || err?.message || 'Failed to remove password';
  } finally {
    passwordLoading.value = false;
  }
}

function cancelRemovePassword() {
  removePasswordConfirm.value = false;
}

const passkeyDeleteConfirmId = ref<string | null>(null);

function cancelDeletePasskey() {
  passkeyDeleteConfirmId.value = null;
}

async function handleAddPasskey() {
  resetMessages();
  passkeyAddLoading.value = true;
  try {
    const result: any = await client.passkey.addPasskey({
      name: passkeyAddName.value.trim() || undefined,
    });
    if (result?.error) {
      passkeyError.value = result.error.message || 'Failed to register passkey';
      return;
    }
    passkeySuccess.value = 'Passkey added';
    passkeyAddName.value = '';
    await Promise.all([refreshCredentialSummary(), refreshPasskeys()]);
  } catch (err: any) {
    passkeyError.value = err?.message || 'Failed to register passkey';
  } finally {
    passkeyAddLoading.value = false;
  }
}

async function handleDeletePasskey(p: PasskeyRow) {
  resetMessages();
  // Defensive client-side guard — server still enforces.
  if (!credentials.value.hasPassword && credentials.value.passkeyCount <= 1) {
    passkeyError.value = 'Set a password first — you cannot remove your last passkey';
    return;
  }
  if (passkeyDeleteConfirmId.value !== p.id) {
    passkeyDeleteConfirmId.value = p.id;
    return;
  }
  try {
    const result: any = await client.passkey.deletePasskey({ id: p.id });
    if (result?.error) {
      passkeyError.value = result.error.message || 'Failed to remove passkey';
      return;
    }
    passkeySuccess.value = 'Passkey removed';
    passkeyDeleteConfirmId.value = null;
    await Promise.all([refreshCredentialSummary(), refreshPasskeys()]);
  } catch (err: any) {
    passkeyError.value = err?.message || 'Failed to remove passkey';
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
          <div class="flex items-center justify-between">
            <h3 class="text-sm font-medium text-gray-900 dark:text-gray-100">
              {{ credentials.hasPassword ? 'Change password' : 'Set a password' }}
            </h3>
            <div v-if="canRemovePassword" class="flex gap-1">
              <UButton
                v-if="!removePasswordConfirm"
                size="xs"
                color="error"
                variant="ghost"
                :loading="passwordLoading"
                @click="handleRemovePassword"
              >
                Remove password
              </UButton>
              <template v-else>
                <UButton size="xs" color="neutral" variant="ghost" @click="cancelRemovePassword">
                  Cancel
                </UButton>
                <UButton size="xs" color="error" :loading="passwordLoading" @click="handleRemovePassword">
                  Confirm remove
                </UButton>
              </template>
            </div>
          </div>

          <UFormField v-if="credentials.hasPassword" label="Current password" required>
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
            <UButton size="sm" :loading="passwordLoading" @click="handlePasswordSave">
              {{ credentials.hasPassword ? 'Change password' : 'Set password' }}
            </UButton>
          </div>
        </section>

        <div v-if="passkeysEnabled" class="border-t border-gray-200 dark:border-gray-800"></div>

        <!-- Passkey section — only rendered when the server has passkey
             authentication enabled (dashboard served over Traefik). -->
        <section v-if="passkeysEnabled" class="space-y-3">
          <h3 class="text-sm font-medium text-gray-900 dark:text-gray-100">Passkeys</h3>
          <p class="text-xs text-gray-500 dark:text-gray-400">
            Use Face ID, Touch ID, Windows Hello, or a hardware key to sign in without a password.
          </p>

          <div v-if="passkeys.length === 0" class="text-sm text-gray-500 dark:text-gray-400 italic">
            No passkeys registered.
          </div>
          <div v-else class="space-y-2">
            <div
              v-for="p in passkeys"
              :key="p.id"
              class="flex items-center gap-3 p-2 rounded-md border border-gray-200 dark:border-gray-800"
            >
              <UIcon name="i-lucide-key-round" class="size-4 text-gray-500 flex-shrink-0" />
              <div class="flex-1 min-w-0">
                <div class="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                  {{ p.name || 'Unnamed passkey' }}
                </div>
                <div v-if="p.createdAt" class="text-xs text-gray-500 dark:text-gray-400">
                  Added {{ new Date(p.createdAt).toLocaleDateString() }}
                </div>
              </div>
              <div class="flex gap-1">
                <UButton
                  v-if="passkeyDeleteConfirmId !== p.id"
                  size="xs"
                  color="error"
                  variant="ghost"
                  :disabled="!credentials.hasPassword && credentials.passkeyCount <= 1"
                  @click="handleDeletePasskey(p)"
                >
                  Remove
                </UButton>
                <template v-else>
                  <UButton size="xs" color="neutral" variant="ghost" @click="cancelDeletePasskey">
                    Cancel
                  </UButton>
                  <UButton size="xs" color="error" @click="handleDeletePasskey(p)">
                    Confirm
                  </UButton>
                </template>
              </div>
            </div>
          </div>

          <div class="pt-2 space-y-2">
            <UFormField label="Name (optional)">
              <UInput v-model="passkeyAddName" placeholder="e.g. MacBook Touch ID" class="w-full" />
            </UFormField>
            <p v-if="passkeyError" class="text-sm text-red-600 dark:text-red-400">{{ passkeyError }}</p>
            <p v-if="passkeySuccess" class="text-sm text-emerald-600 dark:text-emerald-400">{{ passkeySuccess }}</p>
            <div class="flex justify-end">
              <UButton size="sm" :loading="passkeyAddLoading" icon="i-lucide-plus" @click="handleAddPasskey">
                Add passkey
              </UButton>
            </div>
          </div>
        </section>

        <div class="border-t border-gray-200 dark:border-gray-800"></div>

        <!-- API keys & tokens section — well-known slots for agent API keys and
             the GitHub token. Injected as env vars into every worker this user
             creates. -->
        <section class="space-y-3" data-testid="account-api-keys">
          <h3 class="text-sm font-medium text-gray-900 dark:text-gray-100">API keys & tokens</h3>
          <p class="text-xs text-gray-500 dark:text-gray-400">
            Injected as environment variables into every worker you create. Values are only visible to you.
          </p>

          <UFormField label="GitHub token" :hint="'GITHUB_TOKEN'">
            <div class="flex gap-2">
              <UInput
                v-model="envForm.githubToken"
                :type="envVisible.githubToken ? 'text' : 'password'"
                autocomplete="off"
                class="flex-1"
                data-testid="env-githubToken"
              />
              <UButton
                size="sm"
                color="neutral"
                variant="ghost"
                :icon="envVisible.githubToken ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                @click="toggleVisible('githubToken')"
              />
            </div>
          </UFormField>

          <UFormField label="Anthropic API key" :hint="'ANTHROPIC_API_KEY'">
            <div class="flex gap-2">
              <UInput
                v-model="envForm.anthropicApiKey"
                :type="envVisible.anthropicApiKey ? 'text' : 'password'"
                autocomplete="off"
                class="flex-1"
                data-testid="env-anthropicApiKey"
              />
              <UButton
                size="sm"
                color="neutral"
                variant="ghost"
                :icon="envVisible.anthropicApiKey ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                @click="toggleVisible('anthropicApiKey')"
              />
            </div>
          </UFormField>

          <UFormField label="Claude Code OAuth token" :hint="'CLAUDE_CODE_OAUTH_TOKEN'">
            <div class="flex gap-2">
              <UInput
                v-model="envForm.claudeCodeOauthToken"
                :type="envVisible.claudeCodeOauthToken ? 'text' : 'password'"
                autocomplete="off"
                class="flex-1"
                data-testid="env-claudeCodeOauthToken"
              />
              <UButton
                size="sm"
                color="neutral"
                variant="ghost"
                :icon="envVisible.claudeCodeOauthToken ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                @click="toggleVisible('claudeCodeOauthToken')"
              />
            </div>
          </UFormField>

          <UFormField label="OpenAI API key" :hint="'OPENAI_API_KEY'">
            <div class="flex gap-2">
              <UInput
                v-model="envForm.openaiApiKey"
                :type="envVisible.openaiApiKey ? 'text' : 'password'"
                autocomplete="off"
                class="flex-1"
                data-testid="env-openaiApiKey"
              />
              <UButton
                size="sm"
                color="neutral"
                variant="ghost"
                :icon="envVisible.openaiApiKey ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                @click="toggleVisible('openaiApiKey')"
              />
            </div>
          </UFormField>

          <UFormField label="Gemini API key" :hint="'GEMINI_API_KEY'">
            <div class="flex gap-2">
              <UInput
                v-model="envForm.geminiApiKey"
                :type="envVisible.geminiApiKey ? 'text' : 'password'"
                autocomplete="off"
                class="flex-1"
                data-testid="env-geminiApiKey"
              />
              <UButton
                size="sm"
                color="neutral"
                variant="ghost"
                :icon="envVisible.geminiApiKey ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                @click="toggleVisible('geminiApiKey')"
              />
            </div>
          </UFormField>
        </section>

        <!-- Custom env vars section — same save button as API keys -->
        <section class="space-y-3" data-testid="account-custom-env-vars">
          <div class="flex items-center justify-between">
            <h3 class="text-sm font-medium text-gray-900 dark:text-gray-100">Custom environment variables</h3>
            <UButton size="xs" variant="ghost" icon="i-lucide-plus" @click="addCustomEnvVar">Add</UButton>
          </div>
          <p class="text-xs text-gray-500 dark:text-gray-400">
            Additional <code class="font-mono">KEY=value</code> pairs exposed to every worker you create.
            Keys must match <code class="font-mono">[A-Z_][A-Z0-9_]*</code>.
          </p>

          <div v-if="envForm.customEnvVars.length === 0" class="text-sm text-gray-500 dark:text-gray-400 italic">
            None configured.
          </div>
          <div
            v-for="(row, idx) in envForm.customEnvVars"
            :key="idx"
            class="flex items-center gap-2"
            data-testid="custom-env-row"
          >
            <UInput v-model="row.key" placeholder="KEY" class="w-40" data-testid="custom-env-key" />
            <UInput
              v-model="row.value"
              :type="envVisible[`custom-${idx}`] ? 'text' : 'password'"
              placeholder="value"
              class="flex-1"
              data-testid="custom-env-value"
            />
            <UButton
              size="sm"
              color="neutral"
              variant="ghost"
              :icon="envVisible[`custom-${idx}`] ? 'i-lucide-eye-off' : 'i-lucide-eye'"
              @click="toggleVisible(`custom-${idx}`)"
            />
            <UButton
              size="sm"
              color="error"
              variant="ghost"
              icon="i-lucide-x"
              @click="removeCustomEnvVar(idx)"
            />
          </div>

          <p v-if="envError" class="text-sm text-red-600 dark:text-red-400" data-testid="env-error">{{ envError }}</p>
          <p v-if="envSuccess" class="text-sm text-emerald-600 dark:text-emerald-400" data-testid="env-success">{{ envSuccess }}</p>
          <div class="flex justify-end">
            <UButton size="sm" :loading="envLoading" @click="handleEnvSave" data-testid="env-save">Save env vars</UButton>
          </div>
        </section>

        <div class="border-t border-gray-200 dark:border-gray-800"></div>

        <!-- Agent OAuth credentials — read-only status + reset per agent.
             Login happens inside a worker by running the agent CLI. -->
        <section class="space-y-3" data-testid="account-agent-credentials">
          <h3 class="text-sm font-medium text-gray-900 dark:text-gray-100">Agent OAuth credentials</h3>
          <p class="text-xs text-gray-500 dark:text-gray-400">
            Log in once inside any of your workers. Tokens are stored per user and shared across all of your workers.
          </p>
          <div v-if="agentCreds.length === 0" class="text-sm text-gray-500 dark:text-gray-400 italic">
            No agents configured.
          </div>
          <div v-else class="space-y-2">
            <div
              v-for="c in agentCreds"
              :key="c.agentId"
              class="flex items-center gap-3 p-2 rounded-md border border-gray-200 dark:border-gray-800"
              :data-testid="`agent-cred-${c.agentId}`"
            >
              <span class="size-2 rounded-full"
                :class="c.configured ? 'bg-emerald-500' : 'bg-gray-400 dark:bg-gray-600'"
              />
              <div class="flex-1 min-w-0">
                <div class="text-sm font-medium text-gray-900 dark:text-gray-100 capitalize">{{ c.agentId }}</div>
                <div class="text-xs text-gray-500 dark:text-gray-400">
                  {{ c.configured ? 'Logged in' : 'Not logged in' }}
                </div>
              </div>
              <div class="flex gap-1">
                <UButton
                  v-if="credResetConfirmId !== c.agentId"
                  size="xs"
                  color="error"
                  variant="ghost"
                  :disabled="!c.configured"
                  @click="handleResetCredential(c.agentId)"
                >
                  Reset
                </UButton>
                <template v-else>
                  <UButton size="xs" color="neutral" variant="ghost" @click="cancelResetCredential">
                    Cancel
                  </UButton>
                  <UButton size="xs" color="error" @click="handleResetCredential(c.agentId)">
                    Confirm reset
                  </UButton>
                </template>
              </div>
            </div>
          </div>
          <p v-if="credResetError" class="text-sm text-red-600 dark:text-red-400">{{ credResetError }}</p>
          <p v-if="credResetSuccess" class="text-sm text-emerald-600 dark:text-emerald-400">{{ credResetSuccess }}</p>
        </section>
      </div>
    </template>
  </UModal>
</template>
