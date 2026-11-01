// Mouse-protocol bookkeeping for the dashboard terminal.
//
// xterm.js clears its selection on every "user input" event, and when an
// application (tmux with `mouse on`, or a TUI asking for any-motion tracking
// through it) enables mouse reporting, every mouse move is reported as user
// input — so a selection vanished as soon as the pointer moved. xterm.js also
// disables local selection and touch scrolling while mouse reporting is on.
//
// The terminal therefore never lets xterm.js enable mouse reporting. It records
// the modes the application asked for here and reports only the wheel itself
// (scrollback in tmux copy-mode). Clicks and drags stay local text selection,
// as they always have.

export type MouseProtocol = 'none' | 'x10' | 'vt200' | 'drag' | 'any';
export type MouseEncoding = 'default' | 'utf8' | 'sgr' | 'sgr-pixels' | 'urxvt';

export interface MouseModeState {
  protocol: MouseProtocol;
  encoding: MouseEncoding;
}

const PROTOCOL_MODES: Record<number, MouseProtocol> = {
  9: 'x10',
  1000: 'vt200',
  1002: 'drag',
  1003: 'any',
};

const ENCODING_MODES: Record<number, MouseEncoding> = {
  1005: 'utf8',
  1006: 'sgr',
  1015: 'urxvt',
  1016: 'sgr-pixels',
};

// 1001 (highlight tracking) is never supported by xterm.js; swallowing it keeps
// the behaviour identical while not passing it on.
const IGNORED_MOUSE_MODES = new Set([1001]);

export function createMouseModeState(): MouseModeState {
  return { protocol: 'none', encoding: 'default' };
}

export function isMouseMode(mode: number): boolean {
  return mode in PROTOCOL_MODES || mode in ENCODING_MODES || IGNORED_MOUSE_MODES.has(mode);
}

/** Apply one DECSET (`enable`) / DECRST mouse mode to `state` (xterm semantics). */
export function applyMouseMode(state: MouseModeState, mode: number, enable: boolean): void {
  const protocol = PROTOCOL_MODES[mode];
  if (protocol) {
    // Resetting any protocol mode turns reporting off entirely, as in xterm.
    state.protocol = enable ? protocol : 'none';
    return;
  }
  const encoding = ENCODING_MODES[mode];
  if (encoding) {
    if (enable) state.encoding = encoding;
    else if (state.encoding === encoding) state.encoding = 'default';
  }
}

/** Splits DECSET/DECRST params into the mouse modes and the rest. */
export function partitionModeParams(params: (number | number[])[]): { mouse: number[]; other: number[] } {
  const mouse: number[] = [];
  const other: number[] = [];
  for (const raw of params) {
    const mode = Array.isArray(raw) ? raw[0] : raw;
    if (mode === undefined) continue;
    (isMouseMode(mode) ? mouse : other).push(mode);
  }
  return { mouse, other };
}

/** True when the application wants wheel events reported instead of scrolling locally. */
export function reportsWheel(state: MouseModeState): boolean {
  // X10 only reports button presses, never the wheel.
  return state.protocol === 'vt200' || state.protocol === 'drag' || state.protocol === 'any';
}

export interface WheelReportTarget {
  /** 1-based cell column / row under the pointer. */
  col: number;
  row: number;
  /** Pixel position inside the terminal screen (for SGR-pixels). */
  x: number;
  y: number;
  up: boolean;
  shift?: boolean;
  alt?: boolean;
  ctrl?: boolean;
}

const WHEEL_UP = 64;
const WHEEL_DOWN = 65;

/** Encode a single wheel event in the encoding the application asked for. */
export function encodeWheelReport(encoding: MouseEncoding, t: WheelReportTarget): string {
  let button = t.up ? WHEEL_UP : WHEEL_DOWN;
  if (t.shift) button += 4;
  if (t.alt) button += 8;
  if (t.ctrl) button += 16;

  switch (encoding) {
    case 'sgr':
      return `\x1b[<${button};${t.col};${t.row}M`;
    case 'sgr-pixels':
      return `\x1b[<${button};${Math.max(1, Math.round(t.x))};${Math.max(1, Math.round(t.y))}M`;
    case 'urxvt':
      return `\x1b[${button + 32};${t.col};${t.row}M`;
    case 'utf8':
      return `\x1b[M${String.fromCodePoint(button + 32, Math.min(t.col, 2015) + 32, Math.min(t.row, 2015) + 32)}`;
    default:
      // Classic X10/normal encoding cannot express coordinates past 223.
      return `\x1b[M${String.fromCharCode(button + 32, Math.min(t.col, 223) + 32, Math.min(t.row, 223) + 32)}`;
  }
}

/**
 * Turns wheel deltas into whole scroll "lines" the way xterm.js does, keeping
 * the fractional remainder so trackpads (many tiny pixel deltas) still scroll.
 */
export class WheelAccumulator {
  private partial = 0;

  /** Returns the signed number of lines to scroll for this event (0 = nothing yet). */
  lines(event: Pick<WheelEvent, 'deltaY' | 'deltaMode'>, rowHeight: number, rows: number): number {
    if (event.deltaY === 0) return 0;
    if (event.deltaMode === 1 /* DOM_DELTA_LINE */) return Math.trunc(event.deltaY) || Math.sign(event.deltaY);
    if (event.deltaMode === 2 /* DOM_DELTA_PAGE */) return Math.round(event.deltaY * rows) || Math.sign(event.deltaY);
    this.partial += event.deltaY / Math.max(1, rowHeight);
    const whole = Math.trunc(this.partial);
    this.partial -= whole;
    return whole;
  }

  reset(): void {
    this.partial = 0;
  }
}
