# Vertex Backend API

This document describes the HTTP API currently implemented in [backend/src/index.ts](backend/src/index.ts).

## Base URL

Default local base URL:

- `http://127.0.0.1:8000`

Environment variables:

- `HOST` (default: `127.0.0.1`)
- `PORT` (default: `8000`)

All API routes are under the `/api` prefix.

## Common behavior

- API responses are JSON unless noted otherwise.
- CORS headers are set on every response:
  - `Access-Control-Allow-Origin: *`
  - `Access-Control-Allow-Credentials: true`
  - `Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS`
  - `Access-Control-Allow-Headers: Content-Type, Authorization`
- `OPTIONS` requests return `200`.

## Types

- `Uuid`: string UUID used for persona, workspace, conversation, and message IDs.

## Health

### GET `/api/health`

Response `200`:

```json
{
  "status": "ok"
}
```

## Personas

### GET `/api/personas`

Returns all personas.

Response `200`:

```json
[
  {
    "id": "uuid",
    "name": "Narrator",
    "prompt": "You are Narrator, a helpful assistant.",
    "created": 1735689600000,
    "updated": 1735689600000,
    "avatarUrl": "/api/personas/uuid/avatar"
  }
]
```

`avatarUrl` is `null` when no avatar exists.

### GET `/api/personas/:personaId`

Path params:

- `personaId` (`Uuid`)

Response `200`:

```json
{
  "id": "uuid",
  "name": "Narrator",
  "prompt": "You are Narrator, a helpful assistant.",
  "created": 1735689600000,
  "updated": 1735689600000,
  "avatarUrl": "/api/personas/uuid/avatar"
}
```

Error `404`:

```json
{
  "error": "Persona not found"
}
```

### POST `/api/personas/create`

Request body:

```json
{
  "name": "Narrator",
  "prompt": "You narrate cinematic detective stories."
}
```

Fields:

- `name` (string, required)
- `prompt` (string, optional; defaults to `You are <name>, a helpful assistant.`)

Response `200`:

```json
{
  "id": "uuid",
  "name": "Narrator",
  "prompt": "You narrate cinematic detective stories.",
  "created": 1735689600000,
  "updated": 1735689600000,
  "avatarUrl": null
}
```

Error `400`:

```json
{
  "error": "Missing name"
}
```

### PATCH `/api/personas/:personaId`

Path params:

- `personaId` (`Uuid`)

Request body (at least one field required):

```json
{
  "name": "Narrator v2",
  "prompt": "You narrate concise noir scenes."
}
```

Fields:

- `name` (string, optional)
- `prompt` (string, optional)

Response `200`:

```json
{
  "id": "uuid",
  "name": "Narrator v2",
  "prompt": "You narrate concise noir scenes.",
  "created": 1735689600000,
  "updated": 1735689700000,
  "avatarUrl": null
}
```

Errors:

- `400`

```json
{
  "error": "Missing name or prompt"
}
```

- `404`

```json
{
  "error": "Persona not found"
}
```

### PUT `/api/personas/:personaId/avatar`

Stores or replaces a persona avatar.

Path params:

- `personaId` (`Uuid`)

Request body:

```json
{
  "fileDataBase64": "iVBORw0KGgoAAAANSUhEUgAA..."
}
```

Fields:

- `fileDataBase64` (string, required; raw base64 or data URL payload)

Response `200`:

```json
{
  "message": "Avatar saved"
}
```

Errors:

- `400`

```json
{
  "error": "Missing fileDataBase64"
}
```

- `400`

```json
{
  "error": "Invalid base64 image data"
}
```

- `404`

```json
{
  "error": "Persona not found"
}
```

### GET `/api/personas/:personaId/avatar`

Returns the stored avatar image bytes.

Path params:

- `personaId` (`Uuid`)

Response `200`:

- Binary response body
- `Content-Type: image/png`
- `Cache-Control: public, max-age=86400`

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