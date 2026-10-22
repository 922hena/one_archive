import { t } from "../i18n.js";
import { colorAbbr, colorSwatch, formatLongDate, formatTime, monthGrid, parseIsoDate, todayIso } from "../format.js";
import { h, colorDot, notify } from "../ui.js";
import { calendarCard } from "./calendar.js";
import { openUploadDialog } from "./library.js";
import { massTitle } from "./mass.js";

function groupBy(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const list = map.get(row[key]) ?? [];
    list.push(row);
    map.set(row[key], list);
  }
  return map;
}

function liturgyBlock(observances) {
  if (!observances.length) return [h("p", { class: "today-liturgy is-unknown", text: t("liturgy.unknown") })];
  return observances.map((observance) =>
    h("p", { class: "today-liturgy" },
      colorDot(observance.color_code, colorSwatch(observance.color_code)),
      h("span", { text: observance.name_ko }),
      observance.color_code ? h("span", { class: "color-chip", text: colorAbbr(observance.color_code) }) : null
    )
  );
}

function todayArea({ selected, today, observances, masses }) {
  const source = observances.find((observance) => observance.source_url);
  const list = masses.length
    ? h("ul", { class: "plain-list today-masses" },
        masses.map((mass) =>
          h("li", {},
            h("a", { href: `#/mass/${mass.id}`, class: "list-row is-link" },
              h("span", { class: "time num", text: formatTime(mass.start_time) || t("calendar.noTime") }),
              h("div", { class: "list-main" },
                h("strong", { text: massTitle(mass) }),
                mass.venue_name ? h("span", { class: "meta", text: mass.venue_name }) : null
              )
            )
          )
        )
      )
    : h("p", { class: "meta today-masses", text: t("home.noMass") });

  return h("div", { class: "today-area" },
    h("p", { class: "today-label", text: selected === today ? t("home.today") : t("home.selected") }),
    h("p", { class: "today-date num", text: formatLongDate(selected) }),
    liturgyBlock(observances),
    source
      ? h("p", { class: "source" },
          t("liturgy.sourcePrefix"), " ",
          h("a", { href: source.source_url, target: "_blank", rel: "noopener noreferrer", text: t("liturgy.sourceName") })
        )
      : null,
    list,
    h("div", { class: "today-links" },
      h("a", { href: `#/date/${selected}`, class: "ghost-button add-mass", text: t("home.addMass") })
    )
  );
}

// Fixed icon markup written in this file (never user data).
const ICONS = {
  add: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'
};

function quickCard(icon, title, hint, onclick) {
  const iconBox = h("span", { class: "quick-icon", "aria-hidden": "true" });
  iconBox.innerHTML = `<svg class="tab-icon" viewBox="0 0 24 24">${ICONS[icon]}</svg>`;
  return h("button", { type: "button", class: "quick-card", onclick },
    iconBox,
    h("span", {},
      h("span", { class: "quick-title", text: title }),
      h("span", { class: "quick-hint", text: hint })
    )
  );
}

export async function renderHome(container, ctx, { date }) {
  const today = todayIso();
  const selected = parseIsoDate(date) ? date : today;
  const { year, month } = parseIsoDate(selected);
  const weeks = monthGrid(year, month);
  const gridStart = weeks[0][0].iso;
  const gridEnd = weeks[weeks.length - 1][6].iso;

  await ctx.db.ensureOccurrences(gridStart, gridEnd);
  const [observances, massDates, masses] = await Promise.all([
    ctx.db.observancesBetween(gridStart, gridEnd),
    ctx.db.massDatesBetween(gridStart, gridEnd),
    ctx.db.massesOn(selected)
  ]);
  const observancesByDate = groupBy(observances, "calendar_date");
  const massesByDate = groupBy(massDates, "local_date");

  container.append(
    h("div", { class: "home-stack" },
      h("section", { class: "home-hero" },
        h("h1", { text: t("home.title") }),
        h("p", { text: t("home.lead") })
      ),
      calendarCard(ctx, {
        year,
        month,
        selected,
        today,
        observancesByDate,
        massesByDate,
        base: "home",
        heading: t("home.calendarTitle"),
        footer: todayArea({ selected, today, observances: observancesByDate.get(selected) ?? [], masses })
      }),
      h("h2", { class: "quick-head", text: t("home.quickActions") }),
      h("div", { class: "quick-grid" },
        quickCard("add", t("home.addScore"), t("home.addScoreHint"), () => openUploadDialog(ctx)),
        quickCard("search", t("home.search"), t("home.searchHint"), () => notify(t("home.searchSoon")))
      )
    )
  );
}
