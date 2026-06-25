import sys
from pathlib import Path

from mangum import Mangum
from starlette.types import ASGIApp, Receive, Scope, Send

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.main import app as fastapi_app


class StripApiPrefix:
    """Map /api/* requests to FastAPI routes at /*."""

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http":
            path = scope.get("path", "")
            if path == "/api":
                scope = {**scope, "path": "/"}
            elif path.startswith("/api/"):
                scope = {**scope, "path": path[4:]}
        await self.app(scope, receive, send)


handler = Mangum(StripApiPrefix(fastapi_app), lifespan="auto")
