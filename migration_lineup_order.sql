-- =====================================================================
-- Real SocialDads update: keep each saved line-up in the order it was drawn
-- Run this ONCE in Supabase > SQL Editor > New query > Run.
-- (Only needed if you already ran an earlier version. New installs get this from schema.sql.)
-- =====================================================================

alter table public.match_players add column if not exists slot int;

-- Best-effort fill for games saved before this update (new games get exact slots automatically).
update public.match_players mp
   set slot = x.rn
  from (select match_id, player_id,
               row_number() over (partition by match_id, team order by ctid)::int as rn
          from public.match_players) x
 where x.match_id = mp.match_id and x.player_id = mp.player_id and mp.slot is null;

create or replace function public.create_match(
  p_date date, p_format int, p_team_a uuid[], p_team_b uuid[], p_rules jsonb default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare mid uuid;
begin
  if not public.is_organiser() then raise exception 'Only organisers can draw teams'; end if;
  if p_format is null or p_format not between 5 and 8 then raise exception 'Format must be 5 to 8-a-side'; end if;
  if coalesce(array_length(p_team_a, 1), 0) <> p_format or coalesce(array_length(p_team_b, 1), 0) <> p_format then
    raise exception 'Each team needs exactly % players', p_format;
  end if;
  if (select count(distinct x) from unnest(p_team_a || p_team_b) x) <> p_format * 2 then
    raise exception 'A player appears more than once';
  end if;
  if (select count(*) from public.players where id = any (p_team_a || p_team_b)) <> p_format * 2 then
    raise exception 'Unknown player in the line-up';
  end if;
  insert into public.matches (played_on, format, draw_rules, created_by)
  values (coalesce(p_date, current_date), p_format, p_rules, auth.uid())
  returning id into mid;
  -- slot = the order players were drawn in, so the saved pitch looks exactly as it did at the draw
  insert into public.match_players (match_id, player_id, team, slot)
    select mid, t.x, 'A', t.n::int from unnest(p_team_a) with ordinality as t(x, n);
  insert into public.match_players (match_id, player_id, team, slot)
    select mid, t.x, 'B', t.n::int from unnest(p_team_b) with ordinality as t(x, n);
  return mid;
end $$;
