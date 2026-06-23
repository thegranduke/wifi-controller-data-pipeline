import os
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta

import google.generativeai as genai
from sqlalchemy.orm import Session

from backend.models import AccessPoint, Session as WifiSession, Venue

VENUE_TYPES = {"The Anchor": "pub", "Brew & Co": "cafe", "Eastside Hotel Lobby": "hotel"}
DAYS = "Monday Tuesday Wednesday Thursday Friday Saturday Sunday".split()

def generate_insights(db: Session) -> str:
    since = datetime.utcnow() - timedelta(days=7)
    rows = (
        db.query(WifiSession.duration_seconds, WifiSession.connected_at, Venue.name)
        .join(AccessPoint, WifiSession.access_point_id == AccessPoint.id)
        .join(Venue, AccessPoint.venue_id == Venue.id)
        .filter(WifiSession.connected_at >= since)
        .all()
    )
    if not rows:
        return "No session data available yet. Run a sync first to generate insights."

    stats = defaultdict(lambda: {"n": 0, "dur": [], "days": defaultdict(int), "hours": defaultdict(int)})
    for dur, at, name in rows:
        if at is None:
            continue
        s = stats[name]
        s["n"] += 1
        s["dur"].append(dur or 0)
        s["days"][DAYS[at.weekday()]] += 1
        s["hours"][at.hour] += 1

    header = (
        "You are an analyst helping Wi-Fi venue operators understand guest behaviour.\n"
        "Below is session data from the last 7 days. Give 3-4 specific actionable insights "
        "a venue manager would find useful. Focus on: peak times, unusual patterns, "
        "differences between venues, and opportunities. Be specific with numbers. "
        "Do not use bullet points — write short punchy sentences.\n\n"
    )
    lines = []
    for name, s in stats.items():
        avg = sum(s["dur"]) / s["n"] / 60
        peak_h = max(range(23), key=lambda h: s["hours"].get(h, 0) + s["hours"].get(h + 1, 0))
        lines.append(
            f"{name} ({VENUE_TYPES.get(name, 'venue')}): {s['n']} sessions. Avg duration {avg:.1f} min. "
            f"Busiest: {max(s['days'], key=s['days'].get)} {peak_h:02d}:00-{(peak_h + 2) % 24:02d}:00. "
            f"{100 * sum(d < 300 for d in s['dur']) / s['n']:.0f}% sessions under 5 min. "
            f"{100 * sum(d > 7200 for d in s['dur']) / s['n']:.0f}% over 2 hours."
        )
    try:
        genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
        model = genai.GenerativeModel("gemini-2.5-flash")
        with ThreadPoolExecutor(max_workers=1) as executor:
            response = executor.submit(model.generate_content, header + "\n".join(lines)).result(timeout=30)
        return response.text
    except Exception:
        return "Insights unavailable — AI service unreachable. Please try again."
