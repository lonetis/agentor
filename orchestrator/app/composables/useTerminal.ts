import type { Terminal, ITheme } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import type { WebLinksAddon } from '@xterm/addon-web-links';
import { wrappedQueryLinkProvider } from '~/utils/terminalLinks';

const TERMINAL_FONT_FAMILY = 'Menlo, "Cascadia Code", "Fira Code", "JetBrains Mono", monospace';
const TERMINAL_FONT_SIZE = 14;

interface TerminalState {
  containerId: string;
  windowIndex: number;
  term: Terminal;
  fitAddon: FitAddon;
  ws: WebSocket;
  containerEl: HTMLElement;
  writeBatch: (Uint8Array | string)[];
  writeRafId: number | null;
}

const DARK_THEME: ITheme = {
  background: '#0d1117',
  foreground: '#c9d1d9',
  cursor: '#58a6ff',
  selectionBackground: '#264f78',
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
  black: '#24292f',
  red: '#cf222e',
  green: '#116329',
  yellow: '#4d2d00',
  blue: '#0969da',
  magenta: '#8250df',
  cyan: '#1b7c83',
  white: '#6e7781',
};

export function useTerminal() {
  const colorMode = useColorMode();
  const toast = useToast();
  const activeTerminal = shallowRef<TerminalState | null>(null);

  function getTheme(): ITheme {
    return colorMode.value === 'dark' ? DARK_THEME : LIGHT_THEME;
  }

  // Update terminal theme when color mode changes
  const stopColorWatch = watch(() => colorMode.value, () => {
    const t = activeTerminal.value;
    if (t) {
      t.term.options.theme = getTheme();
    }
  });
  let fitTimer: ReturnType<typeof setTimeout> | null = null;
  let restoreFocus = false;
  let openGeneration = 0;

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      toast.add({ title: 'Could not copy text', description: 'Allow clipboard access for this site and try again.', color: 'error' });
    }
  }

  async function openTerminal(
    containerId: string,
    windowIndex: number,
    containerEl: HTMLElement,
    TerminalClass: typeof Terminal,
    FitAddonClass: typeof FitAddon,
    WebLinksAddonClass: typeof WebLinksAddon,
  ) {
    const current = activeTerminal.value;

    // Already connected to same container+window
    if (current && current.containerId === containerId && current.windowIndex === windowIndex) {
      fitTerminal();
      return;
    }

    closeTerminal();
    const shouldRestoreFocus = restoreFocus;
    const generation = openGeneration;
    // The DOM renderer caches glyph widths on first use. Loading fonts later
    // leaves cached spaces and newly measured text at different widths.
    try {
      await Promise.allSettled([
        containerEl.ownerDocument.fonts.load(`${TERMINAL_FONT_SIZE}px ${TERMINAL_FONT_FAMILY}`, 'W Привет'),
        containerEl.ownerDocument.fonts.load(`bold ${TERMINAL_FONT_SIZE}px ${TERMINAL_FONT_FAMILY}`, 'W Привет'),
      ]);
    } catch {
      // A failed web font falls back to the browser's available monospace font.
    }
    // A tab may close or reconnect while its fonts are loading.
    if (generation !== openGeneration || !containerEl.isConnected) return;
    restoreFocus = false;

    const activateLink = (event: MouseEvent, uri: string) => {
      // Selection modifiers must keep selecting text, including URLs.
      if (event.button !== 0 || event.shiftKey || event.altKey || term.hasSelection()) return;
      if (['http:', 'https:'].includes(new URL(uri).protocol)) {
        window.open(uri, '_blank', 'noopener,noreferrer');
      }
    };
    const term = new TerminalClass({
      theme: getTheme(),
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: TERMINAL_FONT_SIZE,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 10000,
      fastScrollModifier: 'alt',
      macOptionClickForcesSelection: true,
      altClickMovesCursor: false,
      linkHandler: { activate: activateLink },
    });

    const fitAddon = new FitAddonClass();
    term.loadAddon(fitAddon);
    term.registerLinkProvider(wrappedQueryLinkProvider(term, activateLink));
    term.loadAddon(new WebLinksAddonClass(activateLink));
    // Applications copy over OSC 52; reads of the browser clipboard are not
    // part of this protocol bridge. tmux may use an empty selection parameter.
    term.parser.registerOscHandler(52, (data) => {
      const separator = data.indexOf(';');
      const encoded = data.slice(separator + 1);
      if (separator < 0 || encoded === '?') return true;
      try {
        const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
        copyText(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      } catch {
        // Ignore malformed clipboard payloads.
      }
      return true;
    });
    // Hide terminal while the initial tmux screen redraw streams in.
    // Without this, xterm.js progressively renders lines top-to-bottom,
    // causing a visible scroll effect. We reveal after the data settles.
    containerEl.style.visibility = 'hidden';

    term.open(containerEl);
    fitAddon.fit();

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${location.host}/ws/terminal/${containerId}/${windowIndex}`;
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      // Send proper dimensions immediately — terminal is already fitted
      const dims = fitAddon.proposeDimensions();
      if (dims && dims.cols > 0 && dims.rows > 0) {
        ws.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
      }
      // Wait for the initial tmux screen redraw to finish, then refit,
      // scroll to bottom, and reveal the terminal in its final state.
      setTimeout(() => {
        if (activeTerminal.value?.term !== term) return;
        fitAddon.fit();
        const dims2 = fitAddon.proposeDimensions();
        if (dims2 && dims2.cols > 0 && dims2.rows > 0 && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'resize', cols: dims2.cols, rows: dims2.rows }));
        }
        term.scrollToBottom();
        containerEl.style.visibility = '';
        // Reconnecting a focused terminal removes its textarea from the DOM.
        // Restore keyboard input unless the user has focused another control.
        if (shouldRestoreFocus && containerEl.ownerDocument.activeElement === containerEl.ownerDocument.body) {
          term.focus();
        }
      }, 200);
    };

    // Batch incoming WebSocket data per animation frame. Claude Code and other
    // TUI agents redraw the full screen on each update (cursor home → rewrite
    // everything). These redraws arrive as multiple WebSocket messages spread
    // across frames. Without batching, xterm.js renders partial states — causing
    // a visible scroll-from-top flicker on each update. By accumulating all
    // data within one frame and writing it in a single term.write() call, the
    // parser processes the complete redraw atomically.
    const writeBatch: (Uint8Array | string)[] = [];
    let writeRafId: number | null = null;

    ws.onmessage = (event) => {
      const data =
        event.data instanceof ArrayBuffer ? new Uint8Array(event.data) : event.data;
      writeBatch.push(data);
      if (writeRafId === null) {
        writeRafId = requestAnimationFrame(() => {
          for (const chunk of writeBatch) {
            term.write(chunk);
          }
          writeBatch.length = 0;
          writeRafId = null;
        });
      }
    };

    ws.onclose = () => {
      term.write('\r\n\x1b[31m[Connection closed]\x1b[0m\r\n');
    };

    term.attachCustomKeyEventHandler((event) => {
      // Let xterm.js clear its keyboard state when the key is released.
      if (event.type === 'keyup' || event.isComposing) return true;
      // Copy a local selection before handling terminal Ctrl+C (SIGINT).
      // Match physical keys so copy also works with non-Latin layouts.
      if (event.code === 'KeyC' && !event.altKey &&
        ((event.ctrlKey && !event.metaKey) || (event.metaKey && !event.ctrlKey)) && term.hasSelection()) {
        event.preventDefault();
        event.stopPropagation();
        if (event.type === 'keydown') copyText(term.getSelection());
        return false;
      }
      let data: string;
      if (event.key === 'Enter' && event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
        // CSI u lets agents distinguish Shift+Enter from Enter.
        data = '\x1b[13;2u';
      } else if ((event.key === 'Escape' || event.code === 'Escape') &&
        !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
        // tmux requires an explicit modifier (1 = none) to decode CSI u.
        data = '\x1b[27;1u';
      } else if (event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey && /^Key[A-Z]$/.test(event.code)) {
        // Physical keys keep terminal Ctrl shortcuts working in RU and other
        // layouts. CSI u also bypasses Docker's Ctrl+P, Ctrl+Q detach handling;
        // tmux decodes it into the application's expected key format.
        data = `\x1b[${event.code.charCodeAt(3) + 32};5u`;
      } else {
        return true;
      }
      event.preventDefault();
      event.stopPropagation();
      if (event.type === 'keydown' && ws.readyState === WebSocket.OPEN) {
        term.input(data);
      }
      return false;
    });

    // Forward mouse reports as well as keyboard input so TUIs can handle
    // clicks. xterm.js retains local selection with Shift (Option on macOS).
    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    activeTerminal.value = { containerId, windowIndex, term, fitAddon, ws, containerEl, writeBatch, writeRafId };
  }

  function fitTerminal(immediate = false) {
    if (fitTimer) clearTimeout(fitTimer);
    const doFit = () => {
      const t = activeTerminal.value;
      if (!t) return;
      try {
        t.fitAddon.fit();
        const dims = t.fitAddon.proposeDimensions();
        if (dims && dims.cols > 0 && dims.rows > 0 && t.ws && t.ws.readyState === WebSocket.OPEN) {
          t.ws.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }));
        }
      } catch {
        // Element might not be visible yet
      }
    };
    if (immediate) {
      doFit();
    } else {
      fitTimer = setTimeout(doFit, 30);
    }
  }

  function closeTerminal() {
    openGeneration++;
    const t = activeTerminal.value;
    if (!t) return;
    restoreFocus = t.term.textarea === t.containerEl.ownerDocument.activeElement;
    if (t.writeRafId !== null) cancelAnimationFrame(t.writeRafId);
    t.ws?.close();
    t.term?.dispose();
    activeTerminal.value = null;
  }

  function destroy() {
    closeTerminal();
    restoreFocus = false;
    stopColorWatch();
    if (fitTimer) clearTimeout(fitTimer);
  }

  return {
    activeTerminal,
    openTerminal,
    closeTerminal,
    fitTerminal,
    destroy,
  };
}
