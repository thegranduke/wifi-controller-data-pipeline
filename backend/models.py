import uuid
from datetime import datetime

from sqlalchemy import (
    JSON,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


class Venue(Base):
    __tablename__ = "venues"

    id = Column(Uuid, primary_key=True, default=uuid.uuid4)
    network_id = Column(String, unique=True, nullable=False)
    name = Column(String)
    city = Column(String)
    country = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class AccessPoint(Base):
    __tablename__ = "access_points"

    id = Column(Uuid, primary_key=True, default=uuid.uuid4)
    mac = Column(String, unique=True, nullable=False)
    name = Column(String)
    model = Column(String)
    venue_id = Column(Uuid, ForeignKey("venues.id"))
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Session(Base):
    __tablename__ = "sessions"
    __table_args__ = (UniqueConstraint("client_mac", "connected_at"),)

    id = Column(Uuid, primary_key=True, default=uuid.uuid4)
    client_mac = Column(String)
    device_type = Column(String)
    duration_seconds = Column(Integer)
    connected_at = Column(DateTime)
    access_point_id = Column(Uuid, ForeignKey("access_points.id"))
    created_at = Column(DateTime, default=datetime.utcnow)


class SyncLog(Base):
    __tablename__ = "sync_logs"

    id = Column(Uuid, primary_key=True, default=uuid.uuid4)
    status = Column(String)
    venues_synced = Column(Integer)
    aps_synced = Column(Integer)
    sessions_synced = Column(Integer)
    error_message = Column(String, nullable=True)
    raw_payload = Column(JSON, nullable=True)
    synced_at = Column(DateTime, default=datetime.utcnow)
