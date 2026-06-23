import logging
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from backend.mock_controller import get_controller_data
from backend.models import AccessPoint, Session as WifiSession, SyncLog, Venue

logger = logging.getLogger(__name__)

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
        with ThreadPoolExecutor(max_workers=1) as executor:
            payload = executor.submit(get_controller_data).result(timeout=5)
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
        for venue in venues:
            stmt = (
                insert(Venue)
                .values(
                    id=uuid.uuid4(),
                    network_id=venue["network_id"],
                    name=venue["name"],
                    city=venue["city"],
                    country=venue["country"],
                    created_at=now,
                    updated_at=now,
                )
                .on_conflict_do_update(
                    index_elements=["network_id"],
                    set_={
                        "name": venue["name"],
                        "city": venue["city"],
                        "country": venue["country"],
                        "updated_at": now,
                    },
                )
            )
            db.execute(stmt)
            venues_synced += 1

        venue_lookup = {
            venue.network_id: venue.id for venue in db.query(Venue).all()
        }

        for ap in access_points:
            venue_id = venue_lookup.get(ap["venue_network_id"])
            if venue_id is None:
                logger.warning(
                    "Skipping access point %s: venue %s not found",
                    ap.get("mac"),
                    ap.get("venue_network_id"),
                )
                continue

            stmt = (
                insert(AccessPoint)
                .values(
                    id=uuid.uuid4(),
                    mac=ap["mac"],
                    name=ap["name"],
                    model=ap["model"],
                    venue_id=venue_id,
                    created_at=now,
                    updated_at=now,
                )
                .on_conflict_do_update(
                    index_elements=["mac"],
                    set_={
                        "name": ap["name"],
                        "model": ap["model"],
                        "venue_id": venue_id,
                        "updated_at": now,
                    },
                )
            )
            db.execute(stmt)
            aps_synced += 1

        ap_lookup = {ap.mac: ap.id for ap in db.query(AccessPoint).all()}

        for session in sessions:
            access_point_id = ap_lookup.get(session["ap_mac"])
            if access_point_id is None:
                logger.warning(
                    "Skipping session %s: access point %s not found",
                    session.get("client_mac"),
                    session.get("ap_mac"),
                )
                continue

            connected_at = datetime.fromisoformat(session["connected_at"])
            stmt = (
                insert(WifiSession)
                .values(
                    id=uuid.uuid4(),
                    client_mac=session["client_mac"],
                    device_type=session["device_type"],
                    duration_seconds=session["duration_seconds"],
                    connected_at=connected_at,
                    access_point_id=access_point_id,
                    created_at=now,
                )
                .on_conflict_do_nothing(
                    index_elements=["client_mac", "connected_at"],
                )
            )
            result = db.execute(stmt)
            sessions_synced += result.rowcount

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
