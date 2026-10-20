-- ONE ARCHIVE Phase 1 / migration 4 of 4: reference data
-- (a) 18 fixed music items, (b) official liturgical titles for 20 dates in Sep-Dec 2026.
-- Calendar rows hold only the heading name + color from the official daily page
-- (https://missa.cbck.or.kr/DailyMissa/YYYYMMDD); no body text. Checked 2026-10-21.
-- season_code is filled only when the official heading itself names the season
-- (연중, 대림, 성탄); otherwise it stays NULL ("미확인") rather than being guessed.

insert into public.liturgical_roles (code, slot_no, name_ko, name_la, name_en) values
  ('prelude',                     0, '전주',                   'Praeludium',               'Prelude'),
  ('entrance',                    1, '입당',                   'Introitus',                'Entrance'),
  ('kyrie',                       2, '자비송',                 'Kyrie',                    'Kyrie'),
  ('gloria',                      3, '대영광송',               'Gloria',                   'Gloria'),
  ('responsorial_psalm',          4, '화답송',                 'Psalmus responsorius',     'Responsorial Psalm'),
  ('gospel_acclamation',          5, '복음환호송',             'Alleluia',                 'Gospel Acclamation'),
  ('universal_prayer_response',   6, '보편지향기도응답',       'Oratio universalis',       'Universal Prayer Response'),
  ('offertory',                   7, '봉헌성가',               'Offertorium',              'Offertory'),
  ('sanctus',                     8, '거룩하시도다',           'Sanctus',                  'Sanctus'),
  ('mystery_of_faith',            9, '신앙의 신비여',          'Mysterium fidei',          'Mystery of Faith'),
  ('great_amen',                 10, '마침영광송 아멘',        'Amen',                     'Great Amen'),
  ('pater_noster',               11, '주님의 기도',            'Pater noster',             'Lord''s Prayer'),
  ('quia_tuum_est_regnum',       12, '주님께 나라와',          'Quia tuum est regnum',     'For the kingdom'),
  ('agnus_dei',                  13, '하느님의 어린양',        'Agnus Dei',                'Agnus Dei'),
  ('communion',                  14, '성체성가',               'Communio',                 'Communion'),
  ('post_communion',             15, '영성체 후 묵상/찬미가',  'Hymnus post Communionem',  'Post-Communion Meditation/Hymn'),
  ('recessional',                16, '파견성가',               'Cantus recessionalis',     'Recessional'),
  ('postlude',                   17, '후주',                   'Postludium',               'Postlude');

insert into public.liturgical_observances
  (calendar_code, calendar_date, sort_order, name_ko, season_code, color_code, rank_code,
   source_url, verification_status, verified_at)
select 'KR', v.d::date, v.n, v.name, v.season, v.color, v.rank,
       'https://missa.cbck.or.kr/DailyMissa/' || to_char(v.d::date, 'YYYYMMDD'),
       'source_checked', '2026-10-21T00:00:00+09:00'::timestamptz
from (values
  ('2026-09-06', 1, '연중 제23주일', 'ordinary', 'green', 'sunday'),
  ('2026-09-13', 1, '연중 제24주일', 'ordinary', 'green', 'sunday'),
  ('2026-09-20', 1, '성 김대건 안드레아 사제와 성 정하상 바오로와 동료 순교자들 대축일', null, 'red', 'solemnity'),
  ('2026-09-27', 1, '연중 제26주일', 'ordinary', 'green', 'sunday'),
  ('2026-10-04', 1, '연중 제27주일', 'ordinary', 'green', 'sunday'),
  ('2026-10-11', 1, '연중 제28주일', 'ordinary', 'green', 'sunday'),
  ('2026-10-18', 1, '연중 제29주일', 'ordinary', 'green', 'sunday'),
  ('2026-10-18', 2, '민족들의 복음화를 위한 미사', null, 'green', 'votive'),
  ('2026-10-21', 1, '연중 제29주간 수요일', 'ordinary', 'green', 'weekday'),
  ('2026-10-25', 1, '연중 제30주일', 'ordinary', 'green', 'sunday'),
  ('2026-11-01', 1, '모든 성인 대축일', null, 'white', 'solemnity'),
  ('2026-11-08', 1, '연중 제32주일', 'ordinary', 'green', 'sunday'),
  ('2026-11-15', 1, '연중 제33주일', 'ordinary', 'green', 'sunday'),
  ('2026-11-22', 1, '온 누리의 임금이신 우리 주 예수 그리스도 왕 대축일', null, 'white', 'solemnity'),
  ('2026-11-29', 1, '대림 제1주일', 'advent', 'violet', 'sunday'),
  ('2026-12-06', 1, '대림 제2주일', 'advent', 'violet', 'sunday'),
  ('2026-12-08', 1, '한국 교회의 수호자, 원죄 없이 잉태되신 복되신 동정 마리아 대축일', null, 'white', 'solemnity'),
  ('2026-12-13', 1, '대림 제3주일', 'advent', 'violet', 'sunday'),
  ('2026-12-20', 1, '대림 제4주일', 'advent', 'violet', 'sunday'),
  ('2026-12-25', 1, '주님 성탄 대축일 - 밤 미사', 'christmas', 'white', 'solemnity'),
  ('2026-12-25', 2, '주님 성탄 대축일 - 새벽 미사', 'christmas', 'white', 'solemnity'),
  ('2026-12-25', 3, '주님 성탄 대축일 - 낮 미사', 'christmas', 'white', 'solemnity'),
  ('2026-12-27', 1, '예수, 마리아, 요셉의 성가정 축일', null, 'white', 'feast')
) as v(d, n, name, season, color, rank);
