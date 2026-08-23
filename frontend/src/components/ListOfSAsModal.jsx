import { useState, useEffect } from "react";
import { X, Sun, Moon, ChevronDown, ChevronUp, Users } from "lucide-react";
import { fetchLiveAttendance, fetchAttendanceAnomalies, fetchEmployees } from "../hooks/useSync";

const API_BASE = (import.meta.env.VITE_API_URL || "/api").replace(/\/$/, "");
const PH_TZ = "Asia/Manila";

function getCurrentCutoff() {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: PH_TZ }));
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    cutoff: now.getDate() <= 15 ? 1 : 2,
  };
}

function cutoffLabel(year, month, cutoff) {
  const monthName = new Date(year, month - 1, 1).toLocaleString("en-PH", { month: "long" });
  return `${monthName} ${year} · ${cutoff === 1 ? "1–15" : "16–31"}`;
}

const STATUS = {
  ontime:     { bg: "#22c55e", color: "#fff", border: "#16a34a", label: "On Time" },
  late:       { bg: "#f97316", color: "#fff", border: "#ea580c", label: "Late" },
  wrongshift: { bg: "#3b82f6", color: "#fff", border: "#2563eb", label: "Wrong Shift" },
  absent:     { bg: "#ef4444", color: "#fff", border: "#dc2626", label: "Absent" },
  notlogged:  { bg: "#e2e8f0", color: "#64748b", border: "#cbd5e1", label: "Not Logged In" },
};

function deriveStatus(emp, employeeMap, anomalyMap) {
  const eid = String(emp.id);
  if (!employeeMap[eid]) {
    const isAm = (emp.duty || "AM").toUpperCase() === "AM";
    if (new Date().getHours() >= (isAm ? 13 : 18)) return "absent";
    return "notlogged";
  }
  const anomalies = anomalyMap[eid] || [];
  if (anomalies.some(r => r.startsWith("WRONG_SHIFT"))) return "wrongshift";
  if (anomalies.some(r => r.startsWith("LATE_ARRIVAL"))) return "late";
  return "ontime";
}

function getTime(eid, employeeMap, type) {
  const data = employeeMap[String(eid)];
  if (!data) return null;
  const recs = Object.values(data.records || {})
    .filter(r => r.scan_type?.includes(type))
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  if (type === "DEPARTURE") recs.reverse();
  return recs[0] ? new Date(recs[0].timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;
}

export default function ListOfSAsModal({ onClose }) {
  const [employees, setEmployees]       = useState([]);
  const [employeeMap, setEmployeeMap]   = useState({});
  const [anomalyMap, setAnomalyMap]     = useState({});
  const [tardinessMap, setTardinessMap] = useState({});
  const [loading, setLoading]           = useState(true);
  const [selectedEid, setSelectedEid]   = useState(null);
  const [detailsOpen, setDetailsOpen]   = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const cur   = getCurrentCutoff();
        const token = localStorage.getItem("access_token");
        const auth  = token ? { Authorization: `Bearer ${token}` } : {};

        const [liveRaw, anomalies, emps, tardyRes] = await Promise.all([
          fetchLiveAttendance(),
          fetchAttendanceAnomalies("false"),
          fetchEmployees(),
          fetch(`${API_BASE}/attendance/tardiness/?year=${cur.year}&month=${cur.month}&cutoff=${cur.cutoff}`, { headers: auth })
            .then(r => r.json()).catch(() => []),
        ]);

        if (cancelled) return;

        // fetchLiveAttendance returns { records: [...], server_time } or bare array
        const recordsList = Array.isArray(liveRaw) ? liveRaw : (liveRaw?.records ?? []);
        const eMap = {};
        recordsList.forEach(r => {
          const eid = String(r.employee);
          if (!eMap[eid]) eMap[eid] = { name: r.employee_name, records: {} };
          eMap[eid].records[r.scan_type] = r;
        });
        setEmployeeMap(eMap);

        // anomaly items: { employee, anomaly_type, reason }
        const aMap = {};
        (anomalies || []).forEach(a => {
          const id  = String(a.employee);
          if (!aMap[id]) aMap[id] = [];
          const tag = `${a.anomaly_type}: ${a.reason || ""}`.replace(/:\s*$/, "");
          if (!aMap[id].includes(tag)) aMap[id].push(tag);
        });
        setAnomalyMap(aMap);

        const tMap = {};
        if (Array.isArray(tardyRes)) {
          tardyRes.forEach(t => { tMap[String(t.employee_id ?? t.id)] = t; });
        }
        setTardinessMap(tMap);

        setEmployees((emps || []).filter(e => e.is_active !== false));
      } catch (err) {
        console.error("[ListOfSAsModal]", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const cur          = getCurrentCutoff();
  const amEmps       = employees.filter(e => (e.duty || "AM").toUpperCase() === "AM");
  const pmEmps       = employees.filter(e => (e.duty || "AM").toUpperCase() === "PM");
  const nowH         = new Date().getHours();
  const presentCount = employees.filter(e => employeeMap[String(e.id)]).length;
  const absentCount  = employees.filter(e => {
    if (employeeMap[String(e.id)]) return false;
    return nowH >= ((e.duty || "AM").toUpperCase() === "AM" ? 13 : 18);
  }).length;
  const notLoggedCount = employees.length - presentCount - absentCount;

  /* Tile */
  function Tile({ emp }) {
    const eid       = String(emp.id);
    const status    = deriveStatus(emp, employeeMap, anomalyMap);
    const cfg       = STATUS[status];
    const isOpen    = selectedEid === eid;
    const initials  = (emp.name || "??").slice(0, 2).toUpperCase();
    const arrival   = getTime(eid, employeeMap, "ARRIVAL");
    const departure = getTime(eid, employeeMap, "DEPARTURE");
    const anomalies = anomalyMap[eid] || [];
    const tardiness = tardinessMap[eid];

    return (
      <div style={{ position: "relative", flexShrink: 0 }}>
        <button
          title={emp.name}
          onClick={() => { if (isOpen) { setSelectedEid(null); } else { setSelectedEid(eid); setDetailsOpen(false); } }}
          style={{
            width: 52, height: 52, borderRadius: 10,
            background: cfg.bg, color: cfg.color,
            border: isOpen ? `3px solid ${cfg.border}` : `2px solid ${cfg.border}33`,
            fontWeight: 800, fontSize: 13, cursor: "pointer", letterSpacing: 0.5,
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: isOpen ? `0 0 0 3px ${cfg.bg}44, 0 6px 16px rgba(0,0,0,0.18)` : "0 1px 4px rgba(0,0,0,0.08)",
            transition: "box-shadow 0.15s, border 0.15s", outline: "none",
          }}
        >
          {initials}
        </button>

        {isOpen && (
          <div
            style={{
              position: "absolute", top: 62, left: "50%", transform: "translateX(-50%)",
              zIndex: 100, width: 236,
              background: "#fff", borderRadius: 12, overflow: "hidden",
              border: "1px solid #e2e8f0", boxShadow: "0 20px 50px rgba(0,0,0,0.2)",
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Color stripe */}
            <div style={{ height: 4, background: `linear-gradient(90deg, ${cfg.bg}, ${cfg.border})` }} />

            <div style={{ padding: "12px 14px" }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: "#0f172a", lineHeight: 1.3, marginBottom: 2 }}>
                {emp.name}
              </div>
              <div style={{ fontSize: 11, color: "#64748b", marginBottom: 12 }}>
                {emp.duty || "AM"} Duty{emp.office ? ` · ${emp.office}` : ""}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 8px", marginBottom: 10 }}>
                {[{ label: "First In", value: arrival }, { label: "Last Out", value: departure }].map(({ label, value }) => (
                  <div key={label} style={{ background: "#f8fafc", borderRadius: 8, padding: "6px 8px", border: "1px solid #f1f5f9" }}>
                    <div style={{ fontSize: 9, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>
                      {label}
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: value ? "#0f172a" : "#cbd5e1" }}>
                      {value || "—"}
                    </div>
                  </div>
                ))}
              </div>

              {anomalies.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 3, marginBottom: 10 }}>
                  {anomalies.map((r, i) => {
                    const isLate = r.startsWith("LATE");
                    const isWrong = r.startsWith("WRONG");
                    return (
                      <div key={i} style={{
                        fontSize: 10, padding: "3px 7px", borderRadius: 5, fontWeight: 600,
                        background: isLate ? "#fff7ed" : isWrong ? "#eff6ff" : "#f8fafc",
                        color: isLate ? "#c2410c" : isWrong ? "#1d4ed8" : "#475569",
                        border: `1px solid ${isLate ? "#fdba74" : isWrong ? "#bfdbfe" : "#e2e8f0"}`,
                      }}>
                        {r}
                      </div>
                    );
                  })}
                </div>
              )}

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{
                  display: "inline-flex", alignItems: "center", gap: 5,
                  fontSize: 11, fontWeight: 700, color: cfg.color,
                  background: cfg.bg, padding: "3px 9px", borderRadius: 20,
                }}>
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: cfg.color, opacity: 0.7 }} />
                  {cfg.label}
                </div>
                {tardiness && (
                  <button
                    onClick={() => setDetailsOpen(o => !o)}
                    style={{
                      background: "none", border: "none", padding: "2px 4px",
                      fontSize: 11, fontWeight: 600, color: "#64748b",
                      cursor: "pointer", display: "flex", alignItems: "center", gap: 3, borderRadius: 4,
                    }}
                  >
                    Cutoff {detailsOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  </button>
                )}
              </div>

              {detailsOpen && tardiness && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #f1f5f9" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>
                      {cutoffLabel(cur.year, cur.month, cur.cutoff)}
                    </span>
                    <span style={{
                      fontSize: 11, fontWeight: 800, padding: "1px 8px", borderRadius: 10,
                      background: tardiness.late_count > 0 ? "#fef2f2" : "#f0fdf4",
                      color: tardiness.late_count > 0 ? "#dc2626" : "#16a34a",
                    }}>
                      {tardiness.late_count} late
                    </span>
                  </div>
                  <div style={{ maxHeight: 130, overflowY: "auto" }}>
                    <table style={{ width: "100%", fontSize: 10, borderCollapse: "collapse" }}>
                      <tbody>
                        {tardiness.logs?.length > 0 ? tardiness.logs.map((log, i) => (
                          <tr key={i} style={{ borderBottom: "1px solid #f8fafc" }}>
                            <td style={{ padding: "4px 0", color: "#475569" }}>{log.date}</td>
                            <td style={{ padding: "4px 0", textAlign: "right", fontWeight: 700, color: log.status === "Late" ? "#dc2626" : "#16a34a" }}>
                              {log.status}
                            </td>
                          </tr>
                        )) : (
                          <tr><td colSpan={2} style={{ color: "#94a3b8", fontStyle: "italic", padding: "6px 0", textAlign: "center" }}>No records this cutoff.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  /* Section */
  function Section({ list, title, Icon, iconColor }) {
    if (list.length === 0) return null;
    const presentInSection = list.filter(e => employeeMap[String(e.id)]).length;
    return (
      <div style={{ padding: "16px 22px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 8, background: `${iconColor}18`,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Icon size={14} color={iconColor} />
          </div>
          <span style={{ fontWeight: 700, fontSize: 13, color: "#0f172a" }}>{title}</span>
          <span style={{
            marginLeft: "auto", fontSize: 11, color: "#64748b",
            background: "#f1f5f9", padding: "2px 8px", borderRadius: 10, fontWeight: 600,
          }}>
            {presentInSection} / {list.length} present
          </span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {list.map(emp => <Tile key={emp.id} emp={emp} />)}
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "rgba(15,23,42,0.65)", backdropFilter: "blur(4px)",
        display: "flex", flexDirection: "column", alignItems: "center",
        overflowY: "auto", padding: "32px 16px",
      }}
      onClick={e => { if (e.target === e.currentTarget) { setSelectedEid(null); onClose(); } }}
    >
      <div
        style={{
          background: "#fff", borderRadius: 16, width: "100%", maxWidth: 820,
          margin: "auto", display: "flex", flexDirection: "column",
          boxShadow: "0 32px 80px rgba(0,0,0,0.3)",
        }}
        onClick={() => setSelectedEid(null)}
      >
        {/* Header */}
        <div style={{
          padding: "18px 22px",
          background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
          borderRadius: "16px 16px 0 0",
          display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12,
        }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <div style={{
                width: 34, height: 34, borderRadius: 9, background: "rgba(255,255,255,0.07)",
                border: "1px solid rgba(255,255,255,0.1)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <Users size={16} color="#94a3b8" />
              </div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 800, color: "#f8fafc" }}>Member Status</div>
                <div style={{ fontSize: 11, color: "#475569", marginTop: 1 }}>
                  {cutoffLabel(cur.year, cur.month, cur.cutoff)} · {employees.length} total
                </div>
              </div>
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {[
                { label: "Present",    count: presentCount,   bg: "rgba(34,197,94,0.12)",  color: "#4ade80", dot: "#22c55e" },
                { label: "Absent",     count: absentCount,    bg: "rgba(239,68,68,0.12)",  color: "#f87171", dot: "#ef4444" },
                { label: "Not Logged", count: notLoggedCount, bg: "rgba(100,116,139,0.15)", color: "#94a3b8", dot: "#64748b" },
              ].map(({ label, count, bg, color, dot }) => (
                <div key={label} style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "4px 12px", borderRadius: 20,
                  background: bg, fontSize: 12, fontWeight: 700, color,
                }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: dot }} />
                  {label} {count}
                </div>
              ))}
            </div>
          </div>

          <button
            onClick={onClose}
            style={{
              background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 8, padding: "6px", cursor: "pointer",
              display: "flex", color: "#94a3b8", flexShrink: 0,
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Legend */}
        <div style={{
          display: "flex", flexWrap: "wrap", gap: 14, padding: "10px 22px",
          background: "#f8fafc", borderBottom: "1px solid #e2e8f0",
        }}>
          {Object.entries(STATUS).map(([key, cfg]) => (
            <div key={key} style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{
                width: 12, height: 12, borderRadius: 3, background: cfg.bg,
                border: `1px solid ${cfg.border}55`, display: "inline-block",
              }} />
              <span style={{ fontSize: 11, color: "#475569", fontWeight: 600 }}>{cfg.label}</span>
            </div>
          ))}
        </div>

        {/* Body */}
        <div style={{ paddingBottom: 8 }} onClick={e => e.stopPropagation()}>
          {loading ? (
            <div style={{ padding: 56, textAlign: "center" }}>
              <div style={{ fontSize: 13, color: "#94a3b8" }}>Loading members…</div>
            </div>
          ) : employees.length === 0 ? (
            <div style={{ padding: 56, textAlign: "center" }}>
              <Users size={32} color="#e2e8f0" />
              <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 8 }}>No active employees found.</div>
            </div>
          ) : (
            <>
              <Section list={amEmps} title="AM Duty"  Icon={Sun}  iconColor="#f59e0b" />
              {amEmps.length > 0 && pmEmps.length > 0 && (
                <div style={{ margin: "0 22px", borderTop: "1px solid #f1f5f9" }} />
              )}
              <Section list={pmEmps} title="PM Duty"  Icon={Moon} iconColor="#6366f1" />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
