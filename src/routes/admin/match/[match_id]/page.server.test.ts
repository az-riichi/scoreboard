import { describe, expect, it, vi } from 'vitest';
import { actions } from './+page.server';

const SEATS = ['E', 'S', 'W', 'N'];

function setupMatchAction(
  isCasual: boolean,
  fields: Record<string, string | null> = {},
  rawPoints = 25_000
) {
  const reads: string[] = [];
  const upsert = vi.fn().mockResolvedValue({ error: null });
  const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
  const rows: Record<string, Record<string, unknown>> = {
    profiles: { admin_role: 'owner', admin_permissions: [] },
    matches: {
      id: 'match-a', season_id: 'season-a', ruleset_id: 'rules-a', status: 'draft',
      extra_sticks: 0, played_at: '2026-07-21T12:00:00Z'
    },
    seasons: { is_casual: isCasual },
    rulesets: { start_points: 25_000 }
  };
  const locals = {
    user: { id: 'admin-a' },
    userId: 'admin-a',
    supabase: {
      from(table: string) {
        const query = {
          select() { return query; },
          eq() { return query; },
          async maybeSingle() {
            reads.push(table);
            return { data: rows[table], error: null };
          },
          upsert
        };
        return query;
      },
      rpc
    }
  } as unknown as App.Locals;
  const form = new FormData();
  for (const seat of SEATS) {
    form.set(`p_${seat}`, `player-${seat}`);
    form.set(`raw_${seat}`, String(rawPoints));
  }
  for (const [key, value] of Object.entries(fields)) {
    form.set(key, value ?? '');
  }
  const event = {
    locals,
    params: { match_id: 'match-a' },
    request: new Request('https://scoreboard.example/admin/match/match-a', {
      method: 'POST', body: form
    })
  };
  return { event, reads, upsert, rpc };
}

describe('match finalization', () => {
  it.each([false, true])('reuses the validated season when casual is %s', async (isCasual) => {
    const { event, reads, upsert, rpc } = setupMatchAction(isCasual);
    const finalize = actions.finalize!;

    await expect(finalize(event as never)).rejects.toMatchObject({
      status: 303, location: '/admin/match/match-a'
    });

    expect(reads.filter((table) => table === 'seasons')).toHaveLength(1);
    expect(upsert).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith('finalize_match_authorized', {
      p_match_id: 'match-a', p_update_lifetime: !isCasual
    });
    if (!isCasual) {
      expect(rpc).toHaveBeenCalledWith('get_effective_player_restrictions', {
        p_on_date: '2026-07-21',
        p_player_ids: ['player-E', 'player-S', 'player-W', 'player-N']
      });
    }
  });

  it('still rejects unbalanced results before saving or finalizing', async () => {
    const { event, upsert, rpc } = setupMatchAction(true, {}, 24_000);
    const finalize = actions.finalize!;

    await expect(finalize(event as never)).resolves.toMatchObject({
      status: 400,
      data: { message: expect.stringContaining('Point total mismatch') }
    });
    expect(upsert).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    [{ p_W: null }, 'Choose a player for seat W.'],
    [{ raw_N: null }, 'Enter the points for seat N.']
  ])('rejects an incomplete sheet: %o', async (fields, message) => {
    const { event, upsert, rpc } = setupMatchAction(true, fields);
    const finalize = actions.finalize!;

    await expect(finalize(event as never)).resolves.toMatchObject({
      status: 400,
      data: { message }
    });
    expect(upsert).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('saving results', () => {
  it('saves a half-filled sheet with the missing values left empty', async () => {
    const { event, upsert, rpc } = setupMatchAction(false, {
      raw_E: '30000',
      raw_S: null,
      p_W: null,
      raw_W: '12000',
      p_N: null,
      raw_N: null
    });
    const saveResults = actions.saveResults!;

    await expect(saveResults(event as never)).resolves.toEqual({ message: 'Saved.' });

    expect(upsert).toHaveBeenCalledWith(
      [
        { match_id: 'match-a', seat: 'E', player_id: 'player-E', raw_points: 30_000 },
        { match_id: 'match-a', seat: 'S', player_id: 'player-S', raw_points: null },
        { match_id: 'match-a', seat: 'W', player_id: null, raw_points: 12_000 },
        { match_id: 'match-a', seat: 'N', player_id: null, raw_points: null }
      ],
      { onConflict: 'match_id,seat' }
    );
    expect(rpc).toHaveBeenCalledWith('get_effective_player_restrictions', {
      p_on_date: '2026-07-21',
      p_player_ids: ['player-E', 'player-S']
    });
  });

  it('saves an unbalanced total', async () => {
    const { event, upsert } = setupMatchAction(true, {}, 24_000);
    const saveResults = actions.saveResults!;

    await expect(saveResults(event as never)).resolves.toEqual({ message: 'Saved.' });
    expect(upsert).toHaveBeenCalledOnce();
  });

  it('skips the eligibility lookup until a player is chosen', async () => {
    const { event, upsert, rpc } = setupMatchAction(false, {
      p_E: null, p_S: null, p_W: null, p_N: null,
      raw_E: null, raw_S: null, raw_W: null, raw_N: null
    });
    const saveResults = actions.saveResults!;

    await expect(saveResults(event as never)).resolves.toEqual({ message: 'Saved.' });
    expect(upsert).toHaveBeenCalledOnce();
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    [{ p_S: 'player-E' }, 'Players must be distinct.'],
    [{ raw_E: '12.5' }, 'Seat E points must be an integer.'],
    [{ raw_N: '300000' }, 'Seat N points are outside the allowed range.']
  ])('still rejects a wrong value: %o', async (fields, message) => {
    const { event, upsert } = setupMatchAction(true, fields);
    const saveResults = actions.saveResults!;

    await expect(saveResults(event as never)).resolves.toMatchObject({
      status: 400,
      data: { message }
    });
    expect(upsert).not.toHaveBeenCalled();
  });
});
