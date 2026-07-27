import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
  PLAYER_PROFILE_MEDIA_URL_MAX_CHARS,
  PLAYER_PROFILE_MESSAGE_MAX_CHARS,
  classifyPlayerProfileMedia,
  normalizePlayerProfileMediaUrlInput,
  normalizePlayerProfileMessageInput
} from '$lib/player-profile-content';

function asText(value: unknown) {
  return String(value ?? '').trim();
}

function asBool(value: unknown) {
  return String(value ?? '') === 'on';
}

// Public profile data comes from the browser's redacted snapshot. This loader
// only resolves private editable name values for the signed-in owner.
export const load: PageServerLoad = async ({ locals, params }) => {
  if (!locals.userId) return { canEditDisplay: false, editablePlayer: null };

  const ownership = await locals.supabase
    .from('player_accounts')
    .select('player_id')
    .eq('auth_user_id', locals.userId)
    .eq('player_id', params.player_id)
    .maybeSingle();
  if (ownership.error || !ownership.data) {
    return { canEditDisplay: false, editablePlayer: null };
  }

  const player = await locals.supabase
    .from('players')
    .select('id, display_name, real_first_name, real_last_name')
    .eq('id', params.player_id)
    .maybeSingle();

  return {
    canEditDisplay: !player.error && !!player.data,
    editablePlayer: player.error ? null : player.data
  };
};

export const actions: Actions = {
  updateDisplay: async ({ request, locals, params }) => {
    if (!locals.userId || !locals.user) {
      return fail(401, { ok: false, message: 'Sign in to update player settings.' });
    }

    const ownershipRes = await locals.supabase
      .from('player_accounts')
      .select('player_id')
      .eq('auth_user_id', locals.userId)
      .eq('player_id', params.player_id)
      .maybeSingle();
    if (ownershipRes.error || !ownershipRes.data) {
      return fail(403, { ok: false, message: 'You can only update your own linked player profile.' });
    }

    const form = await request.formData();
    const display_name = asText(form.get('display_name')) || null;
    const real_first_name = asText(form.get('real_first_name')) || null;
    const real_last_name = asText(form.get('real_last_name')) || null;
    const show_display_name = asBool(form.get('show_display_name'));
    const show_real_first_name = asBool(form.get('show_real_first_name'));
    const show_real_last_name = asBool(form.get('show_real_last_name'));
    const profile_message_md = normalizePlayerProfileMessageInput(form.get('profile_message_md'));
    const raw_profile_media_url = String(form.get('profile_media_url') ?? '').trim();

    if (profile_message_md && profile_message_md.length > PLAYER_PROFILE_MESSAGE_MAX_CHARS) {
      return fail(400, {
        ok: false,
        message: `Custom message is too long (max ${PLAYER_PROFILE_MESSAGE_MAX_CHARS} characters).`
      });
    }
    if (raw_profile_media_url.length > PLAYER_PROFILE_MEDIA_URL_MAX_CHARS) {
      return fail(400, {
        ok: false,
        message: `Media URL is too long (max ${PLAYER_PROFILE_MEDIA_URL_MAX_CHARS} characters).`
      });
    }

    const profile_media_url = normalizePlayerProfileMediaUrlInput(raw_profile_media_url);
    if (raw_profile_media_url && !profile_media_url) {
      return fail(400, {
        ok: false,
        message: 'Media URL must be a valid http(s) URL.'
      });
    }
    if (profile_media_url && !classifyPlayerProfileMedia(profile_media_url)) {
      return fail(400, {
        ok: false,
        message: 'Media URL must be a direct image/video file or a YouTube link.'
      });
    }

    if (!display_name && !real_first_name) {
      return fail(400, { ok: false, message: 'Provide at least Display name or Real first name.' });
    }
    if (!show_display_name && !show_real_first_name) {
      return fail(400, { ok: false, message: 'Enable at least Display name or Real first name.' });
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

    const updateRes = await locals.supabase.rpc('update_my_player_profile', {
      p_display_name: display_name,
      p_real_first_name: real_first_name,
      p_real_last_name: real_last_name,
      p_show_display_name: show_display_name,
      p_show_real_first_name: show_real_first_name,
      p_show_real_last_name: show_real_last_name,
      p_profile_message_md: profile_message_md,
      p_profile_media_url: profile_media_url
    });

    if (updateRes.error) return fail(400, { ok: false, message: updateRes.error.message });
    if (!updateRes.data || String(updateRes.data) !== params.player_id) {
      return fail(403, { ok: false, message: 'You can only update your own linked player profile.' });
    }

    return { ok: true, message: 'Player profile settings updated.' };
  }
};
