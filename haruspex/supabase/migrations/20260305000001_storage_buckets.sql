-- storage buckets for profile and group images

-- create buckets
insert into storage.buckets (id, name, public)
values
  ('avatars', 'avatars', true),
  ('group-images', 'group-images', true)
on conflict (id) do nothing;

-- storage policies: authenticated users can upload to their own folder
create policy "avatar upload by owner"
  on storage.objects for insert
  with check (
    bucket_id = 'avatars'
    and auth.role() = 'authenticated'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatar public read"
  on storage.objects for select
  using (bucket_id = 'avatars');

create policy "avatar update by owner"
  on storage.objects for update
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "avatar delete by owner"
  on storage.objects for delete
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- group images: group creators/members can upload
create policy "group image upload by members"
  on storage.objects for insert
  with check (
    bucket_id = 'group-images'
    and auth.role() = 'authenticated'
  );

create policy "group image public read"
  on storage.objects for select
  using (bucket_id = 'group-images');
