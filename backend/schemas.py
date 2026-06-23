from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class VenueOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    network_id: str
    name: str | None = None
    city: str | None = None
    country: str | None = None
    updated_at: datetime | None = None


class AccessPointOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    mac: str
    name: str | None = None
    model: str | None = None
    venue_id: UUID


class SessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    client_mac: str | None = None
    device_type: str | None = None
    duration_seconds: int | None = None
    connected_at: datetime | None = None
    access_point_id: UUID


class SessionListOut(BaseModel):
    total: int
    sessions: list[SessionOut]


class SyncLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    status: str | None = None
    venues_synced: int | None = None
    aps_synced: int | None = None
    sessions_synced: int | None = None
    error_message: str | None = None
    synced_at: datetime | None = None


class SyncLogListOut(BaseModel):
    total: int
    logs: list[SyncLogOut]


class SyncResultOut(BaseModel):
    status: str
    venues_synced: int
    aps_synced: int
    sessions_synced: int
    attempts: int
    error_message: str | None = None
