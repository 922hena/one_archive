-- English titles for the KR liturgical calendar (Language & Terminology Policy, PRD 3.1).
-- Reference data only: name_ko, colors, seasons and personal Mass records are not changed,
-- and only empty name_en values are filled.
-- Source: English titles shown beside the Korean ones in the GoodNews 매일미사 list
-- (maria.catholic.or.kr/mi_pr/missa/missa.asp, checked 2026-10-22). Where that list follows the
-- US calendar or has no English title, the Roman Missal (USCCB) wording is used:
--   2026-09-20  GoodNews shows the US Sunday; its title for this celebration in 2023-2025 is
--               "Memorial of Saints Andrew Kim Tae-gon, ..."; the Korean rank is Solemnity.
--   2026-10-18/2  Roman Missal, Masses for Various Needs 18 "For the Evangelization of Peoples".
--   2026-12-25  "Mass during the Night" (GoodNews 2024-2025), "Mass at Dawn" and
--               "Mass during the Day" (USCCB), joined the way the Korean titles are.

update public.liturgical_observances as o
   set name_en = v.name_en
  from (values
    (date '2026-09-06', 1, '연중 제23주일', 'Twenty-third Sunday in Ordinary Time'),
    (date '2026-09-13', 1, '연중 제24주일', 'Twenty-fourth Sunday in Ordinary Time'),
    (date '2026-09-20', 1, '성 김대건 안드레아 사제와 성 정하상 바오로와 동료 순교자들 대축일',
      'Solemnity of Saints Andrew Kim Tae-gon, Priest, and Paul Chong Ha-sang, and Companions, Martyrs'),
    (date '2026-09-27', 1, '연중 제26주일', 'Twenty-sixth Sunday in Ordinary Time'),
    (date '2026-10-04', 1, '연중 제27주일', 'Twenty-seventh Sunday in Ordinary Time'),
    (date '2026-10-11', 1, '연중 제28주일', 'Twenty-eighth Sunday in Ordinary Time'),
    (date '2026-10-18', 1, '연중 제29주일', 'Twenty-ninth Sunday in Ordinary Time'),
    (date '2026-10-18', 2, '민족들의 복음화를 위한 미사', 'For the Evangelization of Peoples'),
    (date '2026-10-21', 1, '연중 제29주간 수요일', 'Wednesday of the Twenty-ninth Week in Ordinary Time'),
    (date '2026-10-25', 1, '연중 제30주일', 'Thirtieth Sunday in Ordinary Time'),
    (date '2026-11-01', 1, '모든 성인 대축일', 'Solemnity of All Saints'),
    (date '2026-11-08', 1, '연중 제32주일', 'Thirty-second Sunday in Ordinary Time'),
    (date '2026-11-15', 1, '연중 제33주일', 'Thirty-third Sunday in Ordinary Time'),
    (date '2026-11-22', 1, '온 누리의 임금이신 우리 주 예수 그리스도 왕 대축일',
      'The Solemnity of Our Lord Jesus Christ, King of the Universe'),
    (date '2026-11-29', 1, '대림 제1주일', 'First Sunday of Advent'),
    (date '2026-12-06', 1, '대림 제2주일', 'Second Sunday of Advent'),
    (date '2026-12-08', 1, '한국 교회의 수호자, 원죄 없이 잉태되신 복되신 동정 마리아 대축일',
      'Solemnity of the Immaculate Conception of the Blessed Virgin Mary'),
    (date '2026-12-13', 1, '대림 제3주일', 'Third Sunday of Advent'),
    (date '2026-12-20', 1, '대림 제4주일', 'Fourth Sunday of Advent'),
    (date '2026-12-25', 1, '주님 성탄 대축일 - 밤 미사', 'The Nativity of the Lord (Christmas) - Mass during the Night'),
    (date '2026-12-25', 2, '주님 성탄 대축일 - 새벽 미사', 'The Nativity of the Lord (Christmas) - Mass at Dawn'),
    (date '2026-12-25', 3, '주님 성탄 대축일 - 낮 미사', 'The Nativity of the Lord (Christmas) - Mass during the Day'),
    (date '2026-12-27', 1, '예수, 마리아, 요셉의 성가정 축일', 'The Holy Family of Jesus, Mary and Joseph')
  ) as v(calendar_date, sort_order, name_ko, name_en)
 where o.calendar_code = 'KR'
   and o.calendar_date = v.calendar_date
   and o.sort_order = v.sort_order
   and o.name_ko = v.name_ko
   and o.name_en is null;
