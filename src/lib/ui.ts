const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit'
});

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric'
});

const numberFormatters = new Map<number, Intl.NumberFormat>();
const fixedNumberFormatters = new Map<number, Intl.NumberFormat>();

export function fmtDateTime(ts: string) {
  try {
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? d.toString() : dateTimeFormatter.format(d);
  } catch {
    return ts;
  }
}

export function fmtDate(ts: string) {
  try {
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? d.toString() : dateFormatter.format(d);
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
  let formatter = numberFormatters.get(digits);
  if (!formatter) {
    formatter = new Intl.NumberFormat(undefined, { maximumFractionDigits: digits });
    numberFormatters.set(digits, formatter);
  }
  return formatter.format(n);
}

export function fmtFixed(x: unknown, digits = 2) {
  const n = Number(x);
  if (!Number.isFinite(n)) return digits > 0 ? `0.${'0'.repeat(digits)}` : '0';
  let formatter = fixedNumberFormatters.get(digits);
  if (!formatter) {
    formatter = new Intl.NumberFormat(undefined, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
    fixedNumberFormatters.set(digits, formatter);
  }
  return formatter.format(n);
}
