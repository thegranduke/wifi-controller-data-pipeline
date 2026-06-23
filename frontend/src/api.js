const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

async function request(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, options);
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

export function triggerSync() {
  return request("/sync", { method: "POST" });
}

export function fetchVenues() {
  return request("/venues");
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

export function fetchSyncLogs() {
  return request("/sync-logs");
}

export function fetchInsights() {
  return request("/insights", { method: "POST" });
}
