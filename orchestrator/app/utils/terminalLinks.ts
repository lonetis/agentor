import type { IBufferCell, IBufferLine, ILinkProvider, Terminal } from '@xterm/xterm';

const URL_PART = /^( *)([A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+) *$/;

function sameBackground(a: IBufferCell, b: IBufferCell) {
  return a.getBgColorMode() === b.getBgColorMode() && a.getBgColor() === b.getBgColor();
}

function sameForeground(a: IBufferCell, b: IBufferCell) {
  return a.getFgColorMode() === b.getFgColorMode() && a.getFgColor() === b.getFgColor();
}

function panelPart(line: IBufferLine, left: number, right: number) {
  const match = line.translateToString(false, left, right).match(URL_PART);
  return match ? { column: left + match[1]!.length, text: match[2]! } : undefined;
}

function underlineParts(term: Terminal, event: MouseEvent, column: number, start: number, parts: string[]) {
  const screen = term.element?.querySelector<HTMLElement>('.xterm-screen');
  if (!screen) return () => {};
  const rect = screen.getBoundingClientRect();
  const cellWidth = rect.width / term.cols;
  const cellHeight = rect.height / term.rows;
  const target = event.target instanceof Element ? event.target : screen;
  const color = getComputedStyle(target).color;
  const group = screen.ownerDocument.createElement('div');
  group.style.pointerEvents = 'none';
  for (const [index, part] of parts.entries()) {
    const row = start + index - term.buffer.active.viewportY;
    if (row < 0 || row >= term.rows) continue;
    const underline = screen.ownerDocument.createElement('div');
    underline.className = 'terminal-link-underline';
    Object.assign(underline.style, {
      position: 'absolute',
      left: `${column * cellWidth}px`,
      top: `${(row + 1) * cellHeight - 2}px`,
      width: `${part.length * cellWidth}px`,
      borderBottom: `1px solid ${color}`,
    });
    group.appendChild(underline);
  }
  screen.appendChild(group);
  return () => group.remove();
}

// TUI dialogs wrap inside a panel, without terminal soft wrapping. Read only
// that panel's background run so the session behind it cannot enter the URL.
export function wrappedQueryLinkProvider(
  term: Terminal,
  activate: (event: MouseEvent, uri: string) => void,
): ILinkProvider {
  return {
    provideLinks(y, callback) {
      const buffer = term.buffer.active;
      for (let start = Math.max(0, y - 8); start < y; start++) {
        const line = buffer.getLine(start);
        if (!line) continue;
        const columns = Math.min(term.cols, line.length);
        for (let left = 0, right = 0; left < columns; left = right) {
          const background = line.getCell(left)!;
          right = left + 1;
          while (right < columns && sameBackground(background, line.getCell(right)!)) right++;
          // A uniform shell row provides no panel boundary to justify joining
          // adjacent lines. Leave its links to the standard web-links addon.
          if (left === 0 && right === columns) continue;
          const first = panelPart(line, left, right);
          if (!first || !/^https?:\/\//.test(first.text)) continue;
          const foreground = line.getCell(first.column)!;
          const parts = [first.text];
          for (let row = start + 1; row < Math.min(buffer.length, start + 8); row++) {
            const next = buffer.getLine(row)!;
            // The continuation must be in the same rectangular panel.
            if (right > next.length ||
              (left > 0 && sameBackground(background, next.getCell(left - 1)!)) ||
              (right < Math.min(term.cols, next.length) && sameBackground(background, next.getCell(right)!))) break;
            let samePanel = true;
            for (let x = left; x < right; x++) {
              if (!sameBackground(background, next.getCell(x)!)) { samePanel = false; break; }
            }
            if (!samePanel) break;
            const part = panelPart(next, left, right);
            if (!part || part.column !== first.column || /^https?:\/\//.test(part.text) ||
              !sameForeground(foreground, next.getCell(part.column)!)) break;
            // A continuation cannot fit in the preceding row's unused width.
            // This also excludes short independent lines in a coloured panel.
            const width = right - first.column - (first.column - left);
            if (parts.at(-1)!.length + part.text.length <= width) break;
            parts.push(part.text);
          }
          if (parts.length < 2 || y > start + parts.length) continue;
          const uri = parts.join('');
          if (!uri.includes('?') || !uri.includes('=')) continue;
          try { new URL(uri); } catch { continue; }
          const part = parts[y - start - 1]!;
          let clearUnderline = () => {};
          callback([{
            text: uri,
            range: { start: { x: first.column + 1, y }, end: { x: first.column + part.length, y } },
            activate,
            // Keep each row's hit area separate; a multiline xterm range
            // would also make the padding between rows clickable.
            decorations: { underline: false, pointerCursor: true },
            hover: (event) => {
              clearUnderline();
              clearUnderline = underlineParts(term, event, first.column, start, parts);
            },
            leave: () => clearUnderline(),
            dispose: () => clearUnderline(),
          }]);
          return;
        }
      }
      callback(undefined);
    },
  };
}
