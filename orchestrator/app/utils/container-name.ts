const CONTAINER_PREFIX = 'agentor-worker-';

export function shortName(name: string): string {
  return name.startsWith(CONTAINER_PREFIX) ? name.slice(CONTAINER_PREFIX.length) : name;
}
