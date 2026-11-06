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

<div class="card card-head" style="margin-bottom:12px;">
  <div>
    <div class="title-row">
      <span class="led-tag" lang="ja" aria-hidden="true">管理</span>
      <h1 class="page-title">Admin</h1>
    </div>
  </div>
  <div style="display:flex; gap:10px; flex-wrap:wrap;">
    {#if canManageSeasons}
      <a class="btn" href="/admin/seasons">Seasons</a>
    {/if}
    {#if canManagePlayers}
      <a class="btn" href="/admin/players">Players</a>
    {/if}
    {#if hasAdminPermission(access, 'manage_discipline')}
      <a class="btn" href="/admin/discipline">Discipline</a>
    {/if}
    {#if hasAdminPermission(access, 'manage_permissions')}
      <a class="btn" href="/admin/permissions">Permissions</a>
    {/if}
    {#if canManageMatches}
      <a class="btn primary" href="/admin/matches">Matches</a>
    {/if}
  </div>
</div>

{#if canAddMatches}
  <div class="card">
    <h2 class="card-title">Draft matches</h2>
    <div class="muted" style="margin-top:4px;">Matches not yet finalized (not public)</div>

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
              <td class="num"><a class="btn" href={`/admin/match/${m.id}`}>Open</a></td>
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
