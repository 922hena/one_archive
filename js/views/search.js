import { t } from "../i18n.js";
import { formatShortDate, formatTime, sortBySlotNo, todayIso } from "../format.js";
import { h, actionMenu, createDialog, errorMessage, notify, setBusy, displayScoreTitle } from "../ui.js";
import { KEY_MODES, KEY_TONICS, tonicLabel } from "../score-meta.js";
import {
  COUNT_OPS,
  DEFAULT_PART_CODES,
  FILTER_IDS,
  SEASONS,
  SORTS,
  VIEWS,
  clearFilter,
  countSummary,
  emptySearch,
  hasContext,
  isFilterActive,
  normalizeViewConfig,
  parseCount,
  parseSearchQuery,
  searchFilters,
  searchQuery
} from "../search-state.js";
import { roleLabel } from "./layouts.js";
import { keyLabel, openScoreHistory, periodName } from "./library.js";
import { massTitle } from "./mass.js";
import { openViewer, thumbnailImage } from "./viewer.js";
import { pdfFirstPageCanvas, thumbnailFromCanvas } from "../score-prepare.js";

const SHEET_QUERY = "(max-width: 767px)";
const MAX_OBSERVANCES_SHOWN = 60;
const THUMB_FAILED_KEY = "yearscore-thumb-failed";
const THUMB_RETRY_MS = 24 * 60 * 60 * 1000;

// Score id -> time a missing thumbnail couldn't be made or stored on this device.
function failedThumbs() {
  try {
    return JSON.parse(localStorage.getItem(THUMB_FAILED_KEY)) ?? {};
  } catch {
    return {};
  }
}

function thumbRecentlyFailed(scoreId) {
  const at = failedThumbs()[scoreId];
  return Boolean(at) && Date.now() - at < THUMB_RETRY_MS;
}

function markThumbFailed(scoreId) {
  const now = Date.now();
  const kept = Object.fromEntries(Object.entries(failedThumbs()).filter(([, at]) => now - at < THUMB_RETRY_MS));
  try {
    localStorage.setItem(THUMB_FAILED_KEY, JSON.stringify({ ...kept, [scoreId]: now }));
  } catch {
    // without storage the next visit simply tries again
  }
}

// Saved filter order, hidden filters, sort and view (saved_views, C6). Loaded once per signed-in member.
const viewCache = { userId: null, config: null };

async function loadViewConfig(ctx) {
  if (viewCache.userId !== ctx.user.id) {
    viewCache.config = normalizeViewConfig(await ctx.db.searchView().catch(() => null));
    viewCache.userId = ctx.user.id;
  }
  return viewCache.config;
}

function scoreOf(row) {
  return { id: row.score_id, title: row.title, provisional_title: row.provisional_title, composer_name: row.composer_label };
}

function shortList(items, limit = 2) {
  return items.length > limit ? `${items.slice(0, limit).join(", ")} +${items.length - limit}` : items.join(", ");
}

const uniqueValues = (items) => [...new Set(items)];

// Checkbox list; onChange receives the checked values in option order (values not listed are kept at the end).
function checkGroup(legend, options, selected, onChange, { columns = false } = {}) {
  const chosen = new Set(selected);
  return h("fieldset", { class: columns ? "check-group is-columns" : "check-group" },
    legend ? h("legend", { text: legend }) : null,
    options.map((option) => {
      const box = h("input", { type: "checkbox", checked: chosen.has(option.value) });
      box.addEventListener("change", () => {
        if (box.checked) chosen.add(option.value);
        else chosen.delete(option.value);
        const listed = options.map((item) => item.value);
        onChange([...listed.filter((value) => chosen.has(value)), ...[...chosen].filter((value) => !listed.includes(value))]);
      });
      return h("label", { class: "check-row" },
        box,
        h("span", { translate: option.translate ?? null, lang: option.lang ?? null, text: option.label })
      );
    })
  );
}

function numberInput(value, { label, min = 0, max = 9999, placeholder = "" } = {}) {
  return h("input", {
    type: "number",
    inputmode: "numeric",
    min,
    max,
    step: 1,
    value: value ?? "",
    placeholder,
    "aria-label": label
  });
}

// op + number(s) for a count condition; onChange(null) means "any number of times".
function countControls(cond, onChange, label) {
  const op = h("select", { "aria-label": label },
    h("option", { value: "", selected: !cond }, t("search.countAny")),
    COUNT_OPS.map((code) => h("option", { value: code, selected: cond?.op === code }, t(`search.countOp.${code}`)))
  );
  const first = numberInput(cond ? (cond.op === "between" ? cond.min : cond.value) : "", { label: `${label} — ${t("search.countTimes")}` });
  const second = numberInput(cond?.op === "between" ? cond.max : "", { label: `${label} — ${t("search.countAnd")}` });
  const andText = h("span", { class: "count-word", text: t("search.countAnd") });
  const timesText = h("span", { class: "count-word", text: t("search.countTimes") });
  const error = h("p", { class: "field-error", role: "alert", hidden: true, text: t("search.countInvalid") });
  function sync() {
    first.hidden = timesText.hidden = !op.value;
    second.hidden = andText.hidden = op.value !== "between";
  }
  function read() {
    if (!op.value) {
      error.hidden = true;
      onChange(null);
      return;
    }
    const parsed = parseCount(op.value === "between" ? `between:${first.value}:${second.value}` : `${op.value}:${first.value}`);
    error.hidden = Boolean(parsed);
    if (parsed) onChange(parsed);
  }
  op.addEventListener("change", () => {
    if (op.value && first.value === "") first.value = "1";
    if (op.value === "between" && second.value === "") second.value = String(Math.max(Number(first.value) || 0, 1) + 1);
    sync();
    read();
  });
  first.addEventListener("input", read);
  second.addEventListener("input", read);
  sync();
  return h("div", { class: "count-control" }, h("div", { class: "count-row" }, op, first, andText, second, timesText), error);
}

async function openAddToMissa(ctx, row, roleById) {
  const title = displayScoreTitle(scoreOf(row));
  const { body, footer, close } = createDialog(t("search.addTitle"), { wide: true });
  const dateId = `add-date-${row.score_id}`;
  const dateInput = h("input", { id: dateId, type: "date", value: todayIso() });
  const massBox = h("div", { class: "add-masses" });
  body.append(
    h("p", { class: "dialog-score", translate: "no", text: title }),
    h("div", { class: "field" }, h("label", { for: dateId, class: "field-label", text: t("search.addDate") }), dateInput),
    massBox
  );
  footer.append(h("button", { type: "button", class: "ghost-button", onclick: close }, t("common.close")));

  function linkedMark() {
    return h("span", { class: "meta", tabindex: "-1", text: t("search.addLinkedAlready") });
  }

  function massSection(mass) {
    const slots = sortBySlotNo(mass.mass_music_slots ?? [], (slot) => roleById.get(slot.role_id)?.slot_no ?? 99);
    return h("section", { class: "add-mass" },
      h("h3", { class: "sub-head", translate: "no", text: [formatTime(mass.start_time), massTitle(mass)].filter(Boolean).join(" · ") }),
      slots.length
        ? h("ul", { class: "plain-list" },
            slots.map((slot) => {
              const itemName = slot.display_name || roleLabel(roleById.get(slot.role_id)) || t("mass.unnamedItem");
              const linked = (slot.mass_music_entries ?? []).some((entry) => entry.owned_score_id === row.score_id);
              let action = linkedMark();
              if (!linked) {
                action = h("button", { type: "button", class: "solid-button is-small", "aria-label": `${t("mass.link")}: ${itemName}` }, t("mass.link"));
                action.addEventListener("click", async () => {
                  action.disabled = true;
                  try {
                    await ctx.db.linkScore(slot.id, row.score_id);
                    notify(t("mass.linked", { title, item: itemName }), "success");
                    const mark = linkedMark();
                    action.replaceWith(mark);
                    mark.focus();
                  } catch (error) {
                    notify(errorMessage(error, "mass.linkFailed"), "error");
                    action.disabled = false;
                  }
                });
              }
              return h("li", { class: "list-row" }, h("span", { class: "list-main", translate: "no", text: itemName }), action);
            })
          )
        : h("p", { class: "empty", text: t("search.addNoParts") })
    );
  }

  let token = 0;
  async function load() {
    const mine = ++token;
    const date = dateInput.value;
    if (!date) {
      massBox.replaceChildren();
      return;
    }
    massBox.replaceChildren(h("p", { class: "meta", text: t("common.loading") }));
    try {
      const masses = await ctx.db.massesOn(date);
      const details = (await Promise.all(masses.map((mass) => ctx.db.mass(mass.id)))).filter(Boolean);
      if (mine !== token) return;
      massBox.replaceChildren(
        ...(details.length
          ? details.map(massSection)
          : [
              h("p", { class: "empty", text: t("search.addNoMass") }),
              h("a", { href: `#/date/${date}`, class: "link-button", onclick: () => close() }, t("search.addOpenDate"))
            ])
      );
    } catch (error) {
      if (mine === token) massBox.replaceChildren(h("p", { class: "empty", text: errorMessage(error) }));
    }
  }
  dateInput.addEventListener("change", load);
  load();
}

export async function renderSearch(container, ctx, { query = "" } = {}) {
  const [roles, places, periods, savedConfig] = await Promise.all([
    ctx.db.roles(),
    ctx.db.venues(),
    ctx.db.periods(),
    loadViewConfig(ctx)
  ]);
  let config = savedConfig;
  let state = parseSearchQuery(query);
  state.sort ??= config.sort;
  state.desc ??= config.desc;
  state.view ??= config.view;

  const roleById = new Map(roles.map((role) => [role.id, role]));
  const placeById = new Map(places.map((place) => [place.id, place]));
  const lookups = { composers: null, observances: null };
  const partName = (role) => roleLabel(role) || t("mass.unnamedItem");

  // ---------------------------------------------------------------- page parts
  const targetButtons = ["scores", "history"].map((target) =>
    h("button", {
      type: "button",
      class: "segment",
      "aria-pressed": String(state.target === target),
      onclick: () => setTarget(target)
    }, t(target === "scores" ? "search.targetScores" : "search.targetHistory"))
  );
  const queryId = "search-query";
  const queryInput = h("input", {
    id: queryId,
    type: "search",
    value: state.q,
    maxlength: 200,
    autocomplete: "off",
    enterkeyhint: "search",
    placeholder: t("search.queryPlaceholder")
  });
  const chipList = h("ul", { class: "filter-chips", "aria-label": t("search.filters") });
  const customizeButton = h("button", { type: "button", class: "link-button", onclick: () => openCustomize() }, t("search.customize"));
  const clearAllButton = h("button", { type: "button", class: "link-button", onclick: () => clearAll() }, t("search.clearAll"));
  const panel = h("dialog", { class: "filter-panel", "aria-labelledby": "filter-panel-title" });
  const countLine = h("p", { class: "results-count", role: "status" });
  const controls = h("div", { class: "results-controls" });
  const resultsBox = h("div", { class: "results" });
  const moreButton = h("button", { type: "button", class: "ghost-button results-more", hidden: true }, t("search.loadMore"));

  container.append(
    h("section", { class: "page-head search-head" }, h("h1", { text: t("search.title") })),
    h("div", { class: "search-top" },
      h("div", { class: "segmented", role: "group", "aria-label": t("search.target") }, targetButtons),
      h("div", { class: "search-query" }, h("label", { for: queryId, class: "visually-hidden", text: t("search.query") }), queryInput)
    ),
    h("div", { class: "filter-area" }, chipList, panel),
    h("div", { class: "results-head" }, countLine, controls),
    resultsBox,
    moreButton
  );

  // ---------------------------------------------------------------- state changes
  let searchTimer = null;
  let persistTimer = null;

  function syncUrl() {
    const qs = searchQuery(state);
    const hash = `#/search${qs ? `?${qs}` : ""}`;
    if (window.location.hash !== hash) history.replaceState(history.state, "", hash);
  }

  // One condition changes; the others, the sort and the view stay as they are (PRD 4.13.9.1).
  function changed({ delay = 250, chips = true } = {}) {
    syncUrl();
    if (chips) renderChips();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => runSearch(), delay);
  }

  function persistView() {
    config = { ...config, sort: state.sort, desc: state.desc, view: state.view };
    viewCache.config = config;
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      ctx.db.saveSearchView(config).catch(() => {});
    }, 800);
  }

  function setTarget(target) {
    if (state.target === target) return;
    state.target = target;
    targetButtons.forEach((button, index) => button.setAttribute("aria-pressed", String(["scores", "history"][index] === target)));
    if (panelId === "count" && target === "history") closePanel({ focus: false });
    renderControls();
    changed({ delay: 0 });
  }

  function clearAll() {
    closePanel({ focus: false });
    state = { ...emptySearch(), target: state.target, q: state.q, sort: state.sort, desc: state.desc, view: state.view, oldest: state.oldest };
    changed({ delay: 0 });
    chipList.querySelector(".chip-button")?.focus();
  }

  queryInput.addEventListener("input", () => {
    state.q = queryInput.value;
    changed({ delay: 300, chips: false });
  });
  queryInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.isComposing) return;
    event.preventDefault();
    clearTimeout(searchTimer);
    runSearch();
  });
  moreButton.addEventListener("click", () => runSearch({ append: true }));

  // ---------------------------------------------------------------- filter chips
  function chipValue(id) {
    switch (id) {
      case "liturgy":
        return shortList([...state.seasons.map((code) => t(`liturgy.season.${code}`)), ...state.observances]);
      case "date": {
        const parts = [];
        if (state.yearFrom != null || state.yearTo != null) {
          parts.push(state.yearFrom === state.yearTo ? String(state.yearFrom) : `${state.yearFrom ?? ""}–${state.yearTo ?? ""}`);
        }
        if (state.months.length) parts.push(shortList(state.months.map((month) => t("format.monthOnly", { month })), 3));
        if (state.dateFrom || state.dateTo) {
          parts.push(`${formatShortDate(state.dateFrom, { weekday: false })}–${formatShortDate(state.dateTo, { weekday: false })}`);
        }
        return parts.join(" · ");
      }
      case "composer":
        return shortList(state.composers);
      case "period":
        return shortList(state.periods.map((code) => periodName(code, periods)));
      case "count": {
        const extra = state.extra
          ? `${t(state.extra.scope === "all" ? "search.extraAll" : "search.extraVenue")} ${countSummary(state.extra.cond)}`
          : "";
        return [countSummary(state.count), extra].filter(Boolean).join(" · ");
      }
      case "key":
        return shortList(state.keys.map((key) => keyLabel(key.tonic, key.mode)));
      case "venue":
        return shortList(state.venues.map((id) => placeById.get(id)?.name ?? "—"));
      case "part":
        return shortList(state.parts.map((id) => partName(roleById.get(id))));
      default:
        return "";
    }
  }

  function visibleFilters() {
    return config.filters.filter(
      (id) => (!config.hidden.includes(id) || isFilterActive(state, id)) && !(id === "count" && state.target === "history")
    );
  }

  function chip(id) {
    const active = isFilterActive(state, id);
    const name = t(`search.filter.${id}`);
    const value = active ? chipValue(id) : "";
    const open = panelId === id;
    const button = h("button", {
      type: "button",
      class: "chip-button",
      "aria-haspopup": "dialog",
      "aria-expanded": String(open),
      onclick: () => (panelId === id ? closePanel() : openPanel(id))
    },
      h("span", { class: "chip-face" },
        h("span", { class: "chip-name", text: value ? `${name}:` : name }),
        value ? h("span", { class: "chip-value", translate: "no", text: value }) : null
      )
    );
    const clear = active
      ? h("button", {
          type: "button",
          class: "chip-clear",
          "aria-label": t("search.removeFilter", { name }),
          onclick: () => {
            if (panelId === id) closePanel({ focus: false });
            state = clearFilter(state, id);
            changed({ delay: 0 });
            chipList.querySelector(`[data-filter="${id}"] .chip-button`)?.focus();
          }
        }, h("span", { "aria-hidden": "true", text: "×" }))
      : null;
    return h("li", { class: active ? "filter-chip is-active" : "filter-chip", dataset: { filter: id } }, button, clear);
  }

  function renderChips() {
    const anyActive = FILTER_IDS.some((id) => isFilterActive(state, id));
    chipList.replaceChildren(
      ...visibleFilters().map(chip),
      h("li", { class: "filter-tool" }, customizeButton),
      h("li", { class: "filter-tool", hidden: !anyActive }, clearAllButton)
    );
  }

  // ---------------------------------------------------------------- filter panels
  let panelId = null;

  function outside(event) {
    if (!panel.isConnected) {
      document.removeEventListener("pointerdown", outside, true);
      return;
    }
    if (!panel.open || panel.classList.contains("is-sheet")) return;
    if (panel.contains(event.target) || chipList.contains(event.target)) return;
    closePanel({ focus: false });
  }

  function closePanel({ focus = true } = {}) {
    if (panelId == null) return;
    const id = panelId;
    panelId = null;
    document.removeEventListener("pointerdown", outside, true);
    if (panel.open) panel.close();
    renderChips();
    if (focus) chipList.querySelector(`[data-filter="${id}"] .chip-button`)?.focus();
  }

  // The close event comes later than closePanel(); by then another panel may be open.
  panel.addEventListener("close", () => {
    if (!panel.open) closePanel();
  });
  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panel.classList.contains("is-sheet")) {
      event.preventDefault();
      closePanel();
    }
  });
  panel.addEventListener("click", (event) => {
    if (event.target === panel && panel.classList.contains("is-sheet")) closePanel();
  });

  function openPanel(id) {
    closePanel({ focus: false });
    panelId = id;
    const body = h("div", { class: "filter-panel-body" });
    const fill = () => body.replaceChildren(...[panelBody(id)].flat().filter(Boolean));
    fill();
    const doneButton = h("button", { type: "button", class: "solid-button", onclick: () => closePanel() }, t("search.done"));
    panel.replaceChildren(
      h("div", { class: "filter-panel-inner" },
        h("div", { class: "filter-panel-head" },
          h("h2", { id: "filter-panel-title", text: t(`search.filter.${id}`) }),
          h("button", { type: "button", class: "icon-button", "aria-label": t("common.close"), onclick: () => closePanel() }, "×")
        ),
        body,
        h("div", { class: "filter-panel-foot" },
          h("button", {
            type: "button",
            class: "ghost-button",
            onclick: () => {
              state = clearFilter(state, id);
              changed({ delay: 0 });
              fill();
            }
          }, t("search.clear")),
          doneButton
        )
      )
    );
    const sheet = window.matchMedia(SHEET_QUERY).matches;
    panel.classList.toggle("is-sheet", sheet);
    if (sheet) panel.showModal();
    else panel.show();
    document.addEventListener("pointerdown", outside, true);
    renderChips();
    (body.querySelector("input, select, button") ?? doneButton).focus();
  }

  function panelBody(id) {
    switch (id) {
      case "liturgy":
        return liturgyPanel();
      case "date":
        return datePanel();
      case "composer":
        return composerPanel();
      case "period":
        return periodPanel();
      case "count":
        return countPanel();
      case "key":
        return keyPanel();
      case "venue":
        return venuePanel();
      case "part":
        return partPanel();
      default:
        return null;
    }
  }

  function liturgyPanel() {
    const seasons = checkGroup(
      t("search.seasons"),
      SEASONS.map((code) => ({ value: code, label: t(`liturgy.season.${code}`), lang: "en" })),
      state.seasons,
      (values) => {
        state.seasons = values;
        changed();
      }
    );
    const findId = "observance-find";
    const find = h("input", { id: findId, type: "search", autocomplete: "off", placeholder: t("search.observanceFind") });
    const listBox = h("div", { class: "observance-list" }, h("p", { class: "meta", text: t("common.loading") }));
    function draw() {
      const all = lookups.observances ?? [];
      const needle = find.value.trim().toLowerCase();
      const names = uniqueValues([...state.observances, ...all.map((item) => item.name)]);
      const shown = names.filter((name) => state.observances.includes(name) || !needle || name.toLowerCase().includes(needle));
      listBox.replaceChildren(
        shown.length
          ? checkGroup(
              null,
              shown.slice(0, MAX_OBSERVANCES_SHOWN).map((name) => ({ value: name, label: name, lang: "en" })),
              state.observances,
              (values) => {
                state.observances = values;
                changed();
              }
            )
          : h("p", { class: "meta", text: t("search.noObservances") })
      );
    }
    find.addEventListener("input", draw);
    (async () => {
      lookups.observances ??= await ctx.db.observanceNames().catch(() => []);
      draw();
    })();
    return [
      seasons,
      h("fieldset", { class: "check-group" },
        h("legend", { text: t("search.observances") }),
        h("label", { for: findId, class: "visually-hidden", text: t("search.observanceFind") }),
        find,
        listBox
      )
    ];
  }

  function datePanel() {
    const yearFrom = numberInput(state.yearFrom, { label: t("search.yearFrom"), min: 1, max: 9999 });
    const yearTo = numberInput(state.yearTo, { label: t("search.yearTo"), min: 1, max: 9999 });
    const readYears = () => {
      const read = (input) => {
        const value = Number(input.value);
        return input.value !== "" && Number.isInteger(value) && value >= 1 && value <= 9999 ? value : null;
      };
      state.yearFrom = read(yearFrom);
      state.yearTo = read(yearTo);
      changed({ delay: 400 });
    };
    yearFrom.addEventListener("input", readYears);
    yearTo.addEventListener("input", readYears);
    const dateFrom = h("input", { type: "date", value: state.dateFrom ?? "", "aria-label": t("search.dateFrom") });
    const dateTo = h("input", { type: "date", value: state.dateTo ?? "", "aria-label": t("search.dateTo") });
    const readDates = () => {
      state.dateFrom = dateFrom.value || null;
      state.dateTo = dateTo.value || null;
      changed();
    };
    dateFrom.addEventListener("change", readDates);
    dateTo.addEventListener("change", readDates);
    return [
      h("fieldset", { class: "check-group" },
        h("legend", { text: t("search.years") }),
        h("div", { class: "range-row" }, yearFrom, h("span", { "aria-hidden": "true", text: "–" }), yearTo)
      ),
      checkGroup(
        t("search.months"),
        Array.from({ length: 12 }, (_, index) => ({ value: index + 1, label: t("format.monthOnly", { month: index + 1 }), lang: "ko" })),
        state.months,
        (values) => {
          state.months = values;
          changed();
        },
        { columns: true }
      ),
      h("fieldset", { class: "check-group" },
        h("legend", { text: t("search.dates") }),
        h("div", { class: "range-row" }, dateFrom, h("span", { "aria-hidden": "true", text: "–" }), dateTo)
      )
    ];
  }

  function composerPanel() {
    const box = h("div", {}, h("p", { class: "meta", text: t("common.loading") }));
    (async () => {
      lookups.composers ??= await ctx.db.scoreComposers().catch(() => []);
      const names = uniqueValues([...state.composers, ...lookups.composers]);
      box.replaceChildren(
        names.length
          ? checkGroup(
              t("search.composers"),
              names.map((name) => ({ value: name, label: name, translate: "no" })),
              state.composers,
              (values) => {
                state.composers = values;
                changed();
              }
            )
          : h("p", { class: "hint", text: t("search.noComposers") })
      );
    })();
    return box;
  }

  function periodPanel() {
    const provisional = h("input", { type: "checkbox", checked: state.provisional });
    provisional.addEventListener("change", () => {
      state.provisional = provisional.checked;
      if (state.periods.length) changed();
      else syncUrl();
    });
    return [
      checkGroup(
        t("search.periods"),
        periods.map((period) => ({ value: period.code, label: period.name_en })),
        state.periods,
        (values) => {
          state.periods = values;
          changed();
        }
      ),
      h("label", { class: "check-row" }, provisional, h("span", { text: t("search.includeProvisional") }))
    ];
  }

  function countPanel() {
    let extraScope = state.extra?.scope ?? "";
    let extraVenues = state.extra?.venues ?? [];
    let extraCond = state.extra?.cond ?? null;
    const applyExtra = () => {
      state.extra = extraScope && extraCond ? { scope: extraScope, venues: extraVenues, cond: extraCond } : null;
      changed({ delay: 400 });
    };
    const scope = h("select", { "aria-label": t("search.extraLabel") },
      h("option", { value: "", selected: !extraScope }, t("search.extraNone")),
      h("option", { value: "all", selected: extraScope === "all" }, t("search.extraAll")),
      h("option", { value: "venue", selected: extraScope === "venue" }, t("search.extraVenue"))
    );
    const venueBox = h("div", {});
    const extraCount = h("div", {}, countControls(extraCond, (cond) => {
      extraCond = cond;
      applyExtra();
    }, t("search.extraLabel")));
    function drawExtra() {
      venueBox.replaceChildren(
        ...[
          extraScope === "venue"
            ? places.length
              ? checkGroup(null, places.map((place) => ({ value: place.id, label: place.name, translate: "no" })), extraVenues, (values) => {
                  extraVenues = values;
                  applyExtra();
                })
              : h("p", { class: "hint", text: t("search.noVenues") })
            : null
        ].filter(Boolean)
      );
      extraCount.hidden = !extraScope;
    }
    scope.addEventListener("change", () => {
      extraScope = scope.value;
      drawExtra();
      applyExtra();
    });
    drawExtra();
    return [
      h("p", { class: "hint", text: t(hasContext(state) ? "search.countWithin" : "search.countAllTime") }),
      h("fieldset", { class: "check-group" },
        h("legend", { text: t("search.countLabel") }),
        countControls(state.count, (cond) => {
          state.count = cond;
          changed({ delay: 400 });
        }, t("search.countLabel"))
      ),
      h("fieldset", { class: "check-group" },
        h("legend", { text: t("search.extraLabel") }),
        scope,
        venueBox,
        extraCount
      )
    ];
  }

  function keyPanel() {
    const list = h("ul", { class: "key-list" });
    function drawList() {
      list.replaceChildren(
        ...state.keys.map((key, index) => {
          const label = keyLabel(key.tonic, key.mode) + (key.mode ? "" : ` · ${t("search.keyAnyMode")}`);
          return h("li", { class: "key-item" },
            h("span", { translate: "no", text: label }),
            h("button", {
              type: "button",
              class: "link-button",
              "aria-label": t("search.keyRemove", { key: label }),
              onclick: () => {
                state.keys = state.keys.filter((_, at) => at !== index);
                changed();
                drawList();
                tonic.focus();
              }
            }, t("common.remove"))
          );
        })
      );
    }
    const tonic = h("select", { "aria-label": t("library.keyTonic") },
      KEY_TONICS.map((code) => h("option", { value: code, selected: code === "C" }, tonicLabel(code)))
    );
    const mode = h("select", { "aria-label": t("library.keyMode") },
      h("option", { value: "" }, t("search.keyAnyMode")),
      KEY_MODES.filter((code) => code !== "atonal").map((code) => h("option", { value: code }, t(`keys.modeOption.${code}`)))
    );
    const add = h("button", {
      type: "button",
      class: "ghost-button",
      onclick: () => {
        const key = { tonic: tonic.value, mode: mode.value || null };
        if (!state.keys.some((item) => item.tonic === key.tonic && item.mode === key.mode)) {
          state.keys = [...state.keys, key];
          changed();
        }
        drawList();
      }
    }, t("search.keyAdd"));
    drawList();
    return [
      h("fieldset", { class: "check-group" },
        h("legend", { text: t("search.keys") }),
        h("div", { class: "key-add" }, tonic, mode, add)
      ),
      list
    ];
  }

  function venuePanel() {
    if (!places.length) {
      return h("p", { class: "hint" }, t("search.noVenues"), " ", h("a", { href: "#/layouts", class: "link-button" }, t("places.heading")));
    }
    return checkGroup(
      t("search.venues"),
      places.map((place) => ({ value: place.id, label: place.name, translate: "no" })),
      state.venues,
      (values) => {
        state.venues = values;
        changed();
      }
    );
  }

  function partPanel() {
    const box = h("div", {});
    const isDefault = (role) => DEFAULT_PART_CODES.includes(role.code);
    let showAll = state.parts.some((id) => !isDefault(roleById.get(id) ?? {}));
    function draw(focusToggle = false) {
      const shown = showAll ? roles : roles.filter((role) => isDefault(role) || state.parts.includes(role.id));
      const toggle = h("button", {
        type: "button",
        class: "link-button",
        onclick: () => {
          showAll = !showAll;
          draw(true);
        }
      }, t(showAll ? "search.fewerParts" : "search.moreParts"));
      box.replaceChildren(
        checkGroup(
          t("search.parts"),
          shown.map((role) => ({ value: role.id, label: partName(role), translate: "no" })),
          state.parts,
          (values) => {
            state.parts = values;
            changed();
          }
        )
      );
      if (roles.length > shown.length || showAll) box.append(toggle);
      if (focusToggle) toggle.focus();
    }
    draw();
    return box;
  }

  // ---------------------------------------------------------------- customize filters (C6)
  function openCustomize() {
    closePanel({ focus: false });
    const { body, footer, close, setStatus } = createDialog(t("search.customize"));
    const order = [...config.filters];
    const hidden = new Set(config.hidden);
    const list = h("ol", { class: "customize-list" });
    function draw(focus = null) {
      list.replaceChildren(
        ...order.map((id, index) => {
          const name = t(`search.filter.${id}`);
          const box = h("input", { type: "checkbox", checked: !hidden.has(id) });
          box.addEventListener("change", () => (box.checked ? hidden.delete(id) : hidden.add(id)));
          return h("li", { class: "customize-row", dataset: { id } },
            h("label", { class: "check-row" }, box, h("span", { text: name })),
            h("button", {
              type: "button",
              class: "icon-button",
              "aria-label": `${t("common.moveUp")}: ${name}`,
              disabled: index === 0,
              onclick: () => move(index, -1)
            }, "↑"),
            h("button", {
              type: "button",
              class: "icon-button",
              "aria-label": `${t("common.moveDown")}: ${name}`,
              disabled: index === order.length - 1,
              onclick: () => move(index, 1)
            }, "↓")
          );
        })
      );
      if (focus) {
        const buttons = [...list.querySelectorAll(`[data-id="${focus.id}"] button`)];
        (buttons[focus.delta < 0 ? 0 : 1]?.disabled ? buttons[focus.delta < 0 ? 1 : 0] : buttons[focus.delta < 0 ? 0 : 1])?.focus();
      }
    }
    function move(index, delta) {
      const target = index + delta;
      [order[index], order[target]] = [order[target], order[index]];
      draw({ id: order[target], delta });
    }
    draw();
    body.append(h("p", { class: "hint", text: t("search.customizeHint") }), list);
    const saveButton = h("button", { type: "button", class: "solid-button" }, t("common.save"));
    footer.append(h("button", { type: "button", class: "ghost-button", onclick: close }, t("common.cancel")), saveButton);
    saveButton.addEventListener("click", async () => {
      setBusy([saveButton], true);
      const next = normalizeViewConfig({ ...config, filters: order, hidden: [...hidden] });
      try {
        await ctx.db.saveSearchView(next);
        config = next;
        viewCache.config = next;
        close();
        notify(t("search.customizeSaved"), "success");
        renderChips();
        customizeButton.focus();
      } catch (error) {
        setStatus(errorMessage(error, "search.customizeFailed"));
        setBusy([saveButton], false);
      }
    });
  }

  // ---------------------------------------------------------------- results
  let rows = [];
  let total = 0;
  let searchToken = 0;
  let listElement = null;
  let thumbObserver = null;
  const thumbRows = new WeakMap();

  function renderControls() {
    if (state.target === "history") {
      const order = h("select", { id: "search-order" },
        h("option", { value: "desc", selected: !state.oldest }, t("search.newest")),
        h("option", { value: "asc", selected: state.oldest }, t("search.oldest"))
      );
      order.addEventListener("change", () => {
        state.oldest = order.value === "asc";
        changed({ delay: 0, chips: false });
      });
      controls.replaceChildren(
        h("div", { class: "control" }, h("label", { for: "search-order", class: "control-label", text: t("search.order") }), order)
      );
      return;
    }
    const sort = h("select", { id: "search-sort" },
      SORTS.map((code) => h("option", { value: code, selected: code === state.sort }, t(`search.sortOption.${code}`)))
    );
    sort.addEventListener("change", () => {
      state.sort = sort.value;
      persistView();
      changed({ delay: 0, chips: false });
    });
    const direction = h("button", { type: "button", class: "icon-button sort-direction" });
    const drawDirection = () => {
      direction.textContent = state.desc ? "↓" : "↑";
      direction.setAttribute("aria-label", t(state.desc ? "search.sortDescending" : "search.sortAscending"));
      direction.title = direction.getAttribute("aria-label");
    };
    drawDirection();
    direction.addEventListener("click", () => {
      state.desc = !state.desc;
      drawDirection();
      persistView();
      changed({ delay: 0, chips: false });
    });
    const viewButtons = VIEWS.map((view) =>
      h("button", {
        type: "button",
        class: "segment",
        "aria-pressed": String(state.view === view),
        onclick: () => {
          if (state.view === view) return;
          state.view = view;
          viewButtons.forEach((button, index) => button.setAttribute("aria-pressed", String(VIEWS[index] === view)));
          persistView();
          syncUrl();
          renderResults();
        }
      }, t(`search.viewOption.${view}`))
    );
    controls.replaceChildren(
      h("div", { class: "control" }, h("label", { for: "search-sort", class: "control-label", text: t("search.sort") }), sort, direction),
      h("div", { class: "segmented is-small", role: "group", "aria-label": t("search.view") }, viewButtons)
    );
  }

  function renderHead() {
    const isHistory = state.target === "history";
    countLine.replaceChildren(
      ...[
        h("strong", { text: t(isHistory ? "search.historyResults" : "search.results", { count: total }) }),
        isHistory ? null : h("span", { class: "results-basis", text: t(hasContext(state) ? "search.basisWithin" : "search.basisAll") })
      ].filter(Boolean)
    );
  }

  async function openScore(row) {
    try {
      const files = await ctx.db.scoreFiles(row.score_id);
      openViewer(ctx, { ...scoreOf(row), score_files: files });
    } catch (error) {
      notify(errorMessage(error, "library.openFailed"), "error");
    }
  }

  function rowMenu(row, title) {
    return actionMenu(t("search.moreFor", { title }), [
      { label: t("search.openScore"), onSelect: () => openScore(row) },
      { label: t("search.addToMissa"), onSelect: () => openAddToMissa(ctx, row, roleById) },
      { label: t("search.viewHistory"), onSelect: () => openScoreHistory(ctx, scoreOf(row)) }
    ]);
  }

  function noteLine(source, text) {
    return h("p", { class: "result-note" }, h("span", { class: "note-source", text: source }), h("span", { translate: "no", text }));
  }

  function scoreRow(row) {
    const title = displayScoreTitle(scoreOf(row));
    const key = keyLabel(row.key_tonic, row.key_mode) || row.key_text || "";
    const period = periodName(row.period_code, periods);
    const periodText = period && row.period_provisional ? `${period} (${t("search.provisional")})` : period;
    const meta = [key, periodText].filter(Boolean).join(" · ");
    const notes = state.view === "notes"
      ? h("div", { class: "result-notes", dataset: { score: row.score_id } },
          row.note ? noteLine(t("search.scoreNote"), row.note) : null
        )
      : null;
    return h("li", { class: "result-row" },
      h("div", { class: "result-main" },
        h("button", { type: "button", class: "result-title", translate: "no", onclick: () => openScore(row) }, title),
        h("span", { class: "result-sub" },
          row.composer_label ? h("span", { class: "result-composer", translate: "no", text: row.composer_label }) : null,
          meta ? h("span", { class: "result-meta", translate: "no", text: meta }) : null
        )
      ),
      h("span", { class: "result-key", translate: "no", text: key || "–" }),
      h("span", { class: row.period_provisional ? "result-period is-provisional" : "result-period", title: row.period_provisional ? t("search.provisional") : null },
        period || "–",
        row.period_provisional ? h("span", { class: "visually-hidden", text: ` (${t("search.provisional")})` }) : null
      ),
      h("span", { class: "result-count num" },
        h("span", { "aria-hidden": "true", text: String(row.within_count) }),
        h("span", { class: "visually-hidden", text: t("search.timesPlayed", { count: row.within_count }) })
      ),
      rowMenu(row, title),
      notes
    );
  }

  async function loadNotes(items) {
    if (state.view !== "notes" || !items.length) return;
    let notes = [];
    try {
      notes = await ctx.db.performanceNotes(items.map((row) => row.score_id));
    } catch {
      notes = [];
    }
    for (const row of items) {
      const box = resultsBox.querySelector(`.result-notes[data-score="${row.score_id}"]`);
      if (!box) continue;
      const lines = [
        row.note ? noteLine(t("search.scoreNote"), row.note) : null,
        ...notes
          .filter((note) => note.owned_score_id === row.score_id)
          .slice(0, 5)
          .map((note) => noteLine(t("search.performanceNote", { date: formatShortDate(note.local_date) }), note.note))
      ].filter(Boolean);
      box.replaceChildren(...(lines.length ? lines : [h("p", { class: "result-note is-empty", text: t("search.noNotes") })]));
    }
  }

  // Downloaded with the signed-in session (same address every time), so the browser cache
  // serves repeat views instead of fetching the thumbnail again.
  async function storedThumbUrl(path) {
    return URL.createObjectURL(await ctx.db.download(path));
  }

  // A Score saved before thumbnails existed: make its small thumbnail once from its first page,
  // keep only that image, and use the stored one from then on. Nothing already saved is changed.
  // After a failure the full first page is not downloaded again on this device for a day.
  async function makeMissingThumbnail(row) {
    if (thumbRecentlyFailed(row.score_id)) return null;
    let made;
    try {
      const blob = await ctx.db.download(row.first_file_path);
      let canvas;
      if (row.first_file_mime === "application/pdf") {
        canvas = await pdfFirstPageCanvas(blob);
      } else {
        const bitmap = await createImageBitmap(blob);
        canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        canvas.getContext("2d").drawImage(bitmap, 0, 0);
        bitmap.close?.();
      }
      made = await thumbnailFromCanvas(canvas);
    } catch (error) {
      markThumbFailed(row.score_id);
      throw error;
    }
    try {
      row.thumbnail_path = await ctx.db.addThumbnail({ id: row.score_id }, made, ctx.user.id);
    } catch {
      markThumbFailed(row.score_id); // shown this time from the copy made here, not stored
    }
    return URL.createObjectURL(made.blob);
  }

  async function loadThumb(thumb) {
    const row = thumbRows.get(thumb);
    if (!row) return;
    try {
      const url = row.thumbnail_path ? await storedThumbUrl(row.thumbnail_path) : await makeMissingThumbnail(row);
      if (!url) {
        thumb.replaceChildren(h("span", { class: "preview-empty", text: t("search.noPreview") }));
        return;
      }
      const element = await thumbnailImage(url);
      element.classList.add("preview-image");
      thumb.replaceChildren(element);
    } catch {
      thumb.replaceChildren(h("span", { class: "preview-empty", text: t("viewer.loadFailed") }));
    }
  }

  function watchThumb(thumb, row) {
    thumbRows.set(thumb, row);
    if (!("IntersectionObserver" in window)) {
      loadThumb(thumb);
      return;
    }
    thumbObserver ??= new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        thumbObserver.unobserve(entry.target);
        loadThumb(entry.target);
      }
    }, { rootMargin: "200px" });
    thumbObserver.observe(thumb);
  }

  function previewCard(row) {
    const title = displayScoreTitle(scoreOf(row));
    const thumb = h("span", { class: "preview-thumb" });
    if (row.first_file_path) {
      thumb.append(h("span", { class: "preview-empty", text: t("common.loading") }));
      watchThumb(thumb, row);
    } else {
      thumb.append(h("span", { class: "preview-empty", text: t("search.noPreview") }));
    }
    return h("li", { class: "preview-card" },
      row.first_file_path
        ? h("button", { type: "button", class: "preview-open", "aria-label": `${t("search.openScore")}: ${title}`, onclick: () => openScore(row) }, thumb)
        : thumb,
      h("div", { class: "preview-body" },
        h("div", { class: "preview-text" },
          h("strong", { class: "preview-title", translate: "no", text: title }),
          row.composer_label ? h("span", { class: "meta", translate: "no", text: row.composer_label }) : null,
          h("span", { class: "meta", text: t("search.timesPlayed", { count: row.within_count }) })
        ),
        rowMenu(row, title)
      )
    );
  }

  function historyRow(row) {
    const title = displayScoreTitle(scoreOf(row));
    const part = row.part_display_name || partName(roleById.get(row.role_id));
    return h("li", { class: "history-result" },
      h("a", { href: `#/mass/${row.mass_event_id}`, class: "history-link" },
        h("span", { class: "history-date num", lang: "ko", text: formatShortDate(row.local_date) }),
        h("span", { class: "history-part", translate: "no", text: part }),
        h("span", { class: "history-place", translate: "no", text: row.venue_label || "—" }),
        h("span", { class: "history-score", translate: "no" },
          h("span", { class: "history-title", text: title }),
          row.composer_label ? h("span", { class: "history-composer", text: row.composer_label }) : null
        )
      ),
      row.note ? h("p", { class: "history-note", translate: "no", text: row.note }) : null
    );
  }

  function columnsHead(names, className) {
    return h("div", { class: `result-columns ${className}`, "aria-hidden": "true" }, names.map((name) => h("span", { text: name })));
  }

  function itemFor(row) {
    if (state.target === "history") return historyRow(row);
    return state.view === "preview" ? previewCard(row) : scoreRow(row);
  }

  function renderResults({ appended = null } = {}) {
    renderHead();
    moreButton.hidden = rows.length >= total || !rows.length;
    if (appended && listElement?.isConnected) {
      listElement.append(...appended.map(itemFor));
      loadNotes(appended);
      return;
    }
    thumbObserver?.disconnect();
    if (!rows.length) {
      listElement = null;
      const noFilters = !state.q.trim() && !FILTER_IDS.some((id) => isFilterActive(state, id));
      const key = state.target === "history" ? "search.emptyHistory" : noFilters ? "search.emptyLibrary" : "search.empty";
      resultsBox.replaceChildren(h("p", { class: "empty", text: t(key) }));
      return;
    }
    if (state.target === "history") {
      listElement = h("ol", { class: "history-results" }, rows.map(historyRow));
      resultsBox.replaceChildren(
        columnsHead([t("search.colDate"), t("search.colPart"), t("search.colPlace"), t("search.colScore")], "is-history"),
        listElement
      );
      return;
    }
    if (state.view === "preview") {
      listElement = h("ol", { class: "preview-grid" }, rows.map(previewCard));
      resultsBox.replaceChildren(listElement);
      return;
    }
    listElement = h("ol", { class: state.view === "notes" ? "result-list is-notes" : "result-list" }, rows.map(scoreRow));
    resultsBox.replaceChildren(
      columnsHead([t("search.colTitle"), t("search.colKey"), t("search.colPeriod"), t("search.colCount"), ""], "is-scores"),
      listElement
    );
    loadNotes(rows);
  }

  async function runSearch({ append = false } = {}) {
    const mine = ++searchToken;
    const offset = append ? rows.length : 0;
    resultsBox.setAttribute("aria-busy", "true");
    moreButton.disabled = true;
    const slow = append
      ? null
      : setTimeout(() => {
          if (mine === searchToken) countLine.replaceChildren(h("span", { class: "meta", text: t("common.loading") }));
        }, 150);
    try {
      const filters = searchFilters(state);
      const data =
        state.target === "history"
          ? await ctx.db.searchHistory(filters, { descending: !state.oldest, offset })
          : await ctx.db.searchScores(filters, { sort: state.sort, descending: state.desc, offset });
      if (mine !== searchToken) return;
      rows = append ? rows.concat(data) : data;
      if (data.length) total = Number(data[0].total_count) || rows.length;
      else if (!append) total = 0;
      renderResults({ appended: append ? data : null });
    } catch (error) {
      if (mine !== searchToken) return;
      countLine.replaceChildren();
      moreButton.hidden = true;
      listElement = null;
      resultsBox.replaceChildren(
        h("div", { class: "error-box" },
          h("p", { text: errorMessage(error, "search.failed") }),
          h("button", { type: "button", class: "ghost-button", onclick: () => runSearch() }, t("common.retry"))
        )
      );
    } finally {
      clearTimeout(slow);
      if (mine === searchToken) {
        resultsBox.removeAttribute("aria-busy");
        moreButton.disabled = false;
      }
    }
  }

  renderChips();
  renderControls();
  syncUrl();
  await runSearch();
}
