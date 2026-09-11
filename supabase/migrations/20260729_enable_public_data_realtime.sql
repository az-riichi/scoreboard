-- Broadcast public snapshot invalidations through Supabase Realtime.
do $$
begin
  if not exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    create publication supabase_realtime;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'public_data_revision'
  ) then
    alter publication supabase_realtime add table public.public_data_revision;
  end if;
end;
$$;
