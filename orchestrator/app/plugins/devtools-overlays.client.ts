export default defineNuxtPlugin(() => {
  if (!import.meta.dev) return;

  // DevTools live outside the app in shadow DOM. Reka UI sees their host as
  // an outside interaction and would dismiss the modal before inspection starts.
  const keepOverlayOpen = (event: Event) => {
    if (event.target instanceof Element && event.target.closest('nuxt-devtools-frame, nuxt-devtools-inspect-panel')) {
      event.preventDefault();
    }
  };

  const events = ['dismissableLayer.pointerDownOutside', 'dismissableLayer.focusOutside'];
  for (const event of events) document.addEventListener(event, keepOverlayOpen, true);

  // Modal layers set pointer-events: none on the body. The toolbar overrides
  // that itself, but the inspector's component panel needs the same override.
  const style = document.createElement('style');
  style.textContent = 'nuxt-devtools-inspect-panel { pointer-events: auto; }';
  document.head.appendChild(style);

  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      for (const event of events) document.removeEventListener(event, keepOverlayOpen, true);
      style.remove();
    });
  }
});
