<script lang="ts">
  import { clickableRow } from '$lib/clickable-row';
  import { fmtDateTimeArizona as fmtDateTime } from '$lib/arizona-time';
  import {
    hasAdminPermission,
    hasAnyAdminPermission,
    PLAYER_PERMISSIONS
  } from '$lib/permissions';
  export let data: any;

  $: access = data.adminAccess;
  $: canManageSeasons =
    hasAdminPermission(access, 'manage_seasons') ||
    hasAdminPermission(access, 'import_matches');
  $: canManagePlayers = hasAnyAdminPermission(access, PLAYER_PERMISSIONS);
  $: canManageMatches = hasAnyAdminPermission(access, [
    'add_matches',
    'remove_matches',
    'manage_match_penalties',
    'recompute_ratings'
  ]);
  $: canAddMatches = hasAdminPermission(access, 'add_matches');
</script>

<div class="card" style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; align-items:end; margin-bottom:12px;">
  <div>
    <div style="font-size:1.1rem; font-weight:650;">Admin</div>
    <div class="muted">The tools available to your account are shown below</div>
  </div>
  <div style="display:flex; gap:10px; flex-wrap:wrap;">
    {#if canManageSeasons}
      <a class="btn" href="/admin/seasons" style="text-decoration:none;">Seasons</a>
    {/if}
    {#if canManagePlayers}
      <a class="btn" href="/admin/players" style="text-decoration:none;">Players</a>
    {/if}
    {#if hasAdminPermission(access, 'manage_discipline')}
      <a class="btn" href="/admin/discipline" style="text-decoration:none;">Discipline</a>
    {/if}
    {#if hasAdminPermission(access, 'manage_permissions')}
      <a class="btn" href="/admin/permissions" style="text-decoration:none;">Permissions</a>
    {/if}
    {#if canManageMatches}
      <a class="btn primary" href="/admin/matches" style="text-decoration:none;">Matches</a>
    {/if}
  </div>
</div>

{#if canAddMatches}
  <div class="card">
    <div style="font-size:1.05rem; font-weight:650;">Draft matches</div>
    <div class="muted">Matches not yet finalized (not public)</div>

    <div style="margin-top:12px; overflow:auto;">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Match</th>
            <th style="width:160px;"></th>
          </tr>
        </thead>
        <tbody>
          {#each data.drafts as m}
            <tr use:clickableRow={`/admin/match/${m.id}`}>
              <td>{fmtDateTime(m.played_at)}</td>
              <td>{m.table_label ?? m.id.slice(0,8)}</td>
              <td><a class="btn" href={`/admin/match/${m.id}`} style="text-decoration:none;">Open</a></td>
            </tr>
          {/each}
          {#if data.drafts.length === 0}
            <tr><td colspan="3" class="muted">No drafts</td></tr>
          {/if}
        </tbody>
      </table>
    </div>
  </div>
{/if}
