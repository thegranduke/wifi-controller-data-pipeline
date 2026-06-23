import logging
import uuid
from datetime import datetime

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from backend.mock_controller import get_controller_data
from backend.models import AccessPoint, Session as WifiSession, SyncLog, Venue

logger = logging.getLogger(__name__)


def _batch_execute(db: Session, stmt):
    """Run one multi-row INSERT statement; return rowcount."""
    if stmt is None:
        return 0
    return db.execute(stmt).rowcount or 0

VENUE_FIELDS = ("network_id", "name", "city", "country")
AP_FIELDS = ("mac", "name", "model", "venue_network_id")
SESSION_FIELDS = (
    "client_mac",
    "device_type",
    "duration_seconds",
    "connected_at",
    "ap_mac",
)


def _write_sync_log(
    db: Session,
    status: str,
    venues_synced: int = 0,
    aps_synced: int = 0,
    sessions_synced: int = 0,
    error_message: str | None = None,
    raw_payload: dict | None = None,
) -> None:
    db.add(
        SyncLog(
            status=status,
            venues_synced=venues_synced,
            aps_synced=aps_synced,
            sessions_synced=sessions_synced,
            error_message=error_message,
            raw_payload=raw_payload,
        )
    )
    db.commit()


def _valid_record(record: dict, fields: tuple[str, ...]) -> bool:
    return all(field in record for field in fields)


def _validate_payload(payload: dict) -> tuple[list, list, list]:
    for key in ("venues", "access_points", "sessions"):
        if key not in payload:
            logger.warning("Payload missing key: %s", key)

    venues = []
    for venue in payload.get("venues", []):
        if _valid_record(venue, VENUE_FIELDS):
            venues.append(venue)
        else:
            logger.warning("Skipping invalid venue: %s", venue)

    access_points = []
    for ap in payload.get("access_points", []):
        if _valid_record(ap, AP_FIELDS):
            access_points.append(ap)
        else:
            logger.warning("Skipping invalid access point: %s", ap)

    sessions = []
    for session in payload.get("sessions", []):
        if _valid_record(session, SESSION_FIELDS):
            sessions.append(session)
        else:
            logger.warning("Skipping invalid session: %s", session)

    return venues, access_points, sessions


def run_sync(db: Session) -> dict:
    try:
        payload = get_controller_data()
    except Exception as exc:
        _write_sync_log(db, "failed", error_message=str(exc))
        return {
            "status": "failed",
            "venues_synced": 0,
            "aps_synced": 0,
            "sessions_synced": 0,
        }

    venues, access_points, sessions = _validate_payload(payload)
    venues_synced = 0
    aps_synced = 0
    sessions_synced = 0

    try:
        now = datetime.utcnow()
        venue_rows = [
            {
                "id": uuid.uuid4(),
                "network_id": v["network_id"],
                "name": v["name"],
                "city": v["city"],
                "country": v["country"],
                "created_at": now,
                "updated_at": now,
            }
            for v in venues
        ]
        if venue_rows:
            stmt = insert(Venue).values(venue_rows)
            stmt = stmt.on_conflict_do_update(
                index_elements=["network_id"],
                set_={
                    "name": stmt.excluded.name,
                    "city": stmt.excluded.city,
                    "country": stmt.excluded.country,
                    "updated_at": now,
                },
            )
            _batch_execute(db, stmt)
            venues_synced = len(venue_rows)

        venue_lookup = {v.network_id: v.id for v in db.query(Venue).all()}

        ap_rows = []
        for ap in access_points:
            venue_id = venue_lookup.get(ap["venue_network_id"])
            if venue_id is None:
                logger.warning(
                    "Skipping access point %s: venue %s not found",
                    ap.get("mac"),
                    ap.get("venue_network_id"),
                )
                continue
            ap_rows.append(
                {
                    "id": uuid.uuid4(),
                    "mac": ap["mac"],
                    "name": ap["name"],
                    "model": ap["model"],
                    "venue_id": venue_id,
                    "created_at": now,
                    "updated_at": now,
                }
            )
        if ap_rows:
            stmt = insert(AccessPoint).values(ap_rows)
            stmt = stmt.on_conflict_do_update(
                index_elements=["mac"],
                set_={
                    "name": stmt.excluded.name,
                    "model": stmt.excluded.model,
                    "venue_id": stmt.excluded.venue_id,
                    "updated_at": now,
                },
            )
            _batch_execute(db, stmt)
            aps_synced = len(ap_rows)

        ap_lookup = {ap.mac: ap.id for ap in db.query(AccessPoint).all()}

        session_rows = []
        for session in sessions:
            access_point_id = ap_lookup.get(session["ap_mac"])
            if access_point_id is None:
                logger.warning(
                    "Skipping session %s: access point %s not found",
                    session.get("client_mac"),
                    session.get("ap_mac"),
                )
                continue
            session_rows.append(
                {
                    "id": uuid.uuid4(),
                    "client_mac": session["client_mac"],
                    "device_type": session["device_type"],
                    "duration_seconds": session["duration_seconds"],
                    "connected_at": datetime.fromisoformat(session["connected_at"]),
                    "access_point_id": access_point_id,
                    "created_at": now,
                }
            )
        if session_rows:
            stmt = insert(WifiSession).values(session_rows).on_conflict_do_nothing(
                index_elements=["client_mac", "connected_at"],
            )
            sessions_synced = _batch_execute(db, stmt)

    except Exception as exc:
        db.rollback()
        _write_sync_log(
            db,
            "failed",
            error_message=str(exc),
            raw_payload=payload,
        )
        return {
            "status": "failed",
            "venues_synced": 0,
            "aps_synced": 0,
            "sessions_synced": 0,
        }

    _write_sync_log(
        db,
        "success",
        venues_synced=venues_synced,
        aps_synced=aps_synced,
        sessions_synced=sessions_synced,
        raw_payload=payload,
    )
    return {
        "status": "success",
        "venues_synced": venues_synced,
        "aps_synced": aps_synced,
        "sessions_synced": sessions_synced,
    }
