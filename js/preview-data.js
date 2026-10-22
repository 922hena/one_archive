// Copy of the verified KR rows in liturgical_observances (Korean title and color: 매일미사, missa.cbck.or.kr;
// English title: supabase/migrations/20261022120000_observance_english_names.sql).
// Signed-out visitors cannot read that table, so the landing preview shows this copy.
// Only copy rows that are already verified in the database; never add dates by hand.
export const PREVIEW_OBSERVANCES = [
  { calendar_date: "2026-09-06", sort_order: 1, name_ko: "연중 제23주일", name_en: "Twenty-third Sunday in Ordinary Time", color_code: "green", source_url: "https://missa.cbck.or.kr/DailyMissa/20260906" },
  { calendar_date: "2026-09-13", sort_order: 1, name_ko: "연중 제24주일", name_en: "Twenty-fourth Sunday in Ordinary Time", color_code: "green", source_url: "https://missa.cbck.or.kr/DailyMissa/20260913" },
  { calendar_date: "2026-09-20", sort_order: 1, name_ko: "성 김대건 안드레아 사제와 성 정하상 바오로와 동료 순교자들 대축일", name_en: "Solemnity of Saints Andrew Kim Tae-gon, Priest, and Paul Chong Ha-sang, and Companions, Martyrs", color_code: "red", source_url: "https://missa.cbck.or.kr/DailyMissa/20260920" },
  { calendar_date: "2026-09-27", sort_order: 1, name_ko: "연중 제26주일", name_en: "Twenty-sixth Sunday in Ordinary Time", color_code: "green", source_url: "https://missa.cbck.or.kr/DailyMissa/20260927" },
  { calendar_date: "2026-10-04", sort_order: 1, name_ko: "연중 제27주일", name_en: "Twenty-seventh Sunday in Ordinary Time", color_code: "green", source_url: "https://missa.cbck.or.kr/DailyMissa/20261004" },
  { calendar_date: "2026-10-11", sort_order: 1, name_ko: "연중 제28주일", name_en: "Twenty-eighth Sunday in Ordinary Time", color_code: "green", source_url: "https://missa.cbck.or.kr/DailyMissa/20261011" },
  { calendar_date: "2026-10-18", sort_order: 1, name_ko: "연중 제29주일", name_en: "Twenty-ninth Sunday in Ordinary Time", color_code: "green", source_url: "https://missa.cbck.or.kr/DailyMissa/20261018" },
  { calendar_date: "2026-10-18", sort_order: 2, name_ko: "민족들의 복음화를 위한 미사", name_en: "For the Evangelization of Peoples", color_code: "green", source_url: "https://missa.cbck.or.kr/DailyMissa/20261018" },
  { calendar_date: "2026-10-21", sort_order: 1, name_ko: "연중 제29주간 수요일", name_en: "Wednesday of the Twenty-ninth Week in Ordinary Time", color_code: "green", source_url: "https://missa.cbck.or.kr/DailyMissa/20261021" },
  { calendar_date: "2026-10-25", sort_order: 1, name_ko: "연중 제30주일", name_en: "Thirtieth Sunday in Ordinary Time", color_code: "green", source_url: "https://missa.cbck.or.kr/DailyMissa/20261025" },
  { calendar_date: "2026-11-01", sort_order: 1, name_ko: "모든 성인 대축일", name_en: "Solemnity of All Saints", color_code: "white", source_url: "https://missa.cbck.or.kr/DailyMissa/20261101" },
  { calendar_date: "2026-11-08", sort_order: 1, name_ko: "연중 제32주일", name_en: "Thirty-second Sunday in Ordinary Time", color_code: "green", source_url: "https://missa.cbck.or.kr/DailyMissa/20261108" },
  { calendar_date: "2026-11-15", sort_order: 1, name_ko: "연중 제33주일", name_en: "Thirty-third Sunday in Ordinary Time", color_code: "green", source_url: "https://missa.cbck.or.kr/DailyMissa/20261115" },
  { calendar_date: "2026-11-22", sort_order: 1, name_ko: "온 누리의 임금이신 우리 주 예수 그리스도 왕 대축일", name_en: "The Solemnity of Our Lord Jesus Christ, King of the Universe", color_code: "white", source_url: "https://missa.cbck.or.kr/DailyMissa/20261122" },
  { calendar_date: "2026-11-29", sort_order: 1, name_ko: "대림 제1주일", name_en: "First Sunday of Advent", color_code: "violet", source_url: "https://missa.cbck.or.kr/DailyMissa/20261129" },
  { calendar_date: "2026-12-06", sort_order: 1, name_ko: "대림 제2주일", name_en: "Second Sunday of Advent", color_code: "violet", source_url: "https://missa.cbck.or.kr/DailyMissa/20261206" },
  { calendar_date: "2026-12-08", sort_order: 1, name_ko: "한국 교회의 수호자, 원죄 없이 잉태되신 복되신 동정 마리아 대축일", name_en: "Solemnity of the Immaculate Conception of the Blessed Virgin Mary", color_code: "white", source_url: "https://missa.cbck.or.kr/DailyMissa/20261208" },
  { calendar_date: "2026-12-13", sort_order: 1, name_ko: "대림 제3주일", name_en: "Third Sunday of Advent", color_code: "violet", source_url: "https://missa.cbck.or.kr/DailyMissa/20261213" },
  { calendar_date: "2026-12-20", sort_order: 1, name_ko: "대림 제4주일", name_en: "Fourth Sunday of Advent", color_code: "violet", source_url: "https://missa.cbck.or.kr/DailyMissa/20261220" },
  { calendar_date: "2026-12-25", sort_order: 1, name_ko: "주님 성탄 대축일 - 밤 미사", name_en: "The Nativity of the Lord (Christmas) - Mass during the Night", color_code: "white", source_url: "https://missa.cbck.or.kr/DailyMissa/20261225" },
  { calendar_date: "2026-12-25", sort_order: 2, name_ko: "주님 성탄 대축일 - 새벽 미사", name_en: "The Nativity of the Lord (Christmas) - Mass at Dawn", color_code: "white", source_url: "https://missa.cbck.or.kr/DailyMissa/20261225" },
  { calendar_date: "2026-12-25", sort_order: 3, name_ko: "주님 성탄 대축일 - 낮 미사", name_en: "The Nativity of the Lord (Christmas) - Mass during the Day", color_code: "white", source_url: "https://missa.cbck.or.kr/DailyMissa/20261225" },
  { calendar_date: "2026-12-27", sort_order: 1, name_ko: "예수, 마리아, 요셉의 성가정 축일", name_en: "The Holy Family of Jesus, Mary and Joseph", color_code: "white", source_url: "https://missa.cbck.or.kr/DailyMissa/20261227" }
];
