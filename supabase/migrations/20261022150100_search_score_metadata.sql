-- YEAR SCORE advanced search 2/4: musical periods, composer dictionary, score key/period/note, search view settings
-- Adds tables and columns, seeds the five base periods (PRD 4.13.2.4, decisions C4 and C8), replaces one trigger function.
-- No row, file, policy or auth data is deleted. owned_scores.composer_name keeps its values.
-- The 30 initial composers (PRD 4.22) are NOT added here: they are added after source checking and approval.
-- Undo: drop table saved_views, composer_aliases; drop the new owned_scores columns; drop table composers,
--       musical_periods; restore touch_score_last_edited from 20261021120000_score_page_order.sql.

-- ---------------------------------------------------------------- 1) Musical periods (operator reference)
-- Years are [start_year, end_year): 1900 belongs to Romantic and Modern starts in 1901.
create table public.musical_periods (
  code text primary key check (code ~ '^[a-z][a-z0-9_]*$'),
  name_en text not null check (char_length(btrim(name_en)) between 1 and 60),
  start_year smallint,
  end_year smallint,
  sort_order smallint not null unique,
  created_at timestamptz not null default now(),
  check (start_year is null or end_year is null or end_year > start_year)
);

insert into public.musical_periods (code, name_en, start_year, end_year, sort_order) values
  ('renaissance', 'Renaissance', 1450, 1601, 1),
  ('baroque',     'Baroque',     1601, 1751, 2),
  ('classical',   'Classical',   1751, 1801, 3),
  ('romantic',    'Romantic',    1801, 1901, 4),
  ('modern',      'Modern',      1901, null, 5);

-- ---------------------------------------------------------------- 2) Composer dictionary
-- created_by null = operator reference row; otherwise a member's own unverified record.
create table public.composers (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 100),
  full_name text check (full_name is null or char_length(btrim(full_name)) between 1 and 200),
  name_ko text check (name_ko is null or char_length(btrim(name_ko)) between 1 and 100),
  birth_year smallint check (birth_year between 800 and 2100),
  death_year smallint check (death_year between 800 and 2100),
  years_approx boolean not null default false,
  country text check (country is null or char_length(btrim(country)) between 1 and 100),
  period_code text references public.musical_periods (code),
  verification_status text not null default 'unverified'
    check (verification_status in ('source_checked','unverified')),
  source_url text,
  created_by uuid references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index composers_created_by_idx on public.composers (created_by);
create index composers_period_idx on public.composers (period_code);

-- search_key: lower case with accents removed (e.g. "Bédard" -> "bedard"), made by the app or the operator.
create table public.composer_aliases (
  id uuid primary key default gen_random_uuid(),
  composer_id uuid not null references public.composers (id) on delete cascade,
  alias text not null check (char_length(btrim(alias)) between 1 and 100),
  search_key text not null check (char_length(search_key) between 1 and 100),
  language_code text check (language_code is null or language_code ~ '^[a-z]{2,3}$'),
  created_by uuid references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (composer_id, search_key)
);

create index composer_aliases_search_idx on public.composer_aliases (search_key text_pattern_ops);
create index composer_aliases_created_by_idx on public.composer_aliases (created_by);

create trigger composers_updated before update on public.composers
  for each row execute function public.set_updated_at();
create trigger composers_keep_created before update on public.composers
  for each row execute function public.keep_created_at();

-- ---------------------------------------------------------------- 3) Score fields used by search
alter table public.owned_scores
  add column composer_id uuid references public.composers (id) on delete set null,
  add column composition_year smallint check (composition_year between 800 and 2100),
  add column composition_year_approx boolean not null default false,
  add column period_code text references public.musical_periods (code),
  add column key_tonic text check (key_tonic in (
    'Cb','C','C#','Db','D','D#','Eb','E','E#','Fb','F','F#','Gb','G','G#','Ab','A','A#','Bb','B','B#')),
  add column key_mode text check (key_mode in ('major','minor','modal','ambiguous','atonal')),
  add column key_text text check (key_text is null or char_length(btrim(key_text)) between 1 and 60),
  add column note text check (note is null or char_length(note) <= 2000);

create index owned_scores_composer_idx on public.owned_scores (composer_id);
create index owned_scores_period_idx on public.owned_scores (period_code);

-- last_edited_at also moves when the new fields change. created_at stays protected by keep_created_at.
create or replace function public.touch_score_last_edited() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.title is distinct from old.title
     or new.composer_name is distinct from old.composer_name
     or new.composer_id is distinct from old.composer_id
     or new.composition_year is distinct from old.composition_year
     or new.composition_year_approx is distinct from old.composition_year_approx
     or new.period_code is distinct from old.period_code
     or new.key_tonic is distinct from old.key_tonic
     or new.key_mode is distinct from old.key_mode
     or new.key_text is distinct from old.key_text
     or new.note is distinct from old.note
     or pg_trigger_depth() > 1 then
    new.last_edited_at := now();
  else
    new.last_edited_at := old.last_edited_at;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------- 4) Search view settings (PRD C6, SORT-008)
-- layout_config holds visible filters and their order, last sort and view. The app checks the allowed keys.
create table public.saved_views (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  view_type text not null check (view_type in ('search')),
  layout_config jsonb not null default '{}'::jsonb
    check (jsonb_typeof(layout_config) = 'object' and pg_column_size(layout_config) <= 8192),
  schema_version smallint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, view_type)
);

create trigger saved_views_updated before update on public.saved_views
  for each row execute function public.set_updated_at();
create trigger saved_views_keep_created before update on public.saved_views
  for each row execute function public.keep_created_at();

-- ---------------------------------------------------------------- 5) Privileges and RLS
revoke all on public.musical_periods, public.composers, public.composer_aliases, public.saved_views
  from anon, authenticated;
grant select on public.musical_periods to authenticated;
grant select, insert, update, delete on public.composers, public.composer_aliases, public.saved_views
  to authenticated;

alter table public.musical_periods enable row level security;
alter table public.composers enable row level security;
alter table public.composer_aliases enable row level security;
alter table public.saved_views enable row level security;

create policy musical_periods_read on public.musical_periods
  for select to authenticated using (true);

-- Same rule as works: operator rows and own rows can be read; only own rows can be written.
create policy composers_read on public.composers
  for select to authenticated
  using (created_by is null or created_by = (select auth.uid()));
create policy composers_insert_own on public.composers
  for insert to authenticated
  with check (created_by = (select auth.uid()) and verification_status = 'unverified');
create policy composers_update_own on public.composers
  for update to authenticated
  using (created_by = (select auth.uid()))
  with check (created_by = (select auth.uid()) and verification_status = 'unverified');
create policy composers_delete_own on public.composers
  for delete to authenticated
  using (created_by = (select auth.uid()));

-- A member may add an alias to any composer they can read, and edit only their own aliases.
create policy composer_aliases_read on public.composer_aliases
  for select to authenticated
  using (created_by is null or created_by = (select auth.uid()));
create policy composer_aliases_insert_own on public.composer_aliases
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and exists (select 1 from public.composers as c where c.id = composer_id)
  );
create policy composer_aliases_update_own on public.composer_aliases
  for update to authenticated
  using (created_by = (select auth.uid()))
  with check (created_by = (select auth.uid()));
create policy composer_aliases_delete_own on public.composer_aliases
  for delete to authenticated
  using (created_by = (select auth.uid()));

create policy saved_views_own on public.saved_views
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
