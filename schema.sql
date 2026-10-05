-- =====================================================================
-- Real SocialDads: database schema for Supabase (Postgres)
-- Run this whole file once in Supabase > SQL Editor > New query > Run.
-- Safe to re-run: it uses "if not exists" / "create or replace" where possible.
-- =====================================================================

-- ---------- Tables ----------------------------------------------------

create table if not exists public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  github_username text,
  email           text,
  display_name    text,
  avatar_url      text,
  is_approved     boolean not null default false,
  is_admin        boolean not null default false,
  name_confirmed  boolean not null default false,
  can_organise    boolean not null default false,
  created_at      timestamptz not null default now()
);
-- (for anyone re-running this file on an older copy)
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists name_confirmed boolean not null default false;
alter table public.profiles add column if not exists can_organise boolean not null default false;

create table if not exists public.players (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  profile_id  uuid unique references public.profiles(id) on delete set null,
  avatar_url  text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.matches (
  id           uuid primary key default gen_random_uuid(),
  played_on    date not null default current_date,
  format       int  not null check (format between 5 and 8),
  status       text not null default 'scheduled' check (status in ('scheduled','completed')),
  score_a      int  check (score_a >= 0),
  score_b      int  check (score_b >= 0),
  motm_closed  boolean not null default false,
  draw_rules   jsonb,          -- the "play together / apart" rules used for the draw (if any)
  created_by   uuid references public.profiles(id),   -- who drew the teams
  created_at   timestamptz not null default now(),
  check (status = 'scheduled' or (score_a is not null and score_b is not null))
);

alter table public.matches add column if not exists draw_rules jsonb;

-- Fun-only team names and colours chosen at the draw. Empty (null) = the original "Blue" / "Orange".
-- Stats never look at these: they only use team 'A' / team 'B'.
alter table public.matches add column if not exists team_a_name   text
  check (team_a_name is null or char_length(team_a_name) between 1 and 24);
alter table public.matches add column if not exists team_b_name   text
  check (team_b_name is null or char_length(team_b_name) between 1 and 24);
alter table public.matches add column if not exists team_a_colour text
  check (team_a_colour is null or team_a_colour in ('red','orange','yellow','green','blue','purple','black','white'));
alter table public.matches add column if not exists team_b_colour text
  check (team_b_colour is null or team_b_colour in ('red','orange','yellow','green','blue','purple','black','white'));

create table if not exists public.match_players (
  match_id        uuid not null references public.matches(id) on delete cascade,
  player_id       uuid not null references public.players(id) on delete restrict,
  team            text not null check (team in ('A','B')),
  goals           int  not null default 0 check (goals >= 0 and goals <= 50),
  goals_recorded  boolean not null default false,
  slot            int,   -- position in the drawn order (1 = first drawn), keeps the pitch layout stable
  primary key (match_id, player_id)
);
alter table public.match_players add column if not exists slot int;

-- Anonymous man-of-the-match voting uses TWO tables on purpose:
--   motm_ballots: records THAT a person voted (so nobody votes twice)
--   motm_votes:   records WHO got a vote, with no link back to the voter
create table if not exists public.motm_ballots (
  match_id  uuid not null references public.matches(id) on delete cascade,
  voter_id  uuid not null references public.profiles(id) on delete cascade,
  primary key (match_id, voter_id)
);

create table if not exists public.motm_votes (
  id          bigint generated always as identity primary key,
  match_id    uuid not null references public.matches(id) on delete cascade,
  nominee_id  uuid not null references public.players(id) on delete cascade
);

-- ---------- Helper functions -----------------------------------------

create or replace function public.is_approved()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_approved from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin and is_approved from public.profiles where id = auth.uid()), false);
$$;

-- An "organiser" can draw teams, enter scores and add guest players.
-- Admins are always organisers; admins can also give the role to other regulars.
create or replace function public.is_organiser()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_approved and (is_admin or can_organise) from public.profiles where id = auth.uid()), false);
$$;

-- ---------- Sign-up triggers ------------------------------------------

-- When someone signs in for the first time (email link or GitHub), create their profile.
-- The very first person ever to sign in becomes the admin (that's you).
-- Email sign-ins have no name yet, so name_confirmed stays false and the app asks for one.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  first_user boolean;
  gh text;
  pname text;
  has_name boolean;
begin
  select not exists (select 1 from public.profiles where is_admin) into first_user;
  gh := coalesce(new.raw_user_meta_data->>'user_name', new.raw_user_meta_data->>'preferred_username');
  has_name := coalesce(nullif(new.raw_user_meta_data->>'name', ''), gh) is not null;
  pname := coalesce(nullif(new.raw_user_meta_data->>'name', ''), gh,
                    split_part(coalesce(new.email, 'player'), '@', 1));
  insert into public.profiles (id, github_username, email, display_name, avatar_url, is_approved, is_admin, name_confirmed)
  values (new.id, gh, new.email, pname, new.raw_user_meta_data->>'avatar_url', first_user, first_user, has_name);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Once a profile is approved, give them a player record.
create or replace function public.ensure_player()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.is_approved and not exists (select 1 from public.players where profile_id = new.id) then
    insert into public.players (name, profile_id, avatar_url)
    values (coalesce(nullif(new.display_name, ''), new.github_username, 'Player'), new.id, new.avatar_url);
  end if;
  return new;
end $$;

drop trigger if exists profiles_ensure_player on public.profiles;
create trigger profiles_ensure_player
  after insert or update of is_approved on public.profiles
  for each row execute function public.ensure_player();

-- ---------- Row Level Security ----------------------------------------

alter table public.profiles       enable row level security;
alter table public.players        enable row level security;
alter table public.matches        enable row level security;
alter table public.match_players  enable row level security;
alter table public.motm_ballots   enable row level security;
alter table public.motm_votes     enable row level security;

drop policy if exists "profiles read"  on public.profiles;
drop policy if exists "profiles admin update" on public.profiles;
create policy "profiles read" on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_approved());
create policy "profiles admin update" on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "players read"  on public.players;
drop policy if exists "players admin write" on public.players;
drop policy if exists "players organiser add" on public.players;
create policy "players read" on public.players for select to authenticated
  using (public.is_approved());
create policy "players admin write" on public.players for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
-- organisers can add guest players (people without a login)
create policy "players organiser add" on public.players for insert to authenticated
  with check (public.is_organiser() and profile_id is null);

drop policy if exists "matches read"  on public.matches;
drop policy if exists "matches admin write" on public.matches;
drop policy if exists "matches organiser insert" on public.matches;
drop policy if exists "matches organiser update" on public.matches;
drop policy if exists "matches admin delete" on public.matches;
create policy "matches read" on public.matches for select to authenticated
  using (public.is_approved());
-- (no direct insert: games are created through create_match() below, all-or-nothing)
create policy "matches organiser update" on public.matches for update to authenticated
  using (public.is_organiser()) with check (public.is_organiser());
create policy "matches admin delete" on public.matches for delete to authenticated
  using (public.is_admin());

drop policy if exists "match_players read"  on public.match_players;
drop policy if exists "match_players admin write" on public.match_players;
drop policy if exists "match_players organiser insert" on public.match_players;
create policy "match_players read" on public.match_players for select to authenticated
  using (public.is_approved());
create policy "match_players admin write" on public.match_players for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
-- (organisers add line-ups only through create_match(); only admins can edit them afterwards)

-- Ballots: you can only see your own. Nobody can insert directly (only cast_motm() can).
drop policy if exists "ballots read own" on public.motm_ballots;
create policy "ballots read own" on public.motm_ballots for select to authenticated
  using (voter_id = auth.uid());

-- motm_votes: deliberately NO policies. Nobody can read or write it from the app.
-- Results are exposed only through the motm_results view once voting is closed.

-- ---------- Functions the app calls -----------------------------------

-- Let a signed-in person set the name shown on the pitch and in the stats.
create or replace function public.set_my_name(p_name text)
returns void language plpgsql security definer set search_path = public as $$
declare n text := btrim(coalesce(p_name, ''));
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if char_length(n) < 1 or char_length(n) > 40 then raise exception 'Your name must be 1 to 40 characters'; end if;
  update public.profiles set display_name = n, name_confirmed = true where id = auth.uid();
  update public.players  set name = n where profile_id = auth.uid();
end $$;

-- Save a drawn game: the match and its full line-up in one all-or-nothing step.
-- The function gained extra (optional) inputs, so remove the previous version first.
drop function if exists public.create_match(date, int, uuid[], uuid[], jsonb);

create or replace function public.create_match(
  p_date date, p_format int, p_team_a uuid[], p_team_b uuid[], p_rules jsonb default null,
  p_name_a text default null, p_colour_a text default null,
  p_name_b text default null, p_colour_b text default null)
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
  if p_colour_a is not null and p_colour_a = p_colour_b then
    raise exception 'The two teams need different colours';
  end if;
  insert into public.matches (played_on, format, draw_rules, created_by,
                              team_a_name, team_a_colour, team_b_name, team_b_colour)
  values (coalesce(p_date, current_date), p_format, p_rules, auth.uid(),
          nullif(btrim(p_name_a), ''), p_colour_a, nullif(btrim(p_name_b), ''), p_colour_b)
  returning id into mid;
  -- slot = the order players were drawn in, so the saved pitch looks exactly as it did at the draw
  insert into public.match_players (match_id, player_id, team, slot)
    select mid, t.x, 'A', t.n::int from unnest(p_team_a) with ordinality as t(x, n);
  insert into public.match_players (match_id, player_id, team, slot)
    select mid, t.x, 'B', t.n::int from unnest(p_team_b) with ordinality as t(x, n);
  return mid;
end $$;

-- Record a player's goals for a match. Players can set their own; organisers/admins can set anyone's.
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

  -- Lock all players in this match while calculating the remaining goals.
  -- This prevents two phones saving goals at the same time from both seeing
  -- the same remaining allowance and pushing the team total above its score.
  perform 1 from public.match_players
   where match_id = p_match
   order by player_id
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

-- Cast an anonymous man-of-the-match vote.
create or replace function public.cast_motm(p_match uuid, p_nominee uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  m public.matches;
  me uuid := auth.uid();
  my_player uuid;
  eligible int;
  voted int;
begin
  if not public.is_approved() then raise exception 'Your account has not been approved yet'; end if;

  select * into m from public.matches where id = p_match;
  if not found then raise exception 'Match not found'; end if;
  if m.status <> 'completed' then raise exception 'Voting opens once the final score is recorded'; end if;
  if m.motm_closed then raise exception 'Voting has closed for this match'; end if;

  select id into my_player from public.players where profile_id = me;
  if my_player is null
     or not exists (select 1 from public.match_players where match_id = p_match and player_id = my_player) then
    raise exception 'Only players who took part can vote';
  end if;
  if p_nominee = my_player then raise exception 'You cannot vote for yourself'; end if;
  if not exists (select 1 from public.match_players where match_id = p_match and player_id = p_nominee) then
    raise exception 'That player did not play in this match';
  end if;

  begin
    insert into public.motm_ballots (match_id, voter_id) values (p_match, me);
  exception when unique_violation then
    raise exception 'You have already voted for this match';
  end;
  insert into public.motm_votes (match_id, nominee_id) values (p_match, p_nominee);

  -- Close automatically once every player who has a login has voted.
  select count(*) into eligible
    from public.match_players mp join public.players p on p.id = mp.player_id
   where mp.match_id = p_match and p.profile_id is not null;
  select count(*) into voted from public.motm_ballots where match_id = p_match;
  if voted >= eligible then
    update public.matches set motm_closed = true where id = p_match;
  end if;
end $$;

-- How many people have voted so far (never who).
create or replace function public.motm_progress(p_match uuid)
returns table (voted int, eligible int) language sql stable security definer set search_path = public as $$
  select
    (select count(*)::int from public.motm_ballots b where b.match_id = p_match),
    (select count(*)::int from public.match_players mp join public.players p on p.id = mp.player_id
      where mp.match_id = p_match and p.profile_id is not null)
  where public.is_approved();
$$;

revoke execute on function public.create_match(date, int, uuid[], uuid[], jsonb, text, text, text, text) from public, anon;
revoke execute on function public.set_my_name(text)           from public, anon;
revoke execute on function public.set_goals(uuid, uuid, int)  from public, anon;
revoke execute on function public.cast_motm(uuid, uuid)       from public, anon;
revoke execute on function public.motm_progress(uuid)         from public, anon;
grant  execute on function public.create_match(date, int, uuid[], uuid[], jsonb, text, text, text, text) to authenticated;
grant  execute on function public.set_my_name(text)           to authenticated;
grant  execute on function public.set_goals(uuid, uuid, int)  to authenticated;
grant  execute on function public.cast_motm(uuid, uuid)       to authenticated;
grant  execute on function public.motm_progress(uuid)         to authenticated;

-- ---------- Views ------------------------------------------------------

-- Votes per nominee, only for matches whose voting is closed. No voter info.
create or replace view public.motm_results as
select v.match_id,
       v.nominee_id as player_id,
       count(*)::int as votes,
       (count(*) = max(count(*)) over (partition by v.match_id)) as is_winner
  from public.motm_votes v
  join public.matches m on m.id = v.match_id
 where m.motm_closed and public.is_approved()
 group by v.match_id, v.nominee_id;

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

revoke all on public.motm_results from anon;
grant select on public.motm_results to authenticated;
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
