// Score key and musical period helpers (PRD 4.13.2.4 and 4.13.2.6). Same values as the database checks.
export const KEY_TONICS = ["Cb", "C", "C#", "Db", "D", "D#", "Eb", "E", "E#", "Fb", "F", "F#", "Gb", "G", "G#", "Ab", "A", "A#", "Bb", "B", "B#"];
export const KEY_MODES = ["major", "minor", "modal", "ambiguous", "atonal"];

export function tonicLabel(tonic) {
  if (!tonic) return "";
  return tonic.replace("#", "♯").replace(/^([A-G])b$/, "$1♭");
}

const SHARP = "#";
const FLAT = "b";
const SOLFEGE = { do: "C", ut: "C", re: "D", "ré": "D", mi: "E", fa: "F", sol: "G", la: "A", si: "B" };
const KOREAN = { "다": "C", "라": "D", "마": "E", "바": "F", "사": "G", "가": "A", "나": "B" };
// German names: H = B, B = B flat; -is = sharp, -es / -s = flat.
const GERMAN = {
  c: "C", cis: "C#", ces: "Cb", d: "D", dis: "D#", des: "Db", e: "E", eis: "E#", es: "Eb", f: "F", fis: "F#", fes: "Fb",
  g: "G", gis: "G#", ges: "Gb", a: "A", ais: "A#", as: "Ab", h: "B", his: "B#", b: "Bb"
};

function key(tonic, mode) {
  return KEY_TONICS.includes(tonic) && KEY_MODES.includes(mode) ? { tonic, mode } : null;
}

// Suggests the standard key for a key written on the score, e.g. "d-Moll", "ré mineur", "B-flat major", "내림나장조".
// Returns null when the text is not recognised; the written text is always kept as it is.
export function parseKeyText(text) {
  const value = String(text ?? "").normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ");
  if (!value) return null;

  let match = /^(올림|내림)? ?([다라마바사가나]) ?(장조|단조)$/.exec(value);
  if (match) {
    const accidental = match[1] === "올림" ? SHARP : match[1] === "내림" ? FLAT : "";
    return key(KOREAN[match[2]] + accidental, match[3] === "장조" ? "major" : "minor");
  }

  match = /^([a-h](?:is|es|s)?)[ -]?(dur|moll)$/.exec(value);
  if (match && GERMAN[match[1]]) return key(GERMAN[match[1]], match[2] === "dur" ? "major" : "minor");

  match = /^(do|ut|ré|re|mi|fa|sol|la|si) ?(dièse|diese|bémol|bemol|diesis|bemolle)? ?(majeur|mineur|maggiore|minore)$/.exec(value);
  if (match) {
    const accidental = /^di/.test(match[2] ?? "") ? SHARP : /^b/.test(match[2] ?? "") ? FLAT : "";
    return key(SOLFEGE[match[1]] + accidental, /^ma/.test(match[3]) ? "major" : "minor");
  }

  match = /^([a-g]) ?(#|♯|b|♭|-?sharp|-?flat)? ?(major|minor|maj|min)$/.exec(value);
  if (match) {
    const sign = match[2] ?? "";
    const accidental = /#|♯|sharp/.test(sign) ? SHARP : /b|♭|flat/.test(sign) ? FLAT : "";
    return key(match[1].toUpperCase() + accidental, match[3].startsWith("maj") ? "major" : "minor");
  }
  return null;
}

// periods: rows of musical_periods. Years are [start_year, end_year).
export function periodForYear(year, periods) {
  const value = Number(year);
  if (!Number.isInteger(value)) return null;
  const sorted = [...(periods ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  const found = sorted.find(
    (period) => (period.start_year == null || value >= period.start_year) && (period.end_year == null || value < period.end_year)
  );
  return found?.code ?? null;
}

// ---- optional Score information (PRD RIGHT-001). Limits match the database checks.
export const DIFFICULTY_LEVELS = [1, 2, 3, 4, 5];
export const MAX_DURATION_SECONDS = 36000;

// "4:30" (minutes:seconds) or "4" (whole minutes) -> { ok, value: seconds }. Blank is allowed (value null).
export function parseDuration(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return { ok: true, value: null };
  const match = /^(\d{1,3}):([0-5]\d)$/.exec(raw);
  const seconds = match ? Number(match[1]) * 60 + Number(match[2]) : /^\d{1,3}$/.test(raw) ? Number(raw) * 60 : Number.NaN;
  return seconds >= 1 && seconds <= MAX_DURATION_SECONDS ? { ok: true, value: seconds } : { ok: false, value: null };
}

// 270 -> "4:30"
export function formatDuration(seconds) {
  const value = Number(seconds);
  if (!Number.isInteger(value) || value <= 0) return "";
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

// A web address the database accepts: http:// or https://, no spaces, at most 2000 characters.
export function isWebLink(text) {
  const value = String(text ?? "").trim();
  return value.length <= 2000 && /^https?:\/\/\S+$/i.test(value);
}

// The member's choice first, then the composition year, then the composer's period (provisional).
export function scorePeriod(score, periods, composerPeriod = null) {
  if (score?.period_code) return { code: score.period_code, provisional: false };
  const fromYear = periodForYear(score?.composition_year, periods);
  if (fromYear) return { code: fromYear, provisional: false };
  if (composerPeriod) return { code: composerPeriod, provisional: true };
  return { code: null, provisional: false };
}
