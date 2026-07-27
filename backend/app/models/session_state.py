from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any


@dataclass
class SessionState:
    client_id: str
    connected: bool = False
    connection_count: int = 0
    message_count: int = 0
    last_payload: dict[str, Any] | None = None
    last_seen_at: float = field(default_factory=time.time)

    def snapshot(self) -> dict[str, Any]:
        return {
            "clientId": self.client_id,
            "connected": self.connected,
            "connectionCount": self.connection_count,
            "messageCount": self.message_count,
            "lastPayload": self.last_payload,
            "lastSeenAt": self.last_seen_at,
        }
