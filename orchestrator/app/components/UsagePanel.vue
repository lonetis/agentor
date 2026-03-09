<script setup lang="ts">
import type { AgentUsageInfo } from '~/types';

const { status } = useUsage();

const now = ref(Date.now());
let nowTimer: ReturnType<typeof setInterval> | null = null;
onMounted(() => { nowTimer = setInterval(() => { now.value = Date.now(); }, 30_000); });
onUnmounted(() => { if (nowTimer) clearInterval(nowTimer); });

function barColor(utilization: number): string {
  if (utilization >= 80) return 'bg-red-500';
  if (utilization >= 50) return 'bg-amber-500';
  return 'bg-green-500';
}

function trackColor(utilization: number): string {
  if (utilization >= 80) return 'bg-red-100 dark:bg-red-950';
  if (utilization >= 50) return 'bg-amber-100 dark:bg-amber-950';
  return 'bg-green-100 dark:bg-green-950';
}

function textColor(utilization: number): string {
  if (utilization >= 80) return 'text-red-600 dark:text-red-400';
  if (utilization >= 50) return 'text-amber-600 dark:text-amber-400';
  return 'text-green-600 dark:text-green-400';
}

function relativeTime(iso: string | null): string {
  if (!iso) return '';
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return 'now';
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function fetchedAgo(iso: string | undefined): string {
  if (!iso) return '';
  const diff = now.value - new Date(iso).getTime();
  if (diff < 60_000) return 'just now';
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m ago`;
}

function authBadge(agent: AgentUsageInfo): { label: string; class: string } {
  switch (agent.authType) {
    case 'oauth': return { label: 'OAuth', class: 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300' };
    case 'api-key': return { label: 'API key', class: 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300' };
    default: return { label: 'not configured', class: 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400' };
  }
}
</script>

<template>
  <div>
    <div v-if="!status" class="text-[10px] text-gray-400 dark:text-gray-600 italic">
      Loading...
    </div>

    <div v-else class="space-y-3">
      <div v-for="agent in status.agents" :key="agent.agentId" class="system-card">
        <!-- Agent header -->
        <div class="system-card-header">
          <span>{{ agent.displayName }}</span>
          <span
            v-if="fetchedAgo(agent.lastFetchTime)"
            class="text-[9px] text-gray-400 dark:text-gray-500 font-normal"
          >
            {{ fetchedAgo(agent.lastFetchTime) }}
          </span>
          <span
            v-if="agent.planType"
            class="px-1 py-0.5 text-[9px] font-medium rounded bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300"
          >
            {{ agent.planType }}
          </span>
          <span
            class="ml-auto px-1 py-0.5 text-[9px] font-medium rounded"
            :class="authBadge(agent).class"
          >
            {{ authBadge(agent).label }}
          </span>
        </div>

        <!-- Usage windows -->
        <div v-if="agent.windows.length > 0" class="px-3 py-2.5 space-y-1">
          <div v-for="(w, i) in agent.windows" :key="i" class="flex items-center gap-1.5">
            <span class="text-[10px] text-gray-500 dark:text-gray-400 w-11 text-right flex-shrink-0 truncate">{{ w.label }}</span>
            <div class="flex-1 h-1.5 rounded-full overflow-hidden" :class="trackColor(w.utilization)">
              <div
                class="h-full rounded-full transition-all duration-500"
                :class="barColor(w.utilization)"
                :style="{ width: `${Math.min(100, w.utilization)}%` }"
              />
            </div>
            <span class="text-[10px] font-mono w-7 text-right flex-shrink-0" :class="textColor(w.utilization)">
              {{ Math.round(w.utilization) }}%
            </span>
            <span
              v-if="w.resetsAt"
              class="text-[9px] text-gray-400 dark:text-gray-500 w-10 text-right flex-shrink-0"
              :title="w.resetsAt"
            >
              {{ relativeTime(w.resetsAt) }}
            </span>
            <span v-else class="w-10 flex-shrink-0" />
          </div>
        </div>

        <!-- No usage data -->
        <div v-else-if="agent.authType === 'api-key'" class="px-3 py-2.5">
          <span class="text-[10px] text-gray-400 dark:text-gray-500 italic">No usage data for API key auth</span>
        </div>
        <div v-else-if="agent.authType === 'none'" class="px-3 py-2.5">
          <span class="text-[10px] text-gray-400 dark:text-gray-500 italic">Not configured</span>
        </div>

        <!-- Error -->
        <div v-if="agent.error" class="px-3 pb-2">
          <span class="text-[10px] text-red-500 dark:text-red-400">{{ agent.error }}</span>
        </div>

      </div>
    </div>
  </div>
</template>
