import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  fetchAccessPoints, fetchHealth, fetchInsights, fetchSessions,
  fetchSessionsAll, fetchSyncLogs, fetchVenues, triggerSync,
} from "./api";

const fmtDate = (v) => v ? new Date(v).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
const fmtMin = (s) => `${Math.round((s || 0) / 60)} min`;
const BAR_COLOR = "#0070f3";

const syncStatusMsg = (mode, ms) => {
  if (mode === "normal") return "Syncing venues, APs, and sessions…";
  if (ms < 1000) return "Attempt 1 — contacting controller…";
  if (ms < 3000) return "Attempt 1 failed — retrying (1s backoff)…";
  if (ms < 5000) return "Attempt 2 — contacting controller…";
  if (ms < 8000) return "Attempt 2 failed — retrying (2s backoff)…";
  return "Attempt 3 — final try…";
};
const failMsg = (r) => {
  const base = `Failed after ${r.attempts} attempt${r.attempts > 1 ? "s" : ""}`;
  return r.error_message ? `${base} — ${r.error_message}` : base;
};

function useLocalStorage(key, init) {
  const [v, set] = useState(() => {
    try { return JSON.parse(localStorage.getItem(key)) ?? init; } catch { return init; }
  });
  return [v, (val) => { set(val); localStorage.setItem(key, JSON.stringify(val)); }];
}

const Skel = ({ w = "100%" }) => <div className="skeleton" style={{ width: w }} />;
const TableSkel = ({ cols = 5, rows = 5 }) => (
  <table><tbody>{Array.from({ length: rows }, (_, i) => (
    <tr className="skeleton-row" key={i}>{Array.from({ length: cols }, (_, j) => <td key={j}><Skel w={`${60 + (j * 7) % 30}%`} /></td>)}</tr>
  ))}</tbody></table>
);

const ChevronIcon = ({ open }) => (
  <svg className={`chevron${open ? " open" : ""}`} width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

function CollapsibleCard({ id, title, badge, subtitle, defaultOpen = true, children }) {
  const [open, setOpen] = useLocalStorage(`card-${id}`, defaultOpen);
  return (
    <div className="card">
      <button className="card-header" onClick={() => setOpen(!open)}>
        <div className="card-header-left">
          <span className="card-title">{title}</span>
          {badge != null && <span className="card-badge">{badge}</span>}
        </div>
        <ChevronIcon open={open} />
      </button>
      {open && (
        <div className="card-body">
          {subtitle && <p className="card-subtitle">{subtitle}</p>}
          {children}
        </div>
      )}
    </div>
  );
}

const tooltipStyle = { fontSize: 12, border: "1px solid #eaeaea", borderRadius: 5, boxShadow: "none" };

function SessionCharts({ sessions, accessPoints, loading }) {
  const [drillAp, setDrillAp] = useState(null);

  const apMap = useMemo(() => Object.fromEntries(accessPoints.map((ap) => [ap.id, ap])), [accessPoints]);
  const filtered = drillAp ? sessions.filter((s) => s.access_point_id === drillAp.id) : sessions;

  const byDevice = useMemo(() => {
    const c = {};
    filtered.forEach((s) => { const k = s.device_type || "unknown"; c[k] = (c[k] || 0) + 1; });
    return Object.entries(c).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  }, [filtered]);

  const byAp = useMemo(() => {
    if (drillAp) return [];
    const c = {};
    sessions.forEach((s) => {
      const ap = apMap[s.access_point_id];
      if (!ap) return;
      if (!c[ap.id]) c[ap.id] = { id: ap.id, name: ap.name, count: 0 };
      c[ap.id].count++;
    });
    return Object.values(c).sort((a, b) => b.count - a.count);
  }, [sessions, apMap, drillAp]);

  const byHour = useMemo(() => {
    const h = Array.from({ length: 24 }, (_, i) => ({ hour: `${i}`, count: 0 }));
    filtered.forEach((s) => { if (s.connected_at) h[new Date(s.connected_at).getHours()].count++; });
    return h;
  }, [filtered]);

  if (loading) return <div className="chart-loading">Loading chart data…</div>;
  if (!sessions.length) return <div className="empty">No sessions yet — run a sync first</div>;

  const chartH = Math.max(100, byDevice.length * 36);

  return (
    <>
      {drillAp && (
        <div className="drill-crumb">
          <button className="btn-link" onClick={() => setDrillAp(null)}>← All APs</button>
          <span className="drill-sep">/</span>
          <span className="drill-name">{drillAp.name}</span>
        </div>
      )}
      <div className="chart-grid">
        <div className="chart-card">
          <div className="chart-label">By device type</div>
          <ResponsiveContainer width="100%" height={chartH}>
            <BarChart layout="vertical" data={byDevice} margin={{ left: 8, right: 28, top: 4, bottom: 4 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" width={72} tick={{ fontSize: 12, fill: "#666" }} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ fill: "#f5f5f5" }} contentStyle={tooltipStyle} />
              <Bar dataKey="count" fill={BAR_COLOR} radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {drillAp ? (
          <div className="chart-card">
            <div className="chart-label">Peak hours</div>
            <ResponsiveContainer width="100%" height={chartH}>
              <BarChart data={byHour} margin={{ left: 8, right: 8, top: 4, bottom: 4 }}>
                <XAxis dataKey="hour" tick={{ fontSize: 9, fill: "#999" }} axisLine={false} tickLine={false} interval={2} />
                <YAxis hide />
                <Tooltip cursor={{ fill: "#f5f5f5" }} contentStyle={tooltipStyle} />
                <Bar dataKey="count" fill="#0070f3" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="chart-card">
            <div className="chart-label">
              By access point{" "}
              <span className="chart-hint">click to drill in</span>
            </div>
            <ResponsiveContainer width="100%" height={Math.max(100, byAp.length * 52)}>
              <BarChart data={byAp} margin={{ left: 8, right: 8, top: 4, bottom: byAp.length > 2 ? 36 : 20 }}>
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#666" }} axisLine={false} tickLine={false} />
                <YAxis hide />
                <Tooltip cursor={{ fill: "#f5f5f5" }} contentStyle={tooltipStyle} />
                <Bar dataKey="count" fill="#0070f3" radius={[3, 3, 0, 0]} cursor="pointer"
                  onClick={(data) => data.id && setDrillAp({ id: data.id, name: data.name })} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {!drillAp && (
        <div className="chart-card" style={{ marginTop: 12 }}>
          <div className="chart-label">Peak hours</div>
          <ResponsiveContainer width="100%" height={80}>
            <BarChart data={byHour} margin={{ left: 8, right: 8, top: 4, bottom: 4 }}>
              <XAxis dataKey="hour" tick={{ fontSize: 9, fill: "#999" }} axisLine={false} tickLine={false} interval={1} />
              <YAxis hide />
              <Tooltip cursor={{ fill: "#f5f5f5" }} contentStyle={tooltipStyle} />
              <Bar dataKey="count" fill="#0070f3" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </>
  );
}

export default function App() {
  const [venues, setVenues] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [sessionTotal, setSessionTotal] = useState(0);
  const [sessionPage, setSessionPage] = useState(0);
  const [selectedVenue, setSelectedVenue] = useState(null);
  const [syncLogs, setSyncLogs] = useState([]);
  const [syncLogTotal, setSyncLogTotal] = useState(0);
  const [syncLogPage, setSyncLogPage] = useState(0);
  const [lastLog, setLastLog] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [insights, setInsights] = useState(null);
  const [insightIdx, setInsightIdx] = useState(0);
  const [insightLoading, setInsightLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [health, setHealth] = useState("loading");
  const [testResults, setTestResults] = useState({ normal: "", flaky: "", down: "" });
  const [runningTest, setRunningTest] = useState(null);
  const [testStatus, setTestStatus] = useState("");
  const [sessionView, setSessionView] = useState("list");
  const [allSessions, setAllSessions] = useState([]);
  const [accessPoints, setAccessPoints] = useState([]);
  const [chartLoading, setChartLoading] = useState(false);

  const reloadData = async () => {
    const [v, logs, latest, s] = await Promise.all([
      fetchVenues(),
      fetchSyncLogs(syncLogPage),
      fetchSyncLogs(0, 1),
      fetchSessions(selectedVenue, sessionPage),
    ]);
    setVenues(v);
    setSyncLogs(logs.logs);
    setSyncLogTotal(logs.total);
    setLastLog(latest.logs[0] ?? null);
    setSessions(s.sessions);
    setSessionTotal(s.total);
    if (sessionView === "chart") {
      fetchSessionsAll(selectedVenue).then(setAllSessions);
    }
  };

  useEffect(() => { fetchVenues().then(setVenues); }, []);
  useEffect(() => { fetchAccessPoints().then(setAccessPoints); }, []);

  useEffect(() => {
    fetchSyncLogs(syncLogPage).then((d) => {
      setSyncLogs(d.logs); setSyncLogTotal(d.total);
      if (syncLogPage === 0) setLastLog(d.logs[0] ?? null);
    });
  }, [syncLogPage]);

  useEffect(() => {
    const check = () => fetchHealth().then(() => setHealth("ok")).catch(() => setHealth("error"));
    check();
    const id = setInterval(check, 30000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchSessions(selectedVenue, sessionPage)
      .then((d) => { setSessions(d.sessions); setSessionTotal(d.total); })
      .finally(() => setLoading(false));
  }, [selectedVenue, sessionPage]);

  useEffect(() => {
    if (sessionView !== "chart") return;
    setChartLoading(true);
    fetchSessionsAll(selectedVenue).then(setAllSessions).finally(() => setChartLoading(false));
  }, [sessionView, selectedVenue]);

  const handleSync = async () => {
    setSyncing(true);
    try { await triggerSync(); await reloadData(); } finally { setSyncing(false); }
  };

  const handleInsights = async (fromTest = false) => {
    setInsightLoading(true);
    if (fromTest) {
      setRunningTest("insights"); setTestStatus("Generating insights with Gemini…");
      setTestResults({ normal: "", flaky: "", down: "", insights: "" });
    }
    try {
      const data = await fetchInsights();
      setInsights(data);
      setInsightIdx(0);
      if (fromTest) setTestResults((r) => ({ ...r, insights: data.error ? data.error : `Generated insights for ${data.venues?.length || 0} venues` }));
    } catch (e) {
      setInsights({ error: e.message });
      if (fromTest) setTestResults((r) => ({ ...r, insights: e.message }));
    } finally {
      setInsightLoading(false);
      if (fromTest) { setRunningTest(null); setTestStatus(""); }
    }
  };

  const runTest = async (key, mode) => {
    setRunningTest(key); setTestStatus(syncStatusMsg(mode, 0));
    setTestResults({ normal: "", flaky: "", down: "" });
    const started = Date.now();
    const ticker = setInterval(() => setTestStatus(syncStatusMsg(mode, Date.now() - started)), 400);
    try {
      const result = await triggerSync(mode);
      await reloadData();
      if (key === "normal") {
        setTestResults((r) => ({ ...r, normal: `Synced ${result.venues_synced} venues, ${result.aps_synced} APs, ${result.sessions_synced} sessions` }));
      } else if (key === "flaky") {
        setTestResults((r) => ({ ...r, flaky: result.status === "success"
          ? (result.attempts > 1 ? `Succeeded after ${result.attempts} attempts (${result.attempts - 1} retr${result.attempts > 2 ? "ies" : "y"})` : "Succeeded on first attempt")
          : failMsg(result) }));
      } else {
        setTestResults((r) => ({ ...r, down: result.status === "failed" ? failMsg(result) : `Synced ${result.sessions_synced} sessions` }));
      }
    } catch (e) {
      setTestResults((r) => ({ ...r, [key]: e.message }));
    } finally {
      clearInterval(ticker); setRunningTest(null); setTestStatus("");
    }
  };

  const sessionStart = sessionTotal ? sessionPage * 20 + 1 : 0;
  const sessionEnd = Math.min((sessionPage + 1) * 20, sessionTotal);
  const logStart = syncLogTotal ? syncLogPage * 10 + 1 : 0;
  const logEnd = Math.min((syncLogPage + 1) * 10, syncLogTotal);
  const testBusy = runningTest !== null;

  return (
    <div className="container">
      <header className="header">
        <h1>bconnect dashboard</h1>
        <div className="header-actions">
          <div className="health-status">
            <span className={`health-dot ${health === "ok" ? "ok" : health === "error" ? "error" : ""}`} />
            {health === "ok" ? "Connected" : health === "error" ? "DB error" : "Checking..."}
          </div>
          <button className="btn btn-primary" onClick={handleSync} disabled={syncing}>
            {syncing ? "Syncing..." : "Sync now"}
          </button>
        </div>
      </header>

      <div className="stat-row">
        <div className="stat"><div className="stat-label">Venues</div><div className="stat-value">{venues.length}</div></div>
        <div className="stat"><div className="stat-label">Sessions</div><div className="stat-value">{sessionTotal}</div></div>
        <div className="stat">
          <div className="stat-label">Last sync</div>
          <div className="stat-status">
            {lastLog?.status ? <span className={`status-badge status-${lastLog.status}`}>{lastLog.status}</span> : <span className="stat-dash">—</span>}
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Last synced</div>
          <div className="stat-value stat-value-sm">{lastLog?.synced_at ? fmtDate(lastLog.synced_at) : "—"}</div>
        </div>
      </div>

      <CollapsibleCard id="venues" title="Venues" badge={venues.length || null}>
        {venues.length === 0 ? <div className="empty">No venues yet — run a sync to populate</div> : (
          <table>
            <thead><tr><th>Name</th><th>City</th><th>Country</th><th>Last updated</th></tr></thead>
            <tbody>{venues.map((v) => (
              <tr key={v.id}><td>{v.name}</td><td>{v.city}</td><td>{v.country}</td><td>{fmtDate(v.updated_at)}</td></tr>
            ))}</tbody>
          </table>
        )}
      </CollapsibleCard>

      <CollapsibleCard id="sessions" title="Sessions" badge={sessionTotal || null}>
        <div className="filter-row">
          <div className="filter-left">
            <select value={selectedVenue || ""} onChange={(e) => { setSelectedVenue(e.target.value || null); setSessionPage(0); }}>
              <option value="">All venues</option>
              {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            <div className="view-toggle">
              {["list", "chart"].map((t) => (
                <button key={t} className={`view-toggle-btn${sessionView === t ? " active" : ""}`} onClick={() => setSessionView(t)}>
                  {t === "list" ? "List" : "Chart"}
                </button>
              ))}
            </div>
          </div>
          {sessionView === "list" && (
            <div className="pagination">
              <span>Showing {sessionStart}–{sessionEnd} of {sessionTotal}</span>
              <button className="btn" disabled={sessionPage === 0} onClick={() => setSessionPage(sessionPage - 1)}>Prev</button>
              <button className="btn" disabled={(sessionPage + 1) * 20 >= sessionTotal} onClick={() => setSessionPage(sessionPage + 1)}>Next</button>
            </div>
          )}
        </div>
        {sessionView === "list" ? (
          loading ? <TableSkel cols={5} rows={6} /> : sessions.length === 0 ? <div className="empty">No sessions yet — run a sync first</div> : (
            <table>
              <thead><tr><th>Device</th><th>Type</th><th>Duration</th><th>Connected at</th><th>Access point</th></tr></thead>
              <tbody>{sessions.map((s) => (
                <tr key={s.id}>
                  <td>{s.client_mac}</td><td>{s.device_type}</td><td>{fmtMin(s.duration_seconds)}</td>
                  <td>{fmtDate(s.connected_at)}</td><td>{String(s.access_point_id).slice(0, 8)}</td>
                </tr>
              ))}</tbody>
            </table>
          )
        ) : (
          <SessionCharts key={selectedVenue || "all"} sessions={allSessions} accessPoints={accessPoints} loading={chartLoading} />
        )}
      </CollapsibleCard>

      <CollapsibleCard id="insights" title="AI Insights" badge={insights?.venues?.length ?? null}>
        <div className="insights-header">
          <p className="insight-note" style={{ margin: 0 }}>
            {insights?.demo ? "Showing sample insights — add GEMINI_API_KEY for live Gemini output" : "Analyses session data across all venues using Gemini"}
          </p>
          <button className="btn btn-primary" onClick={() => handleInsights(false)} disabled={insightLoading}>
            {insightLoading ? "Generating…" : "Generate"}
          </button>
        </div>
        {insightLoading && (
          <div className="insight-skeleton-grid">{[1, 2, 3].map((i) => (
            <div className="venue-insight-card" key={i}>
              <Skel w="40%" /><div style={{ marginTop: 12 }}><Skel /><div style={{ marginTop: 8 }}><Skel w="80%" /></div></div>
            </div>
          ))}</div>
        )}
        {!insightLoading && insights?.error && <div className="insight-error">{insights.error}</div>}
        {!insightLoading && insights?.venues?.length > 0 && (() => {
          const all = insights.venues;
          const v = all[insightIdx];
          return (
            <>
              {all.length > 1 && (
                <div className="insight-nav">
                  <button className="btn" disabled={insightIdx === 0} onClick={() => setInsightIdx(insightIdx - 1)}>←</button>
                  <span className="insight-nav-label">{v.venue_name} <span className="insight-nav-count">{insightIdx + 1} / {all.length}</span></span>
                  <button className="btn" disabled={insightIdx === all.length - 1} onClick={() => setInsightIdx(insightIdx + 1)}>→</button>
                </div>
              )}
              <div className="venue-insight-card">
                {all.length === 1 && <div className="venue-insight-title">{v.venue_name}</div>}
                {[["Summary", v.summary], ["Peak time", v.peak_time], ["Pattern", v.pattern]].map(([label, text]) => (
                  <div className="insight-field" key={label}><div className="insight-field-label">{label}</div>{text}</div>
                ))}
                <div className="insight-field insight-field-action"><div className="insight-field-label">Action</div>{v.action}</div>
                <div className="ai-generated">{insights.demo ? "Sample insight" : "AI generated"}</div>
              </div>
            </>
          );
        })()}
      </CollapsibleCard>

      <CollapsibleCard id="sync-history" title="Sync history" badge={syncLogTotal || null}>
        <div className="filter-row">
          <div className="pagination">
            <span>Showing {logStart}–{logEnd} of {syncLogTotal}</span>
            <button className="btn" disabled={syncLogPage === 0} onClick={() => setSyncLogPage(syncLogPage - 1)}>Prev</button>
            <button className="btn" disabled={(syncLogPage + 1) * 10 >= syncLogTotal} onClick={() => setSyncLogPage(syncLogPage + 1)}>Next</button>
          </div>
        </div>
        {syncLogs.length === 0 ? <div className="empty">No sync history yet</div> : (
          <table>
            <thead><tr><th>Status</th><th>Venues</th><th>APs</th><th>Sessions</th><th>Time</th></tr></thead>
            <tbody>{syncLogs.map((log) => (
              <tr key={log.id}>
                <td><span className={`status-badge status-${log.status}`}>{log.status}</span></td>
                <td>{log.venues_synced}</td><td>{log.aps_synced}</td><td>{log.sessions_synced}</td><td>{fmtDate(log.synced_at)}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </CollapsibleCard>

      <CollapsibleCard id="tests" title="Integration tests" subtitle="Test how the system handles real-world failure scenarios" defaultOpen={false}>
        {[
          { key: "normal", label: "Normal sync", desc: "Standard sync — all data returns correctly", btn: "Run", cls: "btn" },
          { key: "flaky", label: "Flaky controller", desc: "Simulates an unstable connection — retry logic activates", btn: "Test", cls: "btn btn-amber" },
          { key: "down", label: "Controller down", desc: "Simulates complete outage — all retries fail", btn: "Test", cls: "btn btn-red" },
        ].map(({ key, label, desc, btn, cls }) => (
          <div className="test-row" key={key}>
            <div className="test-row-info"><div className="test-row-label">{label}</div><div className="test-row-desc">{desc}</div></div>
            <div className="test-row-action">
              <button className={cls} onClick={() => runTest(key, key)} disabled={testBusy}>{runningTest === key ? "Running…" : btn}</button>
              {runningTest === key ? <div className="test-status">{testStatus}</div>
                : testResults[key] ? <div className={`test-result${testResults[key].startsWith("Failed") ? " test-result-error" : ""}`}>{testResults[key]}</div>
                : null}
            </div>
          </div>
        ))}
      </CollapsibleCard>
    </div>
  );
}
