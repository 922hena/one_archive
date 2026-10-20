-- ONE ARCHIVE Phase 1 / migration 3 of 4: private Storage bucket "scores" + 3 policies
-- Adds a new bucket and new policies only. No update policy => files cannot be overwritten.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('scores', 'scores', false, 20971520,
        array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

-- read: own folder only (folder name = member UID)
create policy scores_read_own on storage.objects
  for select to authenticated
  using (bucket_id = 'scores'
         and (storage.foldername(name))[1] = (select auth.uid())::text);

-- upload: own folder only
create policy scores_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'scores'
              and (storage.foldername(name))[1] = (select auth.uid())::text);

-- delete: own folder only, and only when no score_files record still points to the file
create policy scores_delete_own_unreferenced on storage.objects
  for delete to authenticated
  using (bucket_id = 'scores'
         and (storage.foldername(name))[1] = (select auth.uid())::text
         and not exists (
           select 1 from public.score_files f where f.storage_path = storage.objects.name
         ));
