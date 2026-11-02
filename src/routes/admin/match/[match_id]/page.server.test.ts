import { describe, expect, it, vi } from 'vitest';
import { actions } from './+page.server';

function setupFinalization(isCasual: boolean, rawPoints = 25_000) {
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
  for (const seat of ['E', 'S', 'W', 'N']) {
    form.set(`p_${seat}`, `player-${seat}`);
    form.set(`raw_${seat}`, String(rawPoints));
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
    const { event, reads, upsert, rpc } = setupFinalization(isCasual);
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
    const { event, upsert, rpc } = setupFinalization(true, 24_000);
    const finalize = actions.finalize!;

    await expect(finalize(event as never)).resolves.toMatchObject({
      status: 400,
      data: { message: expect.stringContaining('Point total mismatch') }
    });
    expect(upsert).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});
