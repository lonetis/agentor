export default defineNuxtConfig({
  modules: ['@nuxt/ui'],

  ssr: false,

  colorMode: {
    preference: 'dark',
  },

  future: {
    compatibilityVersion: 4,
  },

  experimental: {
    // Reload the page IMMEDIATELY when a dynamic chunk fails to load,
    // not on the next route change. The default `'automatic'` waits for
    // the next navigation, which manifests as: first visit to `/` fails
    // to fetch `/_nuxt/pages/index.vue`, the global auth middleware
    // then redirects to `/login` (the next navigation), and only then
    // does the chunk-reload plugin trigger — by that point the user has
    // already seen the broken state. `'automatic-immediate'` recovers
    // transparently on first failure.
    emitRouteChunkError: 'automatic-immediate',
  },

  css: ['@/assets/css/main.css'],

  nitro: {
    experimental: {
      websocket: true,
      openAPI: true,
    },
    openAPI: {
      meta: {
        title: 'Agentor API',
        description: 'Docker orchestrator for AI coding agent workers',
        version: '1.0.0',
      },
      production: 'runtime',
      route: '/api/docs/openapi.json',
      ui: {
        scalar: {
          route: '/api/docs',
          theme: 'deepSpace',
        },
        swagger: false,
      },
    },
    preset: 'node-server',
    serverAssets: [
      { baseName: 'builtin-capabilities', dir: './built-in/capabilities' },
      { baseName: 'builtin-instructions', dir: './built-in/instructions' },
      { baseName: 'builtin-init-scripts', dir: './built-in/init-scripts' },
      { baseName: 'builtin-environments', dir: './built-in/environments' },
    ],
  },

  vite: {
    resolve: {
      alias: {
        '#app-manifest': 'mocked-exports/empty',
      },
    },
  },

  compatibilityDate: '2025-01-01',
});
