/**
 * Generic CRUD wrapper over a REST collection endpoint of shape:
 *   GET    /api/<resource>      → T[]
 *   POST   /api/<resource>      → T
 *   PUT    /api/<resource>/:id  → T
 *   DELETE /api/<resource>/:id  → void
 *
 * After any mutation, the list is refreshed so the reactive `data` ref
 * stays in sync with the server.
 */
export function useCrudResource<T>(endpoint: string) {
  const { data, refresh } = useFetch<T[]>(endpoint, { default: () => [] });

  async function create(body: Partial<T>): Promise<T> {
    const result = await $fetch<T>(endpoint, { method: 'POST', body });
    await refresh();
    return result;
  }

  async function update(id: string, body: Partial<T>): Promise<T> {
    const result = await $fetch<T>(`${endpoint}/${id}`, { method: 'PUT', body });
    await refresh();
    return result;
  }

  async function remove(id: string): Promise<void> {
    await $fetch(`${endpoint}/${id}`, { method: 'DELETE' });
    await refresh();
  }

  return { data, refresh, create, update, remove };
}
