import { useEffect, useState } from "react";
import { fetchInsights, fetchSessions, fetchSyncLogs, fetchVenues, triggerSync } from "./api";

const fmtDate = (v) => (v ? new Date(v).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const fmtMin = (s) => `${Math.round((s || 0) / 60)} min`;

export default function App() {
  const [venues, setVenues] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [sessionTotal, setSessionTotal] = useState(0);
  const [sessionPage, setSessionPage] = useState(0);
  const [selectedVenue, setSelectedVenue] = useState(null);
  const [syncLogs, setSyncLogs] = useState([]);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [insight, setInsight] = useState("");
  const [insightLoading, setInsightLoading] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchVenues().then(setVenues);
    fetchSyncLogs().then(setSyncLogs);
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
      const [v, logs, s] = await Promise.all([fetchVenues(), fetchSyncLogs(), fetchSessions(selectedVenue, sessionPage)]);
      setVenues(v); setSyncLogs(logs); setSessions(s.sessions); setSessionTotal(s.total);
    } finally { setSyncing(false); }
  };

  const handleInsights = async () => {
    setInsightLoading(true);
    try { setInsight((await fetchInsights()).insight); } finally { setInsightLoading(false); }
  };

  const start = sessionTotal ? sessionPage * 20 + 1 : 0;
  const end = Math.min((sessionPage + 1) * 20, sessionTotal);
  const lastLog = syncLogs[0];

  return (
    <div className="container">
      <header className="header">
        <h1>bconnect dashboard</h1>
        <button className="btn btn-primary" onClick={handleSync} disabled={syncing}>{syncing ? "Syncing..." : "Sync now"}</button>
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
        {loading ? <div className="empty">Loading sessions...</div> : sessions.length === 0 ? <div className="empty">No sessions yet</div> : (
          <table><thead><tr><th>Device</th><th>Type</th><th>Duration</th><th>Connected at</th><th>Access point</th></tr></thead>
            <tbody>{sessions.map((s) => <tr key={s.id}><td>{s.client_mac}</td><td>{s.device_type}</td><td>{fmtMin(s.duration_seconds)}</td><td>{fmtDate(s.connected_at)}</td><td>{String(s.access_point_id).slice(0, 8)}</td></tr>)}</tbody>
          </table>
        )}
      </div>

      <div className="card">
        <div className="card-title">AI insights (Gemini)</div>
        <button className="btn btn-primary" onClick={handleInsights} disabled={insightLoading}>Generate insights</button>
        {insightLoading && <div className="empty">Analysing session data...</div>}
        {insight && !insightLoading && <div className="insight-box">{insight}</div>}
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
    </div>
  );
}
