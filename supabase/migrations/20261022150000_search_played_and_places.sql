-- YEAR SCORE advanced search 1/4: played songs (PRD D1) and My Places (PRD D3)
-- Adds two columns, one table, venue links and one view. No row, file, policy or auth data is deleted.
-- mass_events.venue_name and mass_series.venue_name keep their values.
-- Undo: drop view performed_entries; drop columns venue_id (mass_events, mass_series),
--       not_played_at and note (mass_music_entries); drop table user_venues.

-- ---------------------------------------------------------------- 1) "Not played" mark and performance note
-- A linked score on a past, not cancelled Missa counts as played unless not_played_at is set.
alter table public.mass_music_entries
  add column not_played_at timestamptz,
  add column note text check (note is null or char_length(note) <= 2000);

-- ---------------------------------------------------------------- 2) My Places
-- One row per church. Each place may point at one saved Music Parts selection.
create table public.user_venues (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  layout_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (layout_id, user_id)
    references public.user_mass_layouts (id, user_id) on delete set null (layout_id)
);

-- Names that differ only in spaces at the ends or upper/lower case are the same place.
create unique index user_venues_user_name_uidx on public.user_venues (user_id, lower(btrim(name)));
create index user_venues_layout_idx on public.user_venues (layout_id, user_id);

alter table public.mass_events add column venue_id uuid;
alter table public.mass_events
  add foreign key (venue_id, user_id)
    references public.user_venues (id, user_id) on delete set null (venue_id);
create index mass_events_venue_idx on public.mass_events (venue_id, user_id);

alter table public.mass_series add column venue_id uuid;
alter table public.mass_series
  add foreign key (venue_id, user_id)
    references public.user_venues (id, user_id) on delete set null (venue_id);
create index mass_series_venue_idx on public.mass_series (venue_id, user_id);

create trigger user_venues_updated before update on public.user_venues
  for each row execute function public.set_updated_at();
create trigger user_venues_keep_created before update on public.user_venues
  for each row execute function public.keep_created_at();

revoke all on public.user_venues from anon, authenticated;
grant select, insert, update, delete on public.user_venues to authenticated;
alter table public.user_venues enable row level security;

create policy user_venues_own on public.user_venues
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------- 3) Existing place names become places
-- Approved 2026-10-22 (plan 5.1 a). Same name after trimming = one place. venue_name is not changed.
-- Names that only look alike (e.g. with and without a space in the middle) stay separate places.
insert into public.user_venues (user_id, name)
select distinct on (user_id, lower(name)) user_id, name
from (
  select user_id, btrim(venue_name) as name
    from public.mass_events where nullif(btrim(venue_name), '') is not null
  union all
  select user_id, btrim(venue_name)
    from public.mass_series where nullif(btrim(venue_name), '') is not null
) as names
order by user_id, lower(name), name;

update public.mass_events as m
  set venue_id = v.id
  from public.user_venues as v
  where m.venue_id is null
    and v.user_id = m.user_id
    and lower(v.name) = lower(btrim(m.venue_name));

update public.mass_series as s
  set venue_id = v.id
  from public.user_venues as v
  where s.venue_id is null
    and v.user_id = s.user_id
    and lower(v.name) = lower(btrim(s.venue_name));

-- ---------------------------------------------------------------- 4) Played songs
-- One row = one linked score that counts as played (PRD D1):
-- the Missa is not cancelled, its date is before today in Korea, and the song is not marked "Not played".
-- security_invoker: each member sees only their own rows through the existing RLS policies.
create view public.performed_entries
with (security_invoker = true) as
select
  e.id as entry_id,
  e.user_id,
  e.owned_score_id,
  m.id as mass_event_id,
  m.local_date,
  m.start_time,
  m.season_code,
  m.observance_id,
  m.celebration_name,
  s.role_id,
  s.display_name as part_display_name,
  m.venue_id,
  coalesce(v.name, nullif(btrim(m.venue_name), '')) as venue_label,
  e.note
from public.mass_music_entries as e
join public.mass_music_slots as s on s.id = e.mass_music_slot_id and s.user_id = e.user_id
join public.mass_events as m on m.id = s.mass_event_id and m.user_id = s.user_id
left join public.user_venues as v on v.id = m.venue_id and v.user_id = m.user_id
where m.status <> 'cancelled'
  and e.not_played_at is null
  and m.local_date < (now() at time zone 'Asia/Seoul')::date;

revoke all on public.performed_entries from anon, authenticated;
grant select on public.performed_entries to authenticated;
