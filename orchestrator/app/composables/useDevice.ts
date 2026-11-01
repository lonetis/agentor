// Device / display-mode facts shared across the UI (module-level singleton so
// every caller observes the same media queries).

const isTouch = ref(false);
const isStandalone = ref(false);
const isMac = ref(false);
let initialized = false;

function watchMedia(query: string, target: Ref<boolean>) {
  const mq = window.matchMedia(query);
  target.value = mq.matches;
  mq.addEventListener('change', (e) => {
    target.value = e.matches;
  });
}

function init() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  // A coarse primary pointer = finger input (phones, tablets without a trackpad).
  watchMedia('(pointer: coarse)', isTouch);
  // Installed PWA (iOS reports it through navigator.standalone instead).
  watchMedia('(display-mode: standalone)', isStandalone);
  if ((navigator as Navigator & { standalone?: boolean }).standalone) isStandalone.value = true;
  isMac.value = /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent);
}

export function useDevice() {
  init();
  return {
    isTouch: readonly(isTouch),
    isStandalone: readonly(isStandalone),
    isMac: readonly(isMac),
  };
}
