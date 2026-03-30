export interface RuntimeHealth {
  status: string;
  ollama_reachable: boolean;
  database_ready: boolean;
  indexing?: boolean;
}

export class RuntimeRequestError extends Error {
  code: "timeout" | "offline" | "http" | "cancelled" | "unknown";

  constructor(
    message: string,
    code: "timeout" | "offline" | "http" | "cancelled" | "unknown",
  ) {
    super(message);
    this.name = "RuntimeRequestError";
    this.code = code;
  }
}

export interface GeneratePayload {
  prompt: string;
  model: string;
}

export interface GenerateResult {
  model: string;
  response: string;
}

export interface GenerateStreamChunk {
  model: string;
  response: string;
  done: boolean;
  error?: string;
}

export interface QuickEntryPayload {
  entry_text: string;
  model: string;
  existing_folders: string[];
}

export interface QuickEntryResult {
  note_title: string;
  target_folder: string;
  note_body: string;
  log_summary: string;
  tags: string[];
  inferred_categories?: string[];
  placement_confidence?: number;
  placement_reason?: string;
}

export interface NoteReferencePayload {
  path: string;
  content: string;
}

export interface NoteActionPlanPayload {
  prompt: string;
  model: string;
  referenced_notes: NoteReferencePayload[];
}

export interface NoteActionOperationResult {
  action: "create" | "update";
  path: string;
  content: string;
  summary: string;
}

export interface NoteActionPlanResult {
  summary: string;
  operations: NoteActionOperationResult[];
  requires_confirmation: boolean;
}

export interface KanbanBoardPayload {
  path: string;
  content: string;
}

export interface KanbanActionPlanPayload {
  prompt: string;
  model: string;
  boards: KanbanBoardPayload[];
}

export interface KanbanActionOperationResult {
  action: "create_card" | "move_card" | "update_card";
  board_path: string;
  source_lane_title: string;
  target_lane_title: string;
  card_title: string;
  new_card_title: string;
  summary: string;
}

export interface KanbanActionPlanResult {
  summary: string;
  operations: KanbanActionOperationResult[];
  requires_confirmation: boolean;
}

export interface AgentActionPlanPayload {
  prompt: string;
  model: string;
  referenced_notes: NoteReferencePayload[];
  boards: KanbanBoardPayload[];
}

export type AgentActionResult =
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

export interface AgentActionPlanResult {
  summary: string;
  actions: AgentActionResult[];
  requires_confirmation: boolean;
}

export interface ContextSyncNoteEntryPayload {
  path: string;
  title: string;
  excerpt: string;
  tags: string[];
  links: string[];
  ai_categories?: string[];
  word_count: number;
}

export interface ContextSyncVaultMapFolderPayload {
  folder: string;
  note_count: number;
  sample_titles: string[];
  sample_paths: string[];
  top_topics: string[];
  intent?: string;
}

export interface ContextSyncVaultMapTagPayload {
  tag: string;
  count: number;
}

export interface ContextSyncVaultMapLinkPayload {
  note_path: string;
  title: string;
  link_count: number;
}

export interface ContextSyncRepresentativeNotePayload {
  path: string;
  title: string;
}

export interface ContextSyncVaultMapPayload {
  generated_at: number;
  note_count: number;
  dominant_topics: string[];
  top_folders: ContextSyncVaultMapFolderPayload[];
  top_tags: ContextSyncVaultMapTagPayload[];
  most_connected_notes: ContextSyncVaultMapLinkPayload[];
  representative_notes: ContextSyncRepresentativeNotePayload[];
}

export interface ContextSyncPayload {
  indexed_at: number | null;
  vault_summary: string;
  vault_map: ContextSyncVaultMapPayload;
  note_entries: ContextSyncNoteEntryPayload[];
  manual_context_items: string[];
}

export interface ContextSyncResult {
  status: string;
  database_path: string;
  note_count: number;
  folder_count: number;
}

export interface ContextIndexPayload {
  indexed_at: number;
  vault_path?: string;
  model?: string;
  manual_context_items: string[];
}

export interface ContextIndexResult {
  indexed_at: number;
  file_paths: string[];
  note_entries: ContextSyncNoteEntryPayload[];
  vault_summary: string;
  vault_map: ContextSyncVaultMapPayload;
  database_path: string;
}

export interface ContextReindexPayload {
  vault_path?: string;
  model?: string;
}

export interface ContextReindexResult extends ContextIndexResult {
  source: string;
}

export interface ContextRetrievePayload {
  query: string;
  excluded_paths: string[];
  limit: number;
}

export interface ContextRetrieveResult {
  paths: string[];
}

export interface ContextTablesResult {
  vault_map: Array<Record<string, unknown>>;
  categories: Array<Record<string, unknown>>;
  change_log: Array<Record<string, unknown>>;
  questions: Array<Record<string, unknown>>;
}

export interface ContextMetaResult {
  database_path: string;
  last_vault_path: string | null;
  last_indexed_at: string | null;
  note_count: number;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

async function fetchWithTimeout(
  input: string,
  init?: RequestInit,
  timeoutMs = 15_000,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(
    () => controller.abort("timeout"),
    timeoutMs,
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
        once: true,
      });
    }
  }

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      if (controller.signal.reason === "cancelled") {
        throw new RuntimeRequestError("Request cancelled.", "cancelled");
      }
      throw new RuntimeRequestError(
        `Runtime request timed out after ${Math.floor(timeoutMs / 1000)} seconds.`,
        "timeout",
      );
    }

    if (error instanceof TypeError) {
      throw new RuntimeRequestError(
        "Cannot reach the runtime. Check that the local API server is running.",
        "offline",
      );
    }

    throw new RuntimeRequestError(
      "Unknown runtime request failure.",
      "unknown",
    );
  } finally {
    externalSignal?.removeEventListener("abort", abortFromExternalSignal);
    window.clearTimeout(timeoutId);
  }
}

async function parseError(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { detail?: string };
    return data.detail || `Runtime request failed with ${response.status}.`;
  } catch {
    return `Runtime request failed with ${response.status}.`;
  }
}

export async function getRuntimeHealth(
  baseUrl: string,
): Promise<RuntimeHealth> {
  const response = await fetchWithTimeout(
    `${normalizeBaseUrl(baseUrl)}/health`,
    undefined,
    8_000,
  );
  if (!response.ok) {
    throw new RuntimeRequestError(await parseError(response), "http");
  }

  return (await response.json()) as RuntimeHealth;
}

export async function syncContextWithRuntime(
  baseUrl: string,
  payload: ContextSyncPayload,
): Promise<ContextSyncResult> {
  const response = await fetchWithTimeout(
    `${normalizeBaseUrl(baseUrl)}/context/sync`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
    30_000,
  );

  if (!response.ok) {
    throw new RuntimeRequestError(await parseError(response), "http");
  }

  return (await response.json()) as ContextSyncResult;
}

export async function indexContextWithRuntime(
  baseUrl: string,
  payload: ContextIndexPayload,
): Promise<ContextIndexResult> {
  const response = await fetchWithTimeout(
    `${normalizeBaseUrl(baseUrl)}/context/index`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
    60_000,
  );

  if (!response.ok) {
    throw new RuntimeRequestError(await parseError(response), "http");
  }

  return (await response.json()) as ContextIndexResult;
}

export async function reindexContextWithRuntime(
  baseUrl: string,
  payload: ContextReindexPayload,
): Promise<ContextReindexResult> {
  const response = await fetchWithTimeout(
    `${normalizeBaseUrl(baseUrl)}/context/reindex`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
    60_000,
  );

  if (!response.ok) {
    throw new RuntimeRequestError(await parseError(response), "http");
  }

  return (await response.json()) as ContextReindexResult;
}

export async function retrieveContextPathsWithRuntime(
  baseUrl: string,
  payload: ContextRetrievePayload,
): Promise<ContextRetrieveResult> {
  const response = await fetchWithTimeout(
    `${normalizeBaseUrl(baseUrl)}/context/retrieve`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
    20_000,
  );

  if (!response.ok) {
    throw new RuntimeRequestError(await parseError(response), "http");
  }

  return (await response.json()) as ContextRetrieveResult;
}

export async function getContextTablesWithRuntime(
  baseUrl: string,
): Promise<ContextTablesResult> {
  const response = await fetchWithTimeout(
    `${normalizeBaseUrl(baseUrl)}/context/tables`,
    undefined,
    20_000,
  );

  if (!response.ok) {
    throw new RuntimeRequestError(await parseError(response), "http");
  }

  return (await response.json()) as ContextTablesResult;
}

export async function getContextMetaWithRuntime(
  baseUrl: string,
): Promise<ContextMetaResult> {
  const response = await fetchWithTimeout(
    `${normalizeBaseUrl(baseUrl)}/context/meta`,
    undefined,
    20_000,
  );

  if (!response.ok) {
    throw new RuntimeRequestError(await parseError(response), "http");
  }

  return (await response.json()) as ContextMetaResult;
}

export async function generateWithRuntime(
  baseUrl: string,
  payload: GeneratePayload,
): Promise<GenerateResult> {
  const response = await fetchWithTimeout(
    `${normalizeBaseUrl(baseUrl)}/generate`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    throw new RuntimeRequestError(await parseError(response), "http");
  }

  return (await response.json()) as GenerateResult;
}

export async function streamGenerateWithRuntime(
  baseUrl: string,
  payload: GeneratePayload,
  onChunk: (chunk: GenerateStreamChunk) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetchWithTimeout(
    `${normalizeBaseUrl(baseUrl)}/generate-stream`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal,
    },
    60_000,
  );

  if (!response.ok) {
    throw new RuntimeRequestError(await parseError(response), "http");
  }

  if (!response.body) {
    throw new RuntimeRequestError(
      "Runtime stream response body was empty.",
      "unknown",
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

      const chunk = JSON.parse(line) as GenerateStreamChunk;
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

export async function processQuickEntryWithRuntime(
  baseUrl: string,
  payload: QuickEntryPayload,
): Promise<QuickEntryResult> {
  const response = await fetchWithTimeout(
    `${normalizeBaseUrl(baseUrl)}/quick-entry`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
    45_000,
  );

  if (!response.ok) {
    throw new RuntimeRequestError(await parseError(response), "http");
  }

  return (await response.json()) as QuickEntryResult;
}

export async function planNoteActionsWithRuntime(
  baseUrl: string,
  payload: NoteActionPlanPayload,
): Promise<NoteActionPlanResult> {
  const response = await fetchWithTimeout(
    `${normalizeBaseUrl(baseUrl)}/note-action-plan`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
    20_000,
  );

  if (!response.ok) {
    throw new RuntimeRequestError(await parseError(response), "http");
  }

  return (await response.json()) as NoteActionPlanResult;
}

export async function planKanbanActionsWithRuntime(
  baseUrl: string,
  payload: KanbanActionPlanPayload,
): Promise<KanbanActionPlanResult> {
  const response = await fetchWithTimeout(
    `${normalizeBaseUrl(baseUrl)}/kanban-action-plan`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
    20_000,
  );

  if (!response.ok) {
    throw new RuntimeRequestError(await parseError(response), "http");
  }

  return (await response.json()) as KanbanActionPlanResult;
}

export async function planAgentActionsWithRuntime(
  baseUrl: string,
  payload: AgentActionPlanPayload,
): Promise<AgentActionPlanResult> {
  const response = await fetchWithTimeout(
    `${normalizeBaseUrl(baseUrl)}/agent-action-plan`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
    25_000,
  );

  if (!response.ok) {
    throw new RuntimeRequestError(await parseError(response), "http");
  }

  return (await response.json()) as AgentActionPlanResult;
}
