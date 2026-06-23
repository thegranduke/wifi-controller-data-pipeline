import { useMemo, useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const BAR_COLOR = "#0070f3";
const tooltipStyle = { fontSize: 12, border: "1px solid #eaeaea", borderRadius: 5, boxShadow: "none" };

export default function SessionCharts({ sessions, accessPoints, loading }) {
  const [drillAp, setDrillAp] = useState(null);

  const apMap = useMemo(
    () => Object.fromEntries(accessPoints.map((ap) => [ap.id, ap])),
    [accessPoints],
  );
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
            <div className="chart-label">Peak hours — {drillAp.name}</div>
            <ResponsiveContainer width="100%" height={chartH}>
              <BarChart data={byHour} margin={{ left: 8, right: 8, top: 4, bottom: 4 }}>
                <XAxis dataKey="hour" tick={{ fontSize: 9, fill: "#999" }} axisLine={false} tickLine={false} interval={2} />
                <YAxis hide />
                <Tooltip cursor={{ fill: "#f5f5f5" }} contentStyle={tooltipStyle} />
                <Bar dataKey="count" fill={BAR_COLOR} radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="chart-card">
            <div className="chart-label">
              By access point <span className="chart-hint">click to drill in</span>
            </div>
            <ResponsiveContainer width="100%" height={Math.max(120, byAp.length * 36)}>
              <BarChart layout="vertical" data={byAp} margin={{ left: 8, right: 28, top: 4, bottom: 4 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" width={88} tick={{ fontSize: 11, fill: "#666" }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: "#f5f5f5" }} contentStyle={tooltipStyle} />
                <Bar dataKey="count" fill={BAR_COLOR} radius={[0, 3, 3, 0]} cursor="pointer"
                  onClick={(_, index) => {
                    const row = byAp[index];
                    if (row) setDrillAp({ id: row.id, name: row.name });
                  }} />
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
              <Bar dataKey="count" fill={BAR_COLOR} radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </>
  );
}
