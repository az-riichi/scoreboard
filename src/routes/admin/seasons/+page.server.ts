import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireAdmin } from '$lib/server/admin';
import * as XLSX from 'xlsx';
import { composePlayerDisplayName } from '$lib/player-name';

const REQUIRED_HEADERS = [
  'Date',
  'Game',
  'Tbl',
  'E Player',
  'S Player',
  'W Player',
  'N Player',
  'E Pts',
  'S Pts',
  'W Pts',
  'N Pts',
  'Ex'
] as const;

const SEATS = ['E', 'S', 'W', 'N'] as const;
type Seat = (typeof SEATS)[number];

type ParsedImportRow = {
  rowNumber: number;
  dateIso: string;
  playedAt: string;
  gameNumber: number;
  tableMode: 'A' | 'M';
  extraSticks: number;
  playerNames: Record<Seat, string>;
  rawPoints: Record<Seat, number>;
};

type ResolvedImportRow = ParsedImportRow & {
  playerIds: Record<Seat, string>;
};

type PlayerRow = {
  id: string;
  display_name: string | null;
  real_first_name: string | null;
  real_last_name: string | null;
  show_display_name: boolean;
  show_real_first_name: boolean;
  show_real_last_name: boolean;
};

function asText(value: unknown): string {
  if (value == null) return '';
  return String(value).trim();
}

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toIsoDate(y: number, m: number, d: number, rowNumber: number): string {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) {
    throw new Error(`Row ${rowNumber}: invalid Date value.`);
  }

  const dt = new Date(Date.UTC(y, m - 1, d));
  const ok =
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() + 1 === m &&
    dt.getUTCDate() === d;

  if (!ok) throw new Error(`Row ${rowNumber}: invalid Date value.`);
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function parseDateCell(value: unknown, rowNumber: number): string {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return toIsoDate(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate(), rowNumber);
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) throw new Error(`Row ${rowNumber}: Date is invalid.`);
    return toIsoDate(parsed.y, parsed.m, parsed.d, rowNumber);
  }

  const text = asText(value);
  if (!text) throw new Error(`Row ${rowNumber}: Date is required.`);

  const mdY = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (mdY) {
    const month = Number(mdY[1]);
    const day = Number(mdY[2]);
    const year = Number(mdY[3]);
    return toIsoDate(year, month, day, rowNumber);
  }

  const yMd = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (yMd) {
    const year = Number(yMd[1]);
    const month = Number(yMd[2]);
    const day = Number(yMd[3]);
    return toIsoDate(year, month, day, rowNumber);
  }

  throw new Error(`Row ${rowNumber}: Date must be M/D/YYYY (example: 2/4/2026).`);
}

function parseIntCell(value: unknown, label: string, rowNumber: number): number {
  const source = typeof value === 'string' ? value.replace(/,/g, '').trim() : value;
  if (source === '' || source == null) throw new Error(`Row ${rowNumber}: ${label} is required.`);

  const n = typeof source === 'number' ? source : Number(source);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new Error(`Row ${rowNumber}: ${label} must be an integer.`);
  }
  return n;
}

function parseOptionalIntCell(value: unknown, fallback: number, label: string, rowNumber: number): number {
  const text = asText(value);
  if (!text) return fallback;
  return parseIntCell(text, label, rowNumber);
}

function parseTableMode(value: unknown, rowNumber: number): 'A' | 'M' {
  const mode = asText(value).toUpperCase();
  if (mode === 'A' || mode === 'M') return mode;
  throw new Error(`Row ${rowNumber}: Tbl must be A or M.`);
}

function buildPlayedAt(dateIso: string, gameNumber: number, tableMode: 'A' | 'M'): string {
  const base = new Date(`${dateIso}T12:00:00.000Z`);
  const offsetSeconds = (gameNumber - 1) * 2 + (tableMode === 'M' ? 1 : 0);
  base.setUTCSeconds(base.getUTCSeconds() + offsetSeconds);
  return base.toISOString();
}

function importKey(row: Pick<ParsedImportRow, 'dateIso' | 'gameNumber' | 'tableMode'>): string {
  return `${row.dateIso}|${row.gameNumber}|${row.tableMode}`;
}

export const load: PageServerLoad = async ({ locals }) => {
  await requireAdmin(locals);

  const seasonsRes = await locals.supabase
    .from('seasons')
    .select('id, name, start_date, end_date, is_active')
    .order('start_date', { ascending: false });

  const rulesRes = await locals.supabase
    .from('rulesets')
    .select('id, name')
    .order('name', { ascending: true });

  const activeSeason = seasonsRes.data?.find((s) => s.is_active)?.id ?? seasonsRes.data?.[0]?.id ?? null;
  const defaultRules = rulesRes.data?.[0]?.id ?? null;

  return {
    seasons: seasonsRes.error ? [] : (seasonsRes.data ?? []),
    rulesets: rulesRes.error ? [] : (rulesRes.data ?? []),
    activeSeason,
    defaultRules
  };
};

export const actions: Actions = {
  create: async ({ request, locals }) => {
    await requireAdmin(locals);
    const f = await request.formData();
    const name = String(f.get('name') ?? '').trim();
    const start_date = String(f.get('start_date') ?? '').trim();
    const end_date = String(f.get('end_date') ?? '').trim();
    const is_active = String(f.get('is_active') ?? '') === 'on';

    if (!name || !start_date || !end_date) return fail(400, { message: 'Missing fields.' });

    if (is_active) {
      await locals.supabase.from('seasons').update({ is_active: false }).neq('id', '00000000-0000-0000-0000-000000000000');
    }

    const { error } = await locals.supabase.from('seasons').insert({ name, start_date, end_date, is_active });
    if (error) return fail(400, { message: error.message });

    return { message: 'Season created.' };
  },

  importExcel: async ({ request, locals }) => {
    await requireAdmin(locals);
    const f = await request.formData();

    const season_id = asText(f.get('season_id'));
    const ruleset_id = asText(f.get('ruleset_id'));
    const upload = f.get('file');

    if (!season_id || !ruleset_id) return fail(400, { message: 'Pick a season and ruleset.' });
    if (!(upload instanceof File) || upload.size <= 0) {
      return fail(400, { message: 'Attach an Excel file first.' });
    }

    let rows: unknown[][];
    try {
      const bytes = await upload.arrayBuffer();
      const wb = XLSX.read(bytes, { type: 'array', cellDates: true });
      const firstSheetName = wb.SheetNames[0];
      if (!firstSheetName) return fail(400, { message: 'Workbook has no sheets.' });
      const sheet = wb.Sheets[firstSheetName];
      rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '' });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Could not read workbook.';
      return fail(400, { message: `Invalid workbook: ${message}` });
    }

    if (!rows.length) return fail(400, { message: 'Workbook is empty.' });

    const header = (rows[0] ?? []).map((x) => asText(x));
    const missing = REQUIRED_HEADERS.filter((h) => !header.includes(h));
    if (missing.length) {
      return fail(400, {
        message: `Missing required headers: ${missing.join(', ')}.`
      });
    }

    const colIndex = new Map<string, number>();
    header.forEach((h, i) => {
      if (!colIndex.has(h)) colIndex.set(h, i);
    });

    const col = (name: (typeof REQUIRED_HEADERS)[number]) => {
      const idx = colIndex.get(name);
      if (idx == null) throw new Error(`Missing required header: ${name}`);
      return idx;
    };

    const parsedRows: ParsedImportRow[] = [];
    const seenKeys = new Set<string>();

    try {
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i] ?? [];
        const rowNumber = i + 1;

        const isBlank = row.every((cell) => !asText(cell));
        if (isBlank) continue;

        const dateIso = parseDateCell(row[col('Date')], rowNumber);
        const gameNumber = parseIntCell(row[col('Game')], 'Game', rowNumber);
        if (gameNumber <= 0) throw new Error(`Row ${rowNumber}: Game must be greater than 0.`);

        const tableMode = parseTableMode(row[col('Tbl')], rowNumber);
        const extraSticks = parseOptionalIntCell(row[col('Ex')], 0, 'Ex', rowNumber);
        if (extraSticks < 0) throw new Error(`Row ${rowNumber}: Ex must be 0 or higher.`);

        const playerNames: Record<Seat, string> = {
          E: asText(row[col('E Player')]),
          S: asText(row[col('S Player')]),
          W: asText(row[col('W Player')]),
          N: asText(row[col('N Player')])
        };

        const rawPoints: Record<Seat, number> = {
          E: parseIntCell(row[col('E Pts')], 'E Pts', rowNumber),
          S: parseIntCell(row[col('S Pts')], 'S Pts', rowNumber),
          W: parseIntCell(row[col('W Pts')], 'W Pts', rowNumber),
          N: parseIntCell(row[col('N Pts')], 'N Pts', rowNumber)
        };

        const parsed: ParsedImportRow = {
          rowNumber,
          dateIso,
          playedAt: buildPlayedAt(dateIso, gameNumber, tableMode),
          gameNumber,
          tableMode,
          extraSticks,
          playerNames,
          rawPoints
        };

        const key = importKey(parsed);
        if (seenKeys.has(key)) {
          throw new Error(`Row ${rowNumber}: duplicate Date/Game/Tbl combination in this file.`);
        }
        seenKeys.add(key);

        parsedRows.push(parsed);
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Invalid row data.';
      return fail(400, { message });
    }

    if (!parsedRows.length) return fail(400, { message: 'No data rows found below the header.' });

    const playersRes = await locals.supabase
      .from('players')
      .select('id, display_name, real_first_name, real_last_name, show_display_name, show_real_first_name, show_real_last_name')
      .order('created_at', { ascending: true });
    if (playersRes.error) return fail(400, { message: playersRes.error.message });

    const players = (playersRes.data ?? []) as PlayerRow[];

    const displayNameToPlayer = new Map<string, PlayerRow>();
    const firstNameToPlayers = new Map<string, PlayerRow[]>();
    let createdPlayers = 0;
    const indexPlayer = (p: PlayerRow) => {
      const display = normalizeName(p.display_name ?? '');
      if (display && !displayNameToPlayer.has(display)) displayNameToPlayer.set(display, p);

      const first = normalizeName(p.real_first_name ?? '');
      if (first) {
        const list = firstNameToPlayers.get(first) ?? [];
        list.push(p);
        firstNameToPlayers.set(first, list);
      }
    };
    for (const p of players) indexPlayer(p);

    const resolveOrCreatePlayerId = async (rawName: string, rowNumber: number, seat: Seat): Promise<string> => {
      const firstName = asText(rawName);
      const normalized = normalizeName(firstName);
      if (!normalized) throw new Error(`Row ${rowNumber}: ${seat} Player is required.`);

      const candidatesMap = new Map<string, PlayerRow>();
      const displayMatch = displayNameToPlayer.get(normalized);
      if (displayMatch) candidatesMap.set(displayMatch.id, displayMatch);
      for (const p of firstNameToPlayers.get(normalized) ?? []) {
        candidatesMap.set(p.id, p);
      }

      const candidates = [...candidatesMap.values()];
      if (candidates.length === 1) return candidates[0].id;
      if (candidates.length > 1) {
        const names = candidates.map((p) => composePlayerDisplayName(p)).join(', ');
        throw new Error(`Row ${rowNumber}: ${seat} Player "${firstName}" is ambiguous. Matches: ${names}.`);
      }

      const createRes = await locals.supabase
        .from('players')
        .insert({
          display_name: null,
          real_first_name: firstName,
          real_last_name: null,
          show_display_name: false,
          show_real_first_name: true,
          show_real_last_name: false
        })
        .select('id, display_name, real_first_name, real_last_name, show_display_name, show_real_first_name, show_real_last_name')
        .single();

      if (createRes.error || !createRes.data) {
        throw new Error(`Row ${rowNumber}: could not auto-create player "${firstName}" (${createRes.error?.message ?? 'unknown error'}).`);
      }

      const created = createRes.data as PlayerRow;
      indexPlayer(created);
      createdPlayers += 1;
      return created.id;
    };

    const existingRes = await locals.supabase
      .from('matches')
      .select('played_at, game_number, table_mode')
      .eq('season_id', season_id)
      .not('game_number', 'is', null)
      .not('table_mode', 'is', null);
    if (existingRes.error) return fail(400, { message: existingRes.error.message });

    const existingKeys = new Set<string>();
    for (const m of existingRes.data ?? []) {
      const playedAt = asText(m.played_at);
      const game_number = Number(m.game_number);
      const table_mode = asText(m.table_mode).toUpperCase();
      if (!playedAt || !Number.isInteger(game_number)) continue;
      if (table_mode !== 'A' && table_mode !== 'M') continue;

      const dateIso = new Date(playedAt).toISOString().slice(0, 10);
      existingKeys.add(`${dateIso}|${game_number}|${table_mode}`);
    }

    const resolvedRows: ResolvedImportRow[] = [];
    try {
      for (const row of parsedRows) {
        const key = importKey(row);
        if (existingKeys.has(key)) {
          return fail(400, {
            message: `Row ${row.rowNumber}: Date/Game/Tbl already exists in this season (date ${row.dateIso}, game ${row.gameNumber}, tbl ${row.tableMode}).`
          });
        }

        const playerIds: Record<Seat, string> = {
          E: await resolveOrCreatePlayerId(row.playerNames.E, row.rowNumber, 'E'),
          S: await resolveOrCreatePlayerId(row.playerNames.S, row.rowNumber, 'S'),
          W: await resolveOrCreatePlayerId(row.playerNames.W, row.rowNumber, 'W'),
          N: await resolveOrCreatePlayerId(row.playerNames.N, row.rowNumber, 'N')
        };

        if (new Set(Object.values(playerIds)).size !== 4) {
          return fail(400, { message: `Row ${row.rowNumber}: players must be 4 distinct people.` });
        }

        resolvedRows.push({ ...row, playerIds });
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Could not map players.';
      return fail(400, { message });
    }

    let imported = 0;
    for (const row of resolvedRows) {
      const tableLabel = `${row.tableMode}${row.gameNumber}`;
      const matchInsert = await locals.supabase
        .from('matches')
        .insert({
          season_id,
          ruleset_id,
          game_number: row.gameNumber,
          table_mode: row.tableMode,
          extra_sticks: row.extraSticks,
          played_at: row.playedAt,
          table_label: tableLabel,
          created_by: locals.userId
        })
        .select('id')
        .single();

      if (matchInsert.error || !matchInsert.data) {
        const details = matchInsert.error?.message ?? 'Could not create match.';
        return fail(400, { message: `Import failed at row ${row.rowNumber} after ${imported} imported: ${details}` });
      }

      const match_id = matchInsert.data.id;
      const resultsInsert = await locals.supabase.from('match_results').insert(
        SEATS.map((seat) => ({
          match_id,
          seat,
          player_id: row.playerIds[seat],
          raw_points: row.rawPoints[seat]
        }))
      );
      if (resultsInsert.error) {
        await locals.supabase.from('matches').delete().eq('id', match_id);
        return fail(400, {
          message: `Import failed at row ${row.rowNumber} after ${imported} imported: ${resultsInsert.error.message}`
        });
      }

      const finalizeRes = await locals.supabase.rpc('finalize_match', {
        p_match_id: match_id,
        p_update_lifetime: true
      });
      if (finalizeRes.error) {
        await locals.supabase.from('matches').delete().eq('id', match_id);
        return fail(400, {
          message: `Import failed at row ${row.rowNumber} after ${imported} imported: ${finalizeRes.error.message}`
        });
      }

      imported += 1;
    }

    return {
      message: `Imported ${imported} matches from ${upload.name}. Created ${createdPlayers} new players.`
    };
  }
};
