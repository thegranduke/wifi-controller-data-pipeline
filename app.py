"""Vercel entrypoint — re-exports the FastAPI app from the backend package."""
from backend.main import app

__all__ = ["app"]
