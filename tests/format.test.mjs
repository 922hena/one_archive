import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  addMonths,
  compareMasses,
  daysInMonth,
  formatDateTime,
  formatLongDate,
  formatMonthTitle,
  formatTime,
  formatZonedDate,
  liturgyLabel,
  massLiturgyTitle,
  monthGrid,
  observanceTitle,
  parseIsoDate,
  sortBySlotNo,
  todayIso,
  weekdayIndex
} from "../js/format.js";
import { hasKey, t } from "../js/i18n.js";

test("2026-10-21 is Wednesday and 2026-10-25 is Sunday", () => {
  assert.equal(weekdayIndex("2026-10-21"), 3);
  assert.equal(formatLongDate("2026-10-21"), "2026년 10월 21일(수요일)");
  assert.equal(weekdayIndex("2026-10-25"), 0);
  assert.equal(formatLongDate("2026-10-25"), "2026년 10월 25일(일요일)");
});

test("leap years", () => {
  assert.deepEqual(parseIsoDate("2028-02-29"), { year: 2028, month: 2, day: 29 });
  assert.equal(parseIsoDate("2026-02-29"), null);
  assert.equal(parseIsoDate("2100-02-29"), null);
  assert.equal(daysInMonth(2028, 2), 29);
  assert.equal(daysInMonth(2026, 2), 28);
  assert.equal(formatLongDate("2028-02-29"), "2028년 2월 29일(화요일)");
});

test("year end and month arithmetic", () => {
  assert.deepEqual(addMonths(2026, 12, 1), { year: 2027, month: 1 });
  assert.deepEqual(addMonths(2026, 1, -1), { year: 2025, month: 12 });
  assert.equal(formatLongDate("2026-12-31"), "2026년 12월 31일(목요일)");
  assert.equal(formatLongDate("2027-01-01"), "2027년 1월 1일(금요일)");
  assert.equal(formatMonthTitle(2026, 10), "2026년 10월");
});

test("invalid dates are rejected", () => {
  assert.equal(parseIsoDate("2026-13-01"), null);
  assert.equal(parseIsoDate("2026-10-32"), null);
  assert.equal(parseIsoDate("20261021"), null);
  assert.equal(formatLongDate("bad"), "");
});

test("month grid starts on Sunday and covers whole weeks", () => {
  const weeks = monthGrid(2026, 10);
  assert.equal(weeks[0][0].iso, "2026-09-27");
  assert.equal(weeks[0][4].iso, "2026-10-01");
  assert.ok(weeks.every((week) => week.length === 7));
  const days = weeks.flat().filter((cell) => cell.inMonth);
  assert.equal(days.length, 31);
  assert.equal(days.at(-1).iso, "2026-10-31");
  const oct25 = weeks.flat().find((cell) => cell.iso === "2026-10-25");
  assert.equal(weeks.find((week) => week.includes(oct25)).indexOf(oct25), 0);
});

test("Seoul time zone does not shift the day", () => {
  // 2026-10-20 15:30 UTC is 2026-10-21 00:30 in Seoul
  assert.equal(todayIso("Asia/Seoul", new Date("2026-10-20T15:30:00Z")), "2026-10-21");
  assert.equal(formatDateTime("2026-10-20T15:30:00Z"), "2026년 10월 21일(수요일) 00:30");
  assert.equal(formatZonedDate("2026-10-20T15:30:00Z"), "2026년 10월 21일(수요일)");
  assert.equal(formatTime("09:05:00"), "09:05");
  assert.equal(formatTime(null), "");
});

test("liturgy label uses color abbreviation", () => {
  assert.equal(liturgyLabel("연중 제30주일", "green"), "연중 제30주일 (녹)");
  assert.equal(liturgyLabel("대림 제1주일", "violet"), "대림 제1주일 (자)");
  assert.equal(liturgyLabel("모든 성인 대축일", "white"), "모든 성인 대축일 (백)");
  assert.equal(liturgyLabel(null, "green"), "");
});

test("liturgical titles are English once stored, Korean until then", () => {
  const allSaints = { name_ko: "모든 성인 대축일", name_en: "Solemnity of All Saints" };
  assert.deepEqual(observanceTitle(allSaints), { text: "Solemnity of All Saints", lang: "en" });
  assert.deepEqual(observanceTitle({ name_ko: "연중 제30주일", name_en: null }), { text: "연중 제30주일", lang: "ko" });
  assert.deepEqual(observanceTitle(null), { text: "", lang: "ko" });
});

test("an official Missa shows its day's title; a typed name stays as typed", () => {
  const observance = { name_ko: "모든 성인 대축일", name_en: "Solemnity of All Saints" };
  assert.equal(massLiturgyTitle({ liturgy_source: "official", celebration_name: "모든 성인 대축일", observance }).text, "Solemnity of All Saints");
  assert.equal(massLiturgyTitle({ liturgy_source: "official", celebration_name: "모든 성인 대축일", observance: null }).text, "모든 성인 대축일");
  assert.equal(massLiturgyTitle({ liturgy_source: "user", celebration_name: "본당 설립 기념 미사", observance: null }).text, "본당 설립 기념 미사");
  assert.equal(massLiturgyTitle({ liturgy_source: "unknown", celebration_name: null, observance: null }).text, "");
});

test("masses sort by start time, untimed last, then creation", () => {
  const masses = [
    { id: "c", start_time: null, created_at: "2026-10-01T00:00:00Z" },
    { id: "b", start_time: "11:00:00", created_at: "2026-10-01T00:00:00Z" },
    { id: "a", start_time: "09:00:00", created_at: "2026-10-02T00:00:00Z" },
    { id: "a2", start_time: "09:00:00", created_at: "2026-10-01T00:00:00Z" }
  ];
  assert.deepEqual([...masses].sort(compareMasses).map((mass) => mass.id), ["a2", "a", "b", "c"]);
});

test("music items keep fixed slot order", () => {
  const items = [{ slot: 17 }, { slot: 0 }, { slot: 12 }, { slot: 1 }];
  assert.deepEqual(sortBySlotNo(items, (item) => item.slot).map((item) => item.slot), [0, 1, 12, 17]);
});

test("i18n fills parameters and falls back to the key", () => {
  assert.equal(t("calendar.massCount", { count: 2 }), "2 Missae");
  assert.equal(t("no.such.key"), "no.such.key");
});

test("every t() key used in the app exists in the Korean dictionary", () => {
  const root = new URL("../js/", import.meta.url);
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".js")) files.push(path);
    }
  };
  walk(fileURLToPath(root));
  const html = ["../app.html", "../preview.html"].map((page) => readFileSync(new URL(page, import.meta.url), "utf8")).join("\n");
  const keys = new Set();
  const namespaces = "app|nav|common|format|liturgy|home|calendar|mass|roles|layouts|library|upload|viewer|camera|editor|pages|errors|preview";
  const keyLiteral = new RegExp(`"((?:${namespaces})\\.[a-zA-Z][\\w.]*)"`, "g");
  for (const file of files.filter((path) => !path.includes("locales"))) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(keyLiteral)) if (!match[1].endsWith(".html")) keys.add(match[1]);
  }
  assert.ok(keys.size > 100, `found only ${keys.size} keys`);
  for (const match of html.matchAll(/data-i18n(?:-label|-placeholder)?="([\w.]+)"/g)) keys.add(match[1]);
  const missing = [...keys].filter((key) => !hasKey(key));
  assert.deepEqual(missing, []);
});
