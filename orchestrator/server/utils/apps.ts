export interface AppPort {
  id: string;
  name: string;
  internalPortStart: number;
  internalPortEnd: number;
}

export interface AppType {
  id: string;
  displayName: string;
  description: string;
  ports: AppPort[];
  maxInstances: number;
  manageScript: string;
}

export const APP_REGISTRY: Record<string, AppType> = {
  chromium: {
    id: 'chromium',
    displayName: 'Chromium',
    description: 'Chromium browser with remote debugging (CDP)',
    ports: [
      {
        id: 'cdp',
        name: 'Chromium DevTools',
        internalPortStart: 9222,
        internalPortEnd: 9322,
      },
    ],
    maxInstances: 10,
    manageScript: 'chromium/manage.sh',
  },
  socks5: {
    id: 'socks5',
    displayName: 'SOCKS5 Proxy',
    description: 'Lightweight SOCKS5 proxy via microsocks',
    ports: [
      {
        id: 'socks',
        name: 'SOCKS5',
        internalPortStart: 1080,
        internalPortEnd: 1180,
      },
    ],
    maxInstances: 10,
    manageScript: 'socks5/manage.sh',
  },
};

export function getAppType(id: string): AppType | undefined {
  return APP_REGISTRY[id];
}

export function listAppTypes(): AppType[] {
  return Object.values(APP_REGISTRY);
}
