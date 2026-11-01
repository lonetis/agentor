import { TERMINAL_FONT_SIZE_MAX, TERMINAL_FONT_SIZE_MIN } from './useUiState';

const DESKTOP_FONT_SIZE = 14;
// Phones: a slightly smaller default keeps ~50 columns in portrait.
const PHONE_FONT_SIZE = 12;
const PHONE_MAX_WIDTH = 640;

/** Terminal preferences shared by every terminal (persisted in the UI state). */
export function useTerminalPrefs() {
  const { state, setTerminalFontSize, setTerminalToolbar } = useUiState();
  const { isTouch } = useDevice();

  const defaultFontSize = computed(() =>
    isTouch.value && typeof window !== 'undefined' && window.innerWidth < PHONE_MAX_WIDTH
      ? PHONE_FONT_SIZE
      : DESKTOP_FONT_SIZE,
  );

  const fontSize = computed(() => state.value.terminal.fontSize ?? defaultFontSize.value);

  const toolbarVisible = computed(() => {
    const mode = state.value.terminal.toolbar;
    return mode === 'show' || (mode === 'auto' && isTouch.value);
  });

  function clampFontSize(size: number) {
    return Math.min(TERMINAL_FONT_SIZE_MAX, Math.max(TERMINAL_FONT_SIZE_MIN, Math.round(size)));
  }

  function setFontSize(size: number) {
    setTerminalFontSize(clampFontSize(size));
  }

  function adjustFontSize(delta: number) {
    setFontSize(fontSize.value + delta);
  }

  function resetFontSize() {
    setTerminalFontSize(null);
  }

  function toggleToolbar() {
    setTerminalToolbar(toolbarVisible.value ? 'hide' : 'show');
  }

  return {
    fontSize,
    toolbarVisible,
    clampFontSize,
    setFontSize,
    adjustFontSize,
    resetFontSize,
    toggleToolbar,
  };
}
