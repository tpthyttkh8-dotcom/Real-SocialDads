-- =====================================================================
-- Real SocialDads: organisers only manage the games THEY created
-- Run ONCE in Supabase > SQL Editor > New query > Run. Safe to re-run. No existing data is changed.
--
--   Organisers can draw (create) games and enter the final score on ANY game that doesn't have one yet.
--   On games they created they can also: correct the final score,
--   enter goals for anyone, name teams / pick colours, close or reopen man of the match voting, and
--   delete the game until a final score has been entered.
--   On anyone else's game they are an ordinary player: their own goals and their own vote only.
--   Admins can still do everything on every game.
-- =====================================================================

-- True if the signed-in person may manage this game.
create or replace function public.can_manage_match(p_match uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or (public.is_organiser()
          and exists (select 1 from public.matches where id = p_match and created_by = auth.uid()));
$$;
revoke execute on function public.can_manage_match(uuid) from public, anon;
grant  execute on function public.can_manage_match(uuid) to authenticated;

-- Direct edits (score corrections, team names/colours, voting open/closed): admins on any game, organisers on their own.
drop policy if exists "matches organiser update" on public.matches;
create policy "matches organiser update" on public.matches for update to authenticated
  using      (public.is_admin() or (public.is_organiser() and created_by = auth.uid()))
  with check (public.is_admin() or (public.is_organiser() and created_by = auth.uid()));


-- Enter (or correct) the final score.
--   Any organiser may enter the score of a game that has no score yet.
--   Once a score is in, only the game's organiser or an admin may change it.
create or replace function public.set_score(p_match uuid, p_a int, p_b int)
returns void language plpgsql security definer set search_path = public as $$
declare m public.matches;
begin
  if not public.is_organiser() then raise exception 'Only organisers can enter scores'; end if;
  if p_a is null or p_b is null or p_a < 0 or p_b < 0 or p_a > 99 or p_b > 99 then
    raise exception 'Enter a score for both teams (0 to 99)';
  end if;
  select * into m from public.matches where id = p_match for update;
  if not found then raise exception 'Match not found'; end if;
  if m.status = 'completed' and not public.can_manage_match(p_match) then
    raise exception 'The score is already in. Only the organiser who drew this game (or an admin) can change it';
  end if;
  update public.matches set score_a = p_a, score_b = p_b, status = 'completed' where id = p_match;
end $$;
revoke execute on function public.set_score(uuid, int, int) from public, anon;
grant  execute on function public.set_score(uuid, int, int) to authenticated;

-- Delete: admins any game; organisers their own game only while it has no final score.
drop policy if exists "matches admin delete" on public.matches;
drop policy if exists "matches delete" on public.matches;
create policy "matches delete" on public.matches for delete to authenticated
  using (public.is_admin()
         or (public.is_organiser() and created_by = auth.uid() and status = 'scheduled'));

-- Goals: your own, or anyone's on a game you manage. Team total can't exceed the team's score.
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

  -- lock this game's rows so two phones saving at once can't exceed the score
  perform 1 from public.match_players where match_id = p_match order by player_id for update;

  select * into mp from public.match_players where match_id = p_match and player_id = p_player;
  if not found then raise exception 'That player did not play in this match'; end if;

  select exists (select 1 from public.players where id = p_player and profile_id = auth.uid()) into is_own;
  if not (is_own or public.can_manage_match(p_match)) then
    raise exception 'You can only record your own goals on this game';
  end if;

  if p_goals < 0 then raise exception 'Goals cannot be negative'; end if;
  team_score := case when mp.team = 'A' then m.score_a else m.score_b end;

  select coalesce(sum(coalesce(goals, 0)), 0)::int into other_goals
    from public.match_players
   where match_id = p_match and team = mp.team and player_id <> p_player and goals_recorded;

  if other_goals + p_goals > team_score then
    raise exception 'Only % goal(s) remain for your team (score: %, already recorded: %)',
      greatest(team_score - other_goals, 0), team_score, other_goals;
  end if;

  update public.match_players set goals = p_goals, goals_recorded = true
   where match_id = p_match and player_id = p_player;
end $$;

revoke execute on function public.set_goals(uuid, uuid, int) from public, anon;
grant  execute on function public.set_goals(uuid, uuid, int) to authenticated;
