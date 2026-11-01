/**
 * Assign `next` to `target` only when its JSON value differs, so an unchanged
 * poll result does not re-render everything that depends on the ref. Meant for
 * the small JSON payloads the dashboard polls.
 */
export function assignIfChanged<T>(target: Ref<T>, next: T): void {
  if (JSON.stringify(target.value) === JSON.stringify(next)) return;
  target.value = next;
}
