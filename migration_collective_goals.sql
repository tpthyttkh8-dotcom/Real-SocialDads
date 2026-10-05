-- Real SocialDads: prevent the recorded goals for one team exceeding the final score.
-- Run this once in the Supabase SQL editor if the database is already installed.

create or replace function public.set_goals(p_match uuid, p_player uuid, p_goals int)
returns void language plpgsql security definer set search_path = public as $$
declare
  m public.matches;
  mp public.match_players;
  is_own boolean;
  team_score int;
  other_goals int;
begin
  if not public.is_approved() then raise exception 'Your account has not been approved yet'; end if;

  select * into m from public.matches where id = p_match;
  if not found then raise exception 'Match not found'; end if;
  if m.status <> 'completed' then raise exception 'Record the final score before adding goals'; end if;

  -- Lock the match-player rows while calculating the remaining allowance.
  -- This prevents simultaneous saves on different phones from exceeding the score.
  perform 1 from public.match_players
   where match_id = p_match
   order by id
   for update;

  select * into mp from public.match_players where match_id = p_match and player_id = p_player;
  if not found then raise exception 'That player did not play in this match'; end if;

  select exists (select 1 from public.players where id = p_player and profile_id = auth.uid()) into is_own;
  if not (is_own or public.is_organiser()) then raise exception 'You can only record your own goals'; end if;

  team_score := case when mp.team = 'A' then m.score_a else m.score_b end;
  if p_goals < 0 then
    raise exception 'Goals cannot be negative';
  end if;

  select coalesce(sum(coalesce(goals, 0)), 0)::int into other_goals
    from public.match_players
   where match_id = p_match
     and team = mp.team
     and player_id <> p_player
     and goals_recorded;

  if other_goals + p_goals > team_score then
    raise exception 'Only % goal(s) remain for your team (score: %, already recorded: %)',
      greatest(team_score - other_goals, 0), team_score, other_goals;
  end if;

  update public.match_players
     set goals = p_goals, goals_recorded = true
   where match_id = p_match and player_id = p_player;
end $$;

revoke execute on function public.set_goals(uuid, uuid, int) from public, anon;
grant execute on function public.set_goals(uuid, uuid, int) to authenticated;
