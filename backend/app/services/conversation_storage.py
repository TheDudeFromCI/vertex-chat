from __future__ import annotations

import copy
import json
import time
from pathlib import Path
from typing import Any
from uuid import uuid4


class ConversationStorage:
    def __init__(self, base_dir: Path) -> None:
        self._base_dir = base_dir
        self._index_path = self._base_dir / "index.json"
        self._ensure_storage_initialized()

    def list_conversations(self) -> list[dict[str, Any]]:
        index_payload = self._read_json(self._index_path)
        conversations = index_payload.get("conversations", [])
        if not isinstance(conversations, list):
            return []
        return [entry for entry in conversations if isinstance(entry, dict)]

    def load_conversation(self, conversation_id: str) -> dict[str, Any] | None:
        index_entry = self._find_index_entry(conversation_id)
        if index_entry is None:
            return None

        file_path_value = index_entry.get("filePath")
        if not isinstance(file_path_value, str):
            return None

        conversation_path = self._base_dir / file_path_value
        payload = self._read_json(conversation_path)
        if not isinstance(payload, dict):
            return None
        return payload

    def create_conversation(
        self,
        name: str,
        participants: list[dict[str, Any]],
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        conversation_id = f"conv_{uuid4().hex}"
        file_name = f"{conversation_id}.json"
        now = time.time()

        conversation_payload: dict[str, Any] = {
            "id": conversation_id,
            "name": name,
            "participants": participants,
            "messages": [],
            "metadata": metadata or {},
            "createdAt": now,
            "updatedAt": now,
        }
        self._write_json(self._base_dir / file_name, conversation_payload)

        index_entry: dict[str, Any] = {
            "id": conversation_id,
            "name": name,
            "filePath": file_name,
            "updatedAt": now,
            "preview": "",
            "metadata": metadata or {},
        }
        index_payload = self._read_json(self._index_path)
        conversations = index_payload.get("conversations", [])
        if not isinstance(conversations, list):
            conversations = []
        conversations.insert(0, index_entry)
        index_payload["conversations"] = conversations
        self._write_json(self._index_path, index_payload)
        return index_entry

    def append_message(
        self,
        conversation_id: str,
        sender: str,
        content: str,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        conversation_payload = self.load_conversation(conversation_id)
        if conversation_payload is None:
            return None

        messages = conversation_payload.get("messages")
        if not isinstance(messages, list):
            messages = []
            conversation_payload["messages"] = messages

        message_payload: dict[str, Any] = {
            "id": f"msg_{uuid4().hex}",
            "sender": sender,
            "timestamp": time.time(),
            "content": content,
            "metadata": metadata or {},
        }
        messages.append(message_payload)
        conversation_payload["updatedAt"] = message_payload["timestamp"]

        index_entry = self._find_index_entry(conversation_id)
        if index_entry is None:
            return None

        file_path_value = index_entry.get("filePath")
        if not isinstance(file_path_value, str):
            return None

        self._write_json(self._base_dir / file_path_value, conversation_payload)
        self._update_index_after_message(conversation_id, content, float(message_payload["timestamp"]))
        return message_payload

    def update_message(self, conversation_id: str, message_id: str, content: str) -> dict[str, Any] | None:
        conversation_payload = self.load_conversation(conversation_id)
        if conversation_payload is None:
            return None

        messages = conversation_payload.get("messages")
        if not isinstance(messages, list):
            return None

        now = time.time()
        updated_message: dict[str, Any] | None = None
        for message in messages:
            if not isinstance(message, dict):
                continue
            if message.get("id") != message_id:
                continue

            message["content"] = content
            metadata = message.get("metadata")
            if not isinstance(metadata, dict):
                metadata = {}
            metadata["edited"] = True
            metadata["editedAt"] = now
            message["metadata"] = metadata
            updated_message = message
            break

        if updated_message is None:
            return None

        conversation_payload["updatedAt"] = now
        index_entry = self._find_index_entry(conversation_id)
        if index_entry is None:
            return None
        file_path_value = index_entry.get("filePath")
        if not isinstance(file_path_value, str):
            return None

        self._write_json(self._base_dir / file_path_value, conversation_payload)
        latest_content = self._latest_preview_content(messages)
        self._update_index_after_message(conversation_id, latest_content, now)
        return updated_message

    def delete_conversation(self, conversation_id: str) -> bool:
        index_payload = self._read_json(self._index_path)
        conversations = index_payload.get("conversations", [])
        if not isinstance(conversations, list):
            return False

        removed: dict[str, Any] | None = None
        next_conversations: list[dict[str, Any]] = []
        for entry in conversations:
            if not isinstance(entry, dict):
                continue
            if entry.get("id") == conversation_id:
                removed = entry
                continue
            next_conversations.append(entry)

        if removed is None:
            return False

        file_path_value = removed.get("filePath")
        if isinstance(file_path_value, str):
            conversation_path = self._base_dir / file_path_value
            if conversation_path.exists():
                conversation_path.unlink()

        index_payload["conversations"] = next_conversations
        self._write_json(self._index_path, index_payload)

        if not next_conversations:
            default_participants = [
                {"id": "user", "displayName": "User", "role": "user", "metadata": {}},
                {"id": "assistant", "displayName": "Assistant", "role": "assistant", "metadata": {}},
            ]
            self.create_conversation(
                name="General Assistant",
                participants=default_participants,
                metadata={"seeded": True},
            )

        return True

    def clone_conversation(self, conversation_id: str, name: str | None = None) -> dict[str, Any] | None:
        conversation_payload = self.load_conversation(conversation_id)
        if conversation_payload is None:
            return None

        source_name = str(conversation_payload.get("name", "Conversation")).strip() or "Conversation"
        clone_name = name.strip() if isinstance(name, str) and name.strip() else f"{source_name} (copy)"

        source_participants = conversation_payload.get("participants")
        participants = source_participants if isinstance(source_participants, list) else []

        source_metadata = conversation_payload.get("metadata")
        metadata = source_metadata if isinstance(source_metadata, dict) else {}

        index_entry = self.create_conversation(
            name=clone_name,
            participants=copy.deepcopy([item for item in participants if isinstance(item, dict)]),
            metadata=copy.deepcopy(metadata),
        )

        clone_id = str(index_entry.get("id", ""))
        clone_payload = self.load_conversation(clone_id)
        if clone_payload is None:
            return None

        source_messages = conversation_payload.get("messages")
        copied_messages: list[dict[str, Any]] = []
        if isinstance(source_messages, list):
            for message in source_messages:
                if not isinstance(message, dict):
                    continue
                copied = copy.deepcopy(message)
                copied["id"] = f"msg_{uuid4().hex}"
                copied_messages.append(copied)

        clone_payload["messages"] = copied_messages
        now = time.time()
        clone_payload["updatedAt"] = now

        file_path_value = index_entry.get("filePath")
        if not isinstance(file_path_value, str):
            return None

        self._write_json(self._base_dir / file_path_value, clone_payload)
        preview = self._latest_preview_content(copied_messages)
        self._update_index_after_message(clone_id, preview, now)
        return index_entry

    def add_participant(self, conversation_id: str, participant: dict[str, Any]) -> dict[str, Any] | None:
        conversation_payload = self.load_conversation(conversation_id)
        if conversation_payload is None:
            return None

        participants = conversation_payload.get("participants")
        if not isinstance(participants, list):
            participants = []
            conversation_payload["participants"] = participants

        participant_id = str(participant.get("id", "")).strip()
        if not participant_id:
            return None

        for existing in participants:
            if isinstance(existing, dict) and str(existing.get("id", "")).strip() == participant_id:
                return None

        participants.append(participant)
        metadata = conversation_payload.get("metadata")
        if not isinstance(metadata, dict):
            metadata = {}

        role = str(participant.get("role", "")).strip()
        if role == "assistant" and "activeAssistantId" not in metadata:
            metadata["activeAssistantId"] = participant_id

        conversation_payload["metadata"] = metadata
        return self._save_conversation_payload(conversation_id, conversation_payload)

    def update_participant_persona(
        self,
        conversation_id: str,
        participant_id: str,
        persona_id: str,
        persona_name: str,
    ) -> dict[str, Any] | None:
        conversation_payload = self.load_conversation(conversation_id)
        if conversation_payload is None:
            return None

        participants = conversation_payload.get("participants")
        if not isinstance(participants, list):
            return None

        updated = False
        for participant in participants:
            if not isinstance(participant, dict):
                continue
            if str(participant.get("id", "")).strip() != participant_id:
                continue

            metadata = participant.get("metadata")
            if not isinstance(metadata, dict):
                metadata = {}
            metadata["personaId"] = persona_id
            participant["metadata"] = metadata
            participant["displayName"] = persona_name
            updated = True
            break

        if not updated:
            return None

        return self._save_conversation_payload(conversation_id, conversation_payload)

    def set_active_assistant(self, conversation_id: str, participant_id: str) -> dict[str, Any] | None:
        conversation_payload = self.load_conversation(conversation_id)
        if conversation_payload is None:
            return None

        participants = conversation_payload.get("participants")
        if not isinstance(participants, list):
            return None

        exists_as_assistant = False
        for participant in participants:
            if not isinstance(participant, dict):
                continue
            if str(participant.get("id", "")).strip() != participant_id:
                continue
            if str(participant.get("role", "")).strip() == "assistant":
                exists_as_assistant = True
            break

        if not exists_as_assistant:
            return None

        metadata = conversation_payload.get("metadata")
        if not isinstance(metadata, dict):
            metadata = {}
        metadata["activeAssistantId"] = participant_id
        conversation_payload["metadata"] = metadata

        return self._save_conversation_payload(conversation_id, conversation_payload)

    def get_active_assistant(self, conversation_id: str) -> dict[str, Any] | None:
        conversation_payload = self.load_conversation(conversation_id)
        if conversation_payload is None:
            return None

        participants = conversation_payload.get("participants")
        if not isinstance(participants, list):
            return None

        metadata = conversation_payload.get("metadata")
        active_id = metadata.get("activeAssistantId") if isinstance(metadata, dict) else None
        if isinstance(active_id, str) and active_id:
            for participant in participants:
                if not isinstance(participant, dict):
                    continue
                if str(participant.get("id", "")).strip() == active_id and str(participant.get("role", "")).strip() == "assistant":
                    return participant

        for participant in participants:
            if not isinstance(participant, dict):
                continue
            if str(participant.get("role", "")).strip() == "assistant":
                return participant

        return None

    def _update_index_after_message(self, conversation_id: str, preview: str, updated_at: float) -> None:
        index_payload = self._read_json(self._index_path)
        conversations = index_payload.get("conversations", [])
        if not isinstance(conversations, list):
            return

        for entry in conversations:
            if isinstance(entry, dict) and entry.get("id") == conversation_id:
                entry["preview"] = preview[:80]
                entry["updatedAt"] = updated_at
                break

        index_payload["conversations"] = conversations
        self._write_json(self._index_path, index_payload)

    def _find_index_entry(self, conversation_id: str) -> dict[str, Any] | None:
        for entry in self.list_conversations():
            if entry.get("id") == conversation_id:
                return entry
        return None

    def _latest_preview_content(self, messages: list[Any]) -> str:
        for message in reversed(messages):
            if isinstance(message, dict):
                content = message.get("content")
                if isinstance(content, str) and content.strip():
                    return content
        return ""

    def _save_conversation_payload(self, conversation_id: str, conversation_payload: dict[str, Any]) -> dict[str, Any] | None:
        index_entry = self._find_index_entry(conversation_id)
        if index_entry is None:
            return None

        file_path_value = index_entry.get("filePath")
        if not isinstance(file_path_value, str):
            return None

        now = time.time()
        conversation_payload["updatedAt"] = now
        self._write_json(self._base_dir / file_path_value, conversation_payload)
        messages = conversation_payload.get("messages")
        preview = self._latest_preview_content(messages) if isinstance(messages, list) else ""
        self._update_index_after_message(conversation_id, preview, now)
        return conversation_payload

    def _ensure_storage_initialized(self) -> None:
        self._base_dir.mkdir(parents=True, exist_ok=True)

        if not self._index_path.exists():
            self._write_json(
                self._index_path,
                {
                    "version": 1,
                    "conversations": [],
                },
            )

        if self.list_conversations():
            return

        default_participants = [
            {"id": "user", "displayName": "User", "role": "user", "metadata": {}},
            {"id": "assistant", "displayName": "Assistant", "role": "assistant", "metadata": {}},
        ]
        self.create_conversation(
            name="General Assistant",
            participants=default_participants,
            metadata={"seeded": True},
        )

    def _read_json(self, path: Path) -> dict[str, Any]:
        if not path.exists():
            return {}

        raw = path.read_text(encoding="utf-8")
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            return {}

        if not isinstance(parsed, dict):
            return {}
        return parsed

    def _write_json(self, path: Path, payload: dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
