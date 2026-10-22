-- YEAR SCORE score saving: keep removed or replaced pages (PRD SCAN-012, approved with plan 5.1 c)
-- Adds one column, one column privilege, one trigger and one index. No row or file is deleted.
-- Until the app sets removed_at, nothing changes for members: every existing page has removed_at = null.
-- Undo: drop trigger score_files_touch_score_removed; revoke update (removed_at); drop column removed_at.

-- A page taken out of a score keeps its row and its Storage file; removed_at records when.
-- Viewer, preview and page counts read only rows where removed_at is null.
alter table public.score_files add column removed_at timestamptz;

-- Path, type, size and owner stay locked: only page_no (existing) and removed_at may be updated.
grant update (removed_at) on public.score_files to authenticated;

-- last_edited_at moves when a page is removed or restored, like add/delete/reorder.
create trigger score_files_touch_score_removed
  after update of removed_at on public.score_files
  for each row execute function public.touch_score_on_page_change();

create index score_files_live_idx on public.score_files (owned_score_id, page_no) where removed_at is null;
