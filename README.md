# Vertex

> **Your personal assistant should have a name.**

Vertex is a lightweight AI chat/story completion application built around personalities.

Give your AI a persona, or several, and start a new conversation. Or add several to a chatroom and let them talk to each other. Or abandon the chatroom completely and start writing a story via text completions.

## Current Features

- [ ] Any OpenAI-Compatible API
- [X] Persistent Conversations
- [ ] Custom Personalities
- [ ] Tool Execution
- [ ] File Uploading
- [ ] Markdown Rendering
- [ ] Syntax Highlighting

## Bring Your Own Model

Run it entirely on your machine, or use a frontier model. It's up to you. As long as your LLM service provides an OpenAI-compatible API, it's supported.

## Installation

Vertex requires both `Python` and `npm` for installation.

This project was designed using `Python 3.14`. While it may work with other versions, they are untested.

---

Vertex currently includes helper scripts for Linux.

```bash
# Clone the repository
git clone https://github.com/TheDudeFromCI/vertex-chat.git
cd vertex-chat

# Install local dependencies
# Make sure you run this from inside the project directory!
./install.sh

# Start the backend server
# Make sure you run this from inside the project directory!
./run.sh
```

Open the local address shown in your terminal, and you're ready to go!

## Development

To run the project in development mode, run the `dev.sh` script. This will compile and run the backend server, while the frontend will listen for file changes and auto-recompile to allow for realtime editing of the web app.

Dynamic recompilation is not supported for the backend, so you'll have to manually rerun the command when the backend is modified. It's recommended to rely more on unit tests for backend development.

## API Reference

- Backend API documentation: [backend/api.md](backend/api.md)

## Contributing

Issues, suggestions, and pull requests are always welcome. Development happens whenever time allows, so new features tend to arrive in bursts.

## License

This project is licensed under the **MIT License**. See the `LICENSE` file for details.
