from __future__ import annotations

from typing import Any


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: list[dict[str, Any]] = [
            {
                "id": "story.continue",
                "name": "Continue Story",
                "description": "Continue a story using the current text and optional tone guidance.",
                "category": "writing",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "text": {"type": "string"},
                        "tone": {"type": "string"},
                    },
                    "required": ["text"],
                },
            },
            {
                "id": "story.rewrite",
                "name": "Rewrite Selection",
                "description": "Rewrite selected text according to style instructions.",
                "category": "writing",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "selection": {"type": "string"},
                        "instruction": {"type": "string"},
                    },
                    "required": ["selection"],
                },
            },
        ]

    def definitions(self) -> list[dict[str, Any]]:
        return self._tools

    def find(self, tool_id: str) -> dict[str, Any] | None:
        for tool in self._tools:
            if tool["id"] == tool_id:
                return tool
        return None

    def run(self, tool_id: str, tool_input: dict[str, Any]) -> dict[str, Any]:
        if tool_id == "story.continue":
            text = str(tool_input.get("text", "")).strip()
            tone = str(tool_input.get("tone", "neutral")).strip() or "neutral"
            if not text:
                raise ValueError("Input field 'text' is required")
            return {
                "text": f"[{tone}] {text} ... and the story turns toward a new complication.",
                "meta": {"model": "placeholder", "tool": tool_id},
            }

        if tool_id == "story.rewrite":
            selection = str(tool_input.get("selection", "")).strip()
            instruction = str(tool_input.get("instruction", "clarify")).strip() or "clarify"
            if not selection:
                raise ValueError("Input field 'selection' is required")
            return {
                "text": f"Rewrite ({instruction}): {selection}",
                "meta": {"model": "placeholder", "tool": tool_id},
            }

        raise ValueError(f"Unsupported tool id: {tool_id}")
