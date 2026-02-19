export function fmtDateTime(ts: string) {
  try {
    const d = new Date(ts);
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return ts;
  }
}

export function fmtPct(x: number | null | undefined) {
  if (x == null || Number.isNaN(x)) return '0%';
  return `${Math.round(x * 100)}%`;
}

export function fmtNum(x: number | null | undefined, digits = 2) {
  if (x == null || Number.isNaN(x)) return '0';
  const n = Number(x);
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}
