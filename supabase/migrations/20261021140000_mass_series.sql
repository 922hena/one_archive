-- Recurring Mass (series) + skip dates + link from dated mass_events.
-- Additive only. Existing masses stay one-off (series_id null).
-- Auth, user IDs, scores, and score links are unchanged.

-- 1) Recurring Mass setting (name + time + place + layout + weekday)
create table public.mass_series (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text check (title is null or char_length(btrim(title)) between 1 and 100),
  start_time time,
  venue_name text,
  layout_id uuid,
  weekday smallint not null check (weekday between 0 and 6),
  interval_weeks smallint not null default 1 check (interval_weeks in (1, 2)),
  starts_on date not null,
  ends_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (layout_id, user_id)
    references public.user_mass_layouts (id, user_id) on delete set null (layout_id)
);

-- 2) A deleted date must not be recreated when the calendar loads
create table public.mass_series_skips (
  series_id uuid not null,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  skip_date date not null,
  created_at timestamptz not null default now(),
  primary key (series_id, skip_date),
  unique (series_id, user_id, skip_date),
  foreign key (series_id, user_id)
    references public.mass_series (id, user_id) on delete cascade
);

-- 3) Dated Mass rows may point at a series
alter table public.mass_events
  add column series_id uuid,
  add column series_locked boolean not null default false;

alter table public.mass_events
  add foreign key (series_id, user_id)
    references public.mass_series (id, user_id) on delete set null (series_id);

create unique index mass_events_series_date_uidx
  on public.mass_events (user_id, series_id, local_date)
  where series_id is not null;

create index mass_series_user_idx on public.mass_series (user_id, weekday);
create index mass_series_skips_user_idx on public.mass_series_skips (user_id, skip_date);
create index mass_events_series_idx on public.mass_events (series_id, user_id);

create trigger mass_series_updated before update on public.mass_series
  for each row execute function public.set_updated_at();
create trigger mass_series_keep_created before update on public.mass_series
  for each row execute function public.keep_created_at();

revoke all on public.mass_series, public.mass_series_skips from anon, authenticated;
grant select, insert, update, delete on public.mass_series, public.mass_series_skips to authenticated;

alter table public.mass_series enable row level security;
alter table public.mass_series_skips enable row level security;

create policy mass_series_own on public.mass_series
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy mass_series_skips_own on public.mass_series_skips
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Display-only: official name 입당 → 입당성가. User-set display_name rows are not touched.
update public.liturgical_roles
  set name_ko = '입당성가'
  where code = 'entrance' and name_ko = '입당';
