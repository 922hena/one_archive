-- Save Score Information Only (PRD RIGHT-001~005, approved 2026-10-28).
-- A Score without a file is an owned_scores row with status 'ready' and no live score_files row.
-- Adds only: eight nullable owned_scores columns, their grants, last_edited_at for them, search text in
-- the new fields and a "files" search filter. No row, file, policy or auth data is changed or deleted.
-- Undo: drop the eight columns, then restore touch_score_last_edited from 20261022150100_search_score_metadata.sql,
--       search_pool from 20261022150300_search_functions.sql and search_scores from 20261023020000_score_pdf_thumbnail.sql.

alter table public.owned_scores
  add column publisher text check (publisher is null or char_length(publisher) between 1 and 200),
  add column edition text check (edition is null or char_length(edition) between 1 and 200),
  add column scorebook text check (scorebook is null or char_length(scorebook) between 1 and 200),
  add column scorebook_page text check (scorebook_page is null or char_length(scorebook_page) between 1 and 40),
  add column physical_location text check (physical_location is null or char_length(physical_location) between 1 and 200),
  add column external_url text check (
    external_url is null or (char_length(external_url) <= 2000 and external_url ~* '^https?://[^[:space:]]+$')
  ),
  add column duration_seconds integer check (duration_seconds is null or duration_seconds between 1 and 36000),
  add column difficulty smallint check (difficulty is null or difficulty between 1 and 5);

-- Column-level grants are used on this table, so new columns get their own grants. RLS (scores_own) is unchanged.
grant select, insert, update (
  publisher, edition, scorebook, scorebook_page, physical_location, external_url, duration_seconds, difficulty
) on public.owned_scores to authenticated;

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
     or new.publisher is distinct from old.publisher
     or new.edition is distinct from old.edition
     or new.scorebook is distinct from old.scorebook
     or new.scorebook_page is distinct from old.scorebook_page
     or new.physical_location is distinct from old.physical_location
     or new.external_url is distinct from old.external_url
     or new.duration_seconds is distinct from old.duration_seconds
     or new.difficulty is distinct from old.difficulty
     or pg_trigger_depth() > 1 then
    new.last_edited_at := now();
  else
    new.last_edited_at := old.last_edited_at;
  end if;
  return new;
end $$;

-- search_pool: same as 20261022150300; q also matches publisher, edition, scorebook and physical location.
create or replace function public.search_pool(p_filters jsonb default '{}'::jsonb)
returns table (
  score_id uuid,
  title text,
  provisional_title text,
  composer_id uuid,
  composer_label text,
  period_code text,
  period_provisional boolean,
  key_tonic text,
  key_mode text,
  key_text text,
  note text,
  created_at timestamptz
)
language sql stable set search_path = '' as $$
  with f as (
    select
      q,
      '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%' as q_like,
      replace(replace(replace(coalesce(q_key, q), '\', '\\'), '%', '\%'), '_', '\_') || '%' as q_prefix,
      public.search_list(p_filters->'composer_ids')::uuid[] as composer_ids,
      (select array_agg(lower(btrim(x))) from unnest(public.search_list(p_filters->'composer_names')) as x)
        as composer_names,
      public.search_list(p_filters->'periods') as periods,
      coalesce((p_filters->>'include_provisional_period')::boolean, true) as include_provisional,
      case when jsonb_typeof(p_filters->'keys') = 'array' and jsonb_array_length(p_filters->'keys') > 0
        then p_filters->'keys' end as keys
    from (
      select lower(nullif(btrim(p_filters->>'q'), '')) as q,
             lower(nullif(btrim(p_filters->>'q_key'), '')) as q_key
    ) as input
  ),
  scores as (
    select
      os.id as score_id,
      os.title,
      os.provisional_title,
      os.composer_id,
      os.composer_name,
      coalesce(c.display_name, nullif(btrim(os.composer_name), '')) as composer_label,
      c.full_name as composer_full_name,
      c.name_ko as composer_name_ko,
      coalesce(os.period_code, py.code, c.period_code) as period_code,
      (os.period_code is null and py.code is null and c.period_code is not null) as period_provisional,
      os.key_tonic,
      os.key_mode,
      os.key_text,
      os.note,
      os.created_at,
      os.publisher,
      os.edition,
      os.scorebook,
      os.physical_location
    from public.owned_scores as os
    left join public.composers as c on c.id = os.composer_id
    left join lateral (
      select mp.code
      from public.musical_periods as mp
      where os.composition_year is not null
        and (mp.start_year is null or os.composition_year >= mp.start_year)
        and (mp.end_year is null or os.composition_year < mp.end_year)
      order by mp.sort_order
      limit 1
    ) as py on true
    where os.status = 'ready'
  )
  select s.score_id, s.title, s.provisional_title, s.composer_id, s.composer_label,
         s.period_code, s.period_provisional, s.key_tonic, s.key_mode, s.key_text, s.note, s.created_at
  from scores as s
  cross join f
  where (f.q is null
         or lower(coalesce(s.title, '')) like f.q_like
         or lower(s.provisional_title) like f.q_like
         or lower(coalesce(s.composer_label, '')) like f.q_like
         or lower(coalesce(s.composer_full_name, '')) like f.q_like
         or lower(coalesce(s.composer_name_ko, '')) like f.q_like
         or lower(coalesce(s.publisher, '')) like f.q_like
         or lower(coalesce(s.edition, '')) like f.q_like
         or lower(coalesce(s.scorebook, '')) like f.q_like
         or lower(coalesce(s.physical_location, '')) like f.q_like
         or exists (
              select 1 from public.composer_aliases as ca
              where ca.composer_id = s.composer_id and ca.search_key like f.q_prefix))
    and ((f.composer_ids is null and f.composer_names is null)
         or s.composer_id = any (coalesce(f.composer_ids, '{}'))
         or lower(btrim(s.composer_name)) = any (coalesce(f.composer_names, '{}'))
         or lower(s.composer_label) = any (coalesce(f.composer_names, '{}')))
    and (f.periods is null
         or (s.period_code = any (f.periods) and (f.include_provisional or not s.period_provisional)))
    and (f.keys is null
         or exists (
              select 1 from jsonb_array_elements(f.keys) as k
              where k->>'tonic' = s.key_tonic and (k->>'mode' is null or k->>'mode' = s.key_mode)))
$$;

-- search_scores: same as 20261023020000 plus p_filters->>'files':
--   'with' = Scores with a file, 'without' = Information Only; anything else = all.
create or replace function public.search_scores(
  p_filters jsonb default '{}'::jsonb,
  p_sort text default 'title',
  p_descending boolean default false,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  score_id uuid,
  title text,
  provisional_title text,
  composer_label text,
  period_code text,
  period_provisional boolean,
  key_tonic text,
  key_mode text,
  key_text text,
  note text,
  created_at timestamptz,
  file_count integer,
  first_file_path text,
  first_file_mime text,
  thumbnail_path text,
  within_count integer,
  within_masses integer,
  all_count integer,
  extra_count integer,
  last_performed date,
  total_count bigint
)
language sql stable set search_path = '' as $$
  with f as (
    select
      case when jsonb_typeof(p_filters->'count') = 'object' then p_filters->'count' end as count_cond,
      case when jsonb_typeof(p_filters->'extra_count') = 'object' then p_filters->'extra_count' end as extra_cond,
      public.search_list(p_filters->'extra_count'->'venue_ids')::uuid[] as extra_venue_ids,
      case when p_filters->>'files' in ('with', 'without') then p_filters->>'files' end as files,
      (public.search_list(p_filters->'seasons') is not null
        or public.search_list(p_filters->'observance_names') is not null
        or public.search_list(p_filters->'years') is not null
        or p_filters->>'year_from' is not null
        or p_filters->>'year_to' is not null
        or public.search_list(p_filters->'months') is not null
        or p_filters->>'date_from' is not null
        or p_filters->>'date_to' is not null
        or public.search_list(p_filters->'venue_ids') is not null
        or public.search_list(p_filters->'role_ids') is not null) as has_context
  ),
  within as (
    select e.owned_score_id,
           count(*)::integer as n,
           count(distinct e.mass_event_id)::integer as masses,
           max(e.local_date) as last_date
    from public.search_entries(p_filters) as e
    group by e.owned_score_id
  ),
  alltime as (
    select pe.owned_score_id, count(*)::integer as n
    from public.performed_entries as pe
    group by pe.owned_score_id
  ),
  extra as (
    select pe.owned_score_id, count(*)::integer as n
    from public.performed_entries as pe
    cross join f
    where f.extra_cond is not null
      and (f.extra_cond->>'scope' = 'all'
           or (f.extra_cond->>'scope' = 'venue' and pe.venue_id = any (coalesce(f.extra_venue_ids, '{}'))))
    group by pe.owned_score_id
  ),
  matched as (
    select p.*,
           coalesce(w.n, 0) as within_count,
           coalesce(w.masses, 0) as within_masses,
           coalesce(a.n, 0) as all_count,
           case when f.extra_cond is not null then coalesce(x.n, 0) end as extra_count,
           w.last_date as last_performed
    from public.search_pool(p_filters) as p
    cross join f
    left join within as w on w.owned_score_id = p.score_id
    left join alltime as a on a.owned_score_id = p.score_id
    left join extra as x on x.owned_score_id = p.score_id
    where (case
             when f.count_cond is not null then public.count_condition_met(coalesce(w.n, 0), f.count_cond)
             when f.has_context then coalesce(w.n, 0) >= 1
             else true
           end)
      and (f.extra_cond is null or public.count_condition_met(coalesce(x.n, 0), f.extra_cond))
      and (f.files is null
           or (f.files = 'with') = exists (
                select 1 from public.score_files as sf
                where sf.owned_score_id = p.score_id and sf.removed_at is null and sf.role = 'page'))
  )
  select m.score_id, m.title, m.provisional_title, m.composer_label, m.period_code, m.period_provisional,
         m.key_tonic, m.key_mode, m.key_text, m.note, m.created_at,
         fc.file_count, ff.storage_path, ff.mime_type, os.thumbnail_path,
         m.within_count, m.within_masses, m.all_count, m.extra_count, m.last_performed,
         count(*) over () as total_count
  from matched as m
  left join public.musical_periods as mp on mp.code = m.period_code
  left join public.owned_scores as os on os.id = m.score_id
  left join lateral (
    select count(*)::integer as file_count
    from public.score_files as sf
    where sf.owned_score_id = m.score_id and sf.removed_at is null and sf.role = 'page'
  ) as fc on true
  left join lateral (
    select sf.storage_path, sf.mime_type
    from public.score_files as sf
    where sf.owned_score_id = m.score_id and sf.removed_at is null and sf.role = 'page'
    order by sf.page_no, sf.created_at, sf.id
    limit 1
  ) as ff on true
  order by
    case when p_sort = 'title' and not p_descending
      then lower(coalesce(nullif(btrim(m.title), ''), m.provisional_title)) end asc,
    case when p_sort = 'title' and p_descending
      then lower(coalesce(nullif(btrim(m.title), ''), m.provisional_title)) end desc,
    case when p_sort = 'composer' and not p_descending then lower(m.composer_label) end asc nulls last,
    case when p_sort = 'composer' and p_descending then lower(m.composer_label) end desc nulls last,
    case when p_sort = 'period' and not p_descending then mp.sort_order end asc nulls last,
    case when p_sort = 'period' and p_descending then mp.sort_order end desc nulls last,
    case when p_sort = 'count' and not p_descending then m.within_count end asc,
    case when p_sort = 'count' and p_descending then m.within_count end desc,
    -- C -> B by letter; inside one letter flat, natural, sharp. Unknown keys last.
    case when p_sort = 'key' and not p_descending then array_position(
      array['Cb','C','C#','Db','D','D#','Eb','E','E#','Fb','F','F#','Gb','G','G#','Ab','A','A#','Bb','B','B#'],
      m.key_tonic) end asc nulls last,
    case when p_sort = 'key' and p_descending then array_position(
      array['Cb','C','C#','Db','D','D#','Eb','E','E#','Fb','F','F#','Gb','G','G#','Ab','A','A#','Bb','B','B#'],
      m.key_tonic) end desc nulls last,
    case when p_sort = 'key' then array_position(
      array['major','minor','modal','ambiguous','atonal'], m.key_mode) end asc nulls last,
    case when p_sort = 'last_performed' and not p_descending then m.last_performed end asc nulls last,
    case when p_sort = 'last_performed' and p_descending then m.last_performed end desc nulls last,
    case when p_sort = 'created' and not p_descending then m.created_at end asc,
    case when p_sort = 'created' and p_descending then m.created_at end desc,
    lower(coalesce(nullif(btrim(m.title), ''), m.provisional_title)),
    m.score_id
  limit least(greatest(coalesce(p_limit, 50), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0)
$$;
