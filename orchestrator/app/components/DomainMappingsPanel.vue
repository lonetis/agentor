<script setup lang="ts">
import type { ContainerInfo, ChallengeType } from '~/types';

const props = defineProps<{
  containers: ContainerInfo[];
}>();

const { mappings, status, createMappings, removeMapping } = useDomainMappings();

const showForm = ref(false);
const formSubdomain = ref('');
const formProtocols = ref<Set<'http' | 'https' | 'tcp'>>(new Set(['http']));
const formWorkerId = ref('');
const formInternalPort = ref<number | undefined>();
const formBaseDomains = ref<Set<string>>(new Set());
const formPath = ref('');
const formAuthEnabled = ref(false);
const formAuthUsername = ref('');
const formAuthPassword = ref('');
const formWildcard = ref(false);

const multiDomain = computed(() => status.value.baseDomains.length > 1);

watch(() => status.value.baseDomains, (domains) => {
  if (formBaseDomains.value.size === 0 && domains.length > 0) {
    formBaseDomains.value = new Set([domains[0]!]);
  }
}, { immediate: true });

const runningContainers = computed(() =>
  props.containers.filter((c) => c.status === 'running')
);

function getChallengeType(baseDomain: string): ChallengeType {
  const dc = status.value.baseDomainConfigs.find((c) => c.domain === baseDomain);
  return dc?.challengeType ?? 'none';
}

function getDnsProvider(baseDomain: string): string | undefined {
  const dc = status.value.baseDomainConfigs.find((c) => c.domain === baseDomain);
  return dc?.dnsProvider;
}

const selectedDomainsAllHaveTls = computed(() => {
  if (formBaseDomains.value.size === 0) return false;
  return [...formBaseDomains.value].every((d) => getChallengeType(d) !== 'none');
});

const availableProtocols = computed(() => {
  const hasTls = selectedDomainsAllHaveTls.value;
  return [
    { value: 'http' as const, label: 'http', disabled: false },
    { value: 'https' as const, label: 'https', disabled: !hasTls },
    { value: 'tcp' as const, label: 'tcp', disabled: !hasTls },
  ];
});

/**
 * Wildcard routing is allowed on base domains whose challenge type is `none`
 * (plain HTTP), `dns` (wildcard cert via DNS-01), or `selfsigned` (locally
 * generated wildcard cert). HTTP-01 ACME (`http`) cannot issue wildcard certs,
 * so the checkbox is disabled when any selected base domain uses it.
 */
const wildcardAllowed = computed(() => {
  if (formBaseDomains.value.size === 0) return false;
  return [...formBaseDomains.value].every((d) => getChallengeType(d) !== 'http');
});

function toggleBaseDomain(domain: string) {
  const s = formBaseDomains.value;
  if (s.has(domain)) {
    if (s.size > 1) s.delete(domain);
  } else {
    s.add(domain);
  }
  formBaseDomains.value = new Set(s);
}

function toggleProtocol(value: 'http' | 'https' | 'tcp') {
  const s = formProtocols.value;
  if (value === 'tcp') {
    // TCP is exclusive — selecting it deselects http/https and vice versa
    s.clear();
    s.add('tcp');
  } else {
    s.delete('tcp');
    if (s.has(value)) {
      // Don't allow deselecting the last protocol
      if (s.size > 1) s.delete(value);
    } else {
      s.add(value);
    }
  }
  formProtocols.value = new Set(s);
}

// Reset protocol if it becomes invalid when base domain changes
watch(selectedDomainsAllHaveTls, (hasTls) => {
  if (!hasTls) {
    formProtocols.value.delete('https');
    formProtocols.value.delete('tcp');
    if (formProtocols.value.size === 0) formProtocols.value.add('http');
    formProtocols.value = new Set(formProtocols.value);
  }
});

// Clear wildcard flag if the selected base domain stops supporting it (e.g.
// user switches from :dns:provider to :http ACME by adjusting the selection).
watch(wildcardAllowed, (allowed) => {
  if (!allowed) formWildcard.value = false;
});

function resetForm() {
  formSubdomain.value = '';
  formPath.value = '';
  formBaseDomains.value = new Set(status.value.baseDomains.length > 0 ? [status.value.baseDomains[0]!] : []);
  formProtocols.value = new Set(['http']);
  formWorkerId.value = '';
  formInternalPort.value = undefined;
  formAuthEnabled.value = false;
  formAuthUsername.value = '';
  formAuthPassword.value = '';
  formWildcard.value = false;
  showForm.value = false;
}

async function handleCreate() {
  if (!formWorkerId.value || !formInternalPort.value || formBaseDomains.value.size === 0 || formProtocols.value.size === 0) return;
  const protocols = [...formProtocols.value];
  const domains = [...formBaseDomains.value];
  const useWildcard = formWildcard.value && wildcardAllowed.value;
  const items = domains.flatMap((baseDomain) =>
    protocols.map((protocol) => ({
      subdomain: formSubdomain.value,
      baseDomain,
      ...(protocol !== 'tcp' && formPath.value ? { path: formPath.value } : {}),
      protocol,
      ...(useWildcard ? { wildcard: true } : {}),
      workerId: formWorkerId.value,
      internalPort: formInternalPort.value!,
      ...(protocol !== 'tcp' && formAuthEnabled.value && formAuthUsername.value && formAuthPassword.value
        ? { basicAuth: { username: formAuthUsername.value, password: formAuthPassword.value } }
        : {}),
    })),
  );
  await createMappings(items);
  resetForm();
}

const protocolColors: Record<string, string> = {
  http: 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300',
  https: 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300',
  tcp: 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300',
};

const challengeColors: Record<string, string> = {
  none: 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400',
  http: 'bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300',
  dns: 'bg-cyan-100 dark:bg-cyan-900 text-cyan-700 dark:text-cyan-300',
  selfsigned: 'bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300',
};

function downloadCaCert() {
  window.open('/api/domain-mapper/ca-cert', '_blank');
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <!-- Add mapping form -->
    <div v-if="showForm" class="flex flex-col gap-1.5 bg-gray-100 dark:bg-gray-800 rounded p-2 text-xs">
      <div class="flex gap-1.5">
        <div class="flex shrink-0">
          <button
            v-for="p in availableProtocols"
            :key="p.value"
            type="button"
            :disabled="p.disabled"
            class="px-2 py-1 text-xs font-medium border transition-colors first:rounded-l last:rounded-r"
            :class="[
              formProtocols.has(p.value)
                ? 'bg-primary-600 dark:bg-primary-500 text-white border-primary-600 dark:border-primary-500'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400 border-gray-300 dark:border-gray-600',
              p.disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:opacity-80',
            ]"
            :title="p.disabled ? 'No TLS configured' : ''"
            @click="!p.disabled && toggleProtocol(p.value)"
          >
            {{ p.label }}
          </button>
        </div>
        <select
          v-model="formWorkerId"
          class="bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded px-2 py-1 text-xs flex-1 min-w-0"
        >
          <option value="" disabled>Worker</option>
          <option v-for="c in runningContainers" :key="c.id" :value="c.id">
            {{ c.displayName || shortName(c.name) }}
          </option>
        </select>
      </div>
      <div class="flex gap-1.5 items-center">
        <input
          v-model="formSubdomain"
          type="text"
          placeholder="subdomain (optional)"
          class="bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded px-2 py-1 text-xs flex-1 min-w-0"
        />
        <div v-if="multiDomain" class="flex shrink-0">
          <button
            v-for="d in status.baseDomains"
            :key="d"
            type="button"
            class="px-1.5 py-1 text-[10px] font-medium border transition-colors first:rounded-l last:rounded-r"
            :class="[
              formBaseDomains.has(d)
                ? 'bg-primary-600 dark:bg-primary-500 text-white border-primary-600 dark:border-primary-500'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500 border-gray-300 dark:border-gray-600',
            ]"
            :title="`${getChallengeType(d)}${getDnsProvider(d) ? ':' + getDnsProvider(d) : ''}`"
            @click="toggleBaseDomain(d)"
          >
            .{{ d }}
          </button>
        </div>
        <span v-else class="text-gray-400 dark:text-gray-500 text-[10px] shrink-0">.{{ status.baseDomains[0] }}</span>
      </div>
      <div class="flex gap-1.5 items-center">
        <input
          v-if="!formProtocols.has('tcp')"
          v-model="formPath"
          type="text"
          placeholder="path (optional, e.g. /api)"
          class="bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded px-2 py-1 text-xs flex-1 min-w-0"
        />
        <input
          v-model.number="formInternalPort"
          type="number"
          placeholder="Internal port"
          class="bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded px-2 py-1 text-xs flex-1 min-w-0"
        />
      </div>
      <label
        class="flex items-start gap-2 text-gray-700 dark:text-gray-300 text-xs rounded border border-gray-300 dark:border-gray-600 bg-gray-200/50 dark:bg-gray-700/40 px-2 py-1.5"
        :class="wildcardAllowed ? 'cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700/70' : 'opacity-60 cursor-not-allowed'"
        :title="wildcardAllowed
          ? 'Routes every single-label prefix of this host (e.g. foo.sub.domain.com) to the same worker. Works for http, https, and tcp. TLS variants use a wildcard certificate issued once per host.'
          : 'Wildcard routing is unavailable when the selected base domain uses HTTP-01 ACME. Configure the base domain as :none (plain http), :dns:provider, or :selfsigned to enable wildcard routing.'"
      >
        <input
          v-model="formWildcard"
          type="checkbox"
          :disabled="!wildcardAllowed"
          class="rounded mt-0.5 shrink-0"
          data-testid="wildcard-checkbox"
        />
        <span class="flex-1 min-w-0">
          <span class="font-medium">Wildcard subdomain</span>
          <span v-if="formWildcard && wildcardAllowed" class="font-mono text-primary-600 dark:text-primary-400 block text-[10px] mt-0.5 truncate">
            matches *.{{ formSubdomain ? formSubdomain + '.' : '' }}{{ [...formBaseDomains][0] || status.baseDomains[0] }}
          </span>
          <span v-else class="text-gray-500 dark:text-gray-500 block text-[10px] mt-0.5">
            Also route any single-label prefix (e.g. *.sub.domain)
          </span>
        </span>
      </label>
      <div
        v-if="!formProtocols.has('tcp')"
        class="rounded border border-gray-300 dark:border-gray-600 bg-gray-200/50 dark:bg-gray-700/40"
      >
        <label
          class="flex items-start gap-2 text-gray-700 dark:text-gray-300 text-xs cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700/70 rounded px-2 py-1.5"
          title="Protect this route with HTTP Basic authentication. Traefik returns 401 until the user provides a matching username and password."
        >
          <input
            v-model="formAuthEnabled"
            type="checkbox"
            class="rounded mt-0.5 shrink-0"
            data-testid="basic-auth-checkbox"
          />
          <span class="flex-1 min-w-0">
            <span class="font-medium">Basic auth</span>
            <span v-if="!formAuthEnabled" class="text-gray-500 dark:text-gray-500 block text-[10px] mt-0.5">
              Prompt for a username and password before routing (HTTP 401 challenge)
            </span>
          </span>
        </label>
        <div v-if="formAuthEnabled" class="flex gap-1.5 px-2 pb-2">
          <input
            v-model="formAuthUsername"
            type="text"
            placeholder="Username"
            class="bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded px-2 py-1 text-xs flex-1 min-w-0"
          />
          <input
            v-model="formAuthPassword"
            type="password"
            placeholder="Password"
            class="bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded px-2 py-1 text-xs flex-1 min-w-0"
          />
        </div>
      </div>
      <div
        v-else
        class="flex items-start gap-2 text-xs rounded border border-gray-300 dark:border-gray-600 bg-gray-200/50 dark:bg-gray-700/40 px-2 py-1.5 text-gray-700 dark:text-gray-300 opacity-80"
        data-testid="tcp-no-auth-hint"
      >
        <UIcon name="i-lucide-info" class="size-3.5 mt-0.5 shrink-0 text-gray-500 dark:text-gray-400" />
        <span class="flex-1 min-w-0">
          <span class="font-medium">Basic auth</span>
          <span class="text-gray-500 dark:text-gray-500 block text-[10px] mt-0.5 leading-tight">
            HTTP-level authentication does not apply to TCP routes — Traefik
            forwards raw bytes and cannot read HTTP headers. Use IP-level
            restrictions or a protocol-aware reverse proxy inside the worker.
          </span>
        </span>
      </div>
      <div class="flex gap-1.5 justify-end">
        <UButton size="xs" color="neutral" variant="ghost" @click="showForm = false">
          Cancel
        </UButton>
        <UButton size="xs" color="primary" variant="solid" @click="handleCreate">
          Add
        </UButton>
      </div>
    </div>

    <div v-if="!showForm" class="flex gap-1.5 items-center">
      <UButton size="xs" color="primary" variant="solid" @click="showForm = true">
        + Map
      </UButton>
      <UButton
        v-if="status.hasSelfSignedCa"
        size="xs"
        color="neutral"
        variant="ghost"
        title="Download CA certificate (trust in browser for self-signed domains)"
        @click="downloadCaCert"
      >
        <UIcon name="i-lucide-file-down" class="size-3 mr-0.5" />
        CA cert
      </UButton>
    </div>

    <!-- Mappings list -->
    <div v-if="mappings.length === 0 && !showForm" class="text-gray-400 dark:text-gray-500 text-xs text-center py-1">
      No active domain mappings
    </div>
    <div
      v-for="m in mappings"
      :key="m.id"
      class="flex items-center gap-1.5 text-xs bg-gray-100 dark:bg-gray-800 rounded px-2 py-1 min-w-0"
    >
      <span
        class="px-1 rounded text-[10px] font-medium shrink-0"
        :class="protocolColors[m.protocol]"
      >
        {{ m.protocol }}
      </span>
      <span
        class="px-1 rounded text-[10px] shrink-0"
        :class="challengeColors[getChallengeType(m.baseDomain)]"
        :title="getDnsProvider(m.baseDomain) ? `dns:${getDnsProvider(m.baseDomain)}` : getChallengeType(m.baseDomain)"
      >
        {{ getChallengeType(m.baseDomain) === 'dns' ? getDnsProvider(m.baseDomain) : getChallengeType(m.baseDomain) === 'selfsigned' ? 'self' : getChallengeType(m.baseDomain) }}
      </span>
      <span
        v-if="m.wildcard"
        class="px-1 rounded text-[10px] font-medium shrink-0 bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300"
        title="Also matches any single-label subdomain of this host"
      >
        wildcard
      </span>
      <span class="text-gray-700 dark:text-gray-300 font-mono truncate min-w-0">{{ m.wildcard ? '*.' : '' }}{{ m.subdomain ? `${m.subdomain}.${m.baseDomain}` : m.baseDomain }}{{ m.path || '' }}</span>
      <UIcon
        v-if="m.basicAuth"
        name="i-lucide-lock"
        class="size-3 text-amber-500 shrink-0"
      />
      <span class="text-gray-400 dark:text-gray-600 shrink-0">&rarr;</span>
      <span class="text-gray-500 dark:text-gray-400 truncate min-w-0 flex-1">{{ shortName(m.workerName) }}:{{ m.internalPort }}</span>
      <button
        class="text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 transition-colors shrink-0 p-0.5"
        title="Remove mapping"
        @click="removeMapping(m.id)"
      >
        <UIcon name="i-lucide-x" class="size-3" />
      </button>
    </div>
  </div>
</template>
