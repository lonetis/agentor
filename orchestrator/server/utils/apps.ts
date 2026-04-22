export interface AppPort {
  id: string;
  name: string;
  internalPortStart: number;
  internalPortEnd: number;
}

export interface AppAutoPortMapping {
  type: 'external' | 'localhost';
  externalPortStart: number;
  externalPortEnd: number;
}

export interface AppType {
  id: string;
  displayName: string;
  description: string;
  ports: AppPort[];
  maxInstances: number;
  manageScript: string;
  /** Only one instance can run at a time and its id is fixed to `id`. */
  singleton?: boolean;
  /** When set, instances always run on this container port and the port-range scan is skipped. */
  fixedInternalPort?: number;
  /** When set, starting an instance also creates a port mapping picked from this range (or reuses an existing one keyed by `(containerName, appType, instanceId)`). */
  autoPortMapping?: AppAutoPortMapping;
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
  vscode: {
    id: 'vscode',
    displayName: 'VS Code Tunnel',
    description: 'VS Code tunnel via Microsoft relay — connect from a native VS Code client',
    ports: [],
    maxInstances: 1,
    manageScript: 'vscode-tunnel/manage.sh',
    singleton: true,
  },
  ssh: {
    id: 'ssh',
    displayName: 'SSH Server',
    description: 'OpenSSH server with public-key auth — uses your public key from Account → SSH Access',
    ports: [
      {
        id: 'ssh',
        name: 'SSH',
        internalPortStart: 22,
        internalPortEnd: 22,
      },
    ],
    maxInstances: 1,
    manageScript: 'ssh/manage.sh',
    singleton: true,
    fixedInternalPort: 22,
    autoPortMapping: {
      type: 'external',
      externalPortStart: 22000,
      externalPortEnd: 22999,
    },
  },
};

export function getAppType(id: string): AppType | undefined {
  return APP_REGISTRY[id];
}

export function listAppTypes(): AppType[] {
  return Object.values(APP_REGISTRY);
}
