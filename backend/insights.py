import json
import os
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta

import google.generativeai as genai
from sqlalchemy.orm import Session

from backend.models import AccessPoint, Session as WifiSession, Venue

VENUE_TYPES = {"The Anchor": "pub", "Brew & Co": "cafe", "Eastside Hotel Lobby": "hotel"}
DAYS = "Monday Tuesday Wednesday Thursday Friday Saturday Sunday".split()

SAMPLE_INSIGHTS = [
    {
        "venue_name": "The Anchor",
        "summary": "Steady evening traffic with a clear weekend spike — typical pub Wi-Fi pattern with most sessions clustered around food and drinks service.",
        "peak_time": "Fridays 17:00–21:00 (avg 28 sessions)",
        "pattern": "42% of sessions last under 5 minutes, suggesting many quick check-ins rather than long stays.",
        "action": "Consider a captive portal with a daily limit during peak hours to reduce bandwidth pressure on AP-Floor1.",
    },
    {
        "venue_name": "Brew & Co",
        "summary": "Moderate weekday morning traffic driven by remote workers, with shorter sessions than the pub venues.",
        "peak_time": "Wednesdays 09:00–12:00 (avg 19 sessions)",
        "pattern": "Average session length is 38 minutes — longer than pub venues but still below hotel lobby dwell time.",
        "action": "Promote a loyalty Wi-Fi landing page during morning peaks to capture repeat customer emails.",
    },
    {
        "venue_name": "Eastside Hotel Lobby",
        "summary": "Highest session volume of all venues, with long dwell times consistent with hotel guest and traveller behaviour.",
        "peak_time": "Sundays 14:00–18:00 (avg 34 sessions)",
        "pattern": "31% of sessions exceed 2 hours — significantly higher than cafe or pub venues.",
        "action": "Add bandwidth QoS rules on AP-Lobby to prioritise guest devices over conference-room traffic.",
    },
]


def _sample_insights(venue_names: set[str] | None = None) -> dict:
    venues = SAMPLE_INSIGHTS
    if venue_names:
        venues = [v for v in SAMPLE_INSIGHTS if v["venue_name"] in venue_names]
    return {"venues": venues or SAMPLE_INSIGHTS, "demo": True}


def generate_insights(db: Session) -> dict:
    since = datetime.utcnow() - timedelta(days=7)
    rows = (
        db.query(WifiSession.duration_seconds, WifiSession.connected_at, Venue.name)
        .join(AccessPoint, WifiSession.access_point_id == AccessPoint.id)
        .join(Venue, AccessPoint.venue_id == Venue.id)
        .filter(WifiSession.connected_at >= since)
        .all()
    )
    if not rows:
        return {"error": "No session data available yet. Run a sync first to generate insights."}

    venue_names = {name for _, _, name in rows if name}
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        return _sample_insights(venue_names)

    stats = defaultdict(lambda: {"n": 0, "dur": [], "days": defaultdict(int), "hours": defaultdict(int)})
    for dur, at, name in rows:
        if at is None:
            continue
        s = stats[name]
        s["n"] += 1
        s["dur"].append(dur or 0)
        s["days"][DAYS[at.weekday()]] += 1
        s["hours"][at.hour] += 1

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
    formatted_stats = "\n".join(lines)
    prompt = f"""
You are an analyst for a Wi-Fi venue platform. Analyse this session data and return 
a JSON array. One object per venue. No markdown, no explanation, just valid JSON.

Each object must have exactly these keys:
- venue_name: string
- summary: one sentence describing overall activity level and pattern
- peak_time: specific day and time window with a number e.g. "Fridays 17:00-21:00 (avg 23 sessions)"
- pattern: one unusual or notable observation with a specific number
- action: one concrete recommendation the venue manager should act on

Session data:
{formatted_stats}

Return only a JSON array. No backticks. No explanation.
"""
    try:
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel("gemini-2.5-flash")
        with ThreadPoolExecutor(max_workers=1) as executor:
            response = executor.submit(model.generate_content, prompt).result(timeout=30)
        try:
            insights = json.loads(response.text)
        except json.JSONDecodeError:
            return {"error": "Could not parse AI response", "raw": response.text}
        return {"venues": insights}
    except Exception:
        return {"error": "Insights unavailable — AI service unreachable. Please try again."}
