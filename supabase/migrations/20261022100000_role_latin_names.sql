-- Music item names follow the Language & Terminology Policy (PRD 3.3).
-- Reference data only: personal Mass slots and layouts point to role_id, so no user data changes.
-- 05: official IGMR heading (no. 62); Alleluia is not sung in Lent.
-- 16: no attested Latin in the liturgical books, so the screen falls back to name_en (Recessional).

update public.liturgical_roles
   set name_la = 'Acclamatio ante lectionem Evangelii'
 where code = 'gospel_acclamation' and name_la = 'Alleluia';

update public.liturgical_roles
   set name_la = null
 where code = 'recessional' and name_la = 'Cantus recessionalis';
