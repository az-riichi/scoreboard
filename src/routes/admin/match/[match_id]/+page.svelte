<script lang="ts">
  import { fmtDateTime, fmtNum } from '$lib/ui';
  export let data: any;
  export let form: any;

  const match = data.match;
  const bySeat: Record<string, any> = {};
  for (const r of data.results) bySeat[r.seat] = r;

  let p_E = bySeat.E?.player_id ?? '';
  let p_S = bySeat.S?.player_id ?? '';
  let p_W = bySeat.W?.player_id ?? '';
  let p_N = bySeat.N?.player_id ?? '';

  let raw_E = bySeat.E?.raw_points ?? 25000;
  let raw_S = bySeat.S?.raw_points ?? 25000;
  let raw_W = bySeat.W?.raw_points ?? 25000;
  let raw_N = bySeat.N?.raw_points ?? 25000;

  const seats = ['E', 'S', 'W', 'N'] as const;
  const isFinal = match.status === 'final';
  const expectedRawTotal = 100000 - ((match.extra_sticks ?? 0) * 1000);

  const playerBinds = {
    E: { get: () => p_E, set: (value: string) => (p_E = value) },
    S: { get: () => p_S, set: (value: string) => (p_S = value) },
    W: { get: () => p_W, set: (value: string) => (p_W = value) },
    N: { get: () => p_N, set: (value: string) => (p_N = value) }
  };

  const rawBinds = {
    E: { get: () => raw_E, set: (value: number) => (raw_E = value) },
    S: { get: () => raw_S, set: (value: number) => (raw_S = value) },
    W: { get: () => raw_W, set: (value: number) => (raw_W = value) },
    N: { get: () => raw_N, set: (value: number) => (raw_N = value) }
  };
</script>

<div class="card" style="margin-bottom:12px;">
  <div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; align-items:end;">
    <div>
      <div style="font-size:1.1rem; font-weight:650;">Edit match</div>
      <div class="muted">{fmtDateTime(match.played_at)} — {match.table_label ?? match.id.slice(0,8)} — {match.status}</div>
      <div class="muted">Tbl: {match.table_mode ?? '—'} | Game: {match.game_number ?? '—'} | Ex: {match.extra_sticks ?? 0}</div>
    </div>
    <div style="display:flex; gap:10px; flex-wrap:wrap;">
      <a class="btn" href="/admin/matches" style="text-decoration:none;">Back</a>
      {#if isFinal}
        <a class="btn" href={`/match/${match.id}`} style="text-decoration:none;">Public view</a>
      {/if}
    </div>
  </div>
</div>

{#if form?.message}
  <div class="card" style="border-color:#c7f0c2; background:#f2fff0; margin-bottom:12px;">
    {form.message}
  </div>
{/if}

<div class="grid2">
  <div class="card">
    <div style="font-size:1.05rem; font-weight:650;">Results entry (raw points)</div>
    <div class="muted">Pick players for E/S/W/N and input raw end points.</div>

    <form method="POST" action="?/saveResults" style="display:grid; gap:10px; margin-top:12px;">
      {#each seats as seat}
        <div class="card" style="border-radius:14px;">
          <div class="muted" style="margin-bottom:6px;">Seat {seat}</div>
          <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center;">
            <select
              name={`p_${seat}`}
              bind:value={playerBinds[seat]}
              required
              style="min-width:240px;"
            >
              <option value="" disabled>Select player</option>
              {#each data.players as p}
                <option value={p.id}>{p.label}</option>
              {/each}
            </select>
            <input
              name={`raw_${seat}`}
              type="number"
              step="100"
              bind:value={rawBinds[seat]}
              style="width:160px;"
            />
          </div>

          {#if bySeat[seat]?.placement}
            <div class="muted" style="margin-top:6px;">
              Placement: {bySeat[seat].placement} | Club points: {fmtNum(bySeat[seat].club_points, 2)}
            </div>
          {/if}
        </div>
      {/each}

      <div style="display:flex; gap:10px; flex-wrap:wrap;">
        <button class="btn primary" type="submit" disabled={isFinal}>Save results</button>
        <button class="btn" type="submit" formmethod="POST" formaction="?/recompute" disabled={!data.results?.length}>Recompute placement</button>
        <button class="btn" type="submit" formmethod="POST" formaction="?/finalize" disabled={isFinal}>Finalize match</button>
      </div>

      {#if isFinal}
        <div class="muted">This match is finalized (public).</div>
      {/if}
    </form>
  </div>

  <div class="card">
    <div style="font-size:1.05rem; font-weight:650;">Quick checks</div>
    <div class="muted">Sanity checks before finalizing.</div>

    <div style="margin-top:12px; display:grid; gap:10px;">
      <div class="card" style="border-radius:14px;">
        <div class="muted">Current raw total</div>
        <div style="font-size:1.2rem; font-weight:700;">{raw_E + raw_S + raw_W + raw_N}</div>
        <div class="muted">Expected total with Ex={match.extra_sticks ?? 0}: {expectedRawTotal}.</div>
      </div>

      <div class="card" style="border-radius:14px;">
        <div class="muted">Players selected</div>
        <div style="display:grid; gap:4px; margin-top:6px;">
          <div>E: {p_E ? '✓' : '—'}</div>
          <div>S: {p_S ? '✓' : '—'}</div>
          <div>W: {p_W ? '✓' : '—'}</div>
          <div>N: {p_N ? '✓' : '—'}</div>
        </div>
      </div>
    </div>
  </div>
</div>
