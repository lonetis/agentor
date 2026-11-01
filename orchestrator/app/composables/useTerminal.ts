import type { Terminal, ITheme, IDisposable } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import type { WebLinksAddon } from '@xterm/addon-web-links';
import {
  WheelAccumulator,
  applyMouseMode,
  createMouseModeState,
  encodeWheelReport,
  partitionModeParams,
  reportsWheel,
  type MouseModeState,
} from '~/utils/terminal-mouse';
import { applyModifiersToCharacter, specialKeySequence, type SpecialKey } from '~/utils/terminal-keys';
import { attachTerminalTouch } from '~/utils/terminal-touch';
import { copyText, readText } from '~/utils/clipboard';

export interface TerminalClasses {
  Terminal: typeof Terminal;
  FitAddon: typeof FitAddon;
  WebLinksAddon: typeof WebLinksAddon;
}

export type TerminalConnectionStatus = 'connecting' | 'connected' | 'disconnected';

let terminalClassesPromise: Promise<TerminalClasses> | null = null;

/**
 * Loads xterm.js and its addons on first use, so pages without a terminal
 * (login, setup, OAuth consent) never download them.
 */
export function loadTerminalClasses(): Promise<TerminalClasses> {
  if (!terminalClassesPromise) {
    terminalClassesPromise = Promise.all([
      import('@xterm/xterm'),
      import('@xterm/addon-fit'),
      import('@xterm/addon-web-links'),
    ]).then(([xterm, fit, webLinks]) => ({
      Terminal: xterm.Terminal,
      FitAddon: fit.FitAddon,
      WebLinksAddon: webLinks.WebLinksAddon,
    }));
    // A failed chunk load (e.g. offline) must not poison later attempts.
    terminalClassesPromise.catch(() => {
      terminalClassesPromise = null;
    });
  }
  return terminalClassesPromise;
}

interface Cell {
  /** 0-based column / row inside the visible screen. */
  col: number;
  row: number;
  /** Pixel offset inside the screen element. */
  x: number;
  y: number;
}

interface TouchAnchor {
  row: number;
  startCol: number;
  endCol: number;
}

interface TerminalState {
  containerId: string;
  windowIndex: number;
  term: Terminal;
  fitAddon: FitAddon;
  ws: WebSocket | null;
  containerEl: HTMLElement;
  cleanups: (() => void)[];
  writeBatch: (Uint8Array | string)[];
  writeRafId: number | null;
  mouse: MouseModeState;
  wheel: WheelAccumulator;
  touchScrollPx: number;
  touchAnchor: TouchAnchor | null;
  revealed: boolean;
  disposed: boolean;
}

const DARK_THEME: ITheme = {
  background: '#0d1117',
  foreground: '#c9d1d9',
  cursor: '#58a6ff',
  selectionBackground: '#264f78',
  selectionInactiveBackground: '#264f7899',
  black: '#0d1117',
  red: '#ff7b72',
  green: '#3fb950',
  yellow: '#d29922',
  blue: '#58a6ff',
  magenta: '#bc8cff',
  cyan: '#39d353',
  white: '#c9d1d9',
};

const LIGHT_THEME: ITheme = {
  background: '#ffffff',
  foreground: '#24292f',
  cursor: '#0969da',
  selectionBackground: '#add6ff',
  selectionInactiveBackground: '#add6ff99',
  black: '#24292f',
  red: '#cf222e',
  green: '#116329',
  yellow: '#4d2d00',
  blue: '#0969da',
  magenta: '#8250df',
  cyan: '#1b7c83',
  white: '#6e7781',
};

const FONT_FAMILY = 'Menlo, "SF Mono", ui-monospace, "Cascadia Code", "Fira Code", "JetBrains Mono", "Roboto Mono", monospace';

// Backoff for automatic reconnects while the page is visible.
const RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000, 8000, 15000];
// Mobile browsers suspend background pages; a socket that sat in the
// background this long may be dead without a close event, so reconnect.
const STALE_AFTER_HIDDEN_MS = 30_000;
// Keep the terminal hidden while tmux streams its first full-screen redraw,
// but never longer than this if the socket does not open.
const REVEAL_FALLBACK_MS = 1500;
// tmux copy-mode scrolls 5 lines per wheel report; one report per ~4 rows of
// finger travel keeps touch scrolling close to the finger.
const TOUCH_ROWS_PER_WHEEL_REPORT = 4;
// Some TUIs treat an Enter that arrives with the paste as part of it.
const PASTE_ENTER_DELAY_MS = 50;
// Characters that make up a "word" for long-press selection — URLs and paths
// stay whole; whitespace, quotes, brackets and box-drawing borders split.
const WORD_CHAR = /[^\s"'`()<>[\]{}|│┃║]/;

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export function useTerminal() {
  const colorMode = useColorMode();
  const prefs = useTerminalPrefs();
  const { isMac } = useDevice();

  const activeTerminal = shallowRef<TerminalState | null>(null);
  const status = ref<TerminalConnectionStatus>('connecting');
  const hasSelection = ref(false);
  /** The current selection was made with a touch long-press (shows touch actions). */
  const touchSelection = ref(false);
  const isFocused = ref(false);
  /** One-shot Ctrl / Alt latches from the touch toolbar, applied to the next key. */
  const modifiers = reactive({ ctrl: false, alt: false });

  let fitTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempt = 0;
  let hiddenAt: number | null = null;
  let bypassModifiers = false;

  function getTheme(): ITheme {
    return colorMode.value === 'dark' ? DARK_THEME : LIGHT_THEME;
  }

  // These watchers are created outside a component setup (TerminalPane builds
  // terminals lazily), so destroy() stops them explicitly.
  const stopColorWatch = watch(() => colorMode.value, () => {
    const t = activeTerminal.value;
    if (t) t.term.options.theme = getTheme();
  });
  const stopFontWatch = watch(prefs.fontSize, (size) => {
    const t = activeTerminal.value;
    if (t && t.term.options.fontSize !== size) {
      t.term.options.fontSize = size;
      fitTerminal();
    }
  });

  // --- Output to the worker -------------------------------------------------

  function sendRaw(data: string) {
    const ws = activeTerminal.value?.ws;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(data);
  }

  function clearModifiers() {
    modifiers.ctrl = false;
    modifiers.alt = false;
  }

  /** Feed data through xterm as if typed (scrolls to bottom, clears selection) without applying latches. */
  function inputAsTyped(data: string) {
    const t = activeTerminal.value;
    if (!t || !data) return;
    bypassModifiers = true;
    try {
      t.term.input(data, true);
    } finally {
      bypassModifiers = false;
    }
  }

  // --- Geometry ---------------------------------------------------------------

  function screenMetrics(t: TerminalState) {
    const screen = t.term.element?.querySelector<HTMLElement>('.xterm-screen');
    if (!screen) return null;
    const rect = screen.getBoundingClientRect();
    if (!rect.width || !rect.height || !t.term.cols || !t.term.rows) return null;
    return { rect, cellWidth: rect.width / t.term.cols, cellHeight: rect.height / t.term.rows };
  }

  function cellAt(t: TerminalState, clientX: number, clientY: number): Cell | null {
    const m = screenMetrics(t);
    if (!m) return null;
    const x = clientX - m.rect.left;
    const y = clientY - m.rect.top;
    return {
      col: clamp(Math.floor(x / m.cellWidth), 0, t.term.cols - 1),
      row: clamp(Math.floor(y / m.cellHeight), 0, t.term.rows - 1),
      x,
      y,
    };
  }

  function sendWheelReport(t: TerminalState, cell: Cell, up: boolean, alt = false) {
    sendRaw(encodeWheelReport(t.mouse.encoding, { col: cell.col + 1, row: cell.row + 1, x: cell.x, y: cell.y, up, alt }));
  }

  // --- Mouse wheel ---------------------------------------------------------

  function handleWheel(t: TerminalState, e: WheelEvent) {
    // Without application mouse reporting xterm.js scrolls its own scrollback.
    if (!reportsWheel(t.mouse)) return;
    // xterm.js must never see the wheel while the application wants reports —
    // it would turn it into arrow keys (alternate screen without scrollback).
    e.stopPropagation();
    // Ctrl+wheel stays browser zoom; Shift+wheel is horizontal scrolling.
    if (e.ctrlKey || e.shiftKey || e.deltaY === 0) return;
    e.preventDefault();
    const m = screenMetrics(t);
    const cell = cellAt(t, e.clientX, e.clientY);
    if (!m || !cell) return;
    const lines = t.wheel.lines(e, m.cellHeight, t.term.rows);
    if (lines !== 0) sendWheelReport(t, cell, lines < 0, e.altKey);
  }

  // --- Touch ----------------------------------------------------------------

  function touchScroll(t: TerminalState, pixels: number) {
    const m = screenMetrics(t);
    if (!m) return;
    t.touchScrollPx += pixels;
    if (reportsWheel(t.mouse)) {
      const step = m.cellHeight * TOUCH_ROWS_PER_WHEEL_REPORT;
      const center: Cell = {
        col: Math.floor(t.term.cols / 2),
        row: Math.floor(t.term.rows / 2),
        x: m.rect.width / 2,
        y: m.rect.height / 2,
      };
      while (Math.abs(t.touchScrollPx) >= step) {
        const towardsNewer = t.touchScrollPx > 0;
        t.touchScrollPx -= towardsNewer ? step : -step;
        sendWheelReport(t, center, !towardsNewer);
      }
    } else {
      const lines = Math.trunc(t.touchScrollPx / m.cellHeight);
      if (lines !== 0) {
        t.touchScrollPx -= lines * m.cellHeight;
        t.term.scrollLines(lines);
      }
    }
  }

  function selectRange(t: TerminalState, start: number, end: number) {
    const cols = t.term.cols;
    t.term.select(start % cols, Math.floor(start / cols), end - start + 1);
  }

  function startTouchSelection(t: TerminalState, clientX: number, clientY: number): boolean {
    const cell = cellAt(t, clientX, clientY);
    if (!cell) return false;
    const buffer = t.term.buffer.active;
    const row = buffer.viewportY + cell.row;
    const text = buffer.getLine(row)?.translateToString(false) ?? '';
    let startCol = cell.col;
    let endCol = cell.col;
    if (WORD_CHAR.test(text[cell.col] ?? ' ')) {
      while (startCol > 0 && WORD_CHAR.test(text[startCol - 1] ?? ' ')) startCol--;
      while (endCol < t.term.cols - 1 && WORD_CHAR.test(text[endCol + 1] ?? ' ')) endCol++;
    }
    t.touchAnchor = { row, startCol, endCol };
    const cols = t.term.cols;
    selectRange(t, row * cols + startCol, row * cols + endCol);
    touchSelection.value = false;
    return true;
  }

  function extendTouchSelection(t: TerminalState, clientX: number, clientY: number) {
    const anchor = t.touchAnchor;
    const cell = cellAt(t, clientX, clientY);
    if (!anchor || !cell) return;
    const cols = t.term.cols;
    const pos = (t.term.buffer.active.viewportY + cell.row) * cols + cell.col;
    const anchorStart = anchor.row * cols + anchor.startCol;
    const anchorEnd = anchor.row * cols + anchor.endCol;
    if (pos < anchorStart) selectRange(t, pos, anchorEnd);
    else selectRange(t, anchorStart, Math.max(pos, anchorEnd));
  }

  // --- Lifecycle --------------------------------------------------------------

  function reveal(t: TerminalState) {
    if (t.revealed) return;
    t.revealed = true;
    t.containerEl.style.visibility = '';
  }

  function sendResize(t: TerminalState) {
    const dims = t.fitAddon.proposeDimensions();
    if (dims && dims.cols > 0 && dims.rows > 0 && t.ws?.readyState === WebSocket.OPEN) {
      t.ws.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
    }
  }

  function clearReconnectTimer() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function scheduleReconnect(t: TerminalState) {
    clearReconnectTimer();
    // Hidden pages reconnect from the visibilitychange handler instead.
    if (t.disposed || document.hidden) return;
    const delay = RECONNECT_DELAYS_MS[Math.min(reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)]!;
    reconnectAttempt++;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (activeTerminal.value === t && !t.disposed) connect(t);
    }, delay);
  }

  function detachSocket(t: TerminalState) {
    const ws = t.ws;
    if (!ws) return;
    t.ws = null;
    ws.onopen = null;
    ws.onmessage = null;
    ws.onclose = null;
    ws.onerror = null;
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close();
  }

  function connect(t: TerminalState) {
    detachSocket(t);
    clearReconnectTimer();
    // tmux re-announces its modes on attach; start from a clean slate.
    t.mouse = createMouseModeState();
    t.wheel.reset();
    status.value = 'connecting';

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${location.host}/ws/terminal/${t.containerId}/${t.windowIndex}`);
    ws.binaryType = 'arraybuffer';
    t.ws = ws;

    ws.onopen = () => {
      status.value = 'connected';
      reconnectAttempt = 0;
      sendResize(t);
      // Wait for tmux's initial redraw, then refit, scroll to the bottom and
      // reveal the terminal in its final state.
      setTimeout(() => {
        if (t.ws !== ws) return;
        try {
          t.fitAddon.fit();
        } catch {
          // Element not laid out (hidden tab) — the ResizeObserver refits later.
        }
        sendResize(t);
        t.term.scrollToBottom();
        reveal(t);
      }, 200);
    };

    // Batch incoming data per animation frame. TUI agents redraw the whole
    // screen on each update across several messages; writing them in one
    // term.write() avoids rendering half-drawn frames (visible flicker).
    ws.onmessage = (event) => {
      const data = event.data instanceof ArrayBuffer ? new Uint8Array(event.data) : event.data;
      t.writeBatch.push(data);
      if (t.writeRafId === null) {
        t.writeRafId = requestAnimationFrame(() => {
          for (const chunk of t.writeBatch) t.term.write(chunk);
          t.writeBatch.length = 0;
          t.writeRafId = null;
        });
      }
    };

    ws.onclose = () => {
      if (t.ws !== ws) return;
      t.ws = null;
      status.value = 'disconnected';
      reveal(t);
      scheduleReconnect(t);
    };
  }

  function reconnect() {
    const t = activeTerminal.value;
    if (!t || t.disposed) return;
    reconnectAttempt = 0;
    connect(t);
  }

  function onVisibilityChange() {
    const t = activeTerminal.value;
    if (!t || t.disposed) return;
    if (document.hidden) {
      hiddenAt = Date.now();
      return;
    }
    const hiddenFor = hiddenAt === null ? 0 : Date.now() - hiddenAt;
    hiddenAt = null;
    if (status.value === 'disconnected' || hiddenFor > STALE_AFTER_HIDDEN_MS) reconnect();
  }

  function onOnline() {
    if (status.value === 'disconnected') reconnect();
  }

  function openTerminal(containerId: string, windowIndex: number, containerEl: HTMLElement, classes: TerminalClasses) {
    const current = activeTerminal.value;
    if (current && current.containerId === containerId && current.windowIndex === windowIndex) {
      fitTerminal();
      return;
    }
    closeTerminal();

    const term = new classes.Terminal({
      theme: getTheme(),
      fontFamily: FONT_FAMILY,
      fontSize: prefs.fontSize.value,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 10000,
      fastScrollModifier: 'alt',
      altClickMovesCursor: false,
    });
    const fitAddon = new classes.FitAddon();
    term.loadAddon(fitAddon);
    // Clickable URLs (agent CLIs print login / OAuth links).
    term.loadAddon(new classes.WebLinksAddon());

    const t: TerminalState = {
      containerId,
      windowIndex,
      term,
      fitAddon,
      ws: null,
      containerEl,
      cleanups: [],
      writeBatch: [],
      writeRafId: null,
      mouse: createMouseModeState(),
      wheel: new WheelAccumulator(),
      touchScrollPx: 0,
      touchAnchor: null,
      revealed: false,
      disposed: false,
    };

    // Hide the terminal while the initial tmux screen redraw streams in;
    // otherwise xterm.js visibly renders it line by line.
    containerEl.style.visibility = 'hidden';
    const revealTimer = setTimeout(() => reveal(t), REVEAL_FALLBACK_MS);
    t.cleanups.push(() => clearTimeout(revealTimer));

    term.open(containerEl);
    try {
      fitAddon.fit();
    } catch {
      // Not laid out yet; the pane's ResizeObserver refits.
    }

    // Keep mouse reporting away from xterm.js (see utils/terminal-mouse.ts):
    // record what the application asked for and swallow the mode change.
    const disposables: IDisposable[] = [];
    const onPrivateModes = (enable: boolean) => (params: (number | number[])[]) => {
      const { mouse, other } = partitionModeParams(params);
      if (mouse.length === 0) return false;
      for (const mode of mouse) applyMouseMode(t.mouse, mode, enable);
      // A rare combined sequence (e.g. `?1000;1049h`): replay the other modes.
      if (other.length > 0) term.write(`\x1b[?${other.join(';')}${enable ? 'h' : 'l'}`);
      return true;
    };
    const resetMouse = () => {
      t.mouse = createMouseModeState();
      return false;
    };
    disposables.push(
      term.parser.registerCsiHandler({ prefix: '?', final: 'h' }, onPrivateModes(true)),
      term.parser.registerCsiHandler({ prefix: '?', final: 'l' }, onPrivateModes(false)),
      term.parser.registerEscHandler({ final: 'c' }, resetMouse), // RIS
      term.parser.registerCsiHandler({ intermediates: '!', final: 'p' }, resetMouse), // DECSTR
    );

    disposables.push(term.onSelectionChange(() => {
      hasSelection.value = term.hasSelection();
      if (!hasSelection.value) {
        touchSelection.value = false;
        t.touchAnchor = null;
      }
    }));

    disposables.push(term.onData((data) => {
      let out = data;
      // Latched toolbar modifiers apply to the next character typed on the
      // (soft) keyboard. Escape sequences (arrow keys, terminal replies) pass.
      if ((modifiers.ctrl || modifiers.alt) && !bypassModifiers && !data.startsWith('\x1b')) {
        out = applyModifiersToCharacter(data, modifiers) ?? data;
        clearModifiers();
      }
      sendRaw(out);
    }));
    t.cleanups.push(() => disposables.forEach((d) => d.dispose()));

    term.attachCustomKeyEventHandler((event) => {
      // Shift+Enter → CSI u so agents (Claude Code, Codex, …) can tell it from
      // Enter and insert a newline; tmux extended-keys passes it through.
      if (event.key === 'Enter' && event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
        if (event.type === 'keydown') sendRaw('\x1b[13;2u');
        return false;
      }
      if (event.type !== 'keydown' || isMac.value) {
        // macOS: Cmd+C / Cmd+V go through the browser's copy / paste events.
        return true;
      }
      const key = event.key.toLowerCase();
      const ctrlOnly = event.ctrlKey && !event.altKey && !event.metaKey;
      // Copy: Ctrl+Shift+C, Ctrl+Insert, or Ctrl+C while text is selected
      // (without a selection Ctrl+C stays the interrupt).
      const copyCombo = ctrlOnly && ((key === 'c' && (event.shiftKey || term.hasSelection())) || event.key === 'Insert');
      if (copyCombo) {
        event.preventDefault();
        if (term.hasSelection()) {
          void copyText(term.getSelection());
          term.clearSelection();
        }
        return false;
      }
      // Paste: Ctrl+Shift+V / Shift+Insert — let the browser fire its native
      // paste event, which xterm.js turns into a (bracketed) paste.
      const pasteCombo = (ctrlOnly && event.shiftKey && key === 'v')
        || (event.shiftKey && event.key === 'Insert' && !event.ctrlKey && !event.altKey && !event.metaKey);
      if (pasteCombo) return false;
      return true;
    });

    // Wheel: capture phase so it runs before xterm.js's own listener.
    const onWheel = (e: WheelEvent) => handleWheel(t, e);
    containerEl.addEventListener('wheel', onWheel, { capture: true, passive: false });
    t.cleanups.push(() => containerEl.removeEventListener('wheel', onWheel, { capture: true }));

    t.cleanups.push(attachTerminalTouch(containerEl, {
      scrollPixels: (px) => touchScroll(t, px),
      startSelection: (x, y) => startTouchSelection(t, x, y),
      extendSelection: (x, y) => extendTouchSelection(t, x, y),
      endSelection: () => {
        touchSelection.value = term.hasSelection();
      },
      getFontSize: () => term.options.fontSize ?? prefs.fontSize.value,
      previewFontSize: (size) => {
        term.options.fontSize = prefs.clampFontSize(size);
        fitTerminal();
      },
      commitFontSize: (size) => prefs.setFontSize(size),
    }));

    const textarea = term.textarea;
    if (textarea) {
      const onFocus = () => { isFocused.value = true; };
      const onBlur = () => { isFocused.value = false; };
      textarea.addEventListener('focus', onFocus);
      textarea.addEventListener('blur', onBlur);
      t.cleanups.push(() => {
        textarea.removeEventListener('focus', onFocus);
        textarea.removeEventListener('blur', onBlur);
      });
    }

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('online', onOnline);
    t.cleanups.push(() => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('online', onOnline);
    });

    activeTerminal.value = t;
    reconnectAttempt = 0;
    connect(t);
  }

  function fitTerminal(immediate = false) {
    if (fitTimer) clearTimeout(fitTimer);
    const doFit = () => {
      fitTimer = null;
      const t = activeTerminal.value;
      if (!t) return;
      try {
        t.fitAddon.fit();
        sendResize(t);
      } catch {
        // Element might not be visible yet
      }
    };
    if (immediate) doFit();
    else fitTimer = setTimeout(doFit, 30);
  }

  function closeTerminal() {
    const t = activeTerminal.value;
    if (!t) return;
    t.disposed = true;
    clearReconnectTimer();
    if (t.writeRafId !== null) cancelAnimationFrame(t.writeRafId);
    for (const cleanup of t.cleanups) cleanup();
    detachSocket(t);
    t.term.dispose();
    activeTerminal.value = null;
    hasSelection.value = false;
    touchSelection.value = false;
    isFocused.value = false;
    status.value = 'connecting';
  }

  function destroy() {
    closeTerminal();
    stopColorWatch();
    stopFontWatch();
    if (fitTimer) clearTimeout(fitTimer);
  }

  // --- Actions for the pane / toolbar ----------------------------------------

  function focus() {
    activeTerminal.value?.term.focus();
  }

  function blur() {
    activeTerminal.value?.term.blur();
  }

  function toggleModifier(name: 'ctrl' | 'alt') {
    modifiers[name] = !modifiers[name];
  }

  /** Sends a special key (arrows, Esc, Tab, …) with any latched modifiers. */
  function sendKey(key: SpecialKey) {
    const t = activeTerminal.value;
    if (!t) return;
    const seq = specialKeySequence(key, { ctrl: modifiers.ctrl, alt: modifiers.alt }, t.term.modes.applicationCursorKeysMode);
    clearModifiers();
    inputAsTyped(seq);
  }

  /** Sends literal text (toolbar symbols) with any latched modifiers. */
  function sendText(text: string) {
    const out = applyModifiersToCharacter(text, modifiers) ?? text;
    clearModifiers();
    inputAsTyped(out);
  }

  /** Pastes text like a clipboard paste (bracketed when the application enabled it). */
  function pasteText(text: string, submit = false) {
    const t = activeTerminal.value;
    if (!t || !text) return;
    t.term.paste(text);
    if (submit) setTimeout(() => inputAsTyped('\r'), PASTE_ENTER_DELAY_MS);
  }

  /** Pastes from the system clipboard; false when the clipboard is unavailable or denied. */
  async function pasteFromClipboard(): Promise<boolean> {
    const text = await readText();
    if (text === null) return false;
    pasteText(text);
    return true;
  }

  async function copySelection(): Promise<boolean> {
    const t = activeTerminal.value;
    if (!t || !t.term.hasSelection()) return false;
    const ok = await copyText(t.term.getSelection());
    if (ok) t.term.clearSelection();
    return ok;
  }

  function selectAll() {
    activeTerminal.value?.term.selectAll();
  }

  function clearSelection() {
    activeTerminal.value?.term.clearSelection();
  }

  /** The visible screen as plain text (fallback for the text view). */
  function getVisibleText(): string {
    const t = activeTerminal.value;
    if (!t) return '';
    const buffer = t.term.buffer.active;
    const lines: string[] = [];
    for (let i = 0; i < t.term.rows; i++) {
      lines.push(buffer.getLine(buffer.viewportY + i)?.translateToString(true) ?? '');
    }
    return lines.join('\n').replace(/\s+$/, '');
  }

  return {
    activeTerminal,
    status,
    hasSelection,
    touchSelection,
    isFocused,
    modifiers,
    openTerminal,
    closeTerminal,
    fitTerminal,
    destroy,
    reconnect,
    focus,
    blur,
    toggleModifier,
    sendKey,
    sendText,
    pasteText,
    pasteFromClipboard,
    copySelection,
    selectAll,
    clearSelection,
    getVisibleText,
  };
}
