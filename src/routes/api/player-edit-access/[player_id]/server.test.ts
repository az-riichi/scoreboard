import { describe, expect, it, vi } from 'vitest';
import { GET } from './+server';

const PLAYER = { id: 'player', display_name: 'Name', real_first_name: 'First', real_last_name: 'Last' };

function database(owns: boolean, player: unknown = PLAYER, playerError: unknown = null) {
  const rows: Record<string, unknown> = {
    player_accounts: owns ? { player_id: 'player' } : null,
    players: player
  };
  const from = vi.fn((table: string) => {
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      maybeSingle: vi.fn(async () => ({
        data: rows[table],
        error: table === 'players' ? playerError : null
      }))
    };
    return query;
  });
  return { from };
}

function get(userId: string | null, supabase: ReturnType<typeof database>) {
  return GET({
    locals: { userId, supabase },
    params: { player_id: 'player' }
  } as never) as Promise<Response>;
}

describe('player edit access', () => {
  it('gives a signed-out visitor nothing without reading the database', async () => {
    const supabase = database(true);
    const response = await get(null, supabase);

    expect(await response.json()).toEqual({ canEditDisplay: false, editablePlayer: null });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('keeps private names from an account that does not own the profile', async () => {
    const supabase = database(false);
    const response = await get('someone-else', supabase);

    expect(await response.json()).toEqual({ canEditDisplay: false, editablePlayer: null });
    expect(supabase.from).not.toHaveBeenCalledWith('players');
  });

  it('gives the owner their private names and is never stored by a shared cache', async () => {
    const response = await get('owner', database(true));

    expect(await response.json()).toEqual({ canEditDisplay: true, editablePlayer: PLAYER });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('denies editing when the private names cannot be read', async () => {
    const response = await get('owner', database(true, null, { message: 'unavailable' }));

    expect(await response.json()).toEqual({ canEditDisplay: false, editablePlayer: null });
  });
});
