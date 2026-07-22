-- Player-customizable public profile content (sanitized in app layer):
-- - markdown message
-- - optional image/video/YouTube URL

alter table if exists public.players add column if not exists profile_message_md text;
alter table if exists public.players add column if not exists profile_media_url text;

create or replace function public.update_my_player_profile(
  p_display_name text default null,
  p_real_first_name text default null,
  p_real_last_name text default null,
  p_show_display_name boolean default true,
  p_show_real_first_name boolean default false,
  p_show_real_last_name boolean default false,
  p_profile_message_md text default null,
  p_profile_media_url text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player_id uuid;
begin
  select pa.player_id
  into v_player_id
  from public.player_accounts pa
  where pa.auth_user_id = auth.uid();

  if v_player_id is null then
    raise exception 'player account not linked';
  end if;

  update public.players
  set
    display_name = nullif(trim(p_display_name), ''),
    real_first_name = nullif(trim(p_real_first_name), ''),
    real_last_name = nullif(trim(p_real_last_name), ''),
    show_display_name = coalesce(p_show_display_name, false),
    show_real_first_name = coalesce(p_show_real_first_name, false),
    show_real_last_name = coalesce(p_show_real_last_name, false),
    profile_message_md = nullif(trim(p_profile_message_md), ''),
    profile_media_url = nullif(trim(p_profile_media_url), '')
  where id = v_player_id;

  return v_player_id;
end;
$$;

revoke all on function public.update_my_player_profile(text, text, text, boolean, boolean, boolean, text, text) from public;
grant execute on function public.update_my_player_profile(text, text, text, boolean, boolean, boolean, text, text) to authenticated;
