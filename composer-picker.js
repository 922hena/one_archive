/* 작곡가 자동완성: 입력 → 목록 선택, 없으면 새 작곡가 추가. 선택된 값은 composer_id로 저장합니다. */

function lifeText(row) {
  const years = row.birth_year || row.death_year ? `${row.birth_year ?? "?"}–${row.death_year ?? "?"}` : "";
  return [years, row.country].filter(Boolean).join(", ");
}

export function composerLabel(row) {
  const life = lifeText(row);
  return life ? `${row.display_name} (${life})` : row.display_name;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function createComposerPicker({ supabase, input, onChange = () => {} }) {
  const box = input.parentElement;
  box.classList.add("composer-box");
  input.setAttribute("autocomplete", "off");
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");

  const list = el("ul", "composer-list");
  list.setAttribute("role", "listbox");
  list.hidden = true;
  const note = el("p", "composer-note");
  note.hidden = true;
  const form = el("div", "composer-add");
  form.hidden = true;
  box.append(list, note, form);

  let selected = null;
  let items = [];
  let active = -1;
  let timer = null;
  let token = 0;
  let disabled = false;

  function hideList() {
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    active = -1;
  }

  function setNote(text) {
    note.textContent = text;
    note.hidden = !text;
  }

  function choose(row) {
    selected = row;
    input.value = row.display_name;
    hideList();
    closeForm();
    setNote("");
    onChange(selected);
  }

  function highlight(index) {
    active = index;
    [...list.children].forEach((node, i) => node.classList.toggle("is-active", i === index));
  }

  function render(rows, query) {
    items = rows;
    list.replaceChildren();
    rows.forEach((row, i) => {
      const item = el("li", "composer-item");
      item.setAttribute("role", "option");
      const main = el("span", "composer-main", composerLabel(row));
      item.append(main);
      const sub = [row.korean_name, row.is_mine ? "내가 추가함" : ""].filter(Boolean).join(" · ");
      if (sub) item.append(el("span", "composer-sub", sub));
      item.addEventListener("mousedown", (event) => {
        event.preventDefault();
        choose(row);
      });
      item.addEventListener("mousemove", () => highlight(i));
      list.append(item);
    });
    if (query) {
      const add = el("li", "composer-item composer-add-item");
      add.setAttribute("role", "option");
      add.append(el("span", "composer-main", rows.length ? `찾는 작곡가가 없나요? ‘${query}’ 새로 추가` : `‘${query}’ 검색 결과가 없습니다. 새 작곡가로 추가`));
      add.addEventListener("mousedown", (event) => {
        event.preventDefault();
        openForm(query);
      });
      list.append(add);
    }
    list.hidden = list.children.length === 0;
    input.setAttribute("aria-expanded", String(!list.hidden));
    highlight(-1);
  }

  async function search() {
    const query = input.value.trim();
    const mine = ++token;
    const { data, error } = await supabase.rpc("search_composers", { p_query: query, p_limit: 8 });
    if (mine !== token) return;
    if (error) {
      setNote("작곡가 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
      hideList();
      return;
    }
    setNote("");
    render(data ?? [], query);
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(search, 180);
  }

  /* ---------- 새 작곡가 추가 ---------- */

  function closeForm() {
    form.hidden = true;
    form.replaceChildren();
  }

  function openForm(name) {
    hideList();
    form.replaceChildren();
    const field = (label, attrs = {}) => {
      const wrap = el("label", "composer-add-field");
      wrap.append(el("span", "", label));
      const control = el("input");
      Object.entries({ type: "text", maxLength: 120, autocomplete: "off", ...attrs }).forEach(([k, v]) => {
        control[k] = v;
      });
      wrap.append(control);
      form.append(wrap);
      return control;
    };
    form.append(el("strong", "composer-add-title", "새 작곡가 추가"));
    const nameInput = field("이름 (영문 정식 이름 권장)");
    nameInput.value = name;
    const koInput = field("한글 이름 (선택)", { maxLength: 60 });
    const birthInput = field("출생 연도 (선택)", { type: "number", min: 1000, max: 2100, inputMode: "numeric" });
    const deathInput = field("사망 연도 (선택)", { type: "number", min: 1000, max: 2100, inputMode: "numeric" });
    const countryInput = field("국가·지역 (선택)", { maxLength: 80 });
    form.append(el("p", "composer-add-hint", "모르는 연도와 국가는 비워 두세요. 추측해서 입력하지 않아도 됩니다."));
    const message = el("p", "composer-add-error");
    message.hidden = true;
    const actions = el("div", "composer-add-actions");
    const save = el("button", "strip-button strong", "추가");
    save.type = "button";
    const cancel = el("button", "strip-button", "취소");
    cancel.type = "button";
    actions.append(save, cancel);
    form.append(message, actions);
    form.hidden = false;
    nameInput.focus();

    const fail = (text) => {
      message.textContent = text;
      message.hidden = false;
    };
    cancel.addEventListener("click", closeForm);
    save.addEventListener("click", async () => {
      message.hidden = true;
      const canonical = nameInput.value.trim();
      if (!canonical) return fail("이름을 입력해 주세요.");
      const birth = birthInput.value.trim() === "" ? null : Number(birthInput.value);
      const death = deathInput.value.trim() === "" ? null : Number(deathInput.value);
      for (const year of [birth, death]) {
        if (year !== null && (!Number.isInteger(year) || year < 1000 || year > 2100)) return fail("연도는 1000~2100 사이로 입력해 주세요.");
      }
      if (birth !== null && death !== null && death < birth) return fail("사망 연도가 출생 연도보다 빠릅니다.");
      save.disabled = true;
      const { data, error } = await supabase
        .from("composers")
        .insert({
          canonical_name: canonical,
          display_name: canonical,
          korean_name: koInput.value.trim() || null,
          birth_year: birth,
          death_year: death,
          country: countryInput.value.trim() || null
        })
        .select("id, canonical_name, display_name, korean_name, birth_year, death_year, country, aliases")
        .single();
      save.disabled = false;
      if (error || !data) {
        if (error?.code === "23505") {
          fail("이미 등록된 작곡가입니다. 이름을 목록에서 찾아 선택해 주세요.");
          input.value = canonical;
          search();
          return;
        }
        return fail("작곡가를 추가하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      }
      choose({ ...data, is_mine: true });
    });
  }

  /* ---------- 입력 이벤트 ---------- */

  input.addEventListener("input", () => {
    if (selected) {
      selected = null;
      onChange(null);
    }
    closeForm();
    schedule();
  });
  input.addEventListener("focus", () => {
    if (!disabled && !selected) schedule();
  });
  input.addEventListener("blur", () => setTimeout(hideList, 120));
  input.addEventListener("keydown", (event) => {
    if (list.hidden) return;
    const count = list.children.length;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      highlight((active + 1) % count);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      highlight((active - 1 + count) % count);
    } else if (event.key === "Enter" && active >= 0) {
      event.preventDefault();
      if (active < items.length) choose(items[active]);
      else openForm(input.value.trim());
    } else if (event.key === "Escape") {
      hideList();
    }
  });

  return {
    /* 저장할 값. 입력이 있는데 목록에서 고르지 않았다면 unresolved */
    value() {
      const text = input.value.trim();
      if (!text) return { id: null, empty: true, unresolved: false };
      if (selected) return { id: selected.id, empty: false, unresolved: false };
      return { id: null, empty: false, unresolved: true };
    },
    set(row) {
      selected = row ?? null;
      input.value = row ? row.display_name : "";
      closeForm();
      hideList();
      setNote("");
    },
    clear() {
      this.set(null);
    },
    setDisabled(value) {
      disabled = value;
      input.disabled = value;
      if (value) {
        hideList();
        closeForm();
      }
    }
  };
}
