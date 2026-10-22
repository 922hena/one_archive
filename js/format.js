import { t } from "./i18n.js";

export const APP_TIME_ZONE = "Asia/Seoul";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const COLOR_SWATCHES = {
  green: "#2f7d4f",
  white: "#ffffff",
  violet: "#6b3fa0",
  red: "#b3261e",
  rose: "#d98aa5"
};

function pad2(value) {
  return String(value).padStart(2, "0");
}

export function parseIsoDate(iso) {
  const match = ISO_DATE.exec(String(iso ?? ""));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return { year, month, day };
}

export function toIsoDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

export function weekdayIndex(iso) {
  const parts = parseIsoDate(iso);
  if (!parts) return -1;
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

export function weekdayName(index) {
  return t(`format.weekdays.${index}`);
}

export function weekdayShort(index) {
  return t(`format.weekdaysShort.${index}`);
}

export function formatLongDate(iso) {
  const parts = parseIsoDate(iso);
  if (!parts) return "";
  return t("format.longDate", { ...parts, weekday: weekdayName(weekdayIndex(iso)) });
}

export function formatMonthTitle(year, month) {
  return t("format.monthTitle", { year, month });
}

export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function addMonths(year, month, delta) {
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

export function monthRange(year, month) {
  return { from: toIsoDate(year, month, 1), to: toIsoDate(year, month, daysInMonth(year, month)) };
}

export function monthGrid(year, month) {
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const total = daysInMonth(year, month);
  const cellCount = Math.ceil((firstWeekday + total) / 7) * 7;
  const weeks = [];
  for (let index = 0; index < cellCount; index += 1) {
    const iso = toIsoDate(year, month, index - firstWeekday + 1);
    const parts = parseIsoDate(iso);
    if (index % 7 === 0) weeks.push([]);
    weeks[weeks.length - 1].push({ iso, day: parts.day, inMonth: parts.month === month && parts.year === year });
  }
  return weeks;
}

function zonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

export function todayIso(timeZone = APP_TIME_ZONE, now = new Date()) {
  const parts = zonedParts(now, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function formatTime(value) {
  const match = /^(\d{2}):(\d{2})/.exec(String(value ?? ""));
  return match ? `${match[1]}:${match[2]}` : "";
}

export function hourValue(hour) {
  return `${pad2(hour)}:00`;
}

export function formatHourLabel(hour) {
  if (hour === 12) return "12:00 noon";
  if (hour < 12) return `${hour}:00 AM`;
  return `${hour - 12}:00 PM`;
}

export function isHourChoice(value) {
  const match = /^(\d{2}):00/.exec(String(value ?? ""));
  if (!match) return false;
  const hour = Number(match[1]);
  return hour >= 6 && hour <= 23;
}

export function formatDateTime(value, timeZone = APP_TIME_ZONE) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = zonedParts(date, timeZone);
  const iso = `${parts.year}-${parts.month}-${parts.day}`;
  return `${formatLongDate(iso)} ${parts.hour}:${parts.minute}`;
}

export function formatZonedDate(value, timeZone = APP_TIME_ZONE) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = zonedParts(date, timeZone);
  return formatLongDate(`${parts.year}-${parts.month}-${parts.day}`);
}

export function formatBytes(bytes) {
  const size = Number(bytes) || 0;
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  if (size >= 1024) return `${Math.round(size / 1024)} KB`;
  return `${size} B`;
}

export function colorAbbr(code) {
  return code ? t(`liturgy.colorAbbr.${code}`) : "";
}

export function colorSwatch(code) {
  return COLOR_SWATCHES[code] ?? "transparent";
}

export function liturgyLabel(name, colorCode) {
  if (!name) return "";
  return colorCode ? `${name} (${colorAbbr(colorCode)})` : name;
}

// English title once one is stored; the Korean official title until then.
export function observanceTitle(observance) {
  if (observance?.name_en) return { text: observance.name_en, lang: "en" };
  return { text: observance?.name_ko ?? "", lang: "ko" };
}

// celebration_name keeps the Korean title copied when the Missa was saved; a name typed by the member stays as typed.
export function massLiturgyTitle(mass) {
  if (mass?.liturgy_source === "official" && mass.observance) return observanceTitle(mass.observance);
  return { text: mass?.celebration_name ?? "", lang: "ko" };
}

export function compareMasses(a, b) {
  const timeA = a.start_time ?? "";
  const timeB = b.start_time ?? "";
  if (timeA !== timeB) {
    if (!timeA) return 1;
    if (!timeB) return -1;
    return timeA < timeB ? -1 : 1;
  }
  return String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""));
}

export function sortBySlotNo(items, slotNoOf) {
  return [...items].sort((a, b) => slotNoOf(a) - slotNoOf(b));
}
