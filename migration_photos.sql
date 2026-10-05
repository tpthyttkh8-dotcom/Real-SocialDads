-- =====================================================================
-- Real SocialDads: small profile photos
-- Run ONCE in Supabase > SQL Editor > New query > Run. Safe to re-run. No existing data is changed.
-- Photos are shrunk on the phone to 160x160 (about 6-12 KB each), so 20 players use well under 1 MB
-- of the 1 GB free storage. Only the web address is kept in the database.
-- =====================================================================

-- A public-read bucket (so photos load in the app), capped at 100 KB per file, JPEG only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 102400, array['image/jpeg'])
on conflict (id) do update
  set public = true, file_size_limit = 102400, allowed_mime_types = array['image/jpeg'];

-- Each signed-in person may add / replace / remove ONLY their own photo (folder named after their user id).
drop policy if exists "avatars own insert" on storage.objects;
drop policy if exists "avatars own update" on storage.objects;
drop policy if exists "avatars own delete" on storage.objects;
drop policy if exists "avatars own select" on storage.objects;

create policy "avatars own insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars own update" on storage.objects for update to authenticated
  using      (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars own delete" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars own select" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- Save (or clear, with null) the photo address on your profile and player record.
create or replace function public.set_my_avatar(p_url text)
returns void language plpgsql security definer set search_path = public as $$
declare u text := nullif(btrim(coalesce(p_url, '')), '');
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if u is not null and (u !~ ('/storage/v1/object/public/avatars/' || auth.uid()::text || '/') or char_length(u) > 400) then
    raise exception 'That is not a valid photo address';
  end if;
  update public.profiles set avatar_url = u where id = auth.uid();
  update public.players  set avatar_url = u where profile_id = auth.uid();
end $$;

revoke execute on function public.set_my_avatar(text) from public, anon;
grant  execute on function public.set_my_avatar(text) to authenticated;
