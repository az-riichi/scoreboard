import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { ADMIN_PERMISSIONS, type AdminPermission } from '$lib/permissions';
import { requireAdminPermission } from '$lib/server/admin';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ADMIN_PERMISSION_SET = new Set<string>(ADMIN_PERMISSIONS);

function asUuid(value: FormDataEntryValue | null) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return UUID_RE.test(text) ? text : null;
}

function requestedPermissions(formData: FormData): AdminPermission[] | null {
  const values = formData.getAll('permissions');
  if (values.some((value) => typeof value !== 'string')) return null;

  const permissions = values.map((value) => String(value).trim());
  if (
    permissions.some((permission) => !ADMIN_PERMISSION_SET.has(permission)) ||
    new Set(permissions).size !== permissions.length
  ) {
    return null;
  }

  const requested = new Set(permissions);
  return ADMIN_PERMISSIONS.filter((permission) => requested.has(permission));
}

export const load: PageServerLoad = async ({ locals }) => {
  const adminAccess = await requireAdminPermission(locals, 'manage_permissions');
  const profilesRes = await locals.supabase
    .from('profiles')
    .select('id, email, admin_role, admin_permissions')
    .order('email', { ascending: true, nullsFirst: false });

  if (profilesRes.error) {
    throw error(500, `Unable to load account permissions: ${profilesRes.error.message}`);
  }

  const profiles = profilesRes.data ?? [];

  return {
    profiles,
    currentUserId: locals.userId,
    actorIsOwner: adminAccess.isOwner,
    hasOwner: profiles.some((profile) => profile.admin_role === 'owner')
  };
};

export const actions: Actions = {
  setAccess: async ({ request, locals }) => {
    const adminAccess = await requireAdminPermission(locals, 'manage_permissions');
    const formData = await request.formData();
    const targetUserId = asUuid(formData.get('target_user_id'));

    if (!targetUserId) {
      return fail(400, { ok: false, message: 'Invalid target account.' });
    }
    if (targetUserId === locals.userId) {
      return fail(403, {
        ok: false,
        message: 'You cannot change your own administrative access.',
        target_user_id: targetUserId
      });
    }

    const targetRes = await locals.supabase
      .from('profiles')
      .select('id, admin_role')
      .eq('id', targetUserId)
      .maybeSingle();

    if (targetRes.error) {
      return fail(400, {
        ok: false,
        message: targetRes.error.message,
        target_user_id: targetUserId
      });
    }
    if (!targetRes.data) {
      return fail(404, {
        ok: false,
        message: 'The target account no longer exists.',
        target_user_id: targetUserId
      });
    }
    if (targetRes.data.admin_role === 'owner') {
      return fail(403, {
        ok: false,
        message: 'Owner access is read-only and cannot be changed here.',
        target_user_id: targetUserId
      });
    }
    if (!adminAccess.isOwner && targetRes.data.admin_role === 'super_admin') {
      return fail(403, {
        ok: false,
        message: 'Only the owner can change a super admin.',
        target_user_id: targetUserId
      });
    }

    const permissions = requestedPermissions(formData);
    if (!permissions) {
      return fail(400, {
        ok: false,
        message: 'The request included an unknown or duplicate permission.',
        target_user_id: targetUserId
      });
    }

    if (!adminAccess.isOwner && formData.has('super_admin')) {
      return fail(403, {
        ok: false,
        message: 'Only the owner can grant or revoke super-admin access.',
        target_user_id: targetUserId
      });
    }

    const superAdminValue = formData.get('super_admin');
    if (
      adminAccess.isOwner &&
      superAdminValue !== null &&
      (typeof superAdminValue !== 'string' || superAdminValue !== 'on')
    ) {
      return fail(400, {
        ok: false,
        message: 'Invalid super-admin setting.',
        target_user_id: targetUserId
      });
    }

    const superAdmin = adminAccess.isOwner
      ? superAdminValue === 'on'
      : false;

    const rpcRes = await locals.supabase.rpc('set_admin_access', {
      p_target_user_id: targetUserId,
      p_permissions: permissions,
      p_super_admin: superAdmin
    });

    if (rpcRes.error) {
      return fail(400, {
        ok: false,
        message: rpcRes.error.message,
        target_user_id: targetUserId
      });
    }

    return {
      ok: true,
      message: 'Administrative access updated.',
      target_user_id: targetUserId
    };
  }
};
