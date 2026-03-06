import type { PaneNode } from '~/types';

const STORAGE_KEY = 'agentor-ui-state';
const WRITE_DEBOUNCE_MS = 500;

interface PanelStates {
  archived: boolean;
  portMappings: boolean;
  domainMappings: boolean;
  usage: boolean;
  images: boolean;
  settings: boolean;
}

interface SidebarState {
  width: number;
  collapsed: boolean;
  panels: PanelStates;
}

interface PaneState {
  rootNode: PaneNode | null;
  focusedNodeId: string | null;
}

interface TmuxState {
  activeWindows: Record<string, number>;
}

export interface UiState {
  sidebar: SidebarState;
  panes: PaneState;
  tmux: TmuxState;
}

const DEFAULT_PANELS: PanelStates = {
  archived: true,
  portMappings: false,
  domainMappings: false,
  usage: false,
  images: false,
  settings: false,
};

function defaultState(): UiState {
  return {
    sidebar: {
      width: 320,
      collapsed: false,
      panels: { ...DEFAULT_PANELS },
    },
    panes: {
      rootNode: null,
      focusedNodeId: null,
    },
    tmux: {
      activeWindows: {},
    },
  };
}

function clampWidth(w: number): number {
  return Math.min(700, Math.max(200, w));
}

function loadState(): UiState {
  const base = defaultState();

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        // Merge sidebar
        if (parsed.sidebar && typeof parsed.sidebar === 'object') {
          if (typeof parsed.sidebar.width === 'number') {
            base.sidebar.width = clampWidth(parsed.sidebar.width);
          }
          if (typeof parsed.sidebar.collapsed === 'boolean') {
            base.sidebar.collapsed = parsed.sidebar.collapsed;
          }
          if (parsed.sidebar.panels && typeof parsed.sidebar.panels === 'object') {
            for (const key of Object.keys(DEFAULT_PANELS) as (keyof PanelStates)[]) {
              if (typeof parsed.sidebar.panels[key] === 'boolean') {
                base.sidebar.panels[key] = parsed.sidebar.panels[key];
              }
            }
          }
        }
        // Merge panes
        if (parsed.panes && typeof parsed.panes === 'object') {
          if (parsed.panes.rootNode !== undefined) base.panes.rootNode = parsed.panes.rootNode;
          if (typeof parsed.panes.focusedNodeId === 'string' || parsed.panes.focusedNodeId === null) {
            base.panes.focusedNodeId = parsed.panes.focusedNodeId;
          }
        }
        // Merge tmux
        if (parsed.tmux && typeof parsed.tmux === 'object') {
          if (parsed.tmux.activeWindows && typeof parsed.tmux.activeWindows === 'object') {
            base.tmux.activeWindows = parsed.tmux.activeWindows;
          }
        }
      }
    }
  } catch {
    // Corrupt — fall through to defaults
  }

  return base;
}

// --- Module-level singleton ---

let state: Ref<UiState> | null = null;
let writeTimer: ReturnType<typeof setTimeout> | null = null;

function writeToStorage(s: UiState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {}
}

function scheduleWrite() {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    writeTimer = null;
    if (state) writeToStorage(state.value);
  }, WRITE_DEBOUNCE_MS);
}

function flushWrite() {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  if (state) writeToStorage(state.value);
}

function ensureState(): Ref<UiState> {
  if (!state) {
    state = ref(loadState()) as Ref<UiState>;

    // Write immediately so the key exists on fresh start
    writeToStorage(state.value);

    // Flush on page unload
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', flushWrite);
    }
  }
  return state;
}

export function useUiState() {
  const s = ensureState();

  // --- Sidebar ---

  function setSidebarWidth(width: number) {
    s.value.sidebar.width = clampWidth(width);
    scheduleWrite();
  }

  function setSidebarCollapsed(collapsed: boolean) {
    s.value.sidebar.collapsed = collapsed;
    scheduleWrite();
  }

  function setPanelCollapsed(panel: keyof PanelStates, collapsed: boolean) {
    s.value.sidebar.panels[panel] = collapsed;
    scheduleWrite();
  }

  // --- Panes ---

  function setPaneLayout(rootNode: PaneNode | null, focusedNodeId: string | null) {
    s.value.panes.rootNode = rootNode;
    s.value.panes.focusedNodeId = focusedNodeId;
    scheduleWrite();
  }

  // --- Tmux ---

  function setTmuxActiveWindow(containerId: string, windowIndex: number) {
    s.value.tmux.activeWindows[containerId] = windowIndex;
    scheduleWrite();
  }

  function getTmuxActiveWindow(containerId: string): number | undefined {
    return s.value.tmux.activeWindows[containerId];
  }

  function removeTmuxActiveWindow(containerId: string) {
    delete s.value.tmux.activeWindows[containerId];
    scheduleWrite();
  }

  return {
    state: s,
    setSidebarWidth,
    setSidebarCollapsed,
    setPanelCollapsed,
    setPaneLayout,
    setTmuxActiveWindow,
    getTmuxActiveWindow,
    removeTmuxActiveWindow,
  };
}

// For testing: reset module state
export function _resetUiState() {
  if (typeof window !== 'undefined') {
    window.removeEventListener('beforeunload', flushWrite);
  }
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  state = null;
}
