import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireAdminPermission, requireAnyAdminPermission } from '$lib/server/admin';
import { hasAdminPermission, PLAYER_PERMISSIONS } from '$lib/permissions';
import { composeSeasonNameParts } from '$lib/player-name';

function asText(value: unknown) {
  return String(value ?? '').trim();
}

function asBool(value: unknown) {
  return String(value ?? '') === 'on';
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function asUuid(value: unknown) {
  const text = asText(value);
  return UUID_RE.test(text) ? text : null;
}

export const load: PageServerLoad = async ({ locals, url }) => {
  const adminAccess = await requireAnyAdminPermission(locals, PLAYER_PERMISSIONS);
  const canManagePlayerAccounts = hasAdminPermission(adminAccess, 'manage_player_accounts');
  const canOpenEditor =
    hasAdminPermission(adminAccess, 'edit_players') || canManagePlayerAccounts;

  const playersPromise = locals.supabase
    .from('players')
    .select(
      'id, display_name, real_first_name, real_last_name, show_display_name, show_real_first_name, show_real_last_name, is_active, created_at'
    )
    .order('created_at', { ascending: false });
  const accountDataPromise = canManagePlayerAccounts
    ? Promise.all([
        locals.supabase
          .from('profiles')
          .select('id, email, admin_role, created_at')
          .order('created_at', { ascending: false }),
        locals.supabase.from('player_accounts').select('auth_user_id, player_id, created_at')
      ])
    : Promise.resolve(null);

  const [playersRes, accountData] = await Promise.all([
    playersPromise,
    accountDataPromise
  ]);
  const profilesRes = accountData?.[0] ?? null;
  const linksRes = accountData?.[1] ?? null;

  const profiles =
    !profilesRes || profilesRes.error
      ? []
      : (profilesRes.data ?? [])
          .map((p) => ({
            id: p.id,
            email: asText((p as { email?: unknown }).email) || null,
            is_admin:
              p.admin_role === 'admin' ||
              p.admin_role === 'super_admin' ||
              p.admin_role === 'owner',
            created_at: p.created_at
          }))
          .sort((a, b) => {
            const aLabel = (a.email ?? '').toLowerCase();
            const bLabel = (b.email ?? '').toLowerCase();
            const labelCmp = aLabel.localeCompare(bLabel);
            if (labelCmp !== 0) return labelCmp;
            return a.id.localeCompare(b.id);
          });

  const profileById = new Map(profiles.map((p) => [p.id, p] as const));
  const linkByPlayerId = new Map(
    (!linksRes || linksRes.error ? [] : (linksRes.data ?? [])).map((row) => [
      String(row.player_id),
      String(row.auth_user_id)
    ] as const)
  );

  const players =
    playersRes.error
      ? []
      : (playersRes.data ?? [])
          .map((p) => {
            const nameParts = composeSeasonNameParts(p);
            const linkedAuthUserId = linkByPlayerId.get(String(p.id)) ?? null;
            const linkedProfile = linkedAuthUserId ? profileById.get(linkedAuthUserId) ?? null : null;
            return {
              ...p,
              linked_auth_user_id: linkedAuthUserId,
              linked_profile_email: linkedProfile?.email ?? null,
              linked_profile_is_admin: linkedProfile?.is_admin ?? false,
              public_name_primary: nameParts.primary,
              public_name_secondary: nameParts.secondary
            };
          })
          .sort((a, b) => {
            const primaryCmp = a.public_name_primary.localeCompare(b.public_name_primary);
            if (primaryCmp !== 0) return primaryCmp;
            return String(a.public_name_secondary ?? '').localeCompare(String(b.public_name_secondary ?? ''));
          });

  const editIdRaw = asText(url.searchParams.get('edit'));
  const editId =
    canOpenEditor && editIdRaw && players.some((p) => p.id === editIdRaw)
      ? editIdRaw
      : null;

  return {
    players,
    profiles,
    editId
  };
};

export const actions: Actions = {
  create: async ({ request, locals }) => {
    await requireAdminPermission(locals, 'add_players');
    const f = await request.formData();
    const display_name = asText(f.get('display_name')) || null;
    const real_first_name = asText(f.get('real_first_name')) || null;
    const real_last_name = asText(f.get('real_last_name')) || null;

    const show_display_name = asBool(f.get('show_display_name'));
    const show_real_first_name = asBool(f.get('show_real_first_name'));
    const show_real_last_name = asBool(f.get('show_real_last_name'));

    if (!display_name && !real_first_name) {
      return fail(400, { ok: false, message: 'Provide at least Display name or Real first name.' });
    }
    if (!show_display_name && !show_real_first_name) {
      return fail(400, { ok: false, message: 'Enable at least one display option: Display name or Real first name.' });
    }
    if (show_display_name && !display_name) {
      return fail(400, { ok: false, message: 'Display name is enabled but empty.' });
    }
    if (show_real_first_name && !real_first_name) {
      return fail(400, { ok: false, message: 'Real first name is enabled but empty.' });
    }
    if (show_real_last_name && !real_last_name) {
      return fail(400, { ok: false, message: 'Real last name is enabled but empty.' });
    }

    const { error } = await locals.supabase.from('players').insert({
      display_name,
      real_first_name,
      real_last_name,
      show_display_name,
      show_real_first_name,
      show_real_last_name
    });
    if (error) return fail(400, { ok: false, message: error.message });

    return { ok: true, message: 'Player created.' };
  },

  update: async ({ request, locals }) => {
    await requireAdminPermission(locals, 'edit_players');
    const f = await request.formData();

    const player_id = asText(f.get('player_id'));
    const display_name = asText(f.get('display_name')) || null;
    const real_first_name = asText(f.get('real_first_name')) || null;
    const real_last_name = asText(f.get('real_last_name')) || null;

    const show_display_name = asBool(f.get('show_display_name'));
    const show_real_first_name = asBool(f.get('show_real_first_name'));
    const show_real_last_name = asBool(f.get('show_real_last_name'));

    if (!player_id) return fail(400, { ok: false, message: 'Missing player id.' });

    if (!display_name && !real_first_name) {
      return fail(400, { ok: false, message: 'Provide at least Display name or Real first name.', edit_id: player_id });
    }
    if (!show_display_name && !show_real_first_name) {
      return fail(400, {
        ok: false,
        message: 'Enable at least one display option: Display name or Real first name.',
        edit_id: player_id
      });
    }
    if (show_display_name && !display_name) {
      return fail(400, { ok: false, message: 'Display name is enabled but empty.', edit_id: player_id });
    }
    if (show_real_first_name && !real_first_name) {
      return fail(400, { ok: false, message: 'Real first name is enabled but empty.', edit_id: player_id });
    }
    if (show_real_last_name && !real_last_name) {
      return fail(400, { ok: false, message: 'Real last name is enabled but empty.', edit_id: player_id });
    }

    const { error } = await locals.supabase
      .from('players')
      .update({
        display_name,
        real_first_name,
        real_last_name,
        show_display_name,
        show_real_first_name,
        show_real_last_name
      })
      .eq('id', player_id);

    if (error) return fail(400, { ok: false, message: error.message, edit_id: player_id });

    return { ok: true, message: 'Player updated.', edit_id: player_id };
  },

  setActive: async ({ request, locals }) => {
    await requireAdminPermission(locals, 'remove_players');
    const f = await request.formData();

    const player_id = asUuid(f.get('player_id'));
    const isActiveRaw = asText(f.get('is_active'));

    if (!player_id) return fail(400, { ok: false, message: 'Invalid player id.' });
    if (isActiveRaw !== 'true' && isActiveRaw !== 'false') {
      return fail(400, { ok: false, message: 'Invalid active status.' });
    }

    const is_active = isActiveRaw === 'true';
    const activeRes = await locals.supabase.rpc('set_player_active', {
      p_player_id: player_id,
      p_is_active: is_active
    });
    if (activeRes.error) {
      return fail(400, { ok: false, message: activeRes.error.message });
    }

    return {
      ok: true,
      message: is_active ? 'Player reactivated.' : 'Player deactivated.'
    };
  },

  setClaim: async ({ request, locals }) => {
    await requireAdminPermission(locals, 'manage_player_accounts');
    const f = await request.formData();

    const player_id = asUuid(f.get('player_id'));
    const auth_user_id_raw = asText(f.get('auth_user_id'));
    const auth_user_id = auth_user_id_raw ? asUuid(auth_user_id_raw) : null;

    if (!player_id) return fail(400, { ok: false, message: 'Invalid player id' });
    if (auth_user_id_raw && !auth_user_id) {
      return fail(400, { ok: false, message: 'Invalid account id.', edit_id: player_id });
    }

    const linkRes = await locals.supabase.rpc('set_player_account_link_authorized', {
      p_player_id: player_id,
      p_auth_user_id: auth_user_id
    });
    if (linkRes.error) return fail(400, { ok: false, message: linkRes.error.message, edit_id: player_id });

    return {
      ok: true,
      message: auth_user_id ? 'Player linked to account' : 'Player account link removed',
      edit_id: player_id
    };
  }
};
