-- YEAR SCORE advanced search 4/4: search functions (PRD 4.13, decisions D1 and D2)
-- Adds functions only. They run with the caller's rights (security invoker), so the existing RLS
-- policies decide what each member can see. No table, row, policy or auth data is changed.
-- Undo: drop the six functions below.
--
-- p_filters (every key optional; an empty list means "no filter"):
--   q, q_key           text in title, file name or composer; q_key = q in lower case without accents (composer aliases)
--   seasons            ["advent","christmas","ordinary","lent","easter"]
--   observance_names   English or Korean liturgical day names; the same name matches every year
--   years, year_from, year_to, months, date_from, date_to     calendar dates of the Missa
--   venue_ids          My Places
--   role_ids           Music Parts (liturgical_roles.id)
--   composer_ids, composer_names, periods, include_provisional_period (default true), keys [{"tonic":"D","mode":"minor"}]
--   count              {"op":"eq|gte|lte","value":n} or {"op":"between","min":a,"max":b}, counted inside the filters above
--   extra_count        the same plus "scope":"all" (all time) or "scope":"venue" with "venue_ids"
--
-- Same record rule (PRD 4.13.4.1): season, liturgical day, date, place and Music Part must all match
-- one and the same played song. Zero counts use every score as the base, so scores with no record stay in.

-- ---------------------------------------------------------------- helpers
create function public.search_list(j jsonb) returns text[]
language sql immutable set search_path = '' as $$
  select case
    when jsonb_typeof(j) = 'array' and jsonb_array_length(j) > 0 then array(select jsonb_array_elements_text(j))
  end
$$;

create function public.count_condition_met(n integer, cond jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select case cond->>'op'
    when 'eq' then n = (cond->>'value')::integer
    when 'gte' then n >= (cond->>'value')::integer
    when 'lte' then n <= (cond->>'value')::integer
    when 'between' then n between (cond->>'min')::integer and (cond->>'max')::integer
    else false
  end
$$;

-- ---------------------------------------------------------------- played songs matching the Missa filters
create function public.search_entries(p_filters jsonb default '{}'::jsonb)
returns setof public.performed_entries
language sql stable set search_path = '' as $$
  with f as (
    select
      public.search_list(p_filters->'seasons') as seasons,
      public.search_list(p_filters->'observance_names') as observance_names,
      public.search_list(p_filters->'years')::integer[] as years,
      (p_filters->>'year_from')::integer as year_from,
      (p_filters->>'year_to')::integer as year_to,
      public.search_list(p_filters->'months')::integer[] as months,
      (p_filters->>'date_from')::date as date_from,
      (p_filters->>'date_to')::date as date_to,
      public.search_list(p_filters->'venue_ids')::uuid[] as venue_ids,
      public.search_list(p_filters->'role_ids')::uuid[] as role_ids
  )
  select pe.*
  from public.performed_entries as pe
  cross join f
  left join public.liturgical_observances as o on o.id = pe.observance_id
  where (f.seasons is null or pe.season_code = any (f.seasons))
    and (f.observance_names is null
         or o.name_en = any (f.observance_names)
         or o.name_ko = any (f.observance_names)
         or pe.celebration_name = any (f.observance_names))
    and ((f.years is null and f.year_from is null and f.year_to is null)
         or extract(year from pe.local_date)::integer = any (coalesce(f.years, '{}'))
         or ((f.year_from is not null or f.year_to is not null)
             and extract(year from pe.local_date)::integer
                 between coalesce(f.year_from, 1) and coalesce(f.year_to, 9999)))
    and (f.months is null or extract(month from pe.local_date)::integer = any (f.months))
    and (f.date_from is null or pe.local_date >= f.date_from)
    and (f.date_to is null or pe.local_date <= f.date_to)
    and (f.venue_ids is null or pe.venue_id = any (f.venue_ids))
    and (f.role_ids is null or pe.role_id = any (f.role_ids))
$$;

-- ---------------------------------------------------------------- scores matching the score filters
-- Period: the member's choice, else the composition year, else the composer's general period (provisional).
create function public.search_pool(p_filters jsonb default '{}'::jsonb)
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
      os.created_at
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

-- ---------------------------------------------------------------- Scores target
-- p_sort: title | composer | period | count | key | last_performed | created. Sorted over all results, then paged.
create function public.search_scores(
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
  )
  select m.score_id, m.title, m.provisional_title, m.composer_label, m.period_code, m.period_provisional,
         m.key_tonic, m.key_mode, m.key_text, m.note, m.created_at,
         fc.file_count, ff.storage_path, ff.mime_type,
         m.within_count, m.within_masses, m.all_count, m.extra_count, m.last_performed,
         count(*) over () as total_count
  from matched as m
  left join public.musical_periods as mp on mp.code = m.period_code
  left join lateral (
    select count(*)::integer as file_count
    from public.score_files as sf
    where sf.owned_score_id = m.score_id and sf.removed_at is null
  ) as fc on true
  left join lateral (
    select sf.storage_path, sf.mime_type
    from public.score_files as sf
    where sf.owned_score_id = m.score_id and sf.removed_at is null
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

-- ---------------------------------------------------------------- Performance History target
create function public.search_history(
  p_filters jsonb default '{}'::jsonb,
  p_descending boolean default true,
  p_limit integer default 100,
  p_offset integer default 0
)
returns table (
  entry_id uuid,
  mass_event_id uuid,
  local_date date,
  start_time time,
  score_id uuid,
  title text,
  provisional_title text,
  composer_label text,
  role_id uuid,
  part_display_name text,
  venue_label text,
  note text,
  total_count bigint
)
language sql stable set search_path = '' as $$
  select e.entry_id, e.mass_event_id, e.local_date, e.start_time,
         p.score_id, p.title, p.provisional_title, p.composer_label,
         e.role_id, e.part_display_name, e.venue_label, e.note,
         count(*) over () as total_count
  from public.search_entries(p_filters) as e
  join public.search_pool(p_filters) as p on p.score_id = e.owned_score_id
  order by
    case when p_descending then e.local_date end desc,
    case when not p_descending then e.local_date end asc,
    case when p_descending then e.start_time end desc nulls last,
    case when not p_descending then e.start_time end asc nulls last,
    e.entry_id
  limit least(greatest(coalesce(p_limit, 100), 1), 500)
  offset greatest(coalesce(p_offset, 0), 0)
$$;

-- ---------------------------------------------------------------- privileges
revoke execute on function
  public.search_list(jsonb),
  public.count_condition_met(integer, jsonb),
  public.search_entries(jsonb),
  public.search_pool(jsonb),
  public.search_scores(jsonb, text, boolean, integer, integer),
  public.search_history(jsonb, boolean, integer, integer)
from public, anon;

grant execute on function
  public.search_list(jsonb),
  public.count_condition_met(integer, jsonb),
  public.search_entries(jsonb),
  public.search_pool(jsonb),
  public.search_scores(jsonb, text, boolean, integer, integer),
  public.search_history(jsonb, boolean, integer, integer)
to authenticated;
