from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from app.services.conversation_storage import ConversationStorage
from app.services.persona_catalog import PersonaCatalog
from app.services.session_store import SessionStore
from app.services.tool_registry import ToolRegistry
from app.services.websocket_service import WebSocketService

app = FastAPI(title="Vertex API")
FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"
CONVERSATIONS_DIR = Path(__file__).resolve().parents[1] / "data" / "conversations"
PERSONAS_PATH = Path(__file__).resolve().parents[1] / "data" / "personas.json"
store = SessionStore()
tool_registry = ToolRegistry()
conversation_storage = ConversationStorage(base_dir=CONVERSATIONS_DIR)
persona_catalog = PersonaCatalog(personas_path=PERSONAS_PATH)
websocket_service = WebSocketService(
    store=store,
    tool_registry=tool_registry,
    conversation_storage=conversation_storage,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/tools")
def tools() -> dict[str, Any]:
    return {
        "version": "1.0",
        "tools": tool_registry.definitions(),
    }


@app.get("/api/personas")
def personas() -> dict[str, Any]:
    return {
        "version": "1.0",
        "personas": persona_catalog.list_personas(),
    }


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    await websocket_service.handle_connection(websocket)


if FRONTEND_DIST.exists():
        app.mount("/", StaticFiles(directory=str(FRONTEND_DIST), html=True), name="frontend")
else:

        @app.get("/", include_in_schema=False)
        def frontend_not_built() -> HTMLResponse:
                return HTMLResponse(
                        """
                        <!doctype html>
                        <html lang="en">
                            <head>
                                <meta charset="UTF-8" />
                                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                                <title>Vertex</title>
                            </head>
                            <body>
                                <main style="font-family: sans-serif; padding: 2rem;">
                                    <h1>Vertex</h1>
                                    <p>The frontend has not been built yet. Run the frontend build step and restart the backend.</p>
                                </main>
                            </body>
                        </html>
                        """.strip()
                )
