import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';

export default defineNuxtPlugin(() => {
  return {
    provide: {
      Terminal,
      FitAddon,
      WebLinksAddon,
    },
  };
});
