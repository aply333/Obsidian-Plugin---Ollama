"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => OllamaRuntimePlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian3 = require("obsidian");

// src/chat.ts
var EMPTY_VAULT_INDEX = {
  file_paths: [],
  markdown_file_count: 0,
  indexed_at: null,
  vault_summary: "",
  vault_map: null,
  note_entries: []
};
function create_id(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
function create_chat_session() {
  const now = Date.now();
  return {
    id: create_id("chat"),
    title: "New Chat",
    created_at: now,
    updated_at: now,
    model_override: "",
    referenced_file_paths: [],
    messages: []
  };
}
function build_chat_title(prompt) {
  const title = prompt.replace(/\s+/g, " ").trim();
  if (!title) {
    return "New Chat";
  }
  return title.slice(0, 48);
}
function build_chat_prompt(args) {
  const note_context = args.referenced_notes.length ? args.referenced_notes.map(
    (note) => `Referenced note: ${note.path}
---
${note.content.trim() || "(empty note)"}`
  ).join("\n\n") : "No referenced notes were supplied.";
  const history_text = args.history.length ? args.history.map(
    (message) => `${message.role.toUpperCase()}:
${message.content.trim() || "(empty message)"}`
  ).join("\n\n") : "No prior conversation.";
  const manual_context_text = args.manual_context_items.length ? args.manual_context_items.map((item) => `- ${item}`).join("\n") : "No manual context items were supplied.";
  return [
    "You are assisting inside an Obsidian vault through a local plugin.",
    "The runtime maintains a SQLite-backed context database for this vault.",
    "Treat the provided vault summary, vault map, and manual context as structured context derived from that database.",
    "Use the referenced note content when it is relevant.",
    "Pay attention to note links, backlinks, tags, and graph-role summaries when organizing information.",
    "If the user asks about the vault as a whole, synthesize across the vault summary and all provided context. Do not anchor on a single note unless the user asked about that note specifically.",
    `Vault summary:
${args.vault_summary || "Vault summary unavailable."}`,
    `Vault map:
${args.vault_map ? JSON.stringify(args.vault_map, null, 2) : "Vault map unavailable."}`,
    `Manual context:
${manual_context_text}`,
    `Vault context:
${note_context}`,
    `Conversation so far:
${history_text}`,
    `Latest user request:
${args.prompt.trim()}`
  ].join("\n\n");
}
function build_chat_handoff_markdown(session) {
  const messages = session.messages.map((message) => {
    const heading = message.role === "user" ? "## User" : "## Assistant";
    const references = message.referenced_file_paths.length ? `
Referenced files: ${message.referenced_file_paths.join(", ")}` : "";
    return `${heading}

${message.content}${references}`;
  }).join("\n\n");
  const model_line = session.model_override || "Uses plugin default model";
  const reference_line = session.referenced_file_paths.length ? session.referenced_file_paths.map((path) => `- ${path}`).join("\n") : "- None";
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
    messages || "_No messages yet._"
  ].join("\n");
}

// src/kanban.ts
function readFrontmatterValue(markdown, key) {
  const frontmatter_match = markdown.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatter_match) {
    return null;
  }
  const line = frontmatter_match[1].split("\n").find((entry) => entry.trim().startsWith(`${key}:`));
  if (!line) {
    return null;
  }
  return line.split(":").slice(1).join(":").trim();
}
function is_kanban_note(markdown) {
  return readFrontmatterValue(markdown, "kanban-plugin") === "board";
}
function parse_kanban_board(markdown) {
  if (!is_kanban_note(markdown)) {
    return null;
  }
  const lines = markdown.split("\n");
  const lanes = [];
  let current_lane = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (line.startsWith("## ")) {
      if (current_lane) {
        current_lane.end_line_index = index;
      }
      current_lane = {
        title: line.replace(/^##\s+/, "").trim(),
        heading_line_index: index,
        end_line_index: lines.length,
        cards: []
      };
      lanes.push(current_lane);
      continue;
    }
    if (!current_lane) {
      continue;
    }
    const card_match = line.match(/^[-*]\s+(?:\[[^\]]*\]\s+)?(.+)$/);
    if (card_match) {
      current_lane.cards.push({
        title: card_match[1].trim(),
        line_index: index
      });
    }
  }
  return { lanes, lines };
}
function find_lane(board, title) {
  const lane = board.lanes.find((entry) => entry.title === title);
  if (!lane) {
    throw new Error(`Kanban lane not found: ${title}`);
  }
  return lane;
}
function find_unique_card(lane, title) {
  const matches = lane.cards.filter((card) => card.title === title);
  if (!matches.length) {
    throw new Error(`Kanban card not found in lane '${lane.title}': ${title}`);
  }
  if (matches.length > 1) {
    throw new Error(
      `Kanban card title is ambiguous in lane '${lane.title}': ${title}`
    );
  }
  return matches[0];
}
function find_insert_index(board, lane) {
  if (lane.cards.length) {
    return lane.cards[lane.cards.length - 1].line_index + 1;
  }
  let index = lane.heading_line_index + 1;
  while (index < lane.end_line_index && !board.lines[index].trim()) {
    index += 1;
  }
  return index;
}
function splice_line(lines, index, value) {
  const next = [...lines];
  next.splice(index, 0, value);
  return next;
}
function replace_line(lines, index, value) {
  const next = [...lines];
  next[index] = value;
  return next;
}
function remove_line(lines, index) {
  const next = [...lines];
  next.splice(index, 1);
  return next;
}
function apply_kanban_operation(markdown, operation) {
  const board = parse_kanban_board(markdown);
  if (!board) {
    throw new Error(
      `Target note is not a Kanban board: ${operation.board_path}`
    );
  }
  if (operation.action === "create_card") {
    const target_lane2 = find_lane(board, operation.target_lane_title);
    const insert_index2 = find_insert_index(board, target_lane2);
    return splice_line(
      board.lines,
      insert_index2,
      `- ${operation.card_title}`
    ).join("\n");
  }
  if (operation.action === "update_card") {
    const source_lane2 = find_lane(board, operation.source_lane_title);
    const card2 = find_unique_card(source_lane2, operation.card_title);
    const existing_line = board.lines[card2.line_index];
    const updated_line = existing_line.replace(
      /(^[-*]\s+(?:\[[^\]]*\]\s+)?).+$/,
      `$1${operation.new_card_title}`
    );
    return replace_line(board.lines, card2.line_index, updated_line).join("\n");
  }
  const source_lane = find_lane(board, operation.source_lane_title);
  const card = find_unique_card(source_lane, operation.card_title);
  const card_line = board.lines[card.line_index];
  const without_card = remove_line(board.lines, card.line_index).join("\n");
  const next_board = parse_kanban_board(without_card);
  if (!next_board) {
    throw new Error(
      `Target note is not a Kanban board: ${operation.board_path}`
    );
  }
  const target_lane = find_lane(next_board, operation.target_lane_title);
  const insert_index = find_insert_index(next_board, target_lane);
  return splice_line(next_board.lines, insert_index, card_line).join("\n");
}
function build_kanban_context(path, markdown) {
  const board = parse_kanban_board(markdown);
  if (!board) {
    return markdown;
  }
  const lane_lines = board.lanes.map((lane) => {
    const cards = lane.cards.length ? lane.cards.map((card) => `  - ${card.title}`).join("\n") : "  - (empty)";
    return `${lane.title}
${cards}`;
  });
  return [
    markdown.trim(),
    "",
    `Structured Kanban summary for ${path}:`,
    lane_lines.join("\n")
  ].join("\n");
}

// src/graph.ts
function get_graph_role(summary) {
  const incoming_count = summary.incoming_links.length;
  const outgoing_count = summary.outgoing_links.length;
  if (incoming_count + outgoing_count === 0) {
    return "isolated";
  }
  if (incoming_count >= 3 || outgoing_count >= 3) {
    return "hub";
  }
  if (incoming_count > 0 && outgoing_count > 0) {
    return "connected";
  }
  return "leaf";
}
function build_graph_summary(args) {
  const summary = {
    outgoing_links: args.outgoing_links.slice(0, 8),
    incoming_links: args.incoming_links.slice(0, 8),
    tags: args.tags.slice(0, 12),
    graph_role: "isolated"
  };
  summary.graph_role = get_graph_role(summary);
  return summary;
}
function build_graph_context(path, markdown, summary) {
  const outgoing_lines = summary.outgoing_links.length ? summary.outgoing_links.map((link) => `  - ${link}`).join("\n") : "  - (none)";
  const incoming_lines = summary.incoming_links.length ? summary.incoming_links.map((link) => `  - ${link}`).join("\n") : "  - (none)";
  const tag_lines = summary.tags.length ? summary.tags.map((tag) => `  - ${tag}`).join("\n") : "  - (none)";
  return [
    markdown.trim(),
    "",
    `Structured graph summary for ${path}:`,
    `Graph role: ${summary.graph_role}`,
    "Outgoing links:",
    outgoing_lines,
    "Incoming links:",
    incoming_lines,
    "Tags:",
    tag_lines
  ].join("\n");
}

// src/retrieval.ts
var STOP_WORDS = /* @__PURE__ */ new Set([
  "a",
  "about",
  "an",
  "and",
  "are",
  "as",
  "can",
  "at",
  "be",
  "describe",
  "by",
  "for",
  "from",
  "how",
  "i",
  "in",
  "is",
  "it",
  "me",
  "my",
  "of",
  "on",
  "or",
  "overview",
  "that",
  "tell",
  "the",
  "this",
  "through",
  "to",
  "vault",
  "what",
  "with",
  "you"
]);
function tokenize(value) {
  return value.toLowerCase().split(/[^a-z0-9]+/).map((token) => token.trim()).filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}
function getFolderPath(path) {
  return path.includes("/") ? path.split("/").slice(0, -1).join("/") : "(root)";
}
function isVaultOverviewQuery(query) {
  const normalized = query.toLowerCase();
  const phrases = [
    "tell me about this vault",
    "what can you tell me about this vault",
    "summarize this vault",
    "summarise this vault",
    "overview of this vault",
    "what is in this vault",
    "describe this vault"
  ];
  return phrases.some((phrase) => normalized.includes(phrase)) || normalized.includes("vault") && (normalized.includes("summary") || normalized.includes("summarize") || normalized.includes("summarise") || normalized.includes("overview") || normalized.includes("describe") || normalized.includes("tell me about"));
}
function getRepresentativePaths(entries, excluded, limit) {
  const byFolder = /* @__PURE__ */ new Map();
  for (const entry of entries) {
    if (excluded.has(entry.path)) {
      continue;
    }
    const folder = getFolderPath(entry.path);
    const folderEntries = byFolder.get(folder) ?? [];
    folderEntries.push(entry);
    byFolder.set(folder, folderEntries);
  }
  const selected = [];
  const topFolders = [...byFolder.entries()].sort(
    (left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0])
  ).slice(0, Math.max(limit, 6));
  for (const [, folderEntries] of topFolders) {
    const bestEntry = folderEntries.slice().sort((left, right) => right.word_count - left.word_count)[0];
    if (bestEntry && !selected.includes(bestEntry.path)) {
      selected.push(bestEntry.path);
    }
    if (selected.length >= limit) {
      return selected;
    }
  }
  for (const entry of entries.filter((candidate) => !excluded.has(candidate.path)).slice().sort((left, right) => right.word_count - left.word_count)) {
    if (!selected.includes(entry.path)) {
      selected.push(entry.path);
    }
    if (selected.length >= limit) {
      break;
    }
  }
  return selected;
}
function retrieve_relevant_note_paths(args) {
  const limit = args.limit ?? 4;
  const excluded = new Set(args.excluded_paths ?? []);
  const query_tokens = tokenize(args.query);
  if (isVaultOverviewQuery(args.query)) {
    return getRepresentativePaths(args.entries, excluded, Math.max(limit, 6));
  }
  const scored = args.entries.filter((entry) => !excluded.has(entry.path)).map((entry) => {
    const haystack = [
      entry.path,
      entry.title,
      entry.excerpt,
      entry.tags.join(" "),
      (entry.ai_categories ?? []).join(" "),
      entry.links.join(" ")
    ].join(" \n ").toLowerCase();
    let score = 0;
    for (const token of query_tokens) {
      if (entry.title.toLowerCase().includes(token)) {
        score += 8;
      }
      if (entry.path.toLowerCase().includes(token)) {
        score += 6;
      }
      if (entry.tags.some((tag) => tag.toLowerCase().includes(token))) {
        score += 5;
      }
      if ((entry.ai_categories ?? []).some(
        (category) => category.toLowerCase().includes(token)
      )) {
        score += 5;
      }
      if (entry.links.some((link) => link.toLowerCase().includes(token))) {
        score += 3;
      }
      if (haystack.includes(token)) {
        score += 2;
      }
    }
    return { path: entry.path, score, word_count: entry.word_count };
  }).sort(
    (left, right) => right.score - left.score || right.word_count - left.word_count
  );
  if (!query_tokens.length || !scored.some((entry) => entry.score > 0)) {
    return getRepresentativePaths(args.entries, excluded, Math.min(limit, 4));
  }
  return scored.filter((entry) => entry.score > 0).slice(0, limit).map((entry) => entry.path);
}

// src/api.ts
var RuntimeRequestError = class extends Error {
  constructor(message, code) {
    super(message);
    this.name = "RuntimeRequestError";
    this.code = code;
  }
};
function normalizeBaseUrl(baseUrl) {
  return baseUrl.replace(/\/+$/, "");
}
async function fetchWithTimeout(input, init, timeoutMs = 15e3) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(
    () => controller.abort("timeout"),
    timeoutMs
  );
  const externalSignal = init?.signal;
  const abortFromExternalSignal = () => {
    controller.abort("cancelled");
  };
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort("cancelled");
    } else {
      externalSignal.addEventListener("abort", abortFromExternalSignal, {
        once: true
      });
    }
  }
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      if (controller.signal.reason === "cancelled") {
        throw new RuntimeRequestError("Request cancelled.", "cancelled");
      }
      throw new RuntimeRequestError(
        `Runtime request timed out after ${Math.floor(timeoutMs / 1e3)} seconds.`,
        "timeout"
      );
    }
    if (error instanceof TypeError) {
      throw new RuntimeRequestError(
        "Cannot reach the runtime. Check that the local API server is running.",
        "offline"
      );
    }
    throw new RuntimeRequestError(
      "Unknown runtime request failure.",
      "unknown"
    );
  } finally {
    externalSignal?.removeEventListener("abort", abortFromExternalSignal);
    window.clearTimeout(timeoutId);
  }
}
async function parseError(response) {
  try {
    const data = await response.json();
    return data.detail || `Runtime request failed with ${response.status}.`;
  } catch {
    return `Runtime request failed with ${response.status}.`;
  }
}
async function getRuntimeHealth(baseUrl) {
  const response = await fetchWithTimeout(
    `${normalizeBaseUrl(baseUrl)}/health`,
    void 0,
    8e3
  );
  if (!response.ok) {
    throw new RuntimeRequestError(await parseError(response), "http");
  }
  return await response.json();
}
async function syncContextWithRuntime(baseUrl, payload) {
  const response = await fetchWithTimeout(
    `${normalizeBaseUrl(baseUrl)}/context/sync`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    },
    3e4
  );
  if (!response.ok) {
    throw new RuntimeRequestError(await parseError(response), "http");
  }
  return await response.json();
}
async function indexContextWithRuntime(baseUrl, payload) {
  const response = await fetchWithTimeout(
    `${normalizeBaseUrl(baseUrl)}/context/index`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    },
    6e4
  );
  if (!response.ok) {
    throw new RuntimeRequestError(await parseError(response), "http");
  }
  return await response.json();
}
async function reindexContextWithRuntime(baseUrl, payload) {
  const response = await fetchWithTimeout(
    `${normalizeBaseUrl(baseUrl)}/context/reindex`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    },
    6e4
  );
  if (!response.ok) {
    throw new RuntimeRequestError(await parseError(response), "http");
  }
  return await response.json();
}
async function retrieveContextPathsWithRuntime(baseUrl, payload) {
  const response = await fetchWithTimeout(
    `${normalizeBaseUrl(baseUrl)}/context/retrieve`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    },
    2e4
  );
  if (!response.ok) {
    throw new RuntimeRequestError(await parseError(response), "http");
  }
  return await response.json();
}
async function getContextTablesWithRuntime(baseUrl) {
  const response = await fetchWithTimeout(
    `${normalizeBaseUrl(baseUrl)}/context/tables`,
    void 0,
    2e4
  );
  if (!response.ok) {
    throw new RuntimeRequestError(await parseError(response), "http");
  }
  return await response.json();
}
async function getContextMetaWithRuntime(baseUrl) {
  const response = await fetchWithTimeout(
    `${normalizeBaseUrl(baseUrl)}/context/meta`,
    void 0,
    2e4
  );
  if (!response.ok) {
    throw new RuntimeRequestError(await parseError(response), "http");
  }
  return await response.json();
}
async function streamGenerateWithRuntime(baseUrl, payload, onChunk, signal) {
  const response = await fetchWithTimeout(
    `${normalizeBaseUrl(baseUrl)}/generate-stream`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal
    },
    6e4
  );
  if (!response.ok) {
    throw new RuntimeRequestError(await parseError(response), "http");
  }
  if (!response.body) {
    throw new RuntimeRequestError(
      "Runtime stream response body was empty.",
      "unknown"
    );
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }
      const chunk = JSON.parse(line);
      if (chunk.error) {
        throw new RuntimeRequestError(chunk.error, "http");
      }
      onChunk(chunk);
    }
    if (done) {
      break;
    }
  }
}
async function processQuickEntryWithRuntime(baseUrl, payload) {
  const response = await fetchWithTimeout(
    `${normalizeBaseUrl(baseUrl)}/quick-entry`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    },
    45e3
  );
  if (!response.ok) {
    throw new RuntimeRequestError(await parseError(response), "http");
  }
  return await response.json();
}
async function planNoteActionsWithRuntime(baseUrl, payload) {
  const response = await fetchWithTimeout(
    `${normalizeBaseUrl(baseUrl)}/note-action-plan`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    },
    2e4
  );
  if (!response.ok) {
    throw new RuntimeRequestError(await parseError(response), "http");
  }
  return await response.json();
}
async function planKanbanActionsWithRuntime(baseUrl, payload) {
  const response = await fetchWithTimeout(
    `${normalizeBaseUrl(baseUrl)}/kanban-action-plan`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    },
    2e4
  );
  if (!response.ok) {
    throw new RuntimeRequestError(await parseError(response), "http");
  }
  return await response.json();
}
async function planAgentActionsWithRuntime(baseUrl, payload) {
  const response = await fetchWithTimeout(
    `${normalizeBaseUrl(baseUrl)}/agent-action-plan`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    },
    25e3
  );
  if (!response.ok) {
    throw new RuntimeRequestError(await parseError(response), "http");
  }
  return await response.json();
}

// src/settings.ts
var import_obsidian = require("obsidian");
var DEFAULT_SETTINGS = {
  runtimeUrl: "http://127.0.0.1:8000",
  defaultModel: "mistral:latest"
};
var OllamaSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Ollama Runtime Settings" });
    new import_obsidian.Setting(containerEl).setName("Runtime URL").setDesc("Base URL for the local Python runtime service.").addText(
      (text) => text.setPlaceholder("http://127.0.0.1:8000").setValue(this.plugin.settings.runtimeUrl).onChange(async (value) => {
        this.plugin.settings.runtimeUrl = value.trim() || DEFAULT_SETTINGS.runtimeUrl;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Default model").setDesc("Model name the plugin should use by default.").addText(
      (text) => text.setPlaceholder("mistral:latest").setValue(this.plugin.settings.defaultModel).onChange(async (value) => {
        this.plugin.settings.defaultModel = value.trim() || DEFAULT_SETTINGS.defaultModel;
        await this.plugin.saveSettings();
      })
    );
  }
};

// src/view.ts
var import_obsidian2 = require("obsidian");
var OLLAMA_VIEW_TYPE = "ollama-runtime-view";
var OllamaRuntimeView = class extends import_obsidian2.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.active_stream_controller = null;
    this.active_tab = "chat";
    this.prompt = "";
    this.manual_context_text = "";
    this.note_search_text = "";
    this.reference_picker_open = false;
    this.quick_action_menu_open = false;
    this.active_tool_panel = null;
    this.quick_entry_text = "";
    this.quick_entry_result = null;
    this.vault_action_text = "";
    this.kanban_action_text = "";
    this.agent_action_text = "";
    this.note_action_plan = null;
    this.kanban_action_plan = null;
    this.agent_action_plan = null;
    this.status_text = "Not checked";
    this.status_tone = "neutral";
    this.error_text = "";
    this.context_meta = null;
    this.context_tables = null;
    this.context_tables_loading = false;
    this.is_busy = false;
    this.plugin = plugin;
  }
  getViewType() {
    return OLLAMA_VIEW_TYPE;
  }
  getDisplayText() {
    return "Ollama Runtime";
  }
  async onOpen() {
    this.manual_context_text = this.plugin.getManualContextItems().join("\n");
    this.render();
    await this.refreshHealth();
  }
  async onClose() {
    this.contentEl.empty();
  }
  async refreshFromSettings() {
    this.manual_context_text = this.plugin.getManualContextItems().join("\n");
    this.status_text = "Not checked";
    this.status_tone = "neutral";
    this.error_text = "";
    this.render();
    await this.refreshHealth();
  }
  refreshFromPluginState() {
    this.manual_context_text = this.plugin.getManualContextItems().join("\n");
    this.render();
  }
  render() {
    const active_chat = this.plugin.getActiveChat();
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("ollama-plugin-view");
    const shell = contentEl.createDiv({ cls: "ollama-shell" });
    this.renderWorkspace(shell, active_chat);
  }
  renderWorkspace(container, active_chat) {
    const header = container.createDiv({
      cls: "ollama-shell__workspace-header"
    });
    header.createEl("h2", { text: active_chat?.title ?? "Ollama Runtime" });
    const header_actions = header.createDiv({
      cls: "ollama-shell__workspace-actions"
    });
    this.renderQuickActions(header_actions, active_chat);
    if (this.error_text) {
      container.createDiv({
        cls: "ollama-shell__banner ollama-shell__banner--error",
        text: this.error_text
      });
    }
    const tab_row = container.createDiv({ cls: "ollama-shell__tabs" });
    const tabs = [
      { id: "chat", label: "Chat" },
      { id: "tools", label: "Tools" },
      { id: "context", label: "Context" }
    ];
    for (const tab of tabs) {
      const button = tab_row.createEl("button", {
        text: tab.label,
        cls: `ollama-shell__tab${this.active_tab === tab.id ? " ollama-shell__tab--active" : ""}`
      });
      button.addEventListener("click", () => {
        this.active_tab = tab.id;
        if (tab.id === "context") {
          void this.refreshContextTables();
        }
        this.render();
      });
    }
    const main = container.createDiv({ cls: "ollama-shell__main" });
    if (this.active_tab === "chat") {
      this.renderChatStage(main, active_chat);
      return;
    }
    if (this.active_tab === "tools") {
      this.renderToolsStage(main, active_chat);
      return;
    }
    this.renderContextStage(main);
  }
  renderQuickActions(container, active_chat) {
    const action_row = container.createDiv({ cls: "ollama-shell__actions" });
    const new_chat_button = container.createEl("button", {
      text: "New Chat",
      cls: "mod-cta"
    });
    new_chat_button.disabled = this.is_busy;
    new_chat_button.addEventListener("click", () => {
      void this.plugin.createChatSession();
    });
    const use_active_button = action_row.createEl("button", {
      text: "Use Active Note"
    });
    use_active_button.disabled = this.is_busy || !active_chat;
    use_active_button.addEventListener("click", () => {
      void this.attachActiveFile();
    });
    const reindex_button = action_row.createEl("button", {
      text: "Reindex Vault"
    });
    reindex_button.disabled = this.is_busy;
    reindex_button.addEventListener("click", () => {
      void this.reindexVault();
    });
    const handoff_button = action_row.createEl("button", {
      text: "Chat Handoff"
    });
    handoff_button.disabled = this.is_busy || !active_chat;
    handoff_button.addEventListener("click", () => {
      void this.exportHandoff();
    });
    const health_button = action_row.createEl("button", {
      text: "Check Runtime"
    });
    health_button.disabled = this.is_busy;
    health_button.addEventListener("click", () => {
      void this.refreshHealth();
    });
  }
  renderChatStage(container, active_chat) {
    container.addClass("ollama-shell__chat-stage");
    const chat_header = container.createDiv({
      cls: "ollama-shell__chat-header"
    });
    chat_header.createEl("h3", { text: "Chat Log" });
    const chat_actions = chat_header.createDiv({
      cls: "ollama-shell__actions"
    });
    const add_context_button = chat_actions.createEl("button", {
      text: "Add Context"
    });
    add_context_button.disabled = this.is_busy || !active_chat;
    add_context_button.addEventListener("click", () => {
      this.reference_picker_open = !this.reference_picker_open;
      this.render();
    });
    const new_chat_button = chat_actions.createEl("button", {
      text: "New Chat",
      cls: "mod-cta"
    });
    new_chat_button.disabled = this.is_busy;
    new_chat_button.addEventListener("click", () => {
      void this.plugin.createChatSession();
    });
    if (this.reference_picker_open) {
      this.renderReferencePicker(container, active_chat);
    }
    const transcript = container.createDiv({ cls: "ollama-shell__transcript" });
    this.renderTranscript(transcript, active_chat);
    const composer = container.createDiv({
      cls: "ollama-shell__composer ollama-shell__composer--chat"
    });
    this.renderComposer(composer, active_chat);
  }
  renderToolsStage(container, active_chat) {
    container.addClass("ollama-shell__tools-stage");
    const tools_panel = container.createDiv({ cls: "ollama-shell__panel" });
    tools_panel.createEl("h3", { text: "Management Tools" });
    this.renderChatTools(tools_panel, active_chat);
    const history_panel = container.createDiv({ cls: "ollama-shell__panel" });
    history_panel.createEl("h3", { text: "History" });
    this.renderHistoryTab(history_panel, active_chat);
    const runtime_panel = container.createDiv({ cls: "ollama-shell__panel" });
    runtime_panel.createEl("h3", { text: "Runtime" });
    this.renderRuntimeTab(runtime_panel, active_chat);
  }
  renderContextStage(container) {
    container.addClass("ollama-shell__context-stage");
    this.renderContextTab(container);
  }
  renderHistoryTab(container, active_chat) {
    const table = container.createEl("table", {
      cls: "ollama-shell__history-table"
    });
    const thead = table.createTHead();
    const header_row = thead.insertRow();
    ["Initial prompt", "Chat length", "Date began"].forEach((label) => {
      header_row.createEl("th", { text: label });
    });
    const tbody = table.createTBody();
    for (const chat_session of this.plugin.getSortedChats()) {
      const row = tbody.insertRow();
      row.addClass(
        active_chat?.id === chat_session.id ? "ollama-shell__history-row--active" : "ollama-shell__history-row"
      );
      row.addEventListener("click", () => {
        void this.plugin.setActiveChat(chat_session.id);
      });
      row.insertCell().setText(this.getInitialPrompt(chat_session));
      row.insertCell().setText(`${chat_session.messages.length} messages`);
      row.insertCell().setText(new Date(chat_session.created_at).toLocaleString());
    }
  }
  renderRuntimeTab(container, active_chat) {
    const details = container.createDiv({ cls: "ollama-shell__meta" });
    this.renderMetaRow(details, "Runtime URL", this.plugin.settings.runtimeUrl);
    this.renderMetaRow(
      details,
      "Connection status",
      this.status_text,
      this.status_tone
    );
    this.renderMetaRow(
      details,
      "Effective model",
      this.getEffectiveModel(active_chat)
    );
    this.renderMetaRow(
      details,
      "DB note count",
      `${this.context_meta?.note_count ?? this.plugin.vault_index.markdown_file_count}`
    );
    this.renderMetaRow(
      details,
      "Last indexed",
      this.context_meta?.last_indexed_at ? new Date(Number(this.context_meta.last_indexed_at)).toLocaleString() : "Unknown"
    );
    this.renderMetaRow(
      details,
      "Vault path",
      this.context_meta?.last_vault_path ?? "Not stored"
    );
    this.renderMetaRow(
      details,
      "Database path",
      this.context_meta?.database_path ?? "Unavailable"
    );
    const model_label = container.createEl("label", {
      text: "Model Override",
      cls: "ollama-shell__label"
    });
    const model_input = model_label.createEl("input", {
      cls: "ollama-shell__text-input",
      type: "text"
    });
    model_input.placeholder = this.plugin.settings.defaultModel;
    model_input.value = active_chat?.model_override ?? "";
    model_input.disabled = this.is_busy || !active_chat;
    model_input.addEventListener("change", () => {
      void this.plugin.updateActiveChat({
        model_override: model_input.value.trim()
      });
    });
    const runtime_actions = container.createDiv({
      cls: "ollama-shell__actions"
    });
    const index_button = runtime_actions.createEl("button", {
      text: this.is_busy ? "Indexing..." : "Index Now",
      cls: "mod-cta"
    });
    index_button.disabled = this.is_busy;
    index_button.addEventListener("click", () => {
      void this.runRuntimeReindex();
    });
    const refresh_meta_button = runtime_actions.createEl("button", {
      text: "Refresh Runtime Meta"
    });
    refresh_meta_button.disabled = this.is_busy;
    refresh_meta_button.addEventListener("click", () => {
      void this.refreshRuntimeMeta();
    });
  }
  renderContextTab(container) {
    const overview_section = container.createDiv({
      cls: "ollama-shell__context-section"
    });
    overview_section.createEl("h3", { text: "Current Runtime Context" });
    const overview_grid = overview_section.createDiv({
      cls: "ollama-shell__context-grid"
    });
    this.renderContextStat(
      overview_grid,
      "Effective model",
      this.plugin.getActiveChat()?.model_override.trim() || this.plugin.settings.defaultModel
    );
    this.renderContextStat(
      overview_grid,
      "Indexed notes",
      `${this.context_meta?.note_count ?? this.plugin.vault_index.markdown_file_count}`
    );
    this.renderContextStat(
      overview_grid,
      "Last indexed",
      this.context_meta?.last_indexed_at ? new Date(Number(this.context_meta.last_indexed_at)).toLocaleString() : "Unknown"
    );
    this.renderContextStat(
      overview_grid,
      "Vault path",
      this.context_meta?.last_vault_path ?? "Not stored"
    );
    const generated_section = container.createDiv({
      cls: "ollama-shell__context-section"
    });
    generated_section.createEl("h3", { text: "Vault Notes" });
    generated_section.createEl("p", {
      cls: "ollama-shell__message-meta",
      text: "Generated from indexing. Read-only snapshot of the vault context currently sent to the runtime."
    });
    const summary_block = generated_section.createDiv({
      cls: "ollama-shell__context-block"
    });
    summary_block.createEl("h4", { text: "Vault Summary" });
    summary_block.createEl("pre", {
      cls: "ollama-shell__context-pre",
      text: this.plugin.getVaultSummary()
    });
    const map_block = generated_section.createDiv({
      cls: "ollama-shell__context-block"
    });
    map_block.createEl("h4", { text: "Vault Map" });
    map_block.createEl("pre", {
      cls: "ollama-shell__context-pre ollama-shell__context-pre--map",
      text: JSON.stringify(this.plugin.getVaultMap(), null, 2)
    });
    const folder_section = container.createDiv({
      cls: "ollama-shell__context-section"
    });
    folder_section.createEl("h3", { text: "Folder Intent Map" });
    folder_section.createEl("p", {
      cls: "ollama-shell__message-meta",
      text: "High-level intent summaries built from the indexed vault."
    });
    const top_folders = this.plugin.getVaultMap()?.top_folders ?? [];
    if (!top_folders.length) {
      folder_section.createDiv({
        cls: "ollama-shell__empty-state ollama-shell__empty-state--compact",
        text: "No folder intent data is available yet. Reindex the runtime to populate it."
      });
    } else {
      const folder_grid = folder_section.createDiv({
        cls: "ollama-shell__folder-grid"
      });
      for (const folder of top_folders) {
        const card = folder_grid.createDiv({
          cls: "ollama-shell__folder-card"
        });
        card.createEl("strong", { text: folder.folder });
        card.createEl("div", {
          cls: "ollama-shell__message-meta",
          text: `${folder.note_count} notes`
        });
        if (folder.intent) {
          card.createEl("div", {
            cls: "ollama-shell__folder-intent",
            text: folder.intent
          });
        }
        if (folder.top_topics.length) {
          const chips = card.createDiv({ cls: "ollama-shell__chip-row" });
          for (const topic of folder.top_topics.slice(0, 4)) {
            chips.createEl("span", {
              cls: "ollama-shell__chip",
              text: topic
            });
          }
        }
      }
    }
    const manual_section = container.createDiv({
      cls: "ollama-shell__context-section"
    });
    manual_section.createEl("h3", { text: "Manual Instructions" });
    manual_section.createEl("p", {
      cls: "ollama-shell__message-meta",
      text: "Persistent steering context. One item per line, included with every prompt."
    });
    const manual_block = manual_section.createDiv({
      cls: "ollama-shell__context-block"
    });
    manual_block.createEl("h4", { text: "Instructions" });
    manual_block.createEl("p", {
      cls: "ollama-shell__message-meta",
      text: "Examples: preferred tone, important vault themes, recurring projects, or guidance on how the assistant should summarize."
    });
    const manual_input = manual_block.createEl("textarea", {
      cls: "ollama-shell__input ollama-shell__input--compact"
    });
    manual_input.placeholder = "This vault focuses on job search, product ideas, blog drafts, and weekly priorities.";
    manual_input.value = this.manual_context_text;
    manual_input.disabled = this.is_busy;
    manual_input.addEventListener("input", () => {
      this.manual_context_text = manual_input.value;
    });
    const manual_actions = manual_block.createDiv({
      cls: "ollama-shell__actions"
    });
    const save_button = manual_actions.createEl("button", {
      text: "Save Context",
      cls: "mod-cta"
    });
    save_button.disabled = this.is_busy;
    save_button.addEventListener("click", () => {
      void this.saveManualContext();
    });
    const clear_button = manual_actions.createEl("button", {
      text: "Clear"
    });
    clear_button.disabled = this.is_busy;
    clear_button.addEventListener("click", () => {
      this.manual_context_text = "";
      void this.saveManualContext();
    });
    const tables_section = container.createDiv({
      cls: "ollama-shell__context-section"
    });
    const category_section = container.createDiv({
      cls: "ollama-shell__context-section"
    });
    category_section.createEl("h3", { text: "Category Coverage" });
    category_section.createEl("p", {
      cls: "ollama-shell__message-meta",
      text: "Top runtime categories and their current note membership counts."
    });
    const category_rows = this.context_tables?.categories.filter((row) => row.source === "ai").slice(0, 8) ?? [];
    if (!category_rows.length) {
      category_section.createDiv({
        cls: "ollama-shell__empty-state ollama-shell__empty-state--compact",
        text: "No category data loaded yet. Refresh the SQL tables or reindex the runtime."
      });
    } else {
      const category_grid = category_section.createDiv({
        cls: "ollama-shell__context-grid"
      });
      for (const row of category_rows) {
        const card = category_grid.createDiv({
          cls: "ollama-shell__context-stat ollama-shell__context-stat--category"
        });
        card.createEl("span", {
          cls: "ollama-shell__message-meta",
          text: "Category"
        });
        card.createEl("div", {
          cls: "ollama-shell__context-stat-value",
          text: this.formatSqlCell(row.name)
        });
        card.createEl("div", {
          cls: "ollama-shell__message-meta",
          text: `${this.formatSqlCell(row.count)} notes`
        });
      }
    }
    tables_section.createEl("h3", { text: "SQLite Tables" });
    tables_section.createEl("p", {
      cls: "ollama-shell__message-meta",
      text: "Live snapshots from the runtime database."
    });
    const refresh_button = tables_section.createEl("button", {
      text: this.context_tables_loading ? "Refreshing..." : "Refresh Tables",
      cls: "mod-cta"
    });
    refresh_button.disabled = this.context_tables_loading;
    refresh_button.addEventListener("click", () => {
      void this.refreshContextTables(true);
    });
    const tables = this.context_tables ?? {
      vault_map: [],
      categories: [],
      change_log: [],
      questions: []
    };
    if (this.context_tables_loading && !this.context_tables) {
      tables_section.createDiv({
        cls: "ollama-shell__message-meta",
        text: "Loading SQL tables..."
      });
      return;
    }
    this.renderSqlTable(tables_section, "vault_map", tables.vault_map);
    this.renderSqlTable(tables_section, "categories", tables.categories);
    this.renderSqlTable(tables_section, "change_log", tables.change_log);
    this.renderSqlTable(tables_section, "questions", tables.questions);
  }
  renderSqlTable(container, table_name, rows) {
    const block = container.createDiv({ cls: "ollama-shell__context-block" });
    block.createEl("h4", { text: table_name });
    if (!rows.length) {
      block.createDiv({
        cls: "ollama-shell__message-meta",
        text: "No rows."
      });
      return;
    }
    const keys = Object.keys(rows[0]);
    const wrap = block.createDiv({ cls: "ollama-shell__sql-table-wrap" });
    const table = wrap.createEl("table", { cls: "ollama-shell__sql-table" });
    const thead = table.createTHead();
    const header_row = thead.insertRow();
    for (const key of keys) {
      header_row.createEl("th", { text: key });
    }
    const tbody = table.createTBody();
    for (const row_data of rows) {
      const row = tbody.insertRow();
      for (const key of keys) {
        row.insertCell().setText(this.formatSqlCell(row_data[key]));
      }
    }
  }
  renderContextStat(container, label, value) {
    const card = container.createDiv({ cls: "ollama-shell__context-stat" });
    card.createEl("span", {
      cls: "ollama-shell__message-meta",
      text: label
    });
    card.createEl("div", {
      cls: "ollama-shell__context-stat-value",
      text: value
    });
  }
  renderChatTools(container, active_chat) {
    const tools_header = container.createDiv({
      cls: "ollama-shell__tool-header"
    });
    tools_header.createEl("h3", { text: "Actions" });
    const tools_menu_wrap = tools_header.createDiv({
      cls: "ollama-shell__tool-menu-wrap"
    });
    const tools_toggle = tools_menu_wrap.createEl("button", {
      text: "Open Menu",
      cls: "mod-cta"
    });
    tools_toggle.disabled = this.is_busy;
    tools_toggle.addEventListener("click", () => {
      this.quick_action_menu_open = !this.quick_action_menu_open;
      this.render();
    });
    if (this.quick_action_menu_open) {
      const menu = tools_menu_wrap.createDiv({
        cls: "ollama-shell__tool-menu"
      });
      const items = [
        { id: "quick_entry", label: "Quick Entry" },
        { id: "vault_action", label: "Vault Action Plan" },
        { id: "kanban_action", label: "Kanban Action Plan" },
        { id: "agent_action", label: "Agent Action Plan" }
      ];
      for (const item of items) {
        const button = menu.createEl("button", {
          text: item.label,
          cls: "ollama-shell__tool-menu-item"
        });
        button.disabled = this.is_busy;
        button.addEventListener("click", () => {
          this.active_tool_panel = item.id;
          this.quick_action_menu_open = false;
          this.render();
        });
      }
    }
    if (!this.active_tool_panel) {
      container.createDiv({
        cls: "ollama-shell__empty-state ollama-shell__empty-state--compact",
        text: "Open the actions menu to use quick entry or planning tools."
      });
      return;
    }
    const panel = container.createDiv({ cls: "ollama-shell__tool-panel" });
    const panel_header = panel.createDiv({
      cls: "ollama-shell__tool-panel-head"
    });
    panel_header.createEl("strong", {
      text: this.getToolPanelTitle(this.active_tool_panel)
    });
    const close_button = panel_header.createEl("button", { text: "Close" });
    close_button.disabled = this.is_busy;
    close_button.addEventListener("click", () => {
      this.active_tool_panel = null;
      this.quick_action_menu_open = false;
      this.render();
    });
    switch (this.active_tool_panel) {
      case "quick_entry":
        this.renderQuickEntryPanel(panel, active_chat);
        return;
      case "vault_action":
        this.renderVaultActionPanel(panel, active_chat);
        return;
      case "kanban_action":
        this.renderKanbanActionPanel(panel, active_chat);
        return;
      case "agent_action":
        this.renderAgentActionPanel(panel, active_chat);
        return;
    }
  }
  renderQuickEntryPanel(container, active_chat) {
    const intro = container.createDiv({
      cls: "ollama-shell__quick-entry-intro"
    });
    intro.createEl("strong", { text: "Quick Capture" });
    intro.createEl("div", {
      cls: "ollama-shell__message-meta",
      text: "The runtime places entries using folder intent, category overlap, and vault context."
    });
    const quick_entry_label = container.createEl("label", {
      text: "Capture text",
      cls: "ollama-shell__label"
    });
    const quick_entry_input = quick_entry_label.createEl("textarea", {
      cls: "ollama-shell__input ollama-shell__input--compact"
    });
    quick_entry_input.placeholder = "Drop in rough notes, tasks, ideas, or fragments. The AI will organize them into the vault and log the entry.";
    quick_entry_input.value = this.quick_entry_text;
    quick_entry_input.disabled = this.is_busy;
    quick_entry_input.addEventListener("input", () => {
      this.quick_entry_text = quick_entry_input.value;
    });
    const quick_entry_actions = container.createDiv({
      cls: "ollama-shell__actions"
    });
    const quick_entry_submit = quick_entry_actions.createEl("button", {
      text: this.is_busy ? "Processing..." : "Process Quick Entry",
      cls: "mod-cta"
    });
    quick_entry_submit.disabled = this.is_busy;
    quick_entry_submit.addEventListener("click", () => {
      void this.processQuickEntry(active_chat);
    });
    if (this.quick_entry_result) {
      this.renderQuickEntryResult(container, this.quick_entry_result);
    }
  }
  renderQuickEntryResult(container, result) {
    const block = container.createDiv({
      cls: "ollama-shell__quick-entry-result"
    });
    const confidence = Math.round((result.placement_confidence ?? 1) * 100);
    const tone = (result.placement_confidence ?? 1) >= 0.75 ? "ok" : (result.placement_confidence ?? 1) >= 0.5 ? "warn" : "error";
    const header = block.createDiv({ cls: "ollama-shell__quick-entry-head" });
    header.createEl("strong", { text: "Latest Placement" });
    header.createEl("span", {
      cls: `ollama-shell__status-pill ollama-shell__status-pill--${tone}`,
      text: `${confidence}% confident`
    });
    const grid = block.createDiv({ cls: "ollama-shell__context-grid" });
    this.renderContextStat(
      grid,
      "Target folder",
      result.target_folder || "Needs Home"
    );
    this.renderContextStat(grid, "Note title", result.note_title);
    this.renderContextStat(
      grid,
      "Fallback",
      (result.placement_confidence ?? 1) < 0.75 ? "Needs Home applied" : "Not needed"
    );
    if (result.placement_reason) {
      block.createDiv({
        cls: "ollama-shell__message-meta",
        text: result.placement_reason
      });
    }
    if (result.inferred_categories?.length) {
      const chips = block.createDiv({ cls: "ollama-shell__chip-row" });
      for (const category of result.inferred_categories) {
        chips.createEl("span", {
          cls: "ollama-shell__chip",
          text: category
        });
      }
    }
  }
  renderVaultActionPanel(container, active_chat) {
    const vault_action_label = container.createEl("label", {
      text: "Requested vault change",
      cls: "ollama-shell__label"
    });
    const vault_action_input = vault_action_label.createEl("textarea", {
      cls: "ollama-shell__input ollama-shell__input--compact"
    });
    vault_action_input.placeholder = "Describe the note changes you want. Example: create a project note in Projects and update my daily note with today's priorities.";
    vault_action_input.value = this.vault_action_text;
    vault_action_input.disabled = this.is_busy;
    vault_action_input.addEventListener("input", () => {
      this.vault_action_text = vault_action_input.value;
    });
    const vault_action_actions = container.createDiv({
      cls: "ollama-shell__actions"
    });
    const plan_button = vault_action_actions.createEl("button", {
      text: this.is_busy ? "Planning..." : "Generate Plan",
      cls: "mod-cta"
    });
    plan_button.disabled = this.is_busy;
    plan_button.addEventListener("click", () => {
      void this.generateNoteActionPlan(active_chat);
    });
    if (this.note_action_plan) {
      this.renderNoteActionPlan(container, this.note_action_plan);
    }
  }
  renderKanbanActionPanel(container, active_chat) {
    const kanban_action_label = container.createEl("label", {
      text: "Requested Kanban change",
      cls: "ollama-shell__label"
    });
    const kanban_action_input = kanban_action_label.createEl("textarea", {
      cls: "ollama-shell__input ollama-shell__input--compact"
    });
    kanban_action_input.placeholder = "Describe the board change you want. Example: move 'Draft outline' from Backlog to Doing in Boards/Website.md.";
    kanban_action_input.value = this.kanban_action_text;
    kanban_action_input.disabled = this.is_busy;
    kanban_action_input.addEventListener("input", () => {
      this.kanban_action_text = kanban_action_input.value;
    });
    container.createDiv({
      cls: `ollama-shell__message-meta${active_chat?.referenced_file_paths.length ? "" : " ollama-shell__message-meta--warn"}`,
      text: "Attach one or more Kanban board notes in Referenced Files before generating this plan."
    });
    const kanban_action_actions = container.createDiv({
      cls: "ollama-shell__actions"
    });
    const kanban_plan_button = kanban_action_actions.createEl("button", {
      text: this.is_busy ? "Planning..." : "Generate Kanban Plan",
      cls: "mod-cta"
    });
    kanban_plan_button.disabled = this.is_busy;
    kanban_plan_button.addEventListener("click", () => {
      void this.generateKanbanActionPlan(active_chat);
    });
    if (this.kanban_action_plan) {
      this.renderKanbanActionPlan(container, this.kanban_action_plan);
    }
  }
  renderAgentActionPanel(container, active_chat) {
    const agent_action_label = container.createEl("label", {
      text: "Requested agent change",
      cls: "ollama-shell__label"
    });
    const agent_action_input = agent_action_label.createEl("textarea", {
      cls: "ollama-shell__input ollama-shell__input--compact"
    });
    agent_action_input.placeholder = "Describe a mixed workflow. Example: create a project note in Projects and move 'Draft outline' from Backlog to Doing in the attached Kanban board.";
    agent_action_input.value = this.agent_action_text;
    agent_action_input.disabled = this.is_busy;
    agent_action_input.addEventListener("input", () => {
      this.agent_action_text = agent_action_input.value;
    });
    container.createDiv({
      cls: "ollama-shell__message-meta",
      text: "This broader planner can return a mix of note actions and Kanban actions in one approved plan."
    });
    const agent_action_actions = container.createDiv({
      cls: "ollama-shell__actions"
    });
    const agent_plan_button = agent_action_actions.createEl("button", {
      text: this.is_busy ? "Planning..." : "Generate Agent Plan",
      cls: "mod-cta"
    });
    agent_plan_button.disabled = this.is_busy;
    agent_plan_button.addEventListener("click", () => {
      void this.generateAgentActionPlan(active_chat);
    });
    if (this.agent_action_plan) {
      this.renderAgentActionPlan(container, this.agent_action_plan);
    }
  }
  getToolPanelTitle(tool) {
    switch (tool) {
      case "quick_entry":
        return "Quick Entry";
      case "vault_action":
        return "Vault Action Plan";
      case "kanban_action":
        return "Kanban Action Plan";
      case "agent_action":
        return "Agent Action Plan";
    }
  }
  renderReferencePicker(container, active_chat) {
    const overlay = container.createDiv({
      cls: "ollama-shell__reference-overlay"
    });
    const card = overlay.createDiv({ cls: "ollama-shell__reference-dialog" });
    const header = card.createDiv({
      cls: "ollama-shell__reference-dialog-head"
    });
    header.createEl("strong", { text: "Referenced Files" });
    const close_button = header.createEl("button", { text: "Close" });
    close_button.addEventListener("click", () => {
      this.reference_picker_open = false;
      this.note_search_text = "";
      this.render();
    });
    const selected_files = card.createDiv({
      cls: "ollama-shell__reference-list"
    });
    if (!(active_chat?.referenced_file_paths.length ?? 0)) {
      selected_files.createDiv({
        cls: "ollama-shell__message-meta",
        text: "No reference files attached yet."
      });
    }
    for (const path of active_chat?.referenced_file_paths ?? []) {
      const chip = selected_files.createDiv({
        cls: "ollama-shell__reference-chip"
      });
      chip.createSpan({ text: path });
      const remove_button = chip.createEl("button", { text: "Remove" });
      remove_button.disabled = this.is_busy || !active_chat;
      remove_button.addEventListener("click", () => {
        void this.removeReferencedFile(path);
      });
    }
    const reference_search = card.createEl("input", {
      cls: "ollama-shell__text-input",
      type: "text"
    });
    reference_search.placeholder = "Search vault notes to add context...";
    reference_search.value = this.note_search_text;
    reference_search.disabled = this.is_busy || !active_chat;
    reference_search.addEventListener("input", () => {
      this.note_search_text = reference_search.value;
      this.render();
    });
    const quick_actions = card.createDiv({ cls: "ollama-shell__actions" });
    const use_active_button = quick_actions.createEl("button", {
      text: "Use Active Note"
    });
    use_active_button.disabled = this.is_busy || !active_chat;
    use_active_button.addEventListener("click", () => {
      void this.attachActiveFile();
    });
    if (this.note_search_text.trim()) {
      const matches = this.getReferenceMatches(
        this.note_search_text,
        active_chat?.referenced_file_paths ?? []
      );
      const results = card.createDiv({
        cls: "ollama-shell__reference-results"
      });
      if (!matches.length) {
        results.createDiv({
          cls: "ollama-shell__message-meta",
          text: "No matching notes."
        });
      }
      for (const path of matches) {
        const result = results.createEl("button", {
          cls: "ollama-shell__reference-result",
          text: path
        });
        result.disabled = this.is_busy || !active_chat;
        result.addEventListener("click", () => {
          void this.addReferencedFile(path);
        });
      }
    }
  }
  renderTranscript(container, active_chat) {
    if (!active_chat || !active_chat.messages.length) {
      container.createDiv({
        cls: "ollama-shell__empty-state",
        text: "Start a fresh chat, reference vault notes if needed, and send the first prompt."
      });
      return;
    }
    for (const message of active_chat.messages) {
      const message_block = container.createDiv({
        cls: `ollama-shell__message ollama-shell__message--${message.role}`
      });
      message_block.createEl("div", {
        cls: "ollama-shell__message-role",
        text: message.role === "user" ? "You" : "Assistant"
      });
      message_block.createEl("div", {
        cls: "ollama-shell__message-body",
        text: message.content
      });
      if (message.referenced_file_paths.length) {
        message_block.createEl("div", {
          cls: "ollama-shell__message-meta",
          text: `Context: ${message.referenced_file_paths.join(", ")}`
        });
      }
    }
  }
  renderComposer(container, active_chat) {
    const prompt_label = container.createEl("label", {
      text: "Prompt",
      cls: "ollama-shell__label"
    });
    const textarea = prompt_label.createEl("textarea", {
      cls: "ollama-shell__input"
    });
    textarea.placeholder = "Ask the runtime something about your vault, a note, or the current task...";
    textarea.value = this.prompt;
    textarea.disabled = this.is_busy || !active_chat;
    textarea.addEventListener("input", () => {
      this.prompt = textarea.value;
    });
    const composer_actions = container.createDiv({
      cls: "ollama-shell__composer-actions"
    });
    const reference_button = composer_actions.createEl("button", {
      text: "@+",
      cls: "ollama-shell__attach-button"
    });
    reference_button.disabled = this.is_busy || !active_chat;
    reference_button.addEventListener("click", () => {
      this.active_tab = "chat";
      this.reference_picker_open = !this.reference_picker_open;
      if (!this.reference_picker_open) {
        this.note_search_text = "";
      }
      this.render();
    });
    const send_group = composer_actions.createDiv({
      cls: "ollama-shell__composer-send"
    });
    if (this.is_busy) {
      const indicator = send_group.createDiv({
        cls: "ollama-shell__thinking"
      });
      indicator.createSpan({ cls: "ollama-shell__thinking-dot" });
      indicator.createSpan({ text: "Thinking..." });
    }
    const generate_button = send_group.createEl("button", {
      text: this.is_busy ? "Generating..." : "Send",
      cls: "mod-cta"
    });
    generate_button.disabled = this.is_busy || !active_chat;
    generate_button.addEventListener("click", () => {
      void this.generateResponse();
    });
    if (this.is_busy && this.active_stream_controller) {
      const cancel_button = send_group.createEl("button", {
        text: "Cancel"
      });
      cancel_button.addEventListener("click", () => {
        this.cancelActiveRequest();
      });
    }
  }
  renderMetaRow(container, label, value, tone = "neutral") {
    const row = container.createDiv({
      cls: `ollama-shell__status ollama-shell__status--${tone}`
    });
    row.createSpan({ text: label });
    row.createEl("code", { text: value });
  }
  getEffectiveModel(active_chat) {
    return active_chat?.model_override.trim() || this.plugin.settings.defaultModel;
  }
  getInitialPrompt(chat_session) {
    const first_user_message = chat_session.messages.find(
      (message) => message.role === "user"
    );
    if (!first_user_message) {
      return "No prompt yet";
    }
    return first_user_message.content.replace(/\s+/g, " ").trim().slice(0, 64);
  }
  parseReferencedPaths(value) {
    return [
      ...new Set(
        value.split(",").map((path) => path.trim()).filter(Boolean)
      )
    ];
  }
  getReferenceMatches(query, selected_paths) {
    const normalized_query = query.trim().toLowerCase();
    if (!normalized_query) {
      return [];
    }
    return this.plugin.vault_index.file_paths.filter((path) => !selected_paths.includes(path)).filter((path) => path.toLowerCase().includes(normalized_query)).slice(0, 8);
  }
  async addReferencedFile(path) {
    const active_chat = this.plugin.getActiveChat();
    if (!active_chat) {
      return;
    }
    const referenced_file_paths = [
      .../* @__PURE__ */ new Set([...active_chat.referenced_file_paths, path])
    ];
    this.note_search_text = "";
    await this.plugin.updateActiveChat({ referenced_file_paths });
  }
  async removeReferencedFile(path) {
    const active_chat = this.plugin.getActiveChat();
    if (!active_chat) {
      return;
    }
    const referenced_file_paths = active_chat.referenced_file_paths.filter(
      (file_path) => file_path !== path
    );
    await this.plugin.updateActiveChat({ referenced_file_paths });
  }
  async attachActiveFile() {
    const active_chat = this.plugin.getActiveChat();
    const active_file_path = this.plugin.getActiveFilePath();
    if (!active_chat) {
      return;
    }
    if (!active_file_path) {
      new import_obsidian2.Notice("Open a note first if you want to attach the active file.");
      return;
    }
    const referenced_file_paths = [
      .../* @__PURE__ */ new Set([...active_chat.referenced_file_paths, active_file_path])
    ];
    await this.plugin.updateActiveChat({ referenced_file_paths });
  }
  async reindexVault() {
    this.is_busy = true;
    this.error_text = "";
    this.render();
    try {
      await this.plugin.reindexVault();
      new import_obsidian2.Notice("Vault index refreshed.");
    } finally {
      this.is_busy = false;
      this.render();
    }
  }
  async exportHandoff() {
    try {
      const file = await this.plugin.exportActiveChatHandoff();
      if (file) {
        new import_obsidian2.Notice(`Chat handoff saved to ${file.path}`);
      }
    } catch (error) {
      new import_obsidian2.Notice(this.getErrorMessage(error));
    }
  }
  async refreshHealth() {
    this.is_busy = true;
    this.status_text = "Checking...";
    this.status_tone = "neutral";
    this.error_text = "";
    this.render();
    try {
      const health = await getRuntimeHealth(this.plugin.settings.runtimeUrl);
      if (health.ollama_reachable) {
        this.status_text = "Connected";
        this.status_tone = "ok";
      } else {
        this.status_text = "Runtime up, Ollama unavailable";
        this.status_tone = "warn";
        this.error_text = "The runtime is reachable, but the Ollama daemon or model service is unavailable.";
      }
      await this.refreshRuntimeMeta(false);
    } catch (error) {
      this.status_text = "Offline";
      this.status_tone = "error";
      this.error_text = this.getErrorMessage(error);
      new import_obsidian2.Notice(this.getErrorMessage(error));
    } finally {
      this.is_busy = false;
      this.render();
    }
  }
  async processQuickEntry(active_chat) {
    const model = this.getEffectiveModel(active_chat);
    if (!this.quick_entry_text.trim()) {
      new import_obsidian2.Notice("Enter some quick entry text first.");
      return;
    }
    this.is_busy = true;
    this.error_text = "";
    this.status_text = "Processing quick entry...";
    this.status_tone = "neutral";
    this.render();
    try {
      const result = await this.plugin.processQuickEntry(
        this.quick_entry_text.trim(),
        model
      );
      this.quick_entry_result = result.plan;
      this.quick_entry_text = "";
      this.status_text = "Connected";
      this.status_tone = "ok";
      new import_obsidian2.Notice(
        `Quick entry saved to ${result.note_file.path} and logged in ${result.log_file.path}. Placement confidence: ${Math.round((result.plan.placement_confidence ?? 1) * 100)}%.`
      );
      if ((result.plan.placement_confidence ?? 1) < 0.75) {
        new import_obsidian2.Notice(
          result.plan.placement_reason || "Quick entry routed to Needs Home."
        );
      }
      await this.plugin.reindexVault();
    } catch (error) {
      this.quick_entry_result = null;
      this.status_text = "Quick entry failed";
      this.status_tone = "error";
      this.error_text = this.getErrorMessage(error);
      new import_obsidian2.Notice(this.getErrorMessage(error));
    } finally {
      this.is_busy = false;
      this.render();
    }
  }
  renderNoteActionPlan(container, plan) {
    const preview = container.createDiv({ cls: "ollama-shell__plan" });
    preview.createEl("div", {
      cls: "ollama-shell__plan-summary",
      text: plan.summary
    });
    for (const operation of plan.operations) {
      const item = preview.createDiv({ cls: "ollama-shell__plan-item" });
      item.createEl("strong", {
        text: `${operation.action.toUpperCase()} ${operation.path}`
      });
      item.createEl("div", {
        cls: "ollama-shell__message-meta",
        text: operation.summary
      });
    }
    const actions = preview.createDiv({ cls: "ollama-shell__actions" });
    const apply_button = actions.createEl("button", {
      text: "Apply Plan",
      cls: "mod-cta"
    });
    apply_button.disabled = this.is_busy;
    apply_button.addEventListener("click", () => {
      void this.applyNoteActionPlan();
    });
    const clear_button = actions.createEl("button", {
      text: "Clear Plan"
    });
    clear_button.disabled = this.is_busy;
    clear_button.addEventListener("click", () => {
      this.note_action_plan = null;
      this.render();
    });
  }
  async generateNoteActionPlan(active_chat) {
    if (!this.vault_action_text.trim()) {
      new import_obsidian2.Notice("Describe the vault change before generating a plan.");
      return;
    }
    this.is_busy = true;
    this.error_text = "";
    this.status_text = "Planning vault action...";
    this.status_tone = "neutral";
    this.render();
    try {
      this.note_action_plan = await this.plugin.planNoteActions(
        this.vault_action_text.trim(),
        this.getEffectiveModel(active_chat),
        active_chat?.referenced_file_paths ?? []
      );
      this.status_text = "Connected";
      this.status_tone = "ok";
    } catch (error) {
      this.status_text = "Plan failed";
      this.status_tone = "error";
      this.error_text = this.getErrorMessage(error);
      new import_obsidian2.Notice(this.getErrorMessage(error));
    } finally {
      this.is_busy = false;
      this.render();
    }
  }
  async applyNoteActionPlan() {
    if (!this.note_action_plan) {
      return;
    }
    this.is_busy = true;
    this.error_text = "";
    this.status_text = "Applying vault action...";
    this.status_tone = "neutral";
    this.render();
    try {
      const touched_files = await this.plugin.applyNoteActionPlan(
        this.note_action_plan
      );
      this.note_action_plan = null;
      this.vault_action_text = "";
      this.status_text = "Connected";
      this.status_tone = "ok";
      new import_obsidian2.Notice(`Applied vault plan to ${touched_files.length} file(s).`);
    } catch (error) {
      this.status_text = "Apply failed";
      this.status_tone = "error";
      this.error_text = this.getErrorMessage(error);
      new import_obsidian2.Notice(this.getErrorMessage(error));
    } finally {
      this.is_busy = false;
      this.render();
    }
  }
  renderKanbanActionPlan(container, plan) {
    const preview = container.createDiv({ cls: "ollama-shell__plan" });
    preview.createEl("div", {
      cls: "ollama-shell__plan-summary",
      text: plan.summary
    });
    for (const operation of plan.operations) {
      const item = preview.createDiv({ cls: "ollama-shell__plan-item" });
      const action_label = operation.action.replace(/_/g, " ").toUpperCase();
      const lane_summary = operation.action === "move_card" ? `${operation.source_lane_title} -> ${operation.target_lane_title}` : operation.action === "create_card" ? `Lane: ${operation.target_lane_title}` : `Lane: ${operation.source_lane_title}`;
      item.createEl("strong", {
        text: `${action_label} ${operation.card_title} @ ${operation.board_path}`
      });
      item.createEl("div", {
        cls: "ollama-shell__message-meta",
        text: lane_summary
      });
      item.createEl("div", {
        cls: "ollama-shell__message-meta",
        text: operation.summary
      });
    }
    const actions = preview.createDiv({ cls: "ollama-shell__actions" });
    const apply_button = actions.createEl("button", {
      text: "Apply Kanban Plan",
      cls: "mod-cta"
    });
    apply_button.disabled = this.is_busy;
    apply_button.addEventListener("click", () => {
      void this.applyKanbanActionPlan();
    });
    const clear_button = actions.createEl("button", {
      text: "Clear Plan"
    });
    clear_button.disabled = this.is_busy;
    clear_button.addEventListener("click", () => {
      this.kanban_action_plan = null;
      this.render();
    });
  }
  async generateKanbanActionPlan(active_chat) {
    if (!this.kanban_action_text.trim()) {
      new import_obsidian2.Notice("Describe the Kanban change before generating a plan.");
      return;
    }
    this.is_busy = true;
    this.error_text = "";
    this.status_text = "Planning Kanban action...";
    this.status_tone = "neutral";
    this.render();
    try {
      this.kanban_action_plan = await this.plugin.planKanbanActions(
        this.kanban_action_text.trim(),
        this.getEffectiveModel(active_chat),
        active_chat?.referenced_file_paths ?? []
      );
      this.status_text = "Connected";
      this.status_tone = "ok";
    } catch (error) {
      this.status_text = "Kanban plan failed";
      this.status_tone = "error";
      this.error_text = this.getErrorMessage(error);
      new import_obsidian2.Notice(this.getErrorMessage(error));
    } finally {
      this.is_busy = false;
      this.render();
    }
  }
  async applyKanbanActionPlan() {
    if (!this.kanban_action_plan) {
      return;
    }
    this.is_busy = true;
    this.error_text = "";
    this.status_text = "Applying Kanban action...";
    this.status_tone = "neutral";
    this.render();
    try {
      const touched_files = await this.plugin.applyKanbanActionPlan(
        this.kanban_action_plan
      );
      this.kanban_action_plan = null;
      this.kanban_action_text = "";
      this.status_text = "Connected";
      this.status_tone = "ok";
      new import_obsidian2.Notice(
        `Applied Kanban plan to ${touched_files.length} board file(s).`
      );
    } catch (error) {
      this.status_text = "Kanban apply failed";
      this.status_tone = "error";
      this.error_text = this.getErrorMessage(error);
      new import_obsidian2.Notice(this.getErrorMessage(error));
    } finally {
      this.is_busy = false;
      this.render();
    }
  }
  renderAgentActionPlan(container, plan) {
    const preview = container.createDiv({ cls: "ollama-shell__plan" });
    preview.createEl("div", {
      cls: "ollama-shell__plan-summary",
      text: plan.summary
    });
    for (const action of plan.actions) {
      const item = preview.createDiv({ cls: "ollama-shell__plan-item" });
      item.createEl("strong", {
        text: this.getAgentActionTitle(action)
      });
      item.createEl("div", {
        cls: "ollama-shell__message-meta",
        text: action.summary
      });
    }
    const actions = preview.createDiv({ cls: "ollama-shell__actions" });
    const apply_button = actions.createEl("button", {
      text: "Apply Agent Plan",
      cls: "mod-cta"
    });
    apply_button.disabled = this.is_busy;
    apply_button.addEventListener("click", () => {
      void this.applyAgentActionPlan();
    });
    const clear_button = actions.createEl("button", {
      text: "Clear Plan"
    });
    clear_button.disabled = this.is_busy;
    clear_button.addEventListener("click", () => {
      this.agent_action_plan = null;
      this.render();
    });
  }
  getAgentActionTitle(action) {
    switch (action.type) {
      case "note_create":
      case "note_update":
        return `${action.type.replace("_", " ").toUpperCase()} ${action.path}`;
      case "kanban_card_create":
      case "kanban_card_move":
      case "kanban_card_update":
        return `${action.type.replace(/_/g, " ").toUpperCase()} ${action.card_title} @ ${action.board_path}`;
    }
  }
  async generateAgentActionPlan(active_chat) {
    if (!this.agent_action_text.trim()) {
      new import_obsidian2.Notice("Describe the agent change before generating a plan.");
      return;
    }
    this.is_busy = true;
    this.error_text = "";
    this.status_text = "Planning agent action...";
    this.status_tone = "neutral";
    this.render();
    try {
      this.agent_action_plan = await this.plugin.planAgentActions(
        this.agent_action_text.trim(),
        this.getEffectiveModel(active_chat),
        active_chat?.referenced_file_paths ?? []
      );
      this.status_text = "Connected";
      this.status_tone = "ok";
    } catch (error) {
      this.status_text = "Agent plan failed";
      this.status_tone = "error";
      this.error_text = this.getErrorMessage(error);
      new import_obsidian2.Notice(this.getErrorMessage(error));
    } finally {
      this.is_busy = false;
      this.render();
    }
  }
  async applyAgentActionPlan() {
    if (!this.agent_action_plan) {
      return;
    }
    this.is_busy = true;
    this.error_text = "";
    this.status_text = "Applying agent action...";
    this.status_tone = "neutral";
    this.render();
    try {
      const touched_files = await this.plugin.applyAgentActionPlan(
        this.agent_action_plan
      );
      this.agent_action_plan = null;
      this.agent_action_text = "";
      this.status_text = "Connected";
      this.status_tone = "ok";
      new import_obsidian2.Notice(`Applied agent plan to ${touched_files.length} file(s).`);
    } catch (error) {
      this.status_text = "Agent apply failed";
      this.status_tone = "error";
      this.error_text = this.getErrorMessage(error);
      new import_obsidian2.Notice(this.getErrorMessage(error));
    } finally {
      this.is_busy = false;
      this.render();
    }
  }
  async generateResponse() {
    const active_chat = this.plugin.getActiveChat();
    if (!active_chat) {
      new import_obsidian2.Notice("Create a chat before sending a prompt.");
      return;
    }
    if (!this.prompt.trim()) {
      new import_obsidian2.Notice("Enter a prompt before generating.");
      return;
    }
    this.is_busy = true;
    this.error_text = "";
    this.status_text = "Generating...";
    this.status_tone = "neutral";
    const user_prompt = this.prompt.trim();
    const model = this.getEffectiveModel(active_chat);
    let assistant_message_id = "";
    this.active_stream_controller = new AbortController();
    try {
      const referenced_notes = await this.plugin.loadContextNotesForPrompt(
        user_prompt,
        active_chat.referenced_file_paths
      );
      const request_prompt = build_chat_prompt({
        prompt: user_prompt,
        history: active_chat.messages,
        referenced_notes,
        vault_summary: this.plugin.getVaultSummary(),
        vault_map: this.plugin.getVaultMap(),
        manual_context_items: this.plugin.getManualContextItems()
      });
      await this.plugin.appendMessage(
        "user",
        user_prompt,
        model,
        referenced_notes.map((note) => note.path)
      );
      const assistant_message = await this.plugin.appendMessage(
        "assistant",
        "",
        model,
        referenced_notes.map((note) => note.path)
      );
      assistant_message_id = assistant_message?.id ?? "";
      this.prompt = "";
      this.render();
      let assistant_response = "";
      await streamGenerateWithRuntime(
        this.plugin.settings.runtimeUrl,
        {
          prompt: request_prompt,
          model
        },
        (chunk) => {
          assistant_response += chunk.response;
          if (assistant_message) {
            this.plugin.updateMessageContent(
              assistant_message.id,
              assistant_response,
              false
            );
          }
        },
        this.active_stream_controller.signal
      );
      if (assistant_message) {
        this.plugin.updateMessageContent(
          assistant_message.id,
          assistant_response.trim(),
          true
        );
      }
      this.status_text = "Connected";
      this.status_tone = "ok";
    } catch (error) {
      if (assistant_message_id && !(error instanceof RuntimeRequestError && error.code === "cancelled")) {
        this.plugin.updateMessageContent(
          assistant_message_id,
          "[Response interrupted]",
          true
        );
      }
      if (error instanceof RuntimeRequestError && error.code === "cancelled") {
        if (assistant_message_id) {
          this.plugin.updateMessageContent(
            assistant_message_id,
            "[Generation cancelled]",
            true
          );
        }
        this.status_text = "Cancelled";
        this.status_tone = "warn";
        this.error_text = "";
      } else {
        this.status_text = "Request failed";
        this.status_tone = "error";
        this.error_text = this.getErrorMessage(error);
        new import_obsidian2.Notice(this.getErrorMessage(error));
      }
    } finally {
      this.active_stream_controller = null;
      this.is_busy = false;
      this.render();
    }
  }
  cancelActiveRequest() {
    this.active_stream_controller?.abort();
  }
  async saveManualContext() {
    await this.plugin.updateManualContextItems(
      this.manual_context_text.split("\n")
    );
    this.manual_context_text = this.plugin.getManualContextItems().join("\n");
    new import_obsidian2.Notice("Context updated.");
  }
  async runRuntimeReindex() {
    this.is_busy = true;
    this.error_text = "";
    this.status_text = "Indexing runtime...";
    this.status_tone = "neutral";
    this.render();
    try {
      await this.plugin.requestRuntimeReindex();
      await this.refreshRuntimeMeta(false);
      this.status_text = "Connected";
      this.status_tone = "ok";
      new import_obsidian2.Notice("Runtime reindex completed.");
    } catch (error) {
      this.status_text = "Runtime index failed";
      this.status_tone = "error";
      this.error_text = this.getErrorMessage(error);
      new import_obsidian2.Notice(this.getErrorMessage(error));
    } finally {
      this.is_busy = false;
      this.render();
    }
  }
  async refreshContextTables(force = false) {
    if (this.context_tables_loading || !force && this.context_tables) {
      return;
    }
    this.context_tables_loading = true;
    this.render();
    try {
      this.context_tables = await getContextTablesWithRuntime(
        this.plugin.settings.runtimeUrl
      );
    } catch (error) {
      this.context_tables = null;
      new import_obsidian2.Notice(this.getErrorMessage(error));
    } finally {
      this.context_tables_loading = false;
      this.render();
    }
  }
  async refreshRuntimeMeta(should_render = true) {
    try {
      this.context_meta = await getContextMetaWithRuntime(
        this.plugin.settings.runtimeUrl
      );
    } catch {
      this.context_meta = null;
    } finally {
      if (should_render) {
        this.render();
      }
    }
  }
  formatSqlCell(value) {
    if (value === null || value === void 0) {
      return "";
    }
    return typeof value === "string" ? value : JSON.stringify(value);
  }
  getErrorMessage(error) {
    if (error instanceof RuntimeRequestError) {
      return error.message;
    }
    if (error instanceof Error) {
      return error.message;
    }
    return "Unknown runtime error.";
  }
};

// src/main.ts
var _OllamaRuntimePlugin = class _OllamaRuntimePlugin extends import_obsidian3.Plugin {
  constructor() {
    super(...arguments);
    this.chat_sessions = [];
    this.active_chat_id = "";
    this.vault_index = EMPTY_VAULT_INDEX;
    this.manual_context_items = [];
    this.reindex_timer = null;
    this.reindex_in_flight = false;
    this.reindex_pending = false;
  }
  async onload() {
    await this.loadSettings();
    try {
      await this.reindexVault(false);
    } catch (error) {
      console.warn(
        "[ollama-runtime-plugin] Initial reindex failed during startup:",
        error
      );
    }
    this.registerVaultIndexHooks();
    this.registerView(
      OLLAMA_VIEW_TYPE,
      (leaf) => new OllamaRuntimeView(leaf, this)
    );
    this.addRibbonIcon("bot", "Open Ollama Runtime", async () => {
      await this.activateView();
    });
    this.addCommand({
      id: "open-ollama-runtime-view",
      name: "Open Ollama Runtime",
      callback: async () => {
        await this.activateView();
      }
    });
    this.addSettingTab(new OllamaSettingTab(this.app, this));
  }
  async onunload() {
    this.clearScheduledReindex();
    await this.app.workspace.detachLeavesOfType(OLLAMA_VIEW_TYPE);
  }
  async loadSettings() {
    const raw_data = await this.loadData() ?? {};
    const legacy_settings = this.extractLegacySettings(raw_data);
    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      legacy_settings,
      raw_data.settings ?? {}
    );
    this.chat_sessions = raw_data.chat_sessions ?? [];
    this.active_chat_id = raw_data.active_chat_id ?? "";
    this.manual_context_items = raw_data.manual_context_items ?? [];
    this.vault_index = {
      ...EMPTY_VAULT_INDEX,
      ...raw_data.vault_index ?? {}
    };
    if (!this.chat_sessions.length) {
      const chat_session = create_chat_session();
      this.chat_sessions = [chat_session];
      this.active_chat_id = chat_session.id;
      await this.savePluginState(false);
      return;
    }
    if (!this.getActiveChat()) {
      this.active_chat_id = this.chat_sessions[0].id;
    }
  }
  async saveSettings() {
    await this.savePluginState(true);
  }
  async activateView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(OLLAMA_VIEW_TYPE)[0] ?? null;
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      await leaf?.setViewState({ type: OLLAMA_VIEW_TYPE, active: true });
    }
    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }
  refreshOpenViews(check_health = false) {
    const leaves = this.app.workspace.getLeavesOfType(OLLAMA_VIEW_TYPE);
    for (const leaf of leaves) {
      const view = leaf.view;
      if (view instanceof OllamaRuntimeView) {
        if (check_health) {
          void view.refreshFromSettings();
        } else {
          view.refreshFromPluginState();
        }
      }
    }
  }
  getActiveChat() {
    return this.chat_sessions.find(
      (chat_session) => chat_session.id === this.active_chat_id
    ) ?? null;
  }
  getSortedChats() {
    return [...this.chat_sessions].sort(
      (left, right) => right.updated_at - left.updated_at
    );
  }
  async createChatSession() {
    const chat_session = create_chat_session();
    this.chat_sessions = [chat_session, ...this.chat_sessions];
    this.active_chat_id = chat_session.id;
    await this.savePluginState();
  }
  async setActiveChat(chat_id) {
    if (chat_id === this.active_chat_id) {
      return;
    }
    this.active_chat_id = chat_id;
    await this.savePluginState();
  }
  async updateActiveChat(values) {
    const chat_session = this.getActiveChat();
    if (!chat_session) {
      return;
    }
    Object.assign(chat_session, values, { updated_at: Date.now() });
    await this.savePluginState();
  }
  async appendMessage(role, content, model, referenced_file_paths) {
    const chat_session = this.getActiveChat();
    if (!chat_session) {
      return null;
    }
    const message = {
      id: create_id(role),
      role,
      content,
      created_at: Date.now(),
      model,
      referenced_file_paths
    };
    if (!chat_session.messages.length && role === "user") {
      chat_session.title = build_chat_title(content);
    }
    chat_session.messages = [...chat_session.messages, message];
    chat_session.updated_at = Date.now();
    await this.savePluginState();
    return message;
  }
  updateMessageContent(message_id, content, persist = false) {
    const chat_session = this.getActiveChat();
    if (!chat_session) {
      return;
    }
    chat_session.messages = chat_session.messages.map(
      (message) => message.id === message_id ? { ...message, content } : message
    );
    chat_session.updated_at = Date.now();
    if (persist) {
      void this.savePluginState();
      return;
    }
    this.refreshOpenViews();
  }
  async reindexVault(should_refresh = true) {
    if (this.reindex_in_flight) {
      this.reindex_pending = true;
      return;
    }
    this.reindex_in_flight = true;
    try {
      const indexed_at = Date.now();
      const runtime_index = await this.buildVaultIndexFromRuntime(indexed_at);
      this.vault_index = runtime_index;
      await this.savePluginState(false, should_refresh);
    } finally {
      this.reindex_in_flight = false;
      if (this.reindex_pending) {
        this.reindex_pending = false;
        void this.reindexVault(should_refresh);
      }
    }
  }
  getReferencedFiles(file_paths) {
    return file_paths.map((file_path) => this.app.vault.getAbstractFileByPath(file_path)).filter((file) => file instanceof import_obsidian3.TFile);
  }
  async loadReferencedNotes(file_paths) {
    const unique_paths = [
      ...new Set(file_paths.map((path) => path.trim()).filter(Boolean))
    ];
    const files = this.getReferencedFiles(unique_paths);
    return Promise.all(
      files.map(async (file) => {
        const markdown = await this.app.vault.cachedRead(file);
        const kanban_enriched = build_kanban_context(file.path, markdown);
        const graph_summary = this.getGraphSummary(file);
        return {
          path: file.path,
          content: build_graph_context(
            file.path,
            kanban_enriched,
            graph_summary
          )
        };
      })
    );
  }
  async loadContextNotesForPrompt(prompt, referenced_file_paths) {
    const manual_paths = [
      ...new Set(
        referenced_file_paths.map((path) => path.trim()).filter(Boolean)
      )
    ];
    const auto_paths = await this.getRelevantContextPaths(prompt, manual_paths);
    return this.loadReferencedNotes([...manual_paths, ...auto_paths]);
  }
  getVaultSummary() {
    return this.vault_index.vault_summary || "Vault summary unavailable.";
  }
  getVaultMap() {
    return this.vault_index.vault_map;
  }
  getManualContextItems() {
    return [...this.manual_context_items];
  }
  async updateManualContextItems(items) {
    this.manual_context_items = [
      ...new Set(items.map((item) => item.trim()).filter(Boolean))
    ];
    await this.savePluginState();
    await this.syncVaultContextToRuntime();
  }
  async loadReferencedKanbanBoards(file_paths) {
    const unique_paths = [
      ...new Set(file_paths.map((path) => path.trim()).filter(Boolean))
    ];
    const files = this.getReferencedFiles(unique_paths);
    const boards = await Promise.all(
      files.map(async (file) => ({
        path: file.path,
        content: await this.app.vault.cachedRead(file)
      }))
    );
    return boards.filter((board) => parse_kanban_board(board.content));
  }
  getActiveFilePath() {
    return this.app.workspace.getActiveFile()?.path ?? null;
  }
  async exportActiveChatHandoff() {
    const chat_session = this.getActiveChat();
    if (!chat_session) {
      return null;
    }
    const handoff_folder = (0, import_obsidian3.normalizePath)("Ollama Chat Handoffs");
    if (!await this.app.vault.adapter.exists(handoff_folder)) {
      await this.app.vault.createFolder(handoff_folder);
    }
    const base_name = chat_session.title.replace(/[\\/:*?"<>|]/g, "-").trim() || "chat-handoff";
    const file_path = (0, import_obsidian3.normalizePath)(
      `${handoff_folder}/${base_name}-${Date.now()}.md`
    );
    const markdown = build_chat_handoff_markdown(chat_session);
    const file = await this.app.vault.create(file_path, markdown);
    await this.app.workspace.getLeaf(true).openFile(file);
    return file;
  }
  async processQuickEntry(entry_text, model) {
    const existing_folders = this.getVaultFolders();
    const plan = await processQuickEntryWithRuntime(this.settings.runtimeUrl, {
      entry_text,
      model,
      existing_folders
    });
    const folder_path = (0, import_obsidian3.normalizePath)(plan.target_folder || "Quick Entries");
    if (!await this.app.vault.adapter.exists(folder_path)) {
      await this.app.vault.createFolder(folder_path);
    }
    const note_file = await this.createQuickEntryNote(folder_path, plan);
    const log_file = await this.appendQuickEntryLog(
      entry_text,
      plan.log_summary,
      note_file
    );
    await this.app.workspace.getLeaf(true).openFile(note_file);
    return { note_file, log_file, plan };
  }
  async planNoteActions(prompt, model, referenced_file_paths) {
    const referenced_notes = await this.loadContextNotesForPrompt(
      prompt,
      referenced_file_paths
    );
    return planNoteActionsWithRuntime(this.settings.runtimeUrl, {
      prompt,
      model,
      referenced_notes
    });
  }
  async planKanbanActions(prompt, model, referenced_file_paths) {
    const boards = await this.loadReferencedKanbanBoards(referenced_file_paths);
    if (!boards.length) {
      throw new Error(
        "Attach at least one Kanban board note before generating a Kanban plan."
      );
    }
    return planKanbanActionsWithRuntime(this.settings.runtimeUrl, {
      prompt,
      model,
      boards
    });
  }
  async planAgentActions(prompt, model, referenced_file_paths) {
    const referenced_notes = await this.loadContextNotesForPrompt(
      prompt,
      referenced_file_paths
    );
    const boards = await this.loadReferencedKanbanBoards(referenced_file_paths);
    return planAgentActionsWithRuntime(this.settings.runtimeUrl, {
      prompt,
      model,
      referenced_notes,
      boards
    });
  }
  async applyNoteActionPlan(plan) {
    const touched_files = [];
    for (const operation of plan.operations) {
      touched_files.push(await this.applySingleNoteAction(operation));
    }
    if (touched_files[0]) {
      await this.app.workspace.getLeaf(true).openFile(touched_files[0]);
    }
    await this.reindexVault();
    return touched_files;
  }
  async applyKanbanActionPlan(plan) {
    const touched_files = [];
    const touched_paths = /* @__PURE__ */ new Set();
    for (const operation of plan.operations) {
      const touched_file = await this.applySingleKanbanAction(operation);
      if (!touched_paths.has(touched_file.path)) {
        touched_files.push(touched_file);
        touched_paths.add(touched_file.path);
      }
    }
    if (touched_files[0]) {
      await this.app.workspace.getLeaf(true).openFile(touched_files[0]);
    }
    await this.reindexVault();
    return touched_files;
  }
  async applyAgentActionPlan(plan) {
    const touched_files = [];
    const touched_paths = /* @__PURE__ */ new Set();
    for (const action of plan.actions) {
      const file = await this.applyAgentAction(action);
      if (file && !touched_paths.has(file.path)) {
        touched_files.push(file);
        touched_paths.add(file.path);
      }
    }
    if (touched_files[0]) {
      await this.app.workspace.getLeaf(true).openFile(touched_files[0]);
    }
    await this.reindexVault();
    return touched_files;
  }
  async applyAgentAction(action) {
    switch (action.type) {
      case "note_create":
        return this.applySingleNoteAction({
          action: "create",
          path: action.path,
          content: action.content,
          summary: action.summary
        });
      case "note_update":
        return this.applySingleNoteAction({
          action: "update",
          path: action.path,
          content: action.content,
          summary: action.summary
        });
      case "kanban_card_create":
        return this.applySingleKanbanAction({
          action: "create_card",
          board_path: action.board_path,
          source_lane_title: action.source_lane_title,
          target_lane_title: action.target_lane_title,
          card_title: action.card_title,
          new_card_title: action.new_card_title,
          summary: action.summary
        });
      case "kanban_card_move":
        return this.applySingleKanbanAction({
          action: "move_card",
          board_path: action.board_path,
          source_lane_title: action.source_lane_title,
          target_lane_title: action.target_lane_title,
          card_title: action.card_title,
          new_card_title: action.new_card_title,
          summary: action.summary
        });
      case "kanban_card_update":
        return this.applySingleKanbanAction({
          action: "update_card",
          board_path: action.board_path,
          source_lane_title: action.source_lane_title,
          target_lane_title: action.target_lane_title,
          card_title: action.card_title,
          new_card_title: action.new_card_title,
          summary: action.summary
        });
    }
  }
  extractLegacySettings(raw_data) {
    if (!("runtimeUrl" in raw_data) && !("defaultModel" in raw_data)) {
      return {};
    }
    return {
      runtimeUrl: raw_data.runtimeUrl,
      defaultModel: raw_data.defaultModel
    };
  }
  async savePluginState(check_health = false, refresh_views = true) {
    await this.saveData({
      settings: this.settings,
      chat_sessions: this.chat_sessions,
      active_chat_id: this.active_chat_id,
      vault_index: this.vault_index,
      manual_context_items: this.manual_context_items
    });
    if (refresh_views) {
      this.refreshOpenViews(check_health);
    }
  }
  async syncVaultContextToRuntime() {
    if (!this.vault_index.vault_map) {
      return;
    }
    try {
      await syncContextWithRuntime(this.settings.runtimeUrl, {
        indexed_at: this.vault_index.indexed_at,
        vault_summary: this.vault_index.vault_summary,
        vault_map: this.vault_index.vault_map,
        note_entries: this.vault_index.note_entries,
        manual_context_items: this.manual_context_items
      });
    } catch (error) {
      console.warn("[ollama-runtime-plugin] Context sync skipped:", error);
    }
  }
  async buildVaultIndexFromRuntime(indexed_at) {
    try {
      const result = await indexContextWithRuntime(this.settings.runtimeUrl, {
        indexed_at,
        vault_path: this.getVaultBasePath(),
        model: this.settings.defaultModel,
        manual_context_items: this.manual_context_items
      });
      return {
        file_paths: result.file_paths,
        markdown_file_count: result.file_paths.length,
        indexed_at: result.indexed_at,
        note_entries: result.note_entries,
        vault_summary: result.vault_summary,
        vault_map: result.vault_map
      };
    } catch (error) {
      console.warn(
        "[ollama-runtime-plugin] Runtime indexing unavailable, preserving local state:",
        error
      );
      if (this.vault_index.markdown_file_count > 0) {
        return {
          ...this.vault_index,
          indexed_at: this.vault_index.indexed_at ?? indexed_at
        };
      }
      return EMPTY_VAULT_INDEX;
    }
  }
  async requestRuntimeReindex() {
    const result = await reindexContextWithRuntime(this.settings.runtimeUrl, {
      vault_path: this.getVaultBasePath(),
      model: this.settings.defaultModel
    });
    this.vault_index = {
      file_paths: result.file_paths,
      markdown_file_count: result.file_paths.length,
      indexed_at: result.indexed_at,
      note_entries: result.note_entries,
      vault_summary: result.vault_summary,
      vault_map: result.vault_map
    };
    await this.savePluginState();
  }
  async getRelevantContextPaths(prompt, excluded_paths) {
    try {
      const result = await retrieveContextPathsWithRuntime(
        this.settings.runtimeUrl,
        {
          query: prompt,
          excluded_paths,
          limit: 4
        }
      );
      return result.paths;
    } catch (error) {
      console.warn(
        "[ollama-runtime-plugin] Runtime retrieval unavailable, using local fallback:",
        error
      );
      return retrieve_relevant_note_paths({
        query: prompt,
        entries: this.vault_index.note_entries,
        excluded_paths,
        limit: 4
      });
    }
  }
  getVaultBasePath() {
    const adapter = this.app.vault.adapter;
    if (adapter instanceof import_obsidian3.FileSystemAdapter) {
      return adapter.getBasePath();
    }
    const maybe_adapter = adapter;
    return maybe_adapter.getBasePath?.() ?? "";
  }
  registerVaultIndexHooks() {
    const schedule = () => {
      this.scheduleVaultReindex();
    };
    this.registerEvent(this.app.vault.on("create", schedule));
    this.registerEvent(this.app.vault.on("modify", schedule));
    this.registerEvent(this.app.vault.on("delete", schedule));
    this.registerEvent(this.app.vault.on("rename", schedule));
  }
  scheduleVaultReindex() {
    this.clearScheduledReindex();
    this.reindex_timer = window.setTimeout(() => {
      this.reindex_timer = null;
      void this.reindexVault();
    }, _OllamaRuntimePlugin.AUTO_REINDEX_DELAY_MS);
  }
  clearScheduledReindex() {
    if (this.reindex_timer !== null) {
      window.clearTimeout(this.reindex_timer);
      this.reindex_timer = null;
    }
  }
  normalizeMarkdownPath(path) {
    const trimmed_path = (0, import_obsidian3.normalizePath)(path.trim());
    return trimmed_path.endsWith(".md") ? trimmed_path : `${trimmed_path}.md`;
  }
  getGraphSummary(file) {
    const resolved_links = this.app.metadataCache.resolvedLinks ?? {};
    const outgoing_links = Object.keys(resolved_links[file.path] ?? {}).sort(
      (left, right) => left.localeCompare(right)
    );
    const incoming_links = Object.entries(resolved_links).filter(([, targets]) => Boolean(targets[file.path])).map(([source_path]) => source_path).sort((left, right) => left.localeCompare(right));
    const file_cache = this.app.metadataCache.getFileCache(file);
    const tags = [
      ...new Set((file_cache?.tags ?? []).map((tag) => tag.tag))
    ].sort((left, right) => left.localeCompare(right));
    return build_graph_summary({
      outgoing_links,
      incoming_links,
      tags
    });
  }
  async applySingleNoteAction(operation) {
    const normalized_path = this.normalizeMarkdownPath(operation.path);
    const parent_folder = normalized_path.includes("/") ? normalized_path.split("/").slice(0, -1).join("/") : "";
    if (parent_folder && !await this.app.vault.adapter.exists(parent_folder)) {
      await this.ensureFolderPath(parent_folder);
    }
    const existing = this.app.vault.getAbstractFileByPath(normalized_path);
    if (operation.action === "create") {
      if (existing instanceof import_obsidian3.TFile) {
        throw new Error(
          `Create action would overwrite existing file: ${normalized_path}`
        );
      }
      return this.app.vault.create(normalized_path, operation.content);
    }
    if (!(existing instanceof import_obsidian3.TFile)) {
      throw new Error(
        `Update action requires an existing file: ${normalized_path}`
      );
    }
    await this.app.vault.modify(existing, operation.content);
    return existing;
  }
  async applySingleKanbanAction(operation) {
    const normalized_path = this.normalizeMarkdownPath(operation.board_path);
    const existing = this.app.vault.getAbstractFileByPath(normalized_path);
    if (!(existing instanceof import_obsidian3.TFile)) {
      throw new Error(
        `Kanban action requires an existing board note: ${normalized_path}`
      );
    }
    const current_markdown = await this.app.vault.cachedRead(existing);
    const next_markdown = apply_kanban_operation(current_markdown, {
      ...operation,
      board_path: normalized_path
    });
    await this.app.vault.modify(existing, next_markdown);
    return existing;
  }
  async ensureFolderPath(folder_path) {
    const parts = (0, import_obsidian3.normalizePath)(folder_path).split("/");
    let current = "";
    for (const part of parts) {
      current = current ? (0, import_obsidian3.normalizePath)(`${current}/${part}`) : part;
      if (!await this.app.vault.adapter.exists(current)) {
        await this.app.vault.createFolder(current);
      }
    }
  }
  getVaultFolders() {
    const folders = /* @__PURE__ */ new Set(["Quick Entries"]);
    for (const path of this.vault_index.file_paths) {
      const parts = path.split("/");
      if (parts.length > 1) {
        folders.add(parts.slice(0, -1).join("/"));
      }
    }
    return [...folders].sort((left, right) => left.localeCompare(right));
  }
  async createQuickEntryNote(folder_path, plan) {
    const safe_title = plan.note_title.replace(/[\\/:*?"<>|]/g, "-").trim() || "Quick Entry";
    const file_path = await this.getAvailablePath(folder_path, safe_title);
    const tags_line = plan.tags.length ? `Tags: ${plan.tags.map((tag) => `#${tag.replace(/^#/, "")}`).join(" ")}

` : "";
    const content = `# ${safe_title}

${tags_line}${plan.note_body || "_No content generated._"}
`;
    return this.app.vault.create(file_path, content);
  }
  async appendQuickEntryLog(entry_text, log_summary, note_file) {
    const log_folder = (0, import_obsidian3.normalizePath)("Quick Entries/Logs");
    if (!await this.app.vault.adapter.exists(log_folder)) {
      await this.app.vault.createFolder(log_folder);
    }
    const date_stamp = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const log_path = (0, import_obsidian3.normalizePath)(`${log_folder}/${date_stamp}.md`);
    const log_line = [
      `- ${(/* @__PURE__ */ new Date()).toLocaleTimeString()}: [[${note_file.path}|${note_file.basename}]]`,
      `  - Summary: ${log_summary}`,
      `  - Source: ${entry_text.replace(/\s+/g, " ").trim()}`
    ].join("\n");
    if (await this.app.vault.adapter.exists(log_path)) {
      const log_file = this.app.vault.getAbstractFileByPath(log_path);
      if (!(log_file instanceof import_obsidian3.TFile)) {
        throw new Error(`Quick entry log path is not a file: ${log_path}`);
      }
      const existing = await this.app.vault.cachedRead(log_file);
      await this.app.vault.modify(
        log_file,
        `${existing.trimEnd()}
${log_line}
`
      );
      return log_file;
    }
    return this.app.vault.create(
      log_path,
      `# Quick Entry Log ${date_stamp}

${log_line}
`
    );
  }
  async getAvailablePath(folder_path, base_name) {
    let suffix = 0;
    while (true) {
      const candidate = (0, import_obsidian3.normalizePath)(
        `${folder_path}/${base_name}${suffix ? ` ${suffix}` : ""}.md`
      );
      if (!await this.app.vault.adapter.exists(candidate)) {
        return candidate;
      }
      suffix += 1;
    }
  }
};
_OllamaRuntimePlugin.AUTO_REINDEX_DELAY_MS = 4e3;
var OllamaRuntimePlugin = _OllamaRuntimePlugin;
