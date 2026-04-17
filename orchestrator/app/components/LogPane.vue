<script setup lang="ts">
import type { LogLevel, LogSource } from '~/types';

const {
  filteredEntries,
  connected,
  filters,
  autoScroll,
  loadingMore,
  loadingInitial,
  hasMoreOlder,
  liveTick,
  loadMore,
  clearLogs,
} = useLogs();

const scrollContainer = ref<HTMLElement>();
const searchInput = ref('');
const SCROLL_TRIGGER_PX = 80;
let searchTimeout: ReturnType<typeof setTimeout> | null = null;

function onSearchInput(val: string) {
  if (searchTimeout) clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    filters.search = val;
  }, 300);
}

function toggleSource(source: LogSource) {
  const idx = filters.sources.indexOf(source);
  if (idx === -1) {
    filters.sources.push(source);
  } else {
    filters.sources.splice(idx, 1);
  }
}

function toggleLevel(level: LogLevel) {
  const idx = filters.levels.indexOf(level);
  if (idx === -1) {
    filters.levels.push(level);
  } else {
    filters.levels.splice(idx, 1);
  }
}

function isSourceActive(source: LogSource): boolean {
  return filters.sources.length === 0 || filters.sources.includes(source);
}

function isLevelActive(level: LogLevel): boolean {
  return filters.levels.length === 0 || filters.levels.includes(level);
}

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
      + '.' + String(d.getMilliseconds()).padStart(3, '0');
  } catch {
    return ts;
  }
}

function handleClear() {
  if (confirm('Clear all log files? This cannot be undone.')) {
    clearLogs();
  }
}

// Anchor scroll position when older entries are prepended so the user's
// view does not jump. Records the scrollHeight before prepend; the watcher
// below applies the delta after Vue has re-rendered.
let pendingAnchor: { prevHeight: number; prevTop: number } | null = null;

async function maybeLoadMore() {
  if (loadingMore.value || !hasMoreOlder.value) return;
  const el = scrollContainer.value;
  if (!el) return;
  pendingAnchor = { prevHeight: el.scrollHeight, prevTop: el.scrollTop };
  const added = await loadMore();
  if (added === 0) {
    pendingAnchor = null;
  }
  // Re-check immediately in case the visible viewport is still near the
  // top after loading (small page or fast scroll). The watcher anchors
  // first, then this fires again if the user is still near the top.
}

// Restore scroll anchor after the prepended entries have rendered. We watch
// filteredEntries.length so the anchor is applied even if filters drop a
// few of the freshly-loaded entries.
watch(
  () => filteredEntries.value.length,
  () => {
    if (!pendingAnchor) return;
    const el = scrollContainer.value;
    if (!el) {
      pendingAnchor = null;
      return;
    }
    nextTick(() => {
      const anchor = pendingAnchor;
      if (!anchor || !scrollContainer.value) return;
      const delta = scrollContainer.value.scrollHeight - anchor.prevHeight;
      scrollContainer.value.scrollTop = anchor.prevTop + delta;
      pendingAnchor = null;
    });
  },
);

// Auto-scroll on live append only — driven by a tick the composable bumps
// when the WebSocket pushes a new entry. Pagination prepends never bump
// the tick, so they cannot trigger an unwanted jump to the bottom.
watch(liveTick, () => {
  if (autoScroll.value && scrollContainer.value) {
    nextTick(() => {
      scrollContainer.value!.scrollTop = scrollContainer.value!.scrollHeight;
    });
  }
});

// Initial paint: jump to bottom once entries first arrive.
let didInitialScroll = false;
watch(
  () => filteredEntries.value.length,
  (len) => {
    if (didInitialScroll || len === 0 || !scrollContainer.value) return;
    didInitialScroll = true;
    nextTick(() => {
      if (!scrollContainer.value) return;
      scrollContainer.value.scrollTop = scrollContainer.value.scrollHeight;
    });
  },
  { immediate: true },
);

function onScroll() {
  if (!scrollContainer.value) return;
  const el = scrollContainer.value;
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
  autoScroll.value = atBottom;
  if (el.scrollTop <= SCROLL_TRIGGER_PX) {
    void maybeLoadMore();
  }
}

const sources: { id: LogSource; label: string; color: string }[] = [
  { id: 'orchestrator', label: 'Orchestrator', color: 'purple' },
  { id: 'worker', label: 'Worker', color: 'green' },
  { id: 'traefik', label: 'Traefik', color: 'orange' },
];

const levels: { id: LogLevel; label: string }[] = [
  { id: 'debug', label: 'Debug' },
  { id: 'info', label: 'Info' },
  { id: 'warn', label: 'Warn' },
  { id: 'error', label: 'Error' },
];
</script>

<template>
  <div class="log-pane">
    <!-- Filter bar -->
    <div class="log-filter-bar">
      <div class="log-filter-group">
        <span class="log-filter-label">Source:</span>
        <button
          v-for="s in sources"
          :key="s.id"
          class="log-filter-btn"
          :class="{ 'log-filter-btn-active': isSourceActive(s.id), [`log-source-${s.id}`]: isSourceActive(s.id) }"
          @click="toggleSource(s.id)"
        >
          {{ s.label }}
        </button>
      </div>

      <div class="log-filter-group">
        <span class="log-filter-label">Level:</span>
        <button
          v-for="l in levels"
          :key="l.id"
          class="log-filter-btn"
          :class="{ 'log-filter-btn-active': isLevelActive(l.id), [`log-level-${l.id}`]: isLevelActive(l.id) }"
          @click="toggleLevel(l.id)"
        >
          {{ l.label }}
        </button>
      </div>

      <input
        v-model="searchInput"
        type="text"
        class="log-search-input"
        placeholder="Search logs..."
        @input="onSearchInput(searchInput)"
      >

      <div class="log-filter-actions">
        <button
          class="log-filter-btn"
          :class="{ 'log-filter-btn-active': autoScroll }"
          title="Auto-scroll to bottom"
          @click="autoScroll = !autoScroll"
        >
          <UIcon name="i-lucide-arrow-down-to-line" class="size-3.5" />
        </button>
        <button
          class="log-filter-btn"
          title="Clear all logs"
          @click="handleClear"
        >
          <UIcon name="i-lucide-trash-2" class="size-3.5" />
        </button>
      </div>
    </div>

    <!-- Log entries -->
    <div ref="scrollContainer" class="log-entries" @scroll="onScroll">
      <div v-if="loadingMore" class="log-pagination-indicator">
        <UIcon name="i-lucide-loader-circle" class="size-3.5 log-spinner" />
        <span>Loading older entries…</span>
      </div>
      <div v-else-if="!hasMoreOlder && filteredEntries.length > 0" class="log-pagination-indicator log-pagination-end">
        Beginning of logs
      </div>
      <div v-if="loadingInitial && filteredEntries.length === 0" class="log-empty">
        Loading…
      </div>
      <div v-else-if="filteredEntries.length === 0" class="log-empty">
        No log entries{{ filters.sources.length > 0 || filters.levels.length > 0 || filters.search ? ' matching filters' : '' }}.
      </div>
      <div
        v-for="(entry, i) in filteredEntries"
        :key="`${entry.timestamp}-${i}`"
        class="log-entry"
        :class="`log-entry-${entry.level}`"
      >
        <span class="log-timestamp">{{ formatTimestamp(entry.timestamp) }}</span>
        <span class="log-level-badge" :class="`log-level-${entry.level}`">{{ entry.level.toUpperCase() }}</span>
        <span class="log-source-badge" :class="`log-source-${entry.source}`">{{ entry.source }}</span>
        <span v-if="entry.sourceId && entry.source !== 'orchestrator'" class="log-source-id">{{ entry.sourceName || entry.sourceId }}</span>
        <span class="log-message">{{ entry.message }}</span>
      </div>
    </div>

    <!-- Status bar -->
    <div class="log-status-bar">
      <span class="log-status-dot" :class="connected ? 'log-status-connected' : 'log-status-disconnected'" />
      <span class="log-status-text">{{ connected ? 'Connected' : 'Disconnected' }}</span>
      <span class="log-status-count">{{ filteredEntries.length }} entries</span>
    </div>
  </div>
</template>

<style scoped>
.log-pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--terminal-bg);
  color: var(--terminal-text);
  font-family: 'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Menlo', monospace;
  font-size: 12px;
}

.log-filter-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 12px;
  background: var(--terminal-bar-bg);
  border-bottom: 1px solid var(--terminal-bar-border);
  flex-shrink: 0;
  flex-wrap: wrap;
}

.log-filter-group {
  display: flex;
  align-items: center;
  gap: 4px;
}

.log-filter-label {
  font-size: 11px;
  color: var(--terminal-text-muted);
  font-weight: 500;
  margin-right: 2px;
}

.log-filter-btn {
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid var(--terminal-bar-border);
  background: transparent;
  color: var(--terminal-text-muted);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
  display: flex;
  align-items: center;
  gap: 4px;
}

.log-filter-btn:hover {
  background: var(--terminal-hover-bg);
  color: var(--terminal-text);
}

.log-filter-btn-active {
  background: var(--terminal-hover-bg);
  color: var(--terminal-text);
  border-color: var(--terminal-accent);
}

.log-search-input {
  padding: 3px 8px;
  border-radius: 4px;
  border: 1px solid var(--terminal-input-border);
  background: var(--terminal-input-bg);
  color: var(--terminal-text);
  font-size: 11px;
  font-family: inherit;
  width: 180px;
  outline: none;
}

.log-search-input:focus {
  border-color: var(--terminal-accent);
}

.log-search-input::placeholder {
  color: var(--terminal-text-dimmed);
}

.log-filter-actions {
  display: flex;
  gap: 4px;
  margin-left: auto;
}

.log-entries {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 4px 0;
}

.log-entries::-webkit-scrollbar {
  width: 8px;
}

.log-entries::-webkit-scrollbar-track {
  background: var(--scrollbar-track);
}

.log-entries::-webkit-scrollbar-thumb {
  background: var(--scrollbar-thumb);
  border-radius: 4px;
}

.log-entries::-webkit-scrollbar-thumb:hover {
  background: var(--scrollbar-thumb-hover);
}

.log-empty {
  padding: 32px;
  text-align: center;
  color: var(--terminal-text-dimmed);
}

.log-pagination-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 12px;
  font-size: 11px;
  color: var(--terminal-text-dimmed);
  border-bottom: 1px dashed var(--terminal-bar-border);
}

.log-pagination-end {
  font-style: italic;
}

.log-spinner {
  animation: log-spin 0.8s linear infinite;
}

@keyframes log-spin {
  to { transform: rotate(360deg); }
}

.log-entry {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 1px 12px;
  line-height: 1.6;
  white-space: nowrap;
}

.log-entry:hover {
  background: var(--terminal-hover-bg);
}

.log-entry-error {
  color: #f85149;
}

.log-entry-warn {
  color: #d29922;
}

.log-timestamp {
  color: var(--terminal-text-dimmed);
  flex-shrink: 0;
}

.log-level-badge {
  padding: 0 4px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 600;
  flex-shrink: 0;
  min-width: 44px;
  text-align: center;
}

.log-level-debug { background: #30363d; color: #8b949e; }
.log-level-info { background: #0d419d33; color: #58a6ff; }
.log-level-warn { background: #9e6a0033; color: #d29922; }
.log-level-error { background: #da363433; color: #f85149; }

.log-source-badge {
  padding: 0 4px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 600;
  flex-shrink: 0;
  min-width: 60px;
  text-align: center;
}

.log-source-orchestrator { background: #8b5cf633; color: #a78bfa; }
.log-source-worker { background: #22c55e33; color: #4ade80; }
.log-source-traefik { background: #f9731633; color: #fb923c; }

.log-source-id {
  color: var(--terminal-text-muted);
  font-size: 11px;
  flex-shrink: 0;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.log-message {
  overflow: hidden;
  text-overflow: ellipsis;
}

.log-status-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  background: var(--terminal-bar-bg);
  border-top: 1px solid var(--terminal-bar-border);
  font-size: 11px;
  color: var(--terminal-text-muted);
  flex-shrink: 0;
}

.log-status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.log-status-connected {
  background: #4ade80;
}

.log-status-disconnected {
  background: #f85149;
}

.log-status-count {
  margin-left: auto;
}
</style>
