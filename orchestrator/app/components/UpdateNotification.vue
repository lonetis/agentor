<script setup lang="ts">
import type { ImageUpdateInfo, UpdatableImage } from '~/types';

const {
  status,
  isChecking,
  isApplying,
  isRestarting,
  applyErrors,
  applyingImages,
  updatesAvailable,
  isProductionMode,
  checkNow,
  applyUpdates,
  applyImage,
} = useUpdates();

const expanded = ref(false);

function shortDigest(digest: string): string {
  if (!digest) return 'unknown';
  // sha256:abc123... -> abc123...
  const hash = digest.startsWith('sha256:') ? digest.slice(7) : digest;
  return hash.slice(0, 12);
}

function imageName(fullName: string): string {
  // ghcr.io/lonetis/agentor-orchestrator:latest -> orchestrator
  const agentorMatch = fullName.match(/agentor-(\w+):/);
  if (agentorMatch) return agentorMatch[1]!;
  // traefik:v3 -> traefik, user/repo:tag -> repo
  const parts = fullName.split(':')[0] ?? fullName;
  const segments = parts.split('/');
  return segments[segments.length - 1]!;
}

function imageKey(info: ImageUpdateInfo): UpdatableImage | null {
  if (status.value?.orchestrator === info) return 'orchestrator';
  if (status.value?.mapper === info) return 'mapper';
  if (status.value?.worker === info) return 'worker';
  if (status.value?.traefik === info) return 'traefik';
  return null;
}

const imageList = computed(() =>
  [status.value?.orchestrator, status.value?.mapper, status.value?.worker, status.value?.traefik]
    .filter((i): i is ImageUpdateInfo => !!i)
);

const anyApplyingImage = computed(() => applyingImages.value.size > 0);
</script>

<template>
  <div v-if="isProductionMode" class="px-3 pb-3 pt-2">
    <!-- Restarting overlay -->
    <div
      v-if="isRestarting"
      class="rounded-lg bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 p-3 text-center"
    >
      <div class="flex items-center justify-center gap-2 text-blue-700 dark:text-blue-300 text-sm font-medium">
        <svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        Reconnecting...
      </div>
      <p class="text-xs text-blue-600 dark:text-blue-400 mt-1">Orchestrator is restarting with the new image.</p>
    </div>

    <!-- Update banner -->
    <div v-else>
      <!-- Updates available -->
      <div
        v-if="updatesAvailable > 0"
        class="rounded-lg bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 p-2.5"
      >
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <div class="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            <span class="text-sm font-medium text-amber-800 dark:text-amber-200">
              {{ updatesAvailable }} update{{ updatesAvailable > 1 ? 's' : '' }} available
            </span>
          </div>
          <button
            class="text-xs text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200"
            @click="expanded = !expanded"
          >
            {{ expanded ? 'Less' : 'Details' }}
          </button>
        </div>

        <!-- Expanded details -->
        <div v-if="expanded" class="mt-2 space-y-1.5">
          <div
            v-for="info in imageList"
            :key="info.name"
            class="text-xs"
          >
            <div class="flex items-center justify-between gap-1">
              <span class="font-medium text-amber-700 dark:text-amber-300">{{ imageName(info.name) }}</span>
              <div class="flex items-center gap-1.5">
                <span
                  v-if="info.updateAvailable"
                  class="text-amber-600 dark:text-amber-400"
                >
                  {{ shortDigest(info.localDigest) }} -> {{ shortDigest(info.remoteDigest) }}
                </span>
                <span
                  v-else-if="info.error"
                  class="text-red-500"
                >
                  error
                </span>
                <span
                  v-else
                  class="text-green-600 dark:text-green-400"
                >
                  up to date
                </span>
                <button
                  v-if="info.updateAvailable && imageKey(info)"
                  class="ml-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-200 hover:bg-amber-300 dark:hover:bg-amber-700 disabled:opacity-50"
                  :disabled="isApplying || anyApplyingImage || isChecking"
                  @click="applyImage(imageKey(info)!)"
                >
                  <template v-if="applyingImages.has(imageKey(info)!)">...</template>
                  <template v-else>Update</template>
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Error messages -->
        <div v-if="applyErrors.length > 0" class="mt-2">
          <p
            v-for="(err, i) in applyErrors"
            :key="i"
            class="text-xs text-red-600 dark:text-red-400"
          >
            {{ err }}
          </p>
        </div>

        <!-- Actions -->
        <div class="mt-2.5 flex gap-2">
          <UButton
            size="xs"
            color="warning"
            :loading="isApplying"
            :disabled="isChecking || anyApplyingImage"
            @click="applyUpdates"
          >
            Update All
          </UButton>
          <UButton
            size="xs"
            color="neutral"
            variant="ghost"
            :loading="isChecking"
            :disabled="isApplying || anyApplyingImage"
            @click="checkNow"
          >
            Re-check
          </UButton>
        </div>
      </div>

      <!-- No updates / status line -->
      <div v-else-if="status" class="flex items-center justify-between">
        <span class="text-[10px] text-gray-400 dark:text-gray-500">
          Images up to date
        </span>
        <button
          class="text-[10px] text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400"
          :disabled="isChecking"
          @click="checkNow"
        >
          {{ isChecking ? 'Checking...' : 'Check' }}
        </button>
      </div>
    </div>
  </div>
</template>
