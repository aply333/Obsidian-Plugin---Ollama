import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import {
  AgentAction,
  AgentActionPlan,
  build_chat_prompt,
  ChatSession,
  KanbanActionPlan,
  NoteActionPlan,
  QuickEntryPlan,
} from "./chat";
import {
  ContextMetaResult,
  ContextTablesResult,
  getContextMetaWithRuntime,
  getContextTablesWithRuntime,
  RuntimeRequestError,
  getRuntimeHealth,
  streamGenerateWithRuntime,
} from "./api";
import type OllamaRuntimePlugin from "./main";

export const OLLAMA_VIEW_TYPE = "ollama-runtime-view";

type MainTabId = "chat" | "tools" | "context";
type ChatToolPanelId =
  | "quick_entry"
  | "vault_action"
  | "kanban_action"
  | "agent_action";

export class OllamaRuntimeView extends ItemView {
  plugin: OllamaRuntimePlugin;
  active_stream_controller: AbortController | null = null;
  active_tab: MainTabId = "chat";
  prompt = "";
  manual_context_text = "";
  note_search_text = "";
  reference_picker_open = false;
  quick_action_menu_open = false;
  active_tool_panel: ChatToolPanelId | null = null;
  quick_entry_text = "";
  quick_entry_result: QuickEntryPlan | null = null;
  vault_action_text = "";
  kanban_action_text = "";
  agent_action_text = "";
  note_action_plan: NoteActionPlan | null = null;
  kanban_action_plan: KanbanActionPlan | null = null;
  agent_action_plan: AgentActionPlan | null = null;
  status_text = "Not checked";
  status_tone: "neutral" | "ok" | "warn" | "error" = "neutral";
  error_text = "";
  context_meta: ContextMetaResult | null = null;
  context_tables: ContextTablesResult | null = null;
  context_tables_loading = false;
  is_busy = false;

  constructor(leaf: WorkspaceLeaf, plugin: OllamaRuntimePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return OLLAMA_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Ollama Runtime";
  }

  async onOpen(): Promise<void> {
    this.manual_context_text = this.plugin.getManualContextItems().join("\n");
    this.render();
    await this.refreshHealth();
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  async refreshFromSettings(): Promise<void> {
    this.manual_context_text = this.plugin.getManualContextItems().join("\n");
    this.status_text = "Not checked";
    this.status_tone = "neutral";
    this.error_text = "";
    this.render();
    await this.refreshHealth();
  }

  refreshFromPluginState(): void {
    this.manual_context_text = this.plugin.getManualContextItems().join("\n");
    this.render();
  }

  private render(): void {
    const active_chat = this.plugin.getActiveChat();
    const { contentEl } = this;

    contentEl.empty();
    contentEl.addClass("ollama-plugin-view");

    const shell = contentEl.createDiv({ cls: "ollama-shell" });
    this.renderWorkspace(shell, active_chat);
  }

  private renderWorkspace(
    container: HTMLElement,
    active_chat: ChatSession | null,
  ): void {
    const header = container.createDiv({
      cls: "ollama-shell__workspace-header",
    });
    header.createEl("h2", { text: active_chat?.title ?? "Ollama Runtime" });
    const header_actions = header.createDiv({
      cls: "ollama-shell__workspace-actions",
    });
    this.renderQuickActions(header_actions, active_chat);

    if (this.error_text) {
      container.createDiv({
        cls: "ollama-shell__banner ollama-shell__banner--error",
        text: this.error_text,
      });
    }

    const tab_row = container.createDiv({ cls: "ollama-shell__tabs" });
    const tabs: Array<{ id: MainTabId; label: string }> = [
      { id: "chat", label: "Chat" },
      { id: "tools", label: "Tools" },
      { id: "context", label: "Context" },
    ];
    for (const tab of tabs) {
      const button = tab_row.createEl("button", {
        text: tab.label,
        cls: `ollama-shell__tab${this.active_tab === tab.id ? " ollama-shell__tab--active" : ""}`,
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

  private renderQuickActions(
    container: HTMLElement,
    active_chat: ChatSession | null,
  ): void {
    const action_row = container.createDiv({ cls: "ollama-shell__actions" });

    const new_chat_button = container.createEl("button", {
      text: "New Chat",
      cls: "mod-cta",
    });
    new_chat_button.disabled = this.is_busy;
    new_chat_button.addEventListener("click", () => {
      void this.plugin.createChatSession();
    });
    const use_active_button = action_row.createEl("button", {
      text: "Use Active Note",
    });
    use_active_button.disabled = this.is_busy || !active_chat;
    use_active_button.addEventListener("click", () => {
      void this.attachActiveFile();
    });

    const reindex_button = action_row.createEl("button", {
      text: "Reindex Vault",
    });
    reindex_button.disabled = this.is_busy;
    reindex_button.addEventListener("click", () => {
      void this.reindexVault();
    });

    const handoff_button = action_row.createEl("button", {
      text: "Chat Handoff",
    });
    handoff_button.disabled = this.is_busy || !active_chat;
    handoff_button.addEventListener("click", () => {
      void this.exportHandoff();
    });

    const health_button = action_row.createEl("button", {
      text: "Check Runtime",
    });
    health_button.disabled = this.is_busy;
    health_button.addEventListener("click", () => {
      void this.refreshHealth();
    });
  }

  private renderChatStage(
    container: HTMLElement,
    active_chat: ChatSession | null,
  ): void {
    container.addClass("ollama-shell__chat-stage");

    const chat_header = container.createDiv({
      cls: "ollama-shell__chat-header",
    });
    chat_header.createEl("h3", { text: "Chat Log" });
    const chat_actions = chat_header.createDiv({
      cls: "ollama-shell__actions",
    });
    const add_context_button = chat_actions.createEl("button", {
      text: "Add Context",
    });
    add_context_button.disabled = this.is_busy || !active_chat;
    add_context_button.addEventListener("click", () => {
      this.reference_picker_open = !this.reference_picker_open;
      this.render();
    });

    const new_chat_button = chat_actions.createEl("button", {
      text: "New Chat",
      cls: "mod-cta",
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
      cls: "ollama-shell__composer ollama-shell__composer--chat",
    });
    this.renderComposer(composer, active_chat);
  }

  private renderToolsStage(
    container: HTMLElement,
    active_chat: ChatSession | null,
  ): void {
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

  private renderContextStage(container: HTMLElement): void {
    container.addClass("ollama-shell__context-stage");
    this.renderContextTab(container);
  }

  private renderHistoryTab(
    container: HTMLElement,
    active_chat: ChatSession | null,
  ): void {
    const table = container.createEl("table", {
      cls: "ollama-shell__history-table",
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
        active_chat?.id === chat_session.id
          ? "ollama-shell__history-row--active"
          : "ollama-shell__history-row",
      );
      row.addEventListener("click", () => {
        void this.plugin.setActiveChat(chat_session.id);
      });

      row.insertCell().setText(this.getInitialPrompt(chat_session));
      row.insertCell().setText(`${chat_session.messages.length} messages`);
      row
        .insertCell()
        .setText(new Date(chat_session.created_at).toLocaleString());
    }
  }

  private renderRuntimeTab(
    container: HTMLElement,
    active_chat: ChatSession | null,
  ): void {
    const details = container.createDiv({ cls: "ollama-shell__meta" });
    this.renderMetaRow(details, "Runtime URL", this.plugin.settings.runtimeUrl);
    this.renderMetaRow(
      details,
      "Connection status",
      this.status_text,
      this.status_tone,
    );
    this.renderMetaRow(
      details,
      "Effective model",
      this.getEffectiveModel(active_chat),
    );
    this.renderMetaRow(
      details,
      "DB note count",
      `${this.context_meta?.note_count ?? this.plugin.vault_index.markdown_file_count}`,
    );
    this.renderMetaRow(
      details,
      "Last indexed",
      this.context_meta?.last_indexed_at
        ? new Date(Number(this.context_meta.last_indexed_at)).toLocaleString()
        : "Unknown",
    );
    this.renderMetaRow(
      details,
      "Vault path",
      this.context_meta?.last_vault_path ?? "Not stored",
    );
    this.renderMetaRow(
      details,
      "Database path",
      this.context_meta?.database_path ?? "Unavailable",
    );

    const model_label = container.createEl("label", {
      text: "Model Override",
      cls: "ollama-shell__label",
    });
    const model_input = model_label.createEl("input", {
      cls: "ollama-shell__text-input",
      type: "text",
    });
    model_input.placeholder = this.plugin.settings.defaultModel;
    model_input.value = active_chat?.model_override ?? "";
    model_input.disabled = this.is_busy || !active_chat;
    model_input.addEventListener("change", () => {
      void this.plugin.updateActiveChat({
        model_override: model_input.value.trim(),
      });
    });

    const runtime_actions = container.createDiv({
      cls: "ollama-shell__actions",
    });
    const index_button = runtime_actions.createEl("button", {
      text: this.is_busy ? "Indexing..." : "Index Now",
      cls: "mod-cta",
    });
    index_button.disabled = this.is_busy;
    index_button.addEventListener("click", () => {
      void this.runRuntimeReindex();
    });

    const refresh_meta_button = runtime_actions.createEl("button", {
      text: "Refresh Runtime Meta",
    });
    refresh_meta_button.disabled = this.is_busy;
    refresh_meta_button.addEventListener("click", () => {
      void this.refreshRuntimeMeta();
    });
  }

  private renderContextTab(container: HTMLElement): void {
    const overview_section = container.createDiv({
      cls: "ollama-shell__context-section",
    });
    overview_section.createEl("h3", { text: "Current Runtime Context" });
    const overview_grid = overview_section.createDiv({
      cls: "ollama-shell__context-grid",
    });
    this.renderContextStat(
      overview_grid,
      "Effective model",
      this.plugin.getActiveChat()?.model_override.trim() ||
        this.plugin.settings.defaultModel,
    );
    this.renderContextStat(
      overview_grid,
      "Indexed notes",
      `${this.context_meta?.note_count ?? this.plugin.vault_index.markdown_file_count}`,
    );
    this.renderContextStat(
      overview_grid,
      "Last indexed",
      this.context_meta?.last_indexed_at
        ? new Date(Number(this.context_meta.last_indexed_at)).toLocaleString()
        : "Unknown",
    );
    this.renderContextStat(
      overview_grid,
      "Vault path",
      this.context_meta?.last_vault_path ?? "Not stored",
    );

    const generated_section = container.createDiv({
      cls: "ollama-shell__context-section",
    });
    generated_section.createEl("h3", { text: "Vault Notes" });
    generated_section.createEl("p", {
      cls: "ollama-shell__message-meta",
      text: "Generated from indexing. Read-only snapshot of the vault context currently sent to the runtime.",
    });

    const summary_block = generated_section.createDiv({
      cls: "ollama-shell__context-block",
    });
    summary_block.createEl("h4", { text: "Vault Summary" });
    summary_block.createEl("pre", {
      cls: "ollama-shell__context-pre",
      text: this.plugin.getVaultSummary(),
    });

    const map_block = generated_section.createDiv({
      cls: "ollama-shell__context-block",
    });
    map_block.createEl("h4", { text: "Vault Map" });
    map_block.createEl("pre", {
      cls: "ollama-shell__context-pre ollama-shell__context-pre--map",
      text: JSON.stringify(this.plugin.getVaultMap(), null, 2),
    });

    const folder_section = container.createDiv({
      cls: "ollama-shell__context-section",
    });
    folder_section.createEl("h3", { text: "Folder Intent Map" });
    folder_section.createEl("p", {
      cls: "ollama-shell__message-meta",
      text: "High-level intent summaries built from the indexed vault.",
    });
    const top_folders = this.plugin.getVaultMap()?.top_folders ?? [];
    if (!top_folders.length) {
      folder_section.createDiv({
        cls: "ollama-shell__empty-state ollama-shell__empty-state--compact",
        text: "No folder intent data is available yet. Reindex the runtime to populate it.",
      });
    } else {
      const folder_grid = folder_section.createDiv({
        cls: "ollama-shell__folder-grid",
      });
      for (const folder of top_folders) {
        const card = folder_grid.createDiv({
          cls: "ollama-shell__folder-card",
        });
        card.createEl("strong", { text: folder.folder });
        card.createEl("div", {
          cls: "ollama-shell__message-meta",
          text: `${folder.note_count} notes`,
        });
        if (folder.intent) {
          card.createEl("div", {
            cls: "ollama-shell__folder-intent",
            text: folder.intent,
          });
        }
        if (folder.top_topics.length) {
          const chips = card.createDiv({ cls: "ollama-shell__chip-row" });
          for (const topic of folder.top_topics.slice(0, 4)) {
            chips.createEl("span", {
              cls: "ollama-shell__chip",
              text: topic,
            });
          }
        }
      }
    }

    const manual_section = container.createDiv({
      cls: "ollama-shell__context-section",
    });
    manual_section.createEl("h3", { text: "Manual Instructions" });
    manual_section.createEl("p", {
      cls: "ollama-shell__message-meta",
      text: "Persistent steering context. One item per line, included with every prompt.",
    });

    const manual_block = manual_section.createDiv({
      cls: "ollama-shell__context-block",
    });
    manual_block.createEl("h4", { text: "Instructions" });
    manual_block.createEl("p", {
      cls: "ollama-shell__message-meta",
      text: "Examples: preferred tone, important vault themes, recurring projects, or guidance on how the assistant should summarize.",
    });
    const manual_input = manual_block.createEl("textarea", {
      cls: "ollama-shell__input ollama-shell__input--compact",
    });
    manual_input.placeholder =
      "This vault focuses on job search, product ideas, blog drafts, and weekly priorities.";
    manual_input.value = this.manual_context_text;
    manual_input.disabled = this.is_busy;
    manual_input.addEventListener("input", () => {
      this.manual_context_text = manual_input.value;
    });

    const manual_actions = manual_block.createDiv({
      cls: "ollama-shell__actions",
    });
    const save_button = manual_actions.createEl("button", {
      text: "Save Context",
      cls: "mod-cta",
    });
    save_button.disabled = this.is_busy;
    save_button.addEventListener("click", () => {
      void this.saveManualContext();
    });

    const clear_button = manual_actions.createEl("button", {
      text: "Clear",
    });
    clear_button.disabled = this.is_busy;
    clear_button.addEventListener("click", () => {
      this.manual_context_text = "";
      void this.saveManualContext();
    });

    const tables_section = container.createDiv({
      cls: "ollama-shell__context-section",
    });
    const category_section = container.createDiv({
      cls: "ollama-shell__context-section",
    });
    category_section.createEl("h3", { text: "Category Coverage" });
    category_section.createEl("p", {
      cls: "ollama-shell__message-meta",
      text: "Top runtime categories and their current note membership counts.",
    });
    const category_rows =
      this.context_tables?.categories
        .filter((row) => row.source === "ai")
        .slice(0, 8) ?? [];
    if (!category_rows.length) {
      category_section.createDiv({
        cls: "ollama-shell__empty-state ollama-shell__empty-state--compact",
        text: "No category data loaded yet. Refresh the SQL tables or reindex the runtime.",
      });
    } else {
      const category_grid = category_section.createDiv({
        cls: "ollama-shell__context-grid",
      });
      for (const row of category_rows) {
        const card = category_grid.createDiv({
          cls: "ollama-shell__context-stat ollama-shell__context-stat--category",
        });
        card.createEl("span", {
          cls: "ollama-shell__message-meta",
          text: "Category",
        });
        card.createEl("div", {
          cls: "ollama-shell__context-stat-value",
          text: this.formatSqlCell(row.name),
        });
        card.createEl("div", {
          cls: "ollama-shell__message-meta",
          text: `${this.formatSqlCell(row.count)} notes`,
        });
      }
    }

    tables_section.createEl("h3", { text: "SQLite Tables" });
    tables_section.createEl("p", {
      cls: "ollama-shell__message-meta",
      text: "Live snapshots from the runtime database.",
    });

    const refresh_button = tables_section.createEl("button", {
      text: this.context_tables_loading ? "Refreshing..." : "Refresh Tables",
      cls: "mod-cta",
    });
    refresh_button.disabled = this.context_tables_loading;
    refresh_button.addEventListener("click", () => {
      void this.refreshContextTables(true);
    });

    const tables = this.context_tables ?? {
      vault_map: [],
      categories: [],
      change_log: [],
      questions: [],
    };

    if (this.context_tables_loading && !this.context_tables) {
      tables_section.createDiv({
        cls: "ollama-shell__message-meta",
        text: "Loading SQL tables...",
      });
      return;
    }

    this.renderSqlTable(tables_section, "vault_map", tables.vault_map);
    this.renderSqlTable(tables_section, "categories", tables.categories);
    this.renderSqlTable(tables_section, "change_log", tables.change_log);
    this.renderSqlTable(tables_section, "questions", tables.questions);
  }

  private renderSqlTable(
    container: HTMLElement,
    table_name: string,
    rows: Array<Record<string, unknown>>,
  ): void {
    const block = container.createDiv({ cls: "ollama-shell__context-block" });
    block.createEl("h4", { text: table_name });

    if (!rows.length) {
      block.createDiv({
        cls: "ollama-shell__message-meta",
        text: "No rows.",
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

  private renderContextStat(
    container: HTMLElement,
    label: string,
    value: string,
  ): void {
    const card = container.createDiv({ cls: "ollama-shell__context-stat" });
    card.createEl("span", {
      cls: "ollama-shell__message-meta",
      text: label,
    });
    card.createEl("div", {
      cls: "ollama-shell__context-stat-value",
      text: value,
    });
  }

  private renderChatTools(
    container: HTMLElement,
    active_chat: ChatSession | null,
  ): void {
    const tools_header = container.createDiv({
      cls: "ollama-shell__tool-header",
    });
    tools_header.createEl("h3", { text: "Actions" });
    const tools_menu_wrap = tools_header.createDiv({
      cls: "ollama-shell__tool-menu-wrap",
    });
    const tools_toggle = tools_menu_wrap.createEl("button", {
      text: "Open Menu",
      cls: "mod-cta",
    });
    tools_toggle.disabled = this.is_busy;
    tools_toggle.addEventListener("click", () => {
      this.quick_action_menu_open = !this.quick_action_menu_open;
      this.render();
    });

    if (this.quick_action_menu_open) {
      const menu = tools_menu_wrap.createDiv({
        cls: "ollama-shell__tool-menu",
      });
      const items: Array<{ id: ChatToolPanelId; label: string }> = [
        { id: "quick_entry", label: "Quick Entry" },
        { id: "vault_action", label: "Vault Action Plan" },
        { id: "kanban_action", label: "Kanban Action Plan" },
        { id: "agent_action", label: "Agent Action Plan" },
      ];

      for (const item of items) {
        const button = menu.createEl("button", {
          text: item.label,
          cls: "ollama-shell__tool-menu-item",
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
        text: "Open the actions menu to use quick entry or planning tools.",
      });
      return;
    }

    const panel = container.createDiv({ cls: "ollama-shell__tool-panel" });
    const panel_header = panel.createDiv({
      cls: "ollama-shell__tool-panel-head",
    });
    panel_header.createEl("strong", {
      text: this.getToolPanelTitle(this.active_tool_panel),
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

  private renderQuickEntryPanel(
    container: HTMLElement,
    active_chat: ChatSession | null,
  ): void {
    const intro = container.createDiv({
      cls: "ollama-shell__quick-entry-intro",
    });
    intro.createEl("strong", { text: "Quick Capture" });
    intro.createEl("div", {
      cls: "ollama-shell__message-meta",
      text: "The runtime places entries using folder intent, category overlap, and vault context.",
    });

    const quick_entry_label = container.createEl("label", {
      text: "Capture text",
      cls: "ollama-shell__label",
    });
    const quick_entry_input = quick_entry_label.createEl("textarea", {
      cls: "ollama-shell__input ollama-shell__input--compact",
    });
    quick_entry_input.placeholder =
      "Drop in rough notes, tasks, ideas, or fragments. The AI will organize them into the vault and log the entry.";
    quick_entry_input.value = this.quick_entry_text;
    quick_entry_input.disabled = this.is_busy;
    quick_entry_input.addEventListener("input", () => {
      this.quick_entry_text = quick_entry_input.value;
    });

    const quick_entry_actions = container.createDiv({
      cls: "ollama-shell__actions",
    });
    const quick_entry_submit = quick_entry_actions.createEl("button", {
      text: this.is_busy ? "Processing..." : "Process Quick Entry",
      cls: "mod-cta",
    });
    quick_entry_submit.disabled = this.is_busy;
    quick_entry_submit.addEventListener("click", () => {
      void this.processQuickEntry(active_chat);
    });

    if (this.quick_entry_result) {
      this.renderQuickEntryResult(container, this.quick_entry_result);
    }
  }

  private renderQuickEntryResult(
    container: HTMLElement,
    result: QuickEntryPlan,
  ): void {
    const block = container.createDiv({
      cls: "ollama-shell__quick-entry-result",
    });
    const confidence = Math.round((result.placement_confidence ?? 1) * 100);
    const tone =
      (result.placement_confidence ?? 1) >= 0.75
        ? "ok"
        : (result.placement_confidence ?? 1) >= 0.5
          ? "warn"
          : "error";
    const header = block.createDiv({ cls: "ollama-shell__quick-entry-head" });
    header.createEl("strong", { text: "Latest Placement" });
    header.createEl("span", {
      cls: `ollama-shell__status-pill ollama-shell__status-pill--${tone}`,
      text: `${confidence}% confident`,
    });

    const grid = block.createDiv({ cls: "ollama-shell__context-grid" });
    this.renderContextStat(
      grid,
      "Target folder",
      result.target_folder || "Needs Home",
    );
    this.renderContextStat(grid, "Note title", result.note_title);
    this.renderContextStat(
      grid,
      "Fallback",
      (result.placement_confidence ?? 1) < 0.75
        ? "Needs Home applied"
        : "Not needed",
    );

    if (result.placement_reason) {
      block.createDiv({
        cls: "ollama-shell__message-meta",
        text: result.placement_reason,
      });
    }

    if (result.inferred_categories?.length) {
      const chips = block.createDiv({ cls: "ollama-shell__chip-row" });
      for (const category of result.inferred_categories) {
        chips.createEl("span", {
          cls: "ollama-shell__chip",
          text: category,
        });
      }
    }
  }

  private renderVaultActionPanel(
    container: HTMLElement,
    active_chat: ChatSession | null,
  ): void {
    const vault_action_label = container.createEl("label", {
      text: "Requested vault change",
      cls: "ollama-shell__label",
    });
    const vault_action_input = vault_action_label.createEl("textarea", {
      cls: "ollama-shell__input ollama-shell__input--compact",
    });
    vault_action_input.placeholder =
      "Describe the note changes you want. Example: create a project note in Projects and update my daily note with today's priorities.";
    vault_action_input.value = this.vault_action_text;
    vault_action_input.disabled = this.is_busy;
    vault_action_input.addEventListener("input", () => {
      this.vault_action_text = vault_action_input.value;
    });

    const vault_action_actions = container.createDiv({
      cls: "ollama-shell__actions",
    });
    const plan_button = vault_action_actions.createEl("button", {
      text: this.is_busy ? "Planning..." : "Generate Plan",
      cls: "mod-cta",
    });
    plan_button.disabled = this.is_busy;
    plan_button.addEventListener("click", () => {
      void this.generateNoteActionPlan(active_chat);
    });

    if (this.note_action_plan) {
      this.renderNoteActionPlan(container, this.note_action_plan);
    }
  }

  private renderKanbanActionPanel(
    container: HTMLElement,
    active_chat: ChatSession | null,
  ): void {
    const kanban_action_label = container.createEl("label", {
      text: "Requested Kanban change",
      cls: "ollama-shell__label",
    });
    const kanban_action_input = kanban_action_label.createEl("textarea", {
      cls: "ollama-shell__input ollama-shell__input--compact",
    });
    kanban_action_input.placeholder =
      "Describe the board change you want. Example: move 'Draft outline' from Backlog to Doing in Boards/Website.md.";
    kanban_action_input.value = this.kanban_action_text;
    kanban_action_input.disabled = this.is_busy;
    kanban_action_input.addEventListener("input", () => {
      this.kanban_action_text = kanban_action_input.value;
    });

    container.createDiv({
      cls: `ollama-shell__message-meta${
        active_chat?.referenced_file_paths.length
          ? ""
          : " ollama-shell__message-meta--warn"
      }`,
      text: "Attach one or more Kanban board notes in Referenced Files before generating this plan.",
    });

    const kanban_action_actions = container.createDiv({
      cls: "ollama-shell__actions",
    });
    const kanban_plan_button = kanban_action_actions.createEl("button", {
      text: this.is_busy ? "Planning..." : "Generate Kanban Plan",
      cls: "mod-cta",
    });
    kanban_plan_button.disabled = this.is_busy;
    kanban_plan_button.addEventListener("click", () => {
      void this.generateKanbanActionPlan(active_chat);
    });

    if (this.kanban_action_plan) {
      this.renderKanbanActionPlan(container, this.kanban_action_plan);
    }
  }

  private renderAgentActionPanel(
    container: HTMLElement,
    active_chat: ChatSession | null,
  ): void {
    const agent_action_label = container.createEl("label", {
      text: "Requested agent change",
      cls: "ollama-shell__label",
    });
    const agent_action_input = agent_action_label.createEl("textarea", {
      cls: "ollama-shell__input ollama-shell__input--compact",
    });
    agent_action_input.placeholder =
      "Describe a mixed workflow. Example: create a project note in Projects and move 'Draft outline' from Backlog to Doing in the attached Kanban board.";
    agent_action_input.value = this.agent_action_text;
    agent_action_input.disabled = this.is_busy;
    agent_action_input.addEventListener("input", () => {
      this.agent_action_text = agent_action_input.value;
    });

    container.createDiv({
      cls: "ollama-shell__message-meta",
      text: "This broader planner can return a mix of note actions and Kanban actions in one approved plan.",
    });

    const agent_action_actions = container.createDiv({
      cls: "ollama-shell__actions",
    });
    const agent_plan_button = agent_action_actions.createEl("button", {
      text: this.is_busy ? "Planning..." : "Generate Agent Plan",
      cls: "mod-cta",
    });
    agent_plan_button.disabled = this.is_busy;
    agent_plan_button.addEventListener("click", () => {
      void this.generateAgentActionPlan(active_chat);
    });

    if (this.agent_action_plan) {
      this.renderAgentActionPlan(container, this.agent_action_plan);
    }
  }

  private getToolPanelTitle(tool: ChatToolPanelId): string {
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

  private renderReferencePicker(
    container: HTMLElement,
    active_chat: ChatSession | null,
  ): void {
    const overlay = container.createDiv({
      cls: "ollama-shell__reference-overlay",
    });
    const card = overlay.createDiv({ cls: "ollama-shell__reference-dialog" });
    const header = card.createDiv({
      cls: "ollama-shell__reference-dialog-head",
    });
    header.createEl("strong", { text: "Referenced Files" });
    const close_button = header.createEl("button", { text: "Close" });
    close_button.addEventListener("click", () => {
      this.reference_picker_open = false;
      this.note_search_text = "";
      this.render();
    });

    const selected_files = card.createDiv({
      cls: "ollama-shell__reference-list",
    });
    if (!(active_chat?.referenced_file_paths.length ?? 0)) {
      selected_files.createDiv({
        cls: "ollama-shell__message-meta",
        text: "No reference files attached yet.",
      });
    }

    for (const path of active_chat?.referenced_file_paths ?? []) {
      const chip = selected_files.createDiv({
        cls: "ollama-shell__reference-chip",
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
      type: "text",
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
      text: "Use Active Note",
    });
    use_active_button.disabled = this.is_busy || !active_chat;
    use_active_button.addEventListener("click", () => {
      void this.attachActiveFile();
    });

    if (this.note_search_text.trim()) {
      const matches = this.getReferenceMatches(
        this.note_search_text,
        active_chat?.referenced_file_paths ?? [],
      );
      const results = card.createDiv({
        cls: "ollama-shell__reference-results",
      });

      if (!matches.length) {
        results.createDiv({
          cls: "ollama-shell__message-meta",
          text: "No matching notes.",
        });
      }

      for (const path of matches) {
        const result = results.createEl("button", {
          cls: "ollama-shell__reference-result",
          text: path,
        });
        result.disabled = this.is_busy || !active_chat;
        result.addEventListener("click", () => {
          void this.addReferencedFile(path);
        });
      }
    }
  }

  private renderTranscript(
    container: HTMLElement,
    active_chat: ChatSession | null,
  ): void {
    if (!active_chat || !active_chat.messages.length) {
      container.createDiv({
        cls: "ollama-shell__empty-state",
        text: "Start a fresh chat, reference vault notes if needed, and send the first prompt.",
      });
      return;
    }

    for (const message of active_chat.messages) {
      const message_block = container.createDiv({
        cls: `ollama-shell__message ollama-shell__message--${message.role}`,
      });
      message_block.createEl("div", {
        cls: "ollama-shell__message-role",
        text: message.role === "user" ? "You" : "Assistant",
      });
      message_block.createEl("div", {
        cls: "ollama-shell__message-body",
        text: message.content,
      });

      if (message.referenced_file_paths.length) {
        message_block.createEl("div", {
          cls: "ollama-shell__message-meta",
          text: `Context: ${message.referenced_file_paths.join(", ")}`,
        });
      }
    }
  }

  private renderComposer(
    container: HTMLElement,
    active_chat: ChatSession | null,
  ): void {
    const prompt_label = container.createEl("label", {
      text: "Prompt",
      cls: "ollama-shell__label",
    });
    const textarea = prompt_label.createEl("textarea", {
      cls: "ollama-shell__input",
    });
    textarea.placeholder =
      "Ask the runtime something about your vault, a note, or the current task...";
    textarea.value = this.prompt;
    textarea.disabled = this.is_busy || !active_chat;
    textarea.addEventListener("input", () => {
      this.prompt = textarea.value;
    });

    const composer_actions = container.createDiv({
      cls: "ollama-shell__composer-actions",
    });
    const reference_button = composer_actions.createEl("button", {
      text: "@+",
      cls: "ollama-shell__attach-button",
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
      cls: "ollama-shell__composer-send",
    });
    if (this.is_busy) {
      const indicator = send_group.createDiv({
        cls: "ollama-shell__thinking",
      });
      indicator.createSpan({ cls: "ollama-shell__thinking-dot" });
      indicator.createSpan({ text: "Thinking..." });
    }

    const generate_button = send_group.createEl("button", {
      text: this.is_busy ? "Generating..." : "Send",
      cls: "mod-cta",
    });
    generate_button.disabled = this.is_busy || !active_chat;
    generate_button.addEventListener("click", () => {
      void this.generateResponse();
    });

    if (this.is_busy && this.active_stream_controller) {
      const cancel_button = send_group.createEl("button", {
        text: "Cancel",
      });
      cancel_button.addEventListener("click", () => {
        this.cancelActiveRequest();
      });
    }
  }

  private renderMetaRow(
    container: HTMLElement,
    label: string,
    value: string,
    tone: "neutral" | "ok" | "warn" | "error" = "neutral",
  ): void {
    const row = container.createDiv({
      cls: `ollama-shell__status ollama-shell__status--${tone}`,
    });
    row.createSpan({ text: label });
    row.createEl("code", { text: value });
  }

  private getEffectiveModel(active_chat: ChatSession | null): string {
    return (
      active_chat?.model_override.trim() || this.plugin.settings.defaultModel
    );
  }

  private getInitialPrompt(chat_session: ChatSession): string {
    const first_user_message = chat_session.messages.find(
      (message) => message.role === "user",
    );
    if (!first_user_message) {
      return "No prompt yet";
    }

    return first_user_message.content.replace(/\s+/g, " ").trim().slice(0, 64);
  }

  private parseReferencedPaths(value: string): string[] {
    return [
      ...new Set(
        value
          .split(",")
          .map((path) => path.trim())
          .filter(Boolean),
      ),
    ];
  }

  private getReferenceMatches(
    query: string,
    selected_paths: string[],
  ): string[] {
    const normalized_query = query.trim().toLowerCase();
    if (!normalized_query) {
      return [];
    }

    return this.plugin.vault_index.file_paths
      .filter((path) => !selected_paths.includes(path))
      .filter((path) => path.toLowerCase().includes(normalized_query))
      .slice(0, 8);
  }

  private async addReferencedFile(path: string): Promise<void> {
    const active_chat = this.plugin.getActiveChat();
    if (!active_chat) {
      return;
    }

    const referenced_file_paths = [
      ...new Set([...active_chat.referenced_file_paths, path]),
    ];
    this.note_search_text = "";
    await this.plugin.updateActiveChat({ referenced_file_paths });
  }

  private async removeReferencedFile(path: string): Promise<void> {
    const active_chat = this.plugin.getActiveChat();
    if (!active_chat) {
      return;
    }

    const referenced_file_paths = active_chat.referenced_file_paths.filter(
      (file_path) => file_path !== path,
    );
    await this.plugin.updateActiveChat({ referenced_file_paths });
  }

  private async attachActiveFile(): Promise<void> {
    const active_chat = this.plugin.getActiveChat();
    const active_file_path = this.plugin.getActiveFilePath();

    if (!active_chat) {
      return;
    }

    if (!active_file_path) {
      new Notice("Open a note first if you want to attach the active file.");
      return;
    }

    const referenced_file_paths = [
      ...new Set([...active_chat.referenced_file_paths, active_file_path]),
    ];
    await this.plugin.updateActiveChat({ referenced_file_paths });
  }

  private async reindexVault(): Promise<void> {
    this.is_busy = true;
    this.error_text = "";
    this.render();

    try {
      await this.plugin.reindexVault();
      new Notice("Vault index refreshed.");
    } finally {
      this.is_busy = false;
      this.render();
    }
  }

  private async exportHandoff(): Promise<void> {
    try {
      const file = await this.plugin.exportActiveChatHandoff();
      if (file) {
        new Notice(`Chat handoff saved to ${file.path}`);
      }
    } catch (error) {
      new Notice(this.getErrorMessage(error));
    }
  }

  private async refreshHealth(): Promise<void> {
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
        this.error_text =
          "The runtime is reachable, but the Ollama daemon or model service is unavailable.";
      }
      await this.refreshRuntimeMeta(false);
    } catch (error) {
      this.status_text = "Offline";
      this.status_tone = "error";
      this.error_text = this.getErrorMessage(error);
      new Notice(this.getErrorMessage(error));
    } finally {
      this.is_busy = false;
      this.render();
    }
  }

  private async processQuickEntry(
    active_chat: ChatSession | null,
  ): Promise<void> {
    const model = this.getEffectiveModel(active_chat);
    if (!this.quick_entry_text.trim()) {
      new Notice("Enter some quick entry text first.");
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
        model,
      );
      this.quick_entry_result = result.plan;
      this.quick_entry_text = "";
      this.status_text = "Connected";
      this.status_tone = "ok";
      new Notice(
        `Quick entry saved to ${result.note_file.path} and logged in ${result.log_file.path}. Placement confidence: ${Math.round((result.plan.placement_confidence ?? 1) * 100)}%.`,
      );
      if ((result.plan.placement_confidence ?? 1) < 0.75) {
        new Notice(
          result.plan.placement_reason || "Quick entry routed to Needs Home.",
        );
      }
      await this.plugin.reindexVault();
    } catch (error) {
      this.quick_entry_result = null;
      this.status_text = "Quick entry failed";
      this.status_tone = "error";
      this.error_text = this.getErrorMessage(error);
      new Notice(this.getErrorMessage(error));
    } finally {
      this.is_busy = false;
      this.render();
    }
  }

  private renderNoteActionPlan(
    container: HTMLElement,
    plan: NoteActionPlan,
  ): void {
    const preview = container.createDiv({ cls: "ollama-shell__plan" });
    preview.createEl("div", {
      cls: "ollama-shell__plan-summary",
      text: plan.summary,
    });

    for (const operation of plan.operations) {
      const item = preview.createDiv({ cls: "ollama-shell__plan-item" });
      item.createEl("strong", {
        text: `${operation.action.toUpperCase()} ${operation.path}`,
      });
      item.createEl("div", {
        cls: "ollama-shell__message-meta",
        text: operation.summary,
      });
    }

    const actions = preview.createDiv({ cls: "ollama-shell__actions" });
    const apply_button = actions.createEl("button", {
      text: "Apply Plan",
      cls: "mod-cta",
    });
    apply_button.disabled = this.is_busy;
    apply_button.addEventListener("click", () => {
      void this.applyNoteActionPlan();
    });

    const clear_button = actions.createEl("button", {
      text: "Clear Plan",
    });
    clear_button.disabled = this.is_busy;
    clear_button.addEventListener("click", () => {
      this.note_action_plan = null;
      this.render();
    });
  }

  private async generateNoteActionPlan(
    active_chat: ChatSession | null,
  ): Promise<void> {
    if (!this.vault_action_text.trim()) {
      new Notice("Describe the vault change before generating a plan.");
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
        active_chat?.referenced_file_paths ?? [],
      );
      this.status_text = "Connected";
      this.status_tone = "ok";
    } catch (error) {
      this.status_text = "Plan failed";
      this.status_tone = "error";
      this.error_text = this.getErrorMessage(error);
      new Notice(this.getErrorMessage(error));
    } finally {
      this.is_busy = false;
      this.render();
    }
  }

  private async applyNoteActionPlan(): Promise<void> {
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
        this.note_action_plan,
      );
      this.note_action_plan = null;
      this.vault_action_text = "";
      this.status_text = "Connected";
      this.status_tone = "ok";
      new Notice(`Applied vault plan to ${touched_files.length} file(s).`);
    } catch (error) {
      this.status_text = "Apply failed";
      this.status_tone = "error";
      this.error_text = this.getErrorMessage(error);
      new Notice(this.getErrorMessage(error));
    } finally {
      this.is_busy = false;
      this.render();
    }
  }

  private renderKanbanActionPlan(
    container: HTMLElement,
    plan: KanbanActionPlan,
  ): void {
    const preview = container.createDiv({ cls: "ollama-shell__plan" });
    preview.createEl("div", {
      cls: "ollama-shell__plan-summary",
      text: plan.summary,
    });

    for (const operation of plan.operations) {
      const item = preview.createDiv({ cls: "ollama-shell__plan-item" });
      const action_label = operation.action.replace(/_/g, " ").toUpperCase();
      const lane_summary =
        operation.action === "move_card"
          ? `${operation.source_lane_title} -> ${operation.target_lane_title}`
          : operation.action === "create_card"
            ? `Lane: ${operation.target_lane_title}`
            : `Lane: ${operation.source_lane_title}`;
      item.createEl("strong", {
        text: `${action_label} ${operation.card_title} @ ${operation.board_path}`,
      });
      item.createEl("div", {
        cls: "ollama-shell__message-meta",
        text: lane_summary,
      });
      item.createEl("div", {
        cls: "ollama-shell__message-meta",
        text: operation.summary,
      });
    }

    const actions = preview.createDiv({ cls: "ollama-shell__actions" });
    const apply_button = actions.createEl("button", {
      text: "Apply Kanban Plan",
      cls: "mod-cta",
    });
    apply_button.disabled = this.is_busy;
    apply_button.addEventListener("click", () => {
      void this.applyKanbanActionPlan();
    });

    const clear_button = actions.createEl("button", {
      text: "Clear Plan",
    });
    clear_button.disabled = this.is_busy;
    clear_button.addEventListener("click", () => {
      this.kanban_action_plan = null;
      this.render();
    });
  }

  private async generateKanbanActionPlan(
    active_chat: ChatSession | null,
  ): Promise<void> {
    if (!this.kanban_action_text.trim()) {
      new Notice("Describe the Kanban change before generating a plan.");
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
        active_chat?.referenced_file_paths ?? [],
      );
      this.status_text = "Connected";
      this.status_tone = "ok";
    } catch (error) {
      this.status_text = "Kanban plan failed";
      this.status_tone = "error";
      this.error_text = this.getErrorMessage(error);
      new Notice(this.getErrorMessage(error));
    } finally {
      this.is_busy = false;
      this.render();
    }
  }

  private async applyKanbanActionPlan(): Promise<void> {
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
        this.kanban_action_plan,
      );
      this.kanban_action_plan = null;
      this.kanban_action_text = "";
      this.status_text = "Connected";
      this.status_tone = "ok";
      new Notice(
        `Applied Kanban plan to ${touched_files.length} board file(s).`,
      );
    } catch (error) {
      this.status_text = "Kanban apply failed";
      this.status_tone = "error";
      this.error_text = this.getErrorMessage(error);
      new Notice(this.getErrorMessage(error));
    } finally {
      this.is_busy = false;
      this.render();
    }
  }

  private renderAgentActionPlan(
    container: HTMLElement,
    plan: AgentActionPlan,
  ): void {
    const preview = container.createDiv({ cls: "ollama-shell__plan" });
    preview.createEl("div", {
      cls: "ollama-shell__plan-summary",
      text: plan.summary,
    });

    for (const action of plan.actions) {
      const item = preview.createDiv({ cls: "ollama-shell__plan-item" });
      item.createEl("strong", {
        text: this.getAgentActionTitle(action),
      });
      item.createEl("div", {
        cls: "ollama-shell__message-meta",
        text: action.summary,
      });
    }

    const actions = preview.createDiv({ cls: "ollama-shell__actions" });
    const apply_button = actions.createEl("button", {
      text: "Apply Agent Plan",
      cls: "mod-cta",
    });
    apply_button.disabled = this.is_busy;
    apply_button.addEventListener("click", () => {
      void this.applyAgentActionPlan();
    });

    const clear_button = actions.createEl("button", {
      text: "Clear Plan",
    });
    clear_button.disabled = this.is_busy;
    clear_button.addEventListener("click", () => {
      this.agent_action_plan = null;
      this.render();
    });
  }

  private getAgentActionTitle(action: AgentAction): string {
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

  private async generateAgentActionPlan(
    active_chat: ChatSession | null,
  ): Promise<void> {
    if (!this.agent_action_text.trim()) {
      new Notice("Describe the agent change before generating a plan.");
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
        active_chat?.referenced_file_paths ?? [],
      );
      this.status_text = "Connected";
      this.status_tone = "ok";
    } catch (error) {
      this.status_text = "Agent plan failed";
      this.status_tone = "error";
      this.error_text = this.getErrorMessage(error);
      new Notice(this.getErrorMessage(error));
    } finally {
      this.is_busy = false;
      this.render();
    }
  }

  private async applyAgentActionPlan(): Promise<void> {
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
        this.agent_action_plan,
      );
      this.agent_action_plan = null;
      this.agent_action_text = "";
      this.status_text = "Connected";
      this.status_tone = "ok";
      new Notice(`Applied agent plan to ${touched_files.length} file(s).`);
    } catch (error) {
      this.status_text = "Agent apply failed";
      this.status_tone = "error";
      this.error_text = this.getErrorMessage(error);
      new Notice(this.getErrorMessage(error));
    } finally {
      this.is_busy = false;
      this.render();
    }
  }

  private async generateResponse(): Promise<void> {
    const active_chat = this.plugin.getActiveChat();
    if (!active_chat) {
      new Notice("Create a chat before sending a prompt.");
      return;
    }

    if (!this.prompt.trim()) {
      new Notice("Enter a prompt before generating.");
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
        active_chat.referenced_file_paths,
      );
      const request_prompt = build_chat_prompt({
        prompt: user_prompt,
        history: active_chat.messages,
        referenced_notes,
        vault_summary: this.plugin.getVaultSummary(),
        vault_map: this.plugin.getVaultMap(),
        manual_context_items: this.plugin.getManualContextItems(),
      });

      await this.plugin.appendMessage(
        "user",
        user_prompt,
        model,
        referenced_notes.map((note) => note.path),
      );
      const assistant_message = await this.plugin.appendMessage(
        "assistant",
        "",
        model,
        referenced_notes.map((note) => note.path),
      );
      assistant_message_id = assistant_message?.id ?? "";
      this.prompt = "";
      this.render();

      let assistant_response = "";
      await streamGenerateWithRuntime(
        this.plugin.settings.runtimeUrl,
        {
          prompt: request_prompt,
          model,
        },
        (chunk) => {
          assistant_response += chunk.response;
          if (assistant_message) {
            this.plugin.updateMessageContent(
              assistant_message.id,
              assistant_response,
              false,
            );
          }
        },
        this.active_stream_controller.signal,
      );
      if (assistant_message) {
        this.plugin.updateMessageContent(
          assistant_message.id,
          assistant_response.trim(),
          true,
        );
      }
      this.status_text = "Connected";
      this.status_tone = "ok";
    } catch (error) {
      if (
        assistant_message_id &&
        !(error instanceof RuntimeRequestError && error.code === "cancelled")
      ) {
        this.plugin.updateMessageContent(
          assistant_message_id,
          "[Response interrupted]",
          true,
        );
      }
      if (error instanceof RuntimeRequestError && error.code === "cancelled") {
        if (assistant_message_id) {
          this.plugin.updateMessageContent(
            assistant_message_id,
            "[Generation cancelled]",
            true,
          );
        }
        this.status_text = "Cancelled";
        this.status_tone = "warn";
        this.error_text = "";
      } else {
        this.status_text = "Request failed";
        this.status_tone = "error";
        this.error_text = this.getErrorMessage(error);
        new Notice(this.getErrorMessage(error));
      }
    } finally {
      this.active_stream_controller = null;
      this.is_busy = false;
      this.render();
    }
  }

  private cancelActiveRequest(): void {
    this.active_stream_controller?.abort();
  }

  private async saveManualContext(): Promise<void> {
    await this.plugin.updateManualContextItems(
      this.manual_context_text.split("\n"),
    );
    this.manual_context_text = this.plugin.getManualContextItems().join("\n");
    new Notice("Context updated.");
  }

  private async runRuntimeReindex(): Promise<void> {
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
      new Notice("Runtime reindex completed.");
    } catch (error) {
      this.status_text = "Runtime index failed";
      this.status_tone = "error";
      this.error_text = this.getErrorMessage(error);
      new Notice(this.getErrorMessage(error));
    } finally {
      this.is_busy = false;
      this.render();
    }
  }

  private async refreshContextTables(force = false): Promise<void> {
    if (this.context_tables_loading || (!force && this.context_tables)) {
      return;
    }

    this.context_tables_loading = true;
    this.render();
    try {
      this.context_tables = await getContextTablesWithRuntime(
        this.plugin.settings.runtimeUrl,
      );
    } catch (error) {
      this.context_tables = null;
      new Notice(this.getErrorMessage(error));
    } finally {
      this.context_tables_loading = false;
      this.render();
    }
  }

  private async refreshRuntimeMeta(should_render = true): Promise<void> {
    try {
      this.context_meta = await getContextMetaWithRuntime(
        this.plugin.settings.runtimeUrl,
      );
    } catch {
      this.context_meta = null;
    } finally {
      if (should_render) {
        this.render();
      }
    }
  }

  private formatSqlCell(value: unknown): string {
    if (value === null || value === undefined) {
      return "";
    }
    return typeof value === "string" ? value : JSON.stringify(value);
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof RuntimeRequestError) {
      return error.message;
    }

    if (error instanceof Error) {
      return error.message;
    }

    return "Unknown runtime error.";
  }
}
