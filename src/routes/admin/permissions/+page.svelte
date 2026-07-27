<script lang="ts">
  import {
    ADMIN_PERMISSION_DEFINITIONS,
    normalizeAdminPermissions,
    type AdminPermission,
    type AdminRole
  } from '$lib/permissions';

  type Profile = {
    id: string;
    email: string | null;
    admin_role: string | null;
    admin_permissions: unknown;
  };

  export let data: any;
  export let form: any;

  const permissionGroups = Array.from(
    new Set(ADMIN_PERMISSION_DEFINITIONS.map((permission) => permission.group))
  ).map((group) => ({
    name: group,
    permissions: ADMIN_PERMISSION_DEFINITIONS.filter((permission) => permission.group === group)
  }));

  function role(profile: Profile): AdminRole {
    switch (profile.admin_role) {
      case 'owner':
      case 'super_admin':
      case 'admin':
        return profile.admin_role;
      default:
        return 'user';
    }
  }

  function roleLabel(profile: Profile) {
    switch (role(profile)) {
      case 'owner':
        return 'Owner';
      case 'super_admin':
        return 'Super admin';
      case 'admin':
        return 'Admin';
      default:
        return 'User';
    }
  }

  function hasStoredPermission(profile: Profile, permission: AdminPermission) {
    return normalizeAdminPermissions(profile.admin_permissions).includes(permission);
  }

  function isSelf(profile: Profile) {
    return profile.id === data.currentUserId;
  }

  function isReadOnly(profile: Profile) {
    return (
      isSelf(profile) ||
      role(profile) === 'owner' ||
      (!data.actorIsOwner && role(profile) === 'super_admin')
    );
  }

  function readOnlyReason(profile: Profile) {
    if (isSelf(profile)) return 'You cannot edit your own access.';
    if (role(profile) === 'super_admin') return 'Only the owner can change a super admin.';
    return 'Owner access is read-only and cannot be changed here.';
  }
</script>

<svelte:head>
  <title>Admin permissions</title>
</svelte:head>

<div class="card page-heading">
  <div>
    <div class="heading-title">Permissions</div>
    <div class="muted">Grant administrative tools to individual accounts</div>
  </div>
  <a class="btn" href="/admin" style="text-decoration:none;">Back</a>
</div>

{#if !data.hasOwner}
  <div class="card alert alert-error owner-notice" role="alert">
    <strong>No owner is configured.</strong>
    Super-admin status cannot be granted or revoked from this page until an owner is assigned
    directly in the database.
  </div>
{:else if !data.actorIsOwner}
  <div class="card owner-notice">
    <strong>Super-admin access is owner-managed.</strong>
    <span class="muted">You can update ordinary permissions, but only the owner can grant or revoke super-admin status.</span>
  </div>
{/if}

{#if form?.message}
  <div
    class="card alert action-message"
    class:alert-success={form.ok !== false}
    class:alert-error={form.ok === false}
    role="status"
  >
    {form.message}
  </div>
{/if}

<div class="account-list">
  {#each data.profiles as profile (profile.id)}
    <form class="card account-card" method="POST" action="?/setAccess">
      <input type="hidden" name="target_user_id" value={profile.id} />

      <div class="account-heading">
        <div class="account-identity">
          <div class="account-email">{profile.email ?? 'No email address'}</div>
          <div class="muted account-id">{profile.id}</div>
        </div>
        <span class:role-owner={role(profile) === 'owner'} class:role-super={role(profile) === 'super_admin'} class:role-admin={role(profile) === 'admin'} class="role-badge">
          {roleLabel(profile)}
        </span>
      </div>

      {#if role(profile) === 'owner' || role(profile) === 'super_admin'}
        <p class="muted access-note">
          This role automatically has every ordinary permission.
        </p>
      {/if}

      {#if isReadOnly(profile)}
        <div class="readonly-note">{readOnlyReason(profile)}</div>
      {/if}

      <div class="permission-groups">
        {#each permissionGroups as group}
          <fieldset class="permission-group" disabled={isReadOnly(profile)}>
            <legend>{group.name}</legend>
            <div class="permission-options">
              {#each group.permissions as permission}
                <label class="permission-option">
                  <input
                    type="checkbox"
                    name="permissions"
                    value={permission.key}
                    checked={hasStoredPermission(profile, permission.key)}
                  />
                  <span>
                    <span class="permission-label">{permission.label}</span>
                    <span class="muted permission-description">{permission.description}</span>
                  </span>
                </label>
              {/each}
            </div>
          </fieldset>
        {/each}
      </div>

      {#if data.actorIsOwner}
        <label class="super-option">
          <input
            type="checkbox"
            name="super_admin"
            checked={role(profile) === 'super_admin' || role(profile) === 'owner'}
            disabled={isReadOnly(profile)}
          />
          <span>
            <span class="permission-label">Super admin</span>
            <span class="muted permission-description">
              Grants every ordinary permission. Only the owner can change this setting.
            </span>
          </span>
        </label>
      {/if}

      {#if !isReadOnly(profile)}
        <div class="account-actions">
          <button class="btn primary" type="submit">Save access</button>
        </div>
      {/if}
    </form>
  {/each}

  {#if data.profiles.length === 0}
    <div class="card muted">No accounts were found.</div>
  {/if}
</div>

<style>
  .page-heading {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    align-items: end;
    margin-bottom: 12px;
  }

  .heading-title {
    font-size: 1.1rem;
    font-weight: 650;
  }

  .owner-notice,
  .action-message {
    margin-bottom: 12px;
  }

  .owner-notice {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .account-list {
    display: grid;
    gap: 12px;
  }

  .account-card {
    display: grid;
    gap: 16px;
  }

  .account-heading {
    display: flex;
    align-items: start;
    justify-content: space-between;
    gap: 12px;
  }

  .account-identity {
    min-width: 0;
  }

  .account-email {
    font-size: 1.05rem;
    font-weight: 650;
    overflow-wrap: anywhere;
  }

  .account-id {
    margin-top: 2px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.78rem;
    overflow-wrap: anywhere;
  }

  .role-badge {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    min-height: 26px;
    padding: 3px 9px;
    border: 1px solid var(--card-border);
    border-radius: 999px;
    background: var(--card-bg);
    color: var(--muted);
    font-size: 0.78rem;
    font-weight: 700;
    letter-spacing: 0.02em;
  }

  .role-admin {
    border-color: var(--alert-success-border);
    background: var(--alert-success-bg);
    color: var(--alert-success-text);
  }

  .role-super {
    border-color: var(--alert-warning-border);
    background: var(--alert-warning-bg);
    color: var(--alert-warning-text);
  }

  .role-owner {
    border-color: var(--btn-primary-bg);
    background: var(--btn-primary-bg);
    color: var(--btn-primary-text);
  }

  .access-note {
    margin: -8px 0 0;
  }

  .readonly-note {
    padding: 9px 11px;
    border: 1px solid var(--card-border);
    border-radius: 10px;
    background: var(--bg);
    font-size: 0.9rem;
    font-weight: 600;
  }

  .permission-groups {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }

  .permission-group {
    min-width: 0;
    margin: 0;
    padding: 12px;
    border: 1px solid var(--card-border);
    border-radius: 12px;
  }

  .permission-group legend {
    padding: 0 6px;
    font-size: 0.9rem;
    font-weight: 700;
  }

  .permission-options {
    display: grid;
    gap: 12px;
  }

  .permission-option,
  .super-option {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 9px;
    align-items: start;
    cursor: pointer;
  }

  .permission-option input,
  .super-option input {
    margin-top: 3px;
  }

  .permission-label,
  .permission-description {
    display: block;
  }

  .permission-label {
    font-weight: 650;
  }

  .permission-description {
    margin-top: 2px;
    font-size: 0.83rem;
    line-height: 1.35;
  }

  fieldset:disabled .permission-option,
  .super-option:has(input:disabled) {
    cursor: default;
    opacity: 0.72;
  }

  .super-option {
    padding: 12px;
    border: 1px solid var(--alert-warning-border);
    border-radius: 12px;
    background: var(--alert-warning-bg);
  }

  .account-actions {
    display: flex;
    justify-content: flex-end;
  }

  @media (max-width: 760px) {
    .permission-groups {
      grid-template-columns: 1fr;
    }
  }
</style>
