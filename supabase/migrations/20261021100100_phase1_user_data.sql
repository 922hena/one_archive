-- ONE ARCHIVE Phase 1 / migration 2 of 4: member data tables, triggers, RLS
-- Adds new objects only. Every row carries user_id (default = signed-in member's UID).
-- "Same owner only" links are enforced by composite foreign keys (id, user_id).
-- NOTE: user_id -> auth.users uses ON DELETE CASCADE only so that a deliberately deleted
-- account takes its own rows with it. Nothing here deletes or edits auth users.

-- ---------------------------------------------------------------- helper functions
create function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create function public.keep_created_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.created_at is distinct from old.created_at then
    raise exception 'created_at cannot be changed';
  end if;
  return new;
end $$;

create function public.touch_score_last_edited() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.title is distinct from old.title
     or new.composer_name is distinct from old.composer_name then
    new.last_edited_at := now();
  else
    new.last_edited_at := old.last_edited_at;
  end if;
  return new;
end $$;

revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.keep_created_at() from public, anon, authenticated;
revoke execute on function public.touch_score_last_edited() from public, anon, authenticated;

-- ---------------------------------------------------------------- mass layouts (미사틀)
create table public.user_mass_layouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create table public.user_mass_layout_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  layout_id uuid not null,
  role_id uuid not null references public.liturgical_roles (id),
  display_name text check (display_name is null or char_length(btrim(display_name)) between 1 and 100),
  created_at timestamptz not null default now(),
  unique (layout_id, role_id),
  foreign key (layout_id, user_id)
    references public.user_mass_layouts (id, user_id) on delete cascade
);

-- ---------------------------------------------------------------- masses
create table public.mass_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  local_date date not null,
  start_time time,
  title text check (title is null or char_length(btrim(title)) between 1 and 100),
  observance_id uuid references public.liturgical_observances (id) on delete set null,
  celebration_name text,            -- copied from the calendar; member may edit
  season_code text
    check (season_code in ('advent','christmas','ordinary','lent','easter')),
  color_code text
    check (color_code in ('green','white','violet','red','rose')),
  liturgy_source text not null default 'unknown'
    check (liturgy_source in ('official','user','unknown')),
  layout_id uuid,
  venue_name text,
  status text not null default 'planned'
    check (status in ('planned','completed','cancelled')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (layout_id, user_id)
    references public.user_mass_layouts (id, user_id) on delete set null (layout_id)
);

create table public.mass_music_slots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  mass_event_id uuid not null,
  role_id uuid not null references public.liturgical_roles (id),
  display_name text check (display_name is null or char_length(btrim(display_name)) between 1 and 100),
  created_at timestamptz not null default now(),
  unique (mass_event_id, role_id),
  unique (id, user_id),
  foreign key (mass_event_id, user_id)
    references public.mass_events (id, user_id) on delete cascade
);

-- ---------------------------------------------------------------- scores
create table public.owned_scores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text,
  composer_name text,
  provisional_title text not null,   -- original file name, always present
  status text not null default 'uploading' check (status in ('uploading','ready')),
  work_id uuid references public.works (id) on delete set null,
  created_at timestamptz not null default now(),
  last_edited_at timestamptz not null default now(),
  unique (id, user_id)
);

create table public.score_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  owned_score_id uuid not null,
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('application/pdf','image/jpeg','image/png')),
  byte_size bigint not null check (byte_size > 0 and byte_size <= 20971520),
  original_filename text,
  page_no integer not null default 1 check (page_no >= 1),
  created_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (owned_score_id, user_id)
    references public.owned_scores (id, user_id) on delete cascade,
  -- path must be {user_id}/{score_id}/{file_id}.{ext}
  check (storage_path ~ ('^' || user_id::text || '/' || owned_score_id::text || '/' || id::text || '\.(pdf|jpg|jpeg|png)$'))
);

-- ---------------------------------------------------------------- links
create table public.mass_music_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  mass_music_slot_id uuid not null,
  owned_score_id uuid not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (id, user_id),
  unique (mass_music_slot_id, owned_score_id),
  foreign key (mass_music_slot_id, user_id)
    references public.mass_music_slots (id, user_id) on delete cascade,
  -- a linked score cannot be deleted (checked at statement end)
  foreign key (owned_score_id, user_id)
    references public.owned_scores (id, user_id) on delete no action
);

-- Actual-play record. Empty, no screen in Phase 1. Linking never creates a row here.
create table public.performance_confirmations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  mass_music_entry_id uuid not null,
  confirmed_at timestamptz not null default now(),
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  -- an entry with a confirmation cannot be deleted
  foreign key (mass_music_entry_id, user_id)
    references public.mass_music_entries (id, user_id) on delete no action
);

create unique index performance_confirmations_one_valid_idx
  on public.performance_confirmations (mass_music_entry_id) where voided_at is null;

-- ---------------------------------------------------------------- indexes
create index mass_events_user_date_idx on public.mass_events (user_id, local_date);
create index mass_events_layout_idx on public.mass_events (layout_id, user_id);
create index mass_events_observance_idx on public.mass_events (observance_id);
create index mass_music_slots_role_idx on public.mass_music_slots (role_id);
create index user_mass_layout_items_role_idx on public.user_mass_layout_items (role_id);
create index user_mass_layout_items_layout_idx on public.user_mass_layout_items (layout_id, user_id);
create index owned_scores_user_idx on public.owned_scores (user_id, created_at desc);
create index owned_scores_work_idx on public.owned_scores (work_id);
create index score_files_score_idx on public.score_files (owned_score_id, user_id);
create index mass_music_entries_slot_idx on public.mass_music_entries (mass_music_slot_id, user_id);
create index mass_music_entries_score_idx on public.mass_music_entries (owned_score_id, user_id);
create index performance_confirmations_entry_idx on public.performance_confirmations (mass_music_entry_id, user_id);

-- ---------------------------------------------------------------- triggers
create trigger user_mass_layouts_updated before update on public.user_mass_layouts
  for each row execute function public.set_updated_at();
create trigger mass_events_updated before update on public.mass_events
  for each row execute function public.set_updated_at();

create trigger user_mass_layouts_keep_created before update on public.user_mass_layouts
  for each row execute function public.keep_created_at();
create trigger mass_events_keep_created before update on public.mass_events
  for each row execute function public.keep_created_at();
create trigger owned_scores_keep_created before update on public.owned_scores
  for each row execute function public.keep_created_at();

create trigger owned_scores_touch_edited before update on public.owned_scores
  for each row execute function public.touch_score_last_edited();

-- ---------------------------------------------------------------- privileges + RLS
revoke all on public.user_mass_layouts, public.user_mass_layout_items, public.mass_events,
  public.mass_music_slots, public.owned_scores, public.score_files,
  public.mass_music_entries, public.performance_confirmations
  from anon, authenticated;

grant select, insert, update, delete on public.user_mass_layouts,
  public.user_mass_layout_items, public.mass_events, public.mass_music_slots,
  public.owned_scores, public.mass_music_entries, public.performance_confirmations
  to authenticated;
-- score_files: originals cannot be edited (no UPDATE)
grant select, insert, delete on public.score_files to authenticated;

alter table public.user_mass_layouts enable row level security;
alter table public.user_mass_layout_items enable row level security;
alter table public.mass_events enable row level security;
alter table public.mass_music_slots enable row level security;
alter table public.owned_scores enable row level security;
alter table public.score_files enable row level security;
alter table public.mass_music_entries enable row level security;
alter table public.performance_confirmations enable row level security;

create policy layouts_own on public.user_mass_layouts
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy layout_items_own on public.user_mass_layout_items
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy masses_own on public.mass_events
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy slots_own on public.mass_music_slots
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy scores_own on public.owned_scores
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy score_files_select_own on public.score_files
  for select to authenticated using (user_id = (select auth.uid()));
create policy score_files_insert_own on public.score_files
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy score_files_delete_own on public.score_files
  for delete to authenticated using (user_id = (select auth.uid()));

create policy entries_own on public.mass_music_entries
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy confirmations_own on public.performance_confirmations
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
