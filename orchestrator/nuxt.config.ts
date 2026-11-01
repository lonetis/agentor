export default defineNuxtConfig({
  modules: ['@nuxt/ui'],

  ssr: false,

  app: {
    head: {
      htmlAttrs: { lang: 'en' },
      // `viewport-fit=cover` lets the `.app-shell` pad itself with the safe-area
      // insets; `interactive-widget=resizes-content` makes Android shrink the
      // layout viewport for the soft keyboard (plugins/viewport.client.ts covers
      // iOS). Never disable zooming here — it is an accessibility requirement.
      viewport: 'width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content',
      // theme-color is set reactively in app.vue so it follows the colour mode.
      meta: [
        { name: 'application-name', content: 'Agentor' },
        { name: 'mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-title', content: 'Agentor' },
        { name: 'apple-mobile-web-app-status-bar-style', content: 'default' },
        { name: 'format-detection', content: 'telephone=no' },
      ],
      // Favicon set + web manifest, served from `public/` at the site root.
      link: [
        { rel: 'icon', href: '/favicon.ico', sizes: '16x16 24x24 32x32 48x48 64x64 128x128 256x256' },
        { rel: 'icon', type: 'image/png', sizes: '48x48', href: '/favicon-48x48.png' },
        { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/favicon-32x32.png' },
        { rel: 'icon', type: 'image/png', sizes: '16x16', href: '/favicon-16x16.png' },
        { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png' },
        // With credentials so the manifest still loads (and the app stays
        // installable) behind the dashboard's Traefik basic auth.
        { rel: 'manifest', href: '/site.webmanifest', crossorigin: 'use-credentials' },
      ],
    },
  },

  // The service worker, its offline page and the manifest must never be served
  // stale: browsers check sw.js for updates on every navigation.
  routeRules: {
    '/sw.js': { headers: { 'cache-control': 'no-cache' } },
    '/offline.html': { headers: { 'cache-control': 'no-cache' } },
    '/site.webmanifest': { headers: { 'cache-control': 'no-cache' } },
  },

  // Icons are served by the orchestrator itself (no runtime calls to
  // api.iconify.design): lucide is bundled on the server, and the icons of
  // always-visible chrome and Nuxt UI internals ship in the client bundle so
  // they render without a request. `clientBundle.scan` stays off — its regex
  // also matches Tailwind classes such as `ps-4` as icon collections, and a
  // collection that is not installed fails the production build.
  icon: {
    provider: 'server',
    // Outside /api/: the auth middleware would 401 it on the login page.
    localApiEndpoint: '/_nuxt_icon',
    serverBundle: {
      collections: ['lucide'],
    },
    clientBundle: {
      icons: [
        // Nuxt UI internals
        'lucide:x',
        'lucide:check',
        'lucide:chevron-down',
        'lucide:chevron-up',
        'lucide:chevron-left',
        'lucide:chevron-right',
        'lucide:chevrons-left',
        'lucide:chevrons-right',
        'lucide:loader-circle',
        'lucide:minus',
        'lucide:plus',
        'lucide:search',
        'lucide:ellipsis',
        'lucide:arrow-left',
        'lucide:arrow-right',
        'lucide:arrow-up-right',
        'lucide:upload',
        'lucide:file',
        'lucide:folder',
        'lucide:folder-open',
        // Always-visible chrome (sidebar, worker cards, pane tabs, theme toggle)
        'lucide:menu',
        'lucide:import',
        'lucide:log-out',
        'lucide:user',
        'lucide:server',
        'lucide:circle-pause',
        'lucide:archive',
        'lucide:plug',
        'lucide:globe',
        'lucide:activity',
        'lucide:settings',
        'lucide:terminal',
        'lucide:code',
        'lucide:monitor',
        'lucide:layout-grid',
        'lucide:download',
        'lucide:package',
        'lucide:pencil',
        'lucide:refresh-cw',
        'lucide:square',
        'lucide:hammer',
        'lucide:trash-2',
        'lucide:sun',
        'lucide:moon',
        'lucide:scroll-text',
      ],
    },
  },

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
      { baseName: 'mcp', dir: './mcp' },
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
