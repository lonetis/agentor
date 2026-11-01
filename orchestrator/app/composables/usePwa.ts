// Install prompt + launch handling for the installable dashboard (PWA).
//
// Module-level state: browsers fire `beforeinstallprompt` once, early in the
// page's life, so `initPwa()` (called from plugins/pwa.client.ts) captures it
// before any component mounts.

/** Chromium's install prompt event (not in lib.dom). */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Launch Handler API (Chromium, not in lib.dom). */
interface LaunchParams {
  readonly targetURL?: string;
}
interface LaunchQueue {
  setConsumer(consumer: (params: LaunchParams) => void): void;
}

const IOS_HINT_DISMISSED_KEY = 'agentor-ios-install-hint-dismissed';

const deferredPrompt = shallowRef<BeforeInstallPromptEvent | null>(null);
const iosHintDismissed = ref(false);
let isIos = false;
let initialized = false;

function readIosHintDismissed(): boolean {
  try {
    return localStorage.getItem(IOS_HINT_DISMISSED_KEY) === '1';
  } catch (err) {
    console.warn('[pwa] could not read the install hint state', err);
    return false;
  }
}

function detectIos(): boolean {
  // iPadOS reports itself as a Mac; touch points give it away.
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function handleLaunches() {
  const launchQueue = (window as Window & { launchQueue?: LaunchQueue }).launchQueue;
  if (!launchQueue) return;
  // The URL this document was loaded with: the first launch params describe
  // that very load and need no navigation.
  const loadedHref = location.href;
  let firstLaunch = true;
  // The manifest's `launch_handler: focus-existing` routes app launches into
  // the open window instead of a new one. A plain launch just focuses it; a
  // deep link (e.g. an MCP OAuth authorization opened from another app)
  // navigates it.
  launchQueue.setConsumer((params) => {
    const isOwnLoad = firstLaunch && params.targetURL === loadedHref;
    firstLaunch = false;
    if (!params.targetURL || isOwnLoad) return;
    const target = new URL(params.targetURL);
    if (target.pathname === '/' && !target.search) return;
    if (target.href !== location.href) location.assign(target.href);
  });
}

/** Idempotent; call as early as possible so the install prompt is not missed. */
export function initPwa() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  isIos = detectIos();
  iosHintDismissed.value = readIosHintDismissed();

  window.addEventListener('beforeinstallprompt', (event) => {
    // Suppress the browser's mini-infobar; the sidebar offers an Install button.
    event.preventDefault();
    deferredPrompt.value = event as BeforeInstallPromptEvent;
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt.value = null;
  });
  handleLaunches();
}

export function usePwa() {
  initPwa();
  const { isStandalone } = useDevice();

  const canInstall = computed(() => !!deferredPrompt.value && !isStandalone.value);
  // iOS has no install prompt: installing goes through Share → Add to Home Screen.
  const showIosHint = computed(() => isIos && !isStandalone.value && !iosHintDismissed.value);

  async function install() {
    const event = deferredPrompt.value;
    if (!event) return;
    // A prompt event can only be used once.
    deferredPrompt.value = null;
    try {
      await event.prompt();
      await event.userChoice;
    } catch (err) {
      console.warn('[pwa] install prompt failed', err);
    }
  }

  function dismissIosHint() {
    iosHintDismissed.value = true;
    try {
      localStorage.setItem(IOS_HINT_DISMISSED_KEY, '1');
    } catch (err) {
      console.warn('[pwa] could not persist the install hint state', err);
    }
  }

  return {
    canInstall,
    showIosHint,
    install,
    dismissIosHint,
  };
}
