-- =====================================================================
-- Real SocialDads update: yearly seasons + merging guests into members
-- Run this ONCE in Supabase > SQL Editor > New query > Run.
-- (Only needed if you already ran schema.sql earlier. New installs get this from schema.sql.)
-- =====================================================================

-- One row per player PER CALENDAR YEAR (season), based on the date each game was played.
-- Every game belongs to the year of its date, so stats start fresh each 1 January and
-- earlier years stay available. Players with no games in a year simply have no row (the app shows zeros).
drop view if exists public.player_stats;
create view public.player_stats as
select p.id as player_id,
       p.name,
       p.avatar_url,
       p.active,
       m.season,
       count(*)::int as games,
       sum(case when mp.team = 'A' then m.score_a else m.score_b end)::int as goals_for,
       sum(case when mp.team = 'A' then m.score_b else m.score_a end)::int as goals_against,
       sum(case when (mp.team = 'A' and m.score_a > m.score_b) or (mp.team = 'B' and m.score_b > m.score_a)
                then 1 else 0 end)::int as wins,
       sum(case when m.score_a = m.score_b then 1 else 0 end)::int as draws,
       sum(case when (mp.team = 'A' and m.score_a < m.score_b) or (mp.team = 'B' and m.score_b < m.score_a)
                then 1 else 0 end)::int as losses,
       sum(mp.goals)::int as personal_goals,
       (select count(*)::int
          from public.motm_results r
          join public.matches mm on mm.id = r.match_id
         where r.player_id = p.id and r.is_winner
           and extract(year from mm.played_on)::int = m.season) as motm
  from public.players p
  join public.match_players mp on mp.player_id = p.id
  join (select id, score_a, score_b, extract(year from played_on)::int as season
          from public.matches where status = 'completed') m on m.id = mp.match_id
 where public.is_approved()
 group by p.id, m.season;

revoke all on public.player_stats from anon;
grant select on public.player_stats to authenticated;

-- Merge a guest into another player (usually a guest who has since joined as a member).
-- Moves ALL of the guest's games, goals, man-of-the-match votes and draw rules onto the chosen
-- player, then removes the guest. The chosen player keeps their own name. Admins only.
create or replace function public.merge_players(p_from uuid, p_into uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  f public.players;
  t public.players;
  clash record;
begin
  if not public.is_admin() then raise exception 'Only admins can merge players'; end if;
  if p_from = p_into then raise exception 'Choose two different players'; end if;

  select * into f from public.players where id = p_from;
  if not found then raise exception 'The guest to merge was not found'; end if;
  select * into t from public.players where id = p_into;
  if not found then raise exception 'The player to merge into was not found'; end if;

  if f.profile_id is not null then
    raise exception '% has a login, so they can''t be merged away. Merge a guest into a member instead.', f.name;
  end if;

  -- they can't be the same person if both played in the same game
  select m.played_on into clash
    from public.match_players a
    join public.match_players b on b.match_id = a.match_id
    join public.matches m on m.id = a.match_id
   where a.player_id = p_from and b.player_id = p_into
   limit 1;
  if found then
    raise exception 'Both played in the game on %, so they can''t be the same person', clash.played_on;
  end if;

  update public.match_players set player_id  = p_into where player_id  = p_from;
  update public.motm_votes    set nominee_id = p_into where nominee_id = p_from;
  update public.matches
     set draw_rules = replace(draw_rules::text, p_from::text, p_into::text)::jsonb
   where draw_rules is not null and draw_rules::text like '%' || p_from::text || '%';
  delete from public.players where id = p_from;
end $$;

revoke execute on function public.merge_players(uuid, uuid) from public, anon;
grant  execute on function public.merge_players(uuid, uuid) to authenticated;
