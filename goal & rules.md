Goals:

1. The goal is to bridge my ollama minstral ai instance to obsidian.
2. Not only should it be able to view, index and us my vault for context.
3. There should be a sidebar chat window.
4. This is an agent that can directly control and edit the content within my vault.
5. It should be aware of all the features of obsidian - how they are used and be able to implement.
6. I have the kanban plugin - it should be able to utilize it.

Rules:
1. Python runtime that serves a local host api to connect to the ollama instance and handle agent logic.
  - The runtime will use: 
    - FastAPI        → receives commands from plugin
      Pydantic       → validates structured outputs
      Requests       → talks to Ollama
      Pathlib        → reads/writes notes
      Watchdog       → detects file changes
      APScheduler    → runs background jobs
      Markdown-it    → understands note structure
  - When running this should have a menu in the mac status bar - allowing me to start, stop, restart, and quit - there should be an indicator aswell to show status - running , stopped 
2. For the plugin:
  - Use a vanilla typescript setup - html -css we dont want to introduce any framework.
3. Styles are in bem format
4. variables and names will use camel_case
5. when features are added or edited update readme file on the build - structure, features parts + change log at the end.

The UI of the plugin:
- chat box, ability to reference files in the vault for added context and have a reindex button.
- Chat Handoff - this would give a markdown output of the last chat.
- I should be able to see previous chats & return to them
- I should be able to start fresh new chats.

# TODO

- [x] Start and verify the local runtime server with real `/health` and `/generate` requests.
- [x] Add request timeouts and clearer offline/error states in the plugin runtime client.
- [x] Make the FastAPI runtime handlers non-blocking enough for local UI use.
- [x] Refresh an already-open plugin view when settings change.
- [x] Decide whether the plugin should remain a simple prompt panel or evolve into streaming chat, note insertion, and command-driven workflows.
- [x] Add streaming generation support.
- [x] Add request cancellation in the plugin UI.
- [x] Add a model override control in the plugin view.
- [x] Add a note picker or search UI for vault file references instead of exact path entry.
- [x] Add runtime support for reading, writing, and editing vault notes as agent actions.
- [x] Add Obsidian-aware actions beyond chat, including note creation/edit flows.
- [x] Add Kanban-plugin-aware actions and context handling.
  - [x] Add Kanban board context parsing for referenced notes.
  - [x] Add Kanban-specific action planning and safe board updates.
- [x] Add a broader mixed agent action planner that can return validated note and Kanban actions in one approved plan.
- [x] Add Obsidian graph-awareness for referenced notes through links, backlinks, tags, and graph-role summaries.
- [x] Add a quick post entry flow that organizes captures into the vault and logs a reference.
- [x] Add a macOS-safe runtime controller with menu bar controls, health checks, PID tracking, and logs.
- [x] Add vault-wide context indexing and automatic note retrieval so chat and agent plans can work without manual references.
- [ ] Add Neural Map plugin context handling and safe structured actions.
