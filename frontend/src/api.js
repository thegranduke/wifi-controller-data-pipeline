// Local dev/Docker: /api via Vite proxy. Railway: window.__API_URL__ set at container start.
const BASE_URL = window.__API_URL__ || import.meta.env.VITE_API_URL || "/api";

async function request(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, options);
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

export function triggerSync(mode = "normal") {
  return request(`/sync?mode=${mode}`, { method: "POST" });
}

export function fetchVenues() {
  return request("/venues");
}

export function fetchAccessPoints() {
  return request("/access-points");
}

export function fetchSessionsAll(venueId, limit = 500) {
  const params = new URLSearchParams({ limit: String(limit), offset: "0" });
  if (venueId) params.set("venue_id", venueId);
  return request(`/sessions?${params}`).then((d) => d.sessions);
}

export function fetchSessions(venueId, page) {
  const params = new URLSearchParams({
    limit: "20",
    offset: String(page * 20),
  });
  if (venueId) {
    params.set("venue_id", venueId);
  }
  return request(`/sessions?${params}`);
}

export function fetchSyncLogs(page = 0, limit = 10) {
  const params = new URLSearchParams({ limit: String(limit), offset: String(page * limit) });
  return request(`/sync-logs?${params}`);
}

export function fetchInsights() {
  return request("/insights", { method: "POST" });
}

export async function fetchHealth() {
  const response = await fetch(`${BASE_URL}/health`);
  if (!response.ok) {
    throw new Error("unhealthy");
  }
  return response.json();
}
