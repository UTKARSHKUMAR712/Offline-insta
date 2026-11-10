/** Human-readable byte size, e.g. 2_716_359 → "2.6 MB". */
export function formatBytes(bytes: number | undefined | null): string {
  if (!bytes || bytes <= 0) return '0 MB';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const decimals = unit >= 2 ? 1 : 0;
  return `${value.toFixed(decimals)} ${units[unit]}`;
}

/** Short local date, e.g. "10 Nov 2026". */
export function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** Sum of the known file sizes in a list. */
export function totalBytes(items: { sizeBytes?: number }[]): number {
  return items.reduce((sum, item) => sum + (item.sizeBytes ?? 0), 0);
}
