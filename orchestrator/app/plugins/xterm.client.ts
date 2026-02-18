import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

export default defineNuxtPlugin(() => {
  return {
    provide: {
      Terminal,
      FitAddon,
    },
  };
});
