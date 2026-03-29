import {
  FileSystemAdapter,
  normalizePath,
  Plugin,
  TFile,
  WorkspaceLeaf,
} from "obsidian";
import {
  AgentAction,
  AgentActionPlan,
  build_chat_handoff_markdown,
  build_chat_title,
  ChatMessage,
  ChatSession,
  create_chat_session,
  create_id,
  EMPTY_VAULT_INDEX,
  KanbanActionPlan,
  NoteActionPlan,
  QuickEntryPlan,
  VaultIndexState,
} from "./chat";
import {
  apply_kanban_operation,
  build_kanban_context,
  parse_kanban_board,
} from "./kanban";
import { build_graph_context, build_graph_summary } from "./graph";
import { retrieve_relevant_note_paths } from "./retrieval";
import {
  indexContextWithRuntime,
  planAgentActionsWithRuntime,
  planKanbanActionsWithRuntime,
  planNoteActionsWithRuntime,
  processQuickEntryWithRuntime,
  reindexContextWithRuntime,
  retrieveContextPathsWithRuntime,
  syncContextWithRuntime,
} from "./api";
import {
  DEFAULT_SETTINGS,
  OllamaPluginSettings,
  OllamaSettingTab,
} from "./settings";
import { OLLAMA_VIEW_TYPE, OllamaRuntimeView } from "./view";

interface StoredPluginData {
  settings?: Partial<OllamaPluginSettings>;
  chat_sessions?: ChatSession[];
  active_chat_id?: string;
  vault_index?: VaultIndexState;
  manual_context_items?: string[];
  runtimeUrl?: string;
  defaultModel?: string;
}

export default class OllamaRuntimePlugin extends Plugin {
  private static readonly AUTO_REINDEX_DELAY_MS = 4000;
  settings!: OllamaPluginSettings;
  chat_sessions: ChatSession[] = [];
  active_chat_id = "";
  vault_index: VaultIndexState = EMPTY_VAULT_INDEX;
  manual_context_items: string[] = [];
  private reindex_timer: number | null = null;
  private reindex_in_flight = false;
  private reindex_pending = false;

  async onload(): Promise<void> {
    await this.loadSettings();
    try {
      await this.reindexVault(false);
    } catch (error) {
      console.warn(
        "[ollama-runtime-plugin] Initial reindex failed during startup:",
        error,
      );
    }
    this.registerVaultIndexHooks();

    this.registerView(
      OLLAMA_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new OllamaRuntimeView(leaf, this),
    );

    this.addRibbonIcon("bot", "Open Ollama Runtime", async () => {
      await this.activateView();
    });

    this.addCommand({
      id: "open-ollama-runtime-view",
      name: "Open Ollama Runtime",
      callback: async () => {
        await this.activateView();
      },
    });

    this.addSettingTab(new OllamaSettingTab(this.app, this));
  }

  async onunload(): Promise<void> {
    this.clearScheduledReindex();
    await this.app.workspace.detachLeavesOfType(OLLAMA_VIEW_TYPE);
  }

  async loadSettings(): Promise<void> {
    const raw_data = ((await this.loadData()) ?? {}) as StoredPluginData;
    const legacy_settings = this.extractLegacySettings(raw_data);

    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      legacy_settings,
      raw_data.settings ?? {},
    );
    this.chat_sessions = raw_data.chat_sessions ?? [];
    this.active_chat_id = raw_data.active_chat_id ?? "";
    this.manual_context_items = raw_data.manual_context_items ?? [];
    this.vault_index = {
      ...EMPTY_VAULT_INDEX,
      ...(raw_data.vault_index ?? {}),
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

  async saveSettings(): Promise<void> {
    await this.savePluginState(true);
  }

  private async activateView(): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null =
      workspace.getLeavesOfType(OLLAMA_VIEW_TYPE)[0] ?? null;

    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      await leaf?.setViewState({ type: OLLAMA_VIEW_TYPE, active: true });
    }

    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }

  refreshOpenViews(check_health = false): void {
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

  getActiveChat(): ChatSession | null {
    return (
      this.chat_sessions.find(
        (chat_session) => chat_session.id === this.active_chat_id,
      ) ?? null
    );
  }

  getSortedChats(): ChatSession[] {
    return [...this.chat_sessions].sort(
      (left, right) => right.updated_at - left.updated_at,
    );
  }

  async createChatSession(): Promise<void> {
    const chat_session = create_chat_session();
    this.chat_sessions = [chat_session, ...this.chat_sessions];
    this.active_chat_id = chat_session.id;
    await this.savePluginState();
  }

  async setActiveChat(chat_id: string): Promise<void> {
    if (chat_id === this.active_chat_id) {
      return;
    }

    this.active_chat_id = chat_id;
    await this.savePluginState();
  }

  async updateActiveChat(
    values: Partial<
      Pick<ChatSession, "model_override" | "referenced_file_paths" | "title">
    >,
  ): Promise<void> {
    const chat_session = this.getActiveChat();
    if (!chat_session) {
      return;
    }

    Object.assign(chat_session, values, { updated_at: Date.now() });
    await this.savePluginState();
  }

  async appendMessage(
    role: ChatMessage["role"],
    content: string,
    model: string,
    referenced_file_paths: string[],
  ): Promise<ChatMessage | null> {
    const chat_session = this.getActiveChat();
    if (!chat_session) {
      return null;
    }

    const message: ChatMessage = {
      id: create_id(role),
      role,
      content,
      created_at: Date.now(),
      model,
      referenced_file_paths,
    };

    if (!chat_session.messages.length && role === "user") {
      chat_session.title = build_chat_title(content);
    }

    chat_session.messages = [...chat_session.messages, message];
    chat_session.updated_at = Date.now();
    await this.savePluginState();
    return message;
  }

  updateMessageContent(
    message_id: string,
    content: string,
    persist = false,
  ): void {
    const chat_session = this.getActiveChat();
    if (!chat_session) {
      return;
    }

    chat_session.messages = chat_session.messages.map((message) =>
      message.id === message_id ? { ...message, content } : message,
    );
    chat_session.updated_at = Date.now();

    if (persist) {
      void this.savePluginState();
      return;
    }

    this.refreshOpenViews();
  }

  async reindexVault(should_refresh = true): Promise<void> {
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

  getReferencedFiles(file_paths: string[]): TFile[] {
    return file_paths
      .map((file_path) => this.app.vault.getAbstractFileByPath(file_path))
      .filter((file): file is TFile => file instanceof TFile);
  }

  async loadReferencedNotes(
    file_paths: string[],
  ): Promise<Array<{ path: string; content: string }>> {
    const unique_paths = [
      ...new Set(file_paths.map((path) => path.trim()).filter(Boolean)),
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
            graph_summary,
          ),
        };
      }),
    );
  }

  async loadContextNotesForPrompt(
    prompt: string,
    referenced_file_paths: string[],
  ): Promise<Array<{ path: string; content: string }>> {
    const manual_paths = [
      ...new Set(
        referenced_file_paths.map((path) => path.trim()).filter(Boolean),
      ),
    ];
    const auto_paths = await this.getRelevantContextPaths(prompt, manual_paths);

    return this.loadReferencedNotes([...manual_paths, ...auto_paths]);
  }

  getVaultSummary(): string {
    return this.vault_index.vault_summary || "Vault summary unavailable.";
  }

  getVaultMap() {
    return this.vault_index.vault_map;
  }

  getManualContextItems(): string[] {
    return [...this.manual_context_items];
  }

  async updateManualContextItems(items: string[]): Promise<void> {
    this.manual_context_items = [
      ...new Set(items.map((item) => item.trim()).filter(Boolean)),
    ];
    await this.savePluginState();
    await this.syncVaultContextToRuntime();
  }

  async loadReferencedKanbanBoards(
    file_paths: string[],
  ): Promise<Array<{ path: string; content: string }>> {
    const unique_paths = [
      ...new Set(file_paths.map((path) => path.trim()).filter(Boolean)),
    ];
    const files = this.getReferencedFiles(unique_paths);
    const boards = await Promise.all(
      files.map(async (file) => ({
        path: file.path,
        content: await this.app.vault.cachedRead(file),
      })),
    );

    return boards.filter((board) => parse_kanban_board(board.content));
  }

  getActiveFilePath(): string | null {
    return this.app.workspace.getActiveFile()?.path ?? null;
  }

  async exportActiveChatHandoff(): Promise<TFile | null> {
    const chat_session = this.getActiveChat();
    if (!chat_session) {
      return null;
    }

    const handoff_folder = normalizePath("Ollama Chat Handoffs");
    if (!(await this.app.vault.adapter.exists(handoff_folder))) {
      await this.app.vault.createFolder(handoff_folder);
    }

    const base_name =
      chat_session.title.replace(/[\\/:*?"<>|]/g, "-").trim() || "chat-handoff";
    const file_path = normalizePath(
      `${handoff_folder}/${base_name}-${Date.now()}.md`,
    );
    const markdown = build_chat_handoff_markdown(chat_session);
    const file = await this.app.vault.create(file_path, markdown);
    await this.app.workspace.getLeaf(true).openFile(file);
    return file;
  }

  async processQuickEntry(
    entry_text: string,
    model: string,
  ): Promise<{ note_file: TFile; log_file: TFile; plan: QuickEntryPlan }> {
    const existing_folders = this.getVaultFolders();
    const plan = await processQuickEntryWithRuntime(this.settings.runtimeUrl, {
      entry_text,
      model,
      existing_folders,
    });
    const folder_path = normalizePath(plan.target_folder || "Quick Entries");

    if (!(await this.app.vault.adapter.exists(folder_path))) {
      await this.app.vault.createFolder(folder_path);
    }

    const note_file = await this.createQuickEntryNote(folder_path, plan);
    const log_file = await this.appendQuickEntryLog(
      entry_text,
      plan.log_summary,
      note_file,
    );
    await this.app.workspace.getLeaf(true).openFile(note_file);
    return { note_file, log_file, plan };
  }

  async planNoteActions(
    prompt: string,
    model: string,
    referenced_file_paths: string[],
  ): Promise<NoteActionPlan> {
    const referenced_notes = await this.loadContextNotesForPrompt(
      prompt,
      referenced_file_paths,
    );
    return planNoteActionsWithRuntime(this.settings.runtimeUrl, {
      prompt,
      model,
      referenced_notes,
    });
  }

  async planKanbanActions(
    prompt: string,
    model: string,
    referenced_file_paths: string[],
  ): Promise<KanbanActionPlan> {
    const boards = await this.loadReferencedKanbanBoards(referenced_file_paths);
    if (!boards.length) {
      throw new Error(
        "Attach at least one Kanban board note before generating a Kanban plan.",
      );
    }

    return planKanbanActionsWithRuntime(this.settings.runtimeUrl, {
      prompt,
      model,
      boards,
    });
  }

  async planAgentActions(
    prompt: string,
    model: string,
    referenced_file_paths: string[],
  ): Promise<AgentActionPlan> {
    const referenced_notes = await this.loadContextNotesForPrompt(
      prompt,
      referenced_file_paths,
    );
    const boards = await this.loadReferencedKanbanBoards(referenced_file_paths);

    return planAgentActionsWithRuntime(this.settings.runtimeUrl, {
      prompt,
      model,
      referenced_notes,
      boards,
    });
  }

  async applyNoteActionPlan(plan: NoteActionPlan): Promise<TFile[]> {
    const touched_files: TFile[] = [];

    for (const operation of plan.operations) {
      touched_files.push(await this.applySingleNoteAction(operation));
    }

    if (touched_files[0]) {
      await this.app.workspace.getLeaf(true).openFile(touched_files[0]);
    }

    await this.reindexVault();
    return touched_files;
  }

  async applyKanbanActionPlan(plan: KanbanActionPlan): Promise<TFile[]> {
    const touched_files: TFile[] = [];
    const touched_paths = new Set<string>();

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

  async applyAgentActionPlan(plan: AgentActionPlan): Promise<TFile[]> {
    const touched_files: TFile[] = [];
    const touched_paths = new Set<string>();

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

  private async applyAgentAction(action: AgentAction): Promise<TFile | null> {
    switch (action.type) {
      case "note_create":
        return this.applySingleNoteAction({
          action: "create",
          path: action.path,
          content: action.content,
          summary: action.summary,
        });
      case "note_update":
        return this.applySingleNoteAction({
          action: "update",
          path: action.path,
          content: action.content,
          summary: action.summary,
        });
      case "kanban_card_create":
        return this.applySingleKanbanAction({
          action: "create_card",
          board_path: action.board_path,
          source_lane_title: action.source_lane_title,
          target_lane_title: action.target_lane_title,
          card_title: action.card_title,
          new_card_title: action.new_card_title,
          summary: action.summary,
        });
      case "kanban_card_move":
        return this.applySingleKanbanAction({
          action: "move_card",
          board_path: action.board_path,
          source_lane_title: action.source_lane_title,
          target_lane_title: action.target_lane_title,
          card_title: action.card_title,
          new_card_title: action.new_card_title,
          summary: action.summary,
        });
      case "kanban_card_update":
        return this.applySingleKanbanAction({
          action: "update_card",
          board_path: action.board_path,
          source_lane_title: action.source_lane_title,
          target_lane_title: action.target_lane_title,
          card_title: action.card_title,
          new_card_title: action.new_card_title,
          summary: action.summary,
        });
    }
  }

  private extractLegacySettings(
    raw_data: StoredPluginData,
  ): Partial<OllamaPluginSettings> {
    if (!("runtimeUrl" in raw_data) && !("defaultModel" in raw_data)) {
      return {};
    }

    return {
      runtimeUrl: raw_data.runtimeUrl,
      defaultModel: raw_data.defaultModel,
    };
  }

  private async savePluginState(
    check_health = false,
    refresh_views = true,
  ): Promise<void> {
    await this.saveData({
      settings: this.settings,
      chat_sessions: this.chat_sessions,
      active_chat_id: this.active_chat_id,
      vault_index: this.vault_index,
      manual_context_items: this.manual_context_items,
    });

    if (refresh_views) {
      this.refreshOpenViews(check_health);
    }
  }

  private async syncVaultContextToRuntime(): Promise<void> {
    if (!this.vault_index.vault_map) {
      return;
    }

    try {
      await syncContextWithRuntime(this.settings.runtimeUrl, {
        indexed_at: this.vault_index.indexed_at,
        vault_summary: this.vault_index.vault_summary,
        vault_map: this.vault_index.vault_map,
        note_entries: this.vault_index.note_entries,
        manual_context_items: this.manual_context_items,
      });
    } catch (error) {
      console.warn("[ollama-runtime-plugin] Context sync skipped:", error);
    }
  }

  private async buildVaultIndexFromRuntime(
    indexed_at: number,
  ): Promise<VaultIndexState> {
    try {
      const result = await indexContextWithRuntime(this.settings.runtimeUrl, {
        indexed_at,
        vault_path: this.getVaultBasePath(),
        model: this.settings.defaultModel,
        manual_context_items: this.manual_context_items,
      });

      return {
        file_paths: result.file_paths,
        markdown_file_count: result.file_paths.length,
        indexed_at: result.indexed_at,
        note_entries: result.note_entries,
        vault_summary: result.vault_summary,
        vault_map: result.vault_map,
      };
    } catch (error) {
      console.warn(
        "[ollama-runtime-plugin] Runtime indexing unavailable, preserving local state:",
        error,
      );
      if (this.vault_index.markdown_file_count > 0) {
        return {
          ...this.vault_index,
          indexed_at: this.vault_index.indexed_at ?? indexed_at,
        };
      }

      return EMPTY_VAULT_INDEX;
    }
  }

  async requestRuntimeReindex(): Promise<void> {
    const result = await reindexContextWithRuntime(this.settings.runtimeUrl, {
      vault_path: this.getVaultBasePath(),
      model: this.settings.defaultModel,
    });
    this.vault_index = {
      file_paths: result.file_paths,
      markdown_file_count: result.file_paths.length,
      indexed_at: result.indexed_at,
      note_entries: result.note_entries,
      vault_summary: result.vault_summary,
      vault_map: result.vault_map,
    };
    await this.savePluginState();
  }

  private async getRelevantContextPaths(
    prompt: string,
    excluded_paths: string[],
  ): Promise<string[]> {
    try {
      const result = await retrieveContextPathsWithRuntime(
        this.settings.runtimeUrl,
        {
          query: prompt,
          excluded_paths,
          limit: 4,
        },
      );
      return result.paths;
    } catch (error) {
      console.warn(
        "[ollama-runtime-plugin] Runtime retrieval unavailable, using local fallback:",
        error,
      );
      return retrieve_relevant_note_paths({
        query: prompt,
        entries: this.vault_index.note_entries,
        excluded_paths,
        limit: 4,
      });
    }
  }

  private getVaultBasePath(): string {
    const adapter = this.app.vault.adapter;
    if (adapter instanceof FileSystemAdapter) {
      return adapter.getBasePath();
    }

    const maybe_adapter = adapter as { getBasePath?: () => string };
    return maybe_adapter.getBasePath?.() ?? "";
  }

  private registerVaultIndexHooks(): void {
    const schedule = () => {
      this.scheduleVaultReindex();
    };

    this.registerEvent(this.app.vault.on("create", schedule));
    this.registerEvent(this.app.vault.on("modify", schedule));
    this.registerEvent(this.app.vault.on("delete", schedule));
    this.registerEvent(this.app.vault.on("rename", schedule));
  }

  private scheduleVaultReindex(): void {
    this.clearScheduledReindex();
    this.reindex_timer = window.setTimeout(() => {
      this.reindex_timer = null;
      void this.reindexVault();
    }, OllamaRuntimePlugin.AUTO_REINDEX_DELAY_MS);
  }

  private clearScheduledReindex(): void {
    if (this.reindex_timer !== null) {
      window.clearTimeout(this.reindex_timer);
      this.reindex_timer = null;
    }
  }

  private normalizeMarkdownPath(path: string): string {
    const trimmed_path = normalizePath(path.trim());
    return trimmed_path.endsWith(".md") ? trimmed_path : `${trimmed_path}.md`;
  }

  private getGraphSummary(file: TFile) {
    const resolved_links = (this.app.metadataCache.resolvedLinks ??
      {}) as Record<string, Record<string, number>>;
    const outgoing_links = Object.keys(resolved_links[file.path] ?? {}).sort(
      (left, right) => left.localeCompare(right),
    );
    const incoming_links = Object.entries(resolved_links)
      .filter(([, targets]) => Boolean(targets[file.path]))
      .map(([source_path]) => source_path)
      .sort((left, right) => left.localeCompare(right));
    const file_cache = this.app.metadataCache.getFileCache(file);
    const tags = [
      ...new Set((file_cache?.tags ?? []).map((tag) => tag.tag)),
    ].sort((left, right) => left.localeCompare(right));

    return build_graph_summary({
      outgoing_links,
      incoming_links,
      tags,
    });
  }

  private async applySingleNoteAction(
    operation: NoteActionPlan["operations"][number],
  ): Promise<TFile> {
    const normalized_path = this.normalizeMarkdownPath(operation.path);
    const parent_folder = normalized_path.includes("/")
      ? normalized_path.split("/").slice(0, -1).join("/")
      : "";

    if (
      parent_folder &&
      !(await this.app.vault.adapter.exists(parent_folder))
    ) {
      await this.ensureFolderPath(parent_folder);
    }

    const existing = this.app.vault.getAbstractFileByPath(normalized_path);
    if (operation.action === "create") {
      if (existing instanceof TFile) {
        throw new Error(
          `Create action would overwrite existing file: ${normalized_path}`,
        );
      }

      return this.app.vault.create(normalized_path, operation.content);
    }

    if (!(existing instanceof TFile)) {
      throw new Error(
        `Update action requires an existing file: ${normalized_path}`,
      );
    }

    await this.app.vault.modify(existing, operation.content);
    return existing;
  }

  private async applySingleKanbanAction(
    operation: KanbanActionPlan["operations"][number],
  ): Promise<TFile> {
    const normalized_path = this.normalizeMarkdownPath(operation.board_path);
    const existing = this.app.vault.getAbstractFileByPath(normalized_path);
    if (!(existing instanceof TFile)) {
      throw new Error(
        `Kanban action requires an existing board note: ${normalized_path}`,
      );
    }

    const current_markdown = await this.app.vault.cachedRead(existing);
    const next_markdown = apply_kanban_operation(current_markdown, {
      ...operation,
      board_path: normalized_path,
    });
    await this.app.vault.modify(existing, next_markdown);
    return existing;
  }

  private async ensureFolderPath(folder_path: string): Promise<void> {
    const parts = normalizePath(folder_path).split("/");
    let current = "";

    for (const part of parts) {
      current = current ? normalizePath(`${current}/${part}`) : part;
      if (!(await this.app.vault.adapter.exists(current))) {
        await this.app.vault.createFolder(current);
      }
    }
  }

  private getVaultFolders(): string[] {
    const folders = new Set<string>(["Quick Entries"]);

    for (const path of this.vault_index.file_paths) {
      const parts = path.split("/");
      if (parts.length > 1) {
        folders.add(parts.slice(0, -1).join("/"));
      }
    }

    return [...folders].sort((left, right) => left.localeCompare(right));
  }

  private async createQuickEntryNote(
    folder_path: string,
    plan: QuickEntryPlan,
  ): Promise<TFile> {
    const safe_title =
      plan.note_title.replace(/[\\/:*?"<>|]/g, "-").trim() || "Quick Entry";
    const file_path = await this.getAvailablePath(folder_path, safe_title);
    const tags_line = plan.tags.length
      ? `Tags: ${plan.tags.map((tag) => `#${tag.replace(/^#/, "")}`).join(" ")}\n\n`
      : "";
    const content = `# ${safe_title}\n\n${tags_line}${plan.note_body || "_No content generated._"}\n`;
    return this.app.vault.create(file_path, content);
  }

  private async appendQuickEntryLog(
    entry_text: string,
    log_summary: string,
    note_file: TFile,
  ): Promise<TFile> {
    const log_folder = normalizePath("Quick Entries/Logs");
    if (!(await this.app.vault.adapter.exists(log_folder))) {
      await this.app.vault.createFolder(log_folder);
    }

    const date_stamp = new Date().toISOString().slice(0, 10);
    const log_path = normalizePath(`${log_folder}/${date_stamp}.md`);
    const log_line = [
      `- ${new Date().toLocaleTimeString()}: [[${note_file.path}|${note_file.basename}]]`,
      `  - Summary: ${log_summary}`,
      `  - Source: ${entry_text.replace(/\s+/g, " ").trim()}`,
    ].join("\n");

    if (await this.app.vault.adapter.exists(log_path)) {
      const log_file = this.app.vault.getAbstractFileByPath(log_path);
      if (!(log_file instanceof TFile)) {
        throw new Error(`Quick entry log path is not a file: ${log_path}`);
      }

      const existing = await this.app.vault.cachedRead(log_file);
      await this.app.vault.modify(
        log_file,
        `${existing.trimEnd()}\n${log_line}\n`,
      );
      return log_file;
    }

    return this.app.vault.create(
      log_path,
      `# Quick Entry Log ${date_stamp}\n\n${log_line}\n`,
    );
  }

  private async getAvailablePath(
    folder_path: string,
    base_name: string,
  ): Promise<string> {
    let suffix = 0;

    while (true) {
      const candidate = normalizePath(
        `${folder_path}/${base_name}${suffix ? ` ${suffix}` : ""}.md`,
      );
      if (!(await this.app.vault.adapter.exists(candidate))) {
        return candidate;
      }
      suffix += 1;
    }
  }
}
