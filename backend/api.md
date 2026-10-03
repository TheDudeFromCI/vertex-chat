# Vertex Backend API

This document describes the HTTP endpoints implemented by the Vertex backend in `backend/src`.

## Base URL

Default local base URL:

- `http://127.0.0.1:8000`

Configuration:

- `HOST` (default: `127.0.0.1`)
- `PORT` (default: `8000`)
- `DATABASE_PATH` (default: project-root `database.db`)
- `DIRECTORIES` (optional; semicolon-separated directories allowed for file tools, e.g. `/workspace;/tmp/projects`)

All routes below are mounted under the `/api` prefix unless otherwise noted.

## Common behavior

- JSON responses are used for API endpoints unless the route explicitly returns binary content.
- CORS is enabled for all responses:
  - `Access-Control-Allow-Origin: *`
  - `Access-Control-Allow-Credentials: true`
  - `Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS`
  - `Access-Control-Allow-Headers: Content-Type, Authorization`
- `OPTIONS` requests are answered with `200`.
- Errors are returned as JSON objects in the form:

```json
{
  "error": "Human readable message"
}
```

## Shared types

- `Uuid`: string UUID for persona, workspace, conversation, and message IDs.
- `ChatCompletionRequest`:

```json
{
  "prompt": "optional high-level prompt",
  "messages": [
    {
      "role": "user",
      "content": "Hello"
    }
  ]
}
```

- `MessageContent`: array of content blocks with types such as `text`, `thinking`, `tool_call`, `tool_response`, `image`, and `file_attachment`.
- `StreamedLLMEvent`: a streamed content fragment, tool permission request, `begin_llm_generation`, `rename_conversation`, or a subagent event (`new_workspace`, `new_conversation`, `subagent_generation_triggered`). The client runs the generation for the target agent when it receives `subagent_generation_triggered`.

## Health

### GET `/api/health`

Returns the backend health status.

Response `200`:

```json
{
  "status": "ok"
}
```

## LLM endpoints

### POST `/api/llm/chat`

Generates a message by streaming a chat completion from the configured OpenAI-compatible provider.

Request body:

```json
{
  "prompt": "Write a short noir scene",
  "messages": [
    {
      "role": "user",
      "content": "Create a brief intro scene."
    }
  ]
}
```

The endpoint returns newline-delimited JSON (NDJSON) to the client. The response stream contains:

- regular streamed message fragment objects such as:

```json
{
  "type": "text",
  "delta": "A dark alley"
}
```

- or tool permission requests such as:

```json
{
  "type": "tool_permission_request",
  "requestId": "uuid",
  "toolName": "read_file",
  "args": {
    "path": "/tmp/example.txt"
  }
}
```

- and finally the completed `MessageContent` array as the last payload.

If the request fails, the server returns `500` with an error JSON payload.

### POST `/api/llm/tool-permission`

Accepts the result of a tool permission prompt from the UI.

Request body:

```json
{
  "requestId": "uuid",
  "allowed": true
}
```

Response `200`:

```json
{
  "message": "Permission decision accepted"
}
```

Errors:

- `400` if either field is missing
- `404` if the permission request no longer exists or has already been resolved

## Persona endpoints

### GET `/api/personas`

Returns all personas.

Response `200`:

```json
[
  {
    "id": "uuid",
    "name": "Narrator",
    "prompt": "You are a cinematic narrator.",
    "created": 1735689600000,
    "updated": 1735689600000,
    "avatarUrl": "/api/personas/uuid/avatar"
  }
]
```

### GET `/api/personas/:personaId`

Response `200`:

```json
{
  "id": "uuid",
  "name": "Narrator",
  "prompt": "You are a cinematic narrator.",
  "created": 1735689600000,
  "updated": 1735689600000,
  "avatarUrl": "/api/personas/uuid/avatar"
}
```

Errors:

- `404` => `{ "error": "Persona not found" }`

### POST `/api/personas/create`

Request body:

```json
{
  "name": "Narrator",
  "prompt": "You narrate noir scenes with a dry tone."
}
```

Required fields:

- `name` (string)
- `prompt` (string, optional)

Response `200`:

```json
{
  "id": "uuid",
  "name": "Narrator",
  "prompt": "You narrate noir scenes with a dry tone.",
  "created": 1735689600000,
  "updated": 1735689600000,
  "avatarUrl": null
}
```

Errors:

- `400` => `{ "error": "Missing name" }`

### PATCH `/api/personas/:personaId`

Updates a persona's name or prompt.

Request body:

```json
{
  "name": "Narrator v2",
  "prompt": "You narrate concise detective scenes."
}
```

At least one of `name` or `prompt` must be present.

Response `200`:

```json
{
  "id": "uuid",
  "name": "Narrator v2",
  "prompt": "You narrate concise detective scenes.",
  "created": 1735689600000,
  "updated": 1735689700000,
  "avatarUrl": null
}
```

Errors:

- `400` => `{ "error": "Missing name or prompt" }`
- `404` => `{ "error": "Persona not found" }`

### PUT `/api/personas/:personaId/avatar`

Stores a new avatar image for a persona.

Request body:

```json
{
  "fileDataBase64": "data:image/png;base64,..."
}
```

Response `200`:

```json
{
  "message": "Avatar saved"
}
```

Errors:

- `400` => `{ "error": "Missing fileDataBase64" }`
- `400` => `{ "error": "Invalid base64 image data" }`
- `404` => `{ "error": "Persona not found" }`

### GET `/api/personas/:personaId/avatar`

Returns the stored avatar bytes as a binary image response.

Response `200`:

- binary image body
- `Content-Type` matches the stored image mime type
- `Cache-Control: public, max-age=86400`

### DELETE `/api/personas/:personaId/avatar`

Removes the persona avatar.

Response `200`:

```json
{
  "message": "Avatar deleted"
}
```

### DELETE `/api/personas/:personaId`

Deletes a persona.

Response `200`:

```json
{
  "message": "Persona deleted"
}
```

Errors:

- `404` => `{ "error": "Persona not found" }`

## Workspace endpoints

### GET `/api/workspaces`

Lists all workspaces.

### GET `/api/workspaces/:workspaceId`

Returns a single workspace.

### POST `/api/workspaces/create`

Request body:

```json
{
  "name": "Story Lab",
  "metadata": {
    "project": "demo"
  }
}
```

Required fields:

- `name` (string)

Response `200`: created workspace object.

Errors:

- `400` => `{ "error": "Missing name" }`

### PATCH `/api/workspaces/:workspaceId`

Renames a workspace.

Request body:

```json
{
  "name": "Story Lab v2"
}
```

Response `200`:

```json
{
  "message": "Workspace updated"
}
```

Errors:

- `400` => `{ "error": "Missing name" }`
- `404` => `{ "error": "Workspace not found" }`

### DELETE `/api/workspaces/:workspaceId`

Deletes a workspace.

Response `200`:

```json
{
  "message": "Workspace deleted"
}
```

## Conversation endpoints

### GET `/api/conversations/:conversationId`

Returns one conversation object.

### POST `/api/conversations/create`

Creates a conversation inside a workspace.

Request body:

```json
{
  "name": "Morning briefing",
  "workspaceId": "uuid"
}
```

Required fields:

- `name` (string)
- `workspaceId` (UUID)

Response `200`: created conversation object.

Errors:

- `400` => `{ "error": "Missing name or workspaceId" }`
- `404` => `{ "error": "Workspace not found" }`

### PATCH `/api/conversations/:conversationId`

Updates conversation metadata, participants, or name.

Request body examples:

```json
{
  "name": "Night briefing"
}
```

or

```json
{
  "participants": ["uuid-a", "uuid-b"]
}
```

or

```json
{
  "metadata": {
    "agentResponseMode": "automatic"
  }
}
```

Response `200`:

```json
{
  "message": "Conversation updated"
}
```

Errors:

- `400` => `{ "error": "Missing name, participants, and/or metadata" }`
- `404` => `{ "error": "Conversation not found" }`

### DELETE `/api/conversations/:conversationId`

Deletes a conversation.

Response `200`:

```json
{
  "message": "Conversation deleted"
}
```

## Message endpoints

### GET `/api/messages/:messageId`

Returns one message.

### POST `/api/messages/create`

Creates a message in a conversation.

Request body:

```json
{
  "conversationId": "uuid",
  "sender": "uuid",
  "content": [
    {
      "type": "text",
      "content": "Hello there"
    }
  ],
  "metadata": {
    "source": "user"
  }
}
```

Required fields:

- `conversationId` (UUID)
- `sender` (UUID)

Response `200`: created message object.

Errors:

- `400` => `{ "error": "Missing conversationId" }`
- `400` => `{ "error": "Missing sender" }`
- `404` => `{ "error": "Conversation not found" }`

### PUT `/api/messages/:messageId`

Updates message content or metadata.

Request body:

```json
{
  "content": [
    {
      "type": "text",
      "content": "Updated content"
    }
  ]
}
```

Response `200`:

```json
{
  "message": "Message updated"
}
```

Errors:

- `400` => `{ "error": "Missing content and/or metadata" }`
- `404` => `{ "error": "Message not found or failed to update" }`

### DELETE `/api/messages/:messageId`

Deletes a message.

Response `200`:

```json
{
  "message": "Message deleted"
}
```

## Notes

- The backend uses SQLite for persistence.
- Tool permissions are enforced at the LLM layer; writes are not allowed outside the configured `DIRECTORIES` list.
- The frontend communicates with the backend over the same origin (it uses `/api/...` fetch requests), while the backend also serves the built static frontend assets.

Error `404`:

```json
{
  "error": "Avatar not found"
}
```

### DELETE `/api/personas/:personaId/avatar`

Path params:

- `personaId` (`Uuid`)

Response `200`:

```json
{
  "message": "Avatar deleted"
}
```

Error `404`:

```json
{
  "error": "Avatar not found"
}
```

### DELETE `/api/personas/:personaId`

Path params:

- `personaId` (`Uuid`)

Response `200`:

```json
{
  "message": "Persona deleted"
}
```

Error `404`:

```json
{
  "error": "Persona not found"
}
```

## Workspaces

### GET `/api/workspaces`

Returns all workspaces.

Response `200`:

```json
[
  {
    "id": "uuid",
    "name": "Workspace Name",
    "conversationEntries": [
      {
        "conversationId": "uuid",
        "workspaceId": "uuid",
        "name": "Conversation Name",
        "createdAt": 1735689600000,
        "updatedAt": 1735689700000
      }
    ],
    "metadata": {}
  }
]
```

### GET `/api/workspaces/:workspaceId`

Path params:

- `workspaceId` (`Uuid`)

Response `200`:

```json
{
  "id": "uuid",
  "name": "Workspace Name",
  "conversationEntries": [
    {
      "conversationId": "uuid",
      "workspaceId": "uuid",
      "name": "Conversation Name",
      "createdAt": 1735689600000,
      "updatedAt": 1735689700000
    }
  ],
  "metadata": {}
}
```

Error `404`:

```json
{
  "error": "Workspace not found"
}
```

### POST `/api/workspaces/create`

Request body:

```json
{
  "name": "Workspace Name",
  "metadata": {}
}
```

Fields:

- `name` (string, required)
- `metadata` (object, optional; defaults to `{}`)

Response `200`:

```json
{
  "id": "uuid",
  "name": "Workspace Name",
  "conversationEntries": [],
  "metadata": {}
}
```

Error `400`:

```json
{
  "error": "Missing name"
}
```

### PATCH `/api/workspaces/:workspaceId`

Renames a workspace.

Path params:

- `workspaceId` (`Uuid`)

Request body:

```json
{
  "name": "New Workspace Name"
}
```

Response `200`:

```json
{
  "message": "Workspace updated"
}
```

Errors:

- `400`

```json
{
  "error": "Missing name"
}
```

- `404`

```json
{
  "error": "Workspace not found"
}
```

- `500`

```json
{
  "error": "Failed to update workspace"
}
```

### DELETE `/api/workspaces/:workspaceId`

Path params:

- `workspaceId` (`Uuid`)

Response `200`:

```json
{
  "message": "Workspace deleted"
}
```

Error `404`:

```json
{
  "error": "Workspace not found"
}
```

## Conversations

### GET `/api/conversations/:conversationId`

Path params:

- `conversationId` (`Uuid`)

Response `200`:

```json
{
  "id": "uuid",
  "name": "Conversation Name",
  "participants": [],
  "messages": [],
  "createdAt": 1735689600000,
  "updatedAt": 1735689700000,
  "metadata": {}
}
```

Error `404`:

```json
{
  "error": "Conversation not found"
}
```

### POST `/api/conversations/create`

Request body:

```json
{
  "name": "Conversation Name",
  "workspaceId": "uuid"
}
```

Fields:

- `name` (string, required)
- `workspaceId` (`Uuid`, required)

Response `200`:

```json
{
  "id": "uuid",
  "name": "Conversation Name",
  "participants": [],
  "messages": [],
  "createdAt": 1735689600000,
  "updatedAt": 1735689600000,
  "metadata": {}
}
```

Errors:

- `400`

```json
{
  "error": "Missing name or workspaceId"
}
```

- `404`

```json
{
  "error": "Workspace not found"
}
```

### PATCH `/api/conversations/:conversationId`

Renames a conversation.

Path params:

- `conversationId` (`Uuid`)

Request body:

```json
{
  "name": "New Conversation Name"
}
```

Response `200`:

```json
{
  "message": "Conversation renamed"
}
```

Errors:

- `400`

```json
{
  "error": "Missing name"
}
```

- `404`

```json
{
  "error": "Conversation not found"
}
```

- `500`

```json
{
  "error": "Failed to rename conversation"
}
```

### DELETE `/api/conversations/:conversationId`

Path params:

- `conversationId` (`Uuid`)

Response `200`:

```json
{
  "message": "Conversation deleted"
}
```

Error `404`:

```json
{
  "error": "Conversation not found"
}
```

## Messages

### GET `/api/messages/:messageId`

Path params:

- `messageId` (`Uuid`)

Response `200`:

```json
{
  "id": "uuid",
  "conversationId": "uuid",
  "sender": "uuid",
  "timestamp": 1735689600000,
  "content": "Message text",
  "edited": false,
  "metadata": {}
}
```

Error `404`:

```json
{
  "error": "Message not found"
}
```

### POST `/api/messages/create`

Request body:

```json
{
  "conversationId": "uuid",
  "sender": "uuid",
  "content": "Message text",
  "metadata": {}
}
```

Fields:

- `conversationId` (`Uuid`, required)
- `sender` (`Uuid`, required)
- `content` (string or null, optional; defaults to `null`)
- `metadata` (object, optional; defaults to `{}`)

Response `200`:

```json
{
  "id": "uuid",
  "conversationId": "uuid",
  "sender": "uuid",
  "timestamp": 1735689600000,
  "content": "Message text",
  "edited": false,
  "metadata": {}
}
```

Errors:

- `400`

```json
{
  "error": "Missing conversationId"
}
```

- `400`

```json
{
  "error": "Missing sender"
}
```

- `404`

```json
{
  "error": "Conversation not found"
}
```

### DELETE `/api/messages/:messageId`

Path params:

- `messageId` (`Uuid`)

Response `200`:

```json
{
  "message": "Message deleted"
}
```

Error `404`:

```json
{
  "error": "Message not found"
}
```

## Fallback routes

### Any method `/api/*`

Response `404`:

```json
{
  "error": "Not found"
}
```

### Any method `*` (non-API routes)

- Static files are served from `frontend/dist`.
- Unmatched non-API routes return `frontend/dist/404.html` with status `404`.