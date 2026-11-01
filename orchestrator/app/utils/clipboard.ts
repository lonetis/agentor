// Clipboard access with a fallback for insecure contexts (plain http on a LAN
// address), where `navigator.clipboard` does not exist.

/** Copies `text`; resolves to false when the browser refused. */
export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permission denied or document not focused — try the legacy path.
    }
  }
  return copyTextLegacy(text);
}

function copyTextLegacy(text: string): boolean {
  const previousFocus = document.activeElement as HTMLElement | null;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  // Off-screen but still selectable; 16px avoids an iOS zoom on selection.
  textarea.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0;font-size:16px;';
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  textarea.remove();
  previousFocus?.focus?.({ preventScroll: true });
  return ok;
}

/** True when the async clipboard read API can be used (it may still prompt or be denied). */
export function canReadClipboard(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.clipboard?.readText && window.isSecureContext;
}

/** Reads text from the clipboard, or null when it is unavailable / denied. */
export async function readText(): Promise<string | null> {
  if (!canReadClipboard()) return null;
  try {
    return await navigator.clipboard.readText();
  } catch {
    return null;
  }
}
