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
    },
    preset: 'node-server',
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
