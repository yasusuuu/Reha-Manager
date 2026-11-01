import React, { useEffect, useMemo, useRef, useState } from "react";
import { Menu, X, UserRound, ChartColumnIncreasing, Settings2, CalendarClock, Users, UsersRound, CalendarCheck, BookOpen, LogOut, ChevronDown, ChevronUp, Pencil, Trash2 } from "lucide-react";
import { signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { auth, provider, db } from "./firebase/firebase";
import "./App.css";
import {
  applyPwaUpdate,
  checkForPwaUpdate,
  clearPwaCacheAndReload,
  subscribePwaUpdate,
} from "./pwaUpdate.js";

const FULL_DAY_HOURS = 7.75;
const MORNING_HOURS = 3.5;
const AFTERNOON_HOURS = 4.25;
const SUMMER_LIMIT = 5;

const LEAVE_TYPES = {
  compensatory: "代休",
  paid: "有休",
  child: "看護休暇",
  summer: "夏季休暇",
  special: "特別休暇",
  holiday: "休日出勤",
  other: "その他予定",
};

// 過去データの表示互換用。新規登録の選択肢には表示しません。
const LEGACY_LEAVE_TYPE_LABELS = {
  training: "研修",
  business: "出張",
  saturday: "土曜勤務",
};

const REGISTER_TYPE_OPTIONS = [
  ["compensatory", "代休"],
  ["paid", "有休"],
  ["child", "看護休暇"],
  ["summer", "夏季休暇"],
  ["special", "特別休暇"],
  ["holiday", "休日出勤"],
  ["other", "その他予定"],
];

const METHODS = {
  full: "終日",
  morning: "午前休",
  afternoon: "午後休",
  time: "時間休",
};

const HOLIDAY_WORK_METHODS = {
  full: "終日",
  morning: "午前",
  afternoon: "午後",
  time: "時間指定",
};

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

const ANNOUNCEMENT_TYPES = {
  single: "単発",
  weekly: "毎週",
  monthlyNth: "毎月第◯曜日",
};

const SATURDAY_GROUP_KEYS = ["A", "B", "C", "D"];
// App29: 日付タップで休暇・勤務登録を直接開く動作を復旧。
// 土曜勤務の変更・解除・復元ロジック自体は既存処理を利用する。
const LEAVE_SELECT_VISIBLE_STYLE = {
  color: "#0f172a",
  WebkitTextFillColor: "#0f172a",
  backgroundColor: "#ffffff",
  opacity: 1,
  appearance: "auto",
  WebkitAppearance: "menulist",
};


function makeId(prefix = "id") {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function defaultSaturdayGroups(staffList) {
  const groups = { A: [], B: [], C: [], D: [] };
  staffList.forEach((member, index) => {
    groups[SATURDAY_GROUP_KEYS[index % SATURDAY_GROUP_KEYS.length]].push(member.id);
  });
  return groups;
}

const HOLIDAY_CSV_URL = "https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv";

// 内閣府CSVの取得に失敗した時の予備データです。
// CSV取得が成功すれば、1955年以降の祝日データで上書きされます。
const FALLBACK_HOLIDAYS = {
  "2026-01-01": "元日",
  "2026-01-12": "成人の日",
  "2026-02-11": "建国記念の日",
  "2026-02-23": "天皇誕生日",
  "2026-03-20": "春分の日",
  "2026-04-29": "昭和の日",
  "2026-05-03": "憲法記念日",
  "2026-05-04": "みどりの日",
  "2026-05-05": "こどもの日",
  "2026-05-06": "休日",
  "2026-07-20": "海の日",
  "2026-08-11": "山の日",
  "2026-09-21": "敬老の日",
  "2026-09-22": "休日",
  "2026-09-23": "秋分の日",
  "2026-10-12": "スポーツの日",
  "2026-11-03": "文化の日",
  "2026-11-23": "勤労感謝の日",
  "2027-01-01": "元日",
  "2027-01-11": "成人の日",
  "2027-02-11": "建国記念の日",
  "2027-02-23": "天皇誕生日",
  "2027-03-21": "春分の日",
  "2027-03-22": "休日",
  "2027-04-29": "昭和の日",
  "2027-05-03": "憲法記念日",
  "2027-05-04": "みどりの日",
  "2027-05-05": "こどもの日",
  "2027-07-19": "海の日",
  "2027-08-11": "山の日",
  "2027-09-20": "敬老の日",
  "2027-09-23": "秋分の日",
  "2027-10-11": "スポーツの日",
  "2027-11-03": "文化の日",
  "2027-11-23": "勤労感謝の日",
};

function pad(n) {
  return String(n).padStart(2, "0");
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function toMinutes(time) {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function overlapMinutes(aStart, aEnd, bStart, bEnd) {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

function makeTimeOptions(start = "08:30", end = "17:15", stepMinutes = 15) {
  const options = [];
  const startMinutes = toMinutes(start);
  const endMinutes = toMinutes(end);

  for (let minutes = startMinutes; minutes <= endMinutes; minutes += stepMinutes) {
    options.push(`${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`);
  }

  return options;
}

const TIME_LEAVE_OPTIONS = makeTimeOptions();
const TIME_HOUR_OPTIONS = ["8", "9", "10", "11", "12", "13", "14", "15", "16", "17"];
const TIME_MINUTE_OPTIONS = ["00", "15", "30", "45"];

function calcTimeHours(start, end, deductBreak = false) {
  const workStart = toMinutes("08:30");
  const workEnd = toMinutes("17:15");
  const startMinutes = toMinutes(start);
  const endMinutes = toMinutes(end);

  // 勤務時間内（08:30〜17:15）の入力だけを計算対象にする。
  if (
    startMinutes < workStart ||
    startMinutes > workEnd ||
    endMinutes < workStart ||
    endMinutes > workEnd ||
    endMinutes <= startMinutes
  ) {
    return 0;
  }

  let minutes = endMinutes - startMinutes;

  // チェックされた場合だけ、昼休憩（12:00〜13:00）との重複時間を控除する。
  if (deductBreak) {
    minutes -= overlapMinutes(
      startMinutes,
      endMinutes,
      toMinutes("12:00"),
      toMinutes("13:00")
    );
  }

  return Math.max(0, Math.round((minutes / 60) * 100) / 100);
}

function getHours(record) {
  if (record.method === "full") return FULL_DAY_HOURS;
  if (record.method === "morning") return MORNING_HOURS;
  if (record.method === "afternoon") return AFTERNOON_HOURS;
  if (record.method === "time") {
    // 旧データのincludeBreakは「休憩を含める」指定だったため、
    // deductBreakが未保存の記録だけ反転して互換性を保つ。
    const deductBreak = record.deductBreak ?? !record.includeBreak;
    return calcTimeHours(record.start, record.end, deductBreak);
  }
  return 0;
}

function fiscalYear(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  return d.getMonth() + 1 >= 4 ? d.getFullYear() : d.getFullYear() - 1;
}

function formatHours(hours) {
  return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(2).replace(/\.00$/, "")}h`;
}

function submitFormat(hours) {
  const days = Math.floor(hours / FULL_DAY_HOURS);
  const rest = Math.round((hours - days * FULL_DAY_HOURS) * 100) / 100;
  if (days === 0) return formatHours(rest);
  if (rest === 0) return `${days}日`;
  return `${days}日${formatHours(rest)}`;
}

function monthDays(year, month) {
  return new Date(year, month, 0).getDate();
}

function dateKey(year, month, day) {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function addDateDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function toDateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function dateLabel(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  return `${d.getMonth() + 1}/${d.getDate()}（${WEEKDAYS[d.getDay()]}）`;
}

function compareDateStr(a, b) {
  return String(a || "").localeCompare(String(b || ""));
}

function normalizeHolidayDate(value) {
  const raw = String(value || "").trim().replace(/^"|"$/g, "");
  if (!raw) return "";

  const isoMatch = raw.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
  if (isoMatch) return `${isoMatch[1]}-${pad(isoMatch[2])}-${pad(isoMatch[3])}`;

  const japaneseMatch = raw.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日$/);
  if (japaneseMatch) return `${japaneseMatch[1]}-${pad(japaneseMatch[2])}-${pad(japaneseMatch[3])}`;

  return "";
}

function parseHolidayCsv(csvText) {
  const holidays = {};
  const lines = String(csvText || "").replace(/^\uFEFF/, "").split(/\r?\n/);

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.includes("国民の祝日")) return;

    const [dateValue, nameValue] = trimmed.split(",");
    const date = normalizeHolidayDate(dateValue);
    const name = String(nameValue || "").trim().replace(/^"|"$/g, "");
    if (date && name) holidays[date] = name;
  });

  return holidays;
}

async function fetchJapaneseHolidays() {
  const response = await fetch(HOLIDAY_CSV_URL, { cache: "no-store" });
  if (!response.ok) throw new Error("祝日CSVの取得に失敗しました");

  const buffer = await response.arrayBuffer();
  let text = "";

  try {
    text = new TextDecoder("shift-jis").decode(buffer);
  } catch {
    text = new TextDecoder("utf-8").decode(buffer);
  }

  return parseHolidayCsv(text);
}

function getMonthlyNthDate(year, monthIndex, nth, weekday) {
  const first = new Date(year, monthIndex, 1);
  const firstWeekday = first.getDay();
  const offset = (Number(weekday) - firstWeekday + 7) % 7;
  const day = 1 + offset + (Number(nth) - 1) * 7;
  const candidate = new Date(year, monthIndex, day);
  if (candidate.getMonth() !== monthIndex) return null;
  return candidate;
}

function announcementScheduleText(item) {
  if (item.scheduleType === "weekly") {
    return `毎週${WEEKDAYS[Number(item.weekday)]}曜${item.time ? ` ${item.time}` : ""}`;
  }
  if (item.scheduleType === "monthlyNth") {
    return `毎月第${item.nth}${WEEKDAYS[Number(item.weekday)]}曜${item.time ? ` ${item.time}` : ""}`;
  }
  return `${item.date ? dateLabel(item.date) : "日付未設定"}${item.time ? ` ${item.time}` : ""}`;
}

function expandAnnouncements(announcements, targetDateStr = todayKey()) {
  const target = new Date(`${targetDateStr}T00:00:00`);
  const targetWeekday = target.getDay();
  const targetNth = Math.floor((target.getDate() - 1) / 7) + 1;

  const items = [];

  announcements
    .filter((item) => !item.disabled)
    .forEach((item) => {
      const scheduleType = item.scheduleType || "single";

      // 掲載終了日が設定されている場合だけ、終了日を過ぎたら非表示。
      // 未入力なら、定期予定はずっと繰り返し表示します。
      if (item.endDate && compareDateStr(targetDateStr, item.endDate) > 0) return;

      if (scheduleType === "single") {
        if (item.date === targetDateStr) {
          items.push({ ...item, occurrenceDate: targetDateStr });
        }
        return;
      }

      if (scheduleType === "weekly") {
        if (Number(item.weekday) === targetWeekday) {
          items.push({ ...item, occurrenceDate: targetDateStr });
        }
        return;
      }

      if (scheduleType === "monthlyNth") {
        if (Number(item.weekday) === targetWeekday && Number(item.nth) === targetNth) {
          items.push({ ...item, occurrenceDate: targetDateStr });
        }
      }
    });

  return items.sort((a, b) => (a.time || "99:99").localeCompare(b.time || "99:99"));
}

const COMPENSATORY_DAY_MINUTES = 465; // 7時間45分

function formatMinutesJa(minutes) {
  const safe = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(safe / 60);
  const mins = safe % 60;
  if (hours > 0 && mins > 0) return `${hours}時間${mins}分`;
  if (hours > 0) return `${hours}時間`;
  return `${mins}分`;
}

function compensatoryRecordMinutes(record) {
  if (!record || record.type !== "compensatory") return 0;
  if (record.method === "time") return Math.max(0, Math.round(getHours(record) * 60));
  return COMPENSATORY_DAY_MINUTES;
}

function sourceDateShortLabel(dateStr) {
  if (!dateStr) return "";
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function recordDisplay(record) {
  if (record.type === "compensatory") {
    return record.compensatorySourceDate
      ? `代休(${sourceDateShortLabel(record.compensatorySourceDate)}出勤分)`
      : "代休";
  }

  if (record.type === "paid") {
    if (record.method === "full") return "有休";
    if (record.method === "morning") return "午前休";
    if (record.method === "afternoon") return "午後休";
    return `時間休（${formatHours(getHours(record))}）`;
  }

  if (record.type === "child") {
    if (record.method === "full") return "看護休暇";
    if (record.method === "morning") return "看護午前";
    if (record.method === "afternoon") return "看護午後";
    return `看護${formatHours(getHours(record))}`;
  }

  if (record.type === "summer") {
    const nums = ["①", "②", "③", "④", "⑤"];
    return `夏季休暇${nums[record.summerNumber - 1] || record.summerNumber}`;
  }

  if (record.type === "holiday") {
    if (record.method === "morning") return "休日出勤（午前）";
    if (record.method === "afternoon") return "休日出勤（午後）";
    if (record.method === "time") return `休日出勤（${record.start}〜${record.end}）`;
    return "休日出勤（終日）";
  }

  if (record.type === "other") {
    if (record.method === "morning") return "その他予定（午前）";
    if (record.method === "afternoon") return "その他予定（午後）";
    if (record.method === "time") return `その他予定（${record.start}〜${record.end}）`;
    return "その他予定（終日）";
  }

  return LEAVE_TYPES[record.type] || LEGACY_LEAVE_TYPE_LABELS[record.type] || "";
}

function isLeaveLike(record) {
  return ["paid", "child", "summer", "compensatory", "special"].includes(record.type);
}

function isFullDayRecord(record) {
  return isLeaveLike(record) && record.method === "full";
}

function hasTimeOverlap(a, b) {
  return Math.max(toMinutes(a.start), toMinutes(b.start)) < Math.min(toMinutes(a.end), toMinutes(b.end));
}

function splitDisplayName(name = "") {
  const parts = String(name).trim().split(/\s+/);
  return {
    lastName: parts[0] || "",
    firstName: parts.slice(1).join(" ") || "",
  };
}

function personName(person) {
  if (!person) return "";
  const lastName = person.lastName || "";
  const firstName = person.firstName || "";

  if (lastName || firstName) {
    return `${lastName} ${firstName}`.trim();
  }

  return person.name || "";
}

function normalizeStaffMember(member) {
  const split = splitDisplayName(member.name);
  const lastName = member.lastName ?? split.lastName;
  const firstName = member.firstName ?? split.firstName;
  return {
    ...member,
    lastName,
    firstName,
    displayNameMode: member.displayNameMode === "first" ? "first" : "last",
    name: `${lastName || ""} ${firstName || ""}`.trim() || member.name || "",
  };
}

function migrateSampleStaffName(member) {
  const normalized = normalizeStaffMember(member);
  const oldName = OLD_SAMPLE_STAFF_NAME_BY_ID[normalized.id];
  const nextName = SAMPLE_STAFF_NAME_BY_ID[normalized.id];
  if (!oldName || !nextName) return normalized;

  const isOldSampleName = normalized.lastName === oldName.lastName && normalized.firstName === oldName.firstName;
  if (!isOldSampleName) return normalized;

  return normalizeStaffMember({
    ...normalized,
    lastName: nextName.lastName,
    firstName: nextName.firstName,
    name: `${nextName.lastName} ${nextName.firstName}`,
  });
}

function sortStaff(list) {
  const jobOrder = { PT: 1, OT: 2 };
  return [...list].sort((a, b) => {
    const jobCompare = (jobOrder[a.job] || 99) - (jobOrder[b.job] || 99);
    if (jobCompare !== 0) return jobCompare;
    return personName(a).localeCompare(personName(b), "ja");
  });
}

function displayDate(value) {
  return value ? String(value).replaceAll("-", "/") : "";
}

function modulo(value, length) {
  return ((value % length) + length) % length;
}

function isYearEndNewYearVolunteerSaturday(dateStr) {
  if (!dateStr) return false;
  const date = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(date.getTime()) || date.getDay() !== 6) return false;

  const month = date.getMonth() + 1;
  const day = date.getDate();
  return (month === 12 && day >= 29 && day <= 31)
    || (month === 1 && day >= 1 && day <= 3);
}

function saturdayCountBetween(startDateStr, targetDateStr) {
  if (!startDateStr || !targetDateStr) return 0;
  const start = new Date(`${startDateStr}T00:00:00`);
  const target = new Date(`${targetDateStr}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(target.getTime())) return 0;

  const step = target >= start ? 1 : -1;
  let count = 0;
  for (let d = new Date(start); step > 0 ? d < target : d > target; d = addDateDays(d, 7 * step)) {
    if (!isYearEndNewYearVolunteerSaturday(toDateKey(d))) count += step;
  }
  return count;
}

function JapaneseDateInput({ value, onChange, allowClear = false, placeholder = "YYYY/MM/DD" }) {
  const baseDate = value ? new Date(`${value}T00:00:00`) : new Date();
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(baseDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(baseDate.getMonth() + 1);

  useEffect(() => {
    if (!value) return;
    const d = new Date(`${value}T00:00:00`);
    if (Number.isNaN(d.getTime())) return;
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth() + 1);
  }, [value]);

  const firstDay = new Date(viewYear, viewMonth - 1, 1).getDay();
  const days = monthDays(viewYear, viewMonth);
  const cells = [
    ...Array.from({ length: firstDay }, () => null),
    ...Array.from({ length: days }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  function moveMonth(diff) {
    let nextYear = viewYear;
    let nextMonth = viewMonth + diff;
    if (nextMonth < 1) {
      nextYear -= 1;
      nextMonth = 12;
    }
    if (nextMonth > 12) {
      nextYear += 1;
      nextMonth = 1;
    }
    setViewYear(nextYear);
    setViewMonth(nextMonth);
  }

  function choose(day) {
    const next = dateKey(viewYear, viewMonth, day);
    onChange(next);
    setOpen(false);
  }

  function chooseToday() {
    const next = todayKey();
    const d = new Date(`${next}T00:00:00`);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth() + 1);
    onChange(next);
    setOpen(false);
  }

  return (
    <div className="jpDateInputWrap">
      <button type="button" className="jpDateInput" onClick={() => setOpen((prev) => !prev)}>
        <span className={value ? "" : "jpDatePlaceholder"}>{value ? displayDate(value) : placeholder}</span>
        <span aria-hidden="true">📅</span>
      </button>

      {open && (
        <div className="jpCalendarPopup" onClick={(e) => e.stopPropagation()}>
          <div className="jpCalendarHeader">
            <button type="button" onClick={() => moveMonth(-1)}>前月</button>
            <strong>{viewYear}年{viewMonth}月</strong>
            <button type="button" onClick={() => moveMonth(1)}>翌月</button>
          </div>

          <div className="jpWeekGrid">
            {WEEKDAYS.map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>

          <div className="jpDateGrid">
            {cells.map((day, index) => {
              if (!day) return <span key={`empty-${index}`} className="jpDateEmpty" />;
              const key = dateKey(viewYear, viewMonth, day);
              const weekday = new Date(`${key}T00:00:00`).getDay();
              return (
                <button
                  key={key}
                  type="button"
                  className={["jpDateCell", value === key ? "selected" : "", weekday === 0 ? "sun" : "", weekday === 6 ? "sat" : ""].join(" ")}
                  onClick={() => choose(day)}
                >
                  {day}
                </button>
              );
            })}
          </div>

          <div className="jpCalendarFooter">
            {allowClear && <button type="button" onClick={() => { onChange(""); setOpen(false); }}>クリア</button>}
            <button type="button" onClick={chooseToday}>今日</button>
          </div>
        </div>
      )}
    </div>
  );
}


const TUTORIAL_GUIDES = {
  leave: {
    title: "休暇・勤務を登録する",
    description: "時間休を15:15〜17:15で登録する流れを練習します。",
    steps: [
      { target: "leave-calendar-day", event: "leave-date", text: "登録したい日付をカレンダーからタップしてください。" },
      { target: "leave-open-form", event: "leave-open-form", text: "「休暇・特別勤務・個別予定登録」をタップしてください。" },
      { target: "leave-type", event: "leave-paid", text: "種別で「有休」を選んでください。" },
      { target: "leave-method", event: "leave-time", text: "取得方法で「時間休」を選んでください。" },
      { target: "leave-start-hour", event: "leave-start-hour-15", text: "開始時刻を15時にしてください。" },
      { target: "leave-start-minute", event: "leave-start-minute-15", text: "開始分を15分にしてください。" },
      { target: "leave-end-hour", event: "leave-end-hour-17", text: "終了時刻を17時にしてください。" },
      { target: "leave-end-minute", event: "leave-end-minute-15", text: "終了分を15分にしてください。これで15:15〜17:15です。" },
      { target: "leave-submit", event: "leave-submit", text: "「登録する」をタップしてください。チュートリアル中は本番には保存されません。" },
    ],
  },
  compensatory: {
    title: "代休を登録する",
    description: "代休の取得日と、どの出勤日の代休かを確認して登録する流れを練習します。",
    steps: [
      { target: "leave-calendar-day", event: "compensatory-date", text: "代休を取得する日をカレンダーからタップしてください。" },
      { target: "leave-open-form", event: "compensatory-open-form", text: "「休暇・特別勤務・個別予定登録」をタップしてください。" },
      { target: "leave-type", event: "compensatory-type", text: "種別で「代休」を選んでください。" },
      { target: "compensatory-source-calendar", event: "compensatory-source-confirm", text: "「対象となる出勤日」のカレンダーをタップし、自動選択された未消化の出勤日を確認して、その日付を選択してください。" },
      { target: "leave-submit", event: "compensatory-submit", text: "表示が「代休(○/○出勤分)」になっていることを確認して、「登録する」をタップしてください。チュートリアル中は本番には保存されません。" },
    ],
  },
  saturday: {
    title: "土曜出勤を交換する",
    description: "土曜日を選び、別日の勤務者と交換する操作を練習します。",
    steps: [
      { target: "saturday-calendar-day", event: "saturday-date", text: "交換したい土曜日をタップしてください。" },
      { target: "saturday-change-button", event: "saturday-change-open", text: "「出勤日を変更」をタップしてください。" },
      { target: "saturday-current-staff", event: "saturday-current-staff", text: "左側の現在の出勤者から、変更する職員を1名タップしてください。" },
      { target: "saturday-candidate-date", event: "saturday-candidate-date", text: "交換候補となる別の土曜日をタップしてください。" },
      { target: "saturday-candidate-staff", event: "saturday-candidate-staff", text: "交換相手をタップしてください。" },
      { target: "saturday-save", event: "saturday-save", text: "交換後の内容を確認して保存してください。チュートリアル中は本番には保存されません。" },
    ],
  },

};

function TutorialGuidePanel({ guide, stepIndex, onMenu, onExit }) {
  const step = guide?.steps?.[stepIndex];
  const [placement, setPlacement] = useState("bottom");

  useEffect(() => {
    document.querySelectorAll(".tutorialTargetPulse").forEach((node) => node.classList.remove("tutorialTargetPulse"));
    if (!step?.target) return undefined;

    const timer = window.setTimeout(() => {
      const candidates = Array.from(document.querySelectorAll(`[data-tutorial-target="${step.target}"]`));
      const target = candidates.find((node) => {
        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      });
      if (!target) return;

      const rect = target.getBoundingClientRect();
      // 対象が画面上側ならガイドは下、下側なら上へ逃がす。
      setPlacement(rect.top < window.innerHeight / 2 ? "bottom" : "top");
      target.classList.add("tutorialTargetPulse");
      if (!step.noAutoScroll) {
        target.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
      }
    }, 120);

    return () => {
      window.clearTimeout(timer);
      document.querySelectorAll(".tutorialTargetPulse").forEach((node) => node.classList.remove("tutorialTargetPulse"));
    };
  }, [step?.target, stepIndex, guide?.title]);

  if (!guide || !step) return null;

  return (
    <aside className={`tutorialGuidePanel ${placement} ${""}`} role="status" aria-live="polite">
      <div className="tutorialGuideTop">
        <div>
          <strong>{guide.title}</strong>
          <small>ステップ {stepIndex + 1} / {guide.steps.length}</small>
        </div>
        <button type="button" onClick={onMenu}>メニュー</button>
      </div>
      <p>{step.text}</p>
      <div className="tutorialGuideProgress" aria-hidden="true">
        <span style={{ width: `${((stepIndex + 1) / guide.steps.length) * 100}%` }} />
      </div>
      <button className="tutorialExitInline" type="button" onClick={onExit}>チュートリアルを終了</button>
    </aside>
  );
}

export default function App() {
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [adminMenuOpen, setAdminMenuOpen] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState(null);
const [authLoading, setAuthLoading] = useState(true);
const [loginStaff, setLoginStaff] = useState(null);
const [staffAuthLoading, setStaffAuthLoading] = useState(false);
const [staffAuthError, setStaffAuthError] = useState("");
const [linkForm, setLinkForm] = useState({
  job: "PT",
  staffNumber: "",
});

const [pwaInfo, setPwaInfo] = useState({
  needRefresh: false,
  version: typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "0.0.0",
});
const [pwaChecking, setPwaChecking] = useState(false);

const [tutorialMode, setTutorialMode] = useState(false);
const [showTutorialCenter, setShowTutorialCenter] = useState(false);
const [tutorialGuideId, setTutorialGuideId] = useState(null);
const [tutorialStep, setTutorialStep] = useState(0);
const [tutorialCompleted, setTutorialCompleted] = useState(() => new Set());
const tutorialModeRef = useRef(false);

useEffect(() => {
  tutorialModeRef.current = tutorialMode;
}, [tutorialMode]);

function startTutorial(guideId = null) {
  tutorialModeRef.current = true;
  setTutorialMode(true);
  setTutorialGuideId(guideId);
  setTutorialStep(0);
  setShowTutorialCenter(!guideId);
  setSelectedDate(null);
  setDateModalMode("schedule");
}

function openTutorialMenu() {
  setShowTutorialCenter(true);
}

function chooseTutorialGuide(guideId) {
  tutorialModeRef.current = true;
  setTutorialMode(true);
  setTutorialGuideId(guideId);
  setTutorialStep(0);
  setShowTutorialCenter(false);
  setSelectedDate(null);
  setDateModalMode("schedule");
  setView("calendar");
}

function onTutorialEvent(eventName) {
  if (!tutorialMode || !tutorialGuideId) return;
  const guide = TUTORIAL_GUIDES[tutorialGuideId];
  const currentStep = guide?.steps?.[tutorialStep];
  if (!currentStep || currentStep.event !== eventName) return;

  if (tutorialStep >= guide.steps.length - 1) {
    setTutorialCompleted((prev) => new Set([...prev, tutorialGuideId]));
    setTutorialGuideId(null);
    setTutorialStep(0);
    setShowTutorialCenter(true);
    return;
  }

  setTutorialStep((prev) => prev + 1);
}

function exitTutorial() {
  const ok = window.confirm(
    "チュートリアルを終了します。\\n\\nチュートリアル中に行った変更はすべて破棄し、本番の最新データを読み直します。"
  );
  if (!ok) return;
  window.location.reload();
}


useEffect(() => subscribePwaUpdate(setPwaInfo), []);

async function handlePwaUpdateCheck() {
  setPwaChecking(true);
  const ok = await checkForPwaUpdate();
  setPwaChecking(false);

  if (!ok) {
    alert("更新確認に失敗しました。通信状況を確認してください。");
    return;
  }

  if (!pwaInfo.needRefresh) {
    alert("現在のアプリは最新版です。");
  }
}

async function handlePwaApplyUpdate() {
  await applyPwaUpdate();
}

async function handlePwaCacheClear() {
  if (!window.confirm("アプリのキャッシュを削除して再読み込みしますか？\n入力中の内容は失われる場合があります。")) {
    return;
  }
  await clearPwaCacheAndReload();
}

useEffect(() => {
  const unsubscribe = onAuthStateChanged(auth, (user) => {
    setFirebaseUser(user);
    setAuthLoading(false);
  });

  return () => unsubscribe();
}, []);

useEffect(() => {
  if (!firebaseUser) {
    setLoginStaff(null);
    setStaffAuthError("");
    setStaffAuthLoading(false);
    return;
  }

  let cancelled = false;

  async function loadLoginStaff() {
    setStaffAuthLoading(true);
    setStaffAuthError("");

    try {
      const uid = firebaseUser.uid;
      const staffByUidRef = doc(db, "staffByUid", uid);
      const staffByUidSnapshot = await getDoc(staffByUidRef);

      let staffDoc = null;
      let staffData = null;

      // 1. まず staffByUid/{uid} から正規ルートで職員を特定する。
      if (staffByUidSnapshot.exists()) {
        const linkData = staffByUidSnapshot.data();
        const linkedStaffId = String(linkData.staffId || "").trim();

        if (linkedStaffId) {
          const linkedStaffSnapshot = await getDoc(doc(db, "staff", linkedStaffId));

          if (linkedStaffSnapshot.exists()) {
            staffDoc = linkedStaffSnapshot;
            staffData = linkedStaffSnapshot.data();
          }
        }
      }

      // 2. staffByUid が無い・壊れている場合は、旧方式の staff.uid から探して自動修復する。
      if (!staffDoc) {
        const uidSnapshot = await getDocs(
          query(collection(db, "staff"), where("uid", "==", uid), limit(1))
        );

        if (!uidSnapshot.empty) {
          staffDoc = uidSnapshot.docs[0];
          staffData = staffDoc.data();

          await setDoc(
            staffByUidRef,
            {
              staffId: staffDoc.id,
              uid,
              job: staffData.job || "PT",
              role: staffData.role || "staff",
              active: staffData.active !== false,
              repairedAt: serverTimestamp(),
            },
            { merge: true }
          );
        }
      }

      // 3. どちらにも存在しなければ初回連携画面へ。
      if (!staffDoc || !staffData) {
        if (!cancelled) setLoginStaff(null);
        return;
      }

      if (staffData.active === false) {
        if (!cancelled) {
          setLoginStaff(null);
          setStaffAuthError("この職員アカウントは無効です。");
        }
        return;
      }

      // 4. staffByUid の内容を常に正しい状態へ同期する。
      await setDoc(
        staffByUidRef,
        {
          staffId: staffDoc.id,
          uid,
          job: staffData.job || "PT",
          role: staffData.role || "staff",
          active: true,
          syncedAt: serverTimestamp(),
        },
        { merge: true }
      );

      if (!cancelled) {
        setLoginStaff({
          id: staffDoc.id,
          ...staffData,
          uid,
        });
      }
    } catch (error) {
      const code = error?.code || "unknown";
      const message = error?.message || "unknown";

      console.error("Staff authentication bootstrap failed", { code, message, error });

      if (!cancelled) {
        setLoginStaff(null);
        setStaffAuthError(
          `職員情報の確認に失敗しました。code: ${code} / message: ${message}`
        );
      }
    } finally {
      if (!cancelled) setStaffAuthLoading(false);
    }
  }

  loadLoginStaff();

  return () => {
    cancelled = true;
  };
}, [firebaseUser]);

async function handleGoogleLogin() {
  try {
    await signInWithPopup(auth, provider);
  } catch (error) {
    console.error("Google login failed", error);
    alert("Googleログインに失敗しました。");
  }
}

async function handleLogout() {
  try {
    await signOut(auth);
  } catch (error) {
    console.error("Logout failed", error);
    alert("ログアウトに失敗しました。");
  }
}
async function handleStaffLink() {
  if (!firebaseUser) return;

  const staffNumber = String(linkForm.staffNumber || "").trim();
  const selectedJob = String(linkForm.job || "PT").trim();

  if (!staffNumber) {
    alert("職員番号を入力してください。");
    return;
  }

  setStaffAuthLoading(true);
  setStaffAuthError("");

  try {
    const uid = firebaseUser.uid;
    const staffRef = collection(db, "staff");

    let staffSnapshot = await getDocs(
      query(
        staffRef,
        where("job", "==", selectedJob),
        where("staffNumber", "==", staffNumber),
        limit(1)
      )
    );

    let staffDoc = staffSnapshot.empty ? null : staffSnapshot.docs[0];

    if (!staffDoc) {
      const sameJobSnapshot = await getDocs(
        query(staffRef, where("job", "==", selectedJob))
      );

      staffDoc = sameJobSnapshot.docs.find((candidateDoc) => {
        const candidate = candidateDoc.data();
        return String(candidate.staffNumber ?? "").trim() === staffNumber;
      }) || null;
    }

    if (!staffDoc) {
      setStaffAuthError(
        `職種と職員番号が一致する職員が見つかりません。入力: ${selectedJob} / ${staffNumber}`
      );
      return;
    }

    const staffData = staffDoc.data();

    if (staffData.active === false) {
      setStaffAuthError("この職員アカウントは無効です。");
      return;
    }

    if (staffData.uid && staffData.uid !== uid) {
      setStaffAuthError("この職員番号はすでに別のGoogleアカウントと連携されています。");
      return;
    }

    // staff と staffByUid を同じ連携処理内で必ず揃える。
    await updateDoc(doc(db, "staff", staffDoc.id), {
      uid,
      linkedAt: serverTimestamp(),
    });

    await setDoc(
      doc(db, "staffByUid", uid),
      {
        staffId: staffDoc.id,
        uid,
        job: staffData.job || selectedJob,
        role: staffData.role || "staff",
        active: true,
        linkedAt: serverTimestamp(),
      },
      { merge: true }
    );

    setLoginStaff({
      id: staffDoc.id,
      ...staffData,
      uid,
    });
  } catch (error) {
    const code = error?.code || "unknown";
    const message = error?.message || "unknown";

    console.error("Staff link failed", { code, message, error });
    setStaffAuthError(
      `職員連携に失敗しました。code: ${code} / message: ${message}`
    );
  } finally {
    setStaffAuthLoading(false);
  }
}

  const today = new Date();

  // Firestoreのスタッフ読み込み完了前にデモスタッフを表示しない。
  // iPhoneのPWAではリロードしにくいため、初期値は必ず空にして読み込み完了まで待機する。
  const [staff, setStaff] = useState([]);
  const [staffLoaded, setStaffLoaded] = useState(false);

useEffect(() => {
  let cancelled = false;

  async function loadStaffFromFirestore() {
    setStaffLoaded(false);

    try {
      const staffSnapshot = await getDocs(collection(db, "staff"));
      if (cancelled) return;

      const firestoreStaff = staffSnapshot.docs
        .map((staffDoc) => {
          const data = staffDoc.data();
          return normalizeStaffMember({
            id: staffDoc.id,
            lastName: data.lastName || "",
            firstName: data.firstName || "",
            name: `${data.lastName || ""} ${data.firstName || ""}`.trim(),
            job: data.job || "PT",
            role: data.role || "staff",
            active: data.active !== false,
            visible: data.visible !== false,
            canCancerRehab: Boolean(data.canCancerRehab),
            canCommunityCare: Boolean(data.canCommunityCare),
            displayNameMode: data.displayNameMode === "first" ? "first" : "last",
            order: Number(data.order || 999),
            staffNumber: data.staffNumber || "",
            uid: data.uid || "",
            email: data.email || "",
          });
        })
        .filter((person) => person.active)
        .sort((a, b) => (a.order || 999) - (b.order || 999));

      // デモスタッフへのフォールバックはしない。Firestoreの実データだけを表示する。
      setStaff(firestoreStaff);
    } catch (error) {
      console.error("Staff list load failed", error);
      if (!cancelled) setStaff([]);
    } finally {
      if (!cancelled) setStaffLoaded(true);
    }
  }

  loadStaffFromFirestore();

  return () => {
    cancelled = true;
  };
}, []);

const [records, setRecords] = useState([]);

useEffect(() => {
  const targetFiscalYear = fiscalYear(todayKey());
  const startDate = `${targetFiscalYear}-04-01`;
  const endDate = `${targetFiscalYear + 1}-04-01`;

  const recordsQuery = query(
    collection(db, "leaveRecords"),
    where("date", ">=", startDate),
    where("date", "<", endDate)
  );

  const unsubscribe = onSnapshot(recordsQuery, (snapshot) => {
    if (tutorialModeRef.current) return;
    const nextRecords = snapshot.docs
      .map((recordDoc) => ({
        id: recordDoc.id,
        ...recordDoc.data(),
      }))
      .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));

    setRecords(nextRecords);
  });

  return () => unsubscribe();
}, []);

const [announcements, setAnnouncements] = useState([]);

useEffect(() => {
  const unsubscribe = onSnapshot(collection(db, "announcements"), (snapshot) => {
    if (tutorialModeRef.current) return;
    const nextAnnouncements = snapshot.docs
      .map((announcementDoc) => ({
        id: announcementDoc.id,
        ...announcementDoc.data(),
      }))
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));

    setAnnouncements(nextAnnouncements);
  });

  return () => unsubscribe();
}, []);

const [saturdayGroups, setSaturdayGroups] = useState(() => defaultSaturdayGroups(staff));
const [saturdayOverrides, setSaturdayOverrides] = useState([]);
const [saturdayRotation, setSaturdayRotation] = useState({
  startDate: "2026-04-04",
  startGroup: "A",
});
const [compensatorySettings, setCompensatorySettings] = useState(() => ({
  startDate: `${fiscalYear(todayKey())}-04-01`,
}));

  const [holidays, setHolidays] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("japaneseHolidaysV1") || "{}");
      return { ...FALLBACK_HOLIDAYS, ...saved };
    } catch {
      return FALLBACK_HOLIDAYS;
    }
  });

  const [loginId, setLoginId] = useState("");
  const [view, setView] = useState("calendar");
  const [displayScope, setDisplayScope] = useState("all");
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [selectedDate, setSelectedDate] = useState(null);
  const [showStaffEdit, setShowStaffEdit] = useState(false);
  const [showLeaveSettings, setShowLeaveSettings] = useState(false);
  const [showAnnouncementEdit, setShowAnnouncementEdit] = useState(false);
  const [showSaturdayEdit, setShowSaturdayEdit] = useState(false);
  const [showLeaveForm, setShowLeaveForm] = useState(false);
  const [dateModalMode, setDateModalMode] = useState("schedule");
  const [recordSubmitting, setRecordSubmitting] = useState(false);
  const [editingRecordId, setEditingRecordId] = useState(null);
  const [outpatientDraft, setOutpatientDraft] = useState(0);
  const [showSaturdayGroupSettings, setShowSaturdayGroupSettings] = useState(false);
  const [swapTargetStaffId, setSwapTargetStaffId] = useState(null);
  const [swapCandidateDate, setSwapCandidateDate] = useState(null);
  const [swapCandidateStaffIds, setSwapCandidateStaffIds] = useState([]);
  const [showSaturdaySwapHelp, setShowSaturdaySwapHelp] = useState(false);
  const [showSaturdayUndoDialog, setShowSaturdayUndoDialog] = useState(false);
  const [saturdayUndoTargetDate, setSaturdayUndoTargetDate] = useState("");
  const [saturdayUndoSelectedDates, setSaturdayUndoSelectedDates] = useState([]);
  const [showSaturdayRestoreDialog, setShowSaturdayRestoreDialog] = useState(false);
  const [saturdayRestoreTargetDate, setSaturdayRestoreTargetDate] = useState("");
  const [saturdayRestoreSubmitting, setSaturdayRestoreSubmitting] = useState(false);

  const [form, setForm] = useState({
    staffId: staff[0]?.id || "s1",
    date: `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`,
    type: "paid",
    method: "full",
    start: "08:30",
    end: "17:15",
    deductBreak: false,
    compensatorySourceDate: "",
    holidayCompensation: "compensatory",
    otherCompensation: "plan",
    note: "",
  });

  const [editingAnnouncementId, setEditingAnnouncementId] = useState(null);
  const [announcementForm, setAnnouncementForm] = useState({
    title: "",
    message: "",
    priority: "normal",
    scheduleType: "single",
    date: todayKey(),
    time: "",
    weekday: String(today.getDay()),
    nth: "1",
    endDate: "",
  });

  const [saturdayForm, setSaturdayForm] = useState({
    date: todayKey(),
    staffIds: [],
    note: "",
  });

  useEffect(() => {
    // Firestoreから読み込めた実スタッフだけを保存する。初期空配列やデモスタッフは保存しない。
    if (!staffLoaded || staff.length === 0 || tutorialModeRef.current) return;
    localStorage.setItem("leaveStaffV4", JSON.stringify(staff));
  }, [staff, staffLoaded]);

useEffect(() => {
  const unsubscribe = onSnapshot(doc(db, "settings", "saturdayDuty"), (snapshot) => {
    if (tutorialModeRef.current) return;
    if (!snapshot.exists()) return;

    const data = snapshot.data();

    if (data.groups) {
      setSaturdayGroups(data.groups);
    }

    if (Array.isArray(data.overrides)) {
      setSaturdayOverrides(data.overrides);
    }

    if (data.rotation) {
      setSaturdayRotation({
        startDate: data.rotation.startDate || "2026-04-04",
        startGroup: data.rotation.startGroup || "A",
        
      });
    }
  });

  return () => unsubscribe();
}, []);

useEffect(() => {
  const unsubscribe = onSnapshot(doc(db, "settings", "compensatoryLeave"), (snapshot) => {
    if (tutorialModeRef.current) return;
    if (!snapshot.exists()) return;
    const data = snapshot.data();
    if (data.startDate) {
      setCompensatorySettings({ startDate: data.startDate });
    }
  });
  return () => unsubscribe();
}, []);

  useEffect(() => {
    let active = true;

    async function loadHolidays() {
      try {
        const fetched = await fetchJapaneseHolidays();
        if (!active || Object.keys(fetched).length === 0) return;
        const merged = { ...FALLBACK_HOLIDAYS, ...fetched };
        setHolidays(merged);
        localStorage.setItem("japaneseHolidaysV1", JSON.stringify(merged));
      } catch (error) {
        console.warn("祝日CSVの取得に失敗しました。予備データを使用します。", error);
      }
    }

    loadHolidays();
    return () => {
      active = false;
    };
  }, []);

  const activeStaff = useMemo(() => sortStaff(staff), [staff]);
  const saturdayEligibleStaff = useMemo(
    () => activeStaff.filter((person) => Boolean(person.uid)),
    [activeStaff]
  );
  const saturdayEligibleIdSet = useMemo(
    () => new Set(saturdayEligibleStaff.map((person) => person.id)),
    [saturdayEligibleStaff]
  );

  function pruneSaturdayStaffIds(staffIds) {
    return Array.from(new Set(staffIds || [])).filter((id) => saturdayEligibleIdSet.has(id));
  }
const loginUser = loginStaff
  ? {
      id: loginStaff.id,
      lastName: loginStaff.lastName || "",
      firstName: loginStaff.firstName || "",
      name: `${loginStaff.lastName || ""} ${loginStaff.firstName || ""}`.trim(),
      job: loginStaff.job || "PT",
      role: loginStaff.role || "staff",
    }
  : staff.find((s) => s.id === loginId) || staff[0];
  const isAdmin = loginUser?.role === "admin";
  const currentFy = fiscalYear(`${year}-${pad(month)}-01`);
  const todayAnnouncements = useMemo(() => expandAnnouncements(announcements, todayKey()), [announcements]);


  useEffect(() => {
  if (!loginUser?.id) return;

  setLoginId(loginUser.id);
  setForm((prev) => ({
    ...prev,
    staffId: loginUser.id,
  }));
}, [loginUser?.id]);

  const enrichedRecords = useMemo(() => {
    const sorted = [...records].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
    const summerCount = {};

    return sorted.map((r) => {
      if (r.type !== "summer") return r;

      const key = `${r.staffId}-${fiscalYear(r.date)}`;
      summerCount[key] = (summerCount[key] || 0) + 1;
      return { ...r, summerNumber: summerCount[key] };
    });
  }, [records]);

  const days = monthDays(year, month);
  const firstDay = new Date(year, month - 1, 1).getDay();
  const calendarCells = [
    ...Array.from({ length: firstDay }, () => null),
    ...Array.from({ length: days }, (_, i) => i + 1),
  ];

  while (calendarCells.length % 7 !== 0) {
    calendarCells.push(null);
  }

  function recordsForDate(date) {
    return enrichedRecords
      .filter((r) => r.date === date && r.type !== "outpatientPlan")
      .map((r) => ({ ...r, staff: staff.find((s) => s.id === r.staffId) }))
      .filter((r) => r.staff);
  }

  function scopedRecordsForDate(date) {
    const list = recordsForDate(date);
    if (displayScope === "mine") return list.filter((r) => r.staffId === loginId);
    return list;
  }

  function leaveRecordsForDate(date) {
    return scopedRecordsForDate(date).filter((r) => isLeaveLike(r));
  }

  useEffect(() => {
    setSaturdayForm((prev) => {
      const nextStaffIds = pruneSaturdayStaffIds(prev.staffIds);
      if (arraysEqualByValue(prev.staffIds || [], nextStaffIds)) return prev;
      return { ...prev, staffIds: nextStaffIds };
    });

    setSwapCandidateStaffIds((prev) => {
      const nextStaffIds = pruneSaturdayStaffIds(prev);
      return arraysEqualByValue(prev || [], nextStaffIds) ? prev : nextStaffIds;
    });
  }, [saturdayEligibleIdSet]);

  function saturdayNthForDate(date) {
    const d = new Date(`${date}T00:00:00`);
    if (d.getDay() !== 6) return null;
    return Math.floor((d.getDate() - 1) / 7) + 1;
  }

  function saturdayBaseGroupKeyForDate(date) {
    const d = new Date(`${date}T00:00:00`);
    if (d.getDay() !== 6) return null;

    const startGroupIndex = Math.max(0, SATURDAY_GROUP_KEYS.indexOf(saturdayRotation.startGroup || "A"));
    const offset = saturdayCountBetween(saturdayRotation.startDate, date);
    return SATURDAY_GROUP_KEYS[modulo(startGroupIndex + offset, SATURDAY_GROUP_KEYS.length)] || "A";
  }

  function saturdayOverrideForDate(date) {
    return saturdayOverrides.find((item) => {
      if (item.date !== date || item.disabled) return false;

      // 旧版の個別解除で作られた空の復元overrideは、
      // 基本グループを隠してカレンダーを空欄にするため無効扱いにする。
      if (
        item.restoredByUndo
        && (!Array.isArray(item.staffIds) || item.staffIds.length === 0)
      ) {
        return false;
      }

      return true;
    }) || null;
  }

  function saturdayScheduleForDate(date) {
    const volunteerDay = isYearEndNewYearVolunteerSaturday(date);
    const groupKey = volunteerDay ? null : saturdayBaseGroupKeyForDate(date);
    if (!volunteerDay && !groupKey) return null;

    const override = saturdayOverrideForDate(date);
    if (override) {
      return {
        date,
        groupKey,
        staffIds: pruneSaturdayStaffIds(override.staffIds),
        note: override.note || "",
        isOverride: true,
        isYearEndNewYearVolunteer: volunteerDay,
      };
    }

    return {
      date,
      groupKey,
      staffIds: volunteerDay ? [] : pruneSaturdayStaffIds(saturdayGroups[groupKey]),
      note: "",
      isOverride: false,
      isYearEndNewYearVolunteer: volunteerDay,
    };
  }

  function saturdayStaffForDate(date) {
    const schedule = saturdayScheduleForDate(date);
    if (!schedule) return [];
    const people = pruneSaturdayStaffIds(schedule.staffIds)
      .map((id) => staff.find((s) => s.id === id && Boolean(s.uid)))
      .filter(Boolean);
    if (displayScope === "mine") return people.filter((person) => person.id === loginId);
    return people;
  }

  function compensatoryUsageRecords(staffId, sourceDate) {
    if (!staffId || !sourceDate) return [];
    return records.filter((record) =>
      record.staffId === staffId
      && record.type === "compensatory"
      && record.compensatorySourceDate === sourceDate
    );
  }

  function compensatoryUsedMinutes(staffId, sourceDate, excludeRecordId = null) {
    return compensatoryUsageRecords(staffId, sourceDate)
      .filter((record) => record.id !== excludeRecordId)
      .reduce((sum, record) => sum + compensatoryRecordMinutes(record), 0);
  }

  function compensatorySourceMinutes(staffId, sourceDate) {
    if (!staffId || !sourceDate) return 0;

    // 通常の土曜出勤は従来どおり7時間45分を原資とする。
    const saturdayMinutes = (() => {
      const d = new Date(`${sourceDate}T00:00:00`);
      if (Number.isNaN(d.getTime()) || d.getDay() !== 6) return 0;
      const schedule = saturdayScheduleForDate(sourceDate);
      return (schedule?.staffIds || []).includes(staffId) ? COMPENSATORY_DAY_MINUTES : 0;
    })();

    // 休日出勤・その他予定で「代休消化」を選んだ記録は、
    // 登録した取得方法／時間をそのまま代休原資とする。
    const eventMinutes = records
      .filter((record) =>
        record.staffId === staffId
        && record.date === sourceDate
        && (
          (
            record.type === "holiday"
            // 旧休日出勤データは従来互換のため代休対象。
            && record.holidayCompensation !== "overtime"
          )
          || (
            record.type === "other"
            && record.otherCompensation === "compensatory"
          )
        )
      )
      .reduce((maxMinutes, record) => {
        const minutes = Math.max(0, Math.round(getHours(record) * 60));
        return Math.max(maxMinutes, minutes);
      }, 0);

    // 現行の代休管理は「出勤日」をキーにしているため、
    // 同一日に複数原資があっても二重加算せず、その日の最大原資を採用する。
    return Math.max(saturdayMinutes, eventMinutes);
  }

  function compensatoryRemainingMinutes(staffId, sourceDate, excludeRecordId = null) {
    return Math.max(
      0,
      compensatorySourceMinutes(staffId, sourceDate) - compensatoryUsedMinutes(staffId, sourceDate, excludeRecordId)
    );
  }

  // 編集中の代休は既に消化済みとして記録されているため、残時間の算定から除外する。
  function formCompensatoryRemainingMinutes(staffId, sourceDate) {
    return compensatoryRemainingMinutes(staffId, sourceDate, editingRecordId);
  }

  function compensatoryConsumedRecord(staffId, sourceDate) {
    const usage = compensatoryUsageRecords(staffId, sourceDate);
    if (usage.length === 0) return null;
    return compensatoryRemainingMinutes(staffId, sourceDate) <= 0 ? usage[usage.length - 1] : null;
  }

  function isCompensatorySourceDateForStaff(date, staffId) {
    if (!date || !staffId) return false;
    if (date < compensatorySettings.startDate) return false;

    const d = new Date(`${date}T00:00:00`);
    if (Number.isNaN(d.getTime())) return false;

    if (d.getDay() === 6) {
      const schedule = saturdayScheduleForDate(date);
      if ((schedule?.staffIds || []).includes(staffId)) return true;
    }

    return records.some((record) =>
      record.staffId === staffId
      && record.date === date
      && (
        (
          record.type === "holiday"
          // 既存データ（holidayCompensation未保存）は従来どおり代休対象として扱う。
          && record.holidayCompensation !== "overtime"
        )
        || (
          record.type === "other"
          && record.otherCompensation === "compensatory"
        )
      )
    );
  }

  function compensatorySourceCandidates(staffId, leaveDate = form.date) {
    if (!staffId) return [];
    const targetFy = fiscalYear(leaveDate || todayKey());
    const fyStart = `${targetFy}-04-01`;
    const fyEnd = `${targetFy + 1}-03-31`;
    const startDate = compensatorySettings.startDate > fyStart ? compensatorySettings.startDate : fyStart;
    const start = new Date(`${startDate}T00:00:00`);
    const end = new Date(`${fyEnd}T00:00:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return [];

    const dates = [];
    for (let d = new Date(start); d <= end; d = addDateDays(d, 1)) {
      const key = toDateKey(d);
      if (isCompensatorySourceDateForStaff(key, staffId)) dates.push(key);
    }

    return dates.sort(compareDateStr);
  }

  function unconsumedCompensatorySourceCandidates(staffId, leaveDate = form.date) {
    return compensatorySourceCandidates(staffId, leaveDate).filter(
      (date) => compensatoryRemainingMinutes(staffId, date) > 0
    );
  }

  function chooseCompensatorySourceDate(date) {
    if (!date) {
      setForm((prev) => ({ ...prev, compensatorySourceDate: "" }));
      return;
    }

    const staffId = isAdmin ? form.staffId : (loginUser?.id || form.staffId);
    const consumed = compensatoryConsumedRecord(staffId, date);
    if (consumed && formCompensatoryRemainingMinutes(staffId, date) <= 0) {
      alert(`この勤務日の代休は消化済みです。\n合計${formatMinutesJa(compensatorySourceMinutes(staffId, date))}を取得済みです。`);
      return;
    }

    if (!isCompensatorySourceDateForStaff(date, staffId)) {
      alert("この日は代休対象の出勤日として確認できません。土曜出勤・休日出勤・代休対象のその他予定の日を選択してください。");
      return;
    }

    setForm((prev) => ({ ...prev, compensatorySourceDate: date }));
    if (tutorialGuideId === "compensatory") {
      onTutorialEvent("compensatory-source-confirm");
    }
  }

  async function updateCompensatoryStartDate(startDate) {
    if (!isAdmin || !startDate) return;
    const fy = fiscalYear(todayKey());
    const minDate = `${fy}-04-01`;
    const maxDate = `${fy + 1}-03-31`;
    if (startDate < minDate || startDate > maxDate) {
      alert(`代休管理開始日は現在年度（${displayDate(minDate)}〜${displayDate(maxDate)}）の範囲で設定してください。`);
      return;
    }

    setCompensatorySettings({ startDate });
    if (tutorialModeRef.current) return;

    try {
      await setDoc(doc(db, "settings", "compensatoryLeave"), {
        startDate,
        updatedAt: Date.now(),
        updatedBy: loginUser?.id || "",
        updatedByName: loginUser ? personName(loginUser) : "",
      }, { merge: true });
    } catch (error) {
      console.error("Compensatory leave settings save failed", error);
      alert("代休管理開始日の保存に失敗しました。");
    }
  }

  function saturdayBaseStaffForDate(date) {
    if (isYearEndNewYearVolunteerSaturday(date)) return [];
    const groupKey = saturdayBaseGroupKeyForDate(date);
    if (!groupKey) return [];
    const people = pruneSaturdayStaffIds(saturdayGroups[groupKey])
      .map((id) => staff.find((s) => s.id === id && Boolean(s.uid)))
      .filter(Boolean);
    if (displayScope === "mine") return people.filter((person) => person.id === loginId);
    return people;
  }

  function saturdayDutyRowsForDate(date, job) {
    const schedule = saturdayScheduleForDate(date);
    if (!schedule) return [];

    const basePeople = saturdayBaseStaffForDate(date).filter((person) => person.job === job);
    const finalPeople = saturdayStaffForDate(date).filter((person) => person.job === job);

    if (!schedule.isOverride) {
      return finalPeople.map((person, index) => ({
        id: `${job}-${person.id}-${index}`,
        before: person,
        after: person,
        changed: false,
        removed: false,
        added: false,
      }));
    }

    const finalIds = new Set(finalPeople.map((person) => person.id));
    const baseIds = new Set(basePeople.map((person) => person.id));
    const unchanged = finalPeople.filter((person) => baseIds.has(person.id));
    const removed = basePeople.filter((person) => !finalIds.has(person.id));
    const added = finalPeople.filter((person) => !baseIds.has(person.id));
    const changeCount = Math.max(removed.length, added.length);

    const changedRows = Array.from({ length: changeCount }, (_, index) => {
      const before = removed[index] || null;
      const after = added[index] || null;
      return {
        id: `${job}-${before?.id || "none"}-${after?.id || "none"}-${index}`,
        before,
        after,
        changed: Boolean(before && after),
        removed: Boolean(before && !after),
        added: Boolean(!before && after),
      };
    });

    const unchangedRows = unchanged.map((person, index) => ({
      id: `${job}-${person.id}-unchanged-${index}`,
      before: person,
      after: person,
      changed: false,
      removed: false,
      added: false,
    }));

    return [...changedRows, ...unchangedRows].filter((row) => row.before || row.after);
  }

  function canShowSaturdayForDate(date) {
    const schedule = saturdayScheduleForDate(date);
    if (!schedule) return false;
    const staffIds = pruneSaturdayStaffIds(schedule.staffIds);
    if (displayScope === "mine") return staffIds.includes(loginId);
    return staffIds.length > 0;
  }

  useEffect(() => {
    if (form.type !== "compensatory") return;
    const staffId = isAdmin ? form.staffId : (loginUser?.id || form.staffId);
    if (!staffId) return;

    const available = unconsumedCompensatorySourceCandidates(staffId, form.date);
    const current = form.compensatorySourceDate;
    if (current && available.includes(current)) return;

    const next = available[0] || "";
    if (next !== current) {
      setForm((prev) => ({ ...prev, compensatorySourceDate: next }));
    }
  }, [form.type, form.staffId, form.date, records, saturdayGroups, saturdayOverrides, saturdayRotation, compensatorySettings.startDate, loginUser?.id, isAdmin]);

  function outpatientPlanRecordForDate(date, staffId = loginId) {
    return enrichedRecords.find((record) =>
      record.type === "outpatientPlan"
      && record.date === date
      && record.staffId === staffId
    ) || null;
  }

  function outpatientPlanCountForDate(date, staffId = loginId) {
    return Math.max(0, Number(outpatientPlanRecordForDate(date, staffId)?.count || 0));
  }

  function personalPlanCountForDate(date) {
    if (displayScope !== "mine" || !loginId) return 0;
    return enrichedRecords.filter((record) =>
      record.date === date
      && record.staffId === loginId
      && record.type === "other"
      && (record.otherCompensation || "plan") === "plan"
    ).length;
  }

  async function persistOutpatientPlan(date, count) {
    if (!date || !loginId || tutorialModeRef.current) return;
    const nextCount = Math.max(0, Math.floor(Number(count) || 0));
    const existing = outpatientPlanRecordForDate(date, loginId);
    const previousCount = Math.max(0, Number(existing?.count || 0));
    if (nextCount === previousCount) return;

    try {
      if (nextCount === 0) {
        if (existing?.id) await deleteDoc(doc(db, "leaveRecords", existing.id));
        return;
      }

      if (existing?.id) {
        await updateDoc(doc(db, "leaveRecords", existing.id), {
          count: nextCount,
          updatedAt: Date.now(),
        });
      } else {
        await addDoc(collection(db, "leaveRecords"), {
          staffId: loginId,
          date,
          type: "outpatientPlan",
          method: "count",
          count: nextCount,
          note: "",
          createdAt: Date.now(),
          createdBy: loginUser?.id || "",
          createdByName: loginUser ? personName(loginUser) : "",
        });
      }
    } catch (error) {
      console.error("Outpatient calendar save failed", error);
      alert("外来予定人数の保存に失敗しました。");
    }
  }

  function countByJob(date) {
    const list = scopedRecordsForDate(date).filter((record) =>
      isLeaveLike(record)
      || (record.type === "other" && ["compensatory", "overtime"].includes(record.otherCompensation))
    );

    // 同一人物が同じ日に複数の休暇を登録していても「1人」として数える。
    // 例：午前代休＋午後有休 → PT 1
    // 「その他予定」の「代休消化」「時間外消化」も、PT/OTの休暇人数に含める。
    // 「予定のみ」は勤務人数に影響させず、自分タブで「自予」として別表示する。
    const uniqueByStaff = Array.from(
      new Map(
        list
          .filter((record) => record?.staffId && record?.staff)
          .map((record) => [record.staffId, record])
      ).values()
    );

    return {
      PT: uniqueByStaff.filter((r) => r.staff.job === "PT").length,
      OT: uniqueByStaff.filter((r) => r.staff.job === "OT").length,
      total: uniqueByStaff.length,
    };
  }

  function holidayWorkCountByJob(date) {
    const list = scopedRecordsForDate(date).filter((r) => r.type === "holiday");
    return {
      PT: list.filter((r) => r.staff.job === "PT").length,
      OT: list.filter((r) => r.staff.job === "OT").length,
      total: list.length,
    };
  }

  function announcementsForDate(date) {
    return expandAnnouncements(announcements, date);
  }

  function validateRecord(nextRecord) {
    const sameDay = records.filter((r) => r.id !== editingRecordId && r.staffId === nextRecord.staffId && r.date === nextRecord.date);
    const exactDuplicate = sameDay.some((r) => {
      if (r.type !== nextRecord.type) return false;
      if ((r.method || "full") !== (nextRecord.method || "full")) return false;
      if (nextRecord.method === "time") {
        return r.start === nextRecord.start && r.end === nextRecord.end;
      }
      return true;
    });

    if (exactDuplicate) {
      return "同じ内容が既に登録されています。";
    }

    const nextIsFull = isFullDayRecord(nextRecord);
    const nextIsPlanOnly = nextRecord.type === "other" && (nextRecord.otherCompensation || "plan") === "plan";

    // 「その他予定 > 予定のみ」は勤務・休暇とは独立した個人予定。
    // 終日休暇や時間休が既に登録されている日にも追加できる。
    if (!nextIsPlanOnly && sameDay.some((r) => isFullDayRecord(r))) {
      return "この日は既に終日の休暇が登録されています。";
    }

    if (!nextIsPlanOnly && nextIsFull && sameDay.some((r) => isLeaveLike(r))) {
      return "同日に既に休暇があるため、終日の休暇は登録できません。";
    }

    if (["paid", "child", "compensatory", "holiday", "other"].includes(nextRecord.type) && nextRecord.method === "time") {
      const workStart = toMinutes("08:30");
      const workEnd = toMinutes("17:15");
      const startMinutes = toMinutes(nextRecord.start);
      const endMinutes = toMinutes(nextRecord.end);

      if (
        startMinutes < workStart ||
        startMinutes > workEnd ||
        endMinutes < workStart ||
        endMinutes > workEnd
      ) {
        if (nextRecord.type === "compensatory") {
          return "時間単位の代休は8:30〜17:15の範囲で入力してください。";
        }
        if (["holiday", "other"].includes(nextRecord.type)) {
          return "時間指定は8:30〜17:15の範囲で入力してください。";
        }
        return "時間休は8:30〜17:15の範囲で入力してください。";
      }

      if (endMinutes <= startMinutes) {
        return "終了時刻は開始時刻より後にしてください。";
      }

      const duplicated = sameDay
        .filter((r) => ["paid", "child", "compensatory"].includes(r.type) && r.method === "time")
        .some((r) => hasTimeOverlap(nextRecord, r));

      if (duplicated) {
        return "同じ日の時間休と時間が重複しています。";
      }
    }

    if (nextRecord.type === "other" && !String(nextRecord.note || "").trim()) {
      return "予定内容を入力してください";
    }

    if (nextRecord.type === "compensatory") {
      if (!nextRecord.compensatorySourceDate) {
        return "代休の対象となる出勤日を選択してください。";
      }

      const remaining = formCompensatoryRemainingMinutes(
        nextRecord.staffId,
        nextRecord.compensatorySourceDate
      );
      if (remaining <= 0) {
        return `この勤務日の代休は消化済みです。合計${formatMinutesJa(compensatorySourceMinutes(nextRecord.staffId, nextRecord.compensatorySourceDate))}を取得済みです。`;
      }

      const requestedMinutes = nextRecord.method === "time"
        ? Math.max(0, Math.round(getHours(nextRecord) * 60))
        : COMPENSATORY_DAY_MINUTES;
      if (requestedMinutes <= 0) {
        return "取得する代休時間を指定してください。";
      }
      if (requestedMinutes % 15 !== 0) {
        return "時間単位の代休は15分単位で指定してください。";
      }
      if (requestedMinutes > remaining) {
        return `この勤務日の代休は残り${formatMinutesJa(remaining)}です。残時間を超えて取得できません。`;
      }

      if (!isCompensatorySourceDateForStaff(nextRecord.compensatorySourceDate, nextRecord.staffId)) {
        return "選択した日は代休対象の出勤日として確認できません。";
      }
    }

    if (nextRecord.type === "summer") {
      const used = records.filter(
        (r) =>
          r.id !== editingRecordId &&
          r.staffId === nextRecord.staffId &&
          r.type === "summer" &&
          fiscalYear(r.date) === fiscalYear(nextRecord.date)
      ).length;

      if (used >= SUMMER_LIMIT) {
        return "夏季休暇は5日取得済みです。";
      }
    }

    return "";
  }

  async function addRecord() {
    if (recordSubmitting) return;
    setRecordSubmitting(true);

    const originalRecord = editingRecordId ? records.find((r) => r.id === editingRecordId) : null;
    if (editingRecordId && (!originalRecord || (!isAdmin && originalRecord.staffId !== loginUser?.id))) {
      alert("この予定を編集する権限がありません。");
      setRecordSubmitting(false);
      return;
    }
    let nextRecord = {
      ...form,
      note: String(form.note || "").trim(),
      id: originalRecord?.id || makeId(),
      createdAt: originalRecord?.createdAt || Date.now(),
    };

    const validStaffIds = new Set(activeStaff.map((person) => person.id));

if ((!isAdmin && !originalRecord) || !validStaffIds.has(nextRecord.staffId)) {
  nextRecord.staffId = loginUser?.id || activeStaff[0]?.id || "";
}

if (!nextRecord.staffId) {
  alert("職員を選択してください。");
  setRecordSubmitting(false);
  return;
}

    if (!["paid", "child", "holiday", "other", "compensatory"].includes(nextRecord.type)) {
      nextRecord.method = "full";
    }

    if (nextRecord.type === "holiday") {
      if (!["compensatory", "overtime"].includes(nextRecord.holidayCompensation)) {
        nextRecord.holidayCompensation = "compensatory";
      }
    } else {
      delete nextRecord.holidayCompensation;
    }

    if (nextRecord.type === "other") {
      if (!["plan", "compensatory", "overtime"].includes(nextRecord.otherCompensation)) {
        nextRecord.otherCompensation = "plan";
      }
    } else {
      delete nextRecord.otherCompensation;
    }

    if (nextRecord.type !== "compensatory") {
      delete nextRecord.compensatorySourceDate;
    }

    const error = validateRecord(nextRecord);

    if (error) {
      alert(error);
      setRecordSubmitting(false);
      return;
    }

    // 時間単位の取得で昼休憩と重なり、控除していない場合のみ確認する。
    // 確認後も元の入力値・保存計算は変更しない。
    const isTimeOff = nextRecord.method === "time" &&
      (["paid", "child", "compensatory"].includes(nextRecord.type) ||
        (nextRecord.type === "holiday" && ["compensatory", "overtime"].includes(nextRecord.holidayCompensation)) ||
        (nextRecord.type === "other" && ["compensatory", "overtime"].includes(nextRecord.otherCompensation)));
    const lunchOverlap = isTimeOff && nextRecord.start && nextRecord.end
      ? overlapMinutes(toMinutes(nextRecord.start), toMinutes(nextRecord.end), toMinutes("12:00"), toMinutes("13:00"))
      : 0;
    if (isTimeOff && lunchOverlap > 0 && !nextRecord.deductBreak) {
      const totalMinutes = Math.round(getHours(nextRecord) * 60);
      const action = originalRecord ? "変更を保存" : "登録";
      const accepted = window.confirm(
        `昼休憩の控除について\n\n` +
        `取得時間（${nextRecord.start}〜${nextRecord.end}）に昼休憩（12:00〜13:00）が含まれていますが、` +
        `「昼休憩を控除する」にチェックが入っていません。\n\n` +
        `休憩控除：なし\n` +
        `${action}される取得時間：${formatMinutesJa(totalMinutes)}\n` +
        `昼休憩の重複：${formatMinutesJa(lunchOverlap)}\n\n` +
        `このまま${action}すると、昼休憩も取得時間に含まれます。よろしいですか？\n\n` +
        `「キャンセル」で入力画面に戻れます。`
      );
      if (!accepted) {
        setRecordSubmitting(false);
        return;
      }
    }

if (tutorialModeRef.current) {
  const { id, ...recordData } = nextRecord;
  setRecords((prev) => [...prev.filter((r) => r.id !== editingRecordId), { id, ...recordData, createdBy: originalRecord?.createdBy || loginUser?.id || "", createdByName: originalRecord?.createdByName || (loginUser ? personName(loginUser) : "") }]
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || ""))));
  setSelectedDate(nextRecord.date);
  setDateModalMode("schedule");
  setEditingRecordId(null);
  setForm((prev) => ({ ...prev, note: "" }));
  setRecordSubmitting(false);
  onTutorialEvent(tutorialGuideId === "compensatory" ? "compensatory-submit" : "leave-submit");
  return;
}

try {
  const { id, ...recordData } = nextRecord;
  const savedData = {
    ...recordData,
    createdBy: originalRecord?.createdBy || loginUser?.id || "",
    createdByName: originalRecord?.createdByName || (loginUser ? personName(loginUser) : ""),
  };
  if (originalRecord) {
    await updateDoc(doc(db, "leaveRecords", originalRecord.id), savedData);
    // Firestore onSnapshot updates the local list; avoid duplicate optimistic insertion.
  } else {
    await addDoc(collection(db, "leaveRecords"), savedData);
    // The onSnapshot listener adds the new record to the list.
  }
} catch (error) {
  const code = error?.code || "unknown";
  const message = error?.message || "unknown";
  console.error("Leave record add failed", { code, message, error });
  alert(`休暇・特別勤務・個別予定登録に失敗しました。
code: ${code}
message: ${message}`);
  setRecordSubmitting(false);
  return;
}
setSelectedDate(nextRecord.date);
setDateModalMode("schedule");
setEditingRecordId(null);
setForm((prev) => ({ ...prev, note: "" }));
setRecordSubmitting(false);
}

  async function removeRecord(id, record) {
    if (!isAdmin && record.staffId !== loginId) {
      alert("自分の登録以外は削除できません。");
      return;
    }

    if (!confirm("削除しますか？")) return;

if (tutorialModeRef.current) {
  setRecords((prev) => prev.filter((item) => item.id !== id));
  return;
}

try {
  await deleteDoc(doc(db, "leaveRecords", id));
} catch (error) {
  console.error("Leave record delete failed", error);
  alert("休暇・勤務記録の削除に失敗しました。");
}
  }

  function countSaturdayDutiesForFiscalYear(staffId) {
    let count = 0;
    const start = new Date(`${currentFy}-04-01T00:00:00`);
    const end = new Date(`${currentFy + 1}-03-31T00:00:00`);

    for (let d = new Date(start); d <= end; d = addDateDays(d, 1)) {
      if (d.getDay() !== 6) continue;
      const schedule = saturdayScheduleForDate(toDateKey(d));
      if ((schedule?.staffIds || []).includes(staffId)) count += 1;
    }

    return count;
  }

  function summary(staffId) {
    const list = enrichedRecords.filter((r) => r.staffId === staffId && fiscalYear(r.date) === currentFy);
    const paidFull = list.filter((r) => r.type === "paid" && r.method === "full").length;
    const paidTime = list
      .filter((r) => r.type === "paid" && r.method !== "full")
      .reduce((sum, r) => sum + getHours(r), 0);

    const childFull = list.filter((r) => r.type === "child" && r.method === "full").length;
    const childTime = list
      .filter((r) => r.type === "child" && r.method !== "full")
      .reduce((sum, r) => sum + getHours(r), 0);

    return {
      paidFull,
      paidTime,
      childFull,
      childTime,
      summer: list.filter((r) => r.type === "summer").length,
      saturday: countSaturdayDutiesForFiscalYear(staffId) + list.filter((r) => r.type === "saturday").length,
      holiday: list.filter((r) => r.type === "holiday").length,
    };
  }

  function selectedRecords() {
    if (!selectedDate) return [];
    return scopedRecordsForDate(selectedDate);
  }

  function selectedRecordGroups() {
    const grouped = new Map();

    selectedRecords().forEach((record) => {
      const key = record.staffId || record.staff?.id || record.id;
      if (!grouped.has(key)) {
        grouped.set(key, {
          staffId: key,
          staff: record.staff,
          records: [],
        });
      }
      grouped.get(key).records.push(record);
    });

    return Array.from(grouped.values());
  }

  function selectedAnnouncements() {
    if (!selectedDate) return [];
    return announcementsForDate(selectedDate);
  }

  function toggleDate(date) {
    setSelectedDate((current) => (current === date ? null : date));
  }

  function openLeaveFormForDate(date) {
    setEditingRecordId(null);
    setSelectedDate(date);
    setOutpatientDraft(outpatientPlanCountForDate(date, loginId));
    setDateModalMode("schedule");
    setShowLeaveForm(false);
  }

  function openLeaveFormInDateModal() {
    if (!selectedDate) return;
    setEditingRecordId(null);
    setForm((prev) => ({
      ...prev,
      date: selectedDate,
      staffId: isAdmin ? (prev.staffId || loginUser?.id || activeStaff[0]?.id || "") : (loginUser?.id || ""),
    }));
    setDateModalMode("form");
  }

  function editRecord(record) {
    if (!isAdmin && record.staffId !== loginUser?.id) return;
    setEditingRecordId(record.id);
    setForm({
      staffId: record.staffId, date: record.date, type: record.type,
      method: record.method || "full", start: record.start || "08:30",
      end: record.end || "17:15", deductBreak: !!record.deductBreak,
      note: record.note || "", holidayCompensation: record.holidayCompensation || "compensatory",
      otherCompensation: record.otherCompensation || "plan",
      compensatorySourceDate: record.compensatorySourceDate || "",
    });
    setDateModalMode("form");
  }

  function closeDateModal() {
    setEditingRecordId(null);
    if (selectedDate && displayScope === "mine") {
      void persistOutpatientPlan(selectedDate, outpatientDraft);
    }
    setSelectedDate(null);
    setDateModalMode("schedule");
  }

  function addStaff() {
    setStaff((prev) => [
      ...prev,
      {
        id: makeId(),
        lastName: "新規",
        firstName: "職員",
        name: "新規 職員",
        job: "PT",
        role: "staff",
      },
    ]);
  }

  function updateStaff(id, key, value) {
    setStaff((prev) => prev.map((s) => (s.id === id ? normalizeStaffMember({ ...s, [key]: value }) : s)));
  }

  function updateStaffNamePart(staffObj, key, value) {
    const next = normalizeStaffMember({ ...staffObj, [key]: value });
    setStaff((prev) => prev.map((s) => (s.id === staffObj.id ? next : s)));
  }

  function deleteStaff(id) {
    if (staff.length <= 1) return;
    if (!confirm("この職員を削除しますか？登録データも削除されます。")) return;
    setStaff((prev) => prev.filter((s) => s.id !== id));
    setRecords((prev) => prev.filter((r) => r.staffId !== id));
    setSaturdayGroups((prev) => Object.fromEntries(
      Object.entries(prev).map(([key, ids]) => [key, ids.filter((staffId) => staffId !== id)])
    ));
    setSaturdayOverrides((prev) => prev.map((item) => ({ ...item, staffIds: (item.staffIds || []).filter((staffId) => staffId !== id) })));

    const fallbackId = staff.find((s) => s.id !== id)?.id || "";
    if (loginId === id) setLoginId(fallbackId);
    if (form.staffId === id) setForm((prev) => ({ ...prev, staffId: fallbackId }));
  }

  function editAnnouncement(item) {
    if (!isAdmin) return;
    setEditingAnnouncementId(item.id);
    setAnnouncementForm({
      title: item.title || "", message: item.message || "", priority: item.priority || "normal",
      scheduleType: item.scheduleType || "single", date: item.date || selectedDate || todayKey(),
      time: item.time || "", weekday: String(item.weekday ?? new Date().getDay()),
      nth: String(item.nth || "1"), endDate: item.endDate || "",
    });
    setShowAnnouncementEdit(true);
  }

  async function saveAnnouncement(e) {
    e.preventDefault();
    if (!isAdmin) return;

    const title = announcementForm.title.trim();
    if (!title) {
      alert("タイトルを入力してください。");
      return;
    }

    if (announcementForm.scheduleType === "single" && !announcementForm.date) {
      alert("単発予定の日付を入力してください。");
      return;
    }

    if (tutorialModeRef.current) {
      setAnnouncements((prev) => editingAnnouncementId ? prev.map((a) => a.id === editingAnnouncementId ? { ...a, ...announcementForm, title } : a) : [...prev, {
        id: makeId("tutorial-announcement"), title, message: announcementForm.message.trim(),
        priority: announcementForm.priority, scheduleType: announcementForm.scheduleType,
        date: announcementForm.date, time: announcementForm.time, weekday: announcementForm.weekday,
        nth: announcementForm.nth, endDate: announcementForm.endDate, createdAt: Date.now(),
        createdBy: loginUser?.id || "", createdByName: loginUser ? personName(loginUser) : "",
      }]);
      setEditingAnnouncementId(null);
      setShowAnnouncementEdit(false);
      return;
    }

    const announcementPayload = {
  title,
  message: announcementForm.message.trim(),
  priority: announcementForm.priority,
  scheduleType: announcementForm.scheduleType,
  date: announcementForm.date,
  time: announcementForm.time,
  weekday: announcementForm.weekday,
  nth: announcementForm.nth,
  endDate: announcementForm.endDate,
  createdAt: Date.now(),
  createdBy: loginUser?.id || "",
  createdByName: loginUser ? personName(loginUser) : "",
};
    if (editingAnnouncementId) {
      const { createdAt, createdBy, createdByName, ...updates } = announcementPayload;
      await updateDoc(doc(db, "announcements", editingAnnouncementId), updates);
    } else {
      await addDoc(collection(db, "announcements"), announcementPayload);
    }
    setEditingAnnouncementId(null);

    setAnnouncementForm({
      title: "",
      message: "",
      priority: "normal",
      scheduleType: "single",
      date: todayKey(),
      time: "",
      weekday: String(new Date().getDay()),
      nth: "1",
      endDate: "",
    });
    setShowAnnouncementEdit(false);
  }

async function deleteAnnouncement(id) {
  if (!isAdmin) return;
  if (!confirm("このお知らせを削除しますか？")) return;

  if (tutorialModeRef.current) {
    setAnnouncements((prev) => prev.filter((item) => item.id !== id));
    return;
  }

  try {
    await deleteDoc(doc(db, "announcements", id));
  } catch (error) {
    console.error("Announcement delete failed", error);
    alert("お知らせの削除に失敗しました。");
  }
}  
  function openSaturdayEdit(date = selectedDate || form.date || todayKey()) {
    const existing = saturdayScheduleForDate(date);
    setSwapTargetStaffId(null);
    setSwapCandidateDate(null);
    setSwapCandidateStaffIds([]);
    setSaturdayForm({
      date,
      staffIds: pruneSaturdayStaffIds(existing?.staffIds),
      note: existing?.note || "",
    });
    setShowSaturdayEdit(true);
  }

  function toggleSaturdayStaff(staffId) {
    if (!saturdayEligibleIdSet.has(staffId)) return;
    setSaturdayForm((prev) => {
      const currentIds = pruneSaturdayStaffIds(prev.staffIds);
      const exists = currentIds.includes(staffId);
      return {
        ...prev,
        staffIds: exists ? currentIds.filter((id) => id !== staffId) : [...currentIds, staffId],
      };
    });
  }

  function setSaturdayStaffAttendance(staffId, shouldAttend) {
    if (!saturdayEligibleIdSet.has(staffId)) return;
    setSaturdayForm((prev) => {
      const currentIds = pruneSaturdayStaffIds(prev.staffIds);
      const exists = currentIds.includes(staffId);
      if (shouldAttend && !exists) return { ...prev, staffIds: [...currentIds, staffId] };
      if (!shouldAttend && exists) return { ...prev, staffIds: currentIds.filter((id) => id !== staffId) };
      return { ...prev, staffIds: currentIds };
    });
  }

  function replaceSaturdayStaff(outgoingStaffId, incomingStaffId) {
    if (!outgoingStaffId || !incomingStaffId || outgoingStaffId === incomingStaffId) return;
    setSaturdayForm((prev) => {
      if (!prev.staffIds.includes(outgoingStaffId)) return prev;
      if (prev.staffIds.includes(incomingStaffId)) return prev;
      return {
        ...prev,
        staffIds: prev.staffIds.map((staffId) => (staffId === outgoingStaffId ? incomingStaffId : staffId)),
      };
    });
    setSwapTargetStaffId(null);
  }

  function handleSaturdaySwapDrop(event, outgoingStaffId) {
    event.preventDefault();
    const incomingStaffId = event.dataTransfer.getData("text/saturday-staff-id");
    replaceSaturdayStaff(outgoingStaffId, incomingStaffId);
  }

  function handleSaturdayStaffDrop(event, shouldAttend) {
    event.preventDefault();
    const staffId = event.dataTransfer.getData("text/saturday-staff-id");
    if (staffId) setSaturdayStaffAttendance(staffId, shouldAttend);
  }

  function saturdayCandidateDates(baseDate) {
    const base = baseDate ? new Date(`${baseDate}T00:00:00`) : today;
    const start = new Date(base.getFullYear(), base.getMonth(), 1);
    const end = new Date(base.getFullYear(), base.getMonth() + 2, 0);
    const dates = [];

    for (let d = new Date(start); d <= end; d = addDateDays(d, 1)) {
      if (d.getDay() === 6) dates.push(toDateKey(d));
    }

    return dates;
  }

  function selectSaturdayCandidate(date, staffIdToAdd = null) {
    const existing = saturdayScheduleForDate(date);
    const staffIds = existing?.staffIds || [];
    setSwapTargetStaffId(null);
    setSaturdayForm({
      date,
      staffIds: staffIdToAdd && !staffIds.includes(staffIdToAdd) ? [...staffIds, staffIdToAdd] : staffIds,
      note: existing?.note || "",
    });
  }

  function selectSwapCandidate(date) {
    const existing = saturdayScheduleForDate(date);
    setSwapCandidateDate(date);
    setSwapCandidateStaffIds(existing?.staffIds || []);
    setSwapTargetStaffId(null);
  }

  function swapSaturdayStaffBetweenDates(leftStaffId, rightStaffId) {
    if (!leftStaffId || !rightStaffId || leftStaffId === rightStaffId) return;
    if (!swapCandidateDate) return;

    setSaturdayForm((prev) => {
      if (!prev.staffIds.includes(leftStaffId)) return prev;
      if (prev.staffIds.includes(rightStaffId)) return prev;
      return {
        ...prev,
        staffIds: prev.staffIds.map((staffId) => (staffId === leftStaffId ? rightStaffId : staffId)),
      };
    });

    setSwapCandidateStaffIds((prev) => {
      if (!prev.includes(rightStaffId)) return prev;
      if (prev.includes(leftStaffId)) return prev;
      return prev.map((staffId) => (staffId === rightStaffId ? leftStaffId : staffId));
    });

    setSwapTargetStaffId(null);
  }

  function handleSaturdayTapSwap(rightStaffId) {
    if (!swapCandidateDate) {
      alert("候補の土曜日を選択してください。");
      return;
    }
    if (!swapTargetStaffId) {
      alert("左側の出勤者を先に選択してください。");
      return;
    }

    const leftPerson = staff.find((person) => person.id === swapTargetStaffId);
    const rightPerson = staff.find((person) => person.id === rightStaffId);
    if (!leftPerson || !rightPerson) return;

    swapSaturdayStaffBetweenDates(swapTargetStaffId, rightStaffId);
  }

  function moveSaturdayStaffWithoutTarget() {
  if (!swapCandidateDate) {
    alert("候補の土曜日を選択してください。");
    return;
  }

  if (!swapTargetStaffId) {
    alert("左側の出勤者を先に選択してください。");
    return;
  }

  setSaturdayForm((prev) => ({
    ...prev,
    staffIds: prev.staffIds.filter((id) => id !== swapTargetStaffId),
  }));

  setSwapCandidateStaffIds((prev) =>
    prev.includes(swapTargetStaffId) ? prev : [...prev, swapTargetStaffId]
  );

  setSwapTargetStaffId(null);
}

  function handleSaturdayCrossSwapDrop(event, leftStaffId) {
    event.preventDefault();
    const rightStaffId = event.dataTransfer.getData("text/saturday-staff-id");
    swapSaturdayStaffBetweenDates(leftStaffId, rightStaffId);
  }

  function arraysEqualByValue(a, b) {
    if (a.length !== b.length) return false;
    return a.every((value, index) => value === b[index]);
  }

async function saveSaturdaySettings(nextGroups, nextOverrides, nextRotation) {
  if (tutorialModeRef.current) return;

  const cleanGroups = SATURDAY_GROUP_KEYS.reduce((acc, groupKey) => {
    acc[groupKey] = pruneSaturdayStaffIds(nextGroups?.[groupKey]);
    return acc;
  }, {});

  const cleanOverrides = (nextOverrides || [])
    .map((item) => ({
      ...item,
      staffIds: pruneSaturdayStaffIds(item.staffIds),
    }))
    .filter((item) => !(
      item.restoredByUndo
      && item.staffIds.length === 0
    ));

  const payload = {
    overrides: cleanOverrides,
    updatedAt: Date.now(),
    updatedBy: loginUser?.id || "",
    updatedByName: loginUser ? personName(loginUser) : "",
  };

  if (isAdmin) {
    await setDoc(doc(db, "settings", "saturdayDuty"), {
      groups: cleanGroups,
      ...payload,
      rotation: nextRotation,
    });
    return;
  }

  await updateDoc(doc(db, "settings", "saturdayDuty"), payload);
}

function toggleSaturdayGroupStaff(groupKey, staffId) {
  setSaturdayGroups((prev) => {
    if (!saturdayEligibleIdSet.has(staffId)) return prev;
    const current = pruneSaturdayStaffIds(prev[groupKey]);
    const exists = current.includes(staffId);
    const nextGroups = {
      ...prev,
      [groupKey]: exists ? current.filter((id) => id !== staffId) : [...current, staffId],
    };

    saveSaturdaySettings(nextGroups, saturdayOverrides, saturdayRotation);
    return nextGroups;
  });
}

function updateSaturdayRotation(nextRotation) {
  const rotationChanged =
    nextRotation.startDate !== saturdayRotation.startDate
    || nextRotation.startGroup !== saturdayRotation.startGroup;

  if (!rotationChanged) return;

  // 開始設定を変更しても、日付ごとの個別変更は削除しない。
  // 必要な日だけ「この日を元に戻す」から再計算する。
  setSaturdayRotation(nextRotation);
  saveSaturdaySettings(saturdayGroups, saturdayOverrides, nextRotation);
}

function saturdayRestorePreview(date) {
  if (!date || isYearEndNewYearVolunteerSaturday(date)) return null;

  const groupKey = saturdayBaseGroupKeyForDate(date);
  if (!groupKey) return null;

  const staffIds = pruneSaturdayStaffIds(saturdayGroups[groupKey] || []);
  const people = staffIds
    .map((id) => staff.find((person) => person.id === id))
    .filter(Boolean);

  return {
    date,
    groupKey,
    staffIds,
    people,
  };
}

function openSaturdayRestoreDialog(date) {
  if (!date) return;

  const target = new Date(`${date}T00:00:00`);
  if (target.getDay() !== 6) {
    alert("この機能は土曜日だけ使用できます。");
    return;
  }

  const preview = saturdayRestorePreview(date);
  if (!preview) {
    alert("この日の土曜勤務を計算できません。開始日と開始グループを確認してください。");
    return;
  }

  if (preview.staffIds.length === 0) {
    alert(`${preview.groupKey}グループに職員が登録されていません。土曜出勤設定を確認してください。`);
    return;
  }

  setSaturdayRestoreTargetDate(date);
  setShowSaturdayRestoreDialog(true);
}

async function resetSaturdayOverrideForDate(date) {
  if (!date || saturdayRestoreSubmitting) return;

  const groups = saturdayUndoGroupsForDate(date);
  const groupIds = groups.map((group) => group.changeGroupId);

  if (groupIds.length === 0) {
    alert("この日に解除できる個別変更はありません。");
    return;
  }

  setSaturdayRestoreSubmitting(true);

  try {
    const nextOverrides = rebuildSaturdayOverridesWithoutGroups(groupIds);
    await saveSaturdaySettings(saturdayGroups, nextOverrides, saturdayRotation);
    setSaturdayOverrides(nextOverrides);

    const restoredSchedule = scheduleFromOverrideList(date, nextOverrides);
    if (saturdayForm.date === date) {
      setSaturdayForm((prev) => ({
        ...prev,
        staffIds: restoredSchedule.staffIds,
        note: restoredSchedule.note,
      }));
    }

    setSwapCandidateDate(null);
    setSwapCandidateStaffIds([]);
    setSwapTargetStaffId(null);
    setShowSaturdayRestoreDialog(false);
    setSaturdayRestoreTargetDate("");
  } catch (error) {
    console.error("Saturday restore failed", error);
    alert("この日の土曜勤務を元に戻せませんでした。通信状況を確認して、もう一度お試しください。");
  } finally {
    setSaturdayRestoreSubmitting(false);
  }
}

  function extractSaturdayChangeHistory(override) {
    if (!override) return [];

    if (Array.isArray(override.changeHistory) && override.changeHistory.length > 0) {
      return override.changeHistory.map((entry) => ({
        ...entry,
        date: entry.date || override.date,
        changeGroupId: entry.changeGroupId || override.changeGroupId || makeId("legacy-change"),
        beforeStaffIds: pruneSaturdayStaffIds(entry.beforeStaffIds),
        afterStaffIds: pruneSaturdayStaffIds(entry.afterStaffIds),
        beforeNote: entry.beforeNote || "",
        afterNote: entry.afterNote || "",
        changedAt: Number(entry.changedAt || override.updatedAt || 0),
      }));
    }

    const chain = [];
    let current = override;
    const seen = new Set();

    while (current) {
      const changeGroupId = current.changeGroupId || `legacy-${current.date}-${current.updatedAt || chain.length}`;
      const key = `${changeGroupId}:${current.date}`;
      if (!seen.has(key)) {
        const baseGroupKey = saturdayBaseGroupKeyForDate(current.date);
        const fallbackBefore = pruneSaturdayStaffIds(saturdayGroups[baseGroupKey] || []);
        chain.push({
          date: current.date,
          changeGroupId,
          beforeStaffIds: Array.isArray(current.previousStaffIds)
            ? pruneSaturdayStaffIds(current.previousStaffIds)
            : current.previousOverride
              ? pruneSaturdayStaffIds(current.previousOverride.staffIds)
              : fallbackBefore,
          afterStaffIds: pruneSaturdayStaffIds(current.staffIds),
          beforeNote: current.previousNote || current.previousOverride?.note || "",
          afterNote: current.note || "",
          changedAt: Number(current.updatedAt || 0),
          changedBy: current.changedBy || "",
          changedByName: current.changedByName || "",
        });
        seen.add(key);
      }
      current = current.previousOverride || null;
    }

    return chain.sort((a, b) => a.changedAt - b.changedAt);
  }

  function allSaturdayChangeHistory() {
    const byKey = new Map();
    saturdayOverrides.forEach((override) => {
      extractSaturdayChangeHistory(override).forEach((entry) => {
        const key = `${entry.changeGroupId}:${entry.date}`;
        const existing = byKey.get(key);
        if (!existing || Number(existing.changedAt || 0) <= Number(entry.changedAt || 0)) {
          byKey.set(key, entry);
        }
      });
    });
    return Array.from(byKey.values()).sort((a, b) => a.changedAt - b.changedAt);
  }

  function applySaturdayHistoryToBase(date, history) {
    const volunteerDay = isYearEndNewYearVolunteerSaturday(date);
    const baseGroupKey = volunteerDay ? null : saturdayBaseGroupKeyForDate(date);
    let staffIds = volunteerDay
      ? []
      : pruneSaturdayStaffIds(saturdayGroups[baseGroupKey] || []);
    let note = "";

    history
      .filter((entry) => entry.date === date)
      .sort((a, b) => Number(a.changedAt || 0) - Number(b.changedAt || 0))
      .forEach((entry) => {
        const beforeIds = pruneSaturdayStaffIds(entry.beforeStaffIds);
        const afterIds = pruneSaturdayStaffIds(entry.afterStaffIds);
        const removedIds = beforeIds.filter((id) => !afterIds.includes(id));
        const addedIds = afterIds.filter((id) => !beforeIds.includes(id));

        staffIds = staffIds.filter((id) => !removedIds.includes(id));
        addedIds.forEach((id) => {
          if (!staffIds.includes(id)) staffIds.push(id);
        });
        note = entry.afterNote || note;
      });

    return { staffIds: pruneSaturdayStaffIds(staffIds), note };
  }

  function makeSaturdayOverrideFromHistory(date, history) {
    const dateHistory = history
      .filter((entry) => entry.date === date)
      .sort((a, b) => Number(a.changedAt || 0) - Number(b.changedAt || 0));
    if (dateHistory.length === 0) return null;

    const rebuilt = applySaturdayHistoryToBase(date, dateHistory);
    const latest = dateHistory[dateHistory.length - 1];

    return {
      date,
      staffIds: rebuilt.staffIds,
      note: rebuilt.note,
      updatedAt: Number(latest.changedAt || Date.now()),
      changeGroupId: latest.changeGroupId,
      changeHistory: dateHistory,
      previousStaffIds: latest.beforeStaffIds,
      previousNote: latest.beforeNote || "",
      previousOverride: null,
      changedBy: latest.changedBy || "",
      changedByName: latest.changedByName || "",
    };
  }

  function rebuildSaturdayOverridesWithoutGroups(groupIds) {
    const excluded = new Set(groupIds);
    const remainingHistory = allSaturdayChangeHistory().filter(
      (entry) => !excluded.has(entry.changeGroupId)
    );
    const dates = Array.from(new Set(remainingHistory.map((entry) => entry.date)));

    return dates
      .map((date) => makeSaturdayOverrideFromHistory(date, remainingHistory))
      .filter(Boolean)
      .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
  }

  function scheduleFromOverrideList(date, overrideList) {
    const override = overrideList.find((item) => item.date === date && !item.disabled);
    if (override) {
      return {
        staffIds: pruneSaturdayStaffIds(override.staffIds),
        note: override.note || "",
      };
    }

    if (isYearEndNewYearVolunteerSaturday(date)) return { staffIds: [], note: "" };
    const groupKey = saturdayBaseGroupKeyForDate(date);
    return {
      staffIds: pruneSaturdayStaffIds(saturdayGroups[groupKey] || []),
      note: "",
    };
  }

  function saturdayUndoGroupsForDate(date) {
    const history = allSaturdayChangeHistory();
    const groupIds = Array.from(new Set(
      history
        .filter((entry) => entry.date === date)
        .map((entry) => entry.changeGroupId)
    ));

    return groupIds.map((changeGroupId) => {
      const entries = history
        .filter((entry) => entry.changeGroupId === changeGroupId)
        .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));

      return {
        changeGroupId,
        entries,
        dates: entries.map((entry) => entry.date),
        changedAt: Math.max(...entries.map((entry) => Number(entry.changedAt || 0))),
      };
    }).sort((a, b) => b.changedAt - a.changedAt);
  }

  function openSaturdayUndoDialog(date) {
    const groups = saturdayUndoGroupsForDate(date);
    if (groups.length === 0) {
      alert("この日に解除できる個別変更はありません。");
      return;
    }

    setSaturdayUndoTargetDate(date);
    setSaturdayUndoSelectedDates([]);
    setShowSaturdayUndoDialog(true);
  }

  function toggleSaturdayUndoDate(changeGroupId) {
    // 個別解除は1回につき1つの変更グループだけを対象にする。
    setSaturdayUndoSelectedDates([changeGroupId]);
  }

  async function applySaturdayUndoSelection() {
    const targetGroupIds = Array.from(new Set(saturdayUndoSelectedDates));
    if (targetGroupIds.length === 0) {
      alert("解除する変更を1件以上選択してください。");
      return;
    }

    const nextOverrides = rebuildSaturdayOverridesWithoutGroups(targetGroupIds);

    try {
      await saveSaturdaySettings(saturdayGroups, nextOverrides, saturdayRotation);
      setSaturdayOverrides(nextOverrides);

      if (saturdayForm.date) {
        const restored = scheduleFromOverrideList(saturdayForm.date, nextOverrides);
        setSaturdayForm((prev) => ({
          ...prev,
          staffIds: restored.staffIds,
          note: restored.note,
        }));
      }

      setSwapCandidateDate(null);
      setSwapCandidateStaffIds([]);
      setSwapTargetStaffId(null);
      setShowSaturdayUndoDialog(false);
      setSaturdayUndoTargetDate("");
      setSaturdayUndoSelectedDates([]);
    } catch (error) {
      console.error("Saturday grouped undo failed", error);
      alert("個別変更を解除できませんでした。通信状況を確認して、もう一度お試しください。");
    }
  }

  function resetSaturdayOverride(date) {
    openSaturdayUndoDialog(date);
  }

  function saveSaturdaySchedule(e) {
    e.preventDefault();
    if (!saturdayForm.date) {
      alert("日付を入力してください。");
      return;
    }

    const weekday = new Date(`${saturdayForm.date}T00:00:00`).getDay();
    if (weekday !== 6 && !confirm("選択日が土曜日ではありません。この日で登録しますか？")) return;
    if (pruneSaturdayStaffIds(saturdayForm.staffIds).length === 0 && !swapCandidateDate) {
      alert("土曜出勤者を1名以上選択してください。");
      return;
    }

    const changeGroupId = makeId("saturday-change");
    const changedAt = Date.now();
    const existingHistory = allSaturdayChangeHistory();
    const newEntries = [];

    const appendEntry = (date, nextStaffIds, nextNote) => {
      const currentSchedule = saturdayScheduleForDate(date);
      const beforeStaffIds = pruneSaturdayStaffIds(currentSchedule?.staffIds || []);
      const afterStaffIds = pruneSaturdayStaffIds(nextStaffIds);
      const beforeNote = currentSchedule?.note || "";
      const afterNote = String(nextNote || "").trim();

      if (arraysEqualByValue(beforeStaffIds, afterStaffIds) && beforeNote === afterNote) return;

      newEntries.push({
        date,
        changeGroupId,
        beforeStaffIds,
        afterStaffIds,
        beforeNote,
        afterNote,
        changedAt,
        changedBy: loginUser?.id || "",
        changedByName: loginUser ? personName(loginUser) : "",
      });
    };

    appendEntry(saturdayForm.date, saturdayForm.staffIds, saturdayForm.note);

    if (swapCandidateDate) {
      appendEntry(
        swapCandidateDate,
        swapCandidateStaffIds,
        saturdayScheduleForDate(swapCandidateDate)?.note || ""
      );
    }

    if (newEntries.length === 0) {
      alert("変更内容がありません。");
      return;
    }

    const nextHistory = [...existingHistory, ...newEntries];
    const dates = Array.from(new Set(nextHistory.map((entry) => entry.date)));
    const nextOverrides = dates
      .map((date) => makeSaturdayOverrideFromHistory(date, nextHistory))
      .filter(Boolean)
      .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));

    if (tutorialModeRef.current) {
      setSaturdayOverrides(nextOverrides);
      setSelectedDate(saturdayForm.date);
      setShowSaturdayEdit(false);
      setSwapCandidateDate(null);
      setSwapCandidateStaffIds([]);
      setSwapTargetStaffId(null);
      onTutorialEvent("saturday-save");
      return;
    }

    saveSaturdaySettings(saturdayGroups, nextOverrides, saturdayRotation)
      .then(() => {
        setSaturdayOverrides(nextOverrides);
        setSelectedDate(saturdayForm.date);
        setShowSaturdayEdit(false);
        setSwapCandidateDate(null);
        setSwapCandidateStaffIds([]);
        setSwapTargetStaffId(null);
      })
      .catch((error) => {
        console.error("Saturday schedule save failed", error);
        alert("土曜勤務の変更を保存できませんでした。通信状況を確認して、もう一度お試しください。");
      });
  }

async function deleteSaturdaySchedule(date) {
  if (!date) return;

  const targetOverrideExists = saturdayOverrides.some(
    (item) => item.date === date
  );

  if (!targetOverrideExists) {
    alert("この日に解除できる個別変更はありません。");
    return;
  }

  const preview = saturdayRestorePreview(date);
  if (!preview) {
    alert("この日の土曜勤務を再計算できません。開始日と開始グループを確認してください。");
    return;
  }

  const confirmed = window.confirm(
    `${String(date).replaceAll("-", "/")} の個別変更を解除します。\n\n` +
    "保存当時のスタッフ名や変更対象者には依存せず、この日付の個別変更データをすべて削除します。\n" +
    "解除後は、現在のスタッフマスタとA〜Dグループ設定から土曜勤務を再計算します。"
  );

  if (!confirmed) return;

  // 氏名・変更前後の担当者・changeGroupIdには依存せず、
  // 対象日をキーに、その日の個別変更データをすべて削除する。
  const nextOverrides = saturdayOverrides
    .filter((item) => item.date !== date)
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));

  try {
    await saveSaturdaySettings(saturdayGroups, nextOverrides, saturdayRotation);
    setSaturdayOverrides(nextOverrides);

    setSaturdayUndoSelectedDates((prev) =>
      prev.filter((targetDate) => targetDate !== date)
    );

    if (saturdayForm.date === date) {
      setSaturdayForm((prev) => ({
        ...prev,
        staffIds: preview.staffIds,
        note: "",
      }));
    }

    setSwapCandidateDate(null);
    setSwapCandidateStaffIds([]);
    setSwapTargetStaffId(null);
    setShowSaturdayUndoDialog(false);
    setSaturdayUndoTargetDate("");
    setSaturdayUndoSelectedDates([]);
  } catch (error) {
    console.error("Saturday override delete by date failed", error);
    alert("個別変更を解除できませんでした。通信状況を確認して、もう一度お試しください。");
  }
}

  const visibleStaff = isAdmin ? activeStaff : activeStaff.filter((s) => s.id === loginId);
  const showTimeInputs = ["paid", "child", "compensatory", "holiday", "other"].includes(form.type) && form.method === "time";
  const showMethod = ["paid", "child", "holiday", "other", "compensatory"].includes(form.type);
  const methodOptions = ["holiday", "other"].includes(form.type)
    ? Object.entries(HOLIDAY_WORK_METHODS)
    : form.type === "compensatory"
      ? [["full", "1日（7時間45分）"], ["time", "時間単位（15分単位）"]]
      : Object.entries(METHODS);
  const showBreakCheck =
    showTimeInputs &&
    overlapMinutes(toMinutes(form.start), toMinutes(form.end), toMinutes("12:00"), toMinutes("13:00")) > 0;

  const [startHour, startMinute] = form.start.split(":");
  const [endHour, endMinute] = form.end.split(":");

  const startHourOptions = TIME_HOUR_OPTIONS.filter((hour) =>
    TIME_MINUTE_OPTIONS.some((minute) => {
      const time = `${pad(hour)}:${minute}`;
      return toMinutes(time) >= toMinutes("08:30") && toMinutes(time) < toMinutes("17:15");
    })
  );

  const startMinuteOptions = TIME_MINUTE_OPTIONS.filter((minute) => {
    const time = `${pad(startHour)}:${minute}`;
    return toMinutes(time) >= toMinutes("08:30") && toMinutes(time) < toMinutes("17:15");
  });

  const endHourOptions = TIME_HOUR_OPTIONS.filter((hour) =>
    TIME_MINUTE_OPTIONS.some((minute) => {
      const time = `${pad(hour)}:${minute}`;
      return toMinutes(time) > toMinutes(form.start) && toMinutes(time) <= toMinutes("17:15");
    })
  );

  const endMinuteOptions = TIME_MINUTE_OPTIONS.filter((minute) => {
    const time = `${pad(endHour)}:${minute}`;
    return toMinutes(time) > toMinutes(form.start) && toMinutes(time) <= toMinutes("17:15");
  });

  function changeStartPart(part, value) {
    const nextHour = part === "hour" ? value : startHour;
    const nextMinute = part === "minute" ? value : startMinute;
    const nextStart = `${pad(nextHour)}:${nextMinute}`;

    if (
      toMinutes(nextStart) < toMinutes("08:30") ||
      toMinutes(nextStart) >= toMinutes("17:15")
    ) {
      return;
    }

    const nextEnd =
      toMinutes(form.end) > toMinutes(nextStart)
        ? form.end
        : TIME_LEAVE_OPTIONS.find((time) => toMinutes(time) > toMinutes(nextStart)) || "17:15";

    setForm((prev) => ({
      ...prev,
      start: nextStart,
      end: nextEnd,
    }));
  }

  function changeEndPart(part, value) {
    const nextHour = part === "hour" ? value : endHour;
    const nextMinute = part === "minute" ? value : endMinute;
    const nextEnd = `${pad(nextHour)}:${nextMinute}`;

    if (
      toMinutes(nextEnd) <= toMinutes(form.start) ||
      toMinutes(nextEnd) > toMinutes("17:15")
    ) {
      return;
    }

    setForm((prev) => ({
      ...prev,
      end: nextEnd,
    }));
  }

    if (authLoading) {
  return (
    <div className="loginGate">
      <div className="loginCard">
        <h1>読み込み中</h1>
      </div>
    </div>
  );
}

if (!firebaseUser) {
  return (
    <div className="loginGate">
      <div className="loginCard">
        <h1>休暇・出勤管理</h1>
        <p>Googleアカウントでログインしてください。</p>
        <button type="button" onClick={handleGoogleLogin}>
          Googleでログイン
        </button>
      </div>
    </div>
  );
}
if (staffAuthLoading) {
  return (
    <div className="loginGate">
      <div className="loginCard">
        <h1>職員情報を確認中</h1>
      </div>
    </div>
  );
}

if (!loginStaff) {
  return (
    <div className="loginGate">
      <div className="loginCard">
        <h1>初回連携</h1>
        <p>職種と職員番号を入力してください。</p>

        <label className="loginField">
          <span>職種</span>
          <select
            value={linkForm.job}
            onChange={(e) => setLinkForm((prev) => ({ ...prev, job: e.target.value }))}
          >
            <option value="PT">PT</option>
            <option value="OT">OT</option>
          </select>
        </label>

        <label className="loginField">
          <span>職員番号</span>
          <input
            type="text"
            value={linkForm.staffNumber}
            onChange={(e) => setLinkForm((prev) => ({ ...prev, staffNumber: e.target.value }))}
            placeholder="職員番号"
          />
        </label>

        {staffAuthError && <p className="loginError">{staffAuthError}</p>}

        <button type="button" onClick={handleStaffLink}>
          連携する
        </button>

        <button type="button" className="loginSubButton" onClick={handleLogout}>
          ログアウト
        </button>
      </div>
    </div>
  );
}

if (!staffLoaded) {
  return (
    <div className="loginGate">
      <div className="loginCard">
        <h1>スタッフ情報を読み込み中</h1>
        <p>最新の職員マスタを取得しています。</p>
      </div>
    </div>
  );
}

if (staffLoaded && staff.length === 0) {
  return (
    <div className="loginGate">
      <div className="loginCard">
        <h1>スタッフ情報を取得できません</h1>
        <p>通信状況を確認してから、アプリを開き直してください。</p>
        <button type="button" onClick={() => window.location.reload()}>
          再読み込み
        </button>
        <button type="button" className="loginSubButton" onClick={handleLogout}>
          ログアウト
        </button>
      </div>
    </div>
  );
}

  return (
    <div className="appShell">
      <header className="minimalAppHeader">
        <h1>予定管理</h1>
        <div className="accountMenuAnchor">
          <button type="button" className="accountMenuToggle" aria-label={accountMenuOpen ? "メニューを閉じる" : "メニューを開く"} aria-expanded={accountMenuOpen} onClick={() => setAccountMenuOpen((open) => !open)}>{accountMenuOpen ? <X size={21} /> : <Menu size={21} />}</button>
          {accountMenuOpen && (
            <>
              <button type="button" className="accountMenuBackdrop" aria-label="メニューを閉じる" onClick={() => setAccountMenuOpen(false)} />
              <div className="accountMenuPanel" role="group" aria-label="アカウントメニュー">
                <div className="accountMenuHeading">メニュー</div>
                <label className="compactStaffSelect">
                  <span>表示スタッフ</span>
                  <div className="accountStaffControl"><UserRound size={18} aria-hidden="true" />
                    <select value={loginId} onChange={(e) => { setLoginId(e.target.value); setAccountMenuOpen(false); }}>
                      {activeStaff.map((person) => <option key={person.id} value={person.id}>{personName(person)}</option>)}
                    </select>
                  </div>
                </label>
                <button type="button" className="accountMenuItem" onClick={() => { setAccountMenuOpen(false); setSelectedDate(null); setView("summary"); }}><ChartColumnIncreasing size={19} aria-hidden="true" />集計</button>
                {isAdmin && (
                  <div className="accountAdminSection">
                    <button type="button" className="accountAdminToggle accountMenuItem" aria-expanded={adminMenuOpen} onClick={() => setAdminMenuOpen((open) => !open)}>
                      <Settings2 size={19} aria-hidden="true" />管理者用設定 {adminMenuOpen ? <ChevronUp className="accountMenuChevron" size={17} /> : <ChevronDown className="accountMenuChevron" size={17} />}
                    </button>
                    {adminMenuOpen && (
                      <div className="accountAdminItems">
                        <div className="compensatorySettingsCard">
                          <div className="accountSettingTitle"><CalendarClock size={17} aria-hidden="true" /><div><strong>代休管理開始日</strong><small>代休の対象となる勤務の開始日</small></div></div>
                          <JapaneseDateInput value={compensatorySettings.startDate} onChange={updateCompensatoryStartDate} />
                        </div>
                        <button type="button" className="accountMenuItem" onClick={() => { setAccountMenuOpen(false); setShowStaffEdit(true); }}><Users size={17} aria-hidden="true" />職員編集</button>
                        <button type="button" className="accountMenuItem" onClick={() => { setAccountMenuOpen(false); setShowSaturdayGroupSettings(true); openSaturdayEdit(form.date); }}><UsersRound size={17} aria-hidden="true" />土曜出勤グループ設定</button>
                        <button type="button" className="accountMenuItem" onClick={() => { setAccountMenuOpen(false); setShowSaturdayGroupSettings(false); openSaturdayEdit(form.date); }}><CalendarCheck size={17} aria-hidden="true" />土曜出勤設定</button>
                      </div>
                    )}
                  </div>
                )}
                <button type="button" className="accountMenuItem" onClick={() => { setAccountMenuOpen(false); tutorialMode ? openTutorialMenu() : setShowTutorialCenter(true); }}><BookOpen size={19} aria-hidden="true" />{tutorialMode ? "チュートリアル中" : "使い方"}</button>
                <button type="button" className="accountMenuItem" onClick={() => { setAccountMenuOpen(false); handleLogout(); }}><LogOut size={19} aria-hidden="true" />ログアウト</button>
              </div>
            </>
          )}
        </div>
      </header>

      <AnnouncementBoard
        announcements={todayAnnouncements}
        isAdmin={isAdmin}
        onOpenEdit={() => { setEditingAnnouncementId(null); setShowAnnouncementEdit(true); }}
        onDelete={deleteAnnouncement}
      />


      {view === "calendar" ? (
        <>
          <section className="calendarCard">
            <div
              className="calendarScopeSwitch"
              role="group"
              aria-label="カレンダーの表示範囲"
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                width: "min(100%, 220px)",
                margin: "0 auto 8px",
                padding: "3px",
                gap: "3px",
                border: "1px solid #93c5fd",
                borderRadius: "10px",
                background: "#eff6ff",
                boxShadow: "inset 0 1px 2px rgba(15, 23, 42, 0.08)",
              }}
            >
              <button
                type="button"
                className={displayScope === "all" ? "active" : ""}
                aria-pressed={displayScope === "all"}
                onClick={() => { setDisplayScope("all"); setSelectedDate(null); }}
                style={{
                  minHeight: "34px",
                  padding: "5px 12px",
                  border: "none",
                  borderRadius: "7px",
                  whiteSpace: "nowrap",
                  fontWeight: 700,
                  color: displayScope === "all" ? "#ffffff" : "#475569",
                  background: displayScope === "all" ? "#2563eb" : "transparent",
                  boxShadow: displayScope === "all" ? "0 1px 3px rgba(37, 99, 235, 0.3)" : "none",
                }}
              >
                全体
              </button>
              <button
                type="button"
                className={displayScope === "mine" ? "active" : ""}
                aria-pressed={displayScope === "mine"}
                onClick={() => { setDisplayScope("mine"); setSelectedDate(null); }}
                style={{
                  minHeight: "34px",
                  padding: "5px 12px",
                  border: "none",
                  borderRadius: "7px",
                  whiteSpace: "nowrap",
                  fontWeight: 700,
                  color: displayScope === "mine" ? "#ffffff" : "#475569",
                  background: displayScope === "mine" ? "#2563eb" : "transparent",
                  boxShadow: displayScope === "mine" ? "0 1px 3px rgba(37, 99, 235, 0.3)" : "none",
                }}
              >
                自分
              </button>
            </div>

            <div className="monthNav calendarMonthNav">
              <button onClick={() => {
                if (month === 1) { setYear(year - 1); setMonth(12); } else setMonth(month - 1);
                setSelectedDate(null);
              }}>＜</button>
              <strong className="calendarMonthLabel">{year}年{month}月</strong>
              <button onClick={() => {
                if (month === 12) { setYear(year + 1); setMonth(1); } else setMonth(month + 1);
                setSelectedDate(null);
              }}>＞</button>
            </div>

            <div className="weekHeader">
              {["日", "月", "火", "水", "木", "金", "土"].map((d) => (
                <div key={d}>{d}</div>
              ))}
            </div>

            <div className="calendarGrid">
              {calendarCells.map((day, index) => {
                if (!day) return <div key={`empty-${index}`} className="calendarCell empty" />;

                const date = dateKey(year, month, day);
                const count = countByJob(date);
                const holidayWork = holidayWorkCountByJob(date);
                const personalPlanCount = personalPlanCountForDate(date);
                const outpatientPlanCount = displayScope === "mine" ? outpatientPlanCountForDate(date, loginId) : 0;
                const dayAnnouncements = announcementsForDate(date);
                const weekday = new Date(`${date}T00:00:00`).getDay();
                const holidayName = holidays[date];
                const isToday = date === todayKey();

                return (
                  <button
                    key={date}
                    type="button"
                    data-tutorial-target={weekday === 6 ? "saturday-calendar-day" : "leave-calendar-day"}
                    onClick={() => {
                      openLeaveFormForDate(date);
                      if (tutorialMode && tutorialGuideId === "compensatory") {
                        onTutorialEvent("compensatory-date");
                      } else {
                        onTutorialEvent(weekday === 6 ? "saturday-date" : "leave-date");
                      }
                    }}
                    aria-current={isToday ? "date" : undefined}
                    className={[
                      "calendarCell",
                      weekday === 0 ? "sunday" : "",
                      weekday === 6 ? "saturdayCell" : "",
                      holidayName ? "holidayCell" : "",
                      isToday ? "todayCell" : "",
                    ].join(" ")}
                    style={{
                      ...(isToday ? { border: "3px solid #2563eb" } : {}),
                      outline: "none",
                      boxShadow: "none",
                    }}
                  >
                    <div className="dayHeader">
                      <span className="dayNumber">{day}</span>
                      {canShowSaturdayForDate(date) && <span className="saturdayMini">土勤</span>}
                      {dayAnnouncements.length > 0 && <span className="announcementMini">予{dayAnnouncements.length}</span>}
                    </div>

                    <div className="dayCounts">
                      {count.PT > 0 && <span>PT {count.PT}</span>}
                      {count.OT > 0 && <span>OT {count.OT}</span>}
                    </div>
                    {displayScope === "mine" && (personalPlanCount > 0 || outpatientPlanCount > 0) && (
                      <div className="personalCalendarTags">
                        {personalPlanCount > 0 && <span className="personalPlanTag">自予{personalPlanCount}</span>}
                        {outpatientPlanCount > 0 && <span className="outpatientPlanTag">外{outpatientPlanCount}</span>}
                      </div>
                    )}
                    {holidayWork.total > 0 && (
                      <div className="holidayWorkTags">
                        {holidayWork.PT > 0 && <span>休出 PT {holidayWork.PT}</span>}
                        {holidayWork.OT > 0 && <span>休出 OT {holidayWork.OT}</span>}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </section>

        </>
      ) : (
        <section className="summaryHomeView">
          <div
            className="card"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "10px",
              marginBottom: "12px",
            }}
          >
            <div style={{ textAlign: "left" }}>
              <h2 style={{ margin: 0, fontSize: "20px" }}>集計</h2>
              <small style={{ color: "#64748b" }}>{currentFy}年度</small>
            </div>
            <button
              type="button"
              className="softButton"
              onClick={() => setView("calendar")}
              style={{ whiteSpace: "nowrap" }}
            >
              カレンダーへ戻る
            </button>
          </div>
          <SummaryView staff={visibleStaff} summary={summary} fiscalYear={currentFy} />
        </section>
      )}

      {selectedDate && (
        <div className="modalBackdrop" onClick={closeDateModal}>
          <div
            className="dayModal"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(94vw, 720px)",
              maxHeight: "92dvh",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            <div className="modalHeader">
              <div>
                <h2>{dateModalMode === "form" ? (editingRecordId ? "予定を編集" : "予定を登録") : selectedDate.replaceAll("-", "/")}</h2>
                {dateModalMode !== "form" && <span className="modalSubLabel">{displayScope === "mine" ? "自分の予定" : "全体表示"}</span>}
              </div>
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                {dateModalMode === "schedule" && displayScope === "mine" && (
                  <div className="outpatientCalendarAdjust" aria-label="外来予定人数">
                    <span>外来</span>
                    <button
                      type="button"
                      onClick={() => setOutpatientDraft((value) => Math.max(0, value - 1))}
                      disabled={outpatientDraft <= 0}
                      aria-label="外来予定人数を1人減らす"
                    >
                      −
                    </button>
                    <b>{outpatientDraft}</b>
                    <button
                      type="button"
                      onClick={() => setOutpatientDraft((value) => value + 1)}
                      aria-label="外来予定人数を1人増やす"
                    >
                      ＋
                    </button>
                  </div>
                )}
                <button className="closeButton" type="button" onClick={closeDateModal}>
                  ×
                </button>
              </div>
            </div>

            <div style={{ display: dateModalMode === "schedule" ? "contents" : "none" }}>
            {selectedRecords().length === 0 && selectedAnnouncements().length === 0 && new Date(`${selectedDate}T00:00:00`).getDay() !== 6 && !holidays[selectedDate] ? (
              <p className="emptyText">この日の登録はありません。</p>
            ) : (
              <div
                className="detailList"
                style={{
                  display: "grid",
                  gap: "6px",
                  overflowY: "auto",
                  paddingRight: "2px",
                }}
              >
                {selectedAnnouncements().map((item) => (
                  <div
                    className={`detailItem announcementDetail ${item.priority === "important" ? "important" : ""}`}
                    key={`${item.id}-${item.occurrenceDate || selectedDate}`}
                    style={{
                      display: "block",
                      position: "relative",
                      border: "none",
                      padding: "8px 9px",
                      paddingRight: isAdmin ? "90px" : "9px",
                    }}
                  >
                    <div style={{ minWidth: 0, textAlign: "left" }}>
                      <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: "4px 8px" }}>
                        <strong style={{ fontSize: "15px", lineHeight: 1.3 }}>
                          {item.title}
                        </strong>
                        {item.time && (
                          <span style={{ fontSize: "12px", color: "#64748b", whiteSpace: "nowrap" }}>
                            {item.time}
                          </span>
                        )}
                      </div>
                      {item.message && (
                        <p
                          style={{
                            whiteSpace: "pre-wrap",
                            margin: "3px 0 0",
                            fontSize: "12.5px",
                            lineHeight: 1.45,
                            color: "#64748b",
                            textAlign: "left",
                          }}
                        >
                          {item.message}
                        </p>
                      )}
                    </div>
                    {isAdmin && (
                      <div style={{ display: "flex", gap: "2px", alignItems: "flex-start", justifyContent: "flex-end", position: "absolute", top: "50%", transform: "translateY(-50%)", right: "8px", height: "36px", zIndex: 1 }}>
                        <button type="button" className="editRecordButton" style={{ width: 36, height: 36, minWidth: 36, minHeight: 36, padding: 0, border: "1px solid transparent", background: "transparent", boxShadow: "none", color: "#64748b", borderRadius: 9, display: "inline-flex", alignItems: "center", justifyContent: "center" }} onClick={() => editAnnouncement(item)} aria-label="予定を編集" title="編集"><Pencil size={17} aria-hidden="true" /></button>
                        <button type="button" className="deleteButton recordIconDelete" style={{ width: 36, height: 36, minWidth: 36, minHeight: 36, padding: 0, border: "1px solid transparent", background: "transparent", boxShadow: "none", color: "#c86a72", borderRadius: 9, display: "inline-flex", alignItems: "center", justifyContent: "center" }} onClick={() => deleteAnnouncement(item.id)} aria-label="予定を削除" title="削除"><Trash2 size={17} aria-hidden="true" /></button>
                      </div>
                    )}
                  </div>
                ))}

                {holidays[selectedDate] && (
                  <div className="detailItem holidayDetail">
                    <div>
                      <strong>祝日</strong>
                      <p>{holidays[selectedDate]}</p>
                    </div>
                  </div>
                )}

                {new Date(`${selectedDate}T00:00:00`).getDay() === 6 && (
                  <>
                    <section
                      className="detailItem saturdayWorkDetail"
                      aria-label="土曜出勤変更"
                      style={{ display: "block", padding: "10px" }}
                    >
                      <div style={{ textAlign: "left", marginBottom: "8px" }}>
                        <strong style={{ display: "block", fontSize: "14px" }}>土曜出勤変更</strong>
                        <small style={{ color: "#64748b" }}>
                          {saturdayScheduleForDate(selectedDate)?.isOverride
                            ? "この日のみ個別変更"
                            : "この日の勤務者を個別に変更できます"}
                        </small>
                      </div>

                      <div
                        className="saturdayChangeActionRow"
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                          gap: "5px",
                          width: "100%",
                        }}
                      >
                        <button
                          type="button"
                          className="softMiniButton"
                          data-tutorial-target="saturday-change-button"
                          onClick={() => { openSaturdayEdit(selectedDate); onTutorialEvent("saturday-change-open"); }}
                          style={{
                            width: "100%",
                            minWidth: 0,
                            height: "36px",
                            padding: "0 4px",
                            fontSize: "clamp(10px, 2.7vw, 12px)",
                            whiteSpace: "nowrap",
                            lineHeight: 1,
                          }}
                        >
                          出勤日を変更
                        </button>
                        <button
                          type="button"
                          className="deleteButton compactAction"
                          disabled={!saturdayScheduleForDate(selectedDate)?.isOverride}
                          onClick={() => openSaturdayUndoDialog(selectedDate)}
                          style={{
                            width: "100%",
                            minWidth: 0,
                            height: "36px",
                            padding: "0 4px",
                            fontSize: "clamp(10px, 2.7vw, 12px)",
                            whiteSpace: "nowrap",
                            lineHeight: 1,
                            opacity: saturdayScheduleForDate(selectedDate)?.isOverride ? 1 : 0.45,
                          }}
                        >
                          個別変更解除
                        </button>
                        <button
                          type="button"
                          className="softMiniButton"
                          disabled={!saturdayScheduleForDate(selectedDate)?.isOverride}
                          onClick={() => openSaturdayRestoreDialog(selectedDate)}
                          style={{
                            width: "100%",
                            minWidth: 0,
                            height: "36px",
                            padding: "0 4px",
                            fontSize: "clamp(10px, 2.7vw, 12px)",
                            whiteSpace: "nowrap",
                            lineHeight: 1,
                            opacity: saturdayScheduleForDate(selectedDate)?.isOverride ? 1 : 0.45,
                          }}
                        >
                          この日を元に戻す
                        </button>
                      </div>
                    </section>

                    <section
                      className="detailItem saturdayWorkDetail"
                      aria-label="土曜出勤者一覧"
                      style={{ display: "block", padding: "10px" }}
                    >
                      <div className="saturdayWorkBody">
                        <div className="saturdayWorkTitleText" style={{ textAlign: "left", marginBottom: "8px" }}>
                          <strong>
                            {saturdayScheduleForDate(selectedDate)?.isYearEndNewYearVolunteer
                              ? "土曜出勤（年末年始・希望者勤務）"
                              : "土曜出勤者"}
                          </strong>
                          {saturdayScheduleForDate(selectedDate)?.isYearEndNewYearVolunteer && (
                            <small style={{ display: "block" }}>通常のA〜Dループは進みません</small>
                          )}
                        </div>
                        <div className="saturdayJobColumns">
                          {["PT", "OT"].map((job) => {
                            const rows = saturdayDutyRowsForDate(selectedDate, job);
                            return (
                              <section className="saturdayJobColumn" key={job}>
                                <h4>{job}</h4>
                                {rows.length === 0 ? (
                                  <p className="saturdayEmpty">該当なし</p>
                                ) : (
                                  rows.map((row) => (
                                    <p key={row.id} className={row.changed || row.added || row.removed ? "saturdayChanged" : ""}>
                                      {row.changed ? (
                                        <>
                                          {personName(row.before)} <span>⇒</span> {personName(row.after)}
                                        </>
                                      ) : row.added ? (
                                        <>
                                          追加 <span>⇒</span> {personName(row.after)}
                                        </>
                                      ) : row.removed ? (
                                        <>
                                          {personName(row.before)} <span>⇒</span> 未設定
                                        </>
                                      ) : (
                                        <>{personName(row.after || row.before)}</>
                                      )}
                                    </p>
                                  ))
                                )}
                              </section>
                            );
                          })}
                        </div>
                        {saturdayScheduleForDate(selectedDate)?.note && <small>{saturdayScheduleForDate(selectedDate).note}</small>}
                      </div>
                    </section>
                  </>
                )}

                {selectedRecords().length > 0 && (
                  <section
                    aria-label="休暇・勤務スタッフ"
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
                      gap: "6px",
                    }}
                  >
                    {selectedRecordGroups().map((group) => (
                      <div
                        key={group.staffId}
                        className={`detailItem ${group.records[0]?.type || ""}`}
                        style={{
                          display: "block",
                          position: "relative",
                          padding: "8px 9px",
                          minWidth: 0,
                          textAlign: "left",
                        }}
                      >
                        <strong
                          style={{
                            display: "block",
                            marginBottom: "5px",
                            paddingRight: "80px",
                            fontSize: "13.5px",
                            lineHeight: 1.25,
                          }}
                        >
                          {personName(group.staff)}
                        </strong>

                        <div style={{ display: "grid", gap: "4px" }}>
                          {group.records.map((r, recordIndex) => (
                            <div
                              key={r.id}
                              style={{
                                display: "grid",
                                gridTemplateColumns: recordIndex === 0 ? "minmax(0, 1fr)" : "minmax(0, 1fr) auto",
                                alignItems: "start",
                                gap: "7px",
                                minWidth: 0,
                                paddingRight: recordIndex === 0 ? "80px" : 0,
                              }}
                            >
                              <div style={{ minWidth: 0 }}>
                                <span
                                  style={{
                                    display: "block",
                                    fontSize: "12px",
                                    lineHeight: 1.3,
                                    color: "#475569",
                                  }}
                                >
                                  {recordDisplay(r)}
                                </span>
                                {r.note && (
                                  <small
                                    style={{
                                      display: "block",
                                      marginTop: "1px",
                                      fontSize: "10.5px",
                                      lineHeight: 1.3,
                                      color: "#64748b",
                                      whiteSpace: "pre-wrap",
                                    }}
                                  >
                                    {r.note}
                                  </small>
                                )}
                              </div>

                              <div style={{ display: "flex", gap: "2px", alignItems: "flex-start", justifyContent: "flex-end", flexShrink: 0, ...(recordIndex === 0 ? { position: "absolute", top: "50%", transform: "translateY(-50%)", right: "8px", height: "36px", zIndex: 1 } : {}) }}>
                                {(isAdmin || r.staffId === loginUser?.id) && (
                                  <button type="button" className="editRecordButton" style={{ width: 36, height: 36, minWidth: 36, minHeight: 36, padding: 0, border: "1px solid transparent", background: "transparent", boxShadow: "none", color: "#64748b", borderRadius: 9, display: "inline-flex", alignItems: "center", justifyContent: "center" }} onClick={() => editRecord(r)} aria-label="予定を編集" title="編集"><Pencil size={17} aria-hidden="true" /></button>
                                )}
                                <button type="button" className="deleteButton recordIconDelete" style={{ width: 36, height: 36, minWidth: 36, minHeight: 36, padding: 0, border: "1px solid transparent", background: "transparent", boxShadow: "none", color: "#c86a72", borderRadius: 9, display: "inline-flex", alignItems: "center", justifyContent: "center" }} onClick={() => removeRecord(r.id, r)} aria-label="予定を削除" title="削除"><Trash2 size={17} aria-hidden="true" /></button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </section>
                )}
              </div>
            )}

            <div style={{ marginTop: "12px", flexShrink: 0 }}>
              <button
                type="button"
                className="primaryButton"
                data-tutorial-target="leave-open-form"
                onClick={() => {
                  if (tutorialMode && tutorialGuideId === "leave") {
                    setForm((prev) => ({ ...prev, type: "compensatory", method: "full", start: "08:30", end: "17:15" }));
                  }
                  if (tutorialMode && tutorialGuideId === "compensatory") {
                    // 「代休を選ぶ」操作を確実に体験できるよう、開始時は有休にしておく。
                    setForm((prev) => ({ ...prev, type: "paid", method: "full", compensatorySourceDate: "" }));
                  }
                  openLeaveFormInDateModal();
                  onTutorialEvent(tutorialGuideId === "compensatory" ? "compensatory-open-form" : "leave-open-form");
                }}
                style={{ width: "100%" }}
              >
                休暇・特別勤務・個別予定登録
              </button>
            </div>
            </div>

            {dateModalMode === "form" && (
              <div className="leaveFormScroll" style={{ overflowY: "auto", paddingRight: "2px" }}>
                <div className="formGrid leaveRegisterGrid">
          <label className="leaveFieldStaff">
            <span>職員</span>
            <select
              className="leaveSelectControl"
              style={LEAVE_SELECT_VISIBLE_STYLE}
              value={isAdmin ? form.staffId : loginId}
              disabled={!isAdmin}
              onChange={(e) => setForm({ ...form, staffId: e.target.value })}
            >
              {activeStaff.map((s) => (
                <option key={s.id} value={s.id}>
                  {personName(s)}
                </option>
              ))}
            </select>
          </label>

          <label className="leaveFieldDate">
            <span>日付</span>
            <JapaneseDateInput value={form.date} onChange={(date) => setForm({ ...form, date })} />
          </label>

          <label className="leaveFieldType">
            <span>種別</span>
            <select
              className="leaveSelectControl"
              style={LEAVE_SELECT_VISIBLE_STYLE}
              value={form.type}
              data-tutorial-target="leave-type"
              onClick={() => { if (form.type === "paid") onTutorialEvent("leave-paid"); }}
              onChange={(e) => {
                const nextType = e.target.value;
                setForm({
                  ...form,
                  type: nextType,
                  compensatorySourceDate: nextType === "compensatory" ? form.compensatorySourceDate : "",
                  holidayCompensation: nextType === "holiday" ? (form.holidayCompensation || "compensatory") : form.holidayCompensation,
                  otherCompensation: nextType === "other" ? (form.otherCompensation || "plan") : form.otherCompensation,
                  method: ["paid", "child", "holiday", "other"].includes(nextType)
                    && ["full", "morning", "afternoon", "time"].includes(form.method)
                      ? form.method
                      : "full",
                });
                if (nextType === "paid") onTutorialEvent("leave-paid");
                if (nextType === "compensatory") onTutorialEvent("compensatory-type");
              }}
            >
              {REGISTER_TYPE_OPTIONS.map(([key, value]) => (
                <option key={key} value={key}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          {showMethod && (
            <label className="leaveFieldMethod">
              <span>取得方法</span>
              <select
                className="leaveSelectControl"
                style={LEAVE_SELECT_VISIBLE_STYLE}
                data-tutorial-target="leave-method"
                value={form.method}
                onChange={(e) => {
                  const value = e.target.value;
                  setForm({ ...form, method: value });
                  if (value === "time") onTutorialEvent("leave-time");
                }}
              >
                {methodOptions.map(([key, value]) => (
                  <option key={key} value={key}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
          )}

          {form.type === "holiday" && (
            <label className="wide leaveFieldCompensation">
              <span>処理方法</span>
              <select
                className="leaveSelectControl"
                style={LEAVE_SELECT_VISIBLE_STYLE}
                value={form.holidayCompensation || "compensatory"}
                onChange={(e) => setForm({ ...form, holidayCompensation: e.target.value })}
              >
                <option value="compensatory">代休消化</option>
                <option value="overtime">時間外消化</option>
              </select>
              <small className="leaveCompensationHint">
                {form.holidayCompensation === "overtime"
                  ? "時間外として登録します"
                  : "代休の対象となる出勤日に追加します"}
              </small>
            </label>
          )}

          {form.type === "other" && (
          <label className="wide">
            <span>
              予定内容（必須）
            </span>
            <input
              placeholder={form.type === "other" ? "予定の内容を入力してください" : "任意"}
              value={form.note}
              required={form.type === "other"}
              aria-required={form.type === "other"}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
          </label>
          )}

          {form.type === "other" && (
            <label className="wide leaveFieldCompensation">
              <span>処理方法</span>
              <select
                className="leaveSelectControl"
                style={LEAVE_SELECT_VISIBLE_STYLE}
                value={form.otherCompensation || "plan"}
                onChange={(e) => setForm({ ...form, otherCompensation: e.target.value })}
              >
                <option value="plan">予定のみ</option>
                <option value="compensatory">代休消化</option>
                <option value="overtime">時間外消化</option>
              </select>
              <div className="otherPlanInlineHelp">
                <strong>予定の表示先</strong>
                <table className="otherPlanHelpTable">
                  <thead><tr><th scope="col">処理方法</th><th scope="col">全体</th><th scope="col">自分</th></tr></thead>
                  <tbody>
                    <tr><th scope="row">予定のみ</th><td>－</td><td>○</td></tr>
                    <tr><th scope="row">代休消化</th><td>○</td><td>○</td></tr>
                    <tr><th scope="row">時間外消化</th><td>○</td><td>○</td></tr>
                  </tbody>
                </table>
                <small>○ 表示　／　－ 非表示</small>
                {form.otherCompensation === "compensatory" && (
                  <p className="otherPlanCompensatoryNote" role="note">
                    <strong>代休消化：</strong>代休管理の「未消化分」から消化時間が差し引かれます。
                  </p>
                )}
              </div>
            </label>
          )}

          {showTimeInputs && (
            <>
              <label className="wide leaveTimeField leaveTimeStart">
                <span>開始</span>
                <div
                  className="leaveTimeParts"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr) auto",
                    gap: "8px",
                    alignItems: "center",
                  }}
                >
                  <select
                    className="leaveSelectControl"
                    style={LEAVE_SELECT_VISIBLE_STYLE}
                    data-tutorial-target="leave-start-hour"
                    value={String(Number(startHour))}
                    onChange={(e) => { changeStartPart("hour", e.target.value); if (String(e.target.value) === "15") onTutorialEvent("leave-start-hour-15"); }}
                  >
                    {startHourOptions.map((hour) => (
                      <option key={`start-hour-${hour}`} value={hour}>{hour}</option>
                    ))}
                  </select>
                  <span>時</span>

                  <select
                    className="leaveSelectControl"
                    style={LEAVE_SELECT_VISIBLE_STYLE}
                    data-tutorial-target="leave-start-minute"
                    value={startMinute}
                    onChange={(e) => { changeStartPart("minute", e.target.value); if (e.target.value === "15") onTutorialEvent("leave-start-minute-15"); }}
                  >
                    {startMinuteOptions.map((minute) => (
                      <option key={`start-minute-${minute}`} value={minute}>{minute}</option>
                    ))}
                  </select>
                  <span>分</span>
                </div>
              </label>

              <label className="wide leaveTimeField leaveTimeEnd">
                <span>終了</span>
                <div
                  className="leaveTimeParts"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr) auto",
                    gap: "8px",
                    alignItems: "center",
                  }}
                >
                  <select
                    className="leaveSelectControl"
                    style={LEAVE_SELECT_VISIBLE_STYLE}
                    data-tutorial-target="leave-end-hour"
                    value={String(Number(endHour))}
                    onChange={(e) => { changeEndPart("hour", e.target.value); if (String(e.target.value) === "17") onTutorialEvent("leave-end-hour-17"); }}
                  >
                    {endHourOptions.map((hour) => (
                      <option key={`end-hour-${hour}`} value={hour}>{hour}</option>
                    ))}
                  </select>
                  <span>時</span>

                  <select
                    className="leaveSelectControl"
                    style={LEAVE_SELECT_VISIBLE_STYLE}
                    data-tutorial-target="leave-end-minute"
                    value={endMinute}
                    onChange={(e) => { changeEndPart("minute", e.target.value); if (e.target.value === "15") onTutorialEvent("leave-end-minute-15"); }}
                  >
                    {endMinuteOptions.map((minute) => (
                      <option key={`end-minute-${minute}`} value={minute}>{minute}</option>
                    ))}
                  </select>
                  <span>分</span>
                </div>
              </label>
            </>
          )}

          {form.type === "compensatory" && (() => {
            const targetStaffId = isAdmin ? form.staffId : (loginUser?.id || form.staffId);
            const candidates = compensatorySourceCandidates(targetStaffId, form.date).filter((date) => formCompensatoryRemainingMinutes(targetStaffId, date) > 0);
            return (
              <div className="wide compensatorySourceBox">
                <label>
                  <span>対象となる出勤日</span>
                  <div data-tutorial-target="compensatory-source-calendar">
                    <JapaneseDateInput
                      value={form.compensatorySourceDate}
                      onChange={chooseCompensatorySourceDate}
                      placeholder="対象勤務日を選択"
                    />
                  </div>
                </label>
                <div className="compensatorySourceHelp">
                  {form.compensatorySourceDate ? (
                    <strong>代休({sourceDateShortLabel(form.compensatorySourceDate)}出勤分) として登録します</strong>
                  ) : (
                    <strong>未消化の代休対象日がありません</strong>
                  )}
                  {form.compensatorySourceDate && (() => {
                    const remaining = formCompensatoryRemainingMinutes(targetStaffId, form.compensatorySourceDate);
                    const requested = form.method === "time"
                      ? Math.max(0, Math.round(calcTimeHours(form.start, form.end, form.deductBreak) * 60))
                      : COMPENSATORY_DAY_MINUTES;
                    const after = Math.max(0, remaining - requested);
                    return (
                      <div className="compensatoryRemaining">
                        <strong>残り：{formatMinutesJa(remaining)}</strong>
                        {form.method === "time" && requested > 0 && (
                          <small>今回取得：{formatMinutesJa(requested)} ／ 取得後：{formatMinutesJa(after)}</small>
                        )}
                      </div>
                    );
                  })()}
                  <small>未消化または一部消化の対象日がある場合は、最も古い日を自動選択します。未来の土曜出勤・休日出勤・代休対象のその他予定も選択できます。</small>
                </div>
                {candidates.length > 0 && (
                  <div className="compensatoryCandidateRow" aria-label="未消化の代休対象日">
                    <span>未消化：</span>
                    {candidates.slice(0, 8).map((date) => (
                      <button
                        key={date}
                        type="button"
                        className={form.compensatorySourceDate === date ? "active" : ""}
                        onClick={() => chooseCompensatorySourceDate(date)}
                      >
                        {sourceDateShortLabel(date)}（残{formatMinutesJa(formCompensatoryRemainingMinutes(targetStaffId, date))}）
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          {form.type !== "other" && (
          <label className="wide">
            <span>
              メモ
            </span>
            <input
              placeholder={form.type === "other" ? "予定の内容を入力してください" : "任意"}
              value={form.note}
              required={form.type === "other"}
              aria-required={form.type === "other"}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
          </label>
          )}

          {showBreakCheck && (
            <label className="checkRow wide">
              <input
                type="checkbox"
                checked={form.deductBreak}
                onChange={(e) => setForm({ ...form, deductBreak: e.target.checked })}
              />
              <span>昼休憩（12:00〜13:00）を控除する</span>
            </label>
          )}
        </div>

        <button className="primaryButton" data-tutorial-target="leave-submit" type="button" onClick={addRecord} disabled={recordSubmitting}>
          {recordSubmitting ? "保存中..." : editingRecordId ? "変更を保存" : "登録する"}
        </button>
              </div>
            )}

          </div>
        </div>
      )}

      {showAnnouncementEdit && isAdmin && (
        <div className="modalBackdrop" onClick={() => setShowAnnouncementEdit(false)}>
          <form className="announcementModal" onClick={(e) => e.stopPropagation()} onSubmit={saveAnnouncement}>
            <div className="modalHeader">
              <h2>{editingAnnouncementId ? "予定を編集" : "掲示板登録"}</h2>
              <button className="closeButton" type="button" onClick={() => setShowAnnouncementEdit(false)}>
                ×
              </button>
            </div>

            <div className="announcementFormGrid">
              <label className="wide">
                <span>タイトル</span>
                <input
                  value={announcementForm.title}
                  onChange={(e) => setAnnouncementForm({ ...announcementForm, title: e.target.value })}
                  placeholder="例：リハ科会議"
                />
              </label>

              <label className="wide">
                <span>内容</span>
                <textarea
                  value={announcementForm.message}
                  onChange={(e) => setAnnouncementForm({ ...announcementForm, message: e.target.value })}
                  placeholder="例：17:30からスタッフルーム"
                />
              </label>

              <label>
                <span>重要度</span>
                <select
                  value={announcementForm.priority}
                  onChange={(e) => setAnnouncementForm({ ...announcementForm, priority: e.target.value })}
                >
                  <option value="normal">通常</option>
                  <option value="important">重要</option>
                </select>
              </label>

              <label>
                <span>登録区分</span>
                <select
                  value={announcementForm.scheduleType}
                  onChange={(e) => setAnnouncementForm({ ...announcementForm, scheduleType: e.target.value })}
                >
                  {Object.entries(ANNOUNCEMENT_TYPES).map(([key, value]) => (
                    <option key={key} value={key}>{value}</option>
                  ))}
                </select>
              </label>

              {announcementForm.scheduleType === "single" ? (
                <label>
                  <span>日付</span>
                  <JapaneseDateInput
                    value={announcementForm.date}
                    onChange={(date) => setAnnouncementForm({ ...announcementForm, date })}
                  />
                </label>
              ) : (
                <>
                  {announcementForm.scheduleType === "monthlyNth" && (
                    <label>
                      <span>第◯</span>
                      <select
                        value={announcementForm.nth}
                        onChange={(e) => setAnnouncementForm({ ...announcementForm, nth: e.target.value })}
                      >
                        <option value="1">第1</option>
                        <option value="2">第2</option>
                        <option value="3">第3</option>
                        <option value="4">第4</option>
                        <option value="5">第5</option>
                      </select>
                    </label>
                  )}

                  <label>
                    <span>曜日</span>
                    <select
                      value={announcementForm.weekday}
                      onChange={(e) => setAnnouncementForm({ ...announcementForm, weekday: e.target.value })}
                    >
                      {WEEKDAYS.map((day, index) => (
                        <option key={day} value={String(index)}>{day}曜</option>
                      ))}
                    </select>
                  </label>

                  <label>
                    <span>掲載終了日（任意）</span>
                    <JapaneseDateInput
                      value={announcementForm.endDate}
                      onChange={(endDate) => setAnnouncementForm({ ...announcementForm, endDate })}
                      allowClear
                      placeholder="未設定"
                    />
                  </label>
                </>
              )}

              <label>
                <span>時刻</span>
                <input
                  type="time"
                  value={announcementForm.time}
                  onChange={(e) => setAnnouncementForm({ ...announcementForm, time: e.target.value })}
                />
              </label>
            </div>

            <div className="previewBox">
              {announcementForm.scheduleType === "single"
                ? `単発：${announcementForm.date ? dateLabel(announcementForm.date) : "日付未設定"}${announcementForm.time ? ` ${announcementForm.time}` : ""}`
                : announcementForm.scheduleType === "weekly"
                  ? `定期：毎週${WEEKDAYS[Number(announcementForm.weekday)]}曜${announcementForm.time ? ` ${announcementForm.time}` : ""}`
                  : `定期：毎月第${announcementForm.nth}${WEEKDAYS[Number(announcementForm.weekday)]}曜${announcementForm.time ? ` ${announcementForm.time}` : ""}`}
            </div>

            <button className="primaryButton" type="submit">登録する</button>
          </form>
        </div>
      )}

      {showSaturdayEdit && (
        <div className="modalBackdrop" onClick={() => setShowSaturdayEdit(false)}>
          <form className="staffModal saturdaySettingsModal" onSubmit={saveSaturdaySchedule} onClick={(e) => e.stopPropagation()}>
            <div className="modalHeader">
              <div>
                <h2>土曜出勤設定</h2>
                <span className="modalSubLabel">設定した開始日から、A→B→C→D→A…の順で土曜日ごとに自動表示します。</span>
              </div>
              <button className="closeButton" type="button" onClick={() => setShowSaturdayEdit(false)}>
                ×
              </button>
            </div>

            {isAdmin && (
              <button
                className="groupSettingsToggle"
                type="button"
                onClick={() => setShowSaturdayGroupSettings((prev) => !prev)}
              >
                <span>
                  <strong>グループ設定</strong>
                  <small>基本グループとローテーション開始日の設定</small>
                </span>
                <b>{showSaturdayGroupSettings ? "閉じる" : "開く"}</b>
              </button>
            )}

            {isAdmin && showSaturdayGroupSettings && (
              <>
            <section className="groupSettings">
              <h3>ローテーション開始設定</h3>
              <p className="settingHelp">開始日と開始グループを設定すると、その土曜日からA→B→C→Dの順に月をまたいで自動で回ります。</p>
              <div className="rotationSettingRow">
                <label>
                  <span>開始日</span>
                  <JapaneseDateInput
                    value={saturdayRotation.startDate}
                    onChange={(startDate) => {
                      updateSaturdayRotation({
                        ...saturdayRotation,
                        startDate,
                      });
                    }}
                  />
                </label>
                <label>
                  <span>開始グループ</span>
                  <select
                    value={saturdayRotation.startGroup}
                    onChange={(e) => {
                      updateSaturdayRotation({
                        ...saturdayRotation,
                        startGroup: e.target.value,
                      });
                    }}
                  >
                    {SATURDAY_GROUP_KEYS.map((groupKey) => (
                      <option key={groupKey} value={groupKey}>{groupKey}</option>
                    ))}
                  </select>
                </label>
              </div>

            </section>

            <section className="groupSettings">
              <h3>基本グループ</h3>
              <p className="settingHelp">ここにメンバーを登録すると、土曜出勤が自動でループ表示されます。カレンダーにはグループ名は表示しません。</p>
              <div className="groupGrid">
                {SATURDAY_GROUP_KEYS.map((groupKey) => (
                  <div className="groupBox" key={groupKey}>
                    <h4>{groupKey}</h4>
                    <div className="staffCheckGrid compactChecks">
                      {saturdayEligibleStaff.map((s) => (
                        <label key={`${groupKey}-${s.id}`} className="staffCheckItem">
                          <input
                            type="checkbox"
                            checked={(saturdayGroups[groupKey] || []).includes(s.id)}
                            onChange={() => toggleSaturdayGroupStaff(groupKey, s.id)}
                          />
                          <span>{personName(s)}　{s.job}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
              </>
            )}

            <section className="saturdayOverrideBox">
              <div className="saturdayChangeTitleRow">
                <h3>土曜出勤変更</h3>
                <button
                  className="saturdayInfoMark"
                  type="button"
                  onClick={() => setShowSaturdaySwapHelp((prev) => !prev)}
                  aria-label="交換方法"
                >
                  i
                </button>
              </div>
              {showSaturdaySwapHelp && (
                <p className="saturdayTapHint">左の出勤者と、候補土曜日の出勤者を選んで入れ替えます。</p>
              )}
              <div className="saturdayForm saturdayChangeForm">
                <div className="saturdayStaffSelect">
                  <span>出勤者と候補の土曜日</span>
                  <div className="saturdayDatePuzzle">
                    <section className="saturdayAttendeePanel">
                      <div className="saturdayPanelTitle">
                        <h4>出勤者</h4>
                      </div>
                      <strong className="saturdaySelectedDate">{saturdayForm.date.replaceAll("-", "/")}</strong>
                      <div className="saturdaySwapBoard">
                        <div>
                          <span className="saturdaySwapLabel">現在の出勤者</span>
                          <div className="saturdayPuzzleList">
                            {pruneSaturdayStaffIds(saturdayForm.staffIds).length === 0 ? (
                              <p className="saturdayPuzzleEmpty">出勤者が未設定です</p>
                            ) : (
                              pruneSaturdayStaffIds(saturdayForm.staffIds).map((staffId) => {
                                const person = staff.find((s) => s.id === staffId);
                                if (!person) return null;
                                return (
                                  <button
                                    className={`saturdayPuzzleCard selected ${swapTargetStaffId === person.id ? "swapTarget" : ""}`}
                                    data-tutorial-target="saturday-current-staff"
                                    key={person.id}
                                    type="button"
                                    onClick={() => { setSwapTargetStaffId((current) => (current === person.id ? null : person.id)); onTutorialEvent("saturday-current-staff"); }}
                                  >
                                    <strong>{personName(person)}</strong>
                                    <span>{person.job}</span>
                                  </button>
                                );
                              })
                            )}
                          </div>
                        </div>
                      </div>
                    </section>

                    <section className="saturdayCandidatePanel">
                      <h4>候補の土曜日</h4>
                      <div className="saturdayCandidateSplit">
                        <div className="saturdayCandidateList">
                          {saturdayCandidateDates(saturdayForm.date).filter((date) => date !== saturdayForm.date).map((date) => {
                            const schedule = saturdayScheduleForDate(date);
                            const people = pruneSaturdayStaffIds(date === swapCandidateDate ? swapCandidateStaffIds : schedule?.staffIds || [])
                              .map((staffId) => staff.find((s) => s.id === staffId && Boolean(s.uid)))
                              .filter(Boolean);
                            return (
                              <button
                                className={`saturdayCandidateDate ${date === swapCandidateDate ? "selected" : ""}`}
                                data-tutorial-target="saturday-candidate-date"
                                key={date}
                                type="button"
                                onClick={() => { selectSwapCandidate(date); onTutorialEvent("saturday-candidate-date"); }}
                              >
                                <strong>{date.replaceAll("-", "/")}</strong>
                                <small>
                                  基本：{saturdayBaseGroupKeyForDate(date) || "-"}
                                  {saturdayOverrideForDate(date) ? " ／ 個別変更あり" : ""}
                                </small>
                                <span className="saturdayCandidatePeople">
                                  {people.length === 0 ? "未設定" : people.map((person) => `${personName(person)} ${person.job}`).join("、")}
                                </span>
                              </button>
                            );
                          })}
                        </div>

                        <div className="saturdayCandidateStaff">
                          <span className="saturdaySwapLabel">
                            {swapCandidateDate ? `${swapCandidateDate.replaceAll("-", "/")} の出勤者` : "候補土曜日を選択"}
                          </span>
                          {swapCandidateDate && (
                            <button className="candidateBackButton" type="button" onClick={() => {
                              setSwapCandidateDate(null);
                              setSwapCandidateStaffIds([]);
                              setSwapTargetStaffId(null);
                            }} aria-label="候補土曜日へ戻る" title="候補土曜日へ戻る">
                              ↩
                            </button>
                          )}
                          <div className="saturdayPuzzleList">
{!swapCandidateDate ? (
  <p className="saturdayPuzzleEmpty">右上の日付をタップ</p>
) : (
  <>
    <button
      className={`saturdayPuzzleCard candidate noTarget ${swapTargetStaffId ? "tapReady" : ""}`}
      type="button"
      onClick={moveSaturdayStaffWithoutTarget}
    >
      <strong>変更対象者なし</strong>
      <span>移動</span>
    </button>

    {pruneSaturdayStaffIds(swapCandidateStaffIds).length === 0 ? (
      <p className="saturdayPuzzleEmpty">出勤者が未設定です</p>
    ) : (
      pruneSaturdayStaffIds(swapCandidateStaffIds).map((staffId) => {
        const person = staff.find((s) => s.id === staffId);
        if (!person) return null;
        return (
          <button
            className={`saturdayPuzzleCard candidate ${swapTargetStaffId ? "tapReady" : ""}`}
            data-tutorial-target="saturday-candidate-staff"
            key={person.id}
            type="button"
            onClick={() => { handleSaturdayTapSwap(person.id); onTutorialEvent("saturday-candidate-staff"); }}
          >
            <strong>{personName(person)}</strong>
            <span>{person.job}</span>
          </button>
        );
      })
    )}
  </>
)}
                          </div>
                        </div>
                      </div>
                    </section>
                  </div>
                </div>
              </div>

              <div className="previewBox">
                基本：{saturdayBaseGroupKeyForDate(saturdayForm.date) || "土曜日ではありません"}
                {saturdayOverrideForDate(saturdayForm.date) ? " ／ 個別変更あり" : " ／ 個別変更なし"}
              </div>

              <div className="overrideActions">
                <button className="primaryButton" data-tutorial-target="saturday-save" type="submit">この日の変更を保存</button>
                {saturdayOverrideForDate(saturdayForm.date) && (
                  <button className="softButton" type="button" onClick={() => resetSaturdayOverride(saturdayForm.date)}>
                    個別変更を解除
                  </button>
                )}
              </div>
            </section>
          </form>
        </div>
      )}

      {showSaturdayRestoreDialog && (() => {
        const preview = saturdayRestorePreview(saturdayRestoreTargetDate);
        return (
          <div
            className="modalBackdrop"
            onClick={() => {
              if (saturdayRestoreSubmitting) return;
              setShowSaturdayRestoreDialog(false);
              setSaturdayRestoreTargetDate("");
            }}
          >
            <div
              className="staffModal"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="modalHeader">
                <div>
                  <h2>この日の土曜勤務を元に戻す</h2>
                  <span className="modalSubLabel">
                    実行する前に、元に戻した後の内容を確認してください。
                  </span>
                </div>
                <button
                  className="closeButton"
                  type="button"
                  disabled={saturdayRestoreSubmitting}
                  onClick={() => {
                    setShowSaturdayRestoreDialog(false);
                    setSaturdayRestoreTargetDate("");
                  }}
                >
                  ×
                </button>
              </div>

              <div className="previewBox" style={{ marginTop: "12px" }}>
                <div><strong>対象日</strong></div>
                <div style={{ marginTop: "4px" }}>
                  {saturdayRestoreTargetDate.replaceAll("-", "/")}
                </div>

                <div style={{ marginTop: "12px" }}><strong>元に戻した後の出勤者</strong></div>
                <div style={{ marginTop: "6px", display: "grid", gap: "4px" }}>
                  {preview?.people?.length ? (
                    preview.people.map((person) => (
                      <div key={`restore-preview-${person.id}`}>
                        ・{personName(person)}　{person.job}
                      </div>
                    ))
                  ) : (
                    <div>出勤者を確認できません。</div>
                  )}
                </div>
              </div>

              <div style={{ marginTop: "14px", fontSize: "14px", lineHeight: 1.7 }}>
                <p style={{ margin: 0 }}>
                  この日の土曜勤務を、現在登録されている土曜勤務の順番とA〜Dの所属から計算し直します。
                </p>
                <p style={{ margin: "10px 0 0" }}>
                  <strong>この操作で変わるもの</strong><br />
                  ・この日に関係する個別変更<br />
                  ・同じ交換・変更に連動しているほかの日の出勤者
                </p>
                <p style={{ margin: "10px 0 0" }}>
                  <strong>変わらないもの</strong><br />
                  ・この日と無関係な交換・変更<br />
                  ・A〜Dの所属<br />
                  ・ローテーションの開始日と開始グループ<br />
                  ・ほかの日の個別変更
                </p>
              </div>

              <div className="overrideActions">
                <button
                  className="softButton"
                  type="button"
                  disabled={saturdayRestoreSubmitting}
                  onClick={() => {
                    setShowSaturdayRestoreDialog(false);
                    setSaturdayRestoreTargetDate("");
                  }}
                >
                  キャンセル
                </button>
                <button
                  className="primaryButton"
                  type="button"
                  disabled={saturdayRestoreSubmitting || !preview?.staffIds?.length}
                  onClick={() => resetSaturdayOverrideForDate(saturdayRestoreTargetDate)}
                >
                  {saturdayRestoreSubmitting ? "復元中..." : "元に戻す"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {showSaturdayUndoDialog && (
        <div
          className="modalBackdrop"
          onClick={() => setShowSaturdayUndoDialog(false)}
        >
          <div
            className="staffModal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modalHeader">
              <div>
                <h2>個別変更を解除</h2>
                <span className="modalSubLabel">
                  解除する交換・変更の組を選択してください。
                </span>
              </div>
              <button
                className="closeButton"
                type="button"
                onClick={() => setShowSaturdayUndoDialog(false)}
              >
                ×
              </button>
            </div>

            <div className="staffCheckGrid">
              {saturdayUndoGroupsForDate(saturdayUndoTargetDate).map((group) => {
                const changeLines = group.entries.map((entry) => {
                  const removedNames = entry.beforeStaffIds
                    .filter((id) => !entry.afterStaffIds.includes(id))
                    .map((id) => staff.find((person) => person.id === id))
                    .filter(Boolean)
                    .map((person) => personName(person))
                    .join("、");

                  const addedNames = entry.afterStaffIds
                    .filter((id) => !entry.beforeStaffIds.includes(id))
                    .map((id) => staff.find((person) => person.id === id))
                    .filter(Boolean)
                    .map((person) => personName(person))
                    .join("、");

                  const changeText = removedNames && addedNames
                    ? `${removedNames} ⇒ ${addedNames}`
                    : removedNames
                      ? `${removedNames} を解除`
                      : `${addedNames} を追加`;

                  return `${String(entry.date || "").replaceAll("-", "/")}　${changeText}`;
                });

                return (
                  <label
                    className="staffCheckItem"
                    key={`undo-group-${group.changeGroupId}`}
                  >
                    <input
                      type="radio"
                      name="saturday-undo-group"
                      checked={saturdayUndoSelectedDates.includes(group.changeGroupId)}
                      onChange={() => toggleSaturdayUndoDate(group.changeGroupId)}
                    />
                    <span>
                      <strong>{group.entries.length > 1 ? `${group.entries.length}日間の連動変更` : "個別変更"}</strong>
                      <br />
                      {changeLines.map((line) => (
                        <small key={`${group.changeGroupId}-${line}`} style={{ display: "block" }}>{line}</small>
                      ))}
                    </span>
                  </label>
                );
              })}
            </div>

            <div className="overrideActions">
              <button
                className="primaryButton"
                type="button"
                onClick={applySaturdayUndoSelection}
              >
                この変更を解除
              </button>
              <button
                className="softButton"
                type="button"
                onClick={() => setShowSaturdayUndoDialog(false)}
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}

      {showStaffEdit && (
        <div className="modalBackdrop" onClick={() => setShowStaffEdit(false)}>
          <div className="staffModal" onClick={(e) => e.stopPropagation()}>
            <div className="modalHeader">
              <h2>職員編集</h2>
              <button className="closeButton" type="button" onClick={() => setShowStaffEdit(false)}>
                ×
              </button>
            </div>

            <div className="staffEditList">
              {activeStaff.map((s) => (
                <div className="staffEditRow" key={s.id}>
                  <input
                    value={s.lastName || splitDisplayName(s.name).lastName}
                    onChange={(e) => updateStaffNamePart(s, "lastName", e.target.value)}
                    placeholder="姓"
                  />
                  <input
                    value={s.firstName || splitDisplayName(s.name).firstName}
                    onChange={(e) => updateStaffNamePart(s, "firstName", e.target.value)}
                    placeholder="名"
                  />
                  <select value={s.job} onChange={(e) => updateStaff(s.id, "job", e.target.value)}>
                    <option value="PT">PT</option>
                    <option value="OT">OT</option>
                  </select>
                  <select value={s.role} onChange={(e) => updateStaff(s.id, "role", e.target.value)}>
                    <option value="staff">一般</option>
                    <option value="admin">管理者</option>
                  </select>
                  <button type="button" onClick={() => deleteStaff(s.id)}>
                    削除
                  </button>
                </div>
              ))}
            </div>

            <button className="primaryButton" type="button" onClick={addStaff}>
              職員を追加
            </button>
          </div>
        </div>
      )}
      {tutorialMode && (
        <div className={`tutorialModeBanner ${tutorialGuideId ? "guided" : "free"}`}>
          <strong>チュートリアル</strong>
          {!tutorialGuideId && <span>本番データには保存されません。</span>}
          <div>
            <button type="button" onClick={openTutorialMenu}>操作を選ぶ</button>
            <button type="button" onClick={exitTutorial}>終了</button>
          </div>
        </div>
      )}

      {showTutorialCenter && (
        <div className="modalBackdrop tutorialCenterBackdrop" onClick={() => setShowTutorialCenter(false)}>
          <div className="staffModal tutorialCenter" onClick={(event) => event.stopPropagation()}>
            <div className="modalHeader">
              <div>
                <h2>チュートリアル</h2>
                <span className="modalSubLabel">実際に画面を操作しながら使い方を確認できます。</span>
              </div>
              <button className="closeButton" type="button" onClick={() => setShowTutorialCenter(false)}>×</button>
            </div>
            <div className="tutorialSafetyNote">
              <strong>本番データには反映されません</strong>
              <span>チュートリアル中の登録・変更・削除・消去・保存は端末内だけで動作し、終了時に破棄されます。</span>
            </div>
            <section className="otherPlanHelp" aria-label="その他予定の使い方">
              <h3>その他予定について</h3>
              <div className="otherPlanHelpSteps">
                <strong>登録方法</strong>
                <p>① 登録画面で「その他予定」を選択<br />② 処理方法で「代休消化」を選択</p>
              </div>
              <strong className="otherPlanHelpHeading">予定の表示先</strong>
              <table className="otherPlanHelpTable">
                <thead><tr><th scope="col">処理方法</th><th scope="col">全体</th><th scope="col">自分</th></tr></thead>
                <tbody>
                  <tr><th scope="row">予定のみ</th><td>－</td><td>○</td></tr>
                  <tr><th scope="row">代休消化</th><td>○</td><td>○</td></tr>
                  <tr><th scope="row">時間外消化</th><td>○</td><td>○</td></tr>
                </tbody>
              </table>
              <small className="otherPlanLegend">○：表示　－：非表示</small>
            </section>
            <div className="tutorialGuideGrid">
              {Object.entries(TUTORIAL_GUIDES).map(([id, guide]) => (
                <button key={id} type="button" className="tutorialGuideCard" onClick={() => chooseTutorialGuide(id)}>
                  <span className="tutorialGuideCheck">{tutorialCompleted.has(id) ? "✓" : ""}</span>
                  <strong>{guide.title}</strong>
                  <small>{guide.description}</small>
                </button>
              ))}
            </div>
            <button type="button" className="tutorialFreeButton" onClick={() => { startTutorial(null); setShowTutorialCenter(false); }}>
              自由操作
              <small>ガイドなしで本画面と同様の操作を自由に可能</small>
            </button>
            {tutorialMode && <button type="button" className="tutorialEndButton" onClick={exitTutorial}>チュートリアルを終了して本番へ戻る</button>}
          </div>
        </div>
      )}

      {tutorialMode && tutorialGuideId && !showTutorialCenter && (
        <TutorialGuidePanel guide={TUTORIAL_GUIDES[tutorialGuideId]} stepIndex={tutorialStep} onMenu={openTutorialMenu} onExit={exitTutorial} />
      )}
    </div>
  );
}



function AnnouncementBoard({ announcements, isAdmin, onOpenEdit }) {
  const shown = announcements.slice(0, 8);

  return (
    <section className="announcementBoard compactBoard">
      <div className="announcementHeader compactHeader">
        <h2>本日のお知らせ</h2>
        {isAdmin && (
          <button className="softButton compactAddButton" type="button" onClick={onOpenEdit}>
            ＋ 追加
          </button>
        )}
      </div>

      {shown.length === 0 ? (
        <p className="emptyText left compactEmpty">本日表示するお知らせはありません。</p>
      ) : (
        <ul className="announcementList compactList">
          {shown.map((item) => (
            <li className={`announcementItem compactItem ${item.priority === "important" ? "important" : ""}`} key={`${item.id}-${item.occurrenceDate}`}>
              <span className={`announcementBadge ${item.priority === "important" ? "important" : "normal"}`}>
                {item.priority === "important" ? "重要" : "通常"}
              </span>
              <span className="announcementTitle">
                {item.time ? `${item.time}　` : ""}{item.title}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SummaryView({ staff, summary, fiscalYear }) {
  return (
    <section className="summaryCard">
      <h2>{fiscalYear}年度 集計</h2>

      <div className="tableScroll">
        <table>
          <thead>
            <tr>
              <th>氏名</th>
              <th>職種</th>
              <th>有休 終日</th>
              <th>有休 時間休</th>
              <th>有休 提出用</th>
              <th>看護 終日</th>
              <th>看護 時間</th>
              <th>看護 提出用</th>
              <th>夏季</th>
              <th>土曜</th>
              <th>日祝</th>
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => {
              const sum = summary(s.id);
              return (
                <tr key={s.id}>
                  <td>{personName(s)}</td>
                  <td>{s.job}</td>
                  <td>{sum.paidFull}日</td>
                  <td>{formatHours(sum.paidTime)}</td>
                  <td>{submitFormat(sum.paidTime)}</td>
                  <td>{sum.childFull}日</td>
                  <td>{formatHours(sum.childTime)}</td>
                  <td>{submitFormat(sum.childTime)}</td>
                  <td>{sum.summer}/{SUMMER_LIMIT}</td>
                  <td>{sum.saturday}回</td>
                  <td>{sum.holiday}回</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
