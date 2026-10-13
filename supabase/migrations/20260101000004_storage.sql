-- Stakeout · migration 4 · private photo storage
-- Object path convention:  {group_id}/{user_id}/{uuid}.jpg
--   · read   → any member of {group_id}
--   · write  → a member, only inside their own {user_id} folder
--   · delete → only the uploader (own folder)

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('review-photos', 'review-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "review photos: members read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'review-photos'
    and public.is_group_member(public.try_uuid((storage.foldername(name))[1]))
  );

create policy "review photos: members upload to own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'review-photos'
    and public.is_group_member(public.try_uuid((storage.foldername(name))[1]))
    and (storage.foldername(name))[2] = auth.uid()::text
  );

create policy "review photos: uploader deletes own"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'review-photos'
    and (storage.foldername(name))[2] = auth.uid()::text
  );
