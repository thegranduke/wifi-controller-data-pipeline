from contextlib import asynccontextmanager
from datetime import datetime
from typing import Literal
from uuid import UUID

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from backend import database as _db
from backend.database import get_db
from backend.insights import generate_insights
from backend.models import AccessPoint, Base, Session as WifiSession, SyncLog, Venue
from backend.schemas import (
    AccessPointOut, SessionListOut, SessionOut,
    SyncLogListOut, SyncLogOut, SyncResultOut, VenueOut,
)
from backend.sync import run_sync


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Access engine via module so tests can patch backend.database.engine
    Base.metadata.create_all(bind=_db.engine)
    yield


app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/sync", response_model=SyncResultOut)
def trigger_sync(
    mode: Literal["normal", "flaky", "down"] = "normal",
    db: Session = Depends(get_db),
):
    return run_sync(db, mode=mode)


@app.get("/health")
def health(db: Session = Depends(get_db)):
    try:
        db.execute(text("SELECT 1"))
        return {"status": "ok", "db": "connected", "timestamp": datetime.utcnow().isoformat()}
    except Exception as e:
        raise HTTPException(status_code=503, detail={"status": "error", "db": str(e)})


@app.get("/venues", response_model=list[VenueOut])
def list_venues(db: Session = Depends(get_db)):
    return db.query(Venue).order_by(Venue.name).all()


@app.get("/access-points", response_model=list[AccessPointOut])
def list_access_points(db: Session = Depends(get_db)):
    return db.query(AccessPoint).order_by(AccessPoint.name).all()


@app.get("/sessions", response_model=SessionListOut)
def list_sessions(
    venue_id: UUID | None = None,
    limit: int = Query(default=20, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
):
    query = db.query(WifiSession, func.count(WifiSession.id).over().label("total")).join(
        AccessPoint, WifiSession.access_point_id == AccessPoint.id
    )
    if venue_id is not None:
        query = query.filter(AccessPoint.venue_id == venue_id)
    rows = query.order_by(WifiSession.connected_at.desc()).offset(offset).limit(limit).all()
    total = rows[0][1] if rows else 0
    return SessionListOut(total=total, sessions=[s for s, _ in rows])


@app.get("/sync-logs", response_model=SyncLogListOut)
def list_sync_logs(
    limit: int = Query(default=10, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(SyncLog, func.count(SyncLog.id).over().label("total"))
        .order_by(SyncLog.synced_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    total = rows[0][1] if rows else 0
    return SyncLogListOut(total=total, logs=[log for log, _ in rows])


@app.post("/insights")
def insights(db: Session = Depends(get_db)):
    try:
        return generate_insights(db)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
