import React, { useEffect, useMemo, useState } from "react";
import "./App.css";

const FULL_DAY_HOURS = 7.75;
const MORNING_HOURS = 3.5;
const AFTERNOON_HOURS = 4.25;
const SUMMER_LIMIT = 5;

const DEFAULT_STAFF = [
  { id: "s1", name: "山田 太郎", job: "PT", role: "admin" },
  { id: "s2", name: "田中 美咲", job: "PT", role: "staff" },
  { id: "s3", name: "佐藤 健", job: "PT", role: "staff" },
  { id: "s4", name: "高橋 優", job: "PT", role: "staff" },
  { id: "s5", name: "吉田 彩", job: "OT", role: "staff" },
  { id: "s6", name: "伊藤 翔", job: "OT", role: "staff" },
  { id: "s7", name: "渡辺 葵", job: "OT", role: "staff" },
  { id: "s8", name: "中村 蓮", job: "OT", role: "staff" },
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

function pad(n) {
  return String(n).padStart(2, "0");
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
function personName(person) {
  if (!person) return "";

  const lastName = person.lastName || "";
  const firstName = person.firstName || "";

  if (lastName || firstName) {
    return `${lastName} ${firstName}`.trim();
  }

  return person.name || "";
}
export default function App() {
  const today = new Date();

  const [staff, setStaff] = useState(() => {
    const saved = localStorage.getItem("leaveStaffV3");
    return saved ? JSON.parse(saved) : DEFAULT_STAFF;
  });

  const [records, setRecords] = useState(() => {
    const saved = localStorage.getItem("leaveRecordsV3");
    return saved ? JSON.parse(saved) : [];
  });

  const [loginId, setLoginId] = useState(staff[0]?.id || "s1");
  const [view, setView] = useState("calendar");
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [selectedDate, setSelectedDate] = useState(null);
  const [showStaffEdit, setShowStaffEdit] = useState(false);

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

  useEffect(() => {
    localStorage.setItem("leaveStaffV3", JSON.stringify(staff));
  }, [staff]);

  useEffect(() => {
    localStorage.setItem("leaveRecordsV3", JSON.stringify(records));
  }, [records]);

  const loginUser = staff.find((s) => s.id === loginId) || staff[0];
  const isAdmin = loginUser?.role === "admin";
  const currentFy = fiscalYear(`${year}-${pad(month)}-01`);

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

  function leaveRecordsForDate(date) {
    return recordsForDate(date).filter((r) => isLeaveLike(r));
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

  function removeRecord(id) {
    setRecords((prev) => prev.filter((r) => r.id !== id));
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
      saturday: list.filter((r) => r.type === "saturday").length,
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
    return recordsForDate(selectedDate);
  }

  function toggleDate(date) {
    setSelectedDate((current) => (current === date ? null : date));
  }

  function addStaff() {
    setStaff((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        name: "新規 職員",
        job: "PT",
        role: "staff",
      },
    ]);
  }

  function updateStaff(id, key, value) {
    setStaff((prev) => prev.map((s) => (s.id === id ? { ...s, [key]: value } : s)));
  }

  function deleteStaff(id) {
    if (staff.length <= 1) return;
    setStaff((prev) => prev.filter((s) => s.id !== id));
    setRecords((prev) => prev.filter((r) => r.staffId !== id));
    if (loginId === id) setLoginId(staff[0].id);
    if (form.staffId === id) setForm((prev) => ({ ...prev, staffId: staff[0].id }));
  }

  const showTimeInputs = ["paid", "child"].includes(form.type) && form.method === "time";
  const showMethod = ["paid", "child"].includes(form.type);
  const showBreakCheck =
    showTimeInputs &&
    overlapMinutes(toMinutes(form.start), toMinutes(form.end), toMinutes("12:00"), toMinutes("13:00")) > 0;

  return (
    <div className="appShell">
      <header className="appHeader">
        <div>
          <h1>一般・外来 休暇管理</h1>
          <p>PT / OTの休暇予定、土日勤務、有休・看護休暇・夏季休暇の集計</p>
        </div>

        <label className="loginSelect">
          <span>表示</span>
          <select value={loginId} onChange={(e) => setLoginId(e.target.value)}>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {personName(s)} {s.job}{s.role === "admin" ? "（科長）" : ""}
              </option>
            ))}
          </select>
        </label>
      </header>

      <section className="card">
        <div className="cardTitleRow">
          <h2>休暇・勤務登録</h2>
          <button className="softButton" type="button" onClick={() => setShowStaffEdit(true)}>
            職員編集
          </button>
        </div>

        <div className="formGrid">
          <label>
            <span>職員</span>
            <select value={form.staffId} onChange={(e) => setForm({ ...form, staffId: e.target.value })}>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {personName(s)} {s.job}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>日付</span>
            <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
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

              return (
                <button
                  key={date}
                  type="button"
                  onClick={() => toggleDate(date)}
                  className={[
                    "calendarCell",
                    weekday === 0 ? "sunday" : "",
                    weekday === 6 ? "saturdayCell" : "",
                    selectedDate === date ? "selected" : "",
                  ].join(" ")}
                >
                  <span className="dayNumber">{day}</span>

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
        <SummaryView staff={staff} isAdmin={isAdmin} loginId={loginId} summary={summary} fiscalYear={currentFy} />
      )}

      {selectedDate && (
        <div className="modalBackdrop" onClick={() => setSelectedDate(null)}>
          <div className="dayModal" onClick={(e) => e.stopPropagation()}>
            <div className="modalHeader">
              <h2>{selectedDate.replaceAll("-", "/")}</h2>
              <button className="closeButton" type="button" onClick={() => setSelectedDate(null)}>
                ×
              </button>
            </div>

            {selectedRecords().length === 0 ? (
              <p className="emptyText">この日の登録はありません。</p>
            ) : (
              <div className="detailList">
                {selectedRecords().map((r) => (
                  <div key={r.id} className={`detailItem ${r.type}`}>
                    <div>
                      <strong>
                        {personName(r.staff)}　{r.staff.job}
                      </strong>
                      <p>{recordDisplay(r)}</p>
                      {r.note && <small>{r.note}</small>}
                    </div>
                    <button type="button" className="deleteButton" onClick={() => removeRecord(r.id)}>
                      削除
                    </button>
                  </div>
                ))}
              </div>
            )}
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
              {staff.map((s) => (
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
    </div>
  );
}

function SummaryView({ staff, isAdmin, loginId, summary, fiscalYear }) {
  const visibleStaff = isAdmin ? staff : staff.filter((s) => s.id === loginId);

  return (
    <section className="summaryCard">
      <h2>{fiscalYear}年度 集計</h2>
      {!isAdmin && <p className="emptyText">一般職員は自分の集計のみ表示します。</p>}

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
            {visibleStaff.map((s) => {
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
