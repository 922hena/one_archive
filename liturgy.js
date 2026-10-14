/* 날짜로 전례력 이름을 계산합니다(일요일과 주요 대축일 중심). 저장된 값이 아니라 계산값입니다. */

const DAY = 86400000;
const utc = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
const addDays = (date, n) => new Date(date.getTime() + n * DAY);
const sameDay = (a, b) => a.getTime() === b.getTime();

function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return utc(year, month, day);
}

function sundayOnOrAfter(date) {
  return addDays(date, (7 - date.getUTCDay()) % 7);
}

export function liturgicalName(isoDate) {
  const [y, m, d] = String(isoDate).split("-").map(Number);
  if (!y || !m || !d) return "";
  const date = utc(y, m, d);

  if (m === 12 && d === 25) return "주님 성탄 대축일";
  if (m === 1 && d === 1) return "천주의 성모 마리아 대축일";

  const easter = easterSunday(y);
  const diff = Math.round((date - easter) / DAY);
  if (diff === -46) return "재의 수요일";
  if (diff === -7) return "주님 수난 성지 주일";
  if (diff === -3) return "성주간 목요일";
  if (diff === -2) return "주님 수난 성금요일";
  if (diff === -1) return "성토요일";
  if (diff === 0) return "주님 부활 대축일";
  if (diff === 42) return "주님 승천 대축일";
  if (diff === 49) return "성령 강림 대축일";
  if (diff === 56) return "지극히 거룩하신 삼위일체 대축일";
  if (diff === 63) return "지극히 거룩하신 그리스도의 성체 성혈 대축일";

  if (date.getUTCDay() !== 0) return "";

  if (diff > -42 && diff < -7) return `사순 제 ${Math.round((diff + 42) / 7) + 1}주일`;
  if (diff === -42) return "사순 제 1주일";
  if (diff > 0 && diff < 42) return `부활 제 ${diff / 7 + 1}주일`;

  const christmas = utc(y, 12, 25);
  const advent4 = addDays(christmas, -(((christmas.getUTCDay() + 6) % 7) + 1));
  const advent1 = addDays(advent4, -21);
  if (date >= advent1 && date <= advent4) return `대림 제 ${Math.round((date - advent1) / DAY / 7) + 1}주일`;
  if (sameDay(date, addDays(advent1, -7))) return "온 누리의 임금이신 그리스도 왕 대축일";
  if (date > advent4) return "성탄 시기 주일";

  const epiphany = sundayOnOrAfter(utc(y, 1, 2));
  if (sameDay(date, epiphany)) return "주님 공현 대축일";
  if (date < epiphany) return "성탄 시기 주일";
  /* 공현이 1/7·1/8이면 세례 축일은 월요일이라 그다음 일요일이 연중 제2주일입니다. */
  const baptismOnSunday = epiphany.getUTCDate() <= 6;
  if (baptismOnSunday && sameDay(date, addDays(epiphany, 7))) return "주님 세례 축일";
  const secondSunday = addDays(epiphany, baptismOnSunday ? 14 : 7);

  const christKing = addDays(advent1, -7);
  if (date < easter) {
    const week = Math.round((date - secondSunday) / DAY / 7) + 2;
    return `연중 제 ${week}주일`;
  }
  const week = 34 - Math.round((christKing - date) / DAY / 7);
  return `연중 제 ${week}주일`;
}

