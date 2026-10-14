import { liturgicalName } from "./liturgy.js";

const ROLE_LABELS = {
  entrance: "입당성가", kyrie: "자비송", gloria: "대영광송", psalm: "화답송",
  gospel_acclamation: "복음환호송", prayer_response: "보편지향기도응답",
  offertory_1: "봉헌성가 1", offertory_2: "봉헌성가 2", sanctus: "거룩하시도다",
  mystery_of_faith: "신앙의 신비여", amen: "아멘", lords_prayer: "주님의 기도",
  doxology: "주님께 나라와", agnus_dei: "하느님의 어린양", special_song: "특송",
  communion_1: "성체성가 1", communion_2: "성체성가 2", meditation: "영성체후 묵상곡",
  dismissal: "파견성가", postlude: "후주",
};

function todayIso() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function dateText(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${y}년 ${m}월 ${d}일`;
}

function massName(time) {
  const [h] = String(time).split(":").map(Number);
  if (!Number.isFinite(h)) return "미사";
  if (h === 0 || h === 24) return "자정 미사";
  return `${h < 12 ? "오전" : "오후"} ${h > 12 ? h - 12 : h}시 미사`;
}

/* 연주 여부가 기록되지 않은 과거 미사는 '미정'으로 둡니다(임의로 연주 완료 처리하지 않음). */
function statusOf(row, today) {
  if (row.played) return { key: "played", text: "연주 ○" };
  if (row.mass.service_date >= today) return { key: "planned", text: "예정" };
  return { key: "unknown", text: "미정" };
}

export async function loadScoreHistory(supabase, scoreId) {
  const { data, error } = await supabase
    .from("mass_score_links")
    .select("id, mass_id, music_role, played, memo, mass:mass_schedules(service_date, service_time, place)")
    .eq("score_id", scoreId);
  if (error) throw error;
  const today = todayIso();
  const rows = (data ?? []).filter((row) => row.mass);
  rows.sort((a, b) => {
    const left = `${a.mass.service_date} ${a.mass.service_time}`;
    const right = `${b.mass.service_date} ${b.mass.service_time}`;
    return left < right ? 1 : left > right ? -1 : 0;
  });
  return rows.map((row) => ({ ...row, status: statusOf(row, today) }));
}

export function renderScoreHistory(container, rows) {
  container.replaceChildren();
  const heading = document.createElement("h3");
  heading.textContent = "연주 이력";
  const summary = document.createElement("p");
  summary.className = "history-summary";
  const playedCount = rows.filter((row) => row.played).length;
  summary.textContent = `총 연결 ${rows.length}회 · 실제 연주 ${playedCount}회`;
  container.append(heading, summary);

  if (rows.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-copy";
    empty.textContent = "아직 이 악보를 연결한 미사가 없습니다.";
    container.append(empty);
    return;
  }

  const list = document.createElement("ul");
  list.className = "history-list";
  rows.forEach((row) => {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.className = "history-item";
    link.href = `mass.html?id=${encodeURIComponent(row.mass_id)}`;

    const liturgy = liturgicalName(row.mass.service_date);
    const line = document.createElement("span");
    line.className = "history-line";
    line.textContent = [
      liturgy ? `${dateText(row.mass.service_date)}(${liturgy})` : dateText(row.mass.service_date),
      row.mass.place,
      massName(row.mass.service_time),
      ROLE_LABELS[row.music_role] ?? "역할",
    ].filter(Boolean).join(", ");

    const badge = document.createElement("span");
    badge.className = `history-status is-${row.status.key}`;
    badge.textContent = row.status.text;

    link.append(line, badge);
    if (row.memo && row.memo.trim()) {
      const memo = document.createElement("span");
      memo.className = "history-memo";
      memo.textContent = `메모: ${row.memo.trim()}`;
      link.append(memo);
    }
    item.append(link);
    list.append(item);
  });
  container.append(list);
}
