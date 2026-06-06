/** Extract a human-readable message from a `$fetch`/h3 error.
 *
 * Nitro errors surface the server-side `statusMessage` under `err.data`; native
 * errors carry `.message`. This collapses the several hand-rolled variants that
 * were scattered across composables into one consistent shape. */
export function fetchErrorMessage(err: unknown, fallback: string): string {
  const e = err as { data?: { statusMessage?: string; message?: string }; statusMessage?: string; message?: string } | null;
  return (
    e?.data?.statusMessage ||
    e?.data?.message ||
    e?.statusMessage ||
    e?.message ||
    fallback
  );
}
