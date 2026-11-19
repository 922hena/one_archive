-- Music Parts: put the post-Communion special hymn before Communio.
-- Member request 2026-11-19: many choirs sing the special hymn first, then Communio.
-- Role ids stay the same (score links and saved selections keep their connections).
-- Only slot_no and the 1..n display order (sort_order) change.
--
-- slot_no is UNIQUE and CHECK (0..18). Every value 0..18 is taken, so widen
-- the check one step, park Communio on 19, then restore the original check.

alter table public.liturgical_roles
  drop constraint liturgical_roles_slot_no_check;

alter table public.liturgical_roles
  add constraint liturgical_roles_slot_no_check
  check ((slot_no >= 0) and (slot_no <= 19));

update public.liturgical_roles set slot_no = 19 where code = 'communion' and slot_no = 14;
update public.liturgical_roles set slot_no = 14 where code = 'post_communion' and slot_no = 15;
update public.liturgical_roles set slot_no = 15 where code = 'communion' and slot_no = 19;

alter table public.liturgical_roles
  drop constraint liturgical_roles_slot_no_check;

alter table public.liturgical_roles
  add constraint liturgical_roles_slot_no_check
  check ((slot_no >= 0) and (slot_no <= 18));

-- Remumber every Missa and every saved Music Parts selection to the new official order.
-- Linked scores stay on the same role_id; only the visible 01, 02, … numbers move.
update public.mass_music_slots as slot
   set sort_order = ordered.position
  from (
    select s.id, row_number() over (partition by s.mass_event_id order by r.slot_no) as position
      from public.mass_music_slots as s
      join public.liturgical_roles as r on r.id = s.role_id
  ) as ordered
 where ordered.id = slot.id;

update public.user_mass_layout_items as item
   set sort_order = ordered.position
  from (
    select i.id, row_number() over (partition by i.layout_id order by r.slot_no) as position
      from public.user_mass_layout_items as i
      join public.liturgical_roles as r on r.id = i.role_id
  ) as ordered
 where ordered.id = item.id;
