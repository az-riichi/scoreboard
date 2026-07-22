-- Revert public self-claim RPC; player-account linking is admin-managed.
drop function if exists public.claim_my_player(uuid);
