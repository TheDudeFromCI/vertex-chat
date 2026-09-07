# Vertex

> **Your personal assistant should have a name.**

Vertex is a local-first AI chat and story app built around reusable personas, persistent conversations, multi-agent interactions, and tool-enabled LLM interactions.

It keeps conversation state in a local SQLite database, exposes a REST API for the frontend, and can talk to any OpenAI-compatible model endpoint. Personas can be created, edited, and given avatars; conversations can be grouped into workspaces; and the model can request permission before running tools like reading files or checking the current time.

## Current Features

- OpenAI-compatible LLM backends via REST API
- Persistent SQLite-backed workspaces, conversations, and messages
- Persona management with optional avatar images
- Multi-participant chat conversations and agent automation modes
- Tool execution with user approval for file-system and time access
- Markdown rendering in the frontend
- Local static frontend served by the backend

## Project layout

- `backend/` — Express API server and LLM integration
- `common/` — shared TypeScript types used by the server and frontend
- `frontend/` — Vite-based UI that talks to the backend
- `install.sh` — installs dependencies and builds every package
- `run.sh` — loads `.env` and starts the production backend/server build
- `dev.sh` — runs the frontend watch build and backend dev server together

## Requirements

- Node.js 20+ recommended
- npm
- A model provider with an OpenAI-compatible API

## LLM requirements

Vertex expects a provider that supports the OpenAI-compatible API contract used by the backend:

- `GET /models`
- `POST /chat/completions`
- `POST /chat/completions/input_tokens` (for token counting)

The backend config is driven by environment variables such as:

```bash
OPENAI_API_KEY="your-key"
OPENAI_BASE_URL="https://api.openai.com/v1"
OPENAI_DEFAULT_MODEL="gpt-4o-mini"
OPENAI_TIMEOUT=300000

OPENAI_MAX_TOKENS=256000
OPENAI_MAX_OUTPUT_TOKENS=128000

HOST="127.0.0.1"
PORT=8000
DATABASE_PATH="/absolute/path/to/database.db"
DIRECTORIES="/workspace;/tmp/projects"
```

This means you can point Vertex at OpenAI, OpenRouter, LiteLLM, or any compatible local proxy that exposes the same REST endpoints.

## Installation

```bash
# Clone the repository
git clone https://github.com/TheDudeFromCI/vertex-chat.git
cd vertex-chat

# Copy the default .env example file
cp .env.example .env 2>/dev/null || true

# Optionally configure the environment file to fit your needs
# nano .env

# Install npm depdencies
./install.sh
```

If there is no `.env.example`, create a `.env` file in the project root with the variables above. The backend loads `.env` automatically when you start the app via `run.sh` or `dev.sh`.

Then start the app:

```bash
./run.sh
```

The backend serves the built frontend from `frontend/dist` and listens on the configured `HOST`/`PORT` (default `http://127.0.0.1:8000`).

## Development

For a live dev workflow, run:

```bash
./dev.sh
```

That script starts:

- `frontend` in watch mode with Vite
- the backend in development mode with `tsx watch`

For a quick type-check pass:

```bash
cd backend && npm run type-check
cd frontend && npm run build
```

## Usage

1. Start Vertex with `./run.sh` or `./dev.sh`.
2. Open the app in your browser at the printed local URL.
3. Create or import personas from the context panel.
4. Create a workspace and conversation.
5. Pick one or more personas as conversation participants.
6. Send messages; the app generates responses through the configured LLM.
7. If a tool call is requested, the UI asks for explicit approval before the backend executes the tool.

The file tools are restricted by `DIRECTORIES`. Only paths inside those directories are allowed to be read or modified.

## API Reference

See [backend/api.md](backend/api.md) for the current REST API documentation.

## Contributing

Issues, suggestions, and pull requests are welcome. Development has been incremental and is driven by the needs of the current project rather than a strict roadmap.

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
