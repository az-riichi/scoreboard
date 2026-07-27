<script lang="ts">
  import { clickableRow } from '$lib/clickable-row';
  import { fmtDateTime, fmtNum } from '$lib/ui';
  export let data: any;

  const seatOrder: Record<string, number> = { E: 1, S: 2, W: 3, N: 4 };
  $: results = [...data.results].sort(
    (a, b) => (seatOrder[a.seat] ?? 99) - (seatOrder[b.seat] ?? 99)
  );

  $: displayPlaceBySeat = (() => {
    const places = new Map<string, number>();
    const orderedByRaw = [...data.results].sort((a, b) => {
      if (a.raw_points !== b.raw_points) return b.raw_points - a.raw_points;
      return (seatOrder[a.seat] ?? 99) - (seatOrder[b.seat] ?? 99);
    });
    let idx = 0;
    while (idx < orderedByRaw.length) {
      const place = idx + 1;
      const raw = orderedByRaw[idx].raw_points;
      let next = idx + 1;
      while (next < orderedByRaw.length && orderedByRaw[next].raw_points === raw) next += 1;
      for (let rowIndex = idx; rowIndex < next; rowIndex += 1) {
        places.set(orderedByRaw[rowIndex].seat, place);
      }
      idx = next;
    }
    return places;
  })();

  $: displayPlaceByPlayer = new Map<string, number>(
    data.results
      .map((result: any) => [result.player_id, displayPlaceBySeat.get(result.seat)] as const)
      .filter((entry: readonly [string, number | undefined]): entry is readonly [string, number] => entry[1] != null)
  );

  function playerHref(playerId: string) {
    const eventQuery =
      data.isCasual && data.match.casual_event_id
        ? `&event=${encodeURIComponent(data.match.casual_event_id)}`
        : '';
    return `/player/${playerId}?season=${data.match.season_id}${eventQuery}`;
  }
</script>

<div class="card" style="margin-bottom:12px;">
  <div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap;">
    <div>
      <div style="font-size:1.1rem; font-weight:650;">Match {data.match.table_label ?? data.match.id.slice(0,8)}</div>
      <div class="muted">{data.season?.name ?? 'Unknown season'}{data.isCasual ? ' · Casual' : ''}</div>
      {#if data.isCasual}
        <div class="muted">Event: {data.casualEvent?.name ?? 'Uncategorized'}</div>
      {/if}
      <div class="muted">{fmtDateTime(data.match.played_at)}</div>
      <div class="muted">Tbl: {data.match.table_mode ?? '—'} | Game: {data.match.game_number ?? '—'} | Ex: {data.match.extra_sticks ?? 0}</div>
      <div style="font-size:0.8rem; color:#888;">UUID: <code>{data.match.id}</code></div>
      {#if data.match.notes}
        <div class="muted">Note: {data.match.notes}</div>
      {/if}
    </div>
    <a
      class="btn"
      href={`/season/${data.match.season_id}${data.match.casual_event_id ? `?event=${data.match.casual_event_id}` : ''}`}
      style="text-decoration:none;"
    >
      Back to season
    </a>
  </div>
</div>

<div class="grid2">
  <div class="card">
    <div style="font-size:1.05rem; font-weight:650;">Results</div>

    <div style="margin-top:12px; overflow:auto;">
      <table>
        <thead>
          <tr>
            <th style="width:70px;">Seat</th>
            <th>Player</th>
            <th style="width:140px;">Points</th>
            <th style="width:140px;">SP Δ</th>
            <th style="width:90px;">Place</th>
          </tr>
        </thead>
        <tbody>
          {#each results as r}
          <tr use:clickableRow={playerHref(r.player_id)}>
              <td>{r.seat}</td>
              <td>
              <a href={playerHref(r.player_id)} style="text-decoration:none;">
                  {r.player_name_primary}
                  {#if r.player_name_secondary}
                    <span class="muted" style="margin-left:6px;">({r.player_name_secondary})</span>
                  {/if}
                </a>
              </td>
              <td>{r.raw_points}</td>
              <td>{fmtNum(r.club_points, 2)}</td>
              <td>{displayPlaceBySeat.get(r.seat) ?? r.placement}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>

  <div class="card">
    {#if data.isCasual}
      <div style="font-size:1.05rem; font-weight:650;">Casual match</div>
      <div class="muted" style="margin-top:8px;">
        Scores and placements are recorded, but this match does not change Season Rating (SR) or lifetime Rating (R).
      </div>
    {:else}
      <div style="font-size:1.05rem; font-weight:650;">Rating (R) deltas</div>
      <div class="muted">Lifetime Rating (R) change for this match.</div>

      <div style="margin-top:12px; overflow:auto;">
        <table>
          <thead>
            <tr>
              <th>Player</th>
              <th style="width:80px;">Place</th>
              <th style="width:140px;">ΔR</th>
              <th style="width:140px;">New R</th>
            </tr>
          </thead>
          <tbody>
            {#each data.ratingDeltas as row}
              <tr use:clickableRow={playerHref(row.player_id)}>
                <td>
                  <a href={playerHref(row.player_id)} style="text-decoration:none;">
                    {row.player_name_primary}
                    {#if row.player_name_secondary}
                      <span class="muted" style="margin-left:6px;">({row.player_name_secondary})</span>
                    {/if}
                  </a>
                </td>
                <td>{displayPlaceByPlayer.get(row.player_id) ?? row.placement}</td>
                <td>{fmtNum(row.delta, 2)}</td>
                <td>{fmtNum(row.new_rate, 2)}</td>
              </tr>
            {/each}
            {#if data.ratingDeltas.length === 0}
              <tr><td colspan="4" class="muted">No Rating (R) events found.</td></tr>
            {/if}
          </tbody>
        </table>
      </div>
    {/if}
  </div>
</div>
