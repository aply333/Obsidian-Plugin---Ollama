import type { VaultMapState, VaultNoteIndexEntry } from "./retrieval";

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  created_at: number;
  model: string;
  referenced_file_paths: string[];
}

export interface ChatSession {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  model_override: string;
  referenced_file_paths: string[];
  messages: ChatMessage[];
}

export interface VaultIndexState {
  file_paths: string[];
  markdown_file_count: number;
  indexed_at: number | null;
  vault_summary: string;
  vault_map: VaultMapState | null;
  note_entries: VaultNoteIndexEntry[];
}

export interface QuickEntryPlan {
  note_title: string;
  target_folder: string;
  note_body: string;
  log_summary: string;
  tags: string[];
  inferred_categories?: string[];
  placement_confidence?: number;
  placement_reason?: string;
}

export interface NoteActionOperation {
  action: "create" | "update";
  path: string;
  content: string;
  summary: string;
}

export interface NoteActionPlan {
  summary: string;
  operations: NoteActionOperation[];
  requires_confirmation: boolean;
}

export interface KanbanActionOperation {
  action: "create_card" | "move_card" | "update_card";
  board_path: string;
  source_lane_title: string;
  target_lane_title: string;
  card_title: string;
  new_card_title: string;
  summary: string;
}

export interface KanbanActionPlan {
  summary: string;
  operations: KanbanActionOperation[];
  requires_confirmation: boolean;
}

export type AgentAction =
  | {
      type: "note_create" | "note_update";
      path: string;
      content: string;
      summary: string;
    }
  | {
      type: "kanban_card_create" | "kanban_card_move" | "kanban_card_update";
      board_path: string;
      source_lane_title: string;
      target_lane_title: string;
      card_title: string;
      new_card_title: string;
      summary: string;
    };

export interface AgentActionPlan {
  summary: string;
  actions: AgentAction[];
  requires_confirmation: boolean;
}

export const EMPTY_VAULT_INDEX: VaultIndexState = {
  file_paths: [],
  markdown_file_count: 0,
  indexed_at: null,
  vault_summary: "",
  vault_map: null,
  note_entries: [],
};

export function create_id(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function create_chat_session(): ChatSession {
  const now = Date.now();

  return {
    id: create_id("chat"),
    title: "New Chat",
    created_at: now,
    updated_at: now,
    model_override: "",
    referenced_file_paths: [],
    messages: [],
  };
}

export function build_chat_title(prompt: string): string {
  const title = prompt.replace(/\s+/g, " ").trim();
  if (!title) {
    return "New Chat";
  }

  return title.slice(0, 48);
}

export function build_chat_prompt(args: {
  prompt: string;
  history: ChatMessage[];
  referenced_notes: Array<{ path: string; content: string }>;
  vault_summary: string;
  vault_map: VaultMapState | null;
  manual_context_items: string[];
}): string {
  const note_context = args.referenced_notes.length
    ? args.referenced_notes
        .map(
          (note) =>
            `Referenced note: ${note.path}\n---\n${note.content.trim() || "(empty note)"}`,
        )
        .join("\n\n")
    : "No referenced notes were supplied.";

  const history_text = args.history.length
    ? args.history
        .map(
          (message) =>
            `${message.role.toUpperCase()}:\n${message.content.trim() || "(empty message)"}`,
        )
        .join("\n\n")
    : "No prior conversation.";
  const manual_context_text = args.manual_context_items.length
    ? args.manual_context_items.map((item) => `- ${item}`).join("\n")
    : "No manual context items were supplied.";

  return [
    "You are assisting inside an Obsidian vault through a local plugin.",
    "The runtime maintains a SQLite-backed context database for this vault.",
    "Treat the provided vault summary, vault map, and manual context as structured context derived from that database.",
    "Use the referenced note content when it is relevant.",
    "Pay attention to note links, backlinks, tags, and graph-role summaries when organizing information.",
    "If the user asks about the vault as a whole, synthesize across the vault summary and all provided context. Do not anchor on a single note unless the user asked about that note specifically.",
    `Vault summary:\n${args.vault_summary || "Vault summary unavailable."}`,
    `Vault map:\n${args.vault_map ? JSON.stringify(args.vault_map, null, 2) : "Vault map unavailable."}`,
    `Manual context:\n${manual_context_text}`,
    `Vault context:\n${note_context}`,
    `Conversation so far:\n${history_text}`,
    `Latest user request:\n${args.prompt.trim()}`,
  ].join("\n\n");
}

export function build_chat_handoff_markdown(session: ChatSession): string {
  const messages = session.messages
    .map((message) => {
      const heading = message.role === "user" ? "## User" : "## Assistant";
      const references = message.referenced_file_paths.length
        ? `\nReferenced files: ${message.referenced_file_paths.join(", ")}`
        : "";

      return `${heading}\n\n${message.content}${references}`;
    })
    .join("\n\n");

  const model_line = session.model_override || "Uses plugin default model";
  const reference_line = session.referenced_file_paths.length
    ? session.referenced_file_paths.map((path) => `- ${path}`).join("\n")
    : "- None";

  return [
    `# ${session.title}`,
    "",
    `Created: ${new Date(session.created_at).toISOString()}`,
    `Updated: ${new Date(session.updated_at).toISOString()}`,
    `Model override: ${model_line}`,
    "",
    "## Referenced Files",
    "",
    reference_line,
    "",
    "## Transcript",
    "",
    messages || "_No messages yet._",
  ].join("\n");
}
