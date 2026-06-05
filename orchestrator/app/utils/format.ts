/** Human-readable byte size (e.g. 1536 → "1.5 KB"). */
export function formatBytes(n: number): string {
  if (!n || n < 0 || !Number.isFinite(n)) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let value = n;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  const decimals = i > 0 && value < 10 ? 1 : 0;
  return `${value.toFixed(decimals)} ${units[i]}`;
}

/** Human-readable throughput (e.g. "1.5 MB/s"). */
export function formatRate(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`;
}
