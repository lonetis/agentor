import type { LogEntry, LogLevel, LogSource } from '~/types';

const MAX_ENTRIES = 5000;

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

let ws: WebSocket | null = null;
let initialized = false;

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
        if (!paused.value) {
          entries.value.push(entry);
          if (entries.value.length > MAX_ENTRIES) {
            entries.value = entries.value.slice(-MAX_ENTRIES);
          }
        }
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

  async function fetchHistory() {
    const params = new URLSearchParams();
    if (filters.sources.length > 0) params.set('sources', filters.sources.join(','));
    if (filters.levels.length > 0) params.set('levels', filters.levels.join(','));
    if (filters.search) params.set('search', filters.search);
    params.set('limit', '500');

    try {
      const res = await $fetch<{ entries: LogEntry[]; hasMore: boolean }>(`/api/logs?${params}`);
      // Reverse to show oldest first (API returns newest-first)
      entries.value = res.entries.reverse();
    } catch {}
  }

  async function clearLogs() {
    try {
      await $fetch('/api/logs', { method: 'DELETE' });
      entries.value = [];
    } catch {}
  }

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
    connect,
    disconnect,
    fetchHistory,
    clearLogs,
  };
}
