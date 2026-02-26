const ARIZONA_TZ = 'America/Phoenix';
const ARIZONA_UTC_OFFSET_MINUTES = -7 * 60;
const MS_PER_MINUTE = 60_000;

const azDateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  timeZone: ARIZONA_TZ,
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit'
});

const azDateFormatter = new Intl.DateTimeFormat(undefined, {
  timeZone: ARIZONA_TZ,
  year: 'numeric',
  month: 'short',
  day: 'numeric'
});

const azDateTimePartsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: ARIZONA_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23'
});

const LOCAL_DATETIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

function asValidDate(value: string | Date | null | undefined): Date | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

function partsValue(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPart['type']) {
  return parts.find((p) => p.type === type)?.value ?? '';
}

function parseArizonaLocalDatetime(value: string) {
  const m = value.match(LOCAL_DATETIME_RE);
  if (!m) return null;

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = m[6] == null ? 0 : Number(m[6]);

  const check = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() + 1 !== month ||
    check.getUTCDate() !== day ||
    check.getUTCHours() !== hour ||
    check.getUTCMinutes() !== minute ||
    check.getUTCSeconds() !== second
  ) {
    return null;
  }

  return { year, month, day, hour, minute, second };
}

function nextIsoDate(year: number, month: number, day: number) {
  const next = new Date(Date.UTC(year, month - 1, day));
  next.setUTCDate(next.getUTCDate() + 1);
  return `${next.getUTCFullYear()}-${pad2(next.getUTCMonth() + 1)}-${pad2(next.getUTCDate())}`;
}

export function fmtDateTimeArizona(ts: string | Date | null | undefined) {
  try {
    const d = asValidDate(ts);
    if (!d) return ts == null ? '' : String(ts);
    return azDateTimeFormatter.format(d);
  } catch {
    return ts == null ? '' : String(ts);
  }
}

export function fmtDateArizona(ts: string | Date | null | undefined) {
  try {
    const d = asValidDate(ts);
    if (!d) return ts == null ? '' : String(ts);
    return azDateFormatter.format(d);
  } catch {
    return ts == null ? '' : String(ts);
  }
}

export function toArizonaDatetimeLocalValue(ts: string | Date | null | undefined) {
  const d = asValidDate(ts);
  if (!d) return '';
  const parts = azDateTimePartsFormatter.formatToParts(d);
  const year = partsValue(parts, 'year');
  const month = partsValue(parts, 'month');
  const day = partsValue(parts, 'day');
  const hour = partsValue(parts, 'hour');
  const minute = partsValue(parts, 'minute');
  if (!year || !month || !day || !hour || !minute) return '';
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

export function nowArizonaDatetimeLocalValue() {
  return toArizonaDatetimeLocalValue(new Date());
}

export function parseArizonaLocalDatetimeToUtcIso(value: string) {
  const parsed = parseArizonaLocalDatetime(value);
  if (!parsed) return null;

  const localAsUtcMs = Date.UTC(
    parsed.year,
    parsed.month - 1,
    parsed.day,
    parsed.hour,
    parsed.minute,
    parsed.second
  );
  const utcMs = localAsUtcMs - ARIZONA_UTC_OFFSET_MINUTES * MS_PER_MINUTE;
  return new Date(utcMs).toISOString();
}

export function parseArizonaDayBoundsFromDatetimeLocal(value: string) {
  const parsed = parseArizonaLocalDatetime(value);
  if (!parsed) return null;

  const dayIso = `${parsed.year}-${pad2(parsed.month)}-${pad2(parsed.day)}`;
  const nextDayIso = nextIsoDate(parsed.year, parsed.month, parsed.day);
  const dayStart = parseArizonaLocalDatetimeToUtcIso(`${dayIso}T00:00`);
  const dayEnd = parseArizonaLocalDatetimeToUtcIso(`${nextDayIso}T00:00`);

  if (!dayStart || !dayEnd) return null;
  return { dayStart, dayEnd };
}
