-- Score PDF + thumbnail storage (approved 2026-10-23).
-- Adds only: owned_scores.thumbnail_path, score_files.role, image/webp in the scores bucket,
-- and search_scores returning thumbnail_path. No rows or files are changed or deleted;
-- existing score_files rows all become role = 'page'.

alter table public.owned_scores add column thumbnail_path text;
alter table public.owned_scores add constraint owned_scores_thumbnail_path_check check (
  thumbnail_path is null
  or thumbnail_path ~ ('^' || user_id::text || '/' || id::text || '/thumb-[0-9a-f-]{36}\.(webp|jpg)$')
);

alter table public.score_files add column role text not null default 'page';
alter table public.score_files add constraint score_files_role_check check (role in ('page', 'original'));

-- Column-level grants are used on these tables, so new columns need their own grants.
grant select, insert, update (thumbnail_path) on public.owned_scores to authenticated;
grant select, insert (role) on public.score_files to authenticated;

update storage.buckets
   set allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
 where id = 'scores';

-- search_scores: same as 20261022150300 plus thumbnail_path, and only role = 'page' files are counted.
drop function public.search_scores(jsonb, text, boolean, integer, integer);

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

revoke execute on function public.search_scores(jsonb, text, boolean, integer, integer) from public, anon;
grant execute on function public.search_scores(jsonb, text, boolean, integer, integer) to authenticated;
