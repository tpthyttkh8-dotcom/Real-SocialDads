-- =====================================================================
-- Real SocialDads: invite links for guests
-- Run ONCE in Supabase > SQL Editor > New query > Run. Safe to re-run. No existing data is changed.
--
-- An admin taps "Invite link" next to a guest and sends them the link. The guest opens it, signs in
-- with their email as normal, and is approved automatically with all the guest's games, goals and
-- man of the match awards moved onto their new login. Each link works once and expires after 14 days.
-- =====================================================================

create table if not exists public.invites (
  token      text primary key default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  player_id  uuid not null references public.players(id) on delete cascade,
  created_by uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  used_at    timestamptz,
  used_by    uuid
);
alter table public.invites enable row level security;   -- no policies: only the functions below can touch it
revoke all on public.invites from anon, authenticated;

-- Admin only: make (or replace) the invite link token for a guest.
create or replace function public.create_invite(p_player uuid)
returns text language plpgsql security definer set search_path = public as $$
declare g public.players; t text;
begin
  if not public.is_admin() then raise exception 'Only admins can create invite links'; end if;
  select * into g from public.players where id = p_player;
  if not found then raise exception 'Guest not found'; end if;
  if g.profile_id is not null then raise exception '% already has a login', g.name; end if;
  delete from public.invites where player_id = p_player and used_at is null;
  insert into public.invites (player_id, created_by) values (p_player, auth.uid()) returning token into t;
  return t;
end $$;

-- Called by the app right after someone signs in through an invite link.
create or replace function public.claim_invite(p_token text)
returns text language plpgsql security definer set search_path = public as $$
declare
  inv public.invites;
  g public.players;
  prof public.profiles;
  t public.players;
  clash record;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;

  select * into inv from public.invites where token = p_token for update;
  if not found or inv.used_at is not null or inv.expires_at < now() then
    raise exception 'This invite link has expired or was already used. Ask for a new one.';
  end if;

  select * into g from public.players where id = inv.player_id;
  if not found or g.profile_id is not null then
    raise exception 'This invite is no longer valid. Ask for a new one.';
  end if;

  select * into prof from public.profiles where id = auth.uid();
  if not found then raise exception 'Your account is not ready yet, please try again'; end if;

  -- brand-new people take the guest's name and are approved; existing members keep their own name
  if not prof.is_approved then
    update public.profiles set display_name = g.name, name_confirmed = true, is_approved = true where id = auth.uid();
  end if;

  select * into t from public.players where profile_id = auth.uid();
  if not found then raise exception 'Your player record is missing, please try again'; end if;

  if t.id <> g.id then
    select m.played_on into clash
      from public.match_players a
      join public.match_players b on b.match_id = a.match_id
      join public.matches m on m.id = a.match_id
     where a.player_id = g.id and b.player_id = t.id
     limit 1;
    if found then raise exception 'You and % both played in the game on %, so this link cannot be used', g.name, clash.played_on; end if;

    update public.match_players set player_id  = t.id where player_id  = g.id;
    update public.motm_votes    set nominee_id = t.id where nominee_id = g.id;
    update public.matches
       set draw_rules = replace(draw_rules::text, g.id::text, t.id::text)::jsonb
     where draw_rules is not null and draw_rules::text like '%' || g.id::text || '%';
    -- inv.player_id cascades away with the guest, so mark it used first
    update public.invites set used_at = now(), used_by = auth.uid() where token = p_token;
    delete from public.players where id = g.id;
  else
    update public.invites set used_at = now(), used_by = auth.uid() where token = p_token;
  end if;

  return g.name;
end $$;

revoke execute on function public.create_invite(uuid) from public, anon;
revoke execute on function public.claim_invite(text)  from public, anon;
grant  execute on function public.create_invite(uuid) to authenticated;
grant  execute on function public.claim_invite(text)  to authenticated;
