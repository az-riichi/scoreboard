import { error as kitError, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

type ServerSupabase = App.Locals['supabase'];
type RevisionRecord = {
  scope: string;
  revision: string;
  changed_at: string;
};

const PUBLIC_DATA_SCOPE = 'scoreboard';
const PAGE_SIZE = 1_000;
const SNAPSHOT_SCHEMA_VERSION = 1;

function revisionEtag(revision: string) {
  return `"scoreboard-${revision}"`;
}

function knownRevision(request: Request, url: URL): string | null {
  const queryRevision = String(url.searchParams.get('revision') ?? '').trim();
  if (/^\d+$/.test(queryRevision)) return queryRevision;

  const etag = String(request.headers.get('if-none-match') ?? '').trim();
  const match = /^(?:W\/)?"scoreboard-(\d+)"$/.exec(etag);
  return match?.[1] ?? null;
}

async function readRevision(supabase: ServerSupabase): Promise<RevisionRecord> {
  const result = await supabase
    .from('public_data_revision')
    .select('scope, revision, changed_at')
    .eq('scope', PUBLIC_DATA_SCOPE)
    .maybeSingle();

  if (result.error || !result.data) {
    throw kitError(503, 'Public data revision is unavailable.');
  }

  return {
    scope: PUBLIC_DATA_SCOPE,
    revision: String(result.data.revision),
    changed_at: String(result.data.changed_at)
  };
}

async function fetchAll<T>(
  loadPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const rows: T[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const result = await loadPage(from, from + PAGE_SIZE - 1);
    if (result.error) throw kitError(502, `Could not refresh public data: ${result.error.message}`);

    const page = result.data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

async function readRawSnapshot(supabase: ServerSupabase) {
  const [seasons, casualEvents, players, rulesets, matches, matchResults, adjustments] =
    await Promise.all([
      fetchAll((from, to) =>
        supabase
          .from('seasons')
          .select('id, name, start_date, end_date, is_active, is_casual')
          .order('id', { ascending: true })
          .range(from, to)
      ),
      fetchAll((from, to) =>
        supabase
          .from('casual_events')
          .select('id, name')
          .order('id', { ascending: true })
          .range(from, to)
      ),
      fetchAll((from, to) =>
        supabase
          .from('v_public_players')
          .select(
            'id, display_name, real_first_name, real_last_name, show_display_name, show_real_first_name, show_real_last_name, profile_message_md, profile_media_url, is_active'
          )
          .order('id', { ascending: true })
          .range(from, to)
      ),
      fetchAll((from, to) =>
        supabase
          .from('rulesets')
          .select(
            'id, name, start_points, return_points, point_divisor, uma_1, uma_2, uma_3, uma_4, oka_1, oka_2, oka_3, oka_4'
          )
          .order('id', { ascending: true })
          .range(from, to)
      ),
      fetchAll((from, to) =>
        supabase
          .from('matches')
          .select(
            'id, season_id, casual_event_id, ruleset_id, game_number, table_mode, extra_sticks, include_in_lifetime_rating, played_at, status, table_label, notes'
          )
          .eq('status', 'final')
          .order('id', { ascending: true })
          .range(from, to)
      ),
      fetchAll((from, to) =>
        supabase
          .from('match_results')
          .select('match_id, seat, player_id, raw_points, matches!inner(status)')
          .eq('matches.status', 'final')
          .order('match_id', { ascending: true })
          .order('seat', { ascending: true })
          .range(from, to)
      ),
      fetchAll((from, to) =>
        supabase
          .from('adjustments')
          .select('id, season_id, match_id, player_id, points, created_at')
          .order('id', { ascending: true })
          .range(from, to)
      )
    ]);

  const finalMatchIds = new Set(matches.map((match: any) => String(match.id)));

  return {
    seasons,
    casual_events: casualEvents,
    players,
    rulesets,
    matches,
    match_results: matchResults.map(({ matches: _match, ...row }: any) => row),
    adjustments: adjustments.filter(
      (adjustment: any) =>
        adjustment.match_id == null || finalMatchIds.has(String(adjustment.match_id))
    )
  };
}

export const GET: RequestHandler = async ({ locals, request, url }) => {
  const clientRevision = knownRevision(request, url);
  let revision = await readRevision(locals.supabase);

  if (clientRevision === revision.revision) {
    return new Response(null, {
      status: 304,
      headers: {
        etag: revisionEtag(revision.revision),
        'cache-control': 'private, no-store',
        'x-public-data-revision': revision.revision
      }
    });
  }

  // Each PostgREST read is a separate transaction. Verify the marker after the
  // parallel raw reads and retry once rather than caching a mixed snapshot.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const raw = await readRawSnapshot(locals.supabase);
    const confirmedRevision = await readRevision(locals.supabase);

    if (confirmedRevision.revision === revision.revision) {
      return json(
        {
          schema_version: SNAPSHOT_SCHEMA_VERSION,
          revision: confirmedRevision,
          ...raw
        },
        {
          headers: {
            etag: revisionEtag(confirmedRevision.revision),
            'cache-control': 'private, no-store',
            'x-public-data-revision': confirmedRevision.revision
          }
        }
      );
    }

    revision = confirmedRevision;
  }

  throw kitError(503, 'Public data changed during refresh. Please retry.');
};
