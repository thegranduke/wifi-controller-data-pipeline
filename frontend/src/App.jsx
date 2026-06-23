import { useEffect, useRef, useState } from "react";
import { fetchHealth, fetchInsights, fetchSessions, fetchSyncLogs, fetchVenues, triggerSync } from "./api";

const fmtDate = (v) => (v ? new Date(v).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const fmtMin = (s) => `${Math.round((s || 0) / 60)} min`;
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
  const [syncLogs, setSyncLogs] = useState([]);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [insights, setInsights] = useState(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [health, setHealth] = useState("loading");
  const [testResults, setTestResults] = useState({ normal: "", flaky: "", down: "", insights: "" });
  const insightsRef = useRef(null);

  const reloadData = async () => {
    const [v, logs, s] = await Promise.all([fetchVenues(), fetchSyncLogs(), fetchSessions(selectedVenue, sessionPage)]);
    setVenues(v); setSyncLogs(logs); setSessions(s.sessions); setSessionTotal(s.total);
  };

  useEffect(() => {
    fetchVenues().then(setVenues);
    fetchSyncLogs().then(setSyncLogs);
  }, []);

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

  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = await triggerSync();
      setSyncResult({ ...result, at: new Date() });
      await reloadData();
    } finally { setSyncing(false); }
  };

  const handleInsights = async (fromTest = false) => {
    setInsightLoading(true);
    if (fromTest) setTestResults({ normal: "", flaky: "", down: "", insights: "" });
    try {
      const data = await fetchInsights();
      setInsights(data);
      if (fromTest) setTestResults((r) => ({ ...r, insights: data.error ? data.error : `Generated insights for ${data.venues?.length || 0} venues` }));
    } catch (e) {
      const err = { error: e.message };
      setInsights(err);
      if (fromTest) setTestResults((r) => ({ ...r, insights: e.message }));
    } finally { setInsightLoading(false); }
  };

  const runTest = async (key, mode) => {
    setTestResults({ normal: "", flaky: "", down: "", insights: "" });
    try {
      const result = await triggerSync(mode);
      await reloadData();
      if (key === "normal") {
        setTestResults((r) => ({ ...r, normal: `Synced ${result.venues_synced} venues, ${result.aps_synced} APs, ${result.sessions_synced} sessions` }));
      } else if (key === "flaky") {
        setTestResults((r) => ({ ...r, flaky: result.status === "success"
          ? (result.attempts > 1 ? `Retried ${result.attempts - 1} time${result.attempts > 2 ? "s" : ""} before succeeding` : "Succeeded on first attempt")
          : `Failed after ${result.attempts} attempts` }));
      } else {
        setTestResults((r) => ({ ...r, down: result.status === "failed"
          ? `Sync failed after ${result.attempts} attempts — check sync log for error details`
          : `Synced ${result.sessions_synced} sessions` }));
      }
      setSyncResult({ ...result, at: new Date() });
    } catch (e) {
      setTestResults((r) => ({ ...r, [key]: e.message }));
    }
  };

  const start = sessionTotal ? sessionPage * 20 + 1 : 0;
  const end = Math.min((sessionPage + 1) * 20, sessionTotal);
  const lastLog = syncLogs[0];

  return (
    <div className="container">
      <header className="header">
        <h1>bconnect dashboard</h1>
        <div className="header-actions">
          <div className="health-status">
            <span className={`health-dot ${health === "ok" ? "ok" : health === "error" ? "error" : ""}`} />
            {health === "ok" ? "Connected" : health === "error" ? "DB error" : "Checking..."}
          </div>
          <button className="btn btn-primary" onClick={handleSync} disabled={syncing}>{syncing ? "Syncing..." : "Sync now"}</button>
        </div>
      </header>
      {syncResult && <p className="sync-status">Last sync: {syncResult.venues_synced} venues, {syncResult.aps_synced} access points, {syncResult.sessions_synced} sessions — {fmtDate(syncResult.at)}</p>}

      <div className="stat-row">
        {[["Total venues", venues.length], ["Total sessions", sessionTotal], ["Last sync status", lastLog?.status || "—"], ["Last sync time", lastLog?.synced_at ? fmtDate(lastLog.synced_at) : "—"]].map(([label, value]) => (
          <div className="stat" key={label}>
            <div className="stat-label">{label}</div>
            <div className="stat-value" style={label === "Last sync time" ? { fontSize: 16 } : undefined}>{value}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-title">Venues</div>
        {venues.length === 0 ? <div className="empty">No venues yet</div> : (
          <table><thead><tr><th>Name</th><th>City</th><th>Country</th><th>Last updated</th></tr></thead>
            <tbody>{venues.map((v) => <tr key={v.id}><td>{v.name}</td><td>{v.city}</td><td>{v.country}</td><td>{fmtDate(v.updated_at)}</td></tr>)}</tbody>
          </table>
        )}
      </div>

      <div className="card">
        <div className="card-title">Sessions</div>
        <div className="filter-row">
          <select value={selectedVenue || ""} onChange={(e) => { setSelectedVenue(e.target.value || null); setSessionPage(0); }}>
            <option value="">All venues</option>
            {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          <div className="pagination">
            <span>Showing {start}-{end} of {sessionTotal}</span>
            <button className="btn" disabled={sessionPage === 0} onClick={() => setSessionPage(sessionPage - 1)}>Prev</button>
            <button className="btn" disabled={(sessionPage + 1) * 20 >= sessionTotal} onClick={() => setSessionPage(sessionPage + 1)}>Next</button>
          </div>
        </div>
        {loading ? <TableSkel cols={5} rows={6} /> : sessions.length === 0 ? <div className="empty">No sessions yet</div> : (
          <table><thead><tr><th>Device</th><th>Type</th><th>Duration</th><th>Connected at</th><th>Access point</th></tr></thead>
            <tbody>{sessions.map((s) => <tr key={s.id}><td>{s.client_mac}</td><td>{s.device_type}</td><td>{fmtMin(s.duration_seconds)}</td><td>{fmtDate(s.connected_at)}</td><td>{String(s.access_point_id).slice(0, 8)}</td></tr>)}</tbody>
          </table>
        )}
      </div>

      <div className="card" ref={insightsRef}>
        <div className="card-title">AI insights (Gemini)</div>
        <button className="btn btn-primary" onClick={() => handleInsights(false)} disabled={insightLoading}>Generate insights</button>
        {insightLoading && <div className="insight-skeleton-grid">{[1, 2, 3].map((i) => <div className="venue-insight-card" key={i}><Skel w="40%" /><div style={{ marginTop: 12 }}><Skel /><div style={{ marginTop: 8 }}><Skel w="80%" /></div></div></div>)}</div>}
        {!insightLoading && insights?.error && <div className="insight-error">{insights.error}</div>}
        {!insightLoading && insights?.venues?.map((v) => (
          <div className="venue-insight-card" key={v.venue_name}>
            <div className="venue-insight-title">{v.venue_name}</div>
            {[["Summary", v.summary], ["Peak time", v.peak_time], ["Pattern", v.pattern]].map(([label, text]) => (
              <div className="insight-field" key={label}><div className="insight-field-label">{label}</div>{text}</div>
            ))}
            <div className="insight-field insight-field-action"><div className="insight-field-label">Action</div>{v.action}</div>
            <div className="ai-generated">AI generated</div>
          </div>
        ))}
        <p className="insight-note">Analyses the last 7 days of session data across all venues</p>
      </div>

      <div className="card">
        <div className="card-title">Sync history</div>
        {syncLogs.length === 0 ? <div className="empty">No sync history yet</div> : (
          <table><thead><tr><th>Status</th><th>Venues</th><th>APs</th><th>Sessions</th><th>Time</th></tr></thead>
            <tbody>{syncLogs.map((log) => (
              <tr key={log.id}>
                <td><span className={`status-badge status-${log.status}`}>{log.status}</span></td>
                <td>{log.venues_synced}</td><td>{log.aps_synced}</td><td>{log.sessions_synced}</td><td>{fmtDate(log.synced_at)}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>

      <div className="card">
        <div className="card-title">Integration test panel</div>
        <p className="card-subtitle">Test how the system handles real-world failure scenarios</p>
        {[
          { key: "normal", label: "Normal sync", desc: "Standard sync, all data returns correctly", btn: "Run", cls: "btn" },
          { key: "flaky", label: "Flaky controller", desc: "Simulates an unstable connection. Retry logic activates.", btn: "Test", cls: "btn btn-amber" },
          { key: "down", label: "Controller down", desc: "Simulates complete outage. All retries fail.", btn: "Test", cls: "btn btn-red" },
        ].map(({ key, label, desc, btn, cls }) => (
          <div className="test-row" key={key}>
            <div className="test-row-info"><div className="test-row-label">{label}</div><div className="test-row-desc">{desc}</div></div>
            <div className="test-row-action">
              <button className={cls} onClick={() => runTest(key, key)}>{btn}</button>
              {testResults[key] && <div className="test-result">{testResults[key]}</div>}
            </div>
          </div>
        ))}
        <div className="test-row">
          <div className="test-row-info"><div className="test-row-label">AI insights</div><div className="test-row-desc">Generate venue insights from current session data</div></div>
          <div className="test-row-action">
            <button className="btn btn-primary" onClick={() => { handleInsights(true); insightsRef.current?.scrollIntoView({ behavior: "smooth" }); }} disabled={insightLoading}>Generate</button>
            {testResults.insights && <div className="test-result">{testResults.insights}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
