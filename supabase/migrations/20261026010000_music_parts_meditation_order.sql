-- Music Parts: split "영성체 후 묵상/찬미가" (PRD 4.13.2.8, decision C2) and keep the member's own order
-- for each saved selection and each Missa. Approved by the member on 2026-10-26.
-- Nothing is deleted. Role ids stay the same, so saved selections and Missa records keep their links.

-- 1) Room for a 19th music item
alter table public.liturgical_roles drop constraint liturgical_roles_slot_no_check;
alter table public.liturgical_roles add constraint liturgical_roles_slot_no_check check (slot_no between 0 and 18);

-- 2) Recessional and Postlude move down one place (Postlude first: slot numbers must stay unique)
update public.liturgical_roles set slot_no = 18 where code = 'postlude' and slot_no = 17;
update public.liturgical_roles set slot_no = 17 where code = 'recessional' and slot_no = 16;

-- 3) The existing item becomes the special hymn after Communion (06 in the PRD table)
update public.liturgical_roles
   set name_ko = '영성체 후 특별찬미가',
       name_la = 'Cantus post Communionem',
       name_en = 'Post-Communion Hymn'
 where code = 'post_communion';

-- 4) New item right below it: meditation after Communion (05 in the PRD table; placed below by the member)
insert into public.liturgical_roles (code, slot_no, name_ko, name_la, name_en)
values ('meditation', 16, '영성체 후 묵상', 'Meditatio post Communionem', 'Meditation')
on conflict (code) do nothing;

-- 5) The member's own order (1, 2, 3 ...). Existing rows keep today's order.
alter table public.user_mass_layout_items add column if not exists sort_order smallint not null default 0;
alter table public.mass_music_slots add column if not exists sort_order smallint not null default 0;

update public.user_mass_layout_items as item
   set sort_order = ordered.position
  from (
    select i.id, row_number() over (partition by i.layout_id order by r.slot_no) as position
      from public.user_mass_layout_items as i
      join public.liturgical_roles as r on r.id = i.role_id
  ) as ordered
 where ordered.id = item.id;

update public.mass_music_slots as slot
   set sort_order = ordered.position
  from (
    select s.id, row_number() over (partition by s.mass_event_id order by r.slot_no) as position
      from public.mass_music_slots as s
      join public.liturgical_roles as r on r.id = s.role_id
  ) as ordered
 where ordered.id = slot.id;
