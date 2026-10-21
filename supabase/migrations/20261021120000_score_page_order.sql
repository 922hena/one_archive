-- ONE ARCHIVE Phase 1 supplement: page order editing for saved scores
-- Adds permissions, a policy, a function and a trigger, and replaces one trigger function.
-- No table, row or file is deleted. File path, type, size and owner stay locked.

-- 1) Only page_no may be updated, and only on the member's own rows
grant update (page_no) on public.score_files to authenticated;

create policy score_files_update_own on public.score_files
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- 2) last_edited_at also moves when pages are added, removed or reordered.
-- A direct client update runs this at trigger depth 1; the page trigger below runs it at depth 2.
create or replace function public.touch_score_last_edited() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.title is distinct from old.title
     or new.composer_name is distinct from old.composer_name
     or pg_trigger_depth() > 1 then
    new.last_edited_at := now();
  else
    new.last_edited_at := old.last_edited_at;
  end if;
  return new;
end $$;

create function public.touch_score_on_page_change() returns trigger
language plpgsql set search_path = '' as $$
declare
  target uuid;
begin
  if tg_op = 'DELETE' then
    target := old.owned_score_id;
  else
    target := new.owned_score_id;
  end if;
  -- uploads in progress are not edits
  update public.owned_scores set last_edited_at = now()
   where id = target and status = 'ready';
  return null;
end $$;

revoke execute on function public.touch_score_on_page_change() from public, anon, authenticated;

create trigger score_files_touch_score
  after insert or delete or update of page_no on public.score_files
  for each row execute function public.touch_score_on_page_change();
