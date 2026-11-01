// Tracks the *visual* viewport in CSS variables so the dashboard shell can fit
// exactly into the area above an on-screen keyboard:
//   --app-height      visible height (shrinks while the soft keyboard is open)
//   --app-offset-top  how far the browser scrolled the visual viewport down
//
// iOS Safari never resizes the layout viewport for the keyboard (100vh/100dvh
// stay full height) and scrolls the page instead, hiding the terminal behind
// the keyboard. Android Chrome resizes it with `interactive-widget=
// resizes-content`, where these values simply match the layout viewport.
export default defineNuxtPlugin(() => {
  const vv = window.visualViewport;
  if (!vv) return;
  const root = document.documentElement;
  let raf = 0;

  const update = () => {
    raf = 0;
    // While pinch-zoomed the visual viewport is a magnified slice of the page;
    // resizing the layout to it would fight the zoom. Fall back to 100dvh.
    if (Math.abs(vv.scale - 1) > 0.01) {
      root.style.removeProperty('--app-height');
      root.style.removeProperty('--app-offset-top');
      return;
    }
    root.style.setProperty('--app-height', `${Math.round(vv.height)}px`);
    root.style.setProperty('--app-offset-top', `${Math.max(0, Math.round(vv.offsetTop))}px`);
  };
  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(update);
  };

  vv.addEventListener('resize', schedule);
  vv.addEventListener('scroll', schedule);
  update();
});
