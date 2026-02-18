import { listAppTypes } from '../utils/apps';

export default defineEventHandler(() => {
  return listAppTypes().map((t) => ({
    id: t.id,
    displayName: t.displayName,
    description: t.description,
    ports: t.ports.map((p) => ({ id: p.id, name: p.name })),
    maxInstances: t.maxInstances,
  }));
});
