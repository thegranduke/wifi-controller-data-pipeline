import { useEffect, useState } from "react";
import CollapsibleCard from "./CollapsibleCard";
import SessionCharts from "./SessionCharts";
import {
  fetchAccessPoints, fetchHealth, fetchInsights, fetchSessions,
  fetchSessionsAll, fetchSyncLogs, fetchVenues, triggerSync,
} from "./api";

const fmtDate = (v) => v ? new Date(v).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
const fmtMin = (s) => `${Math.round((s || 0) / 60)} min`;

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

const Skel = ({ w = "100%" }) => <div className="skeleton" style={{ width: w }} />;
const TableSkel = ({ cols = 5, rows = 5 }) => (
  <table><tbody>{Array.from({ length: rows }, (_, i) => (
    <tr className="skeleton-row" key={i}>{Array.from({ length: cols }, (_, j) => <td key={j}><Skel w={`${60 + (j * 7) % 30}%`} /></td>)}</tr>
  ))}</tbody></table>
);

export default function App() {
  const [venues, setVenues] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [sessionTotal, setSessionTotal] = useState(0);
  const [sessionPage, setSessionPage] = useState(0);
  const [selectedVenue, setSelectedVenue] = useState(null);
  const [sessionView, setSessionView] = useState("list");
  const [allSessions, setAllSessions] = useState([]);
  const [accessPoints, setAccessPoints] = useState([]);
  const [loading, setLoading] = useState(false);
  const [chartLoading, setChartLoading] = useState(false);

  const [syncLogs, setSyncLogs] = useState([]);
  const [syncLogTotal, setSyncLogTotal] = useState(0);
  const [syncLogPage, setSyncLogPage] = useState(0);
  const [lastLog, setLastLog] = useState(null);
  const [syncing, setSyncing] = useState(false);

  const [insights, setInsights] = useState(null);
  const [insightIdx, setInsightIdx] = useState(0);
  const [insightLoading, setInsightLoading] = useState(false);

  const [health, setHealth] = useState("loading");
  const [testResults, setTestResults] = useState({ normal: "", flaky: "", down: "" });
  const [runningTest, setRunningTest] = useState(null);
  const [testStatus, setTestStatus] = useState("");

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
    if (sessionView === "chart") fetchSessionsAll(selectedVenue).then(setAllSessions);
  };

  useEffect(() => { fetchVenues().then(setVenues); }, []);
  useEffect(() => { fetchAccessPoints().then(setAccessPoints); }, []);

  useEffect(() => {
    fetchSyncLogs(syncLogPage).then((d) => {
      setSyncLogs(d.logs);
      setSyncLogTotal(d.total);
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

  const handleInsights = async () => {
    setInsightLoading(true);
    try {
      const data = await fetchInsights();
      setInsights(data);
      setInsightIdx(0);
    } catch (e) {
      setInsights({ error: e.message });
    } finally {
      setInsightLoading(false);
    }
  };

  const runTest = async (key, mode) => {
    setRunningTest(key);
    setTestStatus(syncStatusMsg(mode, 0));
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
      clearInterval(ticker);
      setRunningTest(null);
      setTestStatus("");
    }
  };

  const sessionStart = sessionTotal ? sessionPage * 20 + 1 : 0;
  const sessionEnd = Math.min((sessionPage + 1) * 20, sessionTotal);
  const logStart = syncLogTotal ? syncLogPage * 10 + 1 : 0;
  const logEnd = Math.min((syncLogPage + 1) * 10, syncLogTotal);

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
        {sessionView === "list"
          ? loading
            ? <TableSkel cols={5} rows={6} />
            : sessions.length === 0
              ? <div className="empty">No sessions yet — run a sync first</div>
              : (
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
          : <SessionCharts key={selectedVenue || "all"} sessions={allSessions} accessPoints={accessPoints} loading={chartLoading} />
        }
      </CollapsibleCard>

      <CollapsibleCard id="insights" title="AI Insights" badge={insights?.venues?.length ?? null}>
        <div className="insights-header">
          <p className="insight-note" style={{ margin: 0 }}>
            {insights?.demo
              ? "Showing sample insights — add GEMINI_API_KEY for live Gemini output"
              : "Analyses session data across all venues using Gemini"}
          </p>
          <button className="btn btn-primary" onClick={handleInsights} disabled={insightLoading}>
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
              <button className={cls} onClick={() => runTest(key, key)} disabled={runningTest !== null}>{runningTest === key ? "Running…" : btn}</button>
              {runningTest === key
                ? <div className="test-status">{testStatus}</div>
                : testResults[key]
                  ? <div className={`test-result${testResults[key].startsWith("Failed") ? " test-result-error" : ""}`}>{testResults[key]}</div>
                  : null}
            </div>
          </div>
        ))}
      </CollapsibleCard>
    </div>
  );
}
