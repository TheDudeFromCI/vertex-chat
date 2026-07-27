# Vertex

Vertex is a small full-stack web app scaffold with a FastAPI backend and a vanilla TypeScript frontend.

## Structure

- `backend/` FastAPI app with a websocket endpoint and reconnect-friendly session handshake
- `frontend/` Vanilla TypeScript app built with Vite

### Backend modules

- `app/main.py` wires routes and service instances.
- `app/models/session_state.py` contains the `SessionState` model.
- `app/services/session_store.py` contains `SessionStore`.
- `app/services/tool_registry.py` contains `ToolRegistry` and placeholder tool execution.
- `app/services/websocket_service.py` contains `WebSocketService` message routing and lifecycle handling.
- `app/services/conversation_storage.py` contains `ConversationStorage` for flat-file JSON conversation persistence.

### Conversation storage

- Storage directory: `backend/data/conversations/`
- Metadata index file: `backend/data/conversations/index.json`
- One conversation per file: `backend/data/conversations/<conversation-id>.json`

`index.json` tracks conversation ids, names, and file paths so the backend can retrieve conversations without scanning the directory.

Conversation file shape is flexible and includes:
- `id`
- `name`
- `participants` (array)
- `messages` (array)
- `metadata` (object)

Each message includes:
- `sender`
- `timestamp`
- `content`
- `metadata` (object)

The backend does not keep conversations/messages in long-lived in-memory caches. It reads from disk per request, sends data over websocket, and writes updates back to disk.

### Frontend modules

- `src/main.ts` bootstraps the app.
- `src/app/chat_app.ts` coordinates state, websocket events, and UI rendering.
- `src/core/chat_store.ts` handles conversations, messages, request mapping, and local event log persistence.
- `src/core/connection_manager.ts` owns websocket connect/reconnect, queueing, and heartbeat.
- `src/ui/chat_view.ts` renders the chat skeleton and binds UI actions.
- `src/types/` contains domain and websocket protocol type definitions.

## Development

Backend:

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Frontend:

```bash
cd frontend
npm install
npm run dev -- --host
```

Open the frontend dev server, and it will proxy websocket traffic to the backend.

## Reconnect model

The frontend stores a stable client ID in `localStorage`, reconnects with exponential backoff, and replays queued messages after a reload. The backend accepts the client ID during the websocket hello message and replies with a session snapshot so the client can resync.

## Protocol notes

- Websocket responses now include an optional `requestId` that mirrors the request correlation ID sent by the client.
- Existing message types (`hello`, `ping`, `echo`) remain supported.
- Added `invoke_tool` websocket message support with `tool_started`, `tool_result`, and `tool_error` lifecycle responses.
- Added conversation persistence websocket messages:
	- `conversation_list`
	- `conversation_loaded`
	- `conversation_created`
	- `message_appended`

## Tool capability endpoint

- `GET /api/tools` returns the current tool capability registry and protocol version.
- This initial implementation exposes writing-focused placeholder tools for upcoming story-editor and agent workflows.

## Frontend skeleton

- The frontend now includes a chat-first skeleton: conversation sidebar, main chat thread, composer input, tools rail, and event log.
- Messages are request-correlated so responses can map back to the originating conversation.
