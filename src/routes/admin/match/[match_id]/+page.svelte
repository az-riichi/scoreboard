<script lang="ts">
  import { fmtDateTime, fmtNum } from '$lib/ui';
  export let data: any;
  export let form: any;

  type Seat = 'E' | 'S' | 'W' | 'N';

  const match = data.match;
  const bySeat: Record<Seat, any> = { E: null, S: null, W: null, N: null };
  for (const r of data.results ?? []) {
    const seat = r?.seat as Seat;
    if (seat === 'E' || seat === 'S' || seat === 'W' || seat === 'N') {
      bySeat[seat] = r;
    }
  }

  let played_at = toDatetimeLocal(match.played_at);
  let table_mode = match.table_mode ?? 'A';
  let extra_sticks = String(match.extra_sticks ?? 0);
  let notes = match.notes ?? '';

  const seats: Seat[] = ['E', 'S', 'W', 'N'];
  const seatOrder: Record<Seat, number> = { E: 1, S: 2, W: 3, N: 4 };
  const isFinal = match.status === 'final';

  const playerLabelById = new Map<string, string>();
  for (const p of data.players ?? []) playerLabelById.set(p.id, p.label);

  const seasonRatingByPlayer = new Map<string, { rate: number; games_played: number }>();
  for (const row of data.seasonRatings ?? []) {
    seasonRatingByPlayer.set(row.player_id, {
      rate: asNum(row.rate, 1500),
      games_played: asNum(row.games_played, 0)
    });
  }

  const lifetimeRatingByPlayer = new Map<string, { rate: number; games_played: number }>();
  for (const row of data.lifetimeRatings ?? []) {
    lifetimeRatingByPlayer.set(row.player_id, {
      rate: asNum(row.rate, 1500),
      games_played: asNum(row.games_played, 0)
    });
  }

  let entries = seats.map((seat) => ({
    seat,
    player_id: bySeat[seat]?.player_id ?? '',
    raw_points: asNum(bySeat[seat]?.raw_points, 25000)
  }));

  function toDatetimeLocal(ts: string) {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    const yyyy = d.getFullYear();
    const mm = pad(d.getMonth() + 1);
    const dd = pad(d.getDate());
    const hh = pad(d.getHours());
    const mi = pad(d.getMinutes());
    return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
  }

  function asNum(v: unknown, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function playerLabel(player_id: string) {
    if (!player_id) return '—';
    return playerLabelById.get(player_id) ?? player_id.slice(0, 8);
  }

  function ratingState(player_id: string) {
    return (
      seasonRatingByPlayer.get(player_id) ??
      lifetimeRatingByPlayer.get(player_id) ?? { rate: 1500, games_played: 0 }
    );
  }

  function placeBasePoints(place: number) {
    if (place === 1) return 30;
    if (place === 2) return 10;
    if (place === 3) return -10;
    if (place === 4) return -30;
    return 0;
  }

  function gamesAdjustment(gamesPlayed: number) {
    if (!Number.isFinite(gamesPlayed)) return 1;
    if (gamesPlayed <= 20) return Math.max(1 - 0.4 * gamesPlayed, 0.2);
    return 0.2;
  }

  function umaForPlace(place: number) {
    const r = data.ruleset;
    if (!r) return 0;
    if (place === 1) return asNum(r.uma_1, 0);
    if (place === 2) return asNum(r.uma_2, 0);
    if (place === 3) return asNum(r.uma_3, 0);
    if (place === 4) return asNum(r.uma_4, 0);
    return 0;
  }

  function okaForPlace(place: number) {
    const r = data.ruleset;
    if (!r) return 0;
    if (place === 1) return asNum(r.oka_1, 0);
    if (place === 2) return asNum(r.oka_2, 0);
    if (place === 3) return asNum(r.oka_3, 0);
    if (place === 4) return asNum(r.oka_4, 0);
    return 0;
  }

  function averageUmaForRange(startPlace: number, count: number) {
    if (!Number.isFinite(startPlace) || !Number.isFinite(count) || count <= 0) return 0;
    let total = 0;
    for (let i = 0; i < count; i += 1) total += umaForPlace(startPlace + i);
    return total / count;
  }

  function clubPoints(raw: number, place: number, splitUma: number) {
    const r = data.ruleset;
    if (!r) return null;
    const divisor = asNum(r.point_divisor, 0);
    if (divisor === 0) return null;
    const base = (raw - asNum(r.return_points, 30000)) / divisor;
    return base + splitUma + okaForPlace(place);
  }

  $: enteredRows = entries.map((row) => ({
    seat: row.seat,
    player_id: row.player_id,
    raw_points: asNum(row.raw_points, 0)
  }));

  $: rawTotal = enteredRows.reduce((sum, row) => sum + row.raw_points, 0);

  $: placementBySeat = (() => {
    const ordered = [...enteredRows].sort((a, b) => {
      if (a.raw_points !== b.raw_points) return b.raw_points - a.raw_points;
      return seatOrder[a.seat] - seatOrder[b.seat];
    });
    const out: Record<string, number> = {};
    ordered.forEach((row, idx) => {
      out[row.seat] = idx + 1;
    });
    return out;
  })();

  $: displayPlacementBySeat = (() => {
    const ordered = [...enteredRows].sort((a, b) => {
      if (a.raw_points !== b.raw_points) return b.raw_points - a.raw_points;
      return seatOrder[a.seat] - seatOrder[b.seat];
    });

    const out: Record<string, number> = {};
    let idx = 0;
    while (idx < ordered.length) {
      const place = idx + 1;
      const raw = ordered[idx].raw_points;
      let j = idx + 1;
      while (j < ordered.length && ordered[j].raw_points === raw) j += 1;
      for (let k = idx; k < j; k += 1) out[ordered[k].seat] = place;
      idx = j;
    }
    return out;
  })();

  $: splitUmaBySeat = (() => {
    const ordered = [...enteredRows].sort((a, b) => {
      if (a.raw_points !== b.raw_points) return b.raw_points - a.raw_points;
      return seatOrder[a.seat] - seatOrder[b.seat];
    });

    const out: Record<string, number> = {};
    let idx = 0;
    while (idx < ordered.length) {
      const startPlace = idx + 1;
      const raw = ordered[idx].raw_points;
      let j = idx + 1;
      while (j < ordered.length && ordered[j].raw_points === raw) j += 1;
      const tieSize = j - idx;
      const tieUma = averageUmaForRange(startPlace, tieSize);
      for (let k = idx; k < j; k += 1) out[ordered[k].seat] = tieUma;
      idx = j;
    }
    return out;
  })();

  $: selectedPlayerIds = enteredRows.map((r) => r.player_id).filter(Boolean);
  $: canProjectR = selectedPlayerIds.length === 4 && new Set(selectedPlayerIds).size === 4;
  $: avgRate = canProjectR
    ? enteredRows.reduce((sum, row) => sum + ratingState(row.player_id).rate, 0) / enteredRows.length
    : null;

  $: expectedRows = enteredRows.map((row) => {
    const placement = placementBySeat[row.seat] ?? null;
    const splitUma = placement ? splitUmaBySeat[row.seat] ?? umaForPlace(placement) : null;
    const expectedClub = placement && splitUma != null ? clubPoints(row.raw_points, placement, splitUma) : null;
    const displayPlacement = placement ? displayPlacementBySeat[row.seat] ?? placement : null;

    if (!placement || !row.player_id || avgRate == null) {
      return {
        ...row,
        player_label: playerLabel(row.player_id),
        placement,
        display_placement: displayPlacement,
        expected_club: expectedClub,
        old_rate: null,
        expected_r_delta: null,
        expected_new_rate: null
      };
    }

    const rating = ratingState(row.player_id);
    const delta =
      gamesAdjustment(rating.games_played) * (placeBasePoints(placement) + (avgRate - rating.rate) / 40);

    return {
      ...row,
      player_label: playerLabel(row.player_id),
      placement,
      display_placement: displayPlacement,
      expected_club: expectedClub,
      old_rate: rating.rate,
      expected_r_delta: delta,
      expected_new_rate: rating.rate + delta
    };
  });
</script>

<div class="card" style="margin-bottom:12px;">
  <div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; align-items:end;">
    <div>
      <div style="font-size:1.1rem; font-weight:650;">Edit match</div>
      <div class="muted">{fmtDateTime(match.played_at)} — {match.table_label ?? match.id.slice(0,8)} — {match.status}</div>
      <div class="muted">Tbl: {match.table_mode ?? '—'} | Game: {match.game_number ?? '—'} | Ex: {match.extra_sticks ?? 0}</div>
      <div style="font-size:0.8rem; color:#888;">UUID: <code>{match.id}</code></div>
      {#if match.notes}
        <div class="muted">Note: {match.notes}</div>
      {/if}
    </div>
    <div style="display:flex; gap:10px; flex-wrap:wrap;">
      <a class="btn" href="/admin/matches" style="text-decoration:none;">Back</a>
      {#if isFinal}
        <a class="btn" href={`/match/${match.id}`} style="text-decoration:none;">Public view</a>
      {/if}
      <form method="POST" action="?/deleteGame" on:submit={(e) => { if (!confirm('Delete this game? This cannot be undone.')) e.preventDefault(); }}>
        <button class="btn" type="submit">Delete game</button>
      </form>
    </div>
  </div>
</div>

{#if form?.message}
  <div class="card" style="border-color:#c7f0c2; background:#f2fff0; margin-bottom:12px;">
    {form.message}
  </div>
{/if}

<div class="card" style="margin-bottom:12px;">
  <div style="font-size:1.05rem; font-weight:650;">Match metadata</div>
  <div class="muted">Edit date/table mode, Ex sticks, and notes. Game # / table label are auto-generated.</div>

  <form method="POST" action="?/saveMatchMeta" style="display:grid; gap:10px; margin-top:12px;">
    <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:end;">
      <div style="display:grid; gap:4px;">
        <label for="played_at">Played at</label>
        <input id="played_at" name="played_at" type="datetime-local" bind:value={played_at} required />
      </div>

      <div style="display:grid; gap:4px;">
        <label for="table_mode">Tbl</label>
        <select id="table_mode" name="table_mode" bind:value={table_mode} style="width:110px;">
          <option value="A">A</option>
          <option value="M">M</option>
        </select>
      </div>

      <div style="display:grid; gap:4px;">
        <label for="extra_sticks">Ex</label>
        <input id="extra_sticks" name="extra_sticks" type="number" min="0" step="1" bind:value={extra_sticks} style="width:110px;" />
      </div>
    </div>

    <div style="display:grid; gap:4px;">
      <label for="notes">Note</label>
      <textarea id="notes" name="notes" bind:value={notes} rows="3" placeholder="Optional match notes"></textarea>
    </div>

    <div class="muted">Current auto values: Tbl {match.table_mode ?? table_mode} | Game {match.game_number ?? '—'} | Label {match.table_label ?? '—'}</div>

    <div>
      <button class="btn" type="submit">Save metadata</button>
    </div>
  </form>
</div>

<div class="grid2">
  <div class="card">
    <div style="font-size:1.05rem; font-weight:650;">Results entry (raw points)</div>
    <div class="muted">Pick players for E/S/W/N and input raw end points.</div>

    <form method="POST" action="?/saveResults" style="display:grid; gap:10px; margin-top:12px;">
      {#each entries as row, i (row.seat)}
        <div class="card" style="border-radius:14px;">
          <div class="muted" style="margin-bottom:6px;">Seat {row.seat}</div>
          <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center;">
            <select
              name={`p_${row.seat}`}
              bind:value={entries[i].player_id}
              required
              style="min-width:240px;"
            >
              <option value="" disabled>Select player</option>
              {#each data.players as p}
                <option value={p.id}>{p.label}</option>
              {/each}
            </select>
            <input
              name={`raw_${row.seat}`}
              type="number"
              step="100"
              bind:value={entries[i].raw_points}
              style="width:160px;"
            />
          </div>
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

    <div style="margin-top:14px;">
      <div style="font-size:1.02rem; font-weight:650;">Expected outcomes</div>
      <div class="muted">Club points include ruleset return/divisor and tie-split UMA (OKA by placement). R preview uses season R with lifetime fallback.</div>

      <div style="margin-top:10px; overflow:auto;">
        <table>
          <thead>
            <tr>
              <th style="width:70px;">Seat</th>
              <th>Player</th>
              <th style="width:120px;">Raw</th>
              <th style="width:90px;">Place</th>
              <th style="width:130px;">Club</th>
              <th style="width:120px;">ΔR</th>
              <th style="width:130px;">New R</th>
            </tr>
          </thead>
          <tbody>
            {#each expectedRows as row}
              <tr>
                <td>{row.seat}</td>
                <td>{row.player_label}</td>
                <td>{row.raw_points}</td>
                <td>{row.display_placement ?? '—'}</td>
                <td>{row.expected_club == null ? '—' : fmtNum(row.expected_club, 2)}</td>
                <td>{row.expected_r_delta == null ? '—' : fmtNum(row.expected_r_delta, 2)}</td>
                <td>{row.expected_new_rate == null ? '—' : fmtNum(row.expected_new_rate, 2)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      {#if !canProjectR}
        <div class="muted" style="margin-top:8px;">Pick 4 distinct players to preview R gain/loss.</div>
      {/if}
    </div>
  </div>

  <div class="card">
    <div style="font-size:1.05rem; font-weight:650;">Quick checks</div>
    <div class="muted">Sanity check before finalizing.</div>

    <div style="margin-top:12px; display:grid; gap:10px;">
      <div class="card" style="border-radius:14px;">
        <div class="muted">Raw total</div>
        <div style="font-size:1.2rem; font-weight:700;">{rawTotal}</div>
      </div>

      <details class="card" style="border-radius:14px;">
        <summary style="cursor:pointer; font-weight:650;">Penalties / Chombo ({data.penalties.length})</summary>
        <div class="muted" style="margin-top:8px;">
          Penalties adjust club standings only. They do not change R-rank.
        </div>

        <form method="POST" action="?/addPenalty" style="display:grid; gap:10px; margin-top:10px;">
          <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:end;">
            <div style="display:grid; gap:4px;">
              <label for="penalty_player">Player</label>
              <select id="penalty_player" name="player_id" required style="min-width:220px;">
                <option value="" disabled selected>Select player</option>
                {#each data.players as p}
                  <option value={p.id}>{p.label}</option>
                {/each}
              </select>
            </div>

            <div style="display:grid; gap:4px;">
              <label for="penalty_points">Points</label>
              <input id="penalty_points" name="points" type="number" step="1" required style="width:120px;" />
            </div>

            <div style="display:grid; gap:4px;">
              <label for="penalty_reason">Reason code</label>
              <input id="penalty_reason" name="reason_code" type="text" placeholder="CHOMBO" required style="width:170px;" />
            </div>

            <button class="btn" type="submit">Add penalty</button>
          </div>
        </form>

        <div style="margin-top:10px; overflow:auto;">
          <table>
            <thead>
              <tr>
                <th>Player</th>
                <th style="width:90px;">Points</th>
                <th>Reason</th>
                <th style="width:170px;">Created</th>
                <th style="width:100px;"></th>
              </tr>
            </thead>
            <tbody>
              {#each data.penalties as p}
                <tr>
                  <td>{p.player_label}</td>
                  <td>{fmtNum(p.points, 2)}</td>
                  <td>{p.reason_code}</td>
                  <td>{fmtDateTime(p.created_at)}</td>
                  <td>
                    <form method="POST" action="?/removePenalty">
                      <input type="hidden" name="adjustment_id" value={p.id} />
                      <button class="btn" type="submit">Remove</button>
                    </form>
                  </td>
                </tr>
              {/each}
              {#if data.penalties.length === 0}
                <tr><td colspan="5" class="muted">No penalties added.</td></tr>
              {/if}
            </tbody>
          </table>
        </div>
      </details>

      <div class="muted">
        Ex is set in Match metadata above.
      </div>
    </div>
  </div>
</div>
