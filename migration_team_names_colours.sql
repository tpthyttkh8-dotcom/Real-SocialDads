-- =====================================================================
-- Real SocialDads update: fun team names and colours
-- Run this ONCE in Supabase > SQL Editor > New query > Run.
-- Safe for existing data: it only ADDS four optional (empty) columns to the games table and
-- replaces one function. No rows are changed or deleted, and every existing game keeps
-- showing as Blue v Orange exactly as before. Running it twice does no harm.
-- =====================================================================

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

revoke execute on function public.create_match(date, int, uuid[], uuid[], jsonb, text, text, text, text) from public, anon;
grant  execute on function public.create_match(date, int, uuid[], uuid[], jsonb, text, text, text, text) to authenticated;
