import type { Terminal, ITheme } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';

interface TerminalState {
  containerId: string;
  windowIndex: number;
  term: Terminal;
  fitAddon: FitAddon;
  ws: WebSocket;
  containerEl: HTMLElement;
  eventCleanup: () => void;
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

  function openTerminal(
    containerId: string,
    windowIndex: number,
    containerEl: HTMLElement,
    TerminalClass: typeof Terminal,
    FitAddonClass: typeof FitAddon,
  ) {
    const current = activeTerminal.value;

    // Already connected to same container+window
    if (current && current.containerId === containerId && current.windowIndex === windowIndex) {
      fitTerminal();
      return;
    }

    closeTerminal();

    const term = new TerminalClass({
      theme: getTheme(),
      fontFamily: '"Cascadia Code", "Fira Code", "JetBrains Mono", Menlo, monospace',
      fontSize: 14,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 10000,
      fastScrollModifier: 'alt',
      macOptionClickForcesSelection: true,
      altClickMovesCursor: false,
    });

    const fitAddon = new FitAddonClass();
    term.loadAddon(fitAddon);
    term.open(containerEl);

    // Fit immediately so the terminal has correct dimensions before data arrives.
    // This prevents the "scroll from top" effect where data rendered at a wrong
    // size causes visible reflow when the proper fit happens later.
    fitAddon.fit();

    // Force xterm.js to use native text selection for click/drag.
    // xterm.js's shouldForceSelection() checks altKey+macOptionClickForcesSelection
    // on Mac, or shiftKey on other platforms. We override the relevant modifier
    // key on pointer/mouse events so xterm.js handles selection locally instead
    // of forwarding to tmux. Wheel events are unaffected.
    const isMac = /mac/i.test(navigator.platform);
    const forceSelectionKey = isMac ? 'altKey' : 'shiftKey';
    const overrideKey = (e: Event) => {
      Object.defineProperty(e, forceSelectionKey, { value: true });
    };
    const eventTypes = ['pointerdown', 'pointermove', 'pointerup', 'mousedown', 'mousemove', 'mouseup'] as const;
    for (const type of eventTypes) {
      containerEl.addEventListener(type, overrideKey, { capture: true });
    }
    const eventCleanup = () => {
      for (const type of eventTypes) {
        containerEl.removeEventListener(type, overrideKey, { capture: true });
      }
    };

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
      // Second fit after layout fully settles, then scroll to bottom
      // to suppress the visual scroll-from-top caused by the initial data burst
      setTimeout(() => {
        fitAddon.fit();
        const dims2 = fitAddon.proposeDimensions();
        if (dims2 && dims2.cols > 0 && dims2.rows > 0 && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'resize', cols: dims2.cols, rows: dims2.rows }));
        }
        term.scrollToBottom();
      }, 200);
    };

    ws.onmessage = (event) => {
      const data =
        event.data instanceof ArrayBuffer ? new Uint8Array(event.data) : event.data;
      term.write(data);
    };

    ws.onclose = () => {
      term.write('\r\n\x1b[31m[Connection closed]\x1b[0m\r\n');
    };

    // Shift+Enter → send CSI u encoded Shift+Enter so agents (Claude Code,
    // Codex, etc.) can distinguish it from plain Enter and insert a newline.
    // tmux extended-keys (csi-u format) passes this through to the application.
    term.attachCustomKeyEventHandler((event) => {
      if (event.key === 'Enter' && event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
        if (event.type === 'keydown' && ws.readyState === WebSocket.OPEN) {
          ws.send('\x1b[13;2u');
        }
        return false;
      }
      return true;
    });

    // SGR mouse escape: \x1b[<button;col;row[Mm]
    // Button >= 64 = scroll (wheel up/down) — forward to tmux for scrollback.
    // Button < 64 = click/drag/motion — block so tmux doesn't move cursor.
    const SGR_MOUSE_RE = /^\x1b\[<(\d+);\d+;\d+[Mm]$/;

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        const m = data.match(SGR_MOUSE_RE);
        if (m && parseInt(m[1]!, 10) < 64) return;
        ws.send(data);
      }
    });

    activeTerminal.value = { containerId, windowIndex, term, fitAddon, ws, containerEl, eventCleanup };
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
    const t = activeTerminal.value;
    if (!t) return;
    t.eventCleanup();
    t.ws?.close();
    t.term?.dispose();
    activeTerminal.value = null;
  }

  function destroy() {
    closeTerminal();
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
