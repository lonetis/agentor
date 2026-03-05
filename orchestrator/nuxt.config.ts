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
      { baseName: 'built-in/skills', dir: './server/built-in/skills' },
      { baseName: 'built-in/agents-md', dir: './server/built-in/agents-md' },
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
