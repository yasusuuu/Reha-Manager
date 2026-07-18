import React, { useEffect, useMemo, useRef, useState } from "react";
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
  paid: "有休",
  child: "看護休暇",
  summer: "夏季休暇",
  compensatory: "代休",
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

const HOLIDAY_WORK_METHODS = {
  full: "終日勤務",
  morning: "午前勤務",
  afternoon: "午後勤務",
};

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

const ANNOUNCEMENT_TYPES = {
  single: "単発",
  weekly: "毎週",
  monthlyNth: "毎月第◯曜日",
};

const SATURDAY_GROUP_KEYS = ["A", "B", "C", "D"];
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

  if (record.type === "holiday") {
    if (record.method === "morning") return "日祝勤務（午前）";
    if (record.method === "afternoon") return "日祝勤務（午後）";
    return "日祝勤務（終日）";
  }

  return LEAVE_TYPES[record.type] || "";
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
  const [appSection, setAppSection] = useState("leave");
  const [patientProfession, setPatientProfession] = useState("PT");
  const [displayScope, setDisplayScope] = useState("all");
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [selectedDate, setSelectedDate] = useState(null);
  const [showStaffEdit, setShowStaffEdit] = useState(false);
  const [showAnnouncementEdit, setShowAnnouncementEdit] = useState(false);
  const [showSaturdayEdit, setShowSaturdayEdit] = useState(false);
  const [showLeaveForm, setShowLeaveForm] = useState(false);
  const [recordSubmitting, setRecordSubmitting] = useState(false);
  const [showSaturdayGroupSettings, setShowSaturdayGroupSettings] = useState(false);
  const [swapTargetStaffId, setSwapTargetStaffId] = useState(null);
  const [swapCandidateDate, setSwapCandidateDate] = useState(null);
  const [swapCandidateStaffIds, setSwapCandidateStaffIds] = useState([]);
  const [showSaturdaySwapHelp, setShowSaturdaySwapHelp] = useState(false);

  const [form, setForm] = useState({
    staffId: staff[0]?.id || "s1",
    date: `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`,
    type: "paid",
    method: "full",
    start: "08:30",
    end: "17:15",
    deductBreak: false,
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
    // Firestoreから読み込めた実スタッフだけを保存する。初期空配列やデモスタッフは保存しない。
    if (!staffLoaded || staff.length === 0) return;
    localStorage.setItem("leaveStaffV4", JSON.stringify(staff));
  }, [staff, staffLoaded]);

useEffect(() => {
  const unsubscribe = onSnapshot(doc(db, "settings", "saturdayDuty"), (snapshot) => {
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
    if (loginUser?.job) setPatientProfession(loginUser.job);
  }, [loginUser?.id, loginUser?.job]);

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
        staffIds: pruneSaturdayStaffIds(override.staffIds),
        note: override.note || "",
        isOverride: true,
      };
    }

    return {
      date,
      groupKey,
      staffIds: pruneSaturdayStaffIds(saturdayGroups[groupKey]),
      note: "",
      isOverride: false,
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

  function saturdayBaseStaffForDate(date) {
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

  function countByJob(date) {
    const list = leaveRecordsForDate(date);
    return {
      PT: list.filter((r) => r.staff.job === "PT").length,
      OT: list.filter((r) => r.staff.job === "OT").length,
      total: list.length,
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
    const sameDay = records.filter((r) => r.staffId === nextRecord.staffId && r.date === nextRecord.date);
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

    if (sameDay.some((r) => isFullDayRecord(r))) {
      return "この日は既に終日の休暇が登録されています。";
    }

    if (nextIsFull && sameDay.some((r) => isLeaveLike(r))) {
      return "同日に既に休暇があるため、終日の休暇は登録できません。";
    }

    if (["paid", "child"].includes(nextRecord.type) && nextRecord.method === "time") {
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
        return "時間休は8:30〜17:15の範囲で入力してください。";
      }

      if (endMinutes <= startMinutes) {
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

  async function addRecord() {
    if (recordSubmitting) return;
    setRecordSubmitting(true);

    let nextRecord = {
      ...form,
      id: makeId(),
      createdAt: Date.now(),
    };

    const validStaffIds = new Set(activeStaff.map((person) => person.id));

if (!isAdmin || !validStaffIds.has(nextRecord.staffId)) {
  nextRecord.staffId = loginUser?.id || activeStaff[0]?.id || "";
}

if (!nextRecord.staffId) {
  alert("職員を選択してください。");
  setRecordSubmitting(false);
  return;
}

    if (!["paid", "child", "holiday"].includes(nextRecord.type)) {
      nextRecord.method = "full";
    }

    if (nextRecord.type === "holiday" && nextRecord.method === "time") {
      nextRecord.method = "full";
    }

    const error = validateRecord(nextRecord);

    if (error) {
      alert(error);
      setRecordSubmitting(false);
      return;
    }

try {
  const { id, ...recordData } = nextRecord;
  const docRef = await addDoc(collection(db, "leaveRecords"), {
    ...recordData,
    createdBy: loginUser?.id || "",
    createdByName: loginUser ? personName(loginUser) : "",
  });

  setRecords((prev) => {
    if (prev.some((item) => item.id === docRef.id)) return prev;
    return [...prev, { id: docRef.id, ...recordData, createdBy: loginUser?.id || "", createdByName: loginUser ? personName(loginUser) : "" }]
      .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
  });
} catch (error) {
  const code = error?.code || "unknown";
  const message = error?.message || "unknown";
  console.error("Leave record add failed", { code, message, error });
  alert(`休暇・勤務登録に失敗しました。
code: ${code}
message: ${message}`);
  setRecordSubmitting(false);
  return;
}
setSelectedDate(nextRecord.date);
setForm((prev) => ({ ...prev, note: "" }));
setRecordSubmitting(false);
}

  async function removeRecord(id, record) {
    if (!isAdmin && record.staffId !== loginId) {
      alert("自分の登録以外は削除できません。");
      return;
    }

    if (!confirm("削除しますか？")) return;

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

  function previewText() {
    if (form.type === "holiday") {
      if (form.method === "morning") return "日祝勤務（午前）として登録";
      if (form.method === "afternoon") return "日祝勤務（午後）として登録";
      return "日祝勤務（終日）として登録";
    }
    if (!["paid", "child"].includes(form.type)) return `${LEAVE_TYPES[form.type]}として登録`;
    if (form.method === "full") return "計算結果：終日取得 1日";
    if (form.method === "morning") return "計算結果：時間休 3.5h";
    if (form.method === "afternoon") return "計算結果：時間休 4.25h";
    return `計算結果：時間休 ${formatHours(calcTimeHours(form.start, form.end, form.deductBreak))}`;
  }

  function selectedRecords() {
    if (!selectedDate) return [];
    return scopedRecordsForDate(selectedDate);
  }

  function selectedAnnouncements() {
    if (!selectedDate) return [];
    return announcementsForDate(selectedDate);
  }

  function toggleDate(date) {
    setSelectedDate((current) => (current === date ? null : date));
  }

  function openLeaveFormForDate(date) {
    setForm((prev) => ({
      ...prev,
      date,
      staffId: isAdmin ? (prev.staffId || loginUser?.id || activeStaff[0]?.id || "") : (loginUser?.id || ""),
    }));
    setShowLeaveForm(true);
    setSelectedDate(null);

    window.setTimeout(() => {
      document.querySelector(".leaveEntryCard")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 50);
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

    await addDoc(collection(db, "announcements"), {
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
});

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
  const cleanGroups = SATURDAY_GROUP_KEYS.reduce((acc, groupKey) => {
    acc[groupKey] = pruneSaturdayStaffIds(nextGroups?.[groupKey]);
    return acc;
  }, {});

  const cleanOverrides = (nextOverrides || []).map((item) => ({
    ...item,
    staffIds: pruneSaturdayStaffIds(item.staffIds),
  }));

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

  function resetSaturdayOverride(date) {
    if (!saturdayOverrideForDate(date)) return;
    if (!confirm("この日の個別変更を解除して、基本グループに戻しますか？")) return;
setSaturdayOverrides((prev) => {
  const nextOverrides = prev.filter((item) => item.date !== date);
  saveSaturdaySettings(saturdayGroups, nextOverrides, saturdayRotation);
  return nextOverrides;
});
    setSaturdayForm((prev) => {
      const groupKey = saturdayBaseGroupKeyForDate(date);
      return {
        ...prev,
        staffIds: groupKey ? pruneSaturdayStaffIds(saturdayGroups[groupKey]) : [],
        note: "",
      };
    });
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
    setSaturdayOverrides((prev) => {
      const upsert = (list, next) => {
        const exists = list.some((item) => item.date === next.date);
        if (exists) return list.map((item) => (item.date === next.date ? next : item));
        return [...list, next];
      };

      let nextList = upsert(prev, {
        date: saturdayForm.date,
        staffIds: pruneSaturdayStaffIds(saturdayForm.staffIds),
        note: (saturdayForm.note || "").trim(),
        updatedAt: Date.now(),
      });

      if (swapCandidateDate) {
        const originalCandidateIds = saturdayScheduleForDate(swapCandidateDate)?.staffIds || [];
        if (!arraysEqualByValue(originalCandidateIds, swapCandidateStaffIds)) {
          nextList = upsert(nextList, {
            date: swapCandidateDate,
            staffIds: pruneSaturdayStaffIds(swapCandidateStaffIds),
            note: saturdayScheduleForDate(swapCandidateDate)?.note || "",
            updatedAt: Date.now(),
          });
        }
      }
saveSaturdaySettings(saturdayGroups, nextList, saturdayRotation);

      return nextList;
    });

    setSelectedDate(saturdayForm.date);
    setShowSaturdayEdit(false);
  }

function deleteSaturdaySchedule(date) {
  if (!confirm("この日の土曜出勤を削除しますか？")) return;

  setSaturdayOverrides((prev) => {
    const nextOverrides = prev.filter((item) => item.date !== date);
    saveSaturdaySettings(saturdayGroups, nextOverrides, saturdayRotation);
    return nextOverrides;
  });
}

  const visibleStaff = isAdmin ? activeStaff : activeStaff.filter((s) => s.id === loginId);
  const showTimeInputs = ["paid", "child"].includes(form.type) && form.method === "time";
  const showMethod = ["paid", "child", "holiday"].includes(form.type);
  const methodOptions = form.type === "holiday"
    ? Object.entries(HOLIDAY_WORK_METHODS)
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
        <h1>休暇・患者管理</h1>
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
      <header className={`appHeader mainHeaderFinal ${appSection === "patients" ? "patientsHeader" : "leaveHeader"}`}>
        <div className="appTitleTabs headerTopTabs" aria-label="機能切替">
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
            患者振り分け
          </button>
        </div>

        <div className={`loginRow headerControlRow ${appSection === "patients" ? "patientLoginRow" : ""}`}>
          <label className="loginSelect headerLoginSelect">
            <span>表示</span>
            <select value={loginId} onChange={(e) => setLoginId(e.target.value)}>
              {activeStaff.map((s) => (
                <option key={s.id} value={s.id}>
                  {personName(s)}
                </option>
              ))}
            </select>
          </label>

          {appSection === "patients" && (
            <div className="patientMiniProfessionTabs headerProfessionTabs" aria-label="患者振り分け PT OT 切替">
              {PM_PROFESSIONS.map((item) => (
                <button
                  key={item}
                  className={patientProfession === item ? "active" : ""}
                  type="button"
                  onClick={() => setPatientProfession(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          )}

          <button type="button" className="headerLogoutButton" onClick={handleLogout}>
            ログアウト
          </button>
        </div>
      </header>

      {appSection === "patients" ? (
<FullPatientManager
  loginUser={loginUser}
  profession={patientProfession}
  setProfession={setPatientProfession}
  staffSource={activeStaff}
  pwaInfo={pwaInfo}
  pwaChecking={pwaChecking}
  onPwaUpdateCheck={handlePwaUpdateCheck}
  onPwaApplyUpdate={handlePwaApplyUpdate}
  onPwaCacheClear={handlePwaCacheClear}
/>
 ) : (
   <>
      <AnnouncementBoard
        announcements={todayAnnouncements}
        isAdmin={isAdmin}
        onOpenEdit={() => setShowAnnouncementEdit(true)}
        onDelete={deleteAnnouncement}
      />

      <section className={`card leaveEntryCard ${showLeaveForm ? "open" : ""}`}>
        <button
          className="leaveEntryTitleButton"
          type="button"
          onClick={() => setShowLeaveForm((prev) => !prev)}
          aria-expanded={showLeaveForm}
        >
          ＋ 休暇・勤務登録
        </button>

        {showLeaveForm && (
          <>
        <div className="actionButtons leaveEntryActions">
          <button className="softButton" type="button" onClick={() => openSaturdayEdit(form.date)}>
            土曜出勤設定
          </button>
          <button className="softButton" type="button" onClick={() => setShowStaffEdit(true)}>
            職員編集
          </button>
        </div>

        <div className="formGrid">
          <label>
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

          <label>
            <span>日付</span>
            <JapaneseDateInput value={form.date} onChange={(date) => setForm({ ...form, date })} />
          </label>

          <label>
            <span>種別</span>
            <select
              className="leaveSelectControl"
              style={LEAVE_SELECT_VISIBLE_STYLE}
              value={form.type}
              onChange={(e) =>
                setForm({
                  ...form,
                  type: e.target.value,
                  method: ["paid", "child"].includes(e.target.value)
                    ? form.method
                    : e.target.value === "holiday" && ["full", "morning", "afternoon"].includes(form.method)
                      ? form.method
                      : "full",
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
              <select
                className="leaveSelectControl"
                style={LEAVE_SELECT_VISIBLE_STYLE}
                value={form.method}
                onChange={(e) => setForm({ ...form, method: e.target.value })}
              >
                {methodOptions.map(([key, value]) => (
                  <option key={key} value={key}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
          )}

          {showTimeInputs && (
            <>
              <label className="wide">
                <span>開始</span>
                <div
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
                    value={String(Number(startHour))}
                    onChange={(e) => changeStartPart("hour", e.target.value)}
                  >
                    {startHourOptions.map((hour) => (
                      <option key={`start-hour-${hour}`} value={hour}>{hour}</option>
                    ))}
                  </select>
                  <span>時</span>

                  <select
                    className="leaveSelectControl"
                    style={LEAVE_SELECT_VISIBLE_STYLE}
                    value={startMinute}
                    onChange={(e) => changeStartPart("minute", e.target.value)}
                  >
                    {startMinuteOptions.map((minute) => (
                      <option key={`start-minute-${minute}`} value={minute}>{minute}</option>
                    ))}
                  </select>
                  <span>分</span>
                </div>
              </label>

              <label className="wide">
                <span>終了</span>
                <div
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
                    value={String(Number(endHour))}
                    onChange={(e) => changeEndPart("hour", e.target.value)}
                  >
                    {endHourOptions.map((hour) => (
                      <option key={`end-hour-${hour}`} value={hour}>{hour}</option>
                    ))}
                  </select>
                  <span>時</span>

                  <select
                    className="leaveSelectControl"
                    style={LEAVE_SELECT_VISIBLE_STYLE}
                    value={endMinute}
                    onChange={(e) => changeEndPart("minute", e.target.value)}
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

          <label className="wide">
            <span>メモ</span>
            <input placeholder="任意" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </label>

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

        <div className="previewBox">{previewText()}</div>
        <button className="primaryButton" type="button" onClick={addRecord} disabled={recordSubmitting}>
          {recordSubmitting ? "登録中..." : "登録する"}
        </button>
          </>
        )}
      </section>

      <nav className="toolbar">
        <div className="calendarModeBar" aria-label="カレンダー表示切替">
          <button className={view === "calendar" ? "active" : ""} onClick={() => setView("calendar")}>
            カレンダー
          </button>
          <button
            type="button"
            className={displayScope === "all" ? "active" : ""}
            onClick={() => { setDisplayScope("all"); setSelectedDate(null); }}
          >
            全体
          </button>
          <button
            type="button"
            className={displayScope === "mine" ? "active" : ""}
            onClick={() => { setDisplayScope("mine"); setSelectedDate(null); }}
          >
            自分
          </button>
        </div>
        <div className="summaryModeBox">
          <button className={view === "summary" ? "active" : ""} onClick={() => setView("summary")}>
            集計
          </button>
        </div>

      </nav>

      {view === "calendar" ? (
        <section className="calendarCard">
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
              const dayAnnouncements = announcementsForDate(date);
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
                    {dayAnnouncements.length > 0 && <span className="announcementMini">予{dayAnnouncements.length}</span>}
                  </div>

                  <div className="dayCounts">
                    {count.PT > 0 && <span>PT {count.PT}</span>}
                    {count.OT > 0 && <span>OT {count.OT}</span>}
                  </div>
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

            {selectedRecords().length === 0 && selectedAnnouncements().length === 0 && !canShowSaturdayForDate(selectedDate) && !holidays[selectedDate] ? (
              <p className="emptyText">この日の登録はありません。</p>
            ) : (
              <div className="detailList">
                {selectedAnnouncements().map((item) => (
                  <div className={`detailItem announcementDetail ${item.priority === "important" ? "important" : ""}`} key={`${item.id}-${item.occurrenceDate || selectedDate}`}>
                    <div>
                      <strong>{item.time ? `${item.time}　` : ""}{item.title}</strong>
                      {item.message && <p>{item.message}</p>}
                      <small>{announcementScheduleText(item)}</small>
                    </div>
                    {isAdmin && (
                      <button type="button" className="deleteButton" onClick={() => deleteAnnouncement(item.id)}>
                        削除
                      </button>
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

                {canShowSaturdayForDate(selectedDate) && (
                  <div className="detailItem saturdayWorkDetail">
                    <div className="saturdayWorkBody">
                      <div className="saturdayWorkTitle">
                        <div className="saturdayWorkTitleText">
                          <strong>土曜出勤</strong>
                          {saturdayScheduleForDate(selectedDate)?.isOverride && <small>この日のみ個別変更</small>}
                        </div>
                        <div className="detailActions">
                          <button type="button" className="softMiniButton" onClick={() => openSaturdayEdit(selectedDate)}>
                            出勤日を変更
                          </button>
                          {saturdayScheduleForDate(selectedDate)?.isOverride && (
                            <button type="button" className="deleteButton compactAction" onClick={() => deleteSaturdaySchedule(selectedDate)}>
                              個別変更解除
                            </button>
                          )}
                        </div>
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
                                        {personName(row.before)} {job} <span>⇒</span> {personName(row.after)} {job}
                                      </>
                                    ) : row.added ? (
                                      <>
                                        追加 <span>⇒</span> {personName(row.after)} {job}
                                      </>
                                    ) : row.removed ? (
                                      <>
                                        {personName(row.before)} {job} <span>⇒</span> 未設定
                                      </>
                                    ) : (
                                      <>{personName(row.after || row.before)} {job}</>
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
                  </div>
                )}

                {selectedRecords().map((r) => (
                  <div key={r.id} className={`detailItem ${r.type}`}>
                    <div>
                      <strong>
                        {personName(r.staff)}
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

            <div className="modalFooterActions">
              <button
                type="button"
                className="primaryButton"
                onClick={() => openLeaveFormForDate(selectedDate)}
              >
                {selectedRecords().length > 0 ? "この日に追加登録" : "この日に休暇・勤務を登録"}
              </button>
            </div>
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
  setSaturdayRotation((prev) => {
    const nextRotation = { ...prev, startDate };
    saveSaturdaySettings(saturdayGroups, saturdayOverrides, nextRotation);
    return nextRotation;
  });
}}
                  />
                </label>
                <label>
                  <span>開始グループ</span>
                  <select
                    value={saturdayRotation.startGroup}
                    onChange={(e) => {
  const startGroup = e.target.value;
  setSaturdayRotation((prev) => {
    const nextRotation = { ...prev, startGroup };
    saveSaturdaySettings(saturdayGroups, saturdayOverrides, nextRotation);
    return nextRotation;
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
                                    key={person.id}
                                    type="button"
                                    onClick={() => setSwapTargetStaffId((current) => (current === person.id ? null : person.id))}
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
                                key={date}
                                type="button"
                                onClick={() => selectSwapCandidate(date)}
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
            key={person.id}
            type="button"
            onClick={() => handleSaturdayTapSwap(person.id)}
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
const PM_STOPPED_DEPARTMENTS = PM_DEPARTMENTS.filter((dept) => !["outpatient", "stopped"].includes(dept.key));
const PM_EMPTY_STOPPED_DETAIL = Object.fromEntries(PM_STOPPED_DEPARTMENTS.map((dept) => [dept.key, 0]));
const PM_EMPTY_OUTPATIENT_DETAIL = { general: 0, student: 0 };
const PM_EMPTY_DIALYSIS = { mwf: 0, tts: 0 };
const PM_DIALYSIS_TYPES = [
  { key: "mwf", label: "月水金", short: "月水金" },
  { key: "tts", label: "火木土", short: "火木土" },
];

const PM_SAMPLE_STAFF = [
  {
    id: "pt1",
    profession: "PT",
    type: "main",
    canCancerRehab: true,
    lastName: "阿部",
    firstName: "寛",
    order: 1,
    counts: { ...PM_EMPTY_COUNTS, outpatient: 5, ortho: 3, neuroSurgery: 1, cancer: 1, neuroInternal: 1, internal: 5 },
    note: "13単位1名（内）",
  },
  {
    id: "pt2",
    profession: "PT",
    type: "main",
    canCancerRehab: false,
    lastName: "大泉",
    firstName: "洋",
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
    firstName: "二朗",
    order: 3,
    counts: { ...PM_EMPTY_COUNTS, outpatient: 5, ortho: 3, neuroSurgery: 1, neuroInternal: 2, internal: 5 },
    note: "",
  },
  {
    id: "pt4",
    profession: "PT",
    type: "main",
    canCancerRehab: false,
    lastName: "ムロ",
    firstName: "ツヨシ",
    order: 4,
    counts: { ...PM_EMPTY_COUNTS, outpatient: 2, ortho: 2, neuroSurgery: 1, neuroInternal: 2, internal: 6 },
    note: "6/6退 脳内、6/7退 整",
  },
  {
    id: "ot1",
    profession: "OT",
    type: "main",
    canCancerRehab: true,
    lastName: "天海",
    firstName: "祐希",
    order: 1,
    counts: { ...PM_EMPTY_COUNTS, ortho: 4, neuroSurgery: 1, internal: 3 },
    note: "",
  },
  {
    id: "ot2",
    profession: "OT",
    type: "main",
    canCancerRehab: false,
    lastName: "小池",
    firstName: "栄子",
    order: 2,
    counts: { ...PM_EMPTY_COUNTS, ortho: 3, cancer: 1, internal: 4 },
    note: "",
  },
  {
    id: "ot3",
    profession: "OT",
    type: "main",
    canCancerRehab: true,
    lastName: "松重",
    firstName: "豊",
    order: 3,
    counts: { ...PM_EMPTY_COUNTS, neuroSurgery: 1, internal: 2, urology: 1 },
    note: "",
  },
  {
    id: "ot4",
    profession: "OT",
    type: "main",
    canCancerRehab: false,
    lastName: "光石",
    firstName: "研",
    order: 4,
    counts: { ...PM_EMPTY_COUNTS, ortho: 2, internal: 2, ent: 1 },
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

function pmTableDisplayName(staff) {
  const lastName = String(staff?.lastName || "").trim();
  const firstName = String(staff?.firstName || "").trim();
  if (staff?.displayNameMode === "first") {
    return firstName || lastName || pmPersonName(staff);
  }
  return lastName || firstName || pmPersonName(staff);
}

function pmFirstChar(value) {
  return Array.from(String(value || "").trim())[0] || "";
}

function pmLastName(staff) {
  return String(staff?.lastName || "").trim() || String(staff?.name || "").trim() || "未設定";
}

function pmNormalizeFamilyNameForCompact(value) {
  const name = String(value || "").trim();
  if (!name) return "";
  // 渡辺・渡邊・渡邉は同姓として扱う。表示名は元の漢字を維持する。
  return name.replace(/[邊邉]/g, "辺");
}

function pmCompactNameInfo(staff, lastNameCounts, lastInitialCounts) {
  const lastName = pmLastName(staff);
  const familyKey = pmNormalizeFamilyNameForCompact(lastName);
  const firstName = String(staff?.firstName || "").trim();
  const firstInitial = pmFirstChar(firstName);

  if ((lastNameCounts[familyKey] || 0) <= 1) {
    return { lastName, small: "", fullFirst: false };
  }

  if (!firstInitial) {
    return { lastName, small: "", fullFirst: false };
  }

  const initialKey = `${familyKey}::${firstInitial}`;
  if ((lastInitialCounts[initialKey] || 0) <= 1) {
    return { lastName, small: firstInitial, fullFirst: false };
  }

  return { lastName, small: firstName, fullFirst: true };
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
  const counts = { ...PM_EMPTY_COUNTS, ...(staff.counts || {}) };
  const outpatientDetail = {
    ...PM_EMPTY_OUTPATIENT_DETAIL,
    ...(staff.outpatientDetail || {}),
  };
  if (!staff.outpatientDetail) {
    outpatientDetail.general = Number(counts.outpatient || 0);
    outpatientDetail.student = 0;
  }
  counts.outpatient = Number(outpatientDetail.general || 0) + Number(outpatientDetail.student || 0);

  return {
    id: staff.id || makeId(),
    profession: staff.profession || "PT",
    type: staff.type || "main",
    canCancerRehab: Boolean(staff.canCancerRehab),
    active: staff.active !== false,
    visible: staff.visible !== false,
    uid: staff.uid || "",
    staffNumber: staff.staffNumber || "",
    role: staff.role || "staff",
    lastName: staff.lastName || "",
    firstName: staff.firstName || "",
    displayNameMode: staff.displayNameMode === "first" ? "first" : "last",
    order: Number(staff.order || index + 1),
    counts,
    outpatientDetail,
    stoppedDetail: { ...PM_EMPTY_STOPPED_DETAIL, ...(staff.stoppedDetail || {}) },
    dialysis: { ...PM_EMPTY_DIALYSIS, ...(staff.dialysis || {}) },
    note: staff.note || "",
  };
}

const PM_SAMPLE_STAFF_NAME_BY_ID = {
  pt1: { lastName: "阿部", firstName: "寛" },
  pt2: { lastName: "大泉", firstName: "洋" },
  pt3: { lastName: "佐藤", firstName: "二朗" },
  pt4: { lastName: "ムロ", firstName: "ツヨシ" },
  ot1: { lastName: "天海", firstName: "祐希" },
  ot2: { lastName: "小池", firstName: "栄子" },
};

const PM_OLD_SAMPLE_STAFF_NAME_BY_ID = {
  pt1: { lastName: "山田", firstName: "太郎" },
  pt2: { lastName: "田中", firstName: "美咲" },
  pt3: { lastName: "佐藤", firstName: "健" },
  pt4: { lastName: "高橋", firstName: "優" },
  ot1: { lastName: "吉田", firstName: "彩" },
  ot2: { lastName: "伊藤", firstName: "翔" },
};

function pmMigrateSampleStaff(staff, index = 0) {
  const normalized = pmNormalizeStaff(staff, index);
  const oldName = PM_OLD_SAMPLE_STAFF_NAME_BY_ID[normalized.id];
  const nextName = PM_SAMPLE_STAFF_NAME_BY_ID[normalized.id];
  if (!oldName || !nextName) return normalized;

  const isOldSampleName = normalized.lastName === oldName.lastName && normalized.firstName === oldName.firstName;
  if (!isOldSampleName) return normalized;

  return pmNormalizeStaff({
    ...normalized,
    lastName: nextName.lastName,
    firstName: nextName.firstName,
  }, index);
}

function pmEnsureSampleStaff(list) {
  const ids = new Set(list.map((staff) => staff.id));
  const additions = PM_SAMPLE_STAFF.filter((staff) => !ids.has(staff.id)).map(pmNormalizeStaff);
  return [...list, ...additions];
}

function pmStoppedDetail(staff) {
  return {
    ...PM_EMPTY_STOPPED_DETAIL,
    ...(staff.stoppedDetail || {}),
  };
}

function pmStoppedTotal(staff) {
  const detailTotal = PM_STOPPED_DEPARTMENTS.reduce(
    (sum, dept) => sum + Number(pmStoppedDetail(staff)[dept.key] || 0),
    0
  );

  if (detailTotal > 0) return detailTotal;
  return Number(staff.counts?.stopped || 0);
}

function pmCountTotal(staff) {
  const scheduledTotal = PM_DEPARTMENTS.filter((dept) => dept.key !== "stopped" && dept.key !== "outpatient").reduce(
    (sum, dept) => sum + Number(staff.counts?.[dept.key] || 0),
    0
  );
  return Math.max(0, scheduledTotal - pmStoppedTotal(staff));
}

function pmOutpatientDetail(staff) {
  const detail = { ...PM_EMPTY_OUTPATIENT_DETAIL, ...(staff.outpatientDetail || {}) };
  if (!staff.outpatientDetail) {
    detail.general = Number(staff.counts?.outpatient || 0);
    detail.student = 0;
  }
  return {
    general: Number(detail.general || 0),
    student: Number(detail.student || 0),
  };
}

function pmOutpatientTotal(staff) {
  const detail = pmOutpatientDetail(staff);
  return detail.general + detail.student;
}

function pmDialysisDetail(staff) {
  const detail = { ...PM_EMPTY_DIALYSIS, ...(staff.dialysis || {}) };
  return {
    mwf: Number(detail.mwf || 0),
    tts: Number(detail.tts || 0),
  };
}

function pmDialysisTotal(staff) {
  const detail = pmDialysisDetail(staff);
  return detail.mwf + detail.tts;
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

function FullPatientManager({
  loginUser,
  profession,
  setProfession,
  staffSource = [],
  pwaInfo,
  pwaChecking,
  onPwaUpdateCheck,
  onPwaApplyUpdate,
  onPwaCacheClear,
}) {
  const [view, setView] = useState("table");

  useEffect(() => {
    if (loginUser?.job) setProfession(loginUser.job);
  }, [loginUser?.id, loginUser?.job, setProfession]);
  const [fullTable, setFullTable] = useState(false);
const [patientSaveStatus, setPatientSaveStatus] = useState("loading");
const [patientSaving, setPatientSaving] = useState(false);
const [patientLoadError, setPatientLoadError] = useState("");
  // 患者振り分け用スタッフは、デモスタッフやlocalStorageを初期表示に使わない。
  // Firestoreのstaffコレクションを読み込んでから、settings/patientManagerの保存値と安全に合成する。
  const [staff, setStaff] = useState([]);
  const staffSourceRef = useRef(staffSource);
  const patientManagerDataRef = useRef(null);

  useEffect(() => {
    staffSourceRef.current = staffSource;
  }, [staffSource]);

  function mergePatientStaffList(savedList = [], masterList = staffSourceRef.current) {
    const saved = Array.isArray(savedList) ? savedList.map(pmNormalizeStaff) : [];
    const master = Array.isArray(masterList) ? masterList : [];

    // Firestoreの職員マスタが未読込の間は、保存済みstaffをそのまま表示しない。
    // 旧デモスタッフがPWA初回表示に出るのを防ぐため、マスタ読込後にだけ合成する。
    if (!master.length) return [];

    return master.map((person, index) => {
      const existing =
        saved.find((item) => item.id === person.id) ||
        saved.find(
          (item) =>
            item.profession === person.job &&
            item.lastName === person.lastName &&
            item.firstName === person.firstName
        );

      return pmNormalizeStaff({
        ...existing,
        id: person.id,
        profession: person.job || person.profession || existing?.profession || "PT",
        lastName: person.lastName || existing?.lastName || "",
        firstName: person.firstName || existing?.firstName || "",
        active: person.active !== false,
        visible: person.visible === false ? false : (person.visible === true ? true : existing?.visible !== false),
        uid: person.uid || "",
        staffNumber: person.staffNumber || "",
        role: person.role || existing?.role || "staff",
        canCancerRehab: person.canCancerRehab ?? existing?.canCancerRehab ?? false,
        displayNameMode: person.displayNameMode === "first" ? "first" : (existing?.displayNameMode === "first" ? "first" : "last"),
        order: Number(person.order || existing?.order || index + 1),
      });
    });
  }

  useEffect(() => {
    if (!staffSource.length) return;
    const savedPatientStaff = patientManagerDataRef.current?.staff;
    setStaff((prevStaff) => mergePatientStaffList(savedPatientStaff || prevStaff, staffSource));
  }, [staffSource]);
  // 患者振り分けの本体データはFirestoreだけを正とする。
  // iPhone PWAやChrome/Safariで古いlocalStorageが残っていても、初期表示に使わない。
  const [movements, setMovements] = useState([]);
  const [history, setHistory] = useState([]);
  const [recentChanges, setRecentChanges] = useState({});
  const [activeCell, setActiveCell] = useState(null);
  const [editMovement, setEditMovement] = useState(null);
  const [fiscalSnapshots, setFiscalSnapshots] = useState({});
  const [selectedFiscal, setSelectedFiscal] = useState(null); // null = 今年度
  const [patientDataReady, setPatientDataReady] = useState(false);
  const patientRemoteApplyingRef = useRef(false);
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
  const [settingsView, setSettingsView] = useState("register");
  const [showStaffForm, setShowStaffForm] = useState(false);
  const [showTodayAdjustHistory, setShowTodayAdjustHistory] = useState(false);
  const [lastAppliedMovementBatch, setLastAppliedMovementBatch] = useState(null);

useEffect(() => {
  const unsubscribe = onSnapshot(
    doc(db, "settings", "patientManager"),

    (snapshot) => {
      if (!snapshot.exists()) {
        setPatientDataReady(true);
        setPatientSaveStatus("dirty");
        return;
      }

      const data = snapshot.data();

      patientManagerDataRef.current = data;
      patientRemoteApplyingRef.current = true;

      if (Array.isArray(data.staff)) {
        setStaff(
          mergePatientStaffList(
            data.staff,
            staffSourceRef.current
          )
        );
      }

      if (Array.isArray(data.movements)) {
        setMovements(data.movements);
      }

      if (Array.isArray(data.history)) {
        setHistory(data.history);
      }

      if (data.recentChanges) {
        setRecentChanges((prev) => {
          const today = pmTodayKey();

          const keepTodayChanges = Object.fromEntries(
            Object.entries(prev).filter(
              ([, value]) => value === today
            )
          );

          return {
            ...data.recentChanges,
            ...keepTodayChanges,
          };
        });
      }

      if (data.fiscalSnapshots) {
        setFiscalSnapshots(data.fiscalSnapshots);
      }

      setPatientDataReady(true);
      setPatientSaveStatus("saved");

      setTimeout(() => {
        patientRemoteApplyingRef.current = false;
      }, 0);
    },

    (error) => {
      console.error("patientManager ERROR", error);

      setPatientDataReady(false);
      setPatientSaveStatus("error");
      setPatientLoadError(
        `患者振り分けを読み込めませんでした。code: ${error.code || "unknown"}`
      );
    }
  );

  return () => unsubscribe();
}, []);

function buildPatientManagerPayload(extra = {}) {
  return {
    staff,
    movements,
    history,
    recentChanges,
    fiscalSnapshots,
    updatedAt: Date.now(),
    updatedBy: loginUser?.id || "",
    updatedByName: loginUser ? personName(loginUser) : "",
    ...extra,
  };
}

function estimatePatientManagerSizeBytes() {
  try {
    return new Blob([JSON.stringify(buildPatientManagerPayload())]).size;
  } catch (error) {
    console.error("patientManager size estimate failed", error);
    return 0;
  }
}

function formatPatientManagerSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "計測できません";
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}


async function savePatientManagerData() {
  if (!patientDataReady || patientRemoteApplyingRef.current || patientSaving) return;

  setPatientSaving(true);
  try {
    // Firestoreの1ドキュメント上限を超えないよう、
    // 患者振り分け本体にはスナップショットを含めない。
    const payload = buildPatientManagerPayload();

    await setDoc(doc(db, "settings", "patientManager"), payload);
    patientManagerDataRef.current = payload;
    setPatientSaveStatus("saved");
  } catch (error) {
    const code = error?.code || "unknown";
    const message = error?.message || "unknown";
    console.error("patientManager save failed", error);
    alert(
      `患者振り分けの保存に失敗しました。\ncode: ${code}\nmessage: ${message}`
    );
    setPatientSaveStatus("dirty");
  } finally {
    setPatientSaving(false);
  }
}

function downloadPatientManagerBackup() {
  const backup = {
    app: "REHA Manager",
    type: "patientManagerBackup",
    version: 1,
    createdAt: new Date().toISOString(),
    createdBy: loginUser?.id || "",
    createdByName: loginUser ? personName(loginUser) : "",
    data: buildPatientManagerPayload(),
  };

  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  link.href = url;
  link.download = `reha_patientManager_backup_${stamp}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

async function restorePatientManagerFromFile(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;

  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const source = parsed?.data || parsed?.patientManager || parsed;

    const nextStaff = Array.isArray(source.staff) ? source.staff.map(pmNormalizeStaff) : [];
    const nextMovements = Array.isArray(source.movements) ? source.movements : [];
    const nextHistory = Array.isArray(source.history) ? source.history : [];
    const nextRecentChanges = source.recentChanges && typeof source.recentChanges === "object" ? source.recentChanges : {};
    const nextFiscalSnapshots = source.fiscalSnapshots && typeof source.fiscalSnapshots === "object" ? source.fiscalSnapshots : {};

    if (!nextStaff.length && !nextMovements.length && !nextHistory.length) {
      alert("復元できる患者振り分けデータが見つかりませんでした。");
      return;
    }

const ok = window.confirm(
  `患者振り分けデータをこのJSONの内容で復元します。

現在の患者振り分けデータは上書きされます。

復元前の状態は直近スナップショットとして20件まで保持します。

続行しますか？`
);

if (!ok) return;

    setPatientSaving(true);
    patientRemoteApplyingRef.current = true;

    const payload = buildPatientManagerPayload({
      staff: nextStaff,
      movements: nextMovements,
      history: nextHistory,
      recentChanges: nextRecentChanges,
      fiscalSnapshots: nextFiscalSnapshots,
      restoredAt: Date.now(),
      restoredBy: loginUser?.id || "",
      restoredByName: loginUser ? personName(loginUser) : "",
    });

    await setDoc(doc(db, "settings", "patientManager"), payload);
    patientManagerDataRef.current = payload;

    setStaff(mergePatientStaffList(nextStaff, staffSourceRef.current));
    setMovements(nextMovements);
    setHistory(nextHistory);
    setRecentChanges(nextRecentChanges);
    setFiscalSnapshots(nextFiscalSnapshots);
    setPatientSaveStatus("saved");

    setTimeout(() => {
      patientRemoteApplyingRef.current = false;
    }, 0);

    alert("患者振り分けデータを復元しました。");
  } catch (error) {
    console.error("patientManager restore failed", error);
    alert("復元に失敗しました。JSONファイルの内容を確認してください。");
    patientRemoteApplyingRef.current = false;
  } finally {
    setPatientSaving(false);
  }
}

useEffect(() => {
  if (!patientDataReady || patientRemoteApplyingRef.current) return;
  setPatientSaveStatus((prev) => (prev === "saving" ? prev : "dirty"));
}, [staff, movements, history, recentChanges, fiscalSnapshots, patientDataReady]);

  useEffect(() => {
    applyDueMovements();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const professionStaff = useMemo(() => {
    return staff
      .filter((person) => person.profession === profession && person.active !== false)
      .sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  }, [staff, profession]);

  const visibleStaff = useMemo(() => {
    return professionStaff.filter((person) => person.visible !== false);
  }, [professionStaff]);

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

  const todayAdjustHistory = useMemo(() => {
    return history
      .filter((item) => item.profession === profession && item.date === pmTodayKey() && !item.moveType)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }, [history, profession]);

  const fiscal = pmFiscalYear(pmTodayKey());
  const tableDensity = visibleStaff.length >= 14 ? "dense3" : visibleStaff.length >= 10 ? "dense2" : "dense1";

  function staffOptionsForDepartment(department) {
    const base = staff.filter((person) => (
      person.profession === profession
      && person.active !== false
      && person.visible !== false
    ));
    if (department === "cancer") {
      return base.filter((person) => person.canCancerRehab);
    }
    return base;
  }

  const movementStaffOptions = staffOptionsForDepartment(movementForm.department);
  const loginPatientStaff = useMemo(() => {
    if (!loginUser) return null;
    return staff.find((person) => (
      person.profession === loginUser.job
      && (person.lastName || "") === (loginUser.lastName || "")
      && (person.firstName || "") === (loginUser.firstName || "")
    )) || null;
  }, [staff, loginUser]);

  const autoMovementStaff = (
    movementStaffOptions.find((person) => person.id === loginPatientStaff?.id)
    || movementStaffOptions.find((person) => person.id === movementForm.staffId)
    || movementStaffOptions[0]
    || null
  );

  useEffect(() => {
    const nextStaffId = autoMovementStaff?.id || "";
    if (movementForm.staffId !== nextStaffId) {
      setMovementForm((prev) => ({ ...prev, staffId: nextStaffId }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profession, movementForm.department, staff.length, loginPatientStaff?.id, autoMovementStaff?.id]);

function isChangedToday(staffId, department) {
  const today = pmTodayKey();
  const key = `${staffId}:${department}`;

  if (recentChanges[key] === today) return true;

  return history.some(
    (item) =>
      item.date === today &&
      item.staffId === staffId &&
      item.department === department
  );
}

function markChanged(staffId, department) {
  const today = pmTodayKey();
  const key = `${staffId}:${department}`;

  setRecentChanges((prev) => ({
    ...prev,
    [key]: today,
  }));
}

  function updateCount(staffId, department, value) {
    const nextValue = Math.max(0, Number(value || 0));

    setStaff((prev) =>
      prev.map((person) => {
        if (person.id !== staffId) return person;
        if (department === "outpatient") {
          return {
            ...person,
            counts: {
              ...person.counts,
              outpatient: nextValue,
            },
            outpatientDetail: {
              general: nextValue,
              student: 0,
            },
          };
        }
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

  function updateOutpatientDetail(staffId, key, value) {
    const nextValue = Math.max(0, Number(value || 0));
    setStaff((prev) =>
      prev.map((person) => {
        if (person.id !== staffId) return person;
        const detail = pmOutpatientDetail(person);
        const nextDetail = { ...detail, [key]: nextValue };
        return {
          ...person,
          outpatientDetail: nextDetail,
          counts: {
            ...person.counts,
            outpatient: Number(nextDetail.general || 0) + Number(nextDetail.student || 0),
          },
        };
      })
    );
    markChanged(staffId, "outpatient");
  }

  function quickAdjustOutpatient(staffId, key, diff) {
    const target = staff.find((person) => person.id === staffId);
    if (!target) return;
    const detail = pmOutpatientDetail(target);
    updateOutpatientDetail(staffId, key, Math.max(0, Number(detail[key] || 0) + diff));
  }

  function updateStoppedDetail(staffId, department, value) {
    const nextValue = Math.max(0, Number(value || 0));

    setStaff((prev) =>
      prev.map((person) => {
        if (person.id !== staffId) return person;
        const nextStoppedDetail = {
          ...pmStoppedDetail(person),
          [department]: nextValue,
        };

        return {
          ...person,
          stoppedDetail: nextStoppedDetail,
          counts: {
            ...person.counts,
            stopped: PM_STOPPED_DEPARTMENTS.reduce(
              (sum, dept) => sum + Number(nextStoppedDetail[dept.key] || 0),
              0
            ),
          },
        };
      })
    );

    markChanged(staffId, "stopped");
  }

  function quickAdjustStopped(staffId, department, diff) {
    const target = staff.find((person) => person.id === staffId);
    if (!target) return;
    const detail = pmStoppedDetail(target);
    updateStoppedDetail(staffId, department, Math.max(0, Number(detail[department] || 0) + diff));
  }

  function updateDialysisDetail(staffId, key, value) {
    const nextValue = Math.max(0, Number(value || 0));
    setStaff((prev) =>
      prev.map((person) => {
        if (person.id !== staffId) return person;
        return {
          ...person,
          dialysis: {
            ...pmDialysisDetail(person),
            [key]: nextValue,
          },
        };
      })
    );
    markChanged(staffId, "dialysis");
  }

  function quickAdjustDialysis(staffId, key, diff) {
    const target = staff.find((person) => person.id === staffId);
    if (!target) return;
    const detail = pmDialysisDetail(target);
    updateDialysisDetail(staffId, key, Math.max(0, Number(detail[key] || 0) + diff));
  }

  function addHistory(entry) {
    setHistory((prev) => [
      {
        id: makeId(),
        createdAt: new Date().toISOString(),
        pmFiscalYear: pmFiscalYear(entry.date || pmTodayKey()),
        updatedById: loginUser?.id || "",
        updatedByName: loginUser ? personName(loginUser) : "",
        ...entry,
      },
      ...prev,
    ]);
  }

  function registerMovement(e) {
    e.preventDefault();
    const targetStaff = autoMovementStaff || staff.find((person) => person.id === movementForm.staffId);
    if (!targetStaff) {
      alert("ログイン者に対応する担当者が見つかりません。職員編集を確認してください。");
      return;
    }

    setMovements((prev) => [
      ...prev,
      {
        id: makeId(),
        ...movementForm,
        staffId: targetStaff.id,
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

    if (due.length === 0) {
      alert("本日分までの患者移動はありません。");
      return;
    }

    const batchId = makeId("movement-apply");
    const affectedKeys = Array.from(
      new Set(due.map((movement) => `${movement.staffId}:${movement.department}`))
    );
    const previousRecentChanges = Object.fromEntries(
      affectedKeys.map((key) => [
        key,
        Object.prototype.hasOwnProperty.call(recentChanges, key)
          ? recentChanges[key]
          : null,
      ])
    );

    const appliedHistoryItems = due.map((movement) => ({
      id: makeId(),
      applyBatchId: batchId,
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
      updatedById: loginUser?.id || "",
      updatedByName: loginUser ? personName(loginUser) : "",
      note: movement.note || "",
    }));

    const decrementMap = due.reduce((map, movement) => {
      const key = `${movement.staffId}:${movement.department}`;
      map[key] = (map[key] || 0) + 1;
      return map;
    }, {});

    setStaff((prev) =>
      prev.map((person) => {
        const nextCounts = { ...person.counts };
        let changed = false;

        Object.entries(decrementMap).forEach(([key, amount]) => {
          const [staffId, department] = key.split(":");
          if (person.id !== staffId) return;

          nextCounts[department] = Math.max(
            0,
            Number(nextCounts?.[department] || 0) - Number(amount || 0)
          );
          changed = true;
        });

        return changed ? { ...person, counts: nextCounts } : person;
      })
    );

    const changed = {};
    due.forEach((movement) => {
      changed[`${movement.staffId}:${movement.department}`] = pmTodayKey();
    });

    setRecentChanges((prev) => ({ ...prev, ...changed }));
    setHistory((prev) => [...appliedHistoryItems, ...prev]);
    setMovements((prev) =>
      prev.filter((movement) => !due.some((target) => target.id === movement.id))
    );

    setLastAppliedMovementBatch({
      id: batchId,
      movements: due,
      historyIds: appliedHistoryItems.map((item) => item.id),
      previousRecentChanges,
    });
  }

  function undoLastAppliedMovements() {
    const batch = lastAppliedMovementBatch;
    if (!batch) return;

    const incrementMap = batch.movements.reduce((map, movement) => {
      const key = `${movement.staffId}:${movement.department}`;
      map[key] = (map[key] || 0) + 1;
      return map;
    }, {});

    setStaff((prev) =>
      prev.map((person) => {
        const nextCounts = { ...person.counts };
        let changed = false;

        Object.entries(incrementMap).forEach(([key, amount]) => {
          const [staffId, department] = key.split(":");
          if (person.id !== staffId) return;

          nextCounts[department] =
            Number(nextCounts?.[department] || 0) + Number(amount || 0);
          changed = true;
        });

        return changed ? { ...person, counts: nextCounts } : person;
      })
    );

    setMovements((prev) => {
      const existingIds = new Set(prev.map((movement) => movement.id));
      return [
        ...prev,
        ...batch.movements.filter((movement) => !existingIds.has(movement.id)),
      ].sort((a, b) =>
        String(a.date || "").localeCompare(String(b.date || ""))
      );
    });

    setHistory((prev) =>
      prev.filter((item) => !batch.historyIds.includes(item.id))
    );

    setRecentChanges((prev) => {
      const next = { ...prev };

      Object.entries(batch.previousRecentChanges).forEach(([key, value]) => {
        if (value === null || value === undefined) {
          delete next[key];
        } else {
          next[key] = value;
        }
      });

      return next;
    });

    setLastAppliedMovementBatch(null);
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
        dialysis: { ...pmDialysisDetail(person) },
        dialysisTotal: pmDialysisTotal(person),
      };
    });
    setFiscalSnapshots(prev => ({ ...prev, [`${fy}_${profession}`]: { fiscal: fy, profession, snapshot, savedAt: pmTodayKey() } }));
    alert(`${fy}年度（${profession}）のデータを保存しました。`);
  }

  async function addStaff(e) {
    e.preventDefault();

    const lastName = staffForm.lastName.trim();
    const firstName = staffForm.firstName.trim();

    if (!lastName || !firstName) {
      alert("姓・名を入力してください。");
      return;
    }

    const maxOrder = Math.max(
      0,
      ...staff.filter((person) => person.profession === staffForm.profession).map((person) => Number(person.order || 0))
    );

    const staffData = {
      lastName,
      firstName,
      name: `${lastName} ${firstName}`.trim(),
      job: staffForm.profession,
      profession: staffForm.profession,
      role: "staff",
      active: true,
      visible: true,
      uid: "",
      order: maxOrder + 1,
      canCancerRehab: Boolean(staffForm.canCancerRehab),
      displayNameMode: "last",
      createdAt: serverTimestamp(),
    };

    const temporaryId = makeId();
    const optimisticStaff = pmNormalizeStaff({ ...staffData, id: temporaryId });
    const previousStaff = staff;

    setStaff((prev) => [...prev, optimisticStaff]);
    setStaffForm({ lastName: "", firstName: "", profession, canCancerRehab: false });
    setShowStaffForm(false);

    try {
      const staffDoc = await addDoc(collection(db, "staff"), staffData);
      setStaff((prev) =>
        prev.map((person) =>
          person.id === temporaryId ? pmNormalizeStaff({ ...staffData, id: staffDoc.id }) : person
        )
      );
    } catch (error) {
      console.error("staff add failed", error);
      setStaff(previousStaff);
      alert("スタッフ登録の保存に失敗しました。Firestoreの権限または通信状況を確認してください。");
    }
  }

  async function deleteStaff(id) {
    if (!confirm("担当者を削除しますか？履歴は残ります。")) return;

    const previousStaff = staff;
    const previousMovements = movements;

    setStaff((prev) => prev.filter((person) => person.id !== id));
    setMovements((prev) => prev.filter((movement) => movement.staffId !== id));

    try {
      await deleteDoc(doc(db, "staff", id));
    } catch (error) {
      console.error("staff delete failed", error);
      setStaff(previousStaff);
      setMovements(previousMovements);
      alert("スタッフ削除の保存に失敗しました。Firestoreの権限または通信状況を確認してください。");
    }
  }

  function updateNote(staffId, note) {
    setStaff((prev) => prev.map((person) => (person.id === staffId ? { ...person, note } : person)));
  }

  async function updateStaffDisplayNameMode(id, displayNameMode) {
    const nextMode = displayNameMode === "first" ? "first" : "last";
    const previousStaff = staff;
    setStaff((prev) =>
      prev.map((person) =>
        person.id === id ? pmNormalizeStaff({ ...person, displayNameMode: nextMode }) : person
      )
    );

    try {
      await updateDoc(doc(db, "staff", id), { displayNameMode: nextMode });
    } catch (error) {
      console.error("staff display name mode update failed", error);
      setStaff(previousStaff);
      alert("表示名設定の保存に失敗しました。Firestoreの権限または通信状況を確認してください。");
    }
  }

  async function updateCancerPermission(id, canCancerRehab) {
    if (!canCancerRehab && activeCell === `${id}:cancer`) {
      setActiveCell(null);
    }

    const previousStaff = staff;
    setStaff((prev) =>
      prev.map((person) =>
        person.id === id
          ? pmNormalizeStaff({ ...person, canCancerRehab })
          : person
      )
    );

    try {
      await updateDoc(doc(db, "staff", id), { canCancerRehab });
    } catch (error) {
      console.error("staff cancer permission update failed", error);
      setStaff(previousStaff);
      alert("がんリハ設定の保存に失敗しました。Firestoreの権限または通信状況を確認してください。");
    }
  }

  async function updateStaffVisibility(id, visible) {
    const previousStaff = staff;
    setStaff((prev) =>
      prev.map((person) =>
        person.id === id ? pmNormalizeStaff({ ...person, visible }) : person
      )
    );

    try {
      await updateDoc(doc(db, "staff", id), { visible });
    } catch (error) {
      console.error("staff visible update failed", error);
      setStaff(previousStaff);
      alert("表示／非表示の保存に失敗しました。Firestoreの権限または通信状況を確認してください。");
    }
  }

  async function moveStaffOrder(id, direction) {
    const list = professionStaff;
    const index = list.findIndex((person) => person.id === id);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= list.length) return;

    const a = list[index];
    const b = list[targetIndex];
    const aOrder = Number(a.order || index + 1);
    const bOrder = Number(b.order || targetIndex + 1);
    const previousStaff = staff;

    setStaff((prev) =>
      prev.map((person) => {
        if (person.id === a.id) return { ...person, order: bOrder };
        if (person.id === b.id) return { ...person, order: aOrder };
        return person;
      })
    );

    try {
      await Promise.all([
        updateDoc(doc(db, "staff", a.id), { order: bOrder }),
        updateDoc(doc(db, "staff", b.id), { order: aOrder }),
      ]);
    } catch (error) {
      console.error("staff order update failed", error);
      setStaff(previousStaff);
      alert("表示順の保存に失敗しました。Firestoreの権限または通信状況を確認してください。");
    }
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

  const patientManagerSizeBytes = useMemo(
    () => estimatePatientManagerSizeBytes(),
    [staff, movements, history, recentChanges, fiscalSnapshots]
  );
  const firestoreDocumentLimitBytes = 1024 * 1024;
  const patientManagerUsagePercent = Math.min(
    100,
    Math.round((patientManagerSizeBytes / firestoreDocumentLimitBytes) * 100)
  );
  const patientManagerSizeLevel =
    patientManagerUsagePercent >= 85
      ? "danger"
      : patientManagerUsagePercent >= 65
        ? "warning"
        : "normal";

  const table = (
    <PMAssignmentTable
      staffList={visibleStaff}
      pendingMovements={pendingMovements}
      tableDensity={tableDensity}
      isChangedToday={isChangedToday}
      updateCount={updateCount}
      updateOutpatientDetail={updateOutpatientDetail}
      updateDialysisDetail={updateDialysisDetail}
      updateNote={updateNote}
      movementsForStaffDisplay={movementsForStaffDisplay}
      quickAdjust={quickAdjust}
      quickAdjustOutpatient={quickAdjustOutpatient}
      quickAdjustDialysis={quickAdjustDialysis}
      quickAdjustStopped={quickAdjustStopped}
      activeCell={activeCell}
      setActiveCell={setActiveCell}
      onEditMovement={setEditMovement}
      onClearDueMovements={applyDueMovements}
      sectionActions={!fullTable && (
        <>
          <button
            className={`patientSaveButton ${patientSaveStatus === "dirty" ? "dirty" : "saved"}`}
            type="button"
            onClick={savePatientManagerData}
            disabled={patientSaving || patientSaveStatus !== "dirty"}
            title={patientSaveStatus === "dirty" ? "変更を保存します" : "保存済みです"}
          >
            {patientSaving ? "保存中..." : patientSaveStatus === "dirty" ? "保存" : "保存済"}
          </button>
          <button className="tabExpandBtn iconOnly" type="button" onClick={() => setFullTable(true)} aria-label="拡大表示" title="拡大表示">⛶</button>
          <button
            className={`adjustHistoryButton ${showTodayAdjustHistory ? "active" : ""}`}
            type="button"
            onClick={() => setShowTodayAdjustHistory((prev) => !prev)}
          >
            -/+履歴
          </button>
        </>
      )}
    />
  );

  const patientCalendar = (
    <section className="card patientCalendarSection">
      <div className="calendarHeader compactCalendarHeader">
        <button className="calNavBtn iconOnly" type="button" aria-label="前月" onClick={() => {
          if (calendarMonth === 1) { setCalendarMonth(12); setCalendarYear(y => y - 1); }
          else setCalendarMonth(m => m - 1);
        }}>{"<"}</button>
        <button className="calNavBtn iconOnly" type="button" aria-label="翌月" onClick={() => {
          if (calendarMonth === 12) { setCalendarMonth(1); setCalendarYear(y => y + 1); }
          else setCalendarMonth(m => m + 1);
        }}>{">"}</button>
      </div>

      <div className="calendarTwoMonths simpleCalendar">
        {[0, 1].map((monthOffset) => {
          const displayDate = new Date(calendarYear, calendarMonth - 1 + monthOffset, 1);
          const displayYear = displayDate.getFullYear();
          const displayMonth = displayDate.getMonth() + 1;
          const firstDay = new Date(displayYear, displayMonth - 1, 1).getDay();
          const daysInMonth = new Date(displayYear, displayMonth, 0).getDate();
          const todayStr = pmTodayKey();
          const cells = [];

          for (let i = 0; i < firstDay; i++) cells.push(<div key={"empty-" + displayYear + "-" + displayMonth + "-" + i} className="calDayEmpty" />);
          for (let d = 1; d <= daysInMonth; d++) {
            const dow = (firstDay + d - 1) % 7;
            const dateStr = displayYear + "-" + String(displayMonth).padStart(2, "0") + "-" + String(d).padStart(2, "0");
            const isToday = dateStr === todayStr;
            cells.push(
              <div key={dateStr} className={"calDay calDayLarge " + (dow === 0 ? "sun" : dow === 6 ? "sat" : "") + " " + (isToday ? "today" : "")}>
                <span className="calDayNum">{d}</span>
              </div>
            );
          }

          return (
            <div className="calendarMonthPanel" key={displayYear + "-" + displayMonth}>
              <h3>{displayYear}{"\u5e74"}{displayMonth}{"\u6708"}</h3>
              <div className="calendarGrid calendarLarge">
                {["\u65e5", "\u6708", "\u706b", "\u6c34", "\u6728", "\u91d1", "\u571f"].map(d => (
                  <div key={d} className={"calDayLabel " + (d === "\u65e5" ? "sun" : d === "\u571f" ? "sat" : "")}>{d}</div>
                ))}
                {cells}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );

  const annualSummaryTable = (
    <>
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
              <th>透析</th>
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
                    <td>{pmDialysisTotal(person)}</td>
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
                  <td>{data.dialysisTotal || 0}</td>
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
    </>
  );

  return (
    <div className="patientModule appShell">
      {lastAppliedMovementBatch && (
        <div className="movementUndoToast" role="status" aria-live="polite">
          <span>
            本日分までの患者移動を
            {lastAppliedMovementBatch.movements.length}件消去しました。
          </span>
          <button
            type="button"
            onClick={undoLastAppliedMovements}
          >
            元に戻す
          </button>
        </div>
      )}

      <nav className="viewTabs">
        <div className="viewTabGroup">
          <button className={view === "table" ? "active" : ""} onClick={() => setView("table")}>管理表</button>
          <button className={view === "move" ? "active" : ""} onClick={() => setView("move")}>患者移動</button>
        </div>
        <button className={view === "settings" ? "active settingsTabButton" : "settingsTabButton"} aria-label="患者振り分け設定" title="患者振り分け設定" onClick={() => setView("settings")}>
          <img alt="" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAZNSURBVHhe5ZtHqzVFEIaPETMYUVEwY9ioYBYT6A8w7MXw7Y0bwexCULdmxbRQV+pCRXcGXJjFCCbMCxNGVNT3uXwtZVGdZuYcz/F74eFyZ7prqvv0dKyZLVCbi9PFZeLyAtwnHen/NzpYvC7+6oD0B4mV13biAxEVsgb5thUrrfNEVLhWzhUrrdtEVLBWyL+UopPaXdSa6JPCFuhXcZY4JYDr3LfpnxAl8Xz8WFinubG4WvB+/iy+ELeLnYXXRuJtYQv0sSiJ+zb9WwI7XruIO8SXAj/w5yoRpZ1Mm4pHhXUw8aE4UVhtL74TNt1zoiTu2/TfCuxYnSR4nk2XeERsIiYXhX9MRA9N/CkuFkl7C5/mAVES932evUQS9nmOT2PhR5q0EloKb3lI4PSl5lqC16eka4TPgx3sYdffyzFZJZQK/1NwLeE7s8TZoiTuR/ly9iDnx+hKKBX+XbGvuMhca+EEURL9SJQvx4ViP/GeuWYZXAmbiVLh9xBJp4pPRZTW8r6oDZvcb5k5fiJ4btKeolQJ/JhdYkiJjPnCJzEWM2ZHeRiq7hL7iBbRskj/lYjsPS52E16lSrhSNGsL8bnwRhjTo8Jb0cml95UFzfnCD2OtIt86kRZS2OWHKYlKeEdYv+EzQbmahJHfhTXwvdhVtIhf+ggx1VCEHey1tiBaB/5a/ykP5WoSKzgmINbAH4IOZxWEn/hr/f9GdK0seQetgcTJYpmFf5Hfd4ou7SToab0h5v7Mw5dR+EWH632mHJSnW8eJaNr5tFhG4Zf3Ff+PFYOVm+jUeuOa6KgOEzjH32hY6xGjT+TnJP1Wbg7OeN2j/QWOvih+FNYW/3Od+8zseoQf1lYCvycRvWc03z5atGhrcaP4RXgbEaQj/VaiRccIbwN/txGjtKM4RFwifF/AZKNlYnGA6N0RTrwmyF8TfvjJT1qa4z/lqIraYgPyFsGUlp0YPxewtGxW0pSjGWUP5G95JUqbr8wBKA/lulng+79aB/vvzPGjzBFfi1rzovny0Cg/vCTY8Lx+/V/+j9IBdmqvA68pfkX5I2gxa+cOW67/J0qU4x5R000iyvuMyC2Juc79KB99Qk33iihvDso9O9NcaIFMtd6f3Ru/lgAcrG1acj8qyG/Cbo1Fwq/eH3N2hbsA7LJ+JJ4V9wuGJnZq+IVoMTVdK7zNF0SPSO9tsF1WE/7hJ/7iN/6z0Up5KJe3GVYArWLMPvurwts8SvSI9N4GdoeK8kStfe1E1l88XgwVS2Y/3r8shugVYe1gt3VJHolyWXsQVgCnNEN1uPD2GHqGiHzeFvaHinJ5e5NXAAsob48+YYiuE94W9odqIRUwZQtgUuZtLaQFbFB9wLKOAiy0vA0qZKiyo0BUAdQ0p7SMn5zVMf4yrnJo0TIPiI63FjUPYMqMn/hLevynHJTHt0yYneEu1Bg7E+R4vSTu3yd83rnNBBe9FmB2WVoLcD/KN4+1AOcca2JV1FMJU60GCaxgNchfOsooHbwpaq/ekNXggeIfpf0AhizWzTyUdXSUGVZtP4DypP2AcwS7VFXtINhRiYISqMHWHSF2dmzeVsjHPmJN0Wtsd4QoxyiN3RPkdbhBRL1wBOlIX9sEScrtCXadBJX0sPAPgNpo4EVTTrvCPwhri/+5znZ7S5O3wg9rKzHJrvC8zgWY0R0q+PX4O2aGh3LH+aPOBXInQ0+JZVTuZGjQAoq4v1U8G8Q/7/Ogs8Hc6TAxesusSU6Hc/EBF4hV0Oj4gFyESOsBJr3ykWLKCBHstY46oyNEcjFCTDZqRhjmbIwQMT5jY4TeENjDLvZLwr9oWt8VI4SIqvJGgCisqBJKUWJEe90tWn9B0pE+FyXGc3ieF35NEiWGiKsjvi4y5ivhNNESJ9jyBQj3W+IEeV5rnCAB1N1xgoh3r1QJzNh6I0V9RLlXb6Qoz8ePXOFHh8uWKiE6aUnk5v3s1JTE/ShfaR2R82N04ZNKlRDxoGD3ZqpoceITsPefRIsntVQC006aZNI8vhfAfjQ9t0xe+CSM0qFED53qi5HnhU0ffTHCcxb+xUgSx9esvIj85t1bxDdDkXgez+X5+IE/+DXXb4as2GffIL8a69XY7wZvFSutDf7L0daZXUTLzHElxLlD784w6ef89fhs9jdogpC2NFoaJgAAAABJRU5ErkJggg==" />
        </button>
      </nav>

      {view === "table" && (
        <>
          {table}
          {showTodayAdjustHistory && (
            <section className="card todayAdjustHistoryCard">
              <div className="cardHeader compactHistoryHeader">
                <h2>-+履歴</h2>
                <span>{pmDisplayDate(pmTodayKey())}</span>
              </div>
              <div className="historyList todayAdjustHistoryList">
                {todayAdjustHistory.length === 0 ? (
                  <p className="emptyText">本日の-+履歴はありません。</p>
                ) : (
                  todayAdjustHistory.map((item) => (
                    <div className="historyItem todayAdjustHistoryItem" key={item.id}>
                      <span>{pmDisplayDate(item.date)}</span>
                      <strong>{item.staffName}</strong>
                      <span>{item.action}</span>
                      <span>{item.pmDepartmentShort}</span>
                      <span className={Number(item.delta) >= 0 ? "plus" : "minus"}>
                        {Number(item.delta) >= 0 ? "+" : ""}{item.delta}
                      </span>
                      <span className="historyUpdater">更新者：{item.updatedByName || "記録なし"}</span>
                    </div>
                  ))
                )}
              </div>
            </section>
          )}
          {patientCalendar}
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
          </div>

          <form className="moveForm compactMoveForm" onSubmit={registerMovement}>
            <div className="moveFormQuartet">
              <div className="autoStaffBox">
                <span>担当者</span>
                <strong>{autoMovementStaff ? pmPersonName(autoMovementStaff) : "未設定"}</strong>
              </div>
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
            </div>

            <label className="memoInlineField">
              <input
                value={movementForm.note}
                placeholder="メモ"
                onChange={(e) => setMovementForm({ ...movementForm, note: e.target.value })}
              />
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
            <h2>履歴・集計</h2>
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
                  <th>透析</th>
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
                        <td>{pmDialysisTotal(person)}</td>
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
                      <td>{data.dialysisTotal || 0}</td>
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
                      <span className="historyUpdater">更新者：{item.updatedByName || "記録なし"}</span>
                      {item.note && <small>{item.note}</small>}
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </section>
      )}

      {view === "settings" && (
        <section className="card">
          <h2>患者振り分け設定</h2>
          <p className="settingLead">患者振り分けで使用するスタッフ、表示順、集計を管理します。</p>

          <div className="settingsLayout">
            <div className="settingsMenuList" aria-label="設定メニュー">
              <button className={settingsView === "register" ? "active" : ""} type="button" onClick={() => setSettingsView("register")}>
                <span className="settingsMenuIcon">＋</span>
                <span className="settingsMenuText">
                  <strong>スタッフ管理</strong>
                  <small>登録・連携状態・表示を管理</small>
                </span>
                <span className="settingsMenuArrow">›</span>
              </button>
              <button className={settingsView === "order" ? "active" : ""} type="button" onClick={() => setSettingsView("order")}>
                <span className="settingsMenuIcon">↕</span>
                <span className="settingsMenuText">
                  <strong>表示順並べ替え</strong>
                  <small>管理表の並びを調整</small>
                </span>
                <span className="settingsMenuArrow">›</span>
              </button>
              <button className={settingsView === "summary" ? "active" : ""} type="button" onClick={() => setSettingsView("summary")}>
                <span className="settingsMenuIcon">Σ</span>
                <span className="settingsMenuText">
                  <strong>集計</strong>
                  <small>年度集計と保存</small>
                </span>
                <span className="settingsMenuArrow">›</span>
              </button>
              <button className={settingsView === "backup" ? "active" : ""} type="button" onClick={() => setSettingsView("backup")}>
                <span className="settingsMenuIcon">⤓</span>
                <span className="settingsMenuText">
                  <strong>バックアップ</strong>
                  <small>JSON保存・復元・容量確認</small>
                </span>
                <span className="settingsMenuArrow">›</span>
              </button>
            </div>

            <div className="settingsContentPanel">
          {settingsView === "register" ? (
            <>
              <h3>{profession} スタッフ管理</h3>
              <p className="settingHelp">連携状態は staff の uid の有無、管理表表示は visible で判定します。visible未設定のスタッフは表示扱いです。</p>

              <button
                className="staffFormToggle"
                type="button"
                onClick={() => setShowStaffForm((prev) => !prev)}
              >
                <span>{showStaffForm ? "−" : "＋"}</span>
                <strong>新規スタッフ登録</strong>
                <small>{showStaffForm ? "閉じる" : "姓・名・職種・がんリハ実施権を登録"}</small>
              </button>

              {showStaffForm && (
                <form className="staffForm cancerRightForm staffRegisterForm compactStaffRegisterForm" onSubmit={addStaff}>
                  <div className="staffFormPair">
                    <label>
                      <span>姓</span>
                      <input value={staffForm.lastName} onChange={(e) => setStaffForm({ ...staffForm, lastName: e.target.value })} />
                    </label>
                    <label>
                      <span>名</span>
                      <input value={staffForm.firstName} onChange={(e) => setStaffForm({ ...staffForm, firstName: e.target.value })} />
                    </label>
                  </div>

                  <div className="staffFormPair">
                    <label>
                      <span>職種</span>
                      <select value={staffForm.profession} onChange={(e) => setStaffForm({ ...staffForm, profession: e.target.value })}>
                        <option value="PT">PT</option>
                        <option value="OT">OT</option>
                      </select>
                    </label>
                    <label className="checkSetting">
                      <span>がんリハ実施権</span>
                      <div className="cancerPermissionToggle">
                        <button
                          type="button"
                          className={staffForm.canCancerRehab ? "active" : ""}
                          onClick={() => setStaffForm({ ...staffForm, canCancerRehab: true })}
                        >
                          可
                        </button>
                        <button
                          type="button"
                          className={!staffForm.canCancerRehab ? "active" : ""}
                          onClick={() => setStaffForm({ ...staffForm, canCancerRehab: false })}
                        >
                          否
                        </button>
                      </div>
                    </label>
                  </div>

                  <button className="primaryButton" type="submit">追加</button>
                </form>
              )}

              <div className="orderList staffManageList compactStaffManageList">
                {professionStaff.map((person) => (
                  <div className={`compactStaffCard oneLineStaffCard ${person.visible === false ? "staffHiddenRow" : ""}`} key={person.id}>
                    <div className="oneLineStaffName displayNameChoiceGroup" aria-label={`${pmPersonName(person)}の管理表表示名`}>
                      <button
                        className={`displayNameChoice ${person.displayNameMode === "first" ? "" : "active"}`}
                        type="button"
                        onClick={() => updateStaffDisplayNameMode(person.id, "last")}
                        title="管理表に名字を表示"
                      >
                        {person.lastName || splitDisplayName(person.name).lastName || "姓"}
                      </button>
                      <button
                        className={`displayNameChoice ${person.displayNameMode === "first" ? "active" : ""}`}
                        type="button"
                        onClick={() => updateStaffDisplayNameMode(person.id, "first")}
                        title="管理表に名前を表示"
                      >
                        {person.firstName || splitDisplayName(person.name).firstName || "名"}
                      </button>
                      <span className="staffProfessionBadge">{person.profession}</span>
                    </div>

                    <span className={`staffLinkBadge ${person.uid ? "linked" : "unlinked"}`}>
                      {person.uid ? "連携済" : "未連携"}
                    </span>

                    <button
                      className={`staffVisibleBadge badgeAction ${person.visible === false ? "hidden" : "shown"}`}
                      type="button"
                      onClick={() => updateStaffVisibility(person.id, person.visible === false)}
                      aria-label={`${pmPersonName(person)}の管理表表示を切り替え`}
                    >
                      {person.visible === false ? "非表示中" : "表示中"}
                    </button>

                    <button
                      className={`staffCancerBadge badgeAction ${person.canCancerRehab ? "allowed" : "denied"}`}
                      type="button"
                      onClick={() => updateCancerPermission(person.id, !person.canCancerRehab)}
                      aria-label={`${pmPersonName(person)}のがんリハ可否を切り替え`}
                    >
                      {person.canCancerRehab ? "がん可" : "がん不可"}
                    </button>

                    <button className="deleteButton compactDeleteButton oneLineDeleteButton" type="button" onClick={() => deleteStaff(person.id)}>削除</button>
                  </div>
                ))}
              </div>
            </>
          ) : settingsView === "order" ? (
            <>
              <h3>{profession} 表示順</h3>
              <p className="settingHelp">連携状態はGoogleアカウント連携の有無、表示状態は患者振り分けの管理表に出すかどうかです。</p>
              <div className="orderList">
                {professionStaff.map((person) => (
                  <div className={`orderItem ${person.visible === false ? "staffHiddenRow" : ""}`} key={person.id}>
                    <div className="staffOrderName">
                      <strong>{pmPersonName(person)}</strong>
                      <div className="staffStatusBadges">
                        <span className={`staffLinkBadge ${person.uid ? "linked" : "unlinked"}`}>
                          {person.uid ? "連携済" : "未連携"}
                        </span>
                        <button
                          className={`staffVisibleBadge badgeAction ${person.visible === false ? "hidden" : "shown"}`}
                          type="button"
                          onClick={() => updateStaffVisibility(person.id, person.visible === false)}
                        >
                          {person.visible === false ? "非表示中" : "表示中"}
                        </button>
                        <button
                          className={`staffCancerBadge badgeAction ${person.canCancerRehab ? "allowed" : "denied"}`}
                          type="button"
                          onClick={() => updateCancerPermission(person.id, !person.canCancerRehab)}
                        >
                          {person.canCancerRehab ? "がん可" : "がん不可"}
                        </button>
                      </div>
                    </div>
                    <div>
                      <button type="button" onClick={() => moveStaffOrder(person.id, -1)}>↑</button>
                      <button type="button" onClick={() => moveStaffOrder(person.id, 1)}>↓</button>
                      <button className="deleteButton" type="button" onClick={() => deleteStaff(person.id)}>削除</button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : settingsView === "summary" ? (
            <>
              <div className="cardHeader settingsSummaryHeader">
                <h3>集計</h3>
                <button className="softButton" type="button" onClick={saveFiscalSnapshot}>今年度を保存</button>
              </div>
              {annualSummaryTable}
            </>
          ) : (
            <>
              <div className="cardHeader settingsSummaryHeader">
                <h3>バックアップ・復元</h3>
                <button className="softButton" type="button" onClick={downloadPatientManagerBackup}>JSONを保存</button>
              </div>
              <p className="settingHelp">
                患者振り分けの現在データをJSONで保存できます。復元は選択したJSONで現在データを上書きします。
                Firestoreの容量上限を避けるため、直近スナップショットは一時停止しています。
              </p>

              <div className="backupActionGrid">
                <button className="primaryButton backupMainButton" type="button" onClick={downloadPatientManagerBackup}>
                  バックアップをダウンロード
                </button>
                <label className="restoreFileButton">
                  <span>JSONから復元</span>
                  <input type="file" accept="application/json,.json" onChange={restorePatientManagerFromFile} />
                </label>
              </div>

              <div className={`systemStatusBox ${patientManagerSizeLevel}`}>
                <div className="systemStatusHeader">
                  <div>
                    <h4>システム状態</h4>
                    <p className="settingHelp">患者振り分け本体の推定データ容量です。</p>
                  </div>
                  <strong>{patientManagerUsagePercent}%</strong>
                </div>

                <div className="systemStatusMeter">
                  <span style={{ width: `${patientManagerUsagePercent}%` }} />
                </div>

                <div className="systemStatusDetails">
                  <div>
                    <span>現在の推定容量</span>
                    <strong>{formatPatientManagerSize(patientManagerSizeBytes)}</strong>
                  </div>
                  <div>
                    <span>Firestore上限</span>
                    <strong>1,024 KB</strong>
                  </div>
                  <div>
                    <span>判定</span>
                    <strong>
                      {patientManagerSizeLevel === "danger"
                        ? "容量に注意"
                        : patientManagerSizeLevel === "warning"
                          ? "やや増加"
                          : "正常"}
                    </strong>
                  </div>
                </div>

                <p className="systemStatusNote">
                  65%以上で注意、85%以上で警告表示します。表示値は概算です。
                </p>
              </div>

              <div className="backupSnapshotBox">
                <h4>直近スナップショット</h4>
                <p className="settingHelp">
                  Firestoreの1ドキュメント容量上限を避けるため、一時停止しています。
                  必要な時点では「バックアップをダウンロード」を使用してください。
                </p>
              </div>
            </>
          )}
            </div>

            <section className="appInfoPanel">
              <div className="appInfoHeader">
                <div>
                  <h3>アプリ情報</h3>
                  <p className="settingHelp">表示不具合がある場合は、最新版確認またはキャッシュ削除を使用してください。</p>
                </div>
                {pwaInfo.needRefresh && <span className="appUpdateBadge">更新あり</span>}
              </div>

              <div className="appInfoGrid">
                <div>
                  <span>バージョン</span>
                  <strong>{pwaInfo.version}</strong>
                </div>
                <div>
                  <span>PWA</span>
                  <strong>{window.matchMedia?.("(display-mode: standalone)")?.matches ? "インストール済" : "ブラウザ表示"}</strong>
                </div>
                <div>
                  <span>更新状態</span>
                  <strong>{pwaInfo.needRefresh ? "新しい版があります" : "最新版"}</strong>
                </div>
              </div>

              <div className="appInfoActions">
                {pwaInfo.needRefresh ? (
                  <button className="primaryButton" type="button" onClick={onPwaApplyUpdate}>
                    最新版へ更新
                  </button>
                ) : (
                  <button className="softButton" type="button" onClick={onPwaUpdateCheck} disabled={pwaChecking}>
                    {pwaChecking ? "確認中..." : "最新版を確認"}
                  </button>
                )}

                <button className="softButton" type="button" onClick={onPwaCacheClear}>
                  キャッシュ削除・再読み込み
                </button>
              </div>
            </section>
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
  updateOutpatientDetail,
  updateDialysisDetail,
  updateNote,
  movementsForStaffDisplay,
  quickAdjust,
  quickAdjustOutpatient,
  quickAdjustDialysis,
  quickAdjustStopped,
  activeCell,
  setActiveCell,
  onEditMovement,
  onClearDueMovements,
  sectionActions,
}) {
  const [activeStaffId, activeDeptKey] = activeCell ? activeCell.split(":") : [null, null];
  const activeRowIndex = staffList.findIndex((person) => person.id === activeStaffId);
  const activeStoppedPerson = activeDeptKey === "stopped"
    ? staffList.find((person) => person.id === activeStaffId)
    : null;
  const activeStoppedDetail = activeStoppedPerson ? pmStoppedDetail(activeStoppedPerson) : {};
  const [notePopup, setNotePopup] = useState(null); // staffId or null
  const [noteEditMode, setNoteEditMode] = useState(false);
  const [noteEditValue, setNoteEditValue] = useState("");

  const compactNameMeta = useMemo(() => {
    const lastNameCounts = {};
    const lastInitialCounts = {};

    staffList.forEach((person) => {
      const lastName = pmLastName(person);
      const familyKey = pmNormalizeFamilyNameForCompact(lastName);
      const firstInitial = pmFirstChar(person.firstName);
      lastNameCounts[familyKey] = (lastNameCounts[familyKey] || 0) + 1;
      if (firstInitial) {
        const initialKey = `${familyKey}::${firstInitial}`;
        lastInitialCounts[initialKey] = (lastInitialCounts[initialKey] || 0) + 1;
      }
    });

    return { lastNameCounts, lastInitialCounts };
  }, [staffList]);

  function renderNameCell(person) {
    const displayName = pmTableDisplayName(person);
    return (
      <>
        <span className="fullNameDesktop">{displayName}</span>
        <span className="compactNameMobile">
          <span className="compactLastName">{displayName}</span>
        </span>
      </>
    );
  }
  function showOutpatientSummary() {
    const lines = staffList.map((person) => {
      const detail = pmOutpatientDetail(person);
      const tags = [
        detail.general > 0 ? `[一般${detail.general}]` : "",
        detail.student > 0 ? `[夕${detail.student}]` : "",
      ].filter(Boolean).join("");
      return `${pmPersonName(person)} ${tags || "[一般0]"}`;
    });
    alert(lines.join("\n"));
  }

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
              <th className="totalCol stickyTotal">合計</th>
              {PM_DEPARTMENTS.map((dept) => (
                <th key={dept.key} className={`deptHead ${dept.key} sep-${dept.key} ${activeDeptKey === dept.key ? "activeDeptGuide" : ""}`}>
                  <span>{dept.short}</span>
                  {dept.key === "outpatient" && (
                    <button
                      type="button"
                      className="infoButton headerInfo"
                      title="外来内訳"
                      onClick={showOutpatientSummary}
                    >
                      i
                    </button>
                  )}
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
              <th className={`dialysisCol ${activeDeptKey === "dialysis" ? "activeDeptGuide" : ""}`}>透析</th>
              <th className="moveCol">
                <span className="moveHeaderInline">
                  患者移動
                  <button
                    type="button"
                    className="clearDueButton"
                    onClick={(e) => {
                      e.stopPropagation();
                      onClearDueMovements();
                    }}
                  >
                    本日分までを消去
                  </button>
                </span>
              </th>
              <th className="noteCol">備考</th>
            </tr>
          </thead>

          <tbody>
            {staffList.map((person, rowIndex) => {
              return (
                <tr key={person.id} className={person.canCancerRehab ? "cancerRehabRow" : ""}>
                  <th className={`stickyName nameCol ${activeStaffId === person.id ? "activeNameGuide" : ""}`}>
                    <div className="nameCell">
                      <strong>{renderNameCell(person)}</strong>
                    </div>
                  </th>
                  <td className={`totalCol stickyTotal totalNumber ${activeStaffId === person.id ? "tRowGuide tRowAfterCell" : ""}`}>{pmCountTotal(person)}</td>

                  {PM_DEPARTMENTS.map((dept) => {
                    const disabled = dept.key === "cancer" ? !person.canCancerRehab : false;
                    const outpatientDetail = pmOutpatientDetail(person);
                    const stoppedDetail = pmStoppedDetail(person);
                    const stoppedTotal = pmStoppedTotal(person);
                    const value = dept.key === "outpatient" ? pmOutpatientTotal(person) : dept.key === "stopped" ? stoppedTotal : Number(person.counts?.[dept.key] || 0);
                    const changed = isChangedToday(person.id, dept.key);
                    const cellKey = `${person.id}:${dept.key}`;
                    const isActive = activeCell === cellKey;
                    const hasStudent = dept.key === "outpatient" && outpatientDetail.student > 0;
                    const stoppedSource = dept.key !== "stopped" && Number(stoppedDetail[dept.key] || 0) > 0 && !changed;

                    return (
                      <td
                        key={dept.key}
                        className={`numberCell dept-${dept.key} sep-${dept.key} ${changed ? "changed" : ""} ${stoppedSource ? "stoppedSource" : ""} ${activeStaffId === person.id ? "tRowGuide" : ""} ${activeDeptKey === dept.key ? "tColGuide" : ""} ${isActive ? "tActiveCell" : ""}`}
                        onClick={() => {
                          if (!disabled) setActiveCell(isActive ? null : cellKey);
                        }}
                      >
                      {disabled ? (
  <span className="disabledCancerMark">—</span>
) : isActive && dept.key === "outpatient" ? (
                          <div className="outpatientAdjust" onClick={(e) => e.stopPropagation()}>
                            <div className="outpatientAdjustRow">
                              <span>一般</span>
                              <button type="button" className="inlineBtn minus" onClick={() => quickAdjustOutpatient(person.id, "general", -1)}>−</button>
                              <b>{outpatientDetail.general}</b>
                              <button type="button" className="inlineBtn plus" onClick={() => quickAdjustOutpatient(person.id, "general", 1)}>＋</button>
                            </div>
                            <div className="outpatientAdjustRow">
                              <span>夕方</span>
                              <button type="button" className="inlineBtn minus" onClick={() => quickAdjustOutpatient(person.id, "student", -1)}>−</button>
                              <b>{outpatientDetail.student}</b>
                              <button type="button" className="inlineBtn plus" onClick={() => quickAdjustOutpatient(person.id, "student", 1)}>＋</button>
                            </div>
                          </div>
                        ) : isActive && dept.key === "stopped" ? (
                          <div className="plainNumberLine">
                            <input
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              value={value}
                              readOnly
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveCell(cellKey);
                              }}
                            />
                          </div>
                        ) : isActive && !disabled ? (
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
                              readOnly={dept.key === "stopped"}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!disabled) setActiveCell(cellKey);
                              }}
                              onFocus={() => {
                                if (!disabled) setActiveCell(cellKey);
                              }}
                              onChange={(e) => {
                                if (dept.key !== "stopped") updateCount(person.id, dept.key, e.target.value.replace(/[^0-9]/g, ""));
                              }}
                            />
                            {hasStudent && <span className="studentMark">夕</span>}
                          </div>
                        )}
                      </td>
                    );
                  })}

                  <td
                  className={`dialysisCol ${isChangedToday(person.id, "dialysis") ? "changed" : ""} ${activeCell === `${person.id}:dialysis` ? "tActiveCell" : ""}`}
                    onClick={() => setActiveCell(activeCell === `${person.id}:dialysis` ? null : `${person.id}:dialysis`)}
                  >
                    {activeCell === `${person.id}:dialysis` ? (
                      <div className="dialysisAdjust" onClick={(e) => e.stopPropagation()}>
                        {PM_DIALYSIS_TYPES.map((type) => {
                          const detail = pmDialysisDetail(person);
                          return (
                            <div className="dialysisAdjustRow" key={type.key}>
                              <span>{type.short}</span>
                              <button type="button" className="inlineBtn minus" onClick={() => quickAdjustDialysis(person.id, type.key, -1)}>−</button>
                              <b>{detail[type.key]}</b>
                              <button type="button" className="inlineBtn plus" onClick={() => quickAdjustDialysis(person.id, type.key, 1)}>＋</button>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="dialysisTagList">
                        {PM_DIALYSIS_TYPES.filter((type) => pmDialysisDetail(person)[type.key] > 0).length === 0 ? (
                          <span className="dialysisTotal">0</span>
                        ) : (
                          PM_DIALYSIS_TYPES.filter((type) => pmDialysisDetail(person)[type.key] > 0).map((type) => (
                            <span className={`dialysisTag dialysis-${type.key}`} key={type.key}>{type.short}{pmDialysisDetail(person)[type.key]}</span>
                          ))
                        )}
                      </div>
                    )}
                  </td>
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

      {activeStoppedPerson && (
        <div className="stoppedAdjustOverlay" onClick={() => setActiveCell(null)}>
          <div className="stoppedAdjust" onClick={(e) => e.stopPropagation()}>
            {PM_STOPPED_DEPARTMENTS.map((targetDept) => {
              const targetCount = Number(activeStoppedPerson.counts?.[targetDept.key] || 0);
              const stoppedCount = Number(activeStoppedDetail[targetDept.key] || 0);
              const noPatient = targetCount <= 0;
              const canMinusStopped = stoppedCount > 0;
              const canPlusStopped = !noPatient && stoppedCount < targetCount;

              return (
                <div className={`stoppedAdjustRow ${noPatient ? "disabled" : ""}`} key={targetDept.key}>
                  <span>{targetDept.short}</span>
                  <button
                    type="button"
                    className="inlineBtn minus"
                    disabled={!canMinusStopped}
                    onClick={() => quickAdjustStopped(activeStoppedPerson.id, targetDept.key, -1)}
                  >−</button>
                  <b>{stoppedCount}</b>
                  <button
                    type="button"
                    className="inlineBtn plus"
                    disabled={!canPlusStopped}
                    onClick={() => quickAdjustStopped(activeStoppedPerson.id, targetDept.key, 1)}
                  >＋</button>
                </div>
              );
            })}
          </div>
        </div>
      )}

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
