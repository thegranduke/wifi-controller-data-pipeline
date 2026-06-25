import { useEffect, useState } from "react";
import CollapsibleCard from "./CollapsibleCard";
import SessionCharts from "./SessionCharts";
import {
  fetchAccessPoints, fetchHealth, fetchInsights, fetchSessions,
  fetchSessionsAll, fetchSyncLogs, fetchVenues, triggerSync,
} from "./api";

const fmtDate = (v) => v ? new Date(v).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
const fmtMin = (s) => `${Math.round((s || 0) / 60)} min`;

const RETRY_PHASES = [
  { at: 0, text: "Attempt 1 — contacting controller" },
  { at: 300, text: "Attempt 1 failed — waiting 1s before retry" },
  { at: 1300, text: "Attempt 2 — contacting controller" },
  { at: 1600, text: "Attempt 2 failed — waiting 2s before retry" },
  { at: 3600, text: "Attempt 3 — final try" },
];

const successMsg = (r) =>
  `Synced ${r.venues_synced} venues, ${r.aps_synced} APs, ${r.sessions_synced} sessions`;

const failMsg = (r) => {
  const base = `Failed after ${r.attempts} attempt${r.attempts > 1 ? "s" : ""}`;
  return r.error_message ? `${base} — ${r.error_message}` : base;
};

const formatSyncResult = (mode, result) => {
  if (result.status === "failed") return failMsg(result);
  if (mode === "flaky" && result.attempts > 1) {
    return `Succeeded after ${result.attempts} attempts — ${successMsg(result)}`;
  }
  return successMsg(result);
};

const progressSteps = (mode, ms) => {
  if (mode === "normal") {
    return [{ text: "Syncing venues, APs, and sessions…", state: "active" }];
  }
  const steps = [];
  for (let i = 0; i < RETRY_PHASES.length; i++) {
    const { at, text } = RETRY_PHASES[i];
    if (ms < at) break;
    const nextAt = RETRY_PHASES[i + 1]?.at ?? Infinity;
    steps.push({ text, state: ms >= nextAt ? "done" : "active" });
  }
  return steps;
};

const completedAttemptSteps = (result) => {
  const steps = [];
  for (let i = 1; i <= result.attempts; i++) {
    const isLast = i === result.attempts;
    if (result.status === "success" && isLast) {
      steps.push({ text: `Attempt ${i} — succeeded`, state: "done" });
    } else if (result.status === "failed" && isLast) {
      steps.push({ text: `Attempt ${i} — failed`, state: "failed" });
    } else {
      steps.push({ text: `Attempt ${i} — failed`, state: "done" });
    }
  }
  return steps;
};

function AttemptSteps({ steps }) {
  if (!steps.length) return null;
  return (
    <ul className="attempt-steps">
      {steps.map((s, i) => (
        <li key={i} className={`attempt-step attempt-step-${s.state}`}>{s.text}</li>
      ))}
    </ul>
  );
}

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
  const [syncSteps, setSyncSteps] = useState([]);
  const [syncResult, setSyncResult] = useState("");

  const [insights, setInsights] = useState(null);
  const [insightIdx, setInsightIdx] = useState(0);
  const [insightLoading, setInsightLoading] = useState(false);

  const [health, setHealth] = useState("loading");
  const [testResults, setTestResults] = useState({ normal: "", flaky: "", down: "" });
  const [testAttemptSteps, setTestAttemptSteps] = useState({ normal: [], flaky: [], down: [] });
  const [liveTestSteps, setLiveTestSteps] = useState([]);
  const [runningTest, setRunningTest] = useState(null);

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
    Promise.all([fetchSessionsAll(selectedVenue), fetchAccessPoints()])
      .then(([s, aps]) => { setAllSessions(s); setAccessPoints(aps); })
      .finally(() => setChartLoading(false));
  }, [sessionView, selectedVenue]);

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult("");
    setSyncSteps(progressSteps("normal", 0));
    try {
      const result = await triggerSync();
      await reloadData();
      setSyncResult(formatSyncResult("normal", result));
      setSyncSteps([]);
    } catch (e) {
      setSyncResult(e.message);
      setSyncSteps([]);
    } finally {
      setSyncing(false);
    }
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
    setLiveTestSteps(progressSteps(mode, 0));
    setTestResults({ normal: "", flaky: "", down: "" });
    setTestAttemptSteps({ normal: [], flaky: [], down: [] });
    const started = Date.now();
    const ticker = setInterval(() => {
      if (mode !== "normal") setLiveTestSteps(progressSteps(mode, Date.now() - started));
    }, 300);
    try {
      const result = await triggerSync(mode);
      await reloadData();
      setTestResults((r) => ({ ...r, [key]: formatSyncResult(mode, result) }));
      if (mode !== "normal") {
        setTestAttemptSteps((s) => ({ ...s, [key]: completedAttemptSteps(result) }));
      }
    } catch (e) {
      setTestResults((r) => ({ ...r, [key]: e.message }));
    } finally {
      clearInterval(ticker);
      setLiveTestSteps([]);
      setRunningTest(null);
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
          <div className="header-sync">
            <button className="btn btn-primary" onClick={handleSync} disabled={syncing}>
              {syncing ? "Syncing..." : "Sync now"}
            </button>
            {syncing && syncSteps.length > 0 && <AttemptSteps steps={syncSteps} />}
            {!syncing && syncResult && (
              <div className={`sync-result${syncResult.startsWith("Failed") ? " sync-result-error" : ""}`}>
                {syncResult}
              </div>
            )}
          </div>
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
              {runningTest === key && liveTestSteps.length > 0 && <AttemptSteps steps={liveTestSteps} />}
              {runningTest !== key && testAttemptSteps[key]?.length > 0 && (
                <AttemptSteps steps={testAttemptSteps[key]} />
              )}
              {testResults[key] && (
                <div className={`test-result${testResults[key].startsWith("Failed") ? " test-result-error" : ""}`}>
                  {testResults[key]}
                </div>
              )}
            </div>
          </div>
        ))}
      </CollapsibleCard>
    </div>
  );
}
