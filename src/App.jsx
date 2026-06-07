import React, { useEffect, useMemo, useState } from "react";
import "./App.css";

const FULL_DAY_HOURS = 7.75;
const MORNING_HOURS = 3.5;
const AFTERNOON_HOURS = 4.25;
const SUMMER_LIMIT = 5;

const DEFAULT_STAFF = [
  { id: "s1", lastName: "山田", firstName: "太郎", name: "山田 太郎", job: "PT", role: "admin" },
  { id: "s2", lastName: "田中", firstName: "美咲", name: "田中 美咲", job: "PT", role: "staff" },
  { id: "s3", lastName: "佐藤", firstName: "健", name: "佐藤 健", job: "PT", role: "staff" },
  { id: "s4", lastName: "高橋", firstName: "優", name: "高橋 優", job: "PT", role: "staff" },
  { id: "s5", lastName: "吉田", firstName: "彩", name: "吉田 彩", job: "OT", role: "staff" },
  { id: "s6", lastName: "伊藤", firstName: "翔", name: "伊藤 翔", job: "OT", role: "staff" },
  { id: "s7", lastName: "渡辺", firstName: "葵", name: "渡辺 葵", job: "OT", role: "staff" },
  { id: "s8", lastName: "中村", firstName: "蓮", name: "中村 蓮", job: "OT", role: "staff" },
];

const LEAVE_TYPES = {
  paid: "有休",
  child: "看護休暇",
  summer: "夏季休暇",
  special: "特別休暇",
  training: "研修",
  business: "出張",
  saturday: "土曜勤務",
  holiday: "日祝勤務",
};

const METHODS = {
  full: "終日",
  morning: "午前休",
  afternoon: "午後休",
  time: "時間休",
};

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

const ANNOUNCEMENT_TYPES = {
  single: "単発",
  weekly: "毎週",
  monthlyNth: "毎月第◯曜日",
};

const SATURDAY_GROUP_KEYS = ["A", "B", "C", "D"];

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

function calcTimeHours(start, end, includeBreak) {
  let minutes = toMinutes(end) - toMinutes(start);
  if (minutes <= 0) return 0;

  if (!includeBreak) {
    minutes -= overlapMinutes(
      toMinutes(start),
      toMinutes(end),
      toMinutes("12:00"),
      toMinutes("13:00")
    );
  }

  return Math.max(0, Math.floor(minutes / 60));
}

function getHours(record) {
  if (record.method === "full") return FULL_DAY_HOURS;
  if (record.method === "morning") return MORNING_HOURS;
  if (record.method === "afternoon") return AFTERNOON_HOURS;
  if (record.method === "time") return calcTimeHours(record.start, record.end, record.includeBreak);
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

function recordDisplay(record) {
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

  return LEAVE_TYPES[record.type] || "";
}

function isLeaveLike(record) {
  return ["paid", "child", "summer", "special"].includes(record.type);
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
    name: `${lastName || ""} ${firstName || ""}`.trim() || member.name || "",
  };
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

function saturdayCountBetween(startDateStr, targetDateStr) {
  if (!startDateStr || !targetDateStr) return 0;
  const start = new Date(`${startDateStr}T00:00:00`);
  const target = new Date(`${targetDateStr}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(target.getTime())) return 0;

  const step = target >= start ? 1 : -1;
  let count = 0;
  for (let d = new Date(start); step > 0 ? d < target : d > target; d = addDateDays(d, 7 * step)) {
    count += step;
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

export default function App() {
  const today = new Date();

  const [staff, setStaff] = useState(() => {
    const saved = localStorage.getItem("leaveStaffV4");
    if (saved) return JSON.parse(saved).map(normalizeStaffMember);

    const oldSaved = localStorage.getItem("leaveStaffV3");
    if (oldSaved) return JSON.parse(oldSaved).map(normalizeStaffMember);

    return DEFAULT_STAFF.map(normalizeStaffMember);
  });

  const [records, setRecords] = useState(() => {
    const saved = localStorage.getItem("leaveRecordsV3");
    return saved ? JSON.parse(saved) : [];
  });

  const [announcements, setAnnouncements] = useState(() => {
    const saved = localStorage.getItem("leaveAnnouncementsV1");
    return saved ? JSON.parse(saved) : [];
  });

  const [saturdayGroups, setSaturdayGroups] = useState(() => {
    const saved = localStorage.getItem("leaveSaturdayGroupsV1");
    if (saved) return JSON.parse(saved);
    return defaultSaturdayGroups(staff);
  });

  const [saturdayOverrides, setSaturdayOverrides] = useState(() => {
    const saved = localStorage.getItem("leaveSaturdayOverridesV1");
    if (saved) return JSON.parse(saved);

    // 旧版で日付ごとに登録していた土曜出勤データがあれば、例外設定として引き継ぎます。
    const oldSaved = localStorage.getItem("leaveSaturdaySchedulesV1");
    return oldSaved ? JSON.parse(oldSaved) : [];
  });

  const [saturdayRotation, setSaturdayRotation] = useState(() => {
    const saved = localStorage.getItem("leaveSaturdayRotationV1");
    if (saved) return JSON.parse(saved);
    return {
      startDate: "2026-04-04",
      startGroup: "A",
    };
  });


  const [holidays, setHolidays] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("japaneseHolidaysV1") || "{}");
      return { ...FALLBACK_HOLIDAYS, ...saved };
    } catch {
      return FALLBACK_HOLIDAYS;
    }
  });

  const [loginId, setLoginId] = useState(staff[0]?.id || "s1");
  const [view, setView] = useState("calendar");
  const [appSection, setAppSection] = useState("leave");
  const [displayScope, setDisplayScope] = useState("all");
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [selectedDate, setSelectedDate] = useState(null);
  const [showStaffEdit, setShowStaffEdit] = useState(false);
  const [showAnnouncementEdit, setShowAnnouncementEdit] = useState(false);
  const [showSaturdayEdit, setShowSaturdayEdit] = useState(false);

  const [form, setForm] = useState({
    staffId: staff[0]?.id || "s1",
    date: `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`,
    type: "paid",
    method: "full",
    start: "08:30",
    end: "17:15",
    includeBreak: false,
    note: "",
  });

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
    localStorage.setItem("leaveStaffV4", JSON.stringify(staff));
  }, [staff]);

  useEffect(() => {
    localStorage.setItem("leaveRecordsV3", JSON.stringify(records));
  }, [records]);

  useEffect(() => {
    localStorage.setItem("leaveAnnouncementsV1", JSON.stringify(announcements));
  }, [announcements]);

  useEffect(() => {
    localStorage.setItem("leaveSaturdayGroupsV1", JSON.stringify(saturdayGroups));
  }, [saturdayGroups]);

  useEffect(() => {
    localStorage.setItem("leaveSaturdayOverridesV1", JSON.stringify(saturdayOverrides));
  }, [saturdayOverrides]);


  useEffect(() => {
    localStorage.setItem("leaveSaturdayRotationV1", JSON.stringify(saturdayRotation));
  }, [saturdayRotation]);


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
  const loginUser = staff.find((s) => s.id === loginId) || staff[0];
  const isAdmin = loginUser?.role === "admin";
  const currentFy = fiscalYear(`${year}-${pad(month)}-01`);
  const todayAnnouncements = useMemo(() => expandAnnouncements(announcements, todayKey()), [announcements]);

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
      .filter((r) => r.date === date)
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
    return saturdayOverrides.find((item) => item.date === date && !item.disabled) || null;
  }

  function saturdayScheduleForDate(date) {
    const groupKey = saturdayBaseGroupKeyForDate(date);
    if (!groupKey) return null;

    const override = saturdayOverrideForDate(date);
    if (override) {
      return {
        date,
        groupKey,
        staffIds: override.staffIds || [],
        note: override.note || "",
        isOverride: true,
      };
    }

    return {
      date,
      groupKey,
      staffIds: saturdayGroups[groupKey] || [],
      note: "",
      isOverride: false,
    };
  }

  function saturdayStaffForDate(date) {
    const schedule = saturdayScheduleForDate(date);
    if (!schedule) return [];
    const people = (schedule.staffIds || []).map((id) => staff.find((s) => s.id === id)).filter(Boolean);
    if (displayScope === "mine") return people.filter((person) => person.id === loginId);
    return people;
  }

  function canShowSaturdayForDate(date) {
    const schedule = saturdayScheduleForDate(date);
    if (!schedule) return false;
    if (displayScope === "mine") return (schedule.staffIds || []).includes(loginId);
    return (schedule.staffIds || []).length > 0;
  }

  function countByJob(date) {
    const list = leaveRecordsForDate(date);
    return {
      PT: list.filter((r) => r.staff.job === "PT").length,
      OT: list.filter((r) => r.staff.job === "OT").length,
      total: list.length,
    };
  }

  function validateRecord(nextRecord) {
    const sameDay = records.filter((r) => r.staffId === nextRecord.staffId && r.date === nextRecord.date);
    const nextIsFull = isFullDayRecord(nextRecord);

    if (sameDay.some((r) => isFullDayRecord(r))) {
      return "この日は既に終日の休暇が登録されています。";
    }

    if (nextIsFull && sameDay.some((r) => isLeaveLike(r))) {
      return "同日に既に休暇があるため、終日の休暇は登録できません。";
    }

    if (["paid", "child"].includes(nextRecord.type) && nextRecord.method === "time") {
      if (toMinutes(nextRecord.end) <= toMinutes(nextRecord.start)) {
        return "終了時刻は開始時刻より後にしてください。";
      }

      const duplicated = sameDay
        .filter((r) => ["paid", "child"].includes(r.type) && r.method === "time")
        .some((r) => hasTimeOverlap(nextRecord, r));

      if (duplicated) {
        return "同じ日の時間休と時間が重複しています。";
      }
    }

    if (nextRecord.type === "summer") {
      const used = records.filter(
        (r) =>
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

  function addRecord() {
    let nextRecord = {
      ...form,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
    };

    if (!isAdmin) {
      nextRecord.staffId = loginId;
    }

    if (!nextRecord.staffId) {
      alert("職員を選択してください。");
      return;
    }

    if (!["paid", "child"].includes(nextRecord.type)) {
      nextRecord.method = "full";
    }

    const error = validateRecord(nextRecord);
    if (error) {
      alert(error);
      return;
    }

    setRecords((prev) => [...prev, nextRecord]);
    setSelectedDate(nextRecord.date);
    setForm((prev) => ({ ...prev, note: "" }));
  }

  function removeRecord(id, record) {
    if (!isAdmin && record.staffId !== loginId) {
      alert("自分の登録以外は削除できません。");
      return;
    }

    if (!confirm("削除しますか？")) return;
    setRecords((prev) => prev.filter((r) => r.id !== id));
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

  function previewText() {
    if (!["paid", "child"].includes(form.type)) return `${LEAVE_TYPES[form.type]}として登録`;
    if (form.method === "full") return "計算結果：終日取得 1日";
    if (form.method === "morning") return "計算結果：時間休 3.5h";
    if (form.method === "afternoon") return "計算結果：時間休 4.25h";
    return `計算結果：時間休 ${formatHours(calcTimeHours(form.start, form.end, form.includeBreak))}`;
  }

  function selectedRecords() {
    if (!selectedDate) return [];
    return scopedRecordsForDate(selectedDate);
  }

  function toggleDate(date) {
    setSelectedDate((current) => (current === date ? null : date));
  }

  function addStaff() {
    setStaff((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
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

  function saveAnnouncement(e) {
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

    setAnnouncements((prev) => [
      {
        id: crypto.randomUUID(),
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
        createdBy: loginId,
      },
      ...prev,
    ]);

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

  function deleteAnnouncement(id) {
    if (!isAdmin) return;
    if (!confirm("このお知らせを削除しますか？")) return;
    setAnnouncements((prev) => prev.filter((item) => item.id !== id));
  }

  function openSaturdayEdit(date = selectedDate || form.date || todayKey()) {
    const existing = saturdayScheduleForDate(date);
    setSaturdayForm({
      date,
      staffIds: existing?.staffIds || [],
      note: existing?.note || "",
    });
    setShowSaturdayEdit(true);
  }

  function toggleSaturdayStaff(staffId) {
    setSaturdayForm((prev) => {
      const exists = prev.staffIds.includes(staffId);
      return {
        ...prev,
        staffIds: exists ? prev.staffIds.filter((id) => id !== staffId) : [...prev.staffIds, staffId],
      };
    });
  }

  function toggleSaturdayGroupStaff(groupKey, staffId) {
    setSaturdayGroups((prev) => {
      const current = prev[groupKey] || [];
      const exists = current.includes(staffId);
      return {
        ...prev,
        [groupKey]: exists ? current.filter((id) => id !== staffId) : [...current, staffId],
      };
    });
  }

  function resetSaturdayOverride(date) {
    if (!isAdmin) return;
    if (!saturdayOverrideForDate(date)) return;
    if (!confirm("この日の個別変更を解除して、基本グループに戻しますか？")) return;
    setSaturdayOverrides((prev) => prev.filter((item) => item.date !== date));
    setSaturdayForm((prev) => {
      const groupKey = saturdayBaseGroupKeyForDate(date);
      return {
        ...prev,
        staffIds: groupKey ? saturdayGroups[groupKey] || [] : [],
        note: "",
      };
    });
  }

  function saveSaturdaySchedule(e) {
    e.preventDefault();
    if (!isAdmin) return;
    if (!saturdayForm.date) {
      alert("日付を入力してください。");
      return;
    }

    const weekday = new Date(`${saturdayForm.date}T00:00:00`).getDay();
    if (weekday !== 6 && !confirm("選択日が土曜日ではありません。この日で登録しますか？")) return;
    if (saturdayForm.staffIds.length === 0) {
      alert("土曜出勤者を1名以上選択してください。");
      return;
    }

    setSaturdayOverrides((prev) => {
      const next = {
        date: saturdayForm.date,
        staffIds: saturdayForm.staffIds,
        note: saturdayForm.note.trim(),
        updatedAt: Date.now(),
      };

      const exists = prev.some((item) => item.date === saturdayForm.date);
      if (exists) return prev.map((item) => (item.date === saturdayForm.date ? next : item));
      return [...prev, next];
    });

    setSelectedDate(saturdayForm.date);
    setShowSaturdayEdit(false);
  }

  function deleteSaturdaySchedule(date) {
    if (!isAdmin) return;
    if (!confirm("この日の土曜出勤を削除しますか？")) return;
    setSaturdayOverrides((prev) => prev.filter((item) => item.date !== date));
  }

  const visibleStaff = isAdmin ? activeStaff : activeStaff.filter((s) => s.id === loginId);
  const showTimeInputs = ["paid", "child"].includes(form.type) && form.method === "time";
  const showMethod = ["paid", "child"].includes(form.type);
  const showBreakCheck =
    showTimeInputs &&
    overlapMinutes(toMinutes(form.start), toMinutes(form.end), toMinutes("12:00"), toMinutes("13:00")) > 0;

  return (
    <div className="appShell">
      <header className="appHeader">
        <div className="appTitleTabs" aria-label="機能切替">
          <button
            type="button"
            className={appSection === "leave" ? "active" : ""}
            onClick={() => setAppSection("leave")}
          >
            休暇・出勤管理
          </button>
          <button
            type="button"
            className={appSection === "patients" ? "active" : ""}
            onClick={() => setAppSection("patients")}
          >
            患者人数管理
          </button>
        </div>

        <label className="loginSelect">
          <span>表示</span>
          <select value={loginId} onChange={(e) => setLoginId(e.target.value)}>
            {activeStaff.map((s) => (
              <option key={s.id} value={s.id}>
                {personName(s)} {s.job}{s.role === "admin" ? "（科長）" : ""}
              </option>
            ))}
          </select>
        </label>
      </header>

      {appSection === "patients" ? (
        <FullPatientManager loginUser={loginUser} />
      ) : (
        <>
      <AnnouncementBoard
        announcements={todayAnnouncements}
        isAdmin={isAdmin}
        onOpenEdit={() => setShowAnnouncementEdit(true)}
        onDelete={deleteAnnouncement}
      />

      <section className="card">
        <div className="cardTitleRow">
          <h2>休暇・勤務登録</h2>
          <div className="actionButtons">
            {isAdmin && (
              <button className="softButton" type="button" onClick={() => openSaturdayEdit(form.date)}>
                土曜出勤設定
              </button>
            )}
            <button className="softButton" type="button" onClick={() => setShowStaffEdit(true)}>
              職員編集
            </button>
          </div>
        </div>

        <div className="formGrid">
          <label>
            <span>職員</span>
            <select
              value={isAdmin ? form.staffId : loginId}
              disabled={!isAdmin}
              onChange={(e) => setForm({ ...form, staffId: e.target.value })}
            >
              {activeStaff.map((s) => (
                <option key={s.id} value={s.id}>
                  {personName(s)} {s.job}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>日付</span>
            <JapaneseDateInput value={form.date} onChange={(date) => setForm({ ...form, date })} />
          </label>

          <label>
            <span>種別</span>
            <select
              value={form.type}
              onChange={(e) =>
                setForm({
                  ...form,
                  type: e.target.value,
                  method: ["paid", "child"].includes(e.target.value) ? form.method : "full",
                })
              }
            >
              {Object.entries(LEAVE_TYPES).map(([key, value]) => (
                <option key={key} value={key}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          {showMethod && (
            <label>
              <span>取得方法</span>
              <select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
                {Object.entries(METHODS).map(([key, value]) => (
                  <option key={key} value={key}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
          )}

          {showTimeInputs && (
            <>
              <label>
                <span>開始</span>
                <input type="time" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />
              </label>
              <label>
                <span>終了</span>
                <input type="time" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} />
              </label>
            </>
          )}

          <label className="wide">
            <span>メモ</span>
            <input placeholder="任意" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </label>

          {showBreakCheck && (
            <label className="checkRow wide">
              <input
                type="checkbox"
                checked={form.includeBreak}
                onChange={(e) => setForm({ ...form, includeBreak: e.target.checked })}
              />
              <span>休憩時間（12:00〜13:00）を含めて計算する</span>
            </label>
          )}
        </div>

        <div className="previewBox">{previewText()}</div>
        <button className="primaryButton" type="button" onClick={addRecord}>
          登録する
        </button>
      </section>

      <nav className="toolbar">
        <div className="viewButtons">
          <button className={view === "calendar" ? "active" : ""} onClick={() => setView("calendar")}>
            カレンダー
          </button>
          <button className={view === "summary" ? "active" : ""} onClick={() => setView("summary")}>
            集計
          </button>
        </div>

        <div className="scopeButtons" aria-label="表示切替">
          <button
            type="button"
            className={displayScope === "all" ? "active" : ""}
            onClick={() => { setDisplayScope("all"); setSelectedDate(null); }}
          >
            全体表示
          </button>
          <button
            type="button"
            className={displayScope === "mine" ? "active" : ""}
            onClick={() => { setDisplayScope("mine"); setSelectedDate(null); }}
          >
            自分の予定
          </button>
        </div>

        <div className="monthNav">
          <button onClick={() => {
            if (month === 1) { setYear(year - 1); setMonth(12); } else setMonth(month - 1);
            setSelectedDate(null);
          }}>前月</button>
          <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} />
          <select value={month} onChange={(e) => { setMonth(Number(e.target.value)); setSelectedDate(null); }}>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>
                {m}月
              </option>
            ))}
          </select>
          <button onClick={() => {
            if (month === 12) { setYear(year + 1); setMonth(1); } else setMonth(month + 1);
            setSelectedDate(null);
          }}>翌月</button>
        </div>
      </nav>

      {view === "calendar" ? (
        <section className="calendarCard">
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
              const weekday = new Date(`${date}T00:00:00`).getDay();
              const holidayName = holidays[date];

              return (
                <button
                  key={date}
                  type="button"
                  onClick={() => toggleDate(date)}
                  className={[
                    "calendarCell",
                    weekday === 0 ? "sunday" : "",
                    weekday === 6 ? "saturdayCell" : "",
                    holidayName ? "holidayCell" : "",
                    selectedDate === date ? "selected" : "",
                  ].join(" ")}
                >
                  <div className="dayHeader">
                    <span className="dayNumber">{day}</span>
                    {canShowSaturdayForDate(date) && <span className="saturdayMini">土勤</span>}
                  </div>

                  <div className="dayCounts">
                    {count.PT > 0 && <span>PT {count.PT}</span>}
                    {count.OT > 0 && <span>OT {count.OT}</span>}
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      ) : (
        <SummaryView staff={visibleStaff} summary={summary} fiscalYear={currentFy} />
      )}

      {selectedDate && (
        <div className="modalBackdrop" onClick={() => setSelectedDate(null)}>
          <div className="dayModal" onClick={(e) => e.stopPropagation()}>
            <div className="modalHeader">
              <div>
                <h2>{selectedDate.replaceAll("-", "/")}</h2>
                <span className="modalSubLabel">{displayScope === "mine" ? "自分の予定" : "全体表示"}</span>
              </div>
              <button className="closeButton" type="button" onClick={() => setSelectedDate(null)}>
                ×
              </button>
            </div>

            {selectedRecords().length === 0 && !canShowSaturdayForDate(selectedDate) && !holidays[selectedDate] ? (
              <p className="emptyText">この日の登録はありません。</p>
            ) : (
              <div className="detailList">
                {holidays[selectedDate] && (
                  <div className="detailItem holidayDetail">
                    <div>
                      <strong>祝日</strong>
                      <p>{holidays[selectedDate]}</p>
                    </div>
                  </div>
                )}

                {canShowSaturdayForDate(selectedDate) && (
                  <div className="detailItem saturdayWorkDetail">
                    <div>
                      <strong>土曜出勤</strong>
                      {saturdayScheduleForDate(selectedDate)?.isOverride && <small>この日のみ個別変更</small>}
                      {saturdayStaffForDate(selectedDate).map((person) => (
                        <p key={person.id}>{personName(person)}　{person.job}</p>
                      ))}
                      {saturdayScheduleForDate(selectedDate)?.note && <small>{saturdayScheduleForDate(selectedDate).note}</small>}
                    </div>
                    {isAdmin && (
                      <div className="detailActions">
                        <button type="button" className="softMiniButton" onClick={() => openSaturdayEdit(selectedDate)}>
                          編集
                        </button>
                        {saturdayScheduleForDate(selectedDate)?.isOverride && (
                          <button type="button" className="deleteButton" onClick={() => deleteSaturdaySchedule(selectedDate)}>
                            個別変更解除
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {selectedRecords().map((r) => (
                  <div key={r.id} className={`detailItem ${r.type}`}>
                    <div>
                      <strong>
                        {personName(r.staff)}　{r.staff.job}
                      </strong>
                      <p>{recordDisplay(r)}</p>
                      {r.note && <small>{r.note}</small>}
                    </div>
                    <button type="button" className="deleteButton" onClick={() => removeRecord(r.id, r)}>
                      削除
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {showAnnouncementEdit && isAdmin && (
        <div className="modalBackdrop" onClick={() => setShowAnnouncementEdit(false)}>
          <form className="announcementModal" onClick={(e) => e.stopPropagation()} onSubmit={saveAnnouncement}>
            <div className="modalHeader">
              <h2>掲示板登録</h2>
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

      {showSaturdayEdit && isAdmin && (
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

            <section className="groupSettings">
              <h3>ローテーション開始設定</h3>
              <p className="settingHelp">開始日と開始グループを設定すると、その土曜日からA→B→C→Dの順に月をまたいで自動で回ります。</p>
              <div className="rotationSettingRow">
                <label>
                  <span>開始日</span>
                  <JapaneseDateInput
                    value={saturdayRotation.startDate}
                    onChange={(startDate) => setSaturdayRotation((prev) => ({ ...prev, startDate }))}
                  />
                </label>
                <label>
                  <span>開始グループ</span>
                  <select
                    value={saturdayRotation.startGroup}
                    onChange={(e) => setSaturdayRotation((prev) => ({ ...prev, startGroup: e.target.value }))}
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
                      {activeStaff.map((s) => (
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

            <section className="saturdayOverrideBox">
              <h3>その日だけ変更</h3>
              <p className="settingHelp">交換や1名のみの変更がある場合は、対象日の最終的な出勤者にチェックを入れて保存します。</p>
              <div className="saturdayForm">
                <label>
                  <span>対象日</span>
                  <JapaneseDateInput
                    value={saturdayForm.date}
                    onChange={(date) => {
                      const existing = saturdayScheduleForDate(date);
                      setSaturdayForm({
                        date,
                        staffIds: existing?.staffIds || [],
                        note: existing?.note || "",
                      });
                    }}
                  />
                </label>

                <label>
                  <span>メモ</span>
                  <input
                    value={saturdayForm.note}
                    onChange={(e) => setSaturdayForm({ ...saturdayForm, note: e.target.value })}
                    placeholder="例：山田→田中へ交換"
                  />
                </label>

                <div className="saturdayStaffSelect">
                  <span>この日の出勤者</span>
                  <div className="staffCheckGrid">
                    {activeStaff.map((s) => (
                      <label key={s.id} className="staffCheckItem">
                        <input
                          type="checkbox"
                          checked={saturdayForm.staffIds.includes(s.id)}
                          onChange={() => toggleSaturdayStaff(s.id)}
                        />
                        <span>{personName(s)}　{s.job}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <div className="previewBox">
                基本：{saturdayBaseGroupKeyForDate(saturdayForm.date) || "土曜日ではありません"}
                {saturdayOverrideForDate(saturdayForm.date) ? " ／ 個別変更あり" : " ／ 個別変更なし"}
              </div>

              <div className="overrideActions">
                <button className="primaryButton" type="submit">この日の変更を保存</button>
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
                    <option value="admin">科長</option>
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
        </>
      )}
    </div>
  );
}


const PM_PROFESSIONS = ["PT", "OT"];


const PM_DEPARTMENTS = [
  { key: "outpatient", label: "外来", short: "外来" },
  { key: "ortho", label: "整形", short: "整" },
  { key: "neuroSurgery", label: "脳外", short: "脳外" },
  { key: "respSurgery", label: "呼吸器外科", short: "呼外" },
  { key: "surgery", label: "外科", short: "外" },
  { key: "cancer", label: "がん", short: "がん" },
  { key: "neuroInternal", label: "脳神経内科", short: "神内" },
  {
    key: "internal",
    label: "内科",
    short: "内",
    info: "消化器・循環器・内分泌・腎臓・呼吸器",
  },
  { key: "urology", label: "泌尿器", short: "泌" },
  { key: "ent", label: "耳鼻科", short: "耳" },
  { key: "stopped", label: "中止", short: "中止" },
];


const PM_MOVE_TYPES = [
  { key: "discharge", label: "退院", short: "退" },
  { key: "recovery", label: "回復期", short: "3W" },
  { key: "community", label: "地域包括", short: "5W" },
  { key: "transfer", label: "転院", short: "転" },
];

const PM_EMPTY_COUNTS = Object.fromEntries(PM_DEPARTMENTS.map((d) => [d.key, 0]));

const PM_SAMPLE_STAFF = [
  {
    id: "pt1",
    profession: "PT",
    type: "main",
    canCancerRehab: true,
    lastName: "山田",
    firstName: "太郎",
    order: 1,
    counts: { ...PM_EMPTY_COUNTS, outpatient: 5, ortho: 3, neuroSurgery: 1, cancer: 1, neuroInternal: 1, internal: 5 },
    note: "13単位1名（内）",
  },
  {
    id: "pt2",
    profession: "PT",
    type: "main",
    canCancerRehab: false,
    lastName: "田中",
    firstName: "美咲",
    order: 2,
    counts: { ...PM_EMPTY_COUNTS, outpatient: 5, ortho: 2, surgery: 1, cancer: 1, neuroInternal: 1, internal: 5 },
    note: "",
  },
  {
    id: "pt3",
    profession: "PT",
    type: "main",
    canCancerRehab: true,
    lastName: "佐藤",
    firstName: "健",
    order: 3,
    counts: { ...PM_EMPTY_COUNTS, outpatient: 5, ortho: 3, neuroSurgery: 1, neuroInternal: 2, internal: 5 },
    note: "",
  },
  {
    id: "pt4",
    profession: "PT",
    type: "main",
    canCancerRehab: false,
    lastName: "高橋",
    firstName: "優",
    order: 4,
    counts: { ...PM_EMPTY_COUNTS, outpatient: 2, ortho: 2, neuroSurgery: 1, neuroInternal: 2, internal: 6 },
    note: "6/6退 脳内、6/7退 整",
  },
  {
    id: "ot1",
    profession: "OT",
    type: "main",
    canCancerRehab: true,
    lastName: "吉田",
    firstName: "彩",
    order: 1,
    counts: { ...PM_EMPTY_COUNTS, ortho: 4, neuroSurgery: 1, internal: 3 },
    note: "",
  },
  {
    id: "ot2",
    profession: "OT",
    type: "main",
    canCancerRehab: false,
    lastName: "伊藤",
    firstName: "翔",
    order: 2,
    counts: { ...PM_EMPTY_COUNTS, ortho: 3, cancer: 1, internal: 4 },
    note: "",
  },
];

function pmPad(value) {
  return String(value).padStart(2, "0");
}

function pmTodayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${pmPad(d.getMonth() + 1)}-${pmPad(d.getDate())}`;
}

function pmFiscalYear(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  return d.getMonth() + 1 >= 4 ? d.getFullYear() : d.getFullYear() - 1;
}

function pmPersonName(staff) {
  return `${staff.lastName || ""} ${staff.firstName || ""}`.trim() || "未設定";
}

function pmDepartmentShort(key) {
  return PM_DEPARTMENTS.find((item) => item.key === key)?.short || key;
}

function pmMoveShort(key) {
  return PM_MOVE_TYPES.find((item) => item.key === key)?.short || key;
}

function pmMoveLabel(key) {
  return PM_MOVE_TYPES.find((item) => item.key === key)?.label || key;
}

function pmDisplayDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(`${dateStr}T00:00:00`);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function pmNormalizeStaff(staff, index = 0) {
  return {
    id: staff.id || crypto.randomUUID(),
    profession: staff.profession || "PT",
    type: staff.type || "main",
    canCancerRehab: Boolean(staff.canCancerRehab),
    lastName: staff.lastName || "",
    firstName: staff.firstName || "",
    order: Number(staff.order || index + 1),
    counts: { ...PM_EMPTY_COUNTS, ...(staff.counts || {}) },
    note: staff.note || "",
  };
}

function pmCountTotal(staff) {
  return PM_DEPARTMENTS.filter((dept) => dept.key !== "stopped" && dept.key !== "outpatient").reduce(
    (sum, dept) => sum + Number(staff.counts?.[dept.key] || 0),
    0
  );
}

function pmIsDue(movement) {
  return !movement.done && String(movement.date || "") <= pmTodayKey();
}

function PMJapaneseDateInput({ value, onChange }) {
  const selectedDate = value ? new Date(`${value}T00:00:00`) : new Date();
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(selectedDate.getFullYear());
  const [month, setMonth] = useState(selectedDate.getMonth() + 1);

  useEffect(() => {
    if (!value) return;
    const d = new Date(`${value}T00:00:00`);
    if (Number.isNaN(d.getTime())) return;
    setYear(d.getFullYear());
    setMonth(d.getMonth() + 1);
  }, [value]);

  const firstDay = new Date(year, month - 1, 1).getDay();
  const days = new Date(year, month, 0).getDate();
  const cells = [
    ...Array.from({ length: firstDay }, () => null),
    ...Array.from({ length: days }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  function moveMonth(diff) {
    let nextMonth = month + diff;
    let nextYear = year;
    if (nextMonth < 1) {
      nextMonth = 12;
      nextYear -= 1;
    }
    if (nextMonth > 12) {
      nextMonth = 1;
      nextYear += 1;
    }
    setMonth(nextMonth);
    setYear(nextYear);
  }

  function choose(day) {
    onChange(`${year}-${pmPad(month)}-${pmPad(day)}`);
    setOpen(false);
  }

  return (
    <div className="jpDateWrap">
      <button type="button" className="jpDateButton" onClick={() => setOpen((prev) => !prev)}>
        <span>{value ? value.replaceAll("-", "/") : "日付選択"}</span>
        <span>📅</span>
      </button>

      {open && (
        <div className="jpCalendar">
          <div className="jpCalHeader">
            <button type="button" onClick={() => moveMonth(-1)}>前月</button>
            <strong>{year}年{month}月</strong>
            <button type="button" onClick={() => moveMonth(1)}>翌月</button>
          </div>

          <div className="jpWeek">
            {["日", "月", "火", "水", "木", "金", "土"].map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>

          <div className="jpDays">
            {cells.map((day, index) => {
              if (!day) return <span key={`empty-${index}`} />;
              const key = `${year}-${pmPad(month)}-${pmPad(day)}`;
              const weekday = new Date(`${key}T00:00:00`).getDay();

              return (
                <button
                  key={key}
                  type="button"
                  className={[
                    value === key ? "selected" : "",
                    weekday === 0 ? "sun" : "",
                    weekday === 6 ? "sat" : "",
                  ].join(" ")}
                  onClick={() => choose(day)}
                >
                  {day}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            className="todayButton"
            onClick={() => {
              onChange(pmTodayKey());
              setOpen(false);
            }}
          >
            今日
          </button>
        </div>
      )}
    </div>
  );
}

function FullPatientManager({ loginUser }) {
  const [profession, setProfession] = useState(loginUser?.job || "PT");
  const [view, setView] = useState("table");

  useEffect(() => {
    if (loginUser?.job) setProfession(loginUser.job);
  }, [loginUser?.id, loginUser?.job]);
  const [fullTable, setFullTable] = useState(false);
  const [staff, setStaff] = useState(() => {
    const saved = localStorage.getItem("integratedAssignmentTableStaffV1");
    return saved ? JSON.parse(saved).map(pmNormalizeStaff) : PM_SAMPLE_STAFF.map(pmNormalizeStaff);
  });
  const [movements, setMovements] = useState(() => {
    const saved = localStorage.getItem("integratedAssignmentTableMovementsV1");
    return saved ? JSON.parse(saved) : [];
  });
  const [history, setHistory] = useState(() => {
    const saved = localStorage.getItem("integratedAssignmentTableHistoryV1");
    return saved ? JSON.parse(saved) : [];
  });
  const [recentChanges, setRecentChanges] = useState(() => {
    const saved = localStorage.getItem("integratedAssignmentTableRecentChangesV1");
    return saved ? JSON.parse(saved) : {};
  });
  const [activeCell, setActiveCell] = useState(null);
  const [editMovement, setEditMovement] = useState(null);
  const [fiscalSnapshots, setFiscalSnapshots] = useState(() => {
    const saved = localStorage.getItem("integratedAssignmentTableFiscalSnapshotsV1");
    return saved ? JSON.parse(saved) : {};
  });
  const [selectedFiscal, setSelectedFiscal] = useState(null); // null = 今年度
  const today = new Date();
  const [calendarYear, setCalendarYear] = useState(today.getFullYear());
  const [calendarMonth, setCalendarMonth] = useState(today.getMonth() + 1);

  const [movementForm, setMovementForm] = useState({
    staffId: "",
    date: pmTodayKey(),
    moveType: "discharge",
    department: "ortho",
    note: "",
  });

  const [staffForm, setStaffForm] = useState({
    lastName: "",
    firstName: "",
    profession: "PT",
    canCancerRehab: false,
  });

  useEffect(() => {
    localStorage.setItem("integratedAssignmentTableStaffV1", JSON.stringify(staff));
  }, [staff]);

  useEffect(() => {
    localStorage.setItem("integratedAssignmentTableMovementsV1", JSON.stringify(movements));
  }, [movements]);

  useEffect(() => {
    localStorage.setItem("integratedAssignmentTableHistoryV1", JSON.stringify(history));
  }, [history]);

  useEffect(() => {
    localStorage.setItem("integratedAssignmentTableRecentChangesV1", JSON.stringify(recentChanges));
  }, [recentChanges]);

  useEffect(() => {
    localStorage.setItem("integratedAssignmentTableFiscalSnapshotsV1", JSON.stringify(fiscalSnapshots));
  }, [fiscalSnapshots]);

  useEffect(() => {
    applyDueMovements();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visibleStaff = useMemo(() => {
    return staff
      .filter((person) => person.profession === profession)
      .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  }, [staff, profession]);

  const pendingMovements = useMemo(() => {
    return movements
      .filter((movement) => !movement.done)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }, [movements]);

  const visibleHistory = useMemo(() => {
    return history
      .filter((item) => item.profession === profession)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.createdAt).localeCompare(String(a.createdAt)));
  }, [history, profession]);

  const fiscal = pmFiscalYear(pmTodayKey());
  const tableDensity = visibleStaff.length >= 14 ? "dense3" : visibleStaff.length >= 10 ? "dense2" : "dense1";

  function staffOptionsForDepartment(department) {
    const base = staff.filter((person) => person.profession === profession);
    if (department === "cancer") {
      return base.filter((person) => person.canCancerRehab);
    }
    return base;
  }

  const movementStaffOptions = staffOptionsForDepartment(movementForm.department);

  useEffect(() => {
    if (!movementStaffOptions.some((person) => person.id === movementForm.staffId)) {
      setMovementForm((prev) => ({ ...prev, staffId: movementStaffOptions[0]?.id || "" }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profession, movementForm.department, staff.length]);

  function isChangedToday(staffId, department) {
    return recentChanges[`${staffId}:${department}`] === pmTodayKey();
  }

  function markChanged(staffId, department) {
    setRecentChanges((prev) => ({
      ...prev,
      [`${staffId}:${department}`]: pmTodayKey(),
    }));
  }

  function updateCount(staffId, department, value) {
    const nextValue = Math.max(0, Number(value || 0));

    setStaff((prev) =>
      prev.map((person) => {
        if (person.id !== staffId) return person;
        return {
          ...person,
          counts: {
            ...person.counts,
            [department]: nextValue,
          },
        };
      })
    );

    markChanged(staffId, department);
  }

  function addHistory(entry) {
    setHistory((prev) => [
      {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        pmFiscalYear: pmFiscalYear(entry.date || pmTodayKey()),
        ...entry,
      },
      ...prev,
    ]);
  }

  function registerMovement(e) {
    e.preventDefault();
    const targetStaff = staff.find((person) => person.id === movementForm.staffId);
    if (!targetStaff) {
      alert("担当者を選択してください。");
      return;
    }

    setMovements((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        ...movementForm,
        profession: targetStaff.profession,
        staffName: pmPersonName(targetStaff),
        done: false,
        createdAt: new Date().toISOString(),
      },
    ]);

    setMovementForm((prev) => ({ ...prev, note: "" }));
  }

  function applyDueMovements() {
    const due = movements.filter(pmIsDue);
    if (due.length === 0) return;

    setStaff((prev) => {
      let nextStaff = prev;
      due.forEach((movement) => {
        nextStaff = nextStaff.map((person) => {
          if (person.id !== movement.staffId) return person;
          return {
            ...person,
            counts: {
              ...person.counts,
              [movement.department]: Math.max(0, Number(person.counts?.[movement.department] || 0) - 1),
            },
          };
        });
      });
      return nextStaff;
    });

    const changed = {};
    due.forEach((movement) => {
      changed[`${movement.staffId}:${movement.department}`] = pmTodayKey();
    });
    setRecentChanges((prev) => ({ ...prev, ...changed }));

    setHistory((prev) => [
      ...due.map((movement) => ({
        id: crypto.randomUUID(),
        date: movement.date,
        createdAt: new Date().toISOString(),
        pmFiscalYear: pmFiscalYear(movement.date),
        profession: movement.profession,
        staffId: movement.staffId,
        staffName: movement.staffName,
        action: pmMoveShort(movement.moveType),
        moveType: movement.moveType,
        department: movement.department,
        pmDepartmentShort: pmDepartmentShort(movement.department),
        delta: -1,
        amount: 1,
        note: movement.note || "",
      })),
      ...prev,
    ]);

    setMovements((prev) => prev.filter((movement) => !due.some((d) => d.id === movement.id)));
  }

  function deleteMovement(id) {
    if (!confirm("この患者移動を削除しますか？")) return;
    setMovements((prev) => prev.filter((movement) => movement.id !== id));
  }

  function updateMovement(updated) {
    setMovements((prev) => prev.map((m) => m.id === updated.id ? { ...m, ...updated } : m));
    setEditMovement(null);
  }

  function saveFiscalSnapshot() {
    const fy = fiscal;
    const snapshot = {};
    staff.filter(p => p.profession === profession).forEach(person => {
      const stats = annualStats(person.id);
      snapshot[person.id] = {
        name: pmPersonName(person),
        counts: { ...stats.byDepartment },
        total: stats.newCount,
        byMoveType: { ...stats.byMoveType },
      };
    });
    setFiscalSnapshots(prev => ({ ...prev, [`${fy}_${profession}`]: { fiscal: fy, profession, snapshot, savedAt: pmTodayKey() } }));
    alert(`${fy}年度（${profession}）のデータを保存しました。`);
  }

  function addStaff(e) {
    e.preventDefault();

    if (!staffForm.lastName.trim() || !staffForm.firstName.trim()) {
      alert("姓・名を入力してください。");
      return;
    }

    const maxOrder = Math.max(
      0,
      ...staff.filter((person) => person.profession === staffForm.profession).map((person) => Number(person.order || 0))
    );

    setStaff((prev) => [
      ...prev,
      pmNormalizeStaff({
        ...staffForm,
        id: crypto.randomUUID(),
        order: maxOrder + 1,
      }),
    ]);

    setStaffForm({ lastName: "", firstName: "", profession, canCancerRehab: false });
  }

  function deleteStaff(id) {
    if (!confirm("担当者を削除しますか？履歴は残ります。")) return;
    setStaff((prev) => prev.filter((person) => person.id !== id));
    setMovements((prev) => prev.filter((movement) => movement.staffId !== id));
  }

  function updateNote(staffId, note) {
    setStaff((prev) => prev.map((person) => (person.id === staffId ? { ...person, note } : person)));
  }

  function moveStaffOrder(id, direction) {
    const list = visibleStaff;
    const index = list.findIndex((person) => person.id === id);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= list.length) return;

    const a = list[index];
    const b = list[targetIndex];

    setStaff((prev) =>
      prev.map((person) => {
        if (person.id === a.id) return { ...person, order: b.order };
        if (person.id === b.id) return { ...person, order: a.order };
        return person;
      })
    );
  }

  function staffMovements(staffId) {
    return pendingMovements.filter((movement) => movement.staffId === staffId);
  }

  function movementsForStaffDisplay(staffId) {
    return staffMovements(staffId).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }

  function netHistoryItemsForFiscal(staffId) {
    const map = new Map();

    history
      .filter((item) => item.staffId === staffId && item.pmFiscalYear === fiscal)
      .forEach((item) => {
        const date = item.date || "";
        const department = item.department || "";
        const moveType = item.moveType || "";
        const action = item.action || "";

        const key = moveType
          ? `${date}:${department}:move:${moveType}`
          : `${date}:${department}:manual:${action === "新規" || action === "減算" ? "adjust" : action}`;

        const current = map.get(key) || {
          ...item,
          delta: 0,
          amount: 0,
        };

        const delta = Number(item.delta || 0);
        current.delta += delta;
        current.amount += Math.abs(delta || Number(item.amount || 0));
        map.set(key, current);
      });

    return Array.from(map.values()).map((item) => ({
      ...item,
      amount: Math.abs(Number(item.delta || 0)),
    }));
  }

  function annualStats(staffId) {
    const person = staff.find((item) => item.id === staffId);
    const currentCounts = person?.counts || {};
    const list = netHistoryItemsForFiscal(staffId);

    const byDepartment = Object.fromEntries(
      PM_DEPARTMENTS.map((dept) => [
        dept.key,
        list
          .filter((item) => item.department === dept.key)
          .reduce((sum, item) => sum + Math.abs(Number(item.delta || 0)), 0),
      ])
    );

    const byMoveType = Object.fromEntries(
      PM_MOVE_TYPES.map((move) => [
        move.key,
        list
          .filter((item) => item.moveType === move.key)
          .reduce((sum, item) => sum + Math.abs(Number(item.delta || 0)), 0),
      ])
    );

    const currentTotal = PM_DEPARTMENTS
      .filter((dept) => dept.key !== "stopped" && dept.key !== "outpatient")
      .reduce((sum, dept) => sum + Number(currentCounts?.[dept.key] || 0), 0);

    const newCount = list
      .filter((item) => item.action === "新規")
      .reduce((sum, item) => sum + Math.abs(Number(item.delta || 0)), 0);

    const outCount = list
      .filter((item) => Number(item.delta || 0) < 0)
      .reduce((sum, item) => sum + Math.abs(Number(item.delta || 0)), 0);

    return {
      byDepartment,
      byMoveType,
      currentCounts,
      currentTotal,
      newCount,
      outCount,
    };
  }

  function quickAdjust(staffId, department, diff) {
    const target = staff.find((person) => person.id === staffId);
    if (!target) return;
    const current = Number(target.counts?.[department] || 0);
    const next = Math.max(0, current + diff);

    updateCount(staffId, department, next);

    addHistory({
      date: pmTodayKey(),
      profession: target.profession,
      staffId,
      staffName: pmPersonName(target),
      action: diff > 0 ? "新規" : "減算",
      department,
      pmDepartmentShort: pmDepartmentShort(department),
      delta: diff,
      amount: Math.abs(diff),
    });
  }

  const table = (
    <PMAssignmentTable
      staffList={visibleStaff}
      pendingMovements={pendingMovements}
      tableDensity={tableDensity}
      isChangedToday={isChangedToday}
      updateCount={updateCount}
      updateNote={updateNote}
      movementsForStaffDisplay={movementsForStaffDisplay}
      quickAdjust={quickAdjust}
      activeCell={activeCell}
      setActiveCell={setActiveCell}
      onEditMovement={setEditMovement}
      sectionActions={!fullTable && (
        <>
          <button className={view === "calendar" ? "active" : ""} onClick={() => setView("calendar")}>📅 カレンダー</button>
          <button className="tabExpandBtn" type="button" onClick={() => setFullTable(true)}>⛶ 拡大表示</button>
        </>
      )}
    />
  );

  return (
    <div className="patientModule appShell">
      <header className="appHeader">
        <div className="headerTitleRow">
          <h1>患者人数管理</h1>

          <div className="professionTabs">
            {PM_PROFESSIONS.map((item) => (
              <button key={item} className={profession === item ? "active" : ""} onClick={() => setProfession(item)}>
                {item}
              </button>
            ))}
          </div>
        </div>
      </header>

      <nav className="viewTabs">
        <button className={view === "table" ? "active" : ""} onClick={() => setView("table")}>管理表</button>
        <button className={view === "move" ? "active" : ""} onClick={() => setView("move")}>患者移動</button>
        <button className={view === "history" ? "active" : ""} onClick={() => setView("history")}>履歴・年間</button>
        <button className={view === "settings" ? "active" : ""} onClick={() => setView("settings")}>設定</button>
      </nav>

      {view === "table" && (
        <>
          {table}
        </>
      )}

      {fullTable && (
        <div className="tableFullscreen">
          <div className="fullscreenHeader">
            <div>
              <strong>{profession} 管理表</strong>
              <span>横向き表示推奨・横スクロールのみ</span>
            </div>
            <button type="button" onClick={() => setFullTable(false)}>閉じる</button>
          </div>

          <div className="fullscreenTableWrap">
            {table}
          </div>
        </div>
      )}

      {view === "move" && (
        <section className="card">
          <div className="cardHeader">
            <h2>患者移動</h2>
            <button className="softButton" type="button" onClick={applyDueMovements}>
              本日分を反映
            </button>
          </div>

          <form className="moveForm" onSubmit={registerMovement}>
            <label>
              <span>移動日</span>
              <PMJapaneseDateInput value={movementForm.date} onChange={(date) => setMovementForm({ ...movementForm, date })} />
            </label>

            <label>
              <span>種類</span>
              <select value={movementForm.moveType} onChange={(e) => setMovementForm({ ...movementForm, moveType: e.target.value })}>
                {PM_MOVE_TYPES.map((item) => (
                  <option key={item.key} value={item.key}>{item.label}</option>
                ))}
              </select>
            </label>

            <label>
              <span>科</span>
              <select value={movementForm.department} onChange={(e) => setMovementForm({ ...movementForm, department: e.target.value })}>
                {PM_DEPARTMENTS.filter((dept) => dept.key !== "stopped").map((dept) => (
                  <option key={dept.key} value={dept.key}>{dept.label}</option>
                ))}
              </select>
            </label>

            <label>
              <span>担当者</span>
              <select value={movementForm.staffId} onChange={(e) => setMovementForm({ ...movementForm, staffId: e.target.value })}>
                {movementStaffOptions.map((person) => (
                  <option key={person.id} value={person.id}>
                    {pmPersonName(person)}
                  </option>
                ))}
              </select>
            </label>

            <label className="wide">
              <span>メモ</span>
              <input value={movementForm.note} onChange={(e) => setMovementForm({ ...movementForm, note: e.target.value })} />
            </label>

            <button className="primaryButton" type="submit">登録</button>
          </form>

          <div className="movementList">
            {pendingMovements.filter((movement) => movement.profession === profession).length === 0 ? (
              <p className="emptyText">登録中の患者移動はありません。</p>
            ) : (
              visibleStaff
                .map((person) => {
                  const personMovements = pendingMovements.filter(
                    (m) => m.profession === profession && m.staffId === person.id
                  );
                  if (personMovements.length === 0) return null;
                  return (
                    <div className="movementCard" key={person.id}>
                      <div className="movementCardHeader">{pmPersonName(person)}</div>
                      {personMovements.map((movement) => (
                        <div className="movementItem" key={movement.id}>
                          <strong>{pmDisplayDate(movement.date)} {pmDepartmentShort(movement.department)} {pmMoveShort(movement.moveType)}</strong>
                          {movement.note && <small>{movement.note}</small>}
                          <div className="movementItemActions">
                            <button className="editButton" type="button" onClick={() => setEditMovement({ ...movement })}>編集</button>
                            <button className="deleteButton" type="button" onClick={() => deleteMovement(movement.id)}>削除</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })
            )}
          </div>
        </section>
      )}

      {view === "history" && (
        <section className="card">
          <div className="cardHeader">
            <h2>履歴・年間集計</h2>
            <button className="softButton" type="button" onClick={saveFiscalSnapshot}>今年度を保存</button>
          </div>

          <div className="fiscalSelector">
            <button
              className={`fiscalBtn ${selectedFiscal === null ? "active" : ""}`}
              onClick={() => setSelectedFiscal(null)}
            >{fiscal}年度（今年度）</button>
            {Object.values(fiscalSnapshots)
              .filter(s => s.profession === profession)
              .sort((a, b) => b.fiscal - a.fiscal)
              .map(s => (
                <button
                  key={s.fiscal}
                  className={`fiscalBtn ${selectedFiscal === s.fiscal ? "active" : ""}`}
                  onClick={() => setSelectedFiscal(s.fiscal)}
                >{s.fiscal}年度</button>
              ))
            }
          </div>

          <div className="annualTableWrap">
            <table className="annualTable annualWideTable">
              <thead>
                <tr>
                  <th>氏名</th>
                  <th>外来</th>
                  {PM_DEPARTMENTS.filter((dept) => dept.key !== "outpatient" && dept.key !== "stopped").map((dept) => (
                    <th key={dept.key}>{dept.short}</th>
                  ))}
                  <th>合計</th>
                  <th>退院</th>
                  <th>3W</th>
                  <th>5W</th>
                  <th>転院</th>
                </tr>
              </thead>
              <tbody>
                {selectedFiscal === null ? (
                  visibleStaff.map((person) => {
                    const stats = annualStats(person.id);
                    return (
                      <tr key={person.id}>
                        <td>{pmPersonName(person)}</td>
                        <td>{Number(stats.byDepartment.outpatient || 0)}</td>
                        {PM_DEPARTMENTS.filter((dept) => dept.key !== "outpatient" && dept.key !== "stopped").map((dept) => (
                          <td key={dept.key}>{Number(stats.byDepartment?.[dept.key] || 0)}</td>
                        ))}
                        <td className="annualTotalCell">{stats.newCount}</td>
                        <td>{stats.byMoveType.discharge || 0}</td>
                        <td>{stats.byMoveType.recovery || 0}</td>
                        <td>{stats.byMoveType.community || 0}</td>
                        <td>{stats.byMoveType.transfer || 0}</td>
                      </tr>
                    );
                  })
                ) : (() => {
                  const s = fiscalSnapshots[`${selectedFiscal}_${profession}`];
                  if (!s) return <tr><td colSpan="20">データがありません</td></tr>;
                  return Object.entries(s.snapshot).map(([id, data]) => (
                    <tr key={id}>
                      <td>{data.name}</td>
                      <td>{data.counts.outpatient || 0}</td>
                      {PM_DEPARTMENTS.filter(d => d.key !== "outpatient" && d.key !== "stopped").map(dept => (
                        <td key={dept.key}>{data.counts[dept.key] || 0}</td>
                      ))}
                      <td className="annualTotalCell">{data.total || 0}</td>
                      <td>{data.byMoveType?.discharge || 0}</td>
                      <td>{data.byMoveType?.recovery || 0}</td>
                      <td>{data.byMoveType?.community || 0}</td>
                      <td>{data.byMoveType?.transfer || 0}</td>
                    </tr>
                  ));
                })()}
              </tbody>
            </table>
          </div>

          {selectedFiscal === null && (
            <>
              <h3>履歴</h3>
              <div className="historyList">
                {visibleHistory.length === 0 ? (
                  <p className="emptyText">履歴はありません。</p>
                ) : (
                  visibleHistory.map((item) => (
                    <div className="historyItem" key={item.id}>
                      <span>{pmDisplayDate(item.date)}</span>
                      <strong>{item.staffName}</strong>
                      <span>{item.action}</span>
                      <span>{item.pmDepartmentShort}</span>
                      <span className={Number(item.delta) >= 0 ? "plus" : "minus"}>
                        {Number(item.delta) >= 0 ? "+" : ""}{item.delta}
                      </span>
                      {item.note && <small>{item.note}</small>}
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </section>
      )}

      {view === "calendar" && (
        <section className="card">
          <div className="calendarHeader">
            <button className="calNavBtn" onClick={() => {
              if (calendarMonth === 1) { setCalendarMonth(12); setCalendarYear(y => y - 1); }
              else setCalendarMonth(m => m - 1);
            }}>◀</button>
            <span className="calendarTitle">{calendarYear}年{calendarMonth}月</span>
            <button className="calNavBtn" onClick={() => {
              if (calendarMonth === 12) { setCalendarMonth(1); setCalendarYear(y => y + 1); }
              else setCalendarMonth(m => m + 1);
            }}>▶</button>
          </div>
          <div className="calendarGrid calendarLarge">
            {["日","月","火","水","木","金","土"].map(d => (
              <div key={d} className={`calDayLabel ${d === "日" ? "sun" : d === "土" ? "sat" : ""}`}>{d}</div>
            ))}
            {(() => {
              const firstDay = new Date(calendarYear, calendarMonth - 1, 1).getDay();
              const daysInMonth = new Date(calendarYear, calendarMonth, 0).getDate();
              const todayStr = pmTodayKey();
              const cells = [];
              for (let i = 0; i < firstDay; i++) cells.push(<div key={`empty-${i}`} />);
              for (let d = 1; d <= daysInMonth; d++) {
                const dow = (firstDay + d - 1) % 7;
                const dateStr = `${calendarYear}-${String(calendarMonth).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
                const isToday = dateStr === todayStr;
                const movesOnDay = pendingMovements.filter(m => m.date === dateStr && m.profession === profession);
                cells.push(
                  <div key={d} className={`calDay calDayLarge ${dow === 0 ? "sun" : dow === 6 ? "sat" : ""} ${isToday ? "today" : ""}`}>
                    <span className="calDayNum">{d}</span>
                    {movesOnDay.map(m => (
                      <span key={m.id} className={`calMoveTag move-${m.moveType}`}>
                        {m.staffName?.split(" ")[0] || ""} {pmDepartmentShort(m.department)} {pmMoveShort(m.moveType)}
                      </span>
                    ))}
                  </div>
                );
              }
              return cells;
            })()}
          </div>
        </section>
      )}

      {view === "settings" && (
        <section className="card">
          <h2>設定</h2>
          <p className="settingLead">スタッフ登録時に「がんリハ実施権」を付けると、管理表のがん列が入力可能になります。</p>

          <form className="staffForm cancerRightForm" onSubmit={addStaff}>
            <label>
              <span>姓</span>
              <input value={staffForm.lastName} onChange={(e) => setStaffForm({ ...staffForm, lastName: e.target.value })} />
            </label>
            <label>
              <span>名</span>
              <input value={staffForm.firstName} onChange={(e) => setStaffForm({ ...staffForm, firstName: e.target.value })} />
            </label>
            <label>
              <span>職種</span>
              <select value={staffForm.profession} onChange={(e) => setStaffForm({ ...staffForm, profession: e.target.value })}>
                <option value="PT">PT</option>
                <option value="OT">OT</option>
              </select>
            </label>
            <label className="checkSetting">
              <span>がんリハ実施権</span>
              <div className="checkBoxLine">
                <input
                  type="checkbox"
                  checked={staffForm.canCancerRehab}
                  onChange={(e) => setStaffForm({ ...staffForm, canCancerRehab: e.target.checked })}
                />
                <strong>可</strong>
              </div>
            </label>
            <button className="primaryButton" type="submit">追加</button>
          </form>

          <h3>{profession} 表示順</h3>
          <div className="orderList">
            {visibleStaff.map((person) => (
              <div className="orderItem" key={person.id}>
                <strong>{pmPersonName(person)}</strong>
                <span>{person.canCancerRehab ? "がんリハ可" : ""}</span>
                <div>
                  <button type="button" onClick={() => moveStaffOrder(person.id, -1)}>↑</button>
                  <button type="button" onClick={() => moveStaffOrder(person.id, 1)}>↓</button>
                  <button className="deleteButton" type="button" onClick={() => deleteStaff(person.id)}>削除</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {editMovement && (
        <div className="notePopupOverlay" onClick={() => setEditMovement(null)}>
          <div className="notePopupBox" onClick={e => e.stopPropagation()}>
            <div className="notePopupHeader">
              <span className="notePopupName">{editMovement.staffName}</span>
              <span className="notePopupLabel">患者移動の編集</span>
            </div>
            <div className="moveEditForm">
              <label>
                <span>移動日</span>
                <PMJapaneseDateInput value={editMovement.date} onChange={(date) => setEditMovement({ ...editMovement, date })} />
              </label>
              <label>
                <span>種類</span>
                <select value={editMovement.moveType} onChange={e => setEditMovement({ ...editMovement, moveType: e.target.value })}>
                  {PM_MOVE_TYPES.map((item) => (
                    <option key={item.key} value={item.key}>{item.label}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>科</span>
                <select value={editMovement.department} onChange={e => setEditMovement({ ...editMovement, department: e.target.value })}>
                  {PM_DEPARTMENTS.filter(d => d.key !== "stopped").map((dept) => (
                    <option key={dept.key} value={dept.key}>{dept.label}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>メモ</span>
                <input value={editMovement.note || ""} onChange={e => setEditMovement({ ...editMovement, note: e.target.value })} />
              </label>
            </div>
            <div className="notePopupActions">
              <button className="notePopupBtn save" onClick={() => updateMovement(editMovement)}>保存</button>
              <button className="notePopupBtn" style={{ background: "#fee2e2", color: "#dc2626" }} onClick={() => { deleteMovement(editMovement.id); setEditMovement(null); }}>削除</button>
              <button className="notePopupBtn cancel" onClick={() => setEditMovement(null)}>閉じる</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PMAssignmentTable({
  staffList,
  pendingMovements,
  tableDensity,
  isChangedToday,
  updateCount,
  updateNote,
  movementsForStaffDisplay,
  quickAdjust,
  activeCell,
  setActiveCell,
  onEditMovement,
  sectionActions,
}) {
  const [activeStaffId, activeDeptKey] = activeCell ? activeCell.split(":") : [null, null];
  const activeRowIndex = staffList.findIndex((person) => person.id === activeStaffId);
  const [notePopup, setNotePopup] = useState(null); // staffId or null
  const [noteEditMode, setNoteEditMode] = useState(false);
  const [noteEditValue, setNoteEditValue] = useState("");

  return (
    <section className={`excelTableCard ${tableDensity}`}>
      {sectionActions && (
        <div className="tableSectionTabs">
          {sectionActions}
        </div>
      )}
      <div className="excelScroll">
        <table className="assignmentTable">
          <thead>
            <tr>
              <th className="stickyName nameCol">氏名</th>
              {PM_DEPARTMENTS.map((dept) => (
                <th key={dept.key} className={`deptHead ${dept.key} sep-${dept.key} ${activeDeptKey === dept.key ? "activeDeptGuide" : ""}`}>
                  <span>{dept.short}</span>
                  {dept.key === "internal" && (
                    <button
                      type="button"
                      className="infoButton headerInfo"
                      title={dept.info}
                      onClick={() => alert(`内科に含まれる診療科\n${dept.info}`)}
                    >
                      ⓘ
                    </button>
                  )}
                </th>
              ))}
              <th className="totalCol">合計</th>
              <th className="moveCol">患者移動</th>
              <th className="noteCol">備考</th>
            </tr>
          </thead>

          <tbody>
            {staffList.map((person, rowIndex) => {
              return (
                <tr key={person.id} className={person.canCancerRehab ? "cancerRehabRow" : ""}>
                  <th className={`stickyName nameCol ${activeStaffId === person.id ? "activeNameGuide" : ""}`}>
                    <div className="nameCell">
                      <strong>{pmPersonName(person)}</strong>
                    </div>
                  </th>

                  {PM_DEPARTMENTS.map((dept) => {
                    const disabled = dept.key === "cancer" ? !person.canCancerRehab : false;
                    const value = Number(person.counts?.[dept.key] || 0);
                    const changed = isChangedToday(person.id, dept.key);
                    const cellKey = `${person.id}:${dept.key}`;
                    const isActive = activeCell === cellKey;

                    return (
                      <td
                        key={dept.key}
                        className={`numberCell dept-${dept.key} sep-${dept.key} ${activeStaffId === person.id ? "tRowGuide" : ""} ${activeDeptKey === dept.key && activeRowIndex >= 0 && rowIndex <= activeRowIndex ? "tColGuide" : ""} ${isActive ? "tActiveCell" : ""} ${person.canCancerRehab && dept.key === "cancer" ? "cancerAllowed" : ""} ${changed ? "changed" : ""} ${disabled ? "disabledCell" : ""}`}
                        onClick={() => {
                          if (!disabled) setActiveCell(isActive ? null : cellKey);
                        }}
                      >
                        {isActive && !disabled ? (
                          <div className="inlineAdjust" onClick={(e) => e.stopPropagation()}>
                            <button type="button" className="inlineBtn minus" onClick={() => quickAdjust(person.id, dept.key, -1)}>−</button>
                            <span className="inlineValue">{value}</span>
                            <button type="button" className="inlineBtn plus" onClick={() => quickAdjust(person.id, dept.key, 1)}>＋</button>
                          </div>
                        ) : (
                          <div className="plainNumberLine">
                            <input
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              value={value}
                              disabled={disabled}
                              onClick={(e) => e.stopPropagation()}
                              onFocus={() => {
                                if (!disabled) setActiveCell(cellKey);
                              }}
                              onChange={(e) => updateCount(person.id, dept.key, e.target.value.replace(/[^0-9]/g, ""))}
                            />
                          </div>
                        )}
                      </td>
                    );
                  })}

                  <td className={`totalCol totalNumber ${activeStaffId === person.id ? "tRowGuide tRowAfterCell" : ""}`}>{pmCountTotal(person)}</td>
                  <td className={`moveCol ${activeStaffId === person.id ? "tRowGuide tRowAfterCell" : ""}`}>
                    <div className="moveTagList">
                      {movementsForStaffDisplay(person.id).map((movement) => (
                        <span
                          key={movement.id}
                          className={`moveTag move-${movement.moveType}`}
                          onClick={(e) => { e.stopPropagation(); onEditMovement({ ...movement }); }}
                          style={{ cursor: "pointer" }}
                        >
                          {pmDisplayDate(movement.date)} {pmDepartmentShort(movement.department)} {pmMoveShort(movement.moveType)}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td
                    className={`noteCol ${activeStaffId === person.id ? "tRowGuide tRowAfterCell" : ""}`}
                    onClick={() => {
                      setNotePopup(person.id);
                      setNoteEditMode(false);
                      setNoteEditValue(person.note || "");
                    }}
                  >
                    <span className="notePreview">{person.note ? (person.note.length > 12 ? person.note.slice(0, 12) + "…" : person.note) : <span className="notePlaceholder">任意</span>}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {staffList.length === 0 && <p className="emptyText">設定から担当者を追加してください。</p>}

      {notePopup && (() => {
        const person = staffList.find(p => p.id === notePopup);
        if (!person) return null;
        return (
          <div className="notePopupOverlay" onClick={() => { setNotePopup(null); setNoteEditMode(false); }}>
            <div className="notePopupBox" onClick={e => e.stopPropagation()}>
              <div className="notePopupHeader">
                <span className="notePopupName">{pmPersonName(person)}</span>
                <span className="notePopupLabel">備考</span>
              </div>
              {noteEditMode ? (
                <>
                  <textarea
                    className="notePopupTextarea"
                    value={noteEditValue}
                    onChange={e => setNoteEditValue(e.target.value)}
                    autoFocus
                    rows={4}
                  />
                  <div className="notePopupActions">
                    <button className="notePopupBtn save" onClick={() => {
                      updateNote(person.id, noteEditValue);
                      setNoteEditMode(false);
                    }}>保存</button>
                    <button className="notePopupBtn cancel" onClick={() => setNoteEditMode(false)}>キャンセル</button>
                  </div>
                </>
              ) : (
                <>
                  <div className="notePopupContent">{person.note || <span className="notePlaceholder">（未入力）</span>}</div>
                  <div className="notePopupActions">
                    <button className="notePopupBtn edit" onClick={() => { setNoteEditMode(true); setNoteEditValue(person.note || ""); }}>編集</button>
                    <button className="notePopupBtn cancel" onClick={() => setNotePopup(null)}>閉じる</button>
                  </div>
                </>
              )}
            </div>
          </div>
        );
      })()}
    </section>);
}


function AnnouncementBoard({ announcements, isAdmin, onOpenEdit, onDelete }) {
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
        <div className="announcementList compactList">
          {shown.map((item) => (
            <div className={`announcementItem compactItem ${item.priority === "important" ? "important" : ""}`} key={`${item.id}-${item.occurrenceDate}`}>
              <span className="announcementTitle">
                {item.priority === "important" ? "🔴 " : "⚪ "}
                {item.time ? `${item.time}　` : ""}{item.title}
              </span>
              {isAdmin && (
                <button className="deleteButton small compactDelete" type="button" onClick={() => onDelete(item.id)}>
                  削除
                </button>
              )}
            </div>
          ))}
        </div>
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
