<script lang="ts">
  import { fmtNum } from '$lib/ui';
  import { fmtDateTimeArizona as fmtDateTime, toArizonaDatetimeLocalValue } from '$lib/arizona-time';
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

  let played_at = toArizonaDatetimeLocalValue(match.played_at);
  let table_mode = match.table_mode ?? 'A';
  let extra_sticks = String(match.extra_sticks ?? 0);
  let notes = match.notes ?? '';

  const seats: Seat[] = ['E', 'S', 'W', 'N'];
  const seatOrder: Record<Seat, number> = { E: 1, S: 2, W: 3, N: 4 };
  const isFinal = match.status === 'final';
  type ConfirmAction = 'delete' | 'finalize' | null;
  let confirmAction: ConfirmAction = null;

  const playerMetaById = new Map<string, { primary: string; secondary: string | null; label: string; token: string }>();
  const tokenToPlayerId = new Map<string, string>();
  const tokenByPlayerId = new Map<string, string>();
  const playerOptions: Array<{ id: string; label: string; token: string }> = [];
  const labelCount = new Map<string, number>();
  for (const p of data.players ?? []) {
    const primary = String(p?.player_name_primary ?? p?.label ?? '').trim() || 'Unnamed player';
    const secondaryRaw = String(p?.player_name_secondary ?? '').trim();
    const secondary = secondaryRaw || null;
    const label = secondary ? `${primary} (${secondary})` : primary;
    labelCount.set(label, (labelCount.get(label) ?? 0) + 1);
  }
  for (const p of data.players ?? []) {
    const id = String(p?.id ?? '').trim();
    if (!id) continue;
    const primary = String(p?.player_name_primary ?? p?.label ?? '').trim() || 'Unnamed player';
    const secondaryRaw = String(p?.player_name_secondary ?? '').trim();
    const secondary = secondaryRaw || null;
    const label = secondary ? `${primary} (${secondary})` : primary;
    const token = (labelCount.get(label) ?? 0) > 1 ? `${label} · ${id.slice(0, 8)}` : label;
    playerMetaById.set(id, { primary, secondary, label, token });
    tokenToPlayerId.set(token, id);
    tokenByPlayerId.set(id, token);
    playerOptions.push({ id, label, token });
  }

  const penaltyPlayers = (() => {
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const r of data.results ?? []) {
      const id = String(r?.player_id ?? '').trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
    return ids.map((id) => ({ id, label: playerMetaById.get(id)?.label ?? id.slice(0, 8) }));
  })();

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
  let seatPlayerText: Record<Seat, string> = {
    E: tokenByPlayerId.get(String(bySeat.E?.player_id ?? '').trim()) ?? '',
    S: tokenByPlayerId.get(String(bySeat.S?.player_id ?? '').trim()) ?? '',
    W: tokenByPlayerId.get(String(bySeat.W?.player_id ?? '').trim()) ?? '',
    N: tokenByPlayerId.get(String(bySeat.N?.player_id ?? '').trim()) ?? ''
  };

  function asNum(v: unknown, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function setSeatPlayerFromToken(seat: Seat, token: string) {
    seatPlayerText = { ...seatPlayerText, [seat]: token };
    const selectedId = tokenToPlayerId.get(token.trim()) ?? '';
    entries = entries.map((row) =>
      row.seat === seat
        ? { ...row, player_id: selectedId }
        : row
    );
  }

  function playerNameParts(player_id: string) {
    const meta = playerMetaById.get(player_id);
    if (meta) return { primary: meta.primary, secondary: meta.secondary };
    if (!player_id) return { primary: '—', secondary: null as string | null };
    return { primary: player_id.slice(0, 8), secondary: null as string | null };
  }

  function ratingState(player_id: string) {
    return lifetimeRatingByPlayer.get(player_id) ?? { rate: 1500, games_played: 0 };
  }

  function toggleConfirm(action: Exclude<ConfirmAction, null>) {
    confirmAction = confirmAction === action ? null : action;
  }

  function closeConfirm() {
    confirmAction = null;
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
  $: startPoints = asNum(data.ruleset?.start_points, 25000);
  $: targetTotalWithNoLeak = startPoints * 4;
  $: extraPointsValue = asNum(extra_sticks, asNum(match.extra_sticks, 0));
  $: totalWithExtra = rawTotal + extraPointsValue;
  $: totalDiff = targetTotalWithNoLeak - totalWithExtra;
  $: totalCheckOk = totalDiff === 0;

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
      const player = playerNameParts(row.player_id);
      return {
        ...row,
        player_name_primary: player.primary,
        player_name_secondary: player.secondary,
        placement,
        display_placement: displayPlacement,
        expected_club: expectedClub,
        old_rate: null,
        expected_r_delta: null,
        expected_new_rate: null
      };
    }

    const rating = ratingState(row.player_id);
    const player = playerNameParts(row.player_id);
    const delta =
      gamesAdjustment(rating.games_played) * (placeBasePoints(placement) + (avgRate - rating.rate) / 40);

    return {
      ...row,
      player_name_primary: player.primary,
      player_name_secondary: player.secondary,
      placement,
      display_placement: displayPlacement,
      expected_club: expectedClub,
      old_rate: rating.rate,
      expected_r_delta: delta,
      expected_new_rate: rating.rate + delta
    };
  });
</script>

<style>
  .result-entry-row {
    display: grid;
    grid-template-columns: minmax(260px, 1fr) 160px;
    gap: 10px;
    align-items: center;
    width: 100%;
  }

  .player-picker-wrap {
    position: relative;
    min-width: 0;
  }

  .player-picker-wrap::before {
    content: '⌕';
    position: absolute;
    left: 11px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--muted);
    pointer-events: none;
    font-size: 0.92rem;
  }

  .player-picker-input {
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
    padding-left: 30px;
    padding-right: 34px;
    background:
      linear-gradient(45deg, transparent 50%, var(--muted) 50%) calc(100% - 16px) calc(50% - 1px) / 6px 6px no-repeat,
      linear-gradient(135deg, var(--muted) 50%, transparent 50%) calc(100% - 12px) calc(50% - 1px) / 6px 6px no-repeat,
      var(--field-bg);
  }

  .player-picker-input:focus {
    border-color: var(--btn-primary-bg);
    outline: none;
  }

  .confirm-anchor {
    position: relative;
    display: inline-flex;
  }

  .confirm-popover {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: 30;
    min-width: 220px;
    padding: 10px;
    border-radius: 10px;
    border: 1px solid rgba(0, 0, 0, 0.14);
    background: var(--field-bg, #fff);
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.12);
    display: grid;
    gap: 8px;
  }

  .confirm-popover.align-left {
    left: 0;
    right: auto;
  }

  .confirm-popover-text {
    font-size: 0.86rem;
    line-height: 1.3;
  }

  .confirm-popover-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    flex-wrap: wrap;
  }

  @media (max-width: 720px) {
    .result-entry-row {
      grid-template-columns: 1fr;
    }
  }
</style>

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
      <form method="POST" action="?/deleteGame" on:submit={() => closeConfirm()}>
        <div class="confirm-anchor">
          <button class="btn" type="button" on:click={() => toggleConfirm('delete')}>Delete game</button>
          {#if confirmAction === 'delete'}
            <div class="confirm-popover" role="dialog" aria-label="Confirm delete game">
              <div class="confirm-popover-text">Delete this game? This cannot be undone.</div>
              <div class="confirm-popover-actions">
                <button class="btn" type="button" on:click={closeConfirm}>Cancel</button>
                <button class="btn" type="submit">Delete</button>
              </div>
            </div>
          {/if}
        </div>
      </form>
    </div>
  </div>
</div>

{#if form?.message}
  <div class="card alert alert-success">
    {form.message}
  </div>
{/if}

<div class="card" style="margin-bottom:12px;">
  <div style="font-size:1.05rem; font-weight:650;">Match metadata</div>
  <div class="muted">Game # / table label are auto-generated. Times are Arizona (MST).</div>

  <form method="POST" action="?/saveMatchMeta" style="display:grid; gap:10px; margin-top:12px;">
    <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:end;">
      <div style="display:grid; gap:4px;">
        <label for="played_at">Played at (Arizona)</label>
        <input id="played_at" name="played_at" type="datetime-local" bind:value={played_at} required />
      </div>

      <div style="display:grid; gap:4px;">
        <label for="table_mode">Table type</label>
        <select id="table_mode" name="table_mode" bind:value={table_mode} style="width:110px;">
          <option value="A">A</option>
          <option value="M">M</option>
        </select>
      </div>

      <div style="display:grid; gap:4px;">
        <label for="extra_sticks">Extra points</label>
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

    <form method="POST" action="?/saveResults" style="display:grid; gap:10px; margin-top:12px;">
      {#each entries as row, i (row.seat)}
        <div class="card" style="border-radius:14px;">
          <div class="muted" style="margin-bottom:6px;">Seat {row.seat}</div>
          <div class="result-entry-row">
            <input type="hidden" name={`p_${row.seat}`} value={entries[i].player_id} />
            <div class="player-picker-wrap">
              <input
                class="player-picker-input"
                list="result-entry-player-options"
                value={seatPlayerText[row.seat]}
                on:input={(e) => setSeatPlayerFromToken(row.seat, (e.currentTarget as HTMLInputElement).value)}
                placeholder="Search and select player"
                required
              />
            </div>
            <input
              name={`raw_${row.seat}`}
              type="number"
              step="100"
              bind:value={entries[i].raw_points}
              style="width:130px; justify-self:start;"
            />
          </div>
        </div>
      {/each}
      <datalist id="result-entry-player-options">
        {#each playerOptions as p}
          <option value={p.token}></option>
        {/each}
      </datalist>

      {#if !isFinal}
        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <button class="btn primary" type="submit" on:click={closeConfirm}>Save results</button>
          <div class="confirm-anchor">
            <button class="btn" type="button" on:click={() => toggleConfirm('finalize')}>Finalize match</button>
            {#if confirmAction === 'finalize'}
              <div class="confirm-popover align-left" role="dialog" aria-label="Confirm finalize match">
                <div class="confirm-popover-text">Finalize this match and publish results?</div>
                <div class="confirm-popover-actions">
                  <button class="btn" type="button" on:click={closeConfirm}>Cancel</button>
                  <button
                    class="btn"
                    type="submit"
                    formmethod="POST"
                    formaction="?/finalize"
                    on:click={closeConfirm}
                  >
                    Finalize
                  </button>
                </div>
              </div>
            {/if}
          </div>
        </div>
      {:else}
        <div class="muted">This match is finalized & published, and cannot be edited.</div>
      {/if}
    </form>

    <div style="margin-top:14px;">
      <div style="font-size:1.02rem; font-weight:650;">Expected outcomes</div>

      <div style="margin-top:10px; overflow:auto;">
        <table>
          <thead>
            <tr>
              <th style="width:70px;">Seat</th>
              <th>Player</th>
              <th style="width:120px;">Raw</th>
              <th style="width:90px;">Place</th>
              <th style="width:130px;">SP Δ</th>
              <th style="width:120px;">ΔR</th>
              <th style="width:130px;">New R</th>
            </tr>
          </thead>
          <tbody>
            {#each expectedRows as row}
              <tr>
                <td>{row.seat}</td>
                <td>
                  {row.player_name_primary}
                  {#if row.player_name_secondary}
                    <span class="muted" style="margin-left:6px;">({row.player_name_secondary})</span>
                  {/if}
                </td>
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
        <div class="muted" style="margin-top:8px;">Pick 4 distinct players to preview SP and R changes</div>
      {/if}
    </div>
  </div>

  <div class="card">
    <div style="font-size:1.05rem; font-weight:650;">Point check</div>

    <div style="margin-top:12px; display:grid; gap:10px;">
      <div class="card" style="border-radius:14px;">
        <div class="muted">Raw total</div>
        <div style="font-size:1.2rem; font-weight:700;">{rawTotal}</div>
      </div>

      <div
        class="card"
        style={`border-radius:14px; border-color:${totalCheckOk ? 'var(--alert-success-border)' : 'var(--alert-warning-border)'}; background:${totalCheckOk ? 'var(--alert-success-bg)' : 'var(--alert-warning-bg)'}; color:${totalCheckOk ? 'var(--alert-success-text)' : 'var(--alert-warning-text)'};`}
      >
        <div style="font-weight:650; margin-bottom:4px;">
          {#if totalCheckOk}
            Point total check: OK
          {:else}
            Point total check: mismatch
          {/if}
        </div>
        <div class="muted" style="color:inherit;">
          4 × start points ({startPoints}) = {targetTotalWithNoLeak}
        </div>
        <div class="muted" style="color:inherit;">
          Raw total + extra points = {rawTotal} + {extraPointsValue} = {totalWithExtra}
        </div>
        {#if !totalCheckOk}
          <div style="margin-top:4px; font-weight:600;">
            Difference: {totalDiff > 0 ? '+' : ''}{totalDiff}
          </div>
        {/if}
      </div>

      <details class="card" style="border-radius:14px;">
        <summary style="cursor:pointer; font-weight:650;">Penalties / Chombo ({data.penalties.length})</summary>
        <div class="muted" style="margin-top:8px;">
          Penalties adjust Season Points (SP) only. They do not change Rating (R)
        </div>

        <form method="POST" action="?/addPenalty" style="display:grid; gap:10px; margin-top:10px;">
          <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:end;">
            <div style="display:grid; gap:4px;">
              <label for="penalty_player">Player</label>
              <select id="penalty_player" name="player_id" required style="min-width:220px;">
                {#if penaltyPlayers.length === 0}
                  <option value="" disabled selected>Enter and save results first</option>
                {:else}
                  <option value="" disabled selected>Select player</option>
                  {#each penaltyPlayers as p}
                    <option value={p.id}>{p.label}</option>
                  {/each}
                {/if}
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

            <button class="btn" type="submit" disabled={penaltyPlayers.length === 0}>Add penalty</button>
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
                <tr><td colspan="5" class="muted">No penalties added</td></tr>
              {/if}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  </div>
</div>
