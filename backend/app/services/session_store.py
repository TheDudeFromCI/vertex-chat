from __future__ import annotations

import time

from app.models.session_state import SessionState


class SessionStore:
    def __init__(self) -> None:
        self._sessions: dict[str, SessionState] = {}

    def get_or_create(self, client_id: str) -> SessionState:
        session = self._sessions.get(client_id)
        if session is None:
            session = SessionState(client_id=client_id)
            self._sessions[client_id] = session
        return session

    def touch(self, client_id: str) -> SessionState:
        session = self.get_or_create(client_id)
        session.last_seen_at = time.time()
        return session
