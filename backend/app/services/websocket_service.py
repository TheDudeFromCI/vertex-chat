from __future__ import annotations

import asyncio
import json
import time
from typing import Any
from uuid import uuid4

from fastapi import WebSocket
from fastapi import WebSocketDisconnect

from app.models.session_state import SessionState
from app.services.conversation_storage import ConversationStorage
from app.services.session_store import SessionStore
from app.services.tool_registry import ToolRegistry


class WebSocketService:
    def __init__(
        self,
        store: SessionStore,
        tool_registry: ToolRegistry,
        conversation_storage: ConversationStorage,
    ) -> None:
        self._store = store
        self._tool_registry = tool_registry
        self._conversation_storage = conversation_storage

    async def handle_connection(self, websocket: WebSocket) -> None:
        await websocket.accept()

        client_id = websocket.query_params.get("clientId") or f"client_{uuid4().hex}"
        session: SessionState | None = None

        try:
            hello_message = await asyncio.wait_for(websocket.receive_text(), timeout=10)
            hello_payload = json.loads(hello_message)
            if hello_payload.get("type") != "hello":
                await websocket.close(code=1008)
                return

            hello_request_id = hello_payload.get("requestId")

            if hello_payload.get("clientId"):
                client_id = str(hello_payload["clientId"])

            session = self._store.touch(client_id)
            session.connection_count += 1
            session.connected = True

            await websocket.send_json(
                {
                    "type": "welcome",
                    "serverTime": time.time(),
                    "session": session.snapshot(),
                    "requestId": hello_request_id,
                }
            )
            await self._send_conversation_list(websocket, session, hello_request_id)

            while True:
                message_text = await websocket.receive_text()
                payload = json.loads(message_text)
                session = self._store.touch(client_id)
                session.last_payload = payload

                request_id = payload.get("requestId")
                await self._dispatch_message(websocket, session, payload, request_id)
        except WebSocketDisconnect:
            pass
        finally:
            if session is None:
                session = self._store.get_or_create(client_id)
            session.connected = False
            session.last_seen_at = time.time()

    async def _dispatch_message(
        self,
        websocket: WebSocket,
        session: SessionState,
        payload: dict[str, Any],
        request_id: str | None,
    ) -> None:
        message_type = payload.get("type")

        if message_type == "ping":
            await self._handle_ping(websocket, session, request_id)
            return

        if message_type == "echo":
            await self._handle_echo(websocket, session, payload, request_id)
            return

        if message_type == "invoke_tool":
            await self._handle_invoke_tool(websocket, session, payload, request_id)
            return

        if message_type == "list_conversations":
            await self._send_conversation_list(websocket, session, request_id)
            return

        if message_type == "load_conversation":
            await self._handle_load_conversation(websocket, session, payload, request_id)
            return

        if message_type == "create_conversation":
            await self._handle_create_conversation(websocket, session, payload, request_id)
            return

        if message_type == "send_message":
            await self._handle_send_message(websocket, session, payload, request_id)
            return

        if message_type == "delete_conversation":
            await self._handle_delete_conversation(websocket, session, payload, request_id)
            return

        if message_type == "clone_conversation":
            await self._handle_clone_conversation(websocket, session, payload, request_id)
            return

        if message_type == "edit_message":
            await self._handle_edit_message(websocket, session, payload, request_id)
            return

        if message_type == "add_participant":
            await self._handle_add_participant(websocket, session, payload, request_id)
            return

        if message_type == "update_participant_persona":
            await self._handle_update_participant_persona(websocket, session, payload, request_id)
            return

        if message_type == "set_active_assistant":
            await self._handle_set_active_assistant(websocket, session, payload, request_id)
            return

        await websocket.send_json(
            {
                "type": "error",
                "message": f"Unsupported message type: {message_type}",
                "requestId": request_id,
            }
        )

    async def _handle_ping(self, websocket: WebSocket, session: SessionState, request_id: str | None) -> None:
        await websocket.send_json(
            {
                "type": "pong",
                "serverTime": time.time(),
                "session": session.snapshot(),
                "requestId": request_id,
            }
        )

    async def _handle_echo(
        self,
        websocket: WebSocket,
        session: SessionState,
        payload: dict[str, Any],
        request_id: str | None,
    ) -> None:
        session.message_count += 1
        await websocket.send_json(
            {
                "type": "echo",
                "serverTime": time.time(),
                "message": payload.get("message", ""),
                "session": session.snapshot(),
                "requestId": request_id,
            }
        )

    async def _handle_invoke_tool(
        self,
        websocket: WebSocket,
        session: SessionState,
        payload: dict[str, Any],
        request_id: str | None,
    ) -> None:
        tool_id = str(payload.get("toolId", "")).strip()
        tool_input = payload.get("input")

        if not tool_id:
            await websocket.send_json(
                {
                    "type": "tool_error",
                    "requestId": request_id,
                    "message": "Missing toolId",
                    "session": session.snapshot(),
                }
            )
            return

        tool = self._tool_registry.find(tool_id)
        if tool is None:
            await websocket.send_json(
                {
                    "type": "tool_error",
                    "requestId": request_id,
                    "toolId": tool_id,
                    "message": f"Unknown tool: {tool_id}",
                    "session": session.snapshot(),
                }
            )
            return

        if not isinstance(tool_input, dict):
            await websocket.send_json(
                {
                    "type": "tool_error",
                    "requestId": request_id,
                    "toolId": tool_id,
                    "message": "Tool input must be an object",
                    "session": session.snapshot(),
                }
            )
            return

        await websocket.send_json(
            {
                "type": "tool_started",
                "requestId": request_id,
                "toolId": tool_id,
                "session": session.snapshot(),
            }
        )

        try:
            result = self._tool_registry.run(tool_id, tool_input)
        except ValueError as error:
            await websocket.send_json(
                {
                    "type": "tool_error",
                    "requestId": request_id,
                    "toolId": tool_id,
                    "message": str(error),
                    "session": session.snapshot(),
                }
            )
            return

        await websocket.send_json(
            {
                "type": "tool_result",
                "requestId": request_id,
                "toolId": tool_id,
                "result": result,
                "session": session.snapshot(),
            }
        )

    async def _send_conversation_list(
        self,
        websocket: WebSocket,
        session: SessionState,
        request_id: str | None,
    ) -> None:
        conversations = self._conversation_storage.list_conversations()
        await websocket.send_json(
            {
                "type": "conversation_list",
                "requestId": request_id,
                "conversations": conversations,
                "session": session.snapshot(),
            }
        )

    async def _handle_load_conversation(
        self,
        websocket: WebSocket,
        session: SessionState,
        payload: dict[str, Any],
        request_id: str | None,
    ) -> None:
        conversation_id = str(payload.get("conversationId", "")).strip()
        if not conversation_id:
            await websocket.send_json(
                {
                    "type": "error",
                    "message": "Missing conversationId",
                    "requestId": request_id,
                }
            )
            return

        conversation = self._conversation_storage.load_conversation(conversation_id)
        if conversation is None:
            await websocket.send_json(
                {
                    "type": "error",
                    "message": f"Conversation not found: {conversation_id}",
                    "requestId": request_id,
                }
            )
            return

        await websocket.send_json(
            {
                "type": "conversation_loaded",
                "requestId": request_id,
                "conversation": conversation,
                "session": session.snapshot(),
            }
        )

    async def _handle_create_conversation(
        self,
        websocket: WebSocket,
        session: SessionState,
        payload: dict[str, Any],
        request_id: str | None,
    ) -> None:
        name = str(payload.get("name", "")).strip() or "New Conversation"
        participants_payload = payload.get("participants")
        metadata_payload = payload.get("metadata")

        if not isinstance(participants_payload, list):
            participants_payload = [
                {"id": "user", "displayName": "User", "role": "user", "metadata": {}},
                {"id": "assistant", "displayName": "Assistant", "role": "assistant", "metadata": {}},
            ]

        participants = [item for item in participants_payload if isinstance(item, dict)]
        metadata = metadata_payload if isinstance(metadata_payload, dict) else {}

        index_entry = self._conversation_storage.create_conversation(
            name=name,
            participants=participants,
            metadata=metadata,
        )
        conversation_id = str(index_entry.get("id", ""))
        conversation = self._conversation_storage.load_conversation(conversation_id)

        await websocket.send_json(
            {
                "type": "conversation_created",
                "requestId": request_id,
                "conversation": index_entry,
                "session": session.snapshot(),
            }
        )

        if conversation is not None:
            await websocket.send_json(
                {
                    "type": "conversation_loaded",
                    "requestId": request_id,
                    "conversation": conversation,
                    "session": session.snapshot(),
                }
            )

    async def _handle_send_message(
        self,
        websocket: WebSocket,
        session: SessionState,
        payload: dict[str, Any],
        request_id: str | None,
    ) -> None:
        conversation_id = str(payload.get("conversationId", "")).strip()
        sender = str(payload.get("sender", "")).strip() or "user"
        content = str(payload.get("content", "")).strip()
        metadata_payload = payload.get("metadata")

        if not conversation_id:
            await websocket.send_json(
                {
                    "type": "error",
                    "message": "Missing conversationId",
                    "requestId": request_id,
                }
            )
            return

        if not content:
            await websocket.send_json(
                {
                    "type": "error",
                    "message": "Missing message content",
                    "requestId": request_id,
                }
            )
            return

        metadata = metadata_payload if isinstance(metadata_payload, dict) else {}
        appended = self._conversation_storage.append_message(
            conversation_id=conversation_id,
            sender=sender,
            content=content,
            metadata=metadata,
        )
        if appended is None:
            await websocket.send_json(
                {
                    "type": "error",
                    "message": f"Conversation not found: {conversation_id}",
                    "requestId": request_id,
                }
            )
            return

        session.message_count += 1
        await websocket.send_json(
            {
                "type": "message_appended",
                "requestId": request_id,
                "conversationId": conversation_id,
                "message": appended,
                "session": session.snapshot(),
            }
        )

        assistant_sender, assistant_metadata = self._assistant_response_context(conversation_id)

        assistant_message = self._conversation_storage.append_message(
            conversation_id=conversation_id,
            sender=assistant_sender,
            content=f"Echo: {content}",
            metadata=assistant_metadata,
        )
        if assistant_message is None:
            return

        session.message_count += 1
        await websocket.send_json(
            {
                "type": "message_appended",
                "requestId": request_id,
                "conversationId": conversation_id,
                "message": assistant_message,
                "session": session.snapshot(),
            }
        )

    async def _handle_add_participant(
        self,
        websocket: WebSocket,
        session: SessionState,
        payload: dict[str, Any],
        request_id: str | None,
    ) -> None:
        conversation_id = str(payload.get("conversationId", "")).strip()
        participant_payload = payload.get("participant")

        if not conversation_id:
            await websocket.send_json(
                {"type": "error", "message": "Missing conversationId", "requestId": request_id}
            )
            return

        if not isinstance(participant_payload, dict):
            await websocket.send_json(
                {"type": "error", "message": "Missing participant payload", "requestId": request_id}
            )
            return

        participant_id = str(participant_payload.get("id", "")).strip()
        if not participant_id:
            await websocket.send_json(
                {"type": "error", "message": "Participant must include id", "requestId": request_id}
            )
            return

        updated = self._conversation_storage.add_participant(conversation_id, participant_payload)
        if updated is None:
            await websocket.send_json(
                {"type": "error", "message": "Unable to add participant", "requestId": request_id}
            )
            return

        await websocket.send_json(
            {
                "type": "conversation_loaded",
                "requestId": request_id,
                "conversation": updated,
                "session": session.snapshot(),
            }
        )

    async def _handle_update_participant_persona(
        self,
        websocket: WebSocket,
        session: SessionState,
        payload: dict[str, Any],
        request_id: str | None,
    ) -> None:
        conversation_id = str(payload.get("conversationId", "")).strip()
        participant_id = str(payload.get("participantId", "")).strip()
        persona_id = str(payload.get("personaId", "")).strip()
        persona_name = str(payload.get("personaName", "")).strip()

        if not conversation_id or not participant_id or not persona_id or not persona_name:
            await websocket.send_json(
                {"type": "error", "message": "Missing participant persona payload", "requestId": request_id}
            )
            return

        updated = self._conversation_storage.update_participant_persona(
            conversation_id=conversation_id,
            participant_id=participant_id,
            persona_id=persona_id,
            persona_name=persona_name,
        )
        if updated is None:
            await websocket.send_json(
                {"type": "error", "message": "Unable to update participant persona", "requestId": request_id}
            )
            return

        await websocket.send_json(
            {
                "type": "conversation_loaded",
                "requestId": request_id,
                "conversation": updated,
                "session": session.snapshot(),
            }
        )

    async def _handle_set_active_assistant(
        self,
        websocket: WebSocket,
        session: SessionState,
        payload: dict[str, Any],
        request_id: str | None,
    ) -> None:
        conversation_id = str(payload.get("conversationId", "")).strip()
        participant_id = str(payload.get("participantId", "")).strip()

        if not conversation_id or not participant_id:
            await websocket.send_json(
                {"type": "error", "message": "Missing active assistant payload", "requestId": request_id}
            )
            return

        updated = self._conversation_storage.set_active_assistant(conversation_id, participant_id)
        if updated is None:
            await websocket.send_json(
                {"type": "error", "message": "Unable to set active assistant", "requestId": request_id}
            )
            return

        await websocket.send_json(
            {
                "type": "conversation_loaded",
                "requestId": request_id,
                "conversation": updated,
                "session": session.snapshot(),
            }
        )

    async def _handle_delete_conversation(
        self,
        websocket: WebSocket,
        session: SessionState,
        payload: dict[str, Any],
        request_id: str | None,
    ) -> None:
        conversation_id = str(payload.get("conversationId", "")).strip()
        if not conversation_id:
            await websocket.send_json(
                {
                    "type": "error",
                    "message": "Missing conversationId",
                    "requestId": request_id,
                }
            )
            return

        deleted = self._conversation_storage.delete_conversation(conversation_id)
        if not deleted:
            await websocket.send_json(
                {
                    "type": "error",
                    "message": f"Conversation not found: {conversation_id}",
                    "requestId": request_id,
                }
            )
            return

        await self._send_conversation_list(websocket, session, request_id)
        await websocket.send_json(
            {
                "type": "conversation_deleted",
                "requestId": request_id,
                "conversationId": conversation_id,
                "session": session.snapshot(),
            }
        )

    async def _handle_clone_conversation(
        self,
        websocket: WebSocket,
        session: SessionState,
        payload: dict[str, Any],
        request_id: str | None,
    ) -> None:
        conversation_id = str(payload.get("conversationId", "")).strip()
        clone_name = payload.get("name")
        if not conversation_id:
            await websocket.send_json(
                {
                    "type": "error",
                    "message": "Missing conversationId",
                    "requestId": request_id,
                }
            )
            return

        cloned = self._conversation_storage.clone_conversation(
            conversation_id=conversation_id,
            name=str(clone_name) if isinstance(clone_name, str) else None,
        )
        if cloned is None:
            await websocket.send_json(
                {
                    "type": "error",
                    "message": f"Conversation not found: {conversation_id}",
                    "requestId": request_id,
                }
            )
            return

        clone_id = str(cloned.get("id", ""))
        conversation = self._conversation_storage.load_conversation(clone_id)
        await websocket.send_json(
            {
                "type": "conversation_created",
                "requestId": request_id,
                "conversation": cloned,
                "session": session.snapshot(),
            }
        )

        if conversation is not None:
            await websocket.send_json(
                {
                    "type": "conversation_loaded",
                    "requestId": request_id,
                    "conversation": conversation,
                    "session": session.snapshot(),
                }
            )

    async def _handle_edit_message(
        self,
        websocket: WebSocket,
        session: SessionState,
        payload: dict[str, Any],
        request_id: str | None,
    ) -> None:
        conversation_id = str(payload.get("conversationId", "")).strip()
        message_id = str(payload.get("messageId", "")).strip()
        content = str(payload.get("content", "")).strip()

        if not conversation_id:
            await websocket.send_json(
                {
                    "type": "error",
                    "message": "Missing conversationId",
                    "requestId": request_id,
                }
            )
            return

        if not message_id:
            await websocket.send_json(
                {
                    "type": "error",
                    "message": "Missing messageId",
                    "requestId": request_id,
                }
            )
            return

        if not content:
            await websocket.send_json(
                {
                    "type": "error",
                    "message": "Missing message content",
                    "requestId": request_id,
                }
            )
            return

        updated_message = self._conversation_storage.update_message(
            conversation_id=conversation_id,
            message_id=message_id,
            content=content,
        )
        if updated_message is None:
            await websocket.send_json(
                {
                    "type": "error",
                    "message": f"Message not found in conversation: {conversation_id}",
                    "requestId": request_id,
                }
            )
            return

        await websocket.send_json(
            {
                "type": "message_updated",
                "requestId": request_id,
                "conversationId": conversation_id,
                "message": updated_message,
                "session": session.snapshot(),
            }
        )

    def _assistant_response_context(self, conversation_id: str) -> tuple[str, dict[str, Any]]:
        assistant = self._conversation_storage.get_active_assistant(conversation_id)
        if not isinstance(assistant, dict):
            return "assistant", {"generated": True, "mode": "placeholder", "role": "assistant"}

        assistant_id = str(assistant.get("id", "assistant")).strip() or "assistant"
        display_name = str(assistant.get("displayName", "Assistant")).strip() or "Assistant"
        metadata = assistant.get("metadata")
        persona_id = metadata.get("personaId") if isinstance(metadata, dict) else None
        message_metadata: dict[str, Any] = {
            "generated": True,
            "mode": "placeholder",
            "role": "assistant",
            "participantId": assistant_id,
            "displayName": display_name,
        }
        if isinstance(persona_id, str) and persona_id:
            message_metadata["personaId"] = persona_id

        return assistant_id, message_metadata
