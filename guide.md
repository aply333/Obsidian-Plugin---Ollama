# How To Build This Project

This guide explains how this exact repository is being built, what each part does, and where the code lives.

## Project shape

This repo is split into two top-level parts:

- `runtime/`: a local Python API that talks to Ollama.
- `plugin/`: an Obsidian plugin UI that talks to the Python runtime.

The flow is:

1. Obsidian loads the plugin.
2. The plugin sends HTTP requests to the local runtime.
3. The runtime sends generation requests to Ollama.
4. Ollama returns the model output.
5. The runtime returns that response back to the plugin UI.

## Current file map

### Root

- [goal & rules.md](/Users/aply/Local%20Dev%20Projects/Obsidian%20Plugin%20-%20Ollama/goal%20%26%20rules.md): active project TODOs and project rules.
- [guide.md](/Users/aply/Local%20Dev%20Projects/Obsidian%20Plugin%20-%20Ollama/guide.md): this learning guide.
- [.gitignore](/Users/aply/Local%20Dev%20Projects/Obsidian%20Plugin%20-%20Ollama/.gitignore): ignores the Python virtual environment.

### Runtime

- [runtime/requirements.txt](/Users/aply/Local%20Dev%20Projects/Obsidian%20Plugin%20-%20Ollama/runtime/requirements.txt): Python dependency list.
- [runtime/src/app.py](/Users/aply/Local%20Dev%20Projects/Obsidian%20Plugin%20-%20Ollama/runtime/src/app.py): FastAPI app with `/health`, `/generate`, `/generate-stream`, `/quick-entry`, `/note-action-plan`, `/kanban-action-plan`, and `/agent-action-plan`.
- [runtime/src/manager.py](/Users/aply/Local%20Dev%20Projects/Obsidian%20Plugin%20-%20Ollama/runtime/src/manager.py): safe runtime process manager with PID, state, health, and log handling.
- [runtime/src/runtime_control.py](/Users/aply/Local%20Dev%20Projects/Obsidian%20Plugin%20-%20Ollama/runtime/src/runtime_control.py): CLI entrypoint for starting, stopping, restarting, and checking status.
- [runtime/src/menubar.py](/Users/aply/Local%20Dev%20Projects/Obsidian%20Plugin%20-%20Ollama/runtime/src/menubar.py): macOS menu bar app for runtime control.
- [runtime/README.md](/Users/aply/Local%20Dev%20Projects/Obsidian%20Plugin%20-%20Ollama/runtime/README.md): runtime setup notes.

### Plugin

- [plugin/manifest.json](/Users/aply/Local%20Dev%20Projects/Obsidian%20Plugin%20-%20Ollama/plugin/manifest.json): Obsidian plugin manifest.
- [plugin/package.json](/Users/aply/Local%20Dev%20Projects/Obsidian%20Plugin%20-%20Ollama/plugin/package.json): frontend dependencies and build scripts.
- [plugin/tsconfig.json](/Users/aply/Local%20Dev%20Projects/Obsidian%20Plugin%20-%20Ollama/plugin/tsconfig.json): TypeScript settings.
- [plugin/src/main.ts](/Users/aply/Local%20Dev%20Projects/Obsidian%20Plugin%20-%20Ollama/plugin/src/main.ts): plugin entrypoint and view registration.
- [plugin/src/chat.ts](/Users/aply/Local%20Dev%20Projects/Obsidian%20Plugin%20-%20Ollama/plugin/src/chat.ts): chat session models and chat prompt/handoff helpers.
- [plugin/src/kanban.ts](/Users/aply/Local%20Dev%20Projects/Obsidian%20Plugin%20-%20Ollama/plugin/src/kanban.ts): Kanban board detection, structured context parsing, and safe card-level board updates.
- [plugin/src/graph.ts](/Users/aply/Local%20Dev%20Projects/Obsidian%20Plugin%20-%20Ollama/plugin/src/graph.ts): graph-aware note summaries for links, backlinks, tags, and simple graph roles.
- [plugin/src/retrieval.ts](/Users/aply/Local%20Dev%20Projects/Obsidian%20Plugin%20-%20Ollama/plugin/src/retrieval.ts): lightweight vault indexing, vault summaries, and automatic note retrieval scoring.
- [plugin/src/settings.ts](/Users/aply/Local%20Dev%20Projects/Obsidian%20Plugin%20-%20Ollama/plugin/src/settings.ts): plugin settings definition and settings UI.
- [plugin/src/api.ts](/Users/aply/Local%20Dev%20Projects/Obsidian%20Plugin%20-%20Ollama/plugin/src/api.ts): runtime HTTP client used by the plugin.
- [plugin/src/view.ts](/Users/aply/Local%20Dev%20Projects/Obsidian%20Plugin%20-%20Ollama/plugin/src/view.ts): the actual Obsidian sidebar UI.
- [plugin/styles.css](/Users/aply/Local%20Dev%20Projects/Obsidian%20Plugin%20-%20Ollama/plugin/styles.css): plugin styling.
- [plugin/main.js](/Users/aply/Local%20Dev%20Projects/Obsidian%20Plugin%20-%20Ollama/plugin/main.js): built plugin bundle generated from TypeScript.

## Runtime build guide

### 1. Create the Python environment

The runtime uses a local virtual environment inside `runtime/.venv`.

Command:

```bash
python3 -m venv runtime/.venv
```

Why:

- It isolates this project's Python packages from the rest of the machine.
- It makes the runtime reproducible for this repo.

### 2. Install runtime dependencies

Dependencies are listed in [runtime/requirements.txt](/Users/aply/Local%20Dev%20Projects/Obsidian%20Plugin%20-%20Ollama/runtime/requirements.txt).

Important packages:

- `fastapi`: HTTP API framework.
- `uvicorn`: local ASGI server.
- `ollama`: Python client for the local Ollama service.
- `pydantic`: request and response validation.
- `httpx` and `python-dotenv`: included for future runtime work.
- `rumps`: macOS menu bar support for start, stop, restart, and health controls.

Install command:

```bash
runtime/.venv/bin/pip install -r runtime/requirements.txt
```

### 3. Build the runtime API

The runtime code lives in [runtime/src/app.py](/Users/aply/Local%20Dev%20Projects/Obsidian%20Plugin%20-%20Ollama/runtime/src/app.py).

Current endpoints:

- `GET /health`
- `POST /generate`
- `POST /generate-stream`
- `POST /quick-entry`
- `POST /note-action-plan`
- `POST /kanban-action-plan`
- `POST /agent-action-plan`

What they do:

- `/health` checks whether the runtime can reach Ollama.
- `/generate` accepts a `model` and `prompt`, then forwards the request to Ollama.
- `/generate-stream` streams a model response chunk by chunk for live chat updates.
- `/quick-entry` validates AI-organized quick-entry output against a strict schema before returning it.
- `/note-action-plan` returns a validated create/update plan for vault note changes.
- `/kanban-action-plan` returns a validated Kanban card action plan for creating, moving, and renaming board cards.
- `/agent-action-plan` returns a validated mixed action plan so one request can safely combine note and Kanban operations.

### 4. Run the runtime server

Command:

```bash
runtime/.venv/bin/uvicorn runtime.src.app:app --host 127.0.0.1 --port 8000
```

This starts the local API server the plugin expects to call.

### 5. Add safe runtime controls

The runtime now has a separate control layer so you do not need to manage the API process manually.

CLI commands:

```bash
runtime/.venv/bin/python -m runtime.src.runtime_control status
runtime/.venv/bin/python -m runtime.src.runtime_control start
runtime/.venv/bin/python -m runtime.src.runtime_control stop
runtime/.venv/bin/python -m runtime.src.runtime_control restart
runtime/.venv/bin/python -m runtime.src.runtime_control logs
```

macOS menu bar app:

```bash
runtime/.venv/bin/python -m runtime.src.menubar
```

What this manages:

- PID tracking in `runtime/config/runtime.pid`
- state snapshots in `runtime/config/runtime-state.json`
- combined runtime logs in `runtime/config/runtime.log`
- health checks against `http://127.0.0.1:8000/health`
- menu actions for `Start Runtime`, `Stop Runtime`, `Restart Runtime`, `Check Health`, and `Open Logs`

## Plugin build guide

### 1. Define the plugin manifest

The manifest lives in [plugin/manifest.json](/Users/aply/Local%20Dev%20Projects/Obsidian%20Plugin%20-%20Ollama/plugin/manifest.json).

This tells Obsidian:

- the plugin id
- plugin name
- version
- minimum supported Obsidian version
- whether it is desktop-only

### 2. Define the build system

The plugin build is configured in [plugin/package.json](/Users/aply/Local%20Dev%20Projects/Obsidian%20Plugin%20-%20Ollama/plugin/package.json).

Current scripts:

- `npm run build`: bundle `src/main.ts` into `main.js`
- `npm run dev`: watch mode for rebuilding

Current build tool:

- `esbuild`

Why this is needed:

- Obsidian loads compiled JavaScript, not raw TypeScript.
- The bundle becomes [plugin/main.js](/Users/aply/Local%20Dev%20Projects/Obsidian%20Plugin%20-%20Ollama/plugin/main.js).

### 3. Define the plugin entrypoint

The entrypoint is [plugin/src/main.ts](/Users/aply/Local%20Dev%20Projects/Obsidian%20Plugin%20-%20Ollama/plugin/src/main.ts).

Current responsibilities:

- load saved settings
- load saved chat sessions and vault index metadata
- register the custom plugin view
- add a ribbon icon
- add a command to open the view
- register the settings tab
- refresh already-open views when settings change
- create new chats, switch active chats, and persist transcript data
- reindex vault notes and export chat handoff markdown files
- process quick-entry captures into organized notes plus a log entry
- call the stricter runtime quick-entry endpoint for validated structured output
- request validated vault note action plans and apply them only after confirmation
- request validated Kanban board action plans and apply them only after confirmation
- request validated mixed agent action plans and apply them only after confirmation
- enrich referenced notes with graph-aware link and backlink summaries before they are sent to chat or planners
- build a lightweight vault-wide summary and auto-retrieve relevant notes for chat and planning prompts

### 4. Define plugin settings

The settings code lives in [plugin/src/settings.ts](/Users/aply/Local%20Dev%20Projects/Obsidian%20Plugin%20-%20Ollama/plugin/src/settings.ts).

Current settings:

- `runtimeUrl`
- `defaultModel`

Why this matters:

- the runtime URL tells the plugin where the Python API is running
- the model setting tells the runtime which Ollama model to use

### 5. Define the plugin API client

The client code lives in [plugin/src/api.ts](/Users/aply/Local%20Dev%20Projects/Obsidian%20Plugin%20-%20Ollama/plugin/src/api.ts).

Current responsibilities:

- call `GET /health`
- call `POST /generate`
- call `POST /generate-stream`
- call `POST /quick-entry`
- call `POST /note-action-plan`
- call `POST /kanban-action-plan`
- call `POST /agent-action-plan`
- normalize the base URL
- parse runtime errors into usable messages
- enforce request timeouts with `AbortController`
- classify failures into timeout, offline, HTTP, and unknown errors

This file is the boundary between the Obsidian UI and the Python runtime.

### 6. Define the Obsidian UI view

The UI lives in [plugin/src/view.ts](/Users/aply/Local%20Dev%20Projects/Obsidian%20Plugin%20-%20Ollama/plugin/src/view.ts).

Current UI features:

- previous chat list
- new chat action
- runtime connection status
- model override control
- searchable referenced note picker
- graph-aware referenced note context
- automatic vault context retrieval
- use active note action
- reindex vault action
- chat handoff export action
- quick post entry button and expandable capture field
- vault action planning field with preview/apply controls
- transcript area
- prompt composer
- dedicated Kanban action planning field with preview/apply controls
- dedicated mixed agent action planning field with preview/apply controls

This is now a real chat shell rather than a single prompt panel.

### 7. Style the plugin

Styles live in [plugin/styles.css](/Users/aply/Local%20Dev%20Projects/Obsidian%20Plugin%20-%20Ollama/plugin/styles.css).

Current styling covers:

- shell layout
- metadata rows
- prompt input
- action buttons
- response area

### 8. Build the plugin

Run:

```bash
cd plugin
npm install
npm run build
```

This generates [plugin/main.js](/Users/aply/Local%20Dev%20Projects/Obsidian%20Plugin%20-%20Ollama/plugin/main.js).

## What has been verified so far

Verified:

- the Python runtime environment installs correctly
- the plugin dependencies install correctly
- the plugin TypeScript bundle builds successfully
- the runtime server starts successfully
- `GET /health` returns success against a live local Ollama service
- `POST /generate` returns a real model response against a live local Ollama service
- plugin requests now use explicit request timeouts
- the plugin UI now shows persistent runtime error banners and connection state
- runtime Ollama calls are now offloaded from async handlers into a threadpool
- open plugin views now rerender and recheck runtime health after settings are saved
- the plugin now persists multiple chats and restores them from plugin data
- the plugin can export a chat handoff markdown note into the vault
- the plugin can turn a quick capture into an organized note plus a quick-entry log reference
- quick-entry structure validation now happens in the runtime instead of the plugin
- the plugin can request a validated vault action plan and apply it only after explicit confirmation
- vault note references can now be attached through a search-based picker instead of raw path typing
- referenced Kanban notes now expose structured board summaries to the model
- the plugin can request a validated Kanban card action plan and apply those actions safely to markdown-backed boards
- the plugin can request a validated mixed action plan that combines note and Kanban work in one approval flow
- referenced notes now include structured graph summaries based on Obsidian links, backlinks, tags, and simple graph roles
- the runtime now has a separate safe controller with CLI and macOS menu bar controls
- the plugin can now answer broader vault questions by combining a vault summary with automatically retrieved note context
- chat responses now stream into the transcript instead of waiting for the full reply
- in-flight streamed chat requests can now be cancelled from the UI
- referenced Kanban notes now include structured board summaries in model context

Important note:

- the local installed Ollama model we verified with was `mistral:latest`
- the plugin default setting now points at `mistral:latest`

## Current known gaps

- there is no dynamic model list yet
- note-action planning currently supports create/update plans only
- Kanban planning currently supports card create, move, and rename only
- graph-awareness currently improves context, but does not yet expose explicit link-management actions
- retrieval is currently lexical and lightweight, not embedding-based semantic search

## New concepts introduced

### Request timeout handling

The runtime client in [plugin/src/api.ts](/Users/aply/Local%20Dev%20Projects/Obsidian%20Plugin%20-%20Ollama/plugin/src/api.ts) now wraps `fetch` with `AbortController`.

Why this matters:

- if the runtime hangs, the plugin no longer waits forever
- the UI can surface a clear timeout error instead of appearing frozen

### Structured runtime errors

The plugin client now throws a dedicated `RuntimeRequestError`.

Why this matters:

- the view can distinguish offline failures from timeout failures
- UI error handling becomes more predictable as the plugin grows

### Blocking work inside async routes

The runtime in [runtime/src/app.py](/Users/aply/Local%20Dev%20Projects/Obsidian%20Plugin%20-%20Ollama/runtime/src/app.py) uses `run_in_threadpool` for Ollama client calls.

Why this matters:

- the route handlers stay `async`, but the blocking Ollama work does not tie up the event loop
- long generations are less likely to make the whole runtime feel unresponsive

### Refreshing open views after settings changes

The plugin in [plugin/src/main.ts](/Users/aply/Local%20Dev%20Projects/Obsidian%20Plugin%20-%20Ollama/plugin/src/main.ts) now loops through open plugin leaves and asks each [plugin/src/view.ts](/Users/aply/Local%20Dev%20Projects/Obsidian%20Plugin%20-%20Ollama/plugin/src/view.ts) instance to refresh.

Why this matters:

- the sidebar stays in sync with the saved runtime URL and model
- users do not need to close and reopen the plugin after changing settings

### Local chat session persistence

The plugin core in [plugin/src/main.ts](/Users/aply/Local%20Dev%20Projects/Obsidian%20Plugin%20-%20Ollama/plugin/src/main.ts) now stores chat sessions, the active chat id, and vault index metadata alongside settings.

Why this matters:

- previous chats can be reopened
- new chats can start fresh without losing older transcripts

### Vault-context chat prompts

The helper functions in [plugin/src/chat.ts](/Users/aply/Local%20Dev%20Projects/Obsidian%20Plugin%20-%20Ollama/plugin/src/chat.ts) build runtime prompts using prior messages and referenced note content.

Why this matters:

- the current runtime API only accepts a single prompt string
- the plugin can still provide chat history and note context by composing that prompt locally

### Quick-entry organization workflow

The runtime now owns quick-entry prompt building and schema validation, and the plugin writes the resulting note and log entry from [plugin/src/main.ts](/Users/aply/Local%20Dev%20Projects/Obsidian%20Plugin%20-%20Ollama/plugin/src/main.ts).

Why this matters:

- rough captures can be turned into organized vault notes quickly
- every quick entry also leaves a log/reference trail inside the vault
- the plugin no longer depends on ad hoc JSON parsing for this workflow

### Stricter runtime endpoints

The runtime in [runtime/src/app.py](/Users/aply/Local%20Dev%20Projects/Obsidian%20Plugin%20-%20Ollama/runtime/src/app.py) now exposes multiple strict planning endpoints instead of relying on freeform text generation for write operations.

Why this matters:

- the plugin receives validated structured data before touching vault files
- note, Kanban, and mixed agent actions all follow the same approval-first pattern
- this keeps the AI useful without giving it unconstrained write access

### Graph-aware note context

Referenced notes now pass through [plugin/src/graph.ts](/Users/aply/Local%20Dev%20Projects/Obsidian%20Plugin%20-%20Ollama/plugin/src/graph.ts) before they are sent into chat and planning flows.

Why this matters:

- the model can see outgoing links, backlinks, tags, and a simple inferred graph role
- this better matches how Obsidian's built-in graph view reflects note relationships
- organizational decisions can use note influence and connectedness, not just raw markdown text

### Vault-wide retrieval

The retrieval layer in [plugin/src/retrieval.ts](/Users/aply/Local%20Dev%20Projects/Obsidian%20Plugin%20-%20Ollama/plugin/src/retrieval.ts) now builds lightweight note summaries during reindex and automatically selects relevant notes for prompts.

Why this matters:

- you can ask general questions about the vault without manually attaching notes first
- agent planning can pull in likely relevant note context automatically
- the model now gets both a vault-wide summary and selected note content instead of an empty context block

### Safe runtime controller

The runtime controller in [runtime/src/manager.py](/Users/aply/Local%20Dev%20Projects/Obsidian%20Plugin%20-%20Ollama/runtime/src/manager.py) separates process control from the API itself.

Why this matters:

- you can start, stop, and restart the runtime safely before testing the plugin
- the process state is persisted to files in `runtime/config`
- the macOS menu bar app gives you visible operational control instead of relying on an unmanaged terminal session

The runtime in [runtime/src/app.py](/Users/aply/Local%20Dev%20Projects/Obsidian%20Plugin%20-%20Ollama/runtime/src/app.py) now exposes a dedicated `/quick-entry` endpoint with validated request and response models.

Why this matters:

- structure enforcement happens closer to the agent logic
- this pattern scales better for future vault-editing and Obsidian-aware actions

### Planned vault actions with explicit apply

The runtime now produces a validated note-action plan, and the plugin previews that plan before writing files.

Why this matters:

- the model does not write directly to the vault
- users get a confirmation step before file changes are applied

### Search-based note references

The plugin view in [plugin/src/view.ts](/Users/aply/Local%20Dev%20Projects/Obsidian%20Plugin%20-%20Ollama/plugin/src/view.ts) now uses the indexed vault file list to search and attach referenced notes.

Why this matters:

- users no longer need to type exact note paths
- chat context and vault-action planning are much easier to use

### Kanban-aware note context

Referenced notes now pass through [plugin/src/kanban.ts](/Users/aply/Local%20Dev%20Projects/Obsidian%20Plugin%20-%20Ollama/plugin/src/kanban.ts), which detects markdown-backed Kanban boards and appends a structured lane/card summary.

Why this matters:

- the model can understand the board state more reliably than from raw markdown alone
- this creates a clean base for future Kanban-specific actions

### Streaming chat responses

The runtime now exposes [runtime/src/app.py](/Users/aply/Local%20Dev%20Projects/Obsidian%20Plugin%20-%20Ollama/runtime/src/app.py) `/generate-stream`, and the plugin reads those chunks through [plugin/src/api.ts](/Users/aply/Local%20Dev%20Projects/Obsidian%20Plugin%20-%20Ollama/plugin/src/api.ts).

Why this matters:

- the chat UI feels responsive while the model is still generating
- long replies no longer look like the plugin is stalled

### Request cancellation

The plugin chat view now keeps an `AbortController` for the active streamed request and exposes a cancel action in the composer.

Why this matters:

- users can stop a generation that is going in the wrong direction
- long-running requests no longer need to finish before the UI becomes usable again

## How to think about the architecture

This project is intentionally split into two layers:

- the runtime layer is responsible for local AI communication
- the plugin layer is responsible for Obsidian UX

That separation matters because:

- Python is convenient for local AI/runtime work
- Obsidian plugins are built in TypeScript
- keeping the HTTP boundary clean makes both sides easier to debug

## Update rule for this guide

As the project evolves, this file should be updated with:

- new files and what they do
- any changed commands
- any new concepts introduced during the build
- verification steps and what was actually tested
