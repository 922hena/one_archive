import { t } from "../i18n.js";
import {
  addMonths,
  colorSwatch,
  formatLongDate,
  formatTime,
  liturgyLabel,
  massLiturgyTitle,
  monthGrid,
  observanceTitle,
  parseIsoDate,
  todayIso,
  weekdayShort
} from "../format.js";
import { h, colorDot, notify } from "../ui.js";
import { openMassForm, massTitle, liturgyLine, liturgyText } from "./mass.js";

function groupBy(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const list = map.get(row[key]) ?? [];
    list.push(row);
    map.set(row[key], list);
  }
  return map;
}

// base: which screen the dates link to ("date" list screen or "home"). footer: nodes shown beside/below the grid.
export function calendarCard(ctx, { year, month, selected, today, observancesByDate, massesByDate, base = "date", footer = null, heading = null }) {
  const previous = addMonths(year, month, -1);
  const next = addMonths(year, month, 1);
  const monthLink = (target) => {
    const day = Math.min(parseIsoDate(selected).day, 28);
    return `#/${base}/${target.year}-${String(target.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  };

  const top = h("div", { class: "cal-top" },
    heading ? h("h2", { class: "cal-title", text: heading }) : null,
    h("span", { class: "cal-year num", lang: "ko", "aria-hidden": "true", text: t("format.yearTitle", { year }) })
  );

  // Same 7 columns as the date grid, so the month sits exactly above Wednesday.
  const head = h("div", { class: "cal-head" },
    h("span", { class: "cal-arrows" },
      h("a", { href: monthLink(previous), class: "icon-button", "aria-label": t("calendar.previousMonth") }, "‹"),
      h("a", { href: monthLink(next), class: "icon-button", "aria-label": t("calendar.nextMonth") }, "›")
    ),
    h("h2", { class: "cal-month num", lang: "ko" },
      h("span", { class: "visually-hidden", text: `${t("format.yearTitle", { year })} ` }),
      t("format.monthOnly", { month })
    ),
    h("a", { href: `#/${base}/${today}`, class: "ghost-button cal-today" }, t("calendar.today"))
  );

  const weekdays = h("div", { class: "cal-row cal-weekdays", lang: "ko", "aria-hidden": "true" },
    [0, 1, 2, 3, 4, 5, 6].map((index) => h("span", { class: index === 0 ? "is-sunday" : "", text: weekdayShort(index) }))
  );

  const weeks = monthGrid(year, month).map((week) =>
    h("div", { class: "cal-row" },
      week.map((cell, index) => {
        const observances = observancesByDate.get(cell.iso) ?? [];
        const massCount = massesByDate.get(cell.iso)?.length ?? 0;
        const classes = ["cal-day"];
        if (!cell.inMonth) classes.push("is-outside");
        if (index === 0) classes.push("is-sunday");
        if (cell.iso === selected) classes.push("is-selected");
        if (cell.iso === today) classes.push("is-today");
        const label = [
          formatLongDate(cell.iso),
          observances.map((observance) => liturgyLabel(observanceTitle(observance).text, observance.color_code)).join(", "),
          massCount ? t(massCount === 1 ? "calendar.massCountOne" : "calendar.massCount", { count: massCount }) : ""
        ].filter(Boolean).join(", ");
        return h("a", { href: `#/${base}/${cell.iso}`, class: classes.join(" "), "aria-label": label, "aria-current": cell.iso === selected ? "date" : null },
          h("span", { class: "cal-num num", text: String(cell.day) }),
          h("span", { class: "cal-marks" },
            observances.length ? colorDot(observances[0].color_code, colorSwatch(observances[0].color_code)) : null,
            massCount ? h("span", { class: "cal-count num", text: String(massCount) }) : null
          )
        );
      })
    )
  );

  return h("section", { class: base === "home" ? "cal-card is-home" : "cal-card", "aria-label": t("calendar.title") },
    h("div", { class: "cal-body" },
      h("div", { class: "cal-grid" }, top, head, weekdays, weeks, h("p", { class: "hint", text: t("calendar.legend") })),
      footer
    )
  );
}

function dayPanel(ctx, { selected, observances, masses, roles, layouts, venues }) {
  const liturgy = observances.length
    ? observances.map((observance) => liturgyLine(observanceTitle(observance), observance.color_code))
    : [liturgyLine(null, null)];

  const source = observances.find((observance) => observance.source_url);
  const list = masses.length
    ? h("ul", { class: "plain-list" },
        masses.map((mass) => {
          const slots = mass.mass_music_slots ?? [];
          const linked = slots.reduce((sum, slot) => sum + (slot.mass_music_entries?.length ?? 0), 0);
          const liturgy = massLiturgyTitle(mass);
          return h("li", {},
            h("a", { href: `#/mass/${mass.id}`, class: "list-row is-link" },
              h("span", { class: "time num", text: formatTime(mass.start_time) || t("calendar.noTime") }),
              h("div", { class: "list-main" },
                h("strong", { translate: "no", text: massTitle(mass) }),
                h("span", { class: "meta" },
                  [
                    liturgy.text ? liturgyText(liturgy, mass.color_code) : t("liturgy.unknown"),
                    mass.venue_name ? h("span", { translate: "no", text: mass.venue_name }) : null,
                    mass.status && mass.status !== "planned" ? t(`mass.status.${mass.status}`) : null
                  ].filter(Boolean).flatMap((part, index) => (index ? [" · ", part] : [part]))
                )
              ),
              h("span", { class: "meta num", text: t("calendar.itemSummary", { items: slots.length, linked }) })
            )
          );
        })
      )
    : null;

  return h("section", { class: "day-panel" },
    h("h2", { class: "date-title num", lang: "ko", text: formatLongDate(selected) }),
    liturgy,
    source
      ? h("p", { class: "source" },
          t("liturgy.sourcePrefix"), " ",
          h("a", { href: source.source_url, target: "_blank", rel: "noopener noreferrer", text: t("liturgy.sourceName") })
        )
      : null,
    h("div", { class: "section-bar" },
      h("h2", { text: t("calendar.massesHead") }),
      h("button", {
        type: "button",
        class: "solid-button",
        onclick: async () => {
          const savedId = await openMassForm(ctx, { date: selected, observances, roles, layouts, venues });
          if (savedId) {
            notify(t("mass.created"), "success");
            ctx.navigate(`#/mass/${savedId}`);
          }
        }
      }, t("calendar.newMass"))
    ),
    list
  );
}

export async function renderCalendar(container, ctx, { date }) {
  const today = todayIso();
  const selected = parseIsoDate(date) ? date : today;
  const { year, month } = parseIsoDate(selected);
  const gridWeeks = monthGrid(year, month);
  const gridStart = gridWeeks[0][0].iso;
  const gridEnd = gridWeeks[gridWeeks.length - 1][6].iso;

  await ctx.db.ensureOccurrences(gridStart, gridEnd);
  const [observances, massDates, masses, roles, layouts, venues] = await Promise.all([
    ctx.db.observancesBetween(gridStart, gridEnd),
    ctx.db.massDatesBetween(gridStart, gridEnd),
    ctx.db.massesOn(selected),
    ctx.db.roles(),
    ctx.db.layouts(),
    ctx.db.usedVenues()
  ]);
  const observancesByDate = groupBy(observances, "calendar_date");
  const massesByDate = groupBy(massDates, "local_date");

  container.append(
    h("section", { class: "page-head" },
      h("h1", { text: t("calendar.pageTitle") }),
      h("a", { href: "#/layouts", class: "ghost-button" }, t("calendar.layoutLink"))
    ),
    h("div", { class: "calendar-layout" },
      calendarCard(ctx, { year, month, selected, today, observancesByDate, massesByDate }),
      dayPanel(ctx, { selected, observances: observancesByDate.get(selected) ?? [], masses, roles, layouts, venues })
    )
  );
}
