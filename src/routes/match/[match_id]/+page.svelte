<script lang="ts">
  import { fmtDateTime, fmtNum } from '$lib/ui';
  export let data: any;

  const seatOrder: Record<string, number> = { E: 1, S: 2, W: 3, N: 4 };
  const results = [...data.results].sort((a, b) => (seatOrder[a.seat] ?? 99) - (seatOrder[b.seat] ?? 99));

  const displayPlaceBySeat = new Map<string, number>();
  const orderedByRaw = [...data.results].sort((a, b) => {
    if (a.raw_points !== b.raw_points) return b.raw_points - a.raw_points;
    return (seatOrder[a.seat] ?? 99) - (seatOrder[b.seat] ?? 99);
  });
  let idx = 0;
  while (idx < orderedByRaw.length) {
    const place = idx + 1;
    const raw = orderedByRaw[idx].raw_points;
    let j = idx + 1;
    while (j < orderedByRaw.length && orderedByRaw[j].raw_points === raw) j += 1;
    for (let k = idx; k < j; k += 1) displayPlaceBySeat.set(orderedByRaw[k].seat, place);
    idx = j;
  }

  const displayPlaceByPlayer = new Map<string, number>();
  for (const r of data.results) {
    const place = displayPlaceBySeat.get(r.seat);
    if (place != null) displayPlaceByPlayer.set(r.player_id, place);
  }
</script>

<div class="card" style="margin-bottom:12px;">
  <div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap;">
    <div>
      <div style="font-size:1.1rem; font-weight:650;">Match {data.match.table_label ?? data.match.id.slice(0,8)}</div>
      <div class="muted">{fmtDateTime(data.match.played_at)}</div>
      <div class="muted">Tbl: {data.match.table_mode ?? '—'} | Game: {data.match.game_number ?? '—'} | Ex: {data.match.extra_sticks ?? 0}</div>
      <div style="font-size:0.8rem; color:#888;">UUID: <code>{data.match.id}</code></div>
      {#if data.match.notes}
        <div class="muted">Note: {data.match.notes}</div>
      {/if}
    </div>
    <a class="btn" href={`/season/${data.match.season_id}`} style="text-decoration:none;">Back to season</a>
  </div>
</div>

<div class="grid2">
  <div class="card">
    <div style="font-size:1.05rem; font-weight:650;">Results</div>
    <div class="muted">Seats E/S/W/N with raw points, club points, placement.</div>

    <div style="margin-top:12px; overflow:auto;">
      <table>
        <thead>
          <tr>
            <th style="width:70px;">Seat</th>
            <th>Player</th>
            <th style="width:140px;">Raw</th>
            <th style="width:140px;">Club</th>
            <th style="width:90px;">Place</th>
          </tr>
        </thead>
        <tbody>
          {#each results as r}
            <tr>
              <td>{r.seat}</td>
              <td><a href={`/player/${r.player_id}?season=${data.match.season_id}`} style="text-decoration:none;">{r.display_name}</a></td>
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
    <div style="font-size:1.05rem; font-weight:650;">R deltas (season)</div>
    <div class="muted">Tenhou-like rating change for this match.</div>

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
            <tr>
              <td><a href={`/player/${row.player_id}?season=${data.match.season_id}`} style="text-decoration:none;">{row.display_name}</a></td>
              <td>{displayPlaceByPlayer.get(row.player_id) ?? row.placement}</td>
              <td>{fmtNum(row.delta, 2)}</td>
              <td>{fmtNum(row.new_rate, 2)}</td>
            </tr>
          {/each}
          {#if data.ratingDeltas.length === 0}
            <tr><td colspan="4" class="muted">No rating events found.</td></tr>
          {/if}
        </tbody>
      </table>
    </div>
  </div>
</div>
