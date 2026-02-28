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

function shortDigest(digest: string): string {
  if (!digest) return '';
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
  <div class="px-3 pb-3">
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

    <template v-else>
      <!-- Image list (always shown) -->
      <div class="space-y-1">
        <div
          v-for="info in imageList"
          :key="info.name"
          class="flex items-center justify-between gap-1 text-xs"
        >
          <span class="font-medium text-gray-600 dark:text-gray-400 truncate">{{ imageName(info.name) }}</span>
          <div class="flex items-center gap-1.5 flex-shrink-0">
            <template v-if="isProductionMode && info.updateAvailable">
              <div class="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse flex-shrink-0" />
              <span class="text-amber-600 dark:text-amber-400 font-mono text-[10px]">
                {{ shortDigest(info.localDigest) }} &rarr; {{ shortDigest(info.remoteDigest) }}
              </span>
              <button
                v-if="imageKey(info)"
                class="ml-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-200 hover:bg-amber-300 dark:hover:bg-amber-700 disabled:opacity-50"
                :disabled="isApplying || anyApplyingImage || isChecking"
                @click="applyImage(imageKey(info)!)"
              >
                <template v-if="applyingImages.has(imageKey(info)!)">...</template>
                <template v-else>Update</template>
              </button>
            </template>
            <template v-else-if="info.error">
              <span class="text-red-500 text-[10px]">error</span>
            </template>
            <template v-else-if="info.localDigest">
              <span class="text-gray-400 dark:text-gray-500 font-mono text-[10px]">{{ shortDigest(info.localDigest) }}</span>
              <span
                v-if="isProductionMode"
                class="text-green-600 dark:text-green-500 text-[10px]"
              >&#10003;</span>
            </template>
            <template v-else>
              <span class="text-gray-400 dark:text-gray-600 text-[10px] italic">not found</span>
            </template>
          </div>
        </div>
      </div>

      <!-- No images loaded yet -->
      <div v-if="imageList.length === 0 && !status" class="text-[10px] text-gray-400 dark:text-gray-600 italic">
        Loading...
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

      <!-- Production mode: update actions -->
      <div v-if="isProductionMode && updatesAvailable > 0" class="mt-2 flex gap-2">
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

      <!-- Production mode: up to date with check button -->
      <div
        v-else-if="isProductionMode && status"
        class="mt-1.5 flex items-center justify-end"
      >
        <button
          class="text-[10px] text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-400"
          :disabled="isChecking"
          @click="checkNow"
        >
          {{ isChecking ? 'Checking...' : 'Check for updates' }}
        </button>
      </div>
    </template>
  </div>
</template>
