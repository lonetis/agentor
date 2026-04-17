import type { LogEntry, LogLevel, LogSource } from '~/types';

// Soft cap on entries kept in memory to avoid runaway growth on a long-lived
// session. Old entries beyond this are evicted from the front (oldest first).
// Set high enough that practical scrollback is unbounded — actual lazy load
// fetches more from the server on demand.
const MAX_ENTRIES = 50_000;
const PAGE_SIZE = 500;

// Module-level state (singleton, survives component lifecycle)
const entries = ref<LogEntry[]>([]);
const connected = ref(false);
const filters = reactive({
  sources: [] as LogSource[],
  levels: [] as LogLevel[],
  search: '',
});
const paused = ref(false);
const autoScroll = ref(true);
const loadingMore = ref(false);
const loadingInitial = ref(false);
const hasMoreOlder = ref(true);

// Bumped each time the live WebSocket pushes a new entry. LogPane watches
// this to drive auto-scroll-to-bottom (so prepend-from-pagination does not
// trigger a jump to the bottom).
const liveTick = ref(0);

let ws: WebSocket | null = null;
let initialized = false;
// Bumped on every filter change so an in-flight loadMore from the previous
// filter set cannot mutate the freshly-rebuilt entries array.
let filterEpoch = 0;

function entryKey(e: LogEntry): string {
  return `${e.timestamp}|${e.source}|${e.sourceId ?? ''}|${e.message}`;
}

function buildQuery(extra: Record<string, string | number> = {}): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.sources.length > 0) params.set('sources', filters.sources.join(','));
  if (filters.levels.length > 0) params.set('levels', filters.levels.join(','));
  if (filters.search) params.set('search', filters.search);
  for (const [k, v] of Object.entries(extra)) params.set(k, String(v));
  return params;
}

export function useLogs() {
  function connect() {
    if (ws && ws.readyState <= WebSocket.OPEN) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}/ws/logs`);

    ws.onopen = () => {
      connected.value = true;
    };

    ws.onmessage = (event) => {
      try {
        const entry = JSON.parse(event.data) as LogEntry;
        if (paused.value) return;
        // The server broadcasts every entry; client-side filters decide
        // what gets shown. Always store so filter toggles do not lose
        // recent live data.
        entries.value.push(entry);
        // Only cull from the front when the user is at the bottom
        // (autoScroll on). When they are scrolled back in history, culling
        // would yank entries out from under their viewport and break
        // pagination's anchor. The dropped entries can always be re-fetched
        // via loadMore() once they scroll up to the new front.
        if (entries.value.length > MAX_ENTRIES && autoScroll.value) {
          entries.value.splice(0, entries.value.length - MAX_ENTRIES);
          hasMoreOlder.value = true;
        }
        liveTick.value++;
      } catch {}
    };

    ws.onclose = () => {
      connected.value = false;
      // Auto-reconnect after 3s
      setTimeout(() => {
        if (!connected.value) connect();
      }, 3000);
    };

    ws.onerror = () => {
      connected.value = false;
    };
  }

  function disconnect() {
    if (ws) {
      ws.onclose = null;
      ws.close();
      ws = null;
    }
    connected.value = false;
  }

  // Fetch the most recent page. Used on first mount and whenever the active
  // filters change (so server-side filtering matches what the user sees).
  async function fetchHistory() {
    const epoch = filterEpoch;
    loadingInitial.value = true;
    try {
      const params = buildQuery({ limit: PAGE_SIZE });
      const res = await $fetch<{ entries: LogEntry[]; hasMore: boolean }>(`/api/logs?${params}`);
      // The endpoint returns newest-first; reverse so entries[0] is oldest.
      if (epoch !== filterEpoch) return;
      entries.value = res.entries.slice().reverse();
      hasMoreOlder.value = res.hasMore;
    } catch {
      if (epoch !== filterEpoch) return;
      entries.value = [];
      hasMoreOlder.value = false;
    } finally {
      if (epoch === filterEpoch) loadingInitial.value = false;
    }
  }

  // Fetch the next older page strictly before the current oldest entry.
  // Returns the number of entries prepended (0 = no more, or aborted).
  async function loadMore(): Promise<number> {
    if (loadingMore.value) return 0;
    if (!hasMoreOlder.value) return 0;
    if (entries.value.length === 0) {
      // Nothing to anchor to yet — fall through to a normal fetch.
      await fetchHistory();
      return entries.value.length;
    }
    const epoch = filterEpoch;
    const oldest = entries.value[0]!.timestamp;
    loadingMore.value = true;
    try {
      const params = buildQuery({ until: oldest, limit: PAGE_SIZE });
      const res = await $fetch<{ entries: LogEntry[]; hasMore: boolean }>(`/api/logs?${params}`);
      if (epoch !== filterEpoch) return 0;
      // The API treats `until` as exclusive (timestamp < until), so the
      // boundary entry is never re-returned. We still de-dupe defensively
      // in case the same entry text appears twice (e.g. clock skew across
      // sources producing identical millisecond timestamps).
      const seen = new Set<string>();
      for (const e of entries.value) seen.add(entryKey(e));
      const fresh = res.entries
        .slice()
        .reverse()
        .filter((e) => !seen.has(entryKey(e)));
      if (fresh.length > 0) {
        entries.value = [...fresh, ...entries.value];
      }
      hasMoreOlder.value = res.hasMore;
      return fresh.length;
    } catch {
      return 0;
    } finally {
      if (epoch === filterEpoch) loadingMore.value = false;
    }
  }

  async function clearLogs() {
    try {
      await $fetch('/api/logs', { method: 'DELETE' });
      entries.value = [];
      hasMoreOlder.value = false;
    } catch {}
  }

  // Filters apply both on the server (for paginated fetches) and on the
  // client (so live WS entries are gated without round-tripping). Refetch
  // history whenever filters change so pagination stays consistent.
  watch(
    [() => filters.sources.slice(), () => filters.levels.slice(), () => filters.search],
    () => {
      filterEpoch++;
      hasMoreOlder.value = true;
      fetchHistory();
    },
    { deep: false },
  );

  const filteredEntries = computed(() => {
    return entries.value.filter((entry) => {
      if (filters.sources.length > 0 && !filters.sources.includes(entry.source)) return false;
      if (filters.levels.length > 0 && !filters.levels.includes(entry.level)) return false;
      if (filters.search && !entry.message.toLowerCase().includes(filters.search.toLowerCase())) return false;
      return true;
    });
  });

  // Initialize once
  if (!initialized) {
    initialized = true;
    fetchHistory().then(() => connect());
  }

  return {
    entries,
    filteredEntries,
    connected,
    filters,
    paused,
    autoScroll,
    loadingMore,
    loadingInitial,
    hasMoreOlder,
    liveTick,
    connect,
    disconnect,
    fetchHistory,
    loadMore,
    clearLogs,
  };
}
