export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return '0';
  }
  return Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

export function formatLitres(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return '0 L';
  }
  return `${formatNumber(value)} L`;
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function getWaterStatus(demand: number, supply: number): {
  label: string;
  tone: 'good' | 'medium' | 'critical' | 'neutral';
} {
  if (demand <= 0) return { label: 'No Demand Data', tone: 'neutral' };
  const pct = (supply / demand) * 100;
  if (pct >= 90) return { label: 'Sufficient', tone: 'good' };
  if (pct >= 60) return { label: 'Moderate', tone: 'medium' };
  return { label: 'Shortage', tone: 'critical' };
}

export function statusTextClass(tone: 'good' | 'medium' | 'critical' | 'neutral'): string {
  switch (tone) {
    case 'good':
      return 'text-emerald-700';
    case 'medium':
      return 'text-amber-700';
    case 'critical':
      return 'text-red-700';
    default:
      return 'text-slate-500';
  }
}
