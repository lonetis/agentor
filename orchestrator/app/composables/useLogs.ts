import type { ComputedRef } from 'vue';
import type { LogEntry, LogLevel, LogSource } from '~/types';
import { pageVisible } from '~/composables/usePolling';

/** A log entry stamped on ingest with a stable render key and its display time. */
export type StampedLogEntry = LogEntry & {
  /** Monotonic key, unique per ingested entry. */
  _k: number;
  /** Local time as HH:MM:SS.mmm. */
  _t: string;
};

// Soft cap on entries kept in memory to avoid runaway growth on a long-lived
// session. Old entries beyond this are evicted from the front (oldest first).
// Set high enough that practical scrollback is unbounded — actual lazy load
// fetches more from the server on demand.
const MAX_ENTRIES = 50_000;
const PAGE_SIZE = 500;
// Mobile browsers drop background sockets anyway; closing ours after a while
// stops the server streaming to a page nobody looks at. History is refetched
// when the page becomes visible again.
const HIDDEN_DISCONNECT_MS = 60_000;

// Module-level state (singleton, shared by every Logs tab)
const entries = shallowRef<StampedLogEntry[]>([]);
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

// Bumped each time live WebSocket entries are appended. LogPane watches
// this to drive auto-scroll-to-bottom (so prepend-from-pagination does not
// trigger a jump to the bottom).
const liveTick = ref(0);

let ws: WebSocket | null = null;
// Single pending reconnect handle so a flurry of onclose/onerror events cannot
// queue several overlapping reconnect timers (which would each spawn a fresh
// socket → reconnect storm).
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
// Bumped on every filter change so an in-flight loadMore from the previous
// filter set cannot mutate the freshly-rebuilt entries array.
let filterEpoch = 0;
// Mounted LogPanes; the socket is open while there is at least one.
let subscribers = 0;
let hiddenDisconnectTimer: ReturnType<typeof setTimeout> | null = null;
// The socket was closed because the page stayed hidden.
let suspended = false;

const timeFormat = new Intl.DateTimeFormat('en-US', {
  hourCycle: 'h23',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});
let entrySeq = 0;

function stamp(entry: LogEntry): StampedLogEntry {
  const date = new Date(entry.timestamp);
  const time = Number.isNaN(date.getTime())
    ? entry.timestamp
    : `${timeFormat.format(date)}.${String(date.getMilliseconds()).padStart(3, '0')}`;
  return Object.assign(entry, { _k: ++entrySeq, _t: time });
}

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

// --- Live entries: buffered and appended once per animation frame ----------

let liveBuffer: StampedLogEntry[] = [];
let flushFrame: number | null = null;

function queueLiveEntry(entry: StampedLogEntry) {
  liveBuffer.push(entry);
  flushFrame ??= requestAnimationFrame(flushLiveEntries);
}

function flushLiveEntries() {
  flushFrame = null;
  if (liveBuffer.length === 0) return;
  // Always a new array: with no filter active, `filteredEntries` returns this
  // array itself, and an in-place push would look unchanged to its readers.
  let next = entries.value.concat(liveBuffer);
  liveBuffer = [];
  // Only cull from the front when the user is at the bottom
  // (autoScroll on). When they are scrolled back in history, culling
  // would yank entries out from under their viewport and break
  // pagination's anchor. The dropped entries can always be re-fetched
  // via loadMore() once they scroll up to the new front.
  if (next.length > MAX_ENTRIES && autoScroll.value) {
    next = next.slice(next.length - MAX_ENTRIES);
    hasMoreOlder.value = true;
  }
  entries.value = next;
  liveTick.value++;
}

function flushLiveEntriesNow() {
  if (flushFrame !== null) cancelAnimationFrame(flushFrame);
  flushLiveEntries();
}

// --- WebSocket -------------------------------------------------------------

function detachSocket(socket: WebSocket) {
  socket.onopen = null;
  socket.onmessage = null;
  socket.onclose = null;
  socket.onerror = null;
}

function scheduleReconnect() {
  if (reconnectTimer) return; // a reconnect is already pending
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (!connected.value) connect();
  }, 3000);
}

function connect() {
  if (subscribers === 0 || suspended) return;
  if (ws && ws.readyState <= WebSocket.OPEN) return;

  // Detach handlers from any dying socket before replacing it, so its late
  // onclose/onerror cannot schedule a second reconnect.
  if (ws) detachSocket(ws);

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${window.location.host}/ws/logs`);

  ws.onopen = () => {
    connected.value = true;
  };

  ws.onmessage = (event) => {
    if (paused.value) return;
    let entry: LogEntry;
    try {
      entry = JSON.parse(event.data) as LogEntry;
    } catch (err) {
      console.warn('[logs] Ignoring a malformed log message:', err);
      return;
    }
    // The server broadcasts every entry; client-side filters decide
    // what gets shown. Always store so filter toggles do not lose
    // recent live data.
    queueLiveEntry(stamp(entry));
  };

  ws.onclose = () => {
    connected.value = false;
    // Auto-reconnect after 3s (onerror is followed by onclose, and the single
    // reconnectTimer guard collapses both into one attempt).
    scheduleReconnect();
  };

  ws.onerror = () => {
    connected.value = false;
  };
}

/** Close the socket without reconnecting; the entries are kept. */
function disconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    const socket = ws;
    ws = null;
    detachSocket(socket);
    socket.close();
  }
  connected.value = false;
  flushLiveEntriesNow();
}

// --- History ---------------------------------------------------------------

// Fetch the most recent page. Used on first mount and whenever the active
// filters change (so server-side filtering matches what the user sees).
async function fetchHistory() {
  const epoch = filterEpoch;
  loadingInitial.value = true;
  try {
    const params = buildQuery({ limit: PAGE_SIZE });
    const res = await $fetch<{ entries: LogEntry[]; hasMore: boolean }>(`/api/logs?${params}`);
    if (epoch !== filterEpoch) return;
    // The endpoint returns newest-first; reverse so entries[0] is oldest.
    entries.value = res.entries.reverse().map(stamp);
    hasMoreOlder.value = res.hasMore;
  } catch (err) {
    if (epoch !== filterEpoch) return;
    console.warn('[logs] Failed to load log history:', err);
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
      .reverse()
      .filter((e) => !seen.has(entryKey(e)))
      .map(stamp);
    if (fresh.length > 0) {
      entries.value = [...fresh, ...entries.value];
    }
    hasMoreOlder.value = res.hasMore;
    return fresh.length;
  } catch (err) {
    console.warn('[logs] Failed to load older log entries:', err);
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
  } catch (err) {
    console.warn('[logs] Failed to clear the logs:', err);
  }
}

// --- Socket lifecycle --------------------------------------------------------

async function resume() {
  await fetchHistory();
  connect();
}

function clearHiddenDisconnect() {
  if (hiddenDisconnectTimer) {
    clearTimeout(hiddenDisconnectTimer);
    hiddenDisconnectTimer = null;
  }
}

function armHiddenDisconnect() {
  hiddenDisconnectTimer ??= setTimeout(() => {
    hiddenDisconnectTimer = null;
    suspended = true;
    disconnect();
  }, HIDDEN_DISCONNECT_MS);
}

function subscribe() {
  subscribers++;
  if (subscribers > 1) return;
  suspended = false;
  if (!pageVisible.value) armHiddenDisconnect();
  void resume();
}

function unsubscribe() {
  subscribers--;
  if (subscribers > 0) return;
  clearHiddenDisconnect();
  suspended = false;
  disconnect();
}

// --- Shared reactive effects -------------------------------------------------

let shared: { filteredEntries: ComputedRef<StampedLogEntry[]> } | null = null;

// Created once in a detached scope, so every Logs tab shares one filtered list
// and one history fetch per filter change, and none of it is tied to the
// lifetime of the tab that happened to be opened first.
function sharedEffects() {
  shared ??= effectScope(true).run(() => {
    // Filters apply both on the server (for paginated fetches) and on the
    // client (so live WS entries are gated without round-tripping). Refetch
    // history whenever filters change so pagination stays consistent.
    watch(
      [() => filters.sources.slice(), () => filters.levels.slice(), () => filters.search],
      () => {
        filterEpoch++;
        hasMoreOlder.value = true;
        if (subscribers > 0) void fetchHistory();
      },
    );

    watch(pageVisible, (visible) => {
      if (subscribers === 0) return;
      if (!visible) {
        armHiddenDisconnect();
        return;
      }
      clearHiddenDisconnect();
      if (suspended) {
        suspended = false;
        void resume();
      }
    });

    const filteredEntries = computed(() => {
      const all = entries.value;
      const sources = filters.sources.slice();
      const levels = filters.levels.slice();
      const query = filters.search.toLowerCase();
      if (sources.length === 0 && levels.length === 0 && !query) return all;
      return all.filter((entry) =>
        (sources.length === 0 || sources.includes(entry.source))
        && (levels.length === 0 || levels.includes(entry.level))
        && (!query || entry.message.toLowerCase().includes(query)));
    });

    return { filteredEntries };
  })!;
  return shared;
}

export function useLogs() {
  const { filteredEntries } = sharedEffects();

  onMounted(subscribe);
  onUnmounted(unsubscribe);

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
    fetchHistory,
    loadMore,
    clearLogs,
  };
}
