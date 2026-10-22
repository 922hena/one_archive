import { t, setLocale, translateDom } from "./i18n.js";
import { parseIsoDate, todayIso, weekdayIndex } from "./format.js";
import { h, notify } from "./ui.js";
import { renderHome } from "./views/home.js";
import { PREVIEW_OBSERVANCES } from "./preview-data.js";

// Landing page preview of the signed-in Home screen. No Supabase client is created here,
// so nothing is read from or written to the database. Sample Missae exist only in this page.

const SAMPLE_TIMES = ["11:00:00", "18:00:00"];
const LOCKED = 'a[href^="#/mass/"], a[href^="#/date/"], .quick-card, [data-locked]';

const viewRoot = document.querySelector("#view");
const observanceDates = [...new Set(PREVIEW_OBSERVANCES.map((row) => row.calendar_date))];
const sampleSundays = observanceDates.filter((date) => weekdayIndex(date) === 0);

function inRange(dates, from, to) {
  return dates.filter((date) => date >= from && date <= to);
}

function sampleMasses(date) {
  if (!sampleSundays.includes(date)) return [];
  return SAMPLE_TIMES.map((time, index) => ({
    id: `sample-${date}-${index}`,
    local_date: date,
    start_time: time,
    title: null,
    venue_name: null
  }));
}

const previewDb = {
  async ensureOccurrences() {},
  async observancesBetween(from, to) {
    return PREVIEW_OBSERVANCES.filter((row) => row.calendar_date >= from && row.calendar_date <= to);
  },
  async massDatesBetween(from, to) {
    return inRange(sampleSundays, from, to).flatMap(sampleMasses);
  },
  async massesOn(date) {
    return sampleMasses(date);
  }
};

// Opens on the next Sunday that has sample Missae, so the first view is not empty.
function startDate() {
  const today = todayIso();
  return sampleSundays.find((date) => date >= today) ?? sampleSundays[sampleSundays.length - 1];
}

function routeDate() {
  const [name, param] = window.location.hash.replace(/^#\/?/, "").split("/");
  return name === "home" && parseIsoDate(param) ? param : startDate();
}

async function route(ctx) {
  const focusedHref = document.activeElement?.closest?.("#view a")?.getAttribute("href");
  const next = h("div", { class: "view" });
  await renderHome(next, ctx, { date: routeDate() });
  viewRoot.replaceChildren(next);
  if (focusedHref) viewRoot.querySelector(`a[href="${CSS.escape(focusedHref)}"]`)?.focus();
}

document.addEventListener("click", (event) => {
  if (!event.target.closest(LOCKED)) return;
  event.preventDefault();
  event.stopPropagation();
  notify(t("preview.locked"));
}, true);

setLocale("en");
translateDom();
const ctx = {
  db: previewDb,
  navigate(hash) {
    window.location.hash = hash;
  },
  refresh() {
    route(ctx);
  }
};
window.addEventListener("hashchange", () => route(ctx));
route(ctx);
