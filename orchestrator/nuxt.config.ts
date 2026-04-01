export default defineNuxtConfig({
  modules: ['@nuxt/ui'],

  ssr: false,

  colorMode: {
    preference: 'dark',
  },

  future: {
    compatibilityVersion: 4,
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
