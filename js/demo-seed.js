// Reference rows and sample data for the demo page (demo.html).
// Reference rows are copies of operator data in the database (read only). The sample places, Music Parts
// and Missae exist only in the visitor's browser tab; nothing is written to the database.
// There are no sample Scores: visitors upload their own.

import { PREVIEW_OBSERVANCES } from "./preview-data.js";
import { liturgyFields, shiftIso } from "./recurrence.js";
import { weekdayIndex } from "./format.js";

export const DEMO_USER_ID = "de000000-0000-4000-8000-000000000001";

// public.liturgical_roles, copied 2026-10-27.
export const DEMO_ROLES = [
  { id: "6a6a6bff-0834-4f3a-8b29-49242776088f", code: "prelude", slot_no: 0, name_ko: "전주", name_la: "Praeludium", name_en: "Prelude" },
  { id: "970db719-4cb4-4a14-bf26-5b36887d335d", code: "entrance", slot_no: 1, name_ko: "입당성가", name_la: "Introitus", name_en: "Entrance" },
  { id: "9c68bccb-7c85-47ff-b4b5-598e14132848", code: "kyrie", slot_no: 2, name_ko: "자비송", name_la: "Kyrie", name_en: "Kyrie" },
  { id: "cfe79c14-99e8-409a-9daf-f2de7a2a39e7", code: "gloria", slot_no: 3, name_ko: "대영광송", name_la: "Gloria", name_en: "Gloria" },
  { id: "edc4808a-b98e-49a4-b7f9-068253c735a0", code: "responsorial_psalm", slot_no: 4, name_ko: "화답송", name_la: "Psalmus responsorius", name_en: "Responsorial Psalm" },
  { id: "d33ab55b-c82d-4f8f-a24a-a3897733a1f7", code: "gospel_acclamation", slot_no: 5, name_ko: "복음환호송", name_la: "Acclamatio ante lectionem Evangelii", name_en: "Gospel Acclamation" },
  { id: "c26cb7b7-e6fa-497d-9927-7d14692e2fc9", code: "universal_prayer_response", slot_no: 6, name_ko: "보편지향기도응답", name_la: "Oratio universalis", name_en: "Universal Prayer Response" },
  { id: "b745af92-64f2-4cf8-bdd8-e237f8b68ebf", code: "offertory", slot_no: 7, name_ko: "봉헌성가", name_la: "Offertorium", name_en: "Offertory" },
  { id: "049ff541-afc0-4542-bfd6-fb3f5828a160", code: "sanctus", slot_no: 8, name_ko: "거룩하시도다", name_la: "Sanctus", name_en: "Sanctus" },
  { id: "8b073524-d327-4bdd-b9c1-0f9dee743fe6", code: "mystery_of_faith", slot_no: 9, name_ko: "신앙의 신비여", name_la: "Mysterium fidei", name_en: "Mystery of Faith" },
  { id: "d9bfb56b-7252-41a1-9c76-33fdd90e7d26", code: "great_amen", slot_no: 10, name_ko: "마침영광송 아멘", name_la: "Amen", name_en: "Great Amen" },
  { id: "da4990f3-7051-4fb6-9f07-691aff207395", code: "pater_noster", slot_no: 11, name_ko: "주님의 기도", name_la: "Pater noster", name_en: "Lord's Prayer" },
  { id: "eef68785-288f-48a5-b3c4-c838282406a5", code: "quia_tuum_est_regnum", slot_no: 12, name_ko: "주님께 나라와", name_la: "Quia tuum est regnum", name_en: "For the kingdom" },
  { id: "94d6ca5b-5c8a-4322-98a8-3c4e20c56606", code: "agnus_dei", slot_no: 13, name_ko: "하느님의 어린양", name_la: "Agnus Dei", name_en: "Agnus Dei" },
  { id: "220ef16f-c925-441c-82bb-dbf5c1d209d2", code: "communion", slot_no: 14, name_ko: "성체성가", name_la: "Communio", name_en: "Communion" },
  { id: "11d5c05d-efdd-4074-8540-f39d2b807759", code: "post_communion", slot_no: 15, name_ko: "영성체 후 특별찬미가", name_la: "Cantus post Communionem", name_en: "Post-Communion Hymn" },
  { id: "10160f28-4195-4ed3-8d40-04fdc39eb48f", code: "meditation", slot_no: 16, name_ko: "영성체 후 묵상", name_la: "Meditatio post Communionem", name_en: "Meditation" },
  { id: "4a7858ff-3a28-45e2-ba78-201788b6e9b1", code: "recessional", slot_no: 17, name_ko: "파견성가", name_la: null, name_en: "Recessional" },
  { id: "1c15bdae-a8fc-40cc-8edd-3389c4f2439f", code: "postlude", slot_no: 18, name_ko: "후주", name_la: "Postludium", name_en: "Postlude" }
];

// public.musical_periods (supabase/migrations/20261022150100_search_score_metadata.sql).
export const DEMO_PERIODS = [
  { code: "renaissance", name_en: "Renaissance", start_year: 1450, end_year: 1601, sort_order: 1 },
  { code: "baroque", name_en: "Baroque", start_year: 1601, end_year: 1751, sort_order: 2 },
  { code: "classical", name_en: "Classical", start_year: 1751, end_year: 1801, sort_order: 3 },
  { code: "romantic", name_en: "Romantic", start_year: 1801, end_year: 1901, sort_order: 4 },
  { code: "modern", name_en: "Modern", start_year: 1901, end_year: null, sort_order: 5 }
];

export const DEMO_OBSERVANCES = PREVIEW_OBSERVANCES.map((row) => ({
  calendar_code: "KR",
  name_la: null,
  verification_status: "source_checked",
  ...row
}));

export function demoReference() {
  return { liturgical_roles: DEMO_ROLES, liturgical_observances: DEMO_OBSERVANCES, musical_periods: DEMO_PERIODS };
}

const SUNDAY_PARTS = [
  "entrance", "kyrie", "gloria", "responsorial_psalm", "gospel_acclamation", "offertory",
  "sanctus", "agnus_dei", "communion", "meditation", "recessional"
];
const WEEKDAY_PARTS = ["entrance", "communion", "recessional"];

function observanceOn(date) {
  return DEMO_OBSERVANCES.filter((row) => row.calendar_date === date).sort((a, b) => a.sort_order - b.sort_order)[0] ?? null;
}

// Fills an empty demo tab: two saved Music Parts, two places, Sunday Missae from four weeks ago to three weeks
// ahead and one weekday Missa, all without Scores.
// db: createDb(demo client), today: "YYYY-MM-DD" in Korea.
export async function seedDemo({ db, today }) {
  const roleByCode = new Map(DEMO_ROLES.map((role) => [role.code, role]));
  const items = (codes) => codes.map((code, index) => ({ role_id: roleByCode.get(code).id, display_name: null, sort_order: index + 1 }));

  const sundayLayout = await db.createLayout("Sunday", items(SUNDAY_PARTS));
  const weekdayLayout = await db.createLayout("Weekday", items(WEEKDAY_PARTS));
  const church = await db.createVenue("Main Church", sundayLayout);
  const chapel = await db.createVenue("Chapel", weekdayLayout);

  const lastSunday = shiftIso(today, -weekdayIndex(today));
  for (let week = -4; week <= 3; week += 1) {
    const date = shiftIso(lastSunday, week * 7);
    await db.createMass(
      {
        local_date: date,
        title: null,
        start_time: "11:00:00",
        venue_name: church.name,
        venue_id: church.id,
        layout_id: sundayLayout,
        notes: null,
        series_id: null,
        series_locked: false,
        ...liturgyFields(observanceOn(date))
      },
      items(SUNDAY_PARTS)
    );
  }

  const toWednesday = (3 - weekdayIndex(today) + 7) % 7 || 7;
  const weekdayDate = shiftIso(today, toWednesday);
  await db.createMass(
    {
      local_date: weekdayDate,
      title: null,
      start_time: "07:00:00",
      venue_name: chapel.name,
      venue_id: chapel.id,
      layout_id: weekdayLayout,
      notes: null,
      series_id: null,
      series_locked: false,
      ...liturgyFields(observanceOn(weekdayDate))
    },
    items(WEEKDAY_PARTS)
  );
}
