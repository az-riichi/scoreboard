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

function roundsToZero(n: number, digits: number) {
  return Number(Math.abs(n).toFixed(digits)) === 0;
}

// Signed score text: "+12.3", "−4.5" (true minus sign), or unsigned when it rounds to zero.
export function fmtSigned(x: unknown, digits = 2, fixed = false) {
  const n = Number(x);
  const format = (value: number) => (fixed ? fmtFixed(value, digits) : fmtNum(value, digits));
  if (!Number.isFinite(n)) return format(0);
  const abs = format(Math.abs(n));
  if (roundsToZero(n, digits)) return abs;
  return `${n > 0 ? '+' : '−'}${abs}`;
}

export function signTone(x: unknown, digits = 2): 'pos' | 'neg' | '' {
  const n = Number(x);
  if (!Number.isFinite(n) || roundsToZero(n, digits)) return '';
  return n > 0 ? 'pos' : 'neg';
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
