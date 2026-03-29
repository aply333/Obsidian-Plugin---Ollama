# Runtime

Shared runtime services, adapters, and configuration for the Ollama-backed Obsidian plugin live here.

## Python environment

This runtime uses a local virtual environment at `runtime/.venv`.

Activate it:

```bash
source runtime/.venv/bin/activate
```

Reinstall dependencies:

```bash
runtime/.venv/bin/pip install -r runtime/requirements.txt
```

## Run the API

Start the local runtime:

```bash
runtime/.venv/bin/uvicorn runtime.src.app:app --host 127.0.0.1 --port 8000
```

Available endpoints:

- `GET /health`
- `POST /generate`
- `POST /generate-stream`
- `POST /context/index`
- `POST /context/retrieve`
- `POST /context/sync`
- `POST /quick-entry`
- `POST /note-action-plan`
- `POST /kanban-action-plan`
- `POST /agent-action-plan`

## SQLite context store

The runtime now initializes a local SQLite database at `runtime/config/runtime.db`.

Current usage:

- stores structured `vault_map` note and folder rows
- stores inferred and manual categories
- records sync events in `change_log`
- creates the `questions` table for future ambiguity handling

The Obsidian plugin syncs its current indexed context into SQLite after vault reindexing and after manual context changes.

Primary indexing path:

- the plugin sends raw note snapshots to `POST /context/index`
- the runtime builds `note_entries`, `vault_summary`, and `vault_map`
- the runtime persists those artifacts into SQLite
- the plugin stores the returned artifacts locally for UI and retrieval

Primary retrieval path:

- the plugin asks `POST /context/retrieve` for relevant note paths
- the runtime ranks paths from SQLite-backed vault context
- the plugin then loads those selected notes from the vault for prompt assembly

## Safe runtime controls

The runtime now includes a separate control layer so you can start, stop, restart, and inspect the API safely.

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

What the controller manages:

- PID tracking in `runtime/config/runtime.pid`
- runtime state in `runtime/config/runtime-state.json`
- combined process logs in `runtime/config/runtime.log`
- health checks against `http://127.0.0.1:8000/health`

The menu bar app exposes:

- `Start Runtime`
- `Stop Runtime`
- `Restart Runtime`
- `Check Health`
- `Open Logs`
- `Quit`
