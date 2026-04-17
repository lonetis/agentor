import type { PaneNode, PaneLeafNode, Tab, TabType } from '~/types';

const STORAGE_KEY = 'agentor-ui-state';
const WRITE_DEBOUNCE_MS = 500;

const VALID_TAB_TYPES: ReadonlySet<TabType> = new Set<TabType>([
  'terminal',
  'desktop',
  'apps',
  'editor',
  'vscode',
  'logs',
]);

function isLeafShape(node: unknown): node is PaneLeafNode {
  return !!node && typeof node === 'object' && Array.isArray((node as PaneLeafNode).tabs);
}

function sanitizeTab(raw: unknown): Tab | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Partial<Tab>;
  if (typeof t.id !== 'string' || typeof t.containerId !== 'string') return null;
  if (typeof t.containerName !== 'string') return null;
  if (typeof t.type !== 'string' || !VALID_TAB_TYPES.has(t.type as TabType)) return null;
  return { id: t.id, containerId: t.containerId, containerName: t.containerName, type: t.type as TabType };
}

function sanitizeNode(raw: unknown): PaneNode | null {
  if (!raw || typeof raw !== 'object') return null;
  const n = raw as Partial<PaneLeafNode & { children: unknown[]; direction: string }>;
  if (typeof n.id !== 'string' || typeof n.sizeFraction !== 'number') return null;

  if (isLeafShape(raw)) {
    const tabs = (n.tabs as unknown[]).map(sanitizeTab).filter((t): t is Tab => t !== null);
    if (tabs.length === 0) return null;
    const activeTabId = typeof n.activeTabId === 'string' && tabs.some((t) => t.id === n.activeTabId)
      ? n.activeTabId
      : tabs[0]!.id;
    return { id: n.id, sizeFraction: n.sizeFraction, tabs, activeTabId };
  }

  if (Array.isArray(n.children) && (n.direction === 'horizontal' || n.direction === 'vertical')) {
    const children = n.children.map(sanitizeNode).filter((c): c is PaneNode => c !== null);
    if (children.length === 0) return null;
    if (children.length === 1) {
      // Collapse single-child container into its child, inheriting this node's sizeFraction
      children[0]!.sizeFraction = n.sizeFraction;
      return children[0]!;
    }
    return { id: n.id, sizeFraction: n.sizeFraction, direction: n.direction, children };
  }

  return null;
}

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
  activeTab: string;
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
      activeTab: 'workers',
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
  // Persistence bounds only; runtime viewport clamp lives in useSidebarResize
  return Math.min(3000, Math.max(200, w));
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
          if (typeof parsed.sidebar.activeTab === 'string') {
            base.sidebar.activeTab = parsed.sidebar.activeTab;
          }
          if (parsed.sidebar.panels && typeof parsed.sidebar.panels === 'object') {
            for (const key of Object.keys(DEFAULT_PANELS) as (keyof PanelStates)[]) {
              if (typeof parsed.sidebar.panels[key] === 'boolean') {
                base.sidebar.panels[key] = parsed.sidebar.panels[key];
              }
            }
          }
        }
        // Merge panes — sanitize restored tree, dropping unknown tab types and empty leaves
        if (parsed.panes && typeof parsed.panes === 'object') {
          const sanitizedRoot = parsed.panes.rootNode != null ? sanitizeNode(parsed.panes.rootNode) : null;
          base.panes.rootNode = sanitizedRoot;
          if (sanitizedRoot && typeof parsed.panes.focusedNodeId === 'string') {
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

  function setActiveTab(tab: string) {
    s.value.sidebar.activeTab = tab;
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
    setActiveTab,
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
