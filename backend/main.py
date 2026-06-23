from datetime import datetime
from uuid import UUID

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.insights import generate_insights
from backend.models import AccessPoint, Session as WifiSession, SyncLog, Venue
from backend.sync import run_sync

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/sync")
def trigger_sync(mode: str = "normal", db: Session = Depends(get_db)):
    if mode not in ("normal", "flaky", "down"):
        raise HTTPException(status_code=400, detail="mode must be normal, flaky, or down")
    result = run_sync(db, mode=mode)
    return result


@app.get("/health")
def health(db: Session = Depends(get_db)):
    try:
        db.execute(text("SELECT 1"))
        return {"status": "ok", "db": "connected", "timestamp": datetime.utcnow().isoformat()}
    except Exception as e:
        raise HTTPException(status_code=503, detail={"status": "error", "db": str(e)})


@app.get("/venues")
def list_venues(db: Session = Depends(get_db)):
    return [
        {"id": v.id, "network_id": v.network_id, "name": v.name, "city": v.city, "country": v.country, "updated_at": v.updated_at}
        for v in db.query(Venue).order_by(Venue.name).all()
    ]


@app.get("/access-points")
def list_access_points(db: Session = Depends(get_db)):
    return [
        {"id": ap.id, "mac": ap.mac, "name": ap.name, "model": ap.model, "venue_id": ap.venue_id}
        for ap in db.query(AccessPoint).order_by(AccessPoint.name).all()
    ]


@app.get("/sessions")
def list_sessions(venue_id: UUID | None = None, limit: int = 100, offset: int = 0, db: Session = Depends(get_db)):
    query = db.query(WifiSession, func.count(WifiSession.id).over().label("total")).join(
        AccessPoint, WifiSession.access_point_id == AccessPoint.id
    )
    if venue_id is not None:
        query = query.filter(AccessPoint.venue_id == venue_id)
    rows = query.order_by(WifiSession.connected_at.desc()).offset(offset).limit(limit).all()
    total = rows[0][1] if rows else 0
    return {"total": total, "sessions": [{"id": s.id, "client_mac": s.client_mac, "device_type": s.device_type, "duration_seconds": s.duration_seconds, "connected_at": s.connected_at, "access_point_id": s.access_point_id} for s, _ in rows]}


@app.get("/sync-logs")
def list_sync_logs(db: Session = Depends(get_db)):
    return [
        {"id": log.id, "status": log.status, "venues_synced": log.venues_synced, "aps_synced": log.aps_synced, "sessions_synced": log.sessions_synced, "error_message": log.error_message, "synced_at": log.synced_at}
        for log in db.query(SyncLog).order_by(SyncLog.synced_at.desc()).limit(10).all()
    ]


@app.post("/insights")
def insights(db: Session = Depends(get_db)):
    try:
        return generate_insights(db)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
