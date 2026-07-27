from __future__ import annotations

import json
from pathlib import Path
from typing import Any


class PersonaCatalog:
    def __init__(self, personas_path: Path) -> None:
        self._personas_path = personas_path

    def list_personas(self) -> list[dict[str, Any]]:
        if not self._personas_path.exists():
            return []

        try:
            payload = json.loads(self._personas_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return []

        personas = payload.get("personas") if isinstance(payload, dict) else None
        if not isinstance(personas, list):
            return []

        return [entry for entry in personas if isinstance(entry, dict)]
