# Plugin

Obsidian plugin source, UI assets, and plugin-specific styles live here.

## Structure

- `manifest.json`: Obsidian plugin manifest.
- `package.json`: Build scripts and frontend dependencies.
- `tsconfig.json`: TypeScript configuration for the plugin source.
- `main.js`: Bundled plugin entry generated from `src/main.ts`.
- `styles.css`: Plugin styles loaded by Obsidian.
- `src/main.ts`: Plugin entrypoint and registration.
- `src/chat.ts`: chat session types and prompt/handoff helpers.
- `src/settings.ts`: Plugin settings tab and persistence helpers.
- `src/view.ts`: Docked chat workspace UI for the plugin.

## Features

- Sidebar chat workspace with previous chats and new chat creation.
- Persistent local chat sessions stored in plugin data.
- Runtime connection status, timeout handling, and error banners.
- Streaming assistant responses in chat.
- Cancel button for in-flight streamed chat requests.
- Model override control per chat.
- Searchable note picker for referenced vault context per chat.
- Graph-aware referenced note context including outgoing links, incoming links, tags, and simple graph-role summaries.
- Vault-wide lightweight indexing with automatic note retrieval for chat and planning prompts.
- Vault reindex action with note count metadata.
- Chat handoff export into a markdown note in the vault.
- Quick post entry flow that creates an organized note and appends a log reference.
- Vault action planner that previews strict create/update note operations before applying them.
- Kanban-board-aware context parsing for referenced Kanban notes.
- Kanban action planner that previews strict card create, move, and rename operations before applying them.
- Mixed agent action planner that can return both note and Kanban actions in one reviewed plan.

## Changelog

- Added persistent chat sessions and active chat switching.
- Replaced the single prompt panel with a multi-part chat workspace.
- Added model override, referenced files, reindex, and chat handoff actions.
- Added quick post entry capture, AI organization, and quick-entry logging.
- Moved quick-entry structure enforcement to a dedicated runtime endpoint.
- Added runtime-backed vault action planning with explicit apply confirmation.
- Replaced exact-path file references with a searchable note picker.
- Added streaming chat responses through a dedicated runtime stream endpoint.
- Added cancellation for in-flight streamed chat requests.
- Added structured Kanban board summaries for referenced Kanban notes.
- Added runtime-backed Kanban action planning and safe board updates for card create, move, and rename flows.
- Added a broader runtime-backed agent action planner for mixed note and Kanban operations.
- Added graph-aware note context so referenced notes now carry link, backlink, tag, and graph-role summaries into prompts.
- Added vault-level summary indexing and automatic retrieval so the plugin can answer general vault questions without manual note attachment.
