// Lives in app/ — with `compatibilityVersion: 4` the source root is app/, so a
// root-level app.config.ts is silently ignored.
export default defineAppConfig({
  ui: {
    colors: {
      // blue matches the hand-written accents; gray is the palette every
      // hand-written gray-* class uses.
      primary: 'blue',
      neutral: 'gray',
    },
    toaster: {
      slots: {
        // Keep toasts clear of the home indicator / rounded corners in the installed PWA.
        viewport: 'mb-[env(safe-area-inset-bottom)] me-[env(safe-area-inset-right)]',
      },
    },
  },
});
