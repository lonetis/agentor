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

function handleClear() {
  if (confirm('Clear all log files? This cannot be undone.')) {
    clearLogs();
  }
}

// Anchor scroll position when older entries are prepended so the user's view
// does not jump. The anchor is captured and restored entirely within this
// flow (capture height/top → await loadMore → wait for the prepend to render →
// apply the delta), so a live append or filter change arriving mid-load can no
// longer consume the anchor against the wrong scrollHeight.
async function maybeLoadMore() {
  if (loadingMore.value || !hasMoreOlder.value) return;
  const el = scrollContainer.value;
  if (!el) return;
  const prevHeight = el.scrollHeight;
  const prevTop = el.scrollTop;
  const added = await loadMore();
  if (added === 0) return;
  // Wait for the prepended entries to render before measuring the new height.
  await nextTick();
  const cur = scrollContainer.value;
  if (!cur) return;
  const delta = cur.scrollHeight - prevHeight;
  cur.scrollTop = prevTop + delta;
}

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
          type="button"
          class="log-filter-btn"
          :class="{ 'log-filter-btn-active': isSourceActive(s.id), [`log-source-${s.id}`]: isSourceActive(s.id) }"
          :aria-pressed="filters.sources.includes(s.id)"
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
          type="button"
          class="log-filter-btn"
          :class="{ 'log-filter-btn-active': isLevelActive(l.id), [`log-level-${l.id}`]: isLevelActive(l.id) }"
          :aria-pressed="filters.levels.includes(l.id)"
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
        aria-label="Search logs"
        autocapitalize="off"
        autocorrect="off"
        spellcheck="false"
        @input="onSearchInput(searchInput)"
      >

      <div class="log-filter-actions">
        <button
          type="button"
          class="log-filter-btn"
          :class="{ 'log-filter-btn-active': autoScroll }"
          title="Auto-scroll to bottom"
          aria-label="Auto-scroll to bottom"
          :aria-pressed="autoScroll"
          @click="autoScroll = !autoScroll"
        >
          <UIcon name="i-lucide-arrow-down-to-line" class="size-3.5" />
        </button>
        <button
          type="button"
          class="log-filter-btn"
          title="Clear all logs"
          aria-label="Clear all logs"
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
        v-for="entry in filteredEntries"
        :key="entry._k"
        v-memo="[entry._k]"
        class="log-entry"
        :class="`log-entry-${entry.level}`"
      >
        <span class="log-timestamp">{{ entry._t }}</span>
        <span class="log-level-badge" :class="`log-level-${entry.level}`">{{ entry.level.toUpperCase() }}</span>
        <span class="log-source-badge" :class="`log-source-${entry.source}`">{{ entry.source }}</span>
        <span v-if="entry.sourceId && entry.source !== 'orchestrator'" class="log-source-id">{{ entry.sourceName || entry.sourceId }}</span>
        <span class="log-message">{{ entry.message }}</span>
      </div>
    </div>

    <!-- Status bar -->
    <div class="log-status-bar">
      <span class="log-status-dot" :class="connected ? 'log-status-connected' : 'log-status-disconnected'" />
      <span class="log-status-text" role="status">{{ connected ? 'Connected' : 'Disconnected' }}</span>
      <span class="log-status-count">{{ filteredEntries.length }} entries</span>
    </div>
  </div>
</template>

<style scoped>
/* Badge and row colours per theme (the shared --terminal-* palette has no
   per-level / per-source tones). The light values keep text at AA contrast. */
.log-pane {
  --log-debug-bg: #eaeef2;
  --log-debug-fg: #57606a;
  --log-info-bg: #ddf4ff;
  --log-info-fg: #0969da;
  --log-warn-bg: #fff8c5;
  --log-warn-fg: #9a6700;
  --log-error-bg: #ffebe9;
  --log-error-fg: #cf222e;
  --log-orch-bg: #fbefff;
  --log-orch-fg: #8250df;
  --log-worker-bg: #dafbe1;
  --log-worker-fg: #1a7f37;
  --log-traefik-bg: #fff1e5;
  --log-traefik-fg: #bc4c00;
  --log-warn-row: #9a6700;

  display: flex;
  flex-direction: column;
  height: 100%;
  container-type: inline-size;
  background: var(--terminal-bg);
  color: var(--terminal-text);
  font-family: 'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Menlo', monospace;
  font-size: 12px;
}

.dark .log-pane {
  --log-debug-bg: #30363d;
  --log-debug-fg: #8b949e;
  --log-info-bg: #0d419d33;
  --log-info-fg: #58a6ff;
  --log-warn-bg: #9e6a0033;
  --log-warn-fg: #d29922;
  --log-error-bg: #da363433;
  --log-error-fg: #f85149;
  --log-orch-bg: #8b5cf633;
  --log-orch-fg: #a78bfa;
  --log-worker-bg: #22c55e33;
  --log-worker-fg: #4ade80;
  --log-traefik-bg: #f9731633;
  --log-traefik-fg: #fb923c;
  --log-warn-row: #d29922;
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

@media (pointer: coarse) {
  .log-filter-btn {
    min-height: 32px;
    padding: 4px 10px;
  }
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

.log-search-input:focus-visible {
  box-shadow: 0 0 0 1px var(--terminal-accent);
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
  overscroll-behavior: contain;
  padding: 4px 0;
}

/* Firefox has no ::-webkit-scrollbar. Chromium ignores those pseudo-elements
   once scrollbar-color is set, so it only applies where they are missing. */
@supports not selector(::-webkit-scrollbar) {
  .log-entries {
    scrollbar-color: var(--scrollbar-thumb) var(--scrollbar-track);
  }
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
  color: var(--terminal-text-muted);
}

.log-pagination-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 12px;
  font-size: 11px;
  color: var(--terminal-text-muted);
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
}

.log-entry:hover {
  background: var(--terminal-hover-bg);
}

.log-entry-error {
  color: var(--terminal-danger);
}

.log-entry-warn {
  color: var(--log-warn-row);
}

.log-timestamp {
  color: var(--terminal-text-muted);
  flex-shrink: 0;
  white-space: nowrap;
}

.log-level-badge {
  padding: 0 4px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 600;
  flex-shrink: 0;
  min-width: 44px;
  text-align: center;
  white-space: nowrap;
}

.log-level-debug { background: var(--log-debug-bg); color: var(--log-debug-fg); }
.log-level-info { background: var(--log-info-bg); color: var(--log-info-fg); }
.log-level-warn { background: var(--log-warn-bg); color: var(--log-warn-fg); }
.log-level-error { background: var(--log-error-bg); color: var(--log-error-fg); }

.log-source-badge {
  padding: 0 4px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 600;
  flex-shrink: 0;
  min-width: 60px;
  text-align: center;
  white-space: nowrap;
}

.log-source-orchestrator { background: var(--log-orch-bg); color: var(--log-orch-fg); }
.log-source-worker { background: var(--log-worker-bg); color: var(--log-worker-fg); }
.log-source-traefik { background: var(--log-traefik-bg); color: var(--log-traefik-fg); }

.log-source-id {
  color: var(--terminal-text-muted);
  font-size: 11px;
  flex-shrink: 0;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.log-message {
  flex: 1;
  min-width: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

/* Narrow panes and phones: the message gets its own full-width line. */
@container (max-width: 640px) {
  .log-entry {
    flex-wrap: wrap;
    column-gap: 6px;
    row-gap: 0;
  }

  .log-message {
    flex-basis: 100%;
  }

  .log-source-id {
    max-width: 40%;
  }

  .log-search-input {
    flex: 1 1 100%;
    width: auto;
  }
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
