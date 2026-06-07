import React, { useEffect, useMemo, useState } from "react";
import "./App.css";

const PROFESSIONS = ["PT", "OT"];


const DEPARTMENTS = [
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


const MOVE_TYPES = [
  { key: "discharge", label: "退院", short: "退" },
  { key: "recovery", label: "回復期", short: "3W" },
  { key: "community", label: "地域包括", short: "5W" },
  { key: "transfer", label: "転院", short: "転" },
];

const EMPTY_COUNTS = Object.fromEntries(DEPARTMENTS.map((d) => [d.key, 0]));

const SAMPLE_STAFF = [
  {
    id: "pt1",
    profession: "PT",
    type: "main",
    canCancerRehab: true,
    lastName: "山田",
    firstName: "太郎",
    order: 1,
    counts: { ...EMPTY_COUNTS, outpatient: 5, ortho: 3, neuroSurgery: 1, cancer: 1, neuroInternal: 1, internal: 5 },
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
    counts: { ...EMPTY_COUNTS, outpatient: 5, ortho: 2, surgery: 1, cancer: 1, neuroInternal: 1, internal: 5 },
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
    counts: { ...EMPTY_COUNTS, outpatient: 5, ortho: 3, neuroSurgery: 1, neuroInternal: 2, internal: 5 },
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
    counts: { ...EMPTY_COUNTS, outpatient: 2, ortho: 2, neuroSurgery: 1, neuroInternal: 2, internal: 6 },
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
    counts: { ...EMPTY_COUNTS, ortho: 4, neuroSurgery: 1, internal: 3 },
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
    counts: { ...EMPTY_COUNTS, ortho: 3, cancer: 1, internal: 4 },
    note: "",
  },
];

function pad(value) {
  return String(value).padStart(2, "0");
}

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fiscalYear(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  return d.getMonth() + 1 >= 4 ? d.getFullYear() : d.getFullYear() - 1;
}

function personName(staff) {
  return `${staff.lastName || ""} ${staff.firstName || ""}`.trim() || "未設定";
}

function departmentShort(key) {
  return DEPARTMENTS.find((item) => item.key === key)?.short || key;
}

function moveShort(key) {
  return MOVE_TYPES.find((item) => item.key === key)?.short || key;
}

function moveLabel(key) {
  return MOVE_TYPES.find((item) => item.key === key)?.label || key;
}

function displayDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(`${dateStr}T00:00:00`);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function normalizeStaff(staff, index = 0) {
  return {
    id: staff.id || crypto.randomUUID(),
    profession: staff.profession || "PT",
    type: staff.type || "main",
    canCancerRehab: Boolean(staff.canCancerRehab),
    lastName: staff.lastName || "",
    firstName: staff.firstName || "",
    order: Number(staff.order || index + 1),
    counts: { ...EMPTY_COUNTS, ...(staff.counts || {}) },
    note: staff.note || "",
  };
}

function countTotal(staff) {
  return DEPARTMENTS.filter((dept) => dept.key !== "stopped" && dept.key !== "outpatient").reduce(
    (sum, dept) => sum + Number(staff.counts?.[dept.key] || 0),
    0
  );
}

function isDue(movement) {
  return !movement.done && String(movement.date || "") <= todayKey();
}

function JapaneseDateInput({ value, onChange }) {
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
    onChange(`${year}-${pad(month)}-${pad(day)}`);
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
              const key = `${year}-${pad(month)}-${pad(day)}`;
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
              onChange(todayKey());
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

export default function App() {
  const [profession, setProfession] = useState("PT");
  const [view, setView] = useState("table");
  const [fullTable, setFullTable] = useState(false);
  const [staff, setStaff] = useState(() => {
    const saved = localStorage.getItem("assignmentTableStaffV1");
    return saved ? JSON.parse(saved).map(normalizeStaff) : SAMPLE_STAFF.map(normalizeStaff);
  });
  const [movements, setMovements] = useState(() => {
    const saved = localStorage.getItem("assignmentTableMovementsV1");
    return saved ? JSON.parse(saved) : [];
  });
  const [history, setHistory] = useState(() => {
    const saved = localStorage.getItem("assignmentTableHistoryV1");
    return saved ? JSON.parse(saved) : [];
  });
  const [recentChanges, setRecentChanges] = useState(() => {
    const saved = localStorage.getItem("assignmentTableRecentChangesV1");
    return saved ? JSON.parse(saved) : {};
  });
  const [activeCell, setActiveCell] = useState(null);
  const [editMovement, setEditMovement] = useState(null);
  const [fiscalSnapshots, setFiscalSnapshots] = useState(() => {
    const saved = localStorage.getItem("assignmentTableFiscalSnapshotsV1");
    return saved ? JSON.parse(saved) : {};
  });
  const [selectedFiscal, setSelectedFiscal] = useState(null); // null = 今年度
  const today = new Date();
  const [calendarYear, setCalendarYear] = useState(today.getFullYear());
  const [calendarMonth, setCalendarMonth] = useState(today.getMonth() + 1);

  const [movementForm, setMovementForm] = useState({
    staffId: "",
    date: todayKey(),
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
    localStorage.setItem("assignmentTableStaffV1", JSON.stringify(staff));
  }, [staff]);

  useEffect(() => {
    localStorage.setItem("assignmentTableMovementsV1", JSON.stringify(movements));
  }, [movements]);

  useEffect(() => {
    localStorage.setItem("assignmentTableHistoryV1", JSON.stringify(history));
  }, [history]);

  useEffect(() => {
    localStorage.setItem("assignmentTableRecentChangesV1", JSON.stringify(recentChanges));
  }, [recentChanges]);

  useEffect(() => {
    localStorage.setItem("assignmentTableFiscalSnapshotsV1", JSON.stringify(fiscalSnapshots));
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

  const fiscal = fiscalYear(todayKey());
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
    return recentChanges[`${staffId}:${department}`] === todayKey();
  }

  function markChanged(staffId, department) {
    setRecentChanges((prev) => ({
      ...prev,
      [`${staffId}:${department}`]: todayKey(),
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
        fiscalYear: fiscalYear(entry.date || todayKey()),
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
        staffName: personName(targetStaff),
        done: false,
        createdAt: new Date().toISOString(),
      },
    ]);

    setMovementForm((prev) => ({ ...prev, note: "" }));
  }

  function applyDueMovements() {
    const due = movements.filter(isDue);
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
      changed[`${movement.staffId}:${movement.department}`] = todayKey();
    });
    setRecentChanges((prev) => ({ ...prev, ...changed }));

    setHistory((prev) => [
      ...due.map((movement) => ({
        id: crypto.randomUUID(),
        date: movement.date,
        createdAt: new Date().toISOString(),
        fiscalYear: fiscalYear(movement.date),
        profession: movement.profession,
        staffId: movement.staffId,
        staffName: movement.staffName,
        action: moveShort(movement.moveType),
        moveType: movement.moveType,
        department: movement.department,
        departmentShort: departmentShort(movement.department),
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
        name: personName(person),
        counts: { ...stats.byDepartment },
        total: stats.newCount,
        byMoveType: { ...stats.byMoveType },
      };
    });
    setFiscalSnapshots(prev => ({ ...prev, [`${fy}_${profession}`]: { fiscal: fy, profession, snapshot, savedAt: todayKey() } }));
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
      normalizeStaff({
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
      .filter((item) => item.staffId === staffId && item.fiscalYear === fiscal)
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
      DEPARTMENTS.map((dept) => [
        dept.key,
        list
          .filter((item) => item.department === dept.key)
          .reduce((sum, item) => sum + Math.abs(Number(item.delta || 0)), 0),
      ])
    );

    const byMoveType = Object.fromEntries(
      MOVE_TYPES.map((move) => [
        move.key,
        list
          .filter((item) => item.moveType === move.key)
          .reduce((sum, item) => sum + Math.abs(Number(item.delta || 0)), 0),
      ])
    );

    const currentTotal = DEPARTMENTS
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
      date: todayKey(),
      profession: target.profession,
      staffId,
      staffName: personName(target),
      action: diff > 0 ? "新規" : "減算",
      department,
      departmentShort: departmentShort(department),
      delta: diff,
      amount: Math.abs(diff),
    });
  }

  const table = (
    <AssignmentTable
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
    <div className="appShell">
      <header className="appHeader">
        <div className="headerTitleRow">
          <h1>担当患者人数管理</h1>

          <div className="professionTabs">
            {PROFESSIONS.map((item) => (
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
              <JapaneseDateInput value={movementForm.date} onChange={(date) => setMovementForm({ ...movementForm, date })} />
            </label>

            <label>
              <span>種類</span>
              <select value={movementForm.moveType} onChange={(e) => setMovementForm({ ...movementForm, moveType: e.target.value })}>
                {MOVE_TYPES.map((item) => (
                  <option key={item.key} value={item.key}>{item.label}</option>
                ))}
              </select>
            </label>

            <label>
              <span>科</span>
              <select value={movementForm.department} onChange={(e) => setMovementForm({ ...movementForm, department: e.target.value })}>
                {DEPARTMENTS.filter((dept) => dept.key !== "stopped").map((dept) => (
                  <option key={dept.key} value={dept.key}>{dept.label}</option>
                ))}
              </select>
            </label>

            <label>
              <span>担当者</span>
              <select value={movementForm.staffId} onChange={(e) => setMovementForm({ ...movementForm, staffId: e.target.value })}>
                {movementStaffOptions.map((person) => (
                  <option key={person.id} value={person.id}>
                    {personName(person)}
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
                      <div className="movementCardHeader">{personName(person)}</div>
                      {personMovements.map((movement) => (
                        <div className="movementItem" key={movement.id}>
                          <strong>{displayDate(movement.date)} {departmentShort(movement.department)} {moveShort(movement.moveType)}</strong>
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
                  {DEPARTMENTS.filter((dept) => dept.key !== "outpatient" && dept.key !== "stopped").map((dept) => (
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
                        <td>{personName(person)}</td>
                        <td>{Number(stats.byDepartment.outpatient || 0)}</td>
                        {DEPARTMENTS.filter((dept) => dept.key !== "outpatient" && dept.key !== "stopped").map((dept) => (
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
                      {DEPARTMENTS.filter(d => d.key !== "outpatient" && d.key !== "stopped").map(dept => (
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
                      <span>{displayDate(item.date)}</span>
                      <strong>{item.staffName}</strong>
                      <span>{item.action}</span>
                      <span>{item.departmentShort}</span>
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
              const todayStr = todayKey();
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
                        {m.staffName?.split(" ")[0] || ""} {departmentShort(m.department)} {moveShort(m.moveType)}
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
                <strong>{personName(person)}</strong>
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
                <JapaneseDateInput value={editMovement.date} onChange={(date) => setEditMovement({ ...editMovement, date })} />
              </label>
              <label>
                <span>種類</span>
                <select value={editMovement.moveType} onChange={e => setEditMovement({ ...editMovement, moveType: e.target.value })}>
                  {MOVE_TYPES.map((item) => (
                    <option key={item.key} value={item.key}>{item.label}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>科</span>
                <select value={editMovement.department} onChange={e => setEditMovement({ ...editMovement, department: e.target.value })}>
                  {DEPARTMENTS.filter(d => d.key !== "stopped").map((dept) => (
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

function AssignmentTable({
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
              {DEPARTMENTS.map((dept) => (
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
                      <strong>{personName(person)}</strong>
                    </div>
                  </th>

                  {DEPARTMENTS.map((dept) => {
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

                  <td className={`totalCol totalNumber ${activeStaffId === person.id ? "tRowGuide tRowAfterCell" : ""}`}>{countTotal(person)}</td>
                  <td className={`moveCol ${activeStaffId === person.id ? "tRowGuide tRowAfterCell" : ""}`}>
                    <div className="moveTagList">
                      {movementsForStaffDisplay(person.id).map((movement) => (
                        <span
                          key={movement.id}
                          className={`moveTag move-${movement.moveType}`}
                          onClick={(e) => { e.stopPropagation(); onEditMovement({ ...movement }); }}
                          style={{ cursor: "pointer" }}
                        >
                          {displayDate(movement.date)} {departmentShort(movement.department)} {moveShort(movement.moveType)}
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
                <span className="notePopupName">{personName(person)}</span>
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
