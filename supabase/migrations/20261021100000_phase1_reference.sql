-- ONE ARCHIVE Phase 1 / migration 1 of 4: reference tables (read-only for members)
-- Adds new objects only. Does not touch auth schema, existing data, or older migration records.

-- 1) Official liturgical calendar (one row per celebration; several rows per date allowed)
create table public.liturgical_observances (
  id uuid primary key default gen_random_uuid(),
  calendar_code text not null default 'KR',
  calendar_date date not null,
  sort_order smallint not null default 1,
  name_ko text not null,
  name_en text,
  name_la text,
  season_code text
    check (season_code in ('advent','christmas','ordinary','lent','easter')),
  color_code text not null
    check (color_code in ('green','white','violet','red','rose')),
  rank_code text not null
    check (rank_code in ('solemnity','feast','sunday','weekday','votive')),
  source_url text,
  verification_status text not null default 'source_checked'
    check (verification_status in ('source_checked','unverified')),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (calendar_code, calendar_date, sort_order)
);

-- 2) The 18 fixed music items (slot_no is the fixed screen order)
create table public.liturgical_roles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  slot_no smallint not null unique check (slot_no between 0 and 17),
  name_ko text not null,
  name_la text,
  name_en text,
  rite_sequence_no smallint,  -- reserved: link to the 0-32 rite order later
  created_at timestamptz not null default now()
);

-- 3) Works (empty for now, no screen in Phase 1). Reserved for key/tonality search in Phase 2.
create table public.works (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  catalog_no text,
  key_tonic text,
  key_mode text check (key_mode in ('major','minor')),
  created_by uuid references auth.users (id) on delete cascade, -- null = shared by operator
  verification_status text not null default 'unverified'
    check (verification_status in ('source_checked','unverified')),
  created_at timestamptz not null default now()
);

create index works_created_by_idx on public.works (created_by);

-- Privileges: signed-in members read only (works: own rows can be written)
revoke all on public.liturgical_observances from anon, authenticated;
revoke all on public.liturgical_roles from anon, authenticated;
revoke all on public.works from anon, authenticated;
grant select on public.liturgical_observances to authenticated;
grant select on public.liturgical_roles to authenticated;
grant select, insert, update, delete on public.works to authenticated;

alter table public.liturgical_observances enable row level security;
alter table public.liturgical_roles enable row level security;
alter table public.works enable row level security;

create policy observances_read on public.liturgical_observances
  for select to authenticated using (true);

create policy roles_read on public.liturgical_roles
  for select to authenticated using (true);

create policy works_read on public.works
  for select to authenticated
  using (created_by is null or created_by = (select auth.uid()));

create policy works_insert_own on public.works
  for insert to authenticated
  with check (created_by = (select auth.uid()));

create policy works_update_own on public.works
  for update to authenticated
  using (created_by = (select auth.uid()))
  with check (created_by = (select auth.uid()));

create policy works_delete_own on public.works
  for delete to authenticated
  using (created_by = (select auth.uid()));
