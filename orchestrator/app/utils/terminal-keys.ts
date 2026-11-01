// Escape sequences for the keys a soft keyboard lacks (touch toolbar), with
// xterm-style modifier encoding so Ctrl/Alt latches combine with them.

export interface KeyModifiers {
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
}

export type SpecialKey =
  | 'escape' | 'tab' | 'enter' | 'shift-enter' | 'backspace' | 'delete'
  | 'up' | 'down' | 'left' | 'right'
  | 'home' | 'end' | 'page-up' | 'page-down';

// xterm modifier parameter: 1 + shift(1) + alt(2) + ctrl(4).
function modifierParam(mods: KeyModifiers): number {
  return 1 + (mods.shift ? 1 : 0) + (mods.alt ? 2 : 0) + (mods.ctrl ? 4 : 0);
}

function hasModifiers(mods: KeyModifiers): boolean {
  return !!(mods.ctrl || mods.alt || mods.shift);
}

const CURSOR_FINALS: Partial<Record<SpecialKey, string>> = {
  up: 'A',
  down: 'B',
  right: 'C',
  left: 'D',
  home: 'H',
  end: 'F',
};

const TILDE_CODES: Partial<Record<SpecialKey, number>> = {
  'delete': 3,
  'page-up': 5,
  'page-down': 6,
};

/**
 * Sequence for a special key. `applicationCursor` is the terminal's DECCKM
 * state (`term.modes.applicationCursorKeysMode`), which switches unmodified
 * cursor keys from `CSI A` to `SS3 A`.
 */
export function specialKeySequence(key: SpecialKey, mods: KeyModifiers = {}, applicationCursor = false): string {
  const cursorFinal = CURSOR_FINALS[key];
  if (cursorFinal) {
    if (hasModifiers(mods)) return `\x1b[1;${modifierParam(mods)}${cursorFinal}`;
    return applicationCursor ? `\x1bO${cursorFinal}` : `\x1b[${cursorFinal}`;
  }
  const tildeCode = TILDE_CODES[key];
  if (tildeCode !== undefined) {
    return hasModifiers(mods) ? `\x1b[${tildeCode};${modifierParam(mods)}~` : `\x1b[${tildeCode}~`;
  }
  const prefix = mods.alt ? '\x1b' : '';
  switch (key) {
    case 'escape':
      return prefix + '\x1b';
    case 'tab':
      return mods.shift ? '\x1b[Z' : prefix + '\t';
    case 'enter':
      return prefix + '\r';
    case 'shift-enter':
      // CSI u Shift+Enter: agents (Claude Code, Codex) insert a newline; tmux
      // extended-keys passes it through to the application.
      return '\x1b[13;2u';
    case 'backspace':
      return prefix + (mods.ctrl ? '\x08' : '\x7f');
    default:
      return '';
  }
}

const CTRL_SYMBOLS: Record<string, string> = {
  '@': '\x00',
  ' ': '\x00',
  '2': '\x00',
  '[': '\x1b',
  '3': '\x1b',
  '\\': '\x1c',
  '4': '\x1c',
  ']': '\x1d',
  '5': '\x1d',
  '^': '\x1e',
  '6': '\x1e',
  '_': '\x1f',
  '-': '\x1f',
  '7': '\x1f',
  '/': '\x1f',
  '?': '\x7f',
  '8': '\x7f',
};

/** Control character for Ctrl+`char`, or null when the key has none. */
export function ctrlCharacter(char: string): string | null {
  if (char.length !== 1) return null;
  const lower = char.toLowerCase();
  if (lower >= 'a' && lower <= 'z') return String.fromCharCode(lower.charCodeAt(0) - 96);
  return CTRL_SYMBOLS[char] ?? null;
}

/**
 * Applies latched Ctrl/Alt modifiers to one typed character. Returns null when
 * `text` is not a single character (pastes, IME commits, escape sequences),
 * which are passed through unchanged.
 */
export function applyModifiersToCharacter(text: string, mods: KeyModifiers): string | null {
  if ([...text].length !== 1) return null;
  if (!mods.ctrl && !mods.alt) return null;
  let out = text;
  if (mods.ctrl) {
    const ctrl = ctrlCharacter(text);
    if (ctrl === null) return null;
    out = ctrl;
  }
  return mods.alt ? `\x1b${out}` : out;
}
